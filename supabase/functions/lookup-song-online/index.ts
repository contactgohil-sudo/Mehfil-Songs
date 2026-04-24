const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type LookupBody = {
  query?: string;
  title?: string;
  singer?: string;
  movie?: string;
  limit?: number;
  preferredScripts?: string[];
};

type WebEvidence = {
  title: string;
  content: string;
  url: string;
};

type Candidate = {
  import_key: string;
  title: string;
  singer: string;
  movie: string;
  lyrics: string;
  source_name: string;
  source_url: string;
  confidence: number;
  script: "gujarati" | "devanagari" | "romanized" | "english" | "mixed" | "unknown";
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
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
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenize(text: string) {
  return normalizeText(text).split(/\s+/).filter(Boolean);
}

function tokenOverlapScore(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (!aTokens.size || !bTokens.size) return 0;

  let matches = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) matches++;
  }

  return matches / Math.max(aTokens.size, bTokens.size);
}

function containsLoose(haystack: string, needle: string) {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  return !!n && h.includes(n);
}

function detectScript(text: string): Candidate["script"] {
  const value = String(text || "");

  const hasGujarati = /[\u0A80-\u0AFF]/.test(value);
  const hasDevanagari = /[\u0900-\u097F]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);

  if (hasGujarati && !hasDevanagari && !hasLatin) return "gujarati";
  if (hasDevanagari && !hasGujarati && !hasLatin) return "devanagari";
  if ((hasGujarati || hasDevanagari) && hasLatin) return "mixed";

  if (hasLatin) {
    const romanIndicHints = [
      "hai", "ho", "mera", "meri", "tere", "tum", "dil", "chhe", "che", "tari",
      "mane", "mara", "nathi", "kem", "shu", "tu", "ke", "ne", "aa", "yaar"
    ];
    const norm = normalizeText(value);
    const hits = romanIndicHints.filter(word => norm.includes(word)).length;
    return hits >= 2 ? "romanized" : "english";
  }

  return "unknown";
}

function scriptPreferenceScore(script: Candidate["script"], preferredScripts: string[]) {
  const order = Array.isArray(preferredScripts) && preferredScripts.length
    ? preferredScripts
    : ["gujarati", "devanagari", "romanized", "english"];

  const index = order.indexOf(script);
  if (index === -1) return 2;

  const weights = [12, 10, 8, 5];
  return weights[index] ?? 2;
}

function completenessScore(lyrics: string) {
  const text = cleanLyricsText(lyrics);
  const lines = text.split("\n").filter(Boolean).length;
  const length = text.length;

  let score = 0;
  if (length >= 180) score += 4;
  if (length >= 400) score += 4;
  if (length >= 700) score += 3;
  if (lines >= 8) score += 2;
  if (lines >= 14) score += 2;

  return Math.min(score, 15);
}

function trustedEvidenceDomain(url: string) {
  const value = String(url || "").toLowerCase();

  if (value.includes("genius.com")) return 6;
  if (value.includes("gaana.com")) return 6;
  if (value.includes("smule.com")) return 5;
  if (value.includes("jiosaavn.com")) return 6;
  if (value.includes("wynk.in")) return 5;
  if (value.includes("youtube.com")) return 2;

  return 0;
}

function evidenceScore(candidate: Candidate, evidence: WebEvidence[]) {
  if (!evidence.length) return 0;

  const title = normalizeText(candidate.title);
  const singer = normalizeText(candidate.singer);

  let best = 0;

  for (const row of evidence) {
    const haystack = normalizeText(`${row.title} ${row.content} ${row.url}`);
    let score = 0;

    if (title && haystack.includes(title)) score += 10;
    if (singer && haystack.includes(singer)) score += 6;
    score += trustedEvidenceDomain(row.url);

    if (score > best) best = score;
  }

  return Math.min(best, 18);
}

function scoreCandidate(
  candidate: Candidate,
  input: { query: string; title: string; singer: string; preferredScripts: string[]; evidence: WebEvidence[] }
) {
  const inputTitle = normalizeText(input.title || input.query);
  const inputSinger = normalizeText(input.singer || "");
  const query = normalizeText(input.query);

  let score = 0;

  const titleOverlap = tokenOverlapScore(inputTitle || query, candidate.title);
  const singerOverlap = inputSinger ? tokenOverlapScore(inputSinger, candidate.singer) : 0;
  const queryVsTitle = tokenOverlapScore(query, candidate.title);
  const queryVsSinger = tokenOverlapScore(query, candidate.singer);

  score += Math.round(titleOverlap * 38);
  score += Math.round(singerOverlap * 24);
  score += Math.round(queryVsTitle * 12);
  score += Math.round(queryVsSinger * 6);

  if (containsLoose(candidate.title, input.title || input.query)) score += 8;
  if (inputSinger && containsLoose(candidate.singer, input.singer)) score += 6;

  score += completenessScore(candidate.lyrics);
  score += scriptPreferenceScore(candidate.script, input.preferredScripts);
  score += evidenceScore(candidate, input.evidence);

  if (candidate.source_name === "LRCLIB") score += 8;
  if (candidate.source_name === "lyrics.ovh") score += 5;

  if (candidate.lyrics.length < 80) score -= 12;
  if (!candidate.title) score -= 20;
  if (!candidate.lyrics) score -= 30;

  return Math.max(0, Math.min(score, 100));
}

async function safeJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) return null;

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapLrclibRow(row: Record<string, unknown>): Candidate | null {
  const title = String(row.trackName || row.track_name || "").trim();
  const singer = String(row.artistName || row.artist_name || "").trim();
  const movie = String(row.albumName || row.album_name || "").trim();
  const lyrics = cleanLyricsText(String(row.plainLyrics || row.syncedLyrics || ""));

  if (!title || !lyrics) return null;

  return {
    import_key: `lrclib:${String(row.id || `${title}:${singer}`)}`,
    title,
    singer,
    movie,
    lyrics,
    source_name: "LRCLIB",
    source_url: "https://lrclib.net/",
    confidence: 0,
    script: detectScript(lyrics)
  };
}

async function fetchLrclibCandidates(input: { query: string; title: string; singer: string }) {
  const urls: string[] = [];

  if (input.title) {
    const params = new URLSearchParams();
    params.set("track_name", input.title);
    if (input.singer) params.set("artist_name", input.singer);
    urls.push(`https://lrclib.net/api/search?${params.toString()}`);
  }

  if (input.query) {
    const qParams = new URLSearchParams();
    qParams.set("q", input.query);
    urls.push(`https://lrclib.net/api/search?${qParams.toString()}`);

    const trackParams = new URLSearchParams();
    trackParams.set("track_name", input.query);
    urls.push(`https://lrclib.net/api/search?${trackParams.toString()}`);
  }

  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const url of urls) {
    const data = await safeJson(url);
    if (!Array.isArray(data)) continue;

    for (const row of data) {
      const mapped = mapLrclibRow(row);
      if (!mapped) continue;

      const key = `${normalizeText(mapped.title)}::${normalizeText(mapped.singer)}`;
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(mapped);
    }
  }

  return out.slice(0, 8);
}

async function fetchLyricsOvhCandidates(input: { query: string }) {
  const suggest = await safeJson(`https://api.lyrics.ovh/suggest/${encodeURIComponent(input.query)}`);
  const rows = Array.isArray(suggest?.data) ? suggest.data.slice(0, 6) : [];
  const out: Candidate[] = [];

  for (const row of rows) {
    const title = String(row?.title || "").trim();
    const singer = String(row?.artist?.name || "").trim();
    const movie = String(row?.album?.title || "").trim();

    if (!title || !singer) continue;

    const lyricsData = await safeJson(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(singer)}/${encodeURIComponent(title)}`
    );

    const lyrics = cleanLyricsText(String(lyricsData?.lyrics || ""));
    if (!lyrics) continue;

    out.push({
      import_key: `ovh:${normalizeText(title)}:${normalizeText(singer)}`,
      title,
      singer,
      movie,
      lyrics,
      source_name: "lyrics.ovh",
      source_url: "https://lyrics.ovh/",
      confidence: 0,
      script: detectScript(lyrics)
    });
  }

  return out;
}

async function fetchTavilyEvidence(query: string) {
  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) return [] as WebEvidence[];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${query} song lyrics`,
      topic: "general",
      search_depth: "basic",
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
      include_images: false
    })
  });

  if (!response.ok) return [];

  const data = await response.json();
  const rows = Array.isArray(data?.results) ? data.results : [];

  return rows.map((row: Record<string, unknown>) => ({
    title: String(row.title || ""),
    content: String(row.content || ""),
    url: String(row.url || "")
  }));
}

function dedupeAndSort(
  candidates: Candidate[],
  input: { query: string; title: string; singer: string; preferredScripts: string[]; evidence: WebEvidence[]; limit: number }
) {
  const bestByKey = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = `${normalizeText(candidate.title)}::${normalizeText(candidate.singer)}`;
    candidate.confidence = scoreCandidate(candidate, input);

    const existing = bestByKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values())
    .filter(item => item.confidence >= 20)
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
    .slice(0, input.limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as LookupBody;

    const query = String(body.query || `${body.title || ""} ${body.singer || ""} ${body.movie || ""}`).trim();
    const title = String(body.title || "").trim();
    const singer = String(body.singer || "").trim();
    const preferredScripts = Array.isArray(body.preferredScripts) && body.preferredScripts.length
      ? body.preferredScripts.map(String)
      : ["gujarati", "devanagari", "romanized", "english"];
    const limit = Math.max(1, Math.min(Number(body.limit || 8), 10));

    if (!query || normalizeText(query).length < 2) {
      return json({ candidates: [] });
    }

    const evidence = await fetchTavilyEvidence(query);

    const [lrclibCandidates, ovhCandidates] = await Promise.all([
      fetchLrclibCandidates({ query, title, singer }),
      fetchLyricsOvhCandidates({ query })
    ]);

    const candidates = dedupeAndSort(
      [...lrclibCandidates, ...ovhCandidates],
      { query, title, singer, preferredScripts, evidence, limit }
    );

    return json({ candidates });
  } catch (error) {
  const message = String(error?.message || error || "Unknown error");
  console.error("lookup-song-online error", message);
  return json({ error: message }, 500);
}
});
