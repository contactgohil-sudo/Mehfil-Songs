const BUILD_ID = "lookup-2026-04-25-clean-lrclib-ovh-saregama-v1";
const APP_USER_AGENT = "MehfilLyrics/1.0 contact:mehfil-app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type Provider = "saregama" | "lrclib" | "ovh";
type CandidateStatus = "lyrics_ready" | "metadata_only";
type ScriptType = "gujarati" | "devanagari" | "romanized" | "english" | "mixed" | "unknown";

type LookupBody = {
  query?: string;
  title?: string;
  singer?: string;
  movie?: string;
  limit?: number;
  preferredScripts?: string[];
};

type Candidate = {
  provider: Provider;
  title: string;
  singer: string;
  movie: string;
  source_name: string;
  source_url: string;
  script: ScriptType;
  preview: string;
  status: CandidateStatus;
  confidence: number;
  lookup_key: string;
};

type InternalCandidate = Omit<Candidate, "confidence" | "lookup_key"> & {
  lyrics?: string;
};

type SaregamaSource = {
  title: string;
  singer: string;
  movie: string;
  urls: string[];
  aliases: string[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function normalizeText(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!|[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLyricsText(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[[0-9:.]+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPreview(text: string) {
  return cleanLyricsText(text).slice(0, 520);
}

function decodeHtmlEntities(text: string) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      try {
        return String.fromCharCode(Number(code));
      } catch {
        return "";
      }
    });
}

function stripHtmlToText(html: string) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h1|h2|h3|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectScript(text: string): ScriptType {
  const value = String(text || "");
  const hasGujarati = /[\u0A80-\u0AFF]/.test(value);
  const hasDevanagari = /[\u0900-\u097F]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);

  if (hasGujarati && !hasDevanagari && !hasLatin) return "gujarati";
  if (hasDevanagari && !hasGujarati && !hasLatin) return "devanagari";
  if ((hasGujarati || hasDevanagari) && hasLatin) return "mixed";

  if (hasLatin) {
    const norm = normalizeText(value);
    const romanIndicHints = [
      "hai", "ho", "dil", "tum", "tere", "meri", "mera", "koi", "jaise",
      "chhe", "che", "mane", "mara", "tari", "nathi", "shu", "kem"
    ];

    const hits = romanIndicHints.filter(word => norm.includes(word)).length;
    return hits >= 2 ? "romanized" : "english";
  }

  return "unknown";
}

function tokenOverlapScore(a: string, b: string) {
  const aTokens = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const bTokens = new Set(normalizeText(b).split(/\s+/).filter(Boolean));

  if (!aTokens.size || !bTokens.size) return 0;

  let hits = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) hits++;
  }

  return hits / Math.max(aTokens.size, bTokens.size);
}

function removeVersionNoise(title: string) {
  return String(title || "")
    .replace(/\blofi\b/gi, " ")
    .replace(/\blo-fi\b/gi, " ")
    .replace(/\btrap mix\b/gi, " ")
    .replace(/\btrap\b/gi, " ")
    .replace(/\bremix\b/gi, " ")
    .replace(/\bcover\b/gi, " ")
    .replace(/\bsingle\b/gi, " ")
    .replace(/\bviral\b/gi, " ")
    .replace(/\bretro\b/gi, " ")
    .replace(/\bdj\b/gi, " ")
    .replace(/\breprise\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisyVersionTitle(title: string) {
  return /\b(lofi|lo-fi|trap|remix|cover|single|viral|dj|construction)\b/i.test(String(title || ""));
}

function scriptPreferenceScore(script: ScriptType, preferredScripts: string[]) {
  const index = preferredScripts.indexOf(script);
  if (index === -1) return 0;
  return Math.max(0, 10 - index * 2);
}

function makeLookupKey(candidate: InternalCandidate) {
  return JSON.stringify({
    provider: candidate.provider,
    title: candidate.title,
    singer: candidate.singer,
    movie: candidate.movie,
    source_name: candidate.source_name,
    source_url: candidate.source_url,
    preview: candidate.preview,
    lyrics: candidate.lyrics || "",
    script: candidate.script,
    status: candidate.status
  });
}

function scoreLyricsReadyCandidate(
  candidate: InternalCandidate,
  query: string,
  title: string,
  singer: string,
  preferredScripts: string[]
) {
  const q = normalizeText(query);
  const t = normalizeText(title || query);
  const s = normalizeText(singer || "");

  const candidateTitle = normalizeText(candidate.title);
  const cleanCandidateTitle = normalizeText(removeVersionNoise(candidate.title));
  const cleanQueryTitle = normalizeText(removeVersionNoise(title || query));

  let score = 0;

  if (candidateTitle === t || cleanCandidateTitle === cleanQueryTitle) score += 36;
  if (candidateTitle.includes(t) || t.includes(candidateTitle)) score += 16;

  score += Math.round(tokenOverlapScore(t, candidate.title) * 34);
  score += Math.round(tokenOverlapScore(q, candidate.title) * 18);

  if (s) {
    score += Math.round(tokenOverlapScore(s, candidate.singer) * 22);
  }

  score += scriptPreferenceScore(candidate.script, preferredScripts);

  const lyricsLength = cleanLyricsText(candidate.lyrics || candidate.preview).length;
  if (lyricsLength >= 100) score += 8;
  if (lyricsLength >= 250) score += 6;
  if (lyricsLength >= 500) score += 5;

  if (candidate.provider === "saregama") score += 24;
  if (candidate.provider === "lrclib") score += 12;
  if (candidate.provider === "ovh") score += 8;

  if (isNoisyVersionTitle(candidate.title) && !isNoisyVersionTitle(query)) {
    score -= 16;
  }

  return Math.max(0, Math.min(score, 100));
}

function scoreMetadataOnlyCandidate(candidate: InternalCandidate, query: string, title: string, singer: string) {
  const q = normalizeText(query);
  const t = normalizeText(title || query);
  const s = normalizeText(singer || "");

  let score = 0;

  score += Math.round(tokenOverlapScore(t, candidate.title) * 48);
  score += Math.round(tokenOverlapScore(q, candidate.title) * 26);

  if (s) {
    score += Math.round(tokenOverlapScore(s, candidate.singer) * 18);
  }

  if (candidate.title && normalizeText(candidate.title) === t) score += 20;
  if (candidate.provider === "ovh") score += 8;

  if (isNoisyVersionTitle(candidate.title) && !isNoisyVersionTitle(query)) {
    score -= 16;
  }

  return Math.max(0, Math.min(score, 88));
}

function buildQueryVariants(input: { query: string; title: string }) {
  const base = normalizeText(input.title || input.query);
  if (!base) return [];

  const words = base.split(/\s+/).filter(Boolean);
  const variants = new Set<string>();

  variants.add(base);

  if (words.length >= 2) {
    variants.add(words.slice(0, 2).join(" "));
    variants.add(words.slice(0, 3).join(" "));
    variants.add(words.slice(-2).join(" "));
  }

  if (words.length >= 3) {
    variants.add(words.slice(1, 3).join(" "));
    variants.add(words.slice(1, 4).join(" "));
  }

  return Array.from(variants).filter(Boolean).slice(0, 7);
}

async function safeJson(url: string, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": APP_USER_AGENT
  };

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers
    });

    if (!response.ok) {
      console.log("safeJson failed", {
        url,
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }

    try {
      return await response.json();
    } catch {
      return null;
    }
  } catch (error) {
    console.log("safeJson exception", {
      url,
      error: String((error as Error)?.message || error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeText(url: string, timeoutMs = 5200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml,text/plain"
      }
    });

    const text = await response.text().catch(() => "");

    return {
      ok: response.ok,
      status: response.status,
      status_text: response.statusText,
      length: text.length,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      status_text: String((error as Error)?.message || error || "fetch failed"),
      length: 0,
      text: ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

const SAREGAMA_SOURCES: SaregamaSource[] = [
  {
    title: "Aao Huzoor Tumko",
    singer: "Asha Bhosle",
    movie: "Kismat",
    urls: [
      "https://www.saregama.com/song-lyrics/aao-huzoor-tumko_7220",
      "https://nsrgm-www.saregama.com/song-lyrics/aao-huzoor-tumko_7220"
    ],
    aliases: [
      "aao huzoor tumko",
      "aao huzur tumko",
      "aao hujoor tumko",
      "aao hazoor tumko",
      "aao huzoor",
      "huzoor tumko",
      "hujoor tumko",
      "huzur tumko"
    ]
  },
  {
    title: "Kajra Mohabbat Wala",
    singer: "Asha Bhosle, Shamshad Begum",
    movie: "Kismat",
    urls: [
      "https://www.saregama.com/song-lyrics/kajra-mohabbat-wala_7217",
      "https://nsrgm-www.saregama.com/song-lyrics/kajra-mohabbat-wala_7217"
    ],
    aliases: [
      "kajra mohabbat wala",
      "kajra mohabbat waala",
      "kajra muhabbat wala",
      "kajra muhabbat waala",
      "kajraa mohabbat wala",
      "kajara mohabbat wala",
      "ankhiyo me aisa dala",
      "ankhiyon mein aisa dala",
      "kajre ne le li meri jaan"
    ]
  }
];

function findSaregamaSources(query: string, title: string) {
  const q = normalizeText(`${title || ""} ${query || ""}`);

  return SAREGAMA_SOURCES.filter(source => {
    return source.aliases.some(alias => {
      const a = normalizeText(alias);
      return q.includes(a) || a.includes(q);
    });
  });
}

function extractSaregamaLyricsFromText(pageText: string, expectedTitle: string) {
  const text = String(pageText || "");
  if (!text) return "";

  const markerCandidates = [
    `${expectedTitle} Song Lyrics`,
    `${expectedTitle} Hindi song lyrics`,
    "Song Lyrics"
  ];

  let startIndex = -1;
  let markerLength = 0;

  for (const marker of markerCandidates) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    const match = text.match(regex);

    if (match && match.index !== undefined) {
      startIndex = match.index;
      markerLength = match[0].length;
      break;
    }
  }

  if (startIndex === -1) {
    const titleRegex = new RegExp(expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const titleMatch = text.match(titleRegex);

    if (titleMatch && titleMatch.index !== undefined) {
      startIndex = titleMatch.index;
      markerLength = titleMatch[0].length;
    }
  }

  if (startIndex === -1) return "";

  let rest = text.slice(startIndex + markerLength);

  const endMarkers = [
    "About Saregama",
    "About Us",
    "Contact Us",
    "Carvaan",
    "Customer Service",
    "Sitemap",
    "Saregama E-waste",
    "Copyright",
    "Novex Communications",
    "Privacy Policy",
    "Terms of Use"
  ];

  let endIndex = rest.length;

  for (const marker of endMarkers) {
    const index = rest.toLowerCase().indexOf(marker.toLowerCase());
    if (index !== -1) endIndex = Math.min(endIndex, index);
  }

  rest = rest.slice(0, endIndex);

  const lines = rest
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(line => !/^lyrics:?$/i.test(line))
    .filter(line => !/^song lyrics$/i.test(line))
    .filter(line => !/^(play|download|listen|share|buy|set caller tune)/i.test(line))
    .filter(line => !/^(album|singer|music|lyricist|label|cast)\s*:/i.test(line))
    .filter(line => !/^#/.test(line))
    .filter(line => line.length > 1);

  const lyrics = cleanLyricsText(lines.join("\n"));

  if (lyrics.length < 30) return "";
  return lyrics.slice(0, 18000);
}

async function fetchSaregamaCandidates(input: { query: string; title: string }) {
  const sources = findSaregamaSources(input.query, input.title);
  const candidates: InternalCandidate[] = [];
  const attempts: unknown[] = [];

  for (const source of sources) {
    for (const url of source.urls) {
      const response = await safeText(url, 5500);

      const attempt: Record<string, unknown> = {
        url,
        status: response.status,
        ok: response.ok,
        length: response.length
      };

      if (!response.ok || !response.text) {
        attempt.reason = response.status_text || "empty_response";
        attempts.push(attempt);
        continue;
      }

      const pageText = stripHtmlToText(response.text);
      const lyrics = extractSaregamaLyricsFromText(pageText, source.title);

      attempt.parse_ok = !!lyrics;
      attempt.lyrics_length = lyrics.length;
      attempt.text_sample = pageText.slice(0, 220);
      attempts.push(attempt);

      if (!lyrics) continue;

      candidates.push({
        provider: "saregama",
        title: source.title,
        singer: source.singer,
        movie: source.movie,
        source_name: "Saregama",
        source_url: url,
        script: detectScript(lyrics),
        preview: buildPreview(lyrics),
        lyrics,
        status: "lyrics_ready"
      });

      break;
    }
  }

  return {
    candidates,
    debug: {
      matched_sources: sources.length,
      attempts,
      count: candidates.length
    }
  };
}

function mapLrclibRowToCandidate(row: Record<string, unknown>, fallbackTitle = "", fallbackSinger = "") {
  const title = String(row.trackName || row.track_name || fallbackTitle || "").trim();
  const singer = String(row.artistName || row.artist_name || fallbackSinger || "").trim();
  const movie = String(row.albumName || row.album_name || "").trim();

  const lyrics = cleanLyricsText(
    String(row.plainLyrics || row.plain_lyrics || row.syncedLyrics || row.synced_lyrics || "")
  );

  if (!title || !lyrics || lyrics.length < 20) return null;

  return {
    provider: "lrclib",
    title,
    singer,
    movie,
    source_name: "LRCLIB",
    source_url: "https://lrclib.net/",
    script: detectScript(lyrics),
    preview: buildPreview(lyrics),
    lyrics: lyrics.slice(0, 18000),
    status: "lyrics_ready"
  } as InternalCandidate;
}

async function fetchLrclibCandidates(input: { query: string; title: string; singer: string }) {
  const variants = buildQueryVariants(input);
  const urls: string[] = [];

  // Broad search. Best when user only types a title like "Koi Fariyaad".
  for (const variant of variants) {
    const qParams = new URLSearchParams();
    qParams.set("q", variant);
    urls.push(`https://lrclib.net/api/search?${qParams.toString()}`);
  }

  // Track search. Better when title is known.
  for (const variant of variants) {
    const trackParams = new URLSearchParams();
    trackParams.set("track_name", variant);
    if (input.singer) trackParams.set("artist_name", input.singer);
    urls.push(`https://lrclib.net/api/search?${trackParams.toString()}`);
  }

  // Direct get. Best when title + singer are known.
  if (input.title && input.singer) {
    const getParams = new URLSearchParams();
    getParams.set("track_name", input.title);
    getParams.set("artist_name", input.singer);
    urls.unshift(`https://lrclib.net/api/get?${getParams.toString()}`);
  }

  const results = await Promise.all(urls.map(url => safeJson(url, 4500)));

  const rows: Record<string, unknown>[] = [];

  for (const result of results) {
    if (Array.isArray(result)) {
      rows.push(...(result as Record<string, unknown>[]));
    } else if (result && typeof result === "object") {
      rows.push(result as Record<string, unknown>);
    }
  }

  const bestByKey = new Map<string, InternalCandidate>();

  for (const row of rows.slice(0, 80)) {
    const candidate = mapLrclibRowToCandidate(row, input.title, input.singer);
    if (!candidate) continue;

    const key = `${normalizeText(removeVersionNoise(candidate.title))}::${normalizeText(candidate.singer)}`;
    const existing = bestByKey.get(key);

    if (!existing || String(candidate.lyrics || "").length > String(existing.lyrics || "").length) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values()).slice(0, 12);
}

async function fetchOvhLyricsCandidates(input: { query: string; title: string }) {
  const variants = buildQueryVariants(input);

  const suggestResults = await Promise.all(
    variants.map(variant =>
      safeJson(`https://api.lyrics.ovh/suggest/${encodeURIComponent(variant)}`, 2600)
    )
  );

  const rows = suggestResults.flatMap(result =>
    Array.isArray((result as Record<string, unknown>)?.data)
      ? ((result as Record<string, unknown>).data as unknown[]).slice(0, 8)
      : []
  );

  const uniqueMeta = new Map<string, { title: string; singer: string; movie: string; source_url: string }>();

  for (const row of rows) {
    const safeRow = row as {
      title?: string;
      artist?: { name?: string };
      album?: { title?: string };
      link?: string;
    };

    const title = String(safeRow.title || "").trim();
    const singer = String(safeRow.artist?.name || "").trim();
    const movie = String(safeRow.album?.title || "").trim();
    const source_url = String(safeRow.link || "https://lyrics.ovh/").trim();

    if (!title || !singer) continue;

    const key = `${normalizeText(removeVersionNoise(title))}::${normalizeText(singer)}`;
    if (!uniqueMeta.has(key)) {
      uniqueMeta.set(key, { title, singer, movie, source_url });
    }
  }

  const candidates = await Promise.all(
    Array.from(uniqueMeta.values()).slice(0, 12).map(async meta => {
      const lyricsData = await safeJson(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(meta.singer)}/${encodeURIComponent(meta.title)}`,
        2800
      );

      const lyrics = cleanLyricsText(String((lyricsData as Record<string, unknown>)?.lyrics || ""));

      if (!lyrics || lyrics.length < 20) return null;

      return {
        provider: "ovh",
        title: meta.title,
        singer: meta.singer,
        movie: meta.movie,
        source_name: "lyrics.ovh",
        source_url: meta.source_url || "https://lyrics.ovh/",
        script: detectScript(lyrics),
        preview: buildPreview(lyrics),
        lyrics: lyrics.slice(0, 18000),
        status: "lyrics_ready"
      } as InternalCandidate;
    })
  );

  return candidates.filter(Boolean) as InternalCandidate[];
}

async function fetchOvhPossibleMatches(input: { query: string; title: string }) {
  const variants = buildQueryVariants(input);

  const suggestResults = await Promise.all(
    variants.map(variant =>
      safeJson(`https://api.lyrics.ovh/suggest/${encodeURIComponent(variant)}`, 2600)
    )
  );

  const rows = suggestResults.flatMap(result =>
    Array.isArray((result as Record<string, unknown>)?.data)
      ? ((result as Record<string, unknown>).data as unknown[]).slice(0, 8)
      : []
  );

  const bestByKey = new Map<string, InternalCandidate>();

  for (const row of rows) {
    const safeRow = row as {
      title?: string;
      artist?: { name?: string };
      album?: { title?: string };
      link?: string;
    };

    const title = String(safeRow.title || "").trim();
    const singer = String(safeRow.artist?.name || "").trim();
    const movie = String(safeRow.album?.title || "").trim();

    if (!title || !singer) continue;

    const candidate: InternalCandidate = {
      provider: "ovh",
      title,
      singer,
      movie,
      source_name: "lyrics.ovh",
      source_url: String(safeRow.link || "https://lyrics.ovh/"),
      script: "unknown",
      preview: "",
      lyrics: "",
      status: "metadata_only"
    };

    const key = `${normalizeText(removeVersionNoise(title))}::${normalizeText(singer)}`;

    if (!bestByKey.has(key)) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values()).slice(0, 12);
}

function dedupeCandidates(candidates: Candidate[]) {
  const bestByKey = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = `${normalizeText(removeVersionNoise(candidate.title))}::${normalizeText(candidate.singer)}`;
    const existing = bestByKey.get(key);

    if (
      !existing ||
      candidate.status === "lyrics_ready" && existing.status !== "lyrics_ready" ||
      candidate.confidence > existing.confidence ||
      candidate.preview.length > existing.preview.length
    ) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values());
}

function finalizeCandidate(candidate: InternalCandidate, confidence: number): Candidate {
  const safeCandidate: InternalCandidate = {
    ...candidate,
    preview: candidate.status === "lyrics_ready" ? buildPreview(candidate.lyrics || candidate.preview) : "",
    lyrics: candidate.status === "lyrics_ready" ? cleanLyricsText(candidate.lyrics || candidate.preview).slice(0, 18000) : ""
  };

  return {
    provider: safeCandidate.provider,
    title: safeCandidate.title,
    singer: safeCandidate.singer,
    movie: safeCandidate.movie,
    source_name: safeCandidate.source_name,
    source_url: safeCandidate.source_url,
    script: safeCandidate.script,
    preview: safeCandidate.preview,
    status: safeCandidate.status,
    confidence,
    lookup_key: makeLookupKey(safeCandidate)
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json()) as LookupBody;

    const query = String(body.query || `${body.title || ""} ${body.singer || ""} ${body.movie || ""}`).trim();
    const title = String(body.title || "").trim();
    const singer = String(body.singer || "").trim();

    const limit = Math.max(1, Math.min(Number(body.limit || 6), 8));

    const preferredScripts = Array.isArray(body.preferredScripts) && body.preferredScripts.length
      ? body.preferredScripts.map(String)
      : ["gujarati", "devanagari", "romanized", "english"];

    if (!query || normalizeText(query).length < 2) {
      return json({
        build_id: BUILD_ID,
        candidates: [],
        debug: {
          query,
          reason: "query_too_short",
          returned_count: 0
        }
      });
    }

    const [saregamaResult, lrclibResult, ovhLyricsResult, ovhPossibleResult] = await Promise.all([
      fetchSaregamaCandidates({ query, title }),
      fetchLrclibCandidates({ query, title, singer }),
      fetchOvhLyricsCandidates({ query, title }),
      fetchOvhPossibleMatches({ query, title })
    ]);

    const lyricsReady = [
      ...saregamaResult.candidates,
      ...lrclibResult,
      ...ovhLyricsResult
    ]
      .filter(candidate => cleanLyricsText(candidate.lyrics || candidate.preview).length >= 20)
      .map(candidate => finalizeCandidate(
        {
          ...candidate,
          status: "lyrics_ready"
        },
        scoreLyricsReadyCandidate(candidate, query, title, singer, preferredScripts)
      ))
      .filter(candidate => candidate.confidence >= 18);

    const readyKeys = new Set(
      lyricsReady.map(candidate =>
        `${normalizeText(removeVersionNoise(candidate.title))}::${normalizeText(candidate.singer)}`
      )
    );

    const possibleMatches = ovhPossibleResult
      .filter(candidate => {
        const key = `${normalizeText(removeVersionNoise(candidate.title))}::${normalizeText(candidate.singer)}`;
        return !readyKeys.has(key);
      })
      .map(candidate => finalizeCandidate(
        {
          ...candidate,
          status: "metadata_only",
          preview: "",
          lyrics: ""
        },
        scoreMetadataOnlyCandidate(candidate, query, title, singer)
      ))
      .filter(candidate => candidate.confidence >= 20)
      .sort((a, b) => b.confidence - a.confidence);

    const merged = dedupeCandidates([
      ...lyricsReady.sort((a, b) => b.confidence - a.confidence),
      ...possibleMatches
    ]).slice(0, limit);

    return json({
      build_id: BUILD_ID,
      candidates: merged,
      debug: {
        query,
        title,
        saregama_count: saregamaResult.candidates.length,
        lrclib_count: lrclibResult.length,
        ovh_lyrics_count: ovhLyricsResult.length,
        ovh_possible_count: ovhPossibleResult.length,
        lyrics_ready_count: lyricsReady.length,
        metadata_only_count: possibleMatches.length,
        returned_count: merged.length,
        providers_enabled: ["saregama", "lrclib", "ovh"]
      }
    });
  } catch (error) {
    return json({
      build_id: BUILD_ID,
      error: "lookup_failed",
      message: String((error as Error)?.message || error || "Unknown error")
    }, 500);
  }
});
