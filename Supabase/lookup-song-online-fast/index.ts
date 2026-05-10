const BUILD_ID = "lookup-2026-04-29-fast-priority-v8";
const APP_USER_AGENT = "MehfilLyrics/1.0 contact:mehfil-app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type Provider = "saregama" | "lrclib";
type CandidateStatus = "lyrics_ready" | "metadata_only";
type ScriptType = "gujarati" | "devanagari" | "romanized" | "english" | "mixed" | "unknown";

type LookupBody = {
  query?: string;
  title?: string;
  singer?: string;
  movie?: string;
  limit?: number;
  preferredScripts?: string[];
  deep?: boolean;
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

const SPELLING_GROUPS = [
  ["mohabbat", "mahobbat", "mohobbat", "muhabbat", "mahabbat", "mohabat", "muhabat", "mahobat", "mohobat"],
  ["fariyaad", "fariyad", "faryaad", "faryad", "fariyadh", "faryadh"],
  ["wala", "waala", "vala", "vaala"],
  ["pyaar", "pyar", "piyar", "piyaar"],
  ["yaad", "yad"],
  ["aankhiyon", "ankhiyon", "ankhiyo", "aankhiyo", "ankhio"],
  ["kajra", "kajara", "kajraa"],
  ["darna", "darana"],
  ["kiya", "kia", "kiyaa"],
  ["huzoor", "huzur", "hujoor", "hazoor"],
  ["tumko", "tum ko"],
  ["koi", "koyi"],
  ["aao", "ao"]
];

const WEAK_WORDS = new Set([
  "the", "a", "an", "song", "lyrics", "lyric",
  "ka", "ki", "ke", "ko", "se", "me", "mein", "to", "ho", "hai", "hain", "na"
]);

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
      "kajra mahobbat wala",
      "kajra mohobbat wala",
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
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
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

function getLrclibLyrics(row: Record<string, unknown>) {
  return cleanLyricsText(
    String(
      row.plainLyrics ||
      row.plain_lyrics ||
      row.syncedLyrics ||
      row.synced_lyrics ||
      ""
    )
  );
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
    .replace(/\bslowed\b/gi, " ")
    .replace(/\breverb\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisyVersionTitle(title: string) {
  return /\b(lofi|lo-fi|trap|remix|cover|single|viral|dj|construction|karaoke|instrumental|slowed|reverb)\b/i
    .test(String(title || ""));
}

function canonicalizeCommonSongSpellings(value: string) {
  let out = normalizeText(removeVersionNoise(value || ""))
    .replace(/\blyrics?\b/g, " ")
    .replace(/\bsong\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const group of SPELLING_GROUPS) {
    const canonical = group[0];

    for (const spelling of group) {
      out = out.replace(new RegExp(`\\b${spelling}\\b`, "g"), canonical);
    }
  }

  return out.replace(/\s+/g, " ").trim();
}

function normalizeSongLoose(text: string) {
  return canonicalizeCommonSongSpellings(text)
    .replace(/aa/g, "a")
    .replace(/ii/g, "i")
    .replace(/ee/g, "i")
    .replace(/uu/g, "u")
    .replace(/oo/g, "u")
    .replace(/ai/g, "e")
    .replace(/au/g, "o")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/chh/g, "ch")
    .replace(/jh/g, "j")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/sh/g, "s")
    .replace(/v/g, "w")
    .replace(/q/g, "k")
    .replace(/z/g, "j")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPhoneticKey(text: string) {
  return normalizeSongLoose(text)
    .replace(/[aeiou]+/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, "");
}

function getStrongWords(text: string) {
  return canonicalizeCommonSongSpellings(text)
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 2 && !WEAK_WORDS.has(word));
}

function getStrongWordCoverage(wantedTitle: string, rowTitle: string) {
  const wantedWords = getStrongWords(wantedTitle);
  const rowWords = new Set(getStrongWords(rowTitle));

  let hits = 0;

  for (const word of wantedWords) {
    if (rowWords.has(word)) hits++;
  }

  return {
    hits,
    total: wantedWords.length,
    coverage: wantedWords.length ? hits / wantedWords.length : 0
  };
}

function isAcceptableLrclibTitleMatch(rowTitle: string, wantedTitle: string) {
  const rowCanonical = canonicalizeCommonSongSpellings(rowTitle);
  const wantedCanonical = canonicalizeCommonSongSpellings(wantedTitle);

  if (!rowCanonical || !wantedCanonical) return false;

  if (rowCanonical === wantedCanonical) return true;

  if (
    rowCanonical.length >= 5 &&
    wantedCanonical.length >= 5 &&
    (rowCanonical.includes(wantedCanonical) || wantedCanonical.includes(rowCanonical))
  ) {
    return true;
  }

  const rowLoose = normalizeSongLoose(rowTitle);
  const wantedLoose = normalizeSongLoose(wantedTitle);

  if (rowLoose && wantedLoose && rowLoose === wantedLoose) return true;

  const rowCompact = compactPhoneticKey(rowTitle);
  const wantedCompact = compactPhoneticKey(wantedTitle);

  if (
    rowCompact &&
    wantedCompact &&
    wantedCompact.length >= 4 &&
    rowCompact === wantedCompact
  ) {
    return true;
  }

  const coverage = getStrongWordCoverage(wantedTitle, rowTitle);

  if (coverage.total <= 1) return true;

  if (coverage.total === 2) {
    return coverage.hits >= 2;
  }

  if (coverage.total === 3) {
    return coverage.hits >= 2;
  }

  return coverage.hits >= 3 && coverage.coverage >= 0.65;
}

function expandCommonIndianSongSpellings(value: string) {
  const base = normalizeText(value)
    .replace(/\blyrics?\b/g, " ")
    .replace(/\bsong\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const variants = new Set<string>();

  if (!base) return [];

  variants.add(base);

  for (const group of SPELLING_GROUPS) {
    const currentVariants = Array.from(variants);

    for (const current of currentVariants) {
      for (const from of group) {
        const pattern = new RegExp(`\\b${from}\\b`, "g");

        if (!pattern.test(current)) continue;

        for (const to of group) {
          variants.add(current.replace(pattern, to));
        }
      }
    }
  }

  return Array.from(variants)
    .map(v => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 32);
}

function buildLrclibQueryVariants(input: { query: string; title: string; singer: string }) {
  const query = normalizeText(input.query || "");
  const title = normalizeText(input.title || "");
  const singer = normalizeText(input.singer || "");

  const source = title || query;
  const words = source.split(/\s+/).filter(Boolean);
  const strongWords = getStrongWords(source);

  const variants = new Set<string>();

  function add(value: string) {
    const clean = normalizeText(value)
      .replace(/\blyrics?\b/g, " ")
      .replace(/\bsong\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) return;

    variants.add(clean);

    const canonical = canonicalizeCommonSongSpellings(clean);
    if (canonical) variants.add(canonical);

    const loose = normalizeSongLoose(clean);
    if (loose) variants.add(loose);

    expandCommonIndianSongSpellings(clean).forEach(v => variants.add(v));
    expandCommonIndianSongSpellings(canonical).forEach(v => variants.add(v));
  }

  add(source);
  add(query);

  if (title && singer) add(`${title} ${singer}`);
  if (query && singer) add(`${query} ${singer}`);

  if (words.length >= 2) {
    add(words.slice(0, 2).join(" "));
    add(words.slice(0, 3).join(" "));
    add(words.slice(-2).join(" "));
    add(`${words[0]} ${words[words.length - 1]}`);
  }

  if (strongWords.length >= 2) {
    add(strongWords.slice(0, 2).join(" "));
    add(strongWords.slice(0, 3).join(" "));
    add(strongWords.slice(-2).join(" "));
    add(`${strongWords[0]} ${strongWords[strongWords.length - 1]}`);
  }

  return Array.from(variants)
    .map(v => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 14);
}

function getLyricsLengthScore(lyrics: string) {
  const length = cleanLyricsText(lyrics).length;

  let score = 0;

  if (length >= 80) score += 5;
  if (length >= 180) score += 6;
  if (length >= 350) score += 7;
  if (length >= 650) score += 7;
  if (length >= 1000) score += 4;
  if (length >= 1600) score += 2;

  if (length > 6000) score -= 8;

  return Math.max(0, Math.min(score, 30));
}

function scriptPreferenceScore(script: ScriptType, preferredScripts: string[]) {
  if (script === "devanagari") return 32;
  if (script === "gujarati") return 28;
  if (script === "mixed") return 18;
  if (script === "romanized") return 4;
  if (script === "english") return 0;
  return 0;
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

async function safeJson(url: string, timeoutMs = 3000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": APP_USER_AGENT
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 250 + attempt * 250));
          continue;
        }
        return null;
      }

      const data = await response.json().catch(() => null);

      if (!data && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 + attempt * 250));
        continue;
      }

      return data;
    } catch {
      clearTimeout(timeout);

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 + attempt * 250));
        continue;
      }

      return null;
    }
  }

  return null;
}

async function safeText(url: string, timeoutMs = 5200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml,text/plain",
        "User-Agent": APP_USER_AGENT
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

function findSaregamaSources(query: string, title: string) {
  const inputRaw = normalizeText(`${title || ""} ${query || ""}`);
  const inputCanonical = canonicalizeCommonSongSpellings(`${title || ""} ${query || ""}`);
  const inputLoose = normalizeSongLoose(`${title || ""} ${query || ""}`);

  return SAREGAMA_SOURCES.filter(source => {
    const sourceValues = [
      source.title,
      ...source.aliases
    ];

    return sourceValues.some(value => {
      const aliasRaw = normalizeText(value);
      const aliasCanonical = canonicalizeCommonSongSpellings(value);
      const aliasLoose = normalizeSongLoose(value);

      return (
        inputRaw.includes(aliasRaw) ||
        aliasRaw.includes(inputRaw) ||
        inputCanonical.includes(aliasCanonical) ||
        aliasCanonical.includes(inputCanonical) ||
        inputLoose.includes(aliasLoose) ||
        aliasLoose.includes(inputLoose)
      );
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

function scoreLrclibRow(
  row: Record<string, unknown>,
  input: { query: string; title: string; singer: string; movie?: string }
) {
  const rowTitle = String(row.trackName || row.track_name || "").trim();
  const rowSinger = String(row.artistName || row.artist_name || "").trim();
  const rowAlbum = String(row.albumName || row.album_name || "").trim();
  const lyrics = getLrclibLyrics(row);

  if (!rowTitle || !lyrics || lyrics.length < 20) return 0;

  const wantedTitle = input.title || input.query || "";
  const wantedSinger = input.singer || "";
  const wantedMovie = input.movie || "";

  const rowTitleNorm = normalizeText(removeVersionNoise(rowTitle));
  const wantedTitleNorm = normalizeText(removeVersionNoise(wantedTitle));

  const rowTitleCanonical = canonicalizeCommonSongSpellings(rowTitle);
  const wantedTitleCanonical = canonicalizeCommonSongSpellings(wantedTitle);

  const rowTitleLoose = normalizeSongLoose(rowTitle);
  const wantedTitleLoose = normalizeSongLoose(wantedTitle);

  const rowCompact = compactPhoneticKey(rowTitle);
  const wantedCompact = compactPhoneticKey(wantedTitle);

  const wantedStrongWords = getStrongWords(wantedTitle);
  const rowCanonicalWords = new Set(rowTitleCanonical.split(/\s+/).filter(Boolean));

  let strongHits = 0;
  for (const word of wantedStrongWords) {
    if (rowCanonicalWords.has(word)) strongHits++;
  }

  let score = 0;

  if (rowTitleNorm === wantedTitleNorm && wantedTitleNorm) score += 48;
  if (rowTitleCanonical && rowTitleCanonical === wantedTitleCanonical) score += 45;
  if (rowTitleLoose && rowTitleLoose === wantedTitleLoose) score += 38;
  if (rowCompact && wantedCompact && rowCompact === wantedCompact) score += 32;

  if (rowTitleNorm.includes(wantedTitleNorm) || wantedTitleNorm.includes(rowTitleNorm)) {
    score += 18;
  }

  if (rowTitleCanonical.includes(wantedTitleCanonical) || wantedTitleCanonical.includes(rowTitleCanonical)) {
    score += 18;
  }

  score += Math.round(tokenOverlapScore(wantedTitle, rowTitle) * 32);
  score += Math.round(tokenOverlapScore(input.query, rowTitle) * 20);

  if (wantedStrongWords.length >= 2) {
    const coverage = strongHits / wantedStrongWords.length;
    score += Math.round(coverage * 30);
  }

  if (wantedSinger) {
    score += Math.round(tokenOverlapScore(wantedSinger, rowSinger) * 24);
  }

  if (wantedMovie) {
    score += Math.round(tokenOverlapScore(wantedMovie, rowAlbum) * 14);
  }

  score += getLyricsLengthScore(lyrics);

  if (isNoisyVersionTitle(rowTitle) && !isNoisyVersionTitle(wantedTitle)) {
    score -= 22;
  }

  const lowerTitle = rowTitle.toLowerCase();

  if (/\bkaraoke\b/i.test(lowerTitle)) score -= 30;
  if (/\binstrumental\b/i.test(lowerTitle)) score -= 30;
  if (/\bslowed\b/i.test(lowerTitle)) score -= 18;
  if (/\breverb\b/i.test(lowerTitle)) score -= 18;

  return Math.max(0, Math.min(score, 100));
}

async function fetchLrclibCandidates(
  input: { query: string; title: string; singer: string; movie?: string },
  options: { timeoutMs?: number; urlLimit?: number; retries?: number } = {}
) {
  const variants = buildLrclibQueryVariants(input);
  const urls: string[] = [];

  for (const variant of variants) {
    const qParams = new URLSearchParams();
    qParams.set("q", variant);
    urls.push(`https://lrclib.net/api/search?${qParams.toString()}`);
  }

  function addExactTitleSearch(value: string) {
  const clean = normalizeText(value);
  if (!clean) return;

  const exactParams = new URLSearchParams();
  exactParams.set("track_name", clean);

  if (input.singer) {
    exactParams.set("artist_name", input.singer);
  }

  urls.unshift(`https://lrclib.net/api/search?${exactParams.toString()}`);
}

const exactTitleSource = input.title || input.query;
addExactTitleSearch(exactTitleSource);

const canonicalExactTitle = canonicalizeCommonSongSpellings(exactTitleSource);
if (canonicalExactTitle && canonicalExactTitle !== normalizeText(exactTitleSource)) {
  addExactTitleSearch(canonicalExactTitle);
}

  const uniqueUrls = Array.from(new Set(urls)).slice(0, options.urlLimit || 10);

const results = await Promise.allSettled(
  uniqueUrls.map(url => safeJson(url, options.timeoutMs || 2600, options.retries || 0))
);

  const rows = results.flatMap(result => {
    if (result.status !== "fulfilled") return [];
    return Array.isArray(result.value) ? result.value : [];
  });

  const bestByKey = new Map<string, { candidate: InternalCandidate; score: number; lyricsLength: number }>();

const debug: LrclibDebug = {
  variants,
  urls: uniqueUrls,
  raw_rows_count: rows.length,
  inspected_rows: 0,
  rejected_missing_title_or_lyrics: 0,
  rejected_title_gate: 0,
  rejected_low_score: 0,
  accepted_rows: 0,
  sample_rows: [] as unknown[]
};

  for (const row of rows.slice(0, 120)) {
    const safeRow = row as Record<string, unknown>;

    const title = String(safeRow.trackName || safeRow.track_name || "").trim();
    const singer = String(safeRow.artistName || safeRow.artist_name || "").trim();
    const movie = String(safeRow.albumName || safeRow.album_name || "").trim();
    const lyrics = getLrclibLyrics(safeRow);

    debug.inspected_rows++;

if (debug.sample_rows.length < 12) {
  debug.sample_rows.push({
    title,
    singer,
    movie,
    lyrics_length: lyrics.length,
    plainLyrics_length: String(safeRow.plainLyrics || safeRow.plain_lyrics || "").length,
    syncedLyrics_length: String(safeRow.syncedLyrics || safeRow.synced_lyrics || "").length
  });
}

if (!title || !lyrics || lyrics.length < 20) {
  debug.rejected_missing_title_or_lyrics++;
  continue;
}

const wantedTitleForGate = input.title || input.query;

if (!isAcceptableLrclibTitleMatch(title, wantedTitleForGate)) {
  debug.rejected_title_gate++;
  continue;
}

const score = scoreLrclibRow(safeRow, input);

if (score < 24) {
  debug.rejected_low_score++;
  continue;
}

debug.accepted_rows++;

    const id = String(safeRow.id || "").trim();
    const key = id
      ? `id:${id}`
      : `${canonicalizeCommonSongSpellings(title)}::${normalizeText(singer)}::${normalizeText(movie)}::${lyrics.slice(0, 80)}`;

    const candidate: InternalCandidate = {
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
    };

    const existing = bestByKey.get(key);
    const lyricsLength = lyrics.length;

    if (
      !existing ||
      score > existing.score ||
      (score === existing.score && lyricsLength > existing.lyricsLength)
    ) {
      bestByKey.set(key, {
        candidate,
        score,
        lyricsLength
      });
    }
  }

  const candidates = Array.from(bestByKey.values())
  .sort((a, b) => b.score - a.score || b.lyricsLength - a.lyricsLength)
  .map(row => row.candidate)
  .slice(0, 12);

return {
  candidates,
  debug: {
    ...debug,
    final_candidates_count: candidates.length
  }
};
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

  const candidateCanonicalTitle = canonicalizeCommonSongSpellings(candidate.title);
  const queryCanonicalTitle = canonicalizeCommonSongSpellings(title || query);

  const candidateLooseTitle = normalizeSongLoose(candidate.title);
  const queryLooseTitle = normalizeSongLoose(title || query);

  const candidateCompact = compactPhoneticKey(candidate.title);
  const queryCompact = compactPhoneticKey(title || query);

  let score = 0;

  if (candidateTitle === t || cleanCandidateTitle === cleanQueryTitle) score += 36;
  if (candidateCanonicalTitle && candidateCanonicalTitle === queryCanonicalTitle) score += 34;
  if (candidateLooseTitle && candidateLooseTitle === queryLooseTitle) score += 28;
  if (candidateCompact && candidateCompact === queryCompact) score += 22;

  if (candidateTitle.includes(t) || t.includes(candidateTitle)) score += 16;
  if (candidateCanonicalTitle.includes(queryCanonicalTitle) || queryCanonicalTitle.includes(candidateCanonicalTitle)) score += 16;

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
  if (candidate.provider === "lrclib") score += 14;

  if (isNoisyVersionTitle(candidate.title) && !isNoisyVersionTitle(query)) {
    score -= 18;
  }

  return Math.max(0, Math.min(score, 100));
}

function dedupeCandidates(candidates: Candidate[]) {
  const bestByKey = new Map<string, Candidate>();

  for (const candidate of candidates) {
    let lyricsKey = "";

    try {
      const parsed = JSON.parse(candidate.lookup_key || "{}");
      lyricsKey = cleanLyricsText(parsed.lyrics || candidate.preview || "")
        .slice(0, 160)
        .toLowerCase();
    } catch {
      lyricsKey = cleanLyricsText(candidate.preview || "")
        .slice(0, 160)
        .toLowerCase();
    }

    const key = [
      candidate.provider,
      canonicalizeCommonSongSpellings(candidate.title),
      normalizeText(candidate.singer),
      normalizeText(candidate.movie),
      lyricsKey
    ].join("::");

    const existing = bestByKey.get(key);

    if (!existing) {
      bestByKey.set(key, candidate);
      continue;
    }

    const candidateLength = getLyricsLengthFromLookupKey(candidate);
    const existingLength = getLyricsLengthFromLookupKey(existing);

    if (
      candidate.confidence > existing.confidence ||
      candidateLength > existingLength
    ) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => {
  const scriptRank = {
    devanagari: 5,
    gujarati: 4,
    mixed: 3,
    romanized: 2,
    english: 1,
    unknown: 0
  };

  const scriptDiff =
    (scriptRank[b.script] || 0) - (scriptRank[a.script] || 0);

  if (scriptDiff !== 0) return scriptDiff;

  const confidenceDiff = b.confidence - a.confidence;
  const lengthDiff = getLyricsLengthFromLookupKey(b) - getLyricsLengthFromLookupKey(a);

  return confidenceDiff || lengthDiff;
});
}

function finalizeCandidate(candidate: InternalCandidate, confidence: number): Candidate {
  const lyrics = cleanLyricsText(candidate.lyrics || candidate.preview).slice(0, 18000);

  const safeCandidate: InternalCandidate = {
    ...candidate,
    preview: candidate.status === "lyrics_ready" ? buildPreview(lyrics) : "",
    lyrics: candidate.status === "lyrics_ready" ? lyrics : ""
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

function getLyricsLengthFromLookupKey(candidate: Candidate) {
  try {
    return cleanLyricsText(JSON.parse(candidate.lookup_key || "{}")?.lyrics || candidate.preview || "").length;
  } catch {
    return cleanLyricsText(candidate.preview || "").length;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as LookupBody;

    const query = String(body.query || `${body.title || ""} ${body.singer || ""} ${body.movie || ""}`).trim();
    const title = String(body.title || "").trim();
    const singer = String(body.singer || "").trim();
    const movie = String(body.movie || "").trim();

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

    const lrclibVariants = buildLrclibQueryVariants({ query, title, singer });
    const hasSaregamaMatch = findSaregamaSources(query, title).length > 0;

    let [saregamaResult, lrclibResult] = await Promise.all([
  hasSaregamaMatch
    ? fetchSaregamaCandidates({ query, title })
    : Promise.resolve({
        candidates: [],
        debug: {
          matched_sources: 0,
          attempts: [],
          count: 0
        }
      }),
  fetchLrclibCandidates({ query, title, singer, movie })
]);

if (body.deep === true && lrclibResult.candidates.length < limit) {
  const secondPass = await fetchLrclibCandidates(
    { query, title, singer, movie },
    {
      timeoutMs: 6500,
      urlLimit: 14,
      retries: 2
    }
  );

  if (secondPass.candidates.length > lrclibResult.candidates.length) {
    lrclibResult = {
      candidates: secondPass.candidates,
      debug: {
        ...secondPass.debug,
        second_pass_used: true,
        first_pass_count: lrclibResult.candidates.length
      }
    };
  }
}


const lyricsReady = [
  ...saregamaResult.candidates,
  ...lrclibResult.candidates
]
      .filter(candidate => cleanLyricsText(candidate.lyrics || candidate.preview).length >= 20)
      .map(candidate => finalizeCandidate(
        {
          ...candidate,
          status: "lyrics_ready"
        },
        scoreLyricsReadyCandidate(candidate, query, title, singer, preferredScripts)
      ))
      .filter(candidate => candidate.confidence >= 18)
     .sort((a, b) => {
  const confidenceDiff = b.confidence - a.confidence;
  const lengthDiff = getLyricsLengthFromLookupKey(b) - getLyricsLengthFromLookupKey(a);

  if (Math.abs(confidenceDiff) <= 5 && lengthDiff !== 0) {
    return lengthDiff;
  }

  return confidenceDiff || lengthDiff;
});

    const merged = dedupeCandidates(lyricsReady).slice(0, limit);

    return json({
      build_id: BUILD_ID,
      candidates: merged,
      debug: {
        query,
        title,
        singer,
        movie,
        lrclib_variants: lrclibVariants,
        saregama_count: saregamaResult.candidates.length,
       lrclib_count: lrclibResult.candidates.length,
        lrclib_debug: lrclibResult.debug,
        lyrics_ready_count: merged.filter(candidate => candidate.status === "lyrics_ready").length,
        metadata_only_count: 0,
        returned_count: merged.length,
        providers_enabled: ["lrclib", "saregama"],
        ovh_disabled: true,
        reason: merged.length
          ? "Lyrics-ready result found from LRCLIB/Saregama."
          : "No lyrics-ready result found from LRCLIB/Saregama. OVH intentionally disabled because it mostly returns metadata without lyrics."
      }
    });
  } catch (error) {
    console.error("lookup-song-online-fast crash", error);

    return json({
      build_id: BUILD_ID,
      candidates: [],
      error: "lookup_failed",
      message: String((error as Error)?.message || error || "Unknown error")
    }, 200);
  }
});
