var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var APP_USER_AGENT = "MehfilLyrics/1.0 contact:mehfil-app";
var LRCLIB_BASE = "https://lrclib.net/api/search";
var CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
var PROVIDER_LINK_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept"
};
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
__name(json, "json");
function normalizeText(text) {
  return String(text || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}
__name(normalizeText, "normalizeText");
function cleanLyricsText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\[[0-9:.]+\]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(cleanLyricsText, "cleanLyricsText");
function stripSyncedTimestamps(text) {
  return cleanLyricsText(String(text || "").replace(/\[[0-9:.]+\]/g, ""));
}
__name(stripSyncedTimestamps, "stripSyncedTimestamps");
function getLyrics(row) {
  return cleanLyricsText(
    row?.plainLyrics || row?.plain_lyrics || stripSyncedTimestamps(row?.syncedLyrics || row?.synced_lyrics || "") || ""
  );
}
__name(getLyrics, "getLyrics");
function detectScript(text) {
  const value = String(text || "");
  const hasGujarati = /[\u0A80-\u0AFF]/.test(value);
  const hasDevanagari = /[\u0900-\u097F]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasGujarati && !hasDevanagari && !hasLatin) return "gujarati";
  if (hasDevanagari && !hasGujarati && !hasLatin) return "devanagari";
  if ((hasGujarati || hasDevanagari) && hasLatin) return "mixed";
  if (hasLatin) {
    const norm = normalizeText(value);
    const hints = ["hai", "ho", "dil", "tum", "tere", "meri", "mera", "koi", "jaise", "chhe", "che", "mane", "mara", "tari", "nathi", "shu", "kem"];
    const hits = hints.filter((word) => norm.includes(word)).length;
    return hits >= 2 ? "romanized" : "english";
  }
  return "unknown";
}
__name(detectScript, "detectScript");
function scoreTitle(rowTitle, queryTitle) {
  const rowNorm = normalizeText(rowTitle || "");
  const queryNorm = normalizeText(queryTitle || "");
  if (!rowNorm || !queryNorm) return 0;
  let score = 0;
  if (rowNorm === queryNorm) score += 70;
  if (rowNorm.includes(queryNorm) || queryNorm.includes(rowNorm)) score += 32;
  const rowWords = new Set(rowNorm.split(/\s+/).filter(Boolean));
  const queryWords = queryNorm.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const word of queryWords) {
    if (rowWords.has(word)) hits++;
  }
  if (queryWords.length) score += Math.round(hits / queryWords.length * 35);
  return Math.min(score, 100);
}
__name(scoreTitle, "scoreTitle");
function makeLookupKey(candidate) {
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
__name(makeLookupKey, "makeLookupKey");
function rowToCandidate(row, query) {
  const lyrics = getLyrics(row);
  if (!lyrics || lyrics.length < 20) return null;
  const title = String(row?.trackName || row?.track_name || row?.name || "").trim();
  const singer = String(row?.artistName || row?.artist_name || "").trim();
  const movie = String(row?.albumName || row?.album_name || "").trim();
  if (!title) return null;
  let confidence = scoreTitle(title, query);
  if (lyrics.length >= 80) confidence += 10;
  if (lyrics.length >= 250) confidence += 8;
  if (lyrics.length >= 600) confidence += 8;
  if (lyrics.length >= 1e3) confidence += 4;
  if (/\b(karaoke|instrumental|slowed|reverb)\b/i.test(title)) confidence -= 25;
  confidence = Math.max(0, Math.min(confidence, 100));
  if (confidence < 20) return null;
  const candidate = {
    provider: "lrclib",
    title,
    singer,
    movie,
    source_name: "LRCLIB",
    source_url: "https://lrclib.net/",
    script: detectScript(lyrics),
    preview: cleanLyricsText(lyrics).slice(0, 520),
    lyrics: cleanLyricsText(lyrics).slice(0, 18e3),
    status: "lyrics_ready",
    confidence,
    lookup_key: ""
  };
  candidate.lookup_key = makeLookupKey(candidate);
  return candidate;
}
__name(rowToCandidate, "rowToCandidate");
function buildLrclibUrls(query, singer = "", deep = true) {
  const q = normalizeText(query);
  const cleanSinger = normalizeText(singer);
  const urls = [];
  function add(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    const url = `${LRCLIB_BASE}?${search.toString()}`;
    if (!urls.includes(url)) urls.push(url);
  }
  __name(add, "add");
  add({ track_name: q, artist_name: cleanSinger });
  add({ q });
  if (deep) {
    const variants = [
      q.replace(/\bmohabbat\b/g, "mahobbat"),
      q.replace(/\bmohabbat\b/g, "mohobbat"),
      q.replace(/\bmohabbat\b/g, "muhabbat"),
      q.replace(/\bwala\b/g, "waala"),
      q.replace(/\bwala\b/g, "vala"),
      q.replace(/\bwala\b/g, "vaala")
    ].map(normalizeText).filter(Boolean);
    for (const variant of variants) add({ q: variant });
  }
  return Array.from(new Set(urls)).slice(0, deep ? 6 : 2);
}
__name(buildLrclibUrls, "buildLrclibUrls");
async function fetchLrclibJson(url, timeoutMs = 12e3) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": APP_USER_AGENT
      }
    });
    const text = await response.text();
    let data = [];
    try {
      const parsed = text ? JSON.parse(text) : [];
      data = Array.isArray(parsed) ? parsed : [];
    } catch {
      data = [];
    }
    return {
      url,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      data,
      error: response.ok ? "" : response.statusText || "LRCLIB HTTP error"
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      data: [],
      error: String(error?.message || error || "LRCLIB fetch failed")
    };
  } finally {
    clearTimeout(timeout);
  }
}
__name(fetchLrclibJson, "fetchLrclibJson");
async function raceUrls(urls, timeoutMs = 12e3) {
  const diagnostics = [];
  const promises = urls.map(
    (url) => fetchLrclibJson(url, timeoutMs).then((result) => {
      diagnostics.push(result);
      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        return { rows: result.data, winner: result, diagnostics: diagnostics.slice() };
      }
      throw result;
    })
  );
  try {
    return await Promise.any(promises);
  } catch {
    await Promise.allSettled(promises);
    return { rows: [], winner: null, diagnostics: diagnostics.slice() };
  }
}
__name(raceUrls, "raceUrls");
function processRows(rows, query, limit) {
  const bestByKey = /* @__PURE__ */ new Map();
  for (const row of rows.slice(0, 120)) {
    const candidate = rowToCandidate(row, query);
    if (!candidate) continue;
    const rowId = String(row?.id || "").trim();
    const key = rowId ? `id:${rowId}` : [
      normalizeText(candidate.title),
      normalizeText(candidate.singer),
      normalizeText(candidate.movie),
      cleanLyricsText(candidate.lyrics || candidate.preview || "").slice(0, 120).toLowerCase()
    ].join("::");
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, candidate);
      continue;
    }
    const existingLength = cleanLyricsText(existing.lyrics || existing.preview || "").length;
    const candidateLength = cleanLyricsText(candidate.lyrics || candidate.preview || "").length;
    if (candidate.confidence > existing.confidence || candidateLength > existingLength) {
      bestByKey.set(key, candidate);
    }
  }
  return Array.from(bestByKey.values()).sort((a, b) => {
    const scriptRank = {
      devanagari: 5,
      gujarati: 4,
      mixed: 3,
      romanized: 2,
      english: 1,
      unknown: 0
    };
    const scriptDiff = (scriptRank[b.script] || 0) - (scriptRank[a.script] || 0);
    if (scriptDiff !== 0) return scriptDiff;
    const aNoisy = /\b(lofi|lo-fi|flip|cover|remix|version|single|unplugged|karaoke|instrumental)\b/i.test(
      `${a.title || ""} ${a.movie || ""}`
    );
    const bNoisy = /\b(lofi|lo-fi|flip|cover|remix|version|single|unplugged|karaoke|instrumental)\b/i.test(
      `${b.title || ""} ${b.movie || ""}`
    );
    if (aNoisy !== bNoisy) return aNoisy ? 1 : -1;
    const confidenceDiff = Number(b.confidence || 0) - Number(a.confidence || 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    return cleanLyricsText(b.lyrics || b.preview || "").length - cleanLyricsText(a.lyrics || a.preview || "").length;
  }).slice(0, limit);
}
__name(processRows, "processRows");
var DIRECT_PROVIDER_ORDER = {
  shazam: 1,
  genius: 2,
  smule: 1,
  hindigeetmala: 4,
  hindilyrics4u: 5,
  musixmatch: 6
};
var DIRECT_PROVIDER_RELIABILITY = {
  shazam: 92,
  genius: 88,
  smule: 90,
  hindigeetmala: 75,
  hindilyrics4u: 78,
  musixmatch: 55
};
function cleanProviderResultUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "fbclid" || key.toLowerCase() === "gclid") {
        url.searchParams.delete(key);
      }
    });
    return url.toString();
  } catch {
    return "";
  }
}
__name(cleanProviderResultUrl, "cleanProviderResultUrl");
function getProviderMetaFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.toLowerCase();
    if (host === "hindigeetmala.net" || host === "m.hindigeetmala.net") {
    if (!path.includes("/song/")) return null;

    return {
      provider: "hindigeetmala",
      label: "Open on HindiGeetMala"
    };
  }

  if (host === "hindilyrics4u.com" || host === "m.hindilyrics4u.com") {
    if (!path.includes("/song/")) return null;

    return {
      provider: "hindilyrics4u",
      label: "Open on HindiLyrics4u"
    };
  }
  if (host === "genius.com") {
    if (path.includes("/search") || path.includes("/artists/") || path.includes("/albums/") || path === "/" || path.length < 4) {
      return null;
    }
    return {
      provider: "genius",
      label: "Open on Genius"
    };
  }
  if (host === "shazam.com") {
    if (!path.includes("/song/")) return null;
    return {
      provider: "shazam",
      label: "Open on Shazam"
    };
  }
  if (host === "smule.com") {
    if (path.includes("/search") || path.includes("/explore") || path.includes("/user/") || path === "/" || path.length < 8) {
      return null;
    }
    return {
      provider: "smule",
      label: "Open on Smule"
    };
  }
  
  if (host === "musixmatch.com") {
    if (path.includes("/search") || path === "/" || path.length < 8) {
      return null;
    }
    return {
      provider: "musixmatch",
      label: "Open on Musixmatch"
    };
  }
  return null;
}
__name(getProviderMetaFromUrl, "getProviderMetaFromUrl");
function decodeProviderResultEntities(value) {
  return String(value || "").replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
__name(decodeProviderResultEntities, "decodeProviderResultEntities");
function cleanProviderResultText(value) {
  return decodeProviderResultEntities(value).replace(/<\/?strong>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
__name(cleanProviderResultText, "cleanProviderResultText");
function canonicalProviderMatchText(value) {
  return normalizeText(cleanProviderResultText(value)).replace(/\blyrics?\b/g, " ").replace(/\bsong\b/g, " ").replace(/\bkaraoke\b/g, " ").replace(/\bofficial\b/g, " ").replace(/\bvideo\b/g, " ").replace(/\bmusic\b/g, " ").replace(/\bnew\b/g, " ").replace(/\bfull\b/g, " ").replace(/\bonline\b/g, " ").replace(/\s+/g, " ").trim();
}
__name(canonicalProviderMatchText, "canonicalProviderMatchText");
function providerUrlToMatchText(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    return canonicalProviderMatchText(
      `${url.hostname} ${url.pathname.replace(/[-_/]+/g, " ")}`
    );
  } catch {
    return canonicalProviderMatchText(rawUrl);
  }
}
__name(providerUrlToMatchText, "providerUrlToMatchText");
var PROVIDER_QUERY_WEAK_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "ke",
  "ki",
  "ka",
  "ko",
  "se",
  "me",
  "mein",
  "ae",
  "ai",
  "hai",
  "hain",
  "ho",
  "tha",
  "thi",
  "the",
  "to",
  "toh",
  "ye",
  "yeh",
  "wo",
  "woh",
  "lyrics",
  "lyric",
  "song",
  "official",
  "video",
  "music",
  "karaoke"
]);
var PROVIDER_GENERIC_TITLE_WORDS = /* @__PURE__ */ new Set([
  "dil",
  "pyar",
  "pyaar",
  "ishq",
  "jaan",
  "jane",
  "zindagi",
  "mohabbat",
  "love",
  "tum",
  "hum",
  "tere",
  "meri",
  "mera"
]);
function buildProviderWordVariants(word) {
  const base = canonicalProviderMatchText(word);
  const variants = /* @__PURE__ */ new Set();
  function add(value) {
    const clean = canonicalProviderMatchText(value);
    if (clean && clean.length >= 2) {
      variants.add(clean);
    }
  }
  __name(add, "add");
  add(base);
  if (!base) return [];
  add(base.replace(/aa/g, "a"));
  add(base.replace(/ii/g, "i"));
  add(base.replace(/ee/g, "e"));
  add(base.replace(/oo/g, "o"));
  add(base.replace(/uu/g, "u"));
  add(base.replace(/sh/g, "s"));
  add(base.replace(/chh/g, "ch"));
  add(base.replace(/bh/g, "b"));
  add(base.replace(/ph/g, "f"));
  add(base.replace(/v/g, "w"));
  add(base.replace(/w/g, "v"));
  add(base.replace(/\btoh\b/g, "to"));
  add(base.replace(/\bto\b/g, "toh"));
  add(base.replace(/\bki\b/g, "ke"));
  add(base.replace(/\bke\b/g, "ki"));
  add(base.replace(/\bye\b/g, "yeh"));
  add(base.replace(/\byeh\b/g, "ye"));
  add(base.replace(/ata$/g, "ta"));
  add(base.replace(/chata/g, "chta"));
  add(base.replace(/chatha/g, "chta"));
  return Array.from(variants).filter(Boolean);
}
__name(buildProviderWordVariants, "buildProviderWordVariants");
function providerTextHasWord(text, word) {
  const haystack = ` ${canonicalProviderMatchText(text)} `;
  return buildProviderWordVariants(word).some((variant) => {
    if (!variant) return false;
    if (haystack.includes(` ${variant} `)) {
      return true;
    }
    if (variant.length >= 5 && haystack.includes(variant)) {
      return true;
    }
    return false;
  });
}
__name(providerTextHasWord, "providerTextHasWord");
function buildProviderPhraseVariants(query) {
  const base = canonicalProviderMatchText(query);
  const variants = /* @__PURE__ */ new Set();
  function add(value) {
    const clean = canonicalProviderMatchText(value);
    if (clean && clean.length >= 5) {
      variants.add(clean);
    }
  }
  __name(add, "add");
  add(base);
  add(
    base.replace(/\bsochata\b/g, "sochta").replace(/\bsochatha\b/g, "sochta")
  );
  add(
    base.replace(/\bto\b/g, "toh").replace(/\bki\b/g, "ke").replace(/\bye\b/g, "yeh")
  );
  add(
    base.replace(/\bhai\b$/g, "").trim()
  );
  return Array.from(variants).filter(Boolean);
}
__name(buildProviderPhraseVariants, "buildProviderPhraseVariants");
function scoreProviderResultStrict(result, query) {
  const queryText = canonicalProviderMatchText(query);
  const titleText = canonicalProviderMatchText(result?.title || "");
  const urlText = providerUrlToMatchText(result?.url || "");
  const descriptionText = canonicalProviderMatchText(result?.description || "");
  const mainText = `${titleText} ${urlText}`.trim();
  const rawWords = queryText.split(/\s+/).map((word) => word.trim()).filter(Boolean);
  const coreWords = rawWords.filter(
    (word) => word.length >= 3 && !PROVIDER_QUERY_WEAK_WORDS.has(word)
  );
  const distinctiveWords = coreWords.filter(
    (word) => word.length >= 4 && !PROVIDER_GENERIC_TITLE_WORDS.has(word)
  );
  const scoringWords = coreWords.length ? coreWords : distinctiveWords;
  if (!scoringWords.length) {
    return {
      pass: false,
      confidence: 0,
      mainHits: 0,
      descriptionHits: 0,
      totalWords: 0,
      phraseMain: false
    };
  }
  let mainHits = 0;
  let descriptionHits = 0;
  for (const word of scoringWords) {
    if (providerTextHasWord(mainText, word)) {
      mainHits++;
    }
    if (providerTextHasWord(descriptionText, word)) {
      descriptionHits++;
    }
  }
  const phraseMain = buildProviderPhraseVariants(queryText).some((phrase) => {
    const compactPhrase = phrase.replace(/\s+/g, "");
    const compactMain = mainText.replace(/\s+/g, "");
    return mainText.includes(phrase) || compactMain.includes(compactPhrase);
  });
  if (distinctiveWords.length) {
    const hasDistinctiveMainHit = distinctiveWords.some(
      (word) => providerTextHasWord(mainText, word)
    );
    if (!hasDistinctiveMainHit && !phraseMain) {
      return {
        pass: false,
        confidence: 0,
        mainHits,
        descriptionHits,
        totalWords: scoringWords.length,
        phraseMain
      };
    }
  }
  const totalWords = scoringWords.length;
  let requiredMainHits;
  if (totalWords <= 1) {
    requiredMainHits = 1;
  } else if (totalWords === 2) {
    requiredMainHits = 2;
  } else if (totalWords === 3) {
    requiredMainHits = 3;
  } else {
    requiredMainHits = Math.ceil(totalWords * 0.75);
  }
  if (!phraseMain && mainHits < requiredMainHits) {
    return {
      pass: false,
      confidence: 0,
      mainHits,
      descriptionHits,
      totalWords,
      phraseMain
    };
  }
  const mainCoverage = mainHits / totalWords;
  const descriptionCoverage = descriptionHits / totalWords;
  let confidence = Math.round(
    mainCoverage * 82 + descriptionCoverage * 5 + (phraseMain ? 13 : 0)
  );
  if (mainHits === totalWords) {
    confidence += 5;
  }
  confidence = Math.max(0, Math.min(100, confidence));
  return {
    pass: confidence >= 65,
    confidence,
    mainHits,
    descriptionHits,
    totalWords,
    phraseMain
  };
}
__name(scoreProviderResultStrict, "scoreProviderResultStrict");
function searchResultToProviderLink(result, query) {
  const cleanUrl = cleanProviderResultUrl(result?.url || "");
  if (!cleanUrl) return null;
  const meta = getProviderMetaFromUrl(cleanUrl);
  if (!meta) return null;
  const match = scoreProviderResultStrict(result, query);
  if (!match.pass) {
    return null;
  }
  const title = cleanProviderResultText(result?.title || "").trim();
  const description = cleanProviderResultText(result?.description || "").trim();
  const providerReliability = DIRECT_PROVIDER_RELIABILITY[meta.provider] || 50;
  let qualityScore = Math.round(
    match.confidence * 0.76 + providerReliability * 0.24
  );
  if (match.phraseMain) {
    qualityScore += 8;
  }
  if (match.mainHits >= match.totalWords) {
    qualityScore += 4;
  }
  qualityScore = Math.max(0, Math.min(100, qualityScore));
  let qualityLabel = "Good match";
  if (qualityScore >= 90) {
    qualityLabel = "Best match";
  } else if (qualityScore >= 75) {
    qualityLabel = "Strong match";
  } else if (qualityScore < 62) {
    qualityLabel = "Possible match";
  }
  return {
    provider: meta.provider,
    label: meta.label,
    url: cleanUrl,
    direct: true,
    confidence: match.confidence,
    quality_score: qualityScore,
    quality_label: qualityLabel,
    title,
    description: description.slice(0, 180),
    source: "brave_search",
    match_debug: {
      main_hits: match.mainHits,
      description_hits: match.descriptionHits,
      total_words: match.totalWords,
      phrase_main: match.phraseMain
    }
  };
}
__name(searchResultToProviderLink, "searchResultToProviderLink");
function mergeProviderLinks(...groups) {
  const bestByProvider = /* @__PURE__ */ new Map();
  for (const group of groups) {
    const list = Array.isArray(group) ? group : [group];
    for (const link of list) {
      if (!link || !link.url || link.direct !== true || !link.provider) continue;
      const key = String(link.provider);
      const existing = bestByProvider.get(key);
      const linkScore = Number(link.quality_score || link.confidence || 0);
      const existingScore = Number(existing?.quality_score || existing?.confidence || 0);
      if (!existing || linkScore > existingScore) {
        bestByProvider.set(key, link);
      }
    }
  }
  return Array.from(bestByProvider.values()).sort((a, b) => {
    const qualityDiff = Number(b.quality_score || b.confidence || 0) - Number(a.quality_score || a.confidence || 0);
    if (qualityDiff !== 0) return qualityDiff;
    const providerDiff = (DIRECT_PROVIDER_ORDER[a.provider] || 99) - (DIRECT_PROVIDER_ORDER[b.provider] || 99);
    if (providerDiff !== 0) return providerDiff;
    return Number(b.confidence || 0) - Number(a.confidence || 0);
  }).slice(0, 5);
}
__name(mergeProviderLinks, "mergeProviderLinks");
var PROVIDER_LINK_SUPABASE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
function getProviderLinkCacheQueryNorm(query) {
  return normalizeText(query || "").replace(/\blyrics?\b/g, " ").replace(/\bsong\b/g, " ").replace(/\s+/g, " ").trim();
}
__name(getProviderLinkCacheQueryNorm, "getProviderLinkCacheQueryNorm");
function clampProviderScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.round(n), 100));
}
__name(clampProviderScore, "clampProviderScore");
function sanitizeProviderCacheLinks(links = []) {
  const seen = /* @__PURE__ */ new Set();
  return (Array.isArray(links) ? links : []).map((link) => {
    if (!link || !link.url) return null;
    const cleanUrl = cleanProviderResultUrl(link.url);
    if (!cleanUrl) return null;
    const meta = getProviderMetaFromUrl(cleanUrl);
    if (!meta) return null;
    const key = `${meta.provider}:${cleanUrl}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const qualityScore = clampProviderScore(
      link.quality_score || link.confidence || 0
    );
    return {
      provider: meta.provider,
      label: meta.label,
      url: cleanUrl,
      direct: true,
      confidence: clampProviderScore(link.confidence || qualityScore),
      quality_score: qualityScore,
      quality_label: link.quality_label || (qualityScore >= 90 ? "Best match" : qualityScore >= 75 ? "Strong match" : "Good match"),
      title: cleanProviderResultText(link.title || "").slice(0, 240),
      description: cleanProviderResultText(link.description || "").slice(0, 220),
      source: link.source || "provider_link_cache"
    };
  }).filter(Boolean).sort((a, b) => {
    const qualityDiff = Number(b.quality_score || b.confidence || 0) - Number(a.quality_score || a.confidence || 0);
    if (qualityDiff !== 0) return qualityDiff;
    return (DIRECT_PROVIDER_ORDER[a.provider] || 99) - (DIRECT_PROVIDER_ORDER[b.provider] || 99);
  }).slice(0, 5);
}
__name(sanitizeProviderCacheLinks, "sanitizeProviderCacheLinks");
function getSupabaseProviderCacheHeaders(env, extraHeaders = {}) {
  return {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extraHeaders
  };
}
__name(getSupabaseProviderCacheHeaders, "getSupabaseProviderCacheHeaders");
async function readProviderLinksSupabaseCache(env, query) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const queryNorm = getProviderLinkCacheQueryNorm(query);
  if (!queryNorm) {
    return null;
  }
  const url = `${env.SUPABASE_URL}/rest/v1/external_provider_link_cache?query_norm=eq.${encodeURIComponent(queryNorm)}&select=links,updated_at,hit_count`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getSupabaseProviderCacheHeaders(env, {
        "Accept": "application/json"
      })
    });
    if (!response.ok) {
      console.warn("Provider link Supabase cache read skipped:", response.status);
      return null;
    }
    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return null;
    }
    const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (!updatedAtMs || Date.now() - updatedAtMs > PROVIDER_LINK_SUPABASE_CACHE_TTL_MS) {
      return null;
    }
    const links = sanitizeProviderCacheLinks(row.links || []);
    if (!links.length) {
      return null;
    }
    return {
      queryNorm,
      links,
      hitCount: Number(row.hit_count || 0)
    };
  } catch (error) {
    console.warn("Provider link Supabase cache read failed:", String(error?.message || error));
    return null;
  }
}
__name(readProviderLinksSupabaseCache, "readProviderLinksSupabaseCache");
async function bumpProviderLinksSupabaseCacheHit(env, queryNorm, hitCount = 0) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !queryNorm) {
    return;
  }
  const url = `${env.SUPABASE_URL}/rest/v1/external_provider_link_cache?query_norm=eq.${encodeURIComponent(queryNorm)}`;
  try {
    await fetch(url, {
      method: "PATCH",
      headers: getSupabaseProviderCacheHeaders(env, {
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      }),
      body: JSON.stringify({
        last_hit_at: (/* @__PURE__ */ new Date()).toISOString(),
        hit_count: Number(hitCount || 0) + 1
      })
    });
  } catch (error) {
    console.warn("Provider link Supabase cache hit update failed:", String(error?.message || error));
  }
}
__name(bumpProviderLinksSupabaseCacheHit, "bumpProviderLinksSupabaseCacheHit");
async function saveProviderLinksSupabaseCache(env, query, links = []) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }
  const queryNorm = getProviderLinkCacheQueryNorm(query);
  const safeLinks = sanitizeProviderCacheLinks(links);
  if (!queryNorm || !safeLinks.length) {
    return;
  }
  const url = `${env.SUPABASE_URL}/rest/v1/external_provider_link_cache?on_conflict=query_norm`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getSupabaseProviderCacheHeaders(env, {
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify({
        query_norm: queryNorm,
        display_query: String(query || "").trim(),
        links: safeLinks,
        provider_count: safeLinks.length,
        updated_at: (/* @__PURE__ */ new Date()).toISOString(),
        last_hit_at: (/* @__PURE__ */ new Date()).toISOString()
      })
    });
    if (!response.ok) {
      console.warn("Provider link Supabase cache save skipped:", response.status);
    }
  } catch (error) {
    console.warn("Provider link Supabase cache save failed:", String(error?.message || error));
  }
}
__name(saveProviderLinksSupabaseCache, "saveProviderLinksSupabaseCache");
async function resolveDirectProviderLinksViaBrave(env, query) {
  if (!env.BRAVE_SEARCH_API_KEY) {
    return [];
  }

  const safeQuery = String(query || "").trim();

  if (!safeQuery || normalizeText(safeQuery).length < 2) {
    return [];
  }

  const primaryProviderFilter = [
    "site:shazam.com/song",
    "OR site:genius.com",
    "OR site:smule.com"
  ].join(" ");

  const secondaryProviderFilter = [
    "site:hindigeetmala.net/song",
    "OR site:hindilyrics4u.com/song",
    "OR site:musixmatch.com"
  ].join(" ");

  async function runBraveQuery(searchQuery) {
    const params = new URLSearchParams();

    params.set("q", searchQuery);
    params.set("count", "12");
    params.set("country", "IN");
    params.set("search_lang", "en");
    params.set("safesearch", "moderate");

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
          "User-Agent": APP_USER_AGENT
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json().catch(() => null);
      const results = Array.isArray(data?.web?.results) ? data.web.results : [];

      return results
        .map((result) => searchResultToProviderLink(result, safeQuery))
        .filter(Boolean);
    } catch (error) {
      console.warn("Brave provider search failed:", String(error?.message || error || "unknown"));
      return [];
    }
  }

  async function runProviderGroup(providerFilter) {
    const braveQueries = [
      `"${safeQuery}" lyrics (${providerFilter})`,
      `"${safeQuery}" (${providerFilter})`,
      `${safeQuery} lyrics (${providerFilter})`
    ];

    const settled = await Promise.allSettled(
      braveQueries.map(runBraveQuery)
    );

    const groups = settled
      .map((result) => result.status === "fulfilled" ? result.value : [])
      .filter(Boolean);

    return mergeProviderLinks(...groups);
  }

  const primaryLinks = await runProviderGroup(primaryProviderFilter);

  if (primaryLinks.length) {
    return primaryLinks;
  }

  return runProviderGroup(secondaryProviderFilter);
}
__name(resolveDirectProviderLinksViaBrave, "resolveDirectProviderLinksViaBrave");
function buildProviderLinksCacheKey(requestUrl, query, singer = "") {
  const url = new URL(requestUrl);
  url.pathname = "/provider-links-cache";
  url.search = "";
  url.searchParams.set("v", "brave-provider-links-v6-primary-then-secondary-no-gaana");
  url.searchParams.set("q", normalizeText(query));
  url.searchParams.set("singer", normalizeText(singer));
  return new Request(url.toString(), { method: "GET" });
}
__name(buildProviderLinksCacheKey, "buildProviderLinksCacheKey");
async function handleProviderLinks(request, env, ctx) {
  const started = Date.now();
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  const singer = String(url.searchParams.get("singer") || "").trim();
  const forceRefresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";
  const cacheOnly = url.searchParams.get("cacheOnly") === "1" || url.searchParams.get("cacheOnly") === "true";
  if (!query) {
    return json({
      ok: false,
      error: "missing_query"
    }, 400);
  }
  const cache = caches.default;
  const cacheKey = buildProviderLinksCacheKey(request.url, query, singer);
  if (!forceRefresh) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }
  if (!forceRefresh) {
    const supabaseCached = await readProviderLinksSupabaseCache(env, query);
    if (supabaseCached?.links?.length) {
      const response2 = json({
        ok: true,
        query,
        query_norm: getProviderLinkCacheQueryNorm(query),
        links: supabaseCached.links,
        count: supabaseCached.links.length,
        cached: true,
        source: "supabase_provider_link_cache",
        debug: {
          has_brave_key: !!env.BRAVE_SEARCH_API_KEY,
          has_genius_key: !!env.GENIUS_ACCESS_TOKEN,
          mode: "direct_provider_links_only",
          cache_version: "brave-provider-links-v6-primary-then-secondary-no-gaana",
          supabase_cache: true
        },
        ms: Date.now() - started
      }, 200, {
        "Cache-Control": `public, max-age=${PROVIDER_LINK_CACHE_TTL_SECONDS}`
      });
      if (ctx?.waitUntil) {
        ctx.waitUntil(
          bumpProviderLinksSupabaseCacheHit(
            env,
            supabaseCached.queryNorm,
            supabaseCached.hitCount
          )
        );
        ctx.waitUntil(cache.put(cacheKey, response2.clone()));
      }
      return response2;
    }
  }
  if (cacheOnly) {
    return json({
      ok: true,
      query,
      query_norm: getProviderLinkCacheQueryNorm(query),
      links: [],
      count: 0,
      cached: false,
      source: "provider_link_cache_miss",
      debug: {
        has_brave_key: !!env.BRAVE_SEARCH_API_KEY,
        has_genius_key: !!env.GENIUS_ACCESS_TOKEN,
        mode: "direct_provider_links_only",
        cache_version: "brave-provider-links-v6-primary-then-secondary-no-gaana",
        cache_only: true,
        supabase_cache: false
      },
      ms: Date.now() - started
    }, 200, {
      "Cache-Control": "no-store"
    });
  }
  const settledResults = await Promise.allSettled([
    resolveDirectProviderLinksViaBrave(env, query)
  ]);
  const resolvedGroups = settledResults.map((result) => result.status === "fulfilled" ? result.value : null).filter(Boolean);
  const links = mergeProviderLinks(...resolvedGroups);
  const response = json({
    ok: true,
    query,
    query_norm: getProviderLinkCacheQueryNorm(query),
    links,
    count: links.length,
    cached: false,
    source: "fresh_provider_discovery",
    debug: {
      has_brave_key: !!env.BRAVE_SEARCH_API_KEY,
      has_genius_key: !!env.GENIUS_ACCESS_TOKEN,
      mode: "direct_provider_links_only",
      cache_version: "brave-provider-links-v6-primary-then-secondary-no-gaana",
      supabase_cache: false
    },
    ms: Date.now() - started
  }, 200, {
    "Cache-Control": links.length ? `public, max-age=${PROVIDER_LINK_CACHE_TTL_SECONDS}` : "no-store"
  });
  if (links.length && ctx?.waitUntil) {
    ctx.waitUntil(saveProviderLinksSupabaseCache(env, query, links));
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
__name(handleProviderLinks, "handleProviderLinks");
function buildCacheKey(requestUrl, query, limit, deep) {
  const url = new URL(requestUrl);
  url.pathname = "/search-cache";
  url.search = "";
  url.searchParams.set("q", normalizeText(query));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("deep", deep ? "1" : "0");
  return new Request(url.toString(), { method: "GET" });
}
__name(buildCacheKey, "buildCacheKey");
async function handleSearch(request, ctx) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  const singer = String(url.searchParams.get("singer") || "").trim();
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 6), 8));
  const deep = url.searchParams.get("deep") !== "0";
  const refresh = url.searchParams.get("refresh") === "1";
  const started = Date.now();
  if (!query || normalizeText(query).length < 2) {
    return json({ ok: true, cached: false, candidates: [], reason: "query_too_short", ms: Date.now() - started });
  }
  const cache = caches.default;
  const cacheKey = buildCacheKey(request.url, query, limit, deep);
  if (!refresh) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const cachedResponse = new Response(cached.body, cached);
      cachedResponse.headers.set("X-Mehfil-Worker-Cache", "hit");
      return cachedResponse;
    }
  }
  const urls = buildLrclibUrls(query, singer, deep);
  const primaryUrls = urls.slice(0, 2);
  const primaryResult = await raceUrls(primaryUrls, 12e3);
  let rows = Array.isArray(primaryResult.rows) ? primaryResult.rows.slice() : [];
  const diagnostics = Array.isArray(primaryResult.diagnostics) ? primaryResult.diagnostics.slice() : [];
  if (rows.length === 0 && deep && urls.length > 2) {
    const fallbackResult = await raceUrls(urls.slice(2, 4), 7e3);
    rows = Array.isArray(fallbackResult.rows) ? fallbackResult.rows.slice() : [];
    diagnostics.push(...fallbackResult.diagnostics || []);
  }
  const candidates = processRows(rows, query, limit);
  const body = {
    ok: true,
    source: "cloudflare_worker_lrclib",
    cached: false,
    query,
    query_norm: normalizeText(query),
    count: candidates.length,
    candidates,
    ms: Date.now() - started,
    winner_url: primaryResult.winner?.url || null,
    diagnostics: diagnostics.map((item) => ({
      url: item.url,
      ok: item.ok,
      status: item.status,
      ms: item.ms,
      count: Array.isArray(item.data) ? item.data.length : 0,
      error: item.error || ""
    }))
  };
  const response = json(body, 200, {
    "Cache-Control": candidates.length ? `public, max-age=${CACHE_TTL_SECONDS}` : "no-store",
    "X-Mehfil-Worker-Cache": "miss"
  });
  if (candidates.length) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
__name(handleSearch, "handleSearch");
async function saveCandidatesToSupabase(env, query, candidates) {
  const queryNorm = normalizeText(query);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      reason: "missing_supabase_secrets"
    };
  }
  if (!queryNorm || !Array.isArray(candidates) || !candidates.length) {
    return {
      ok: false,
      reason: "nothing_to_save"
    };
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/online_song_cache?on_conflict=query_norm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      query_norm: queryNorm,
      display_query: query,
      candidates,
      provider: "cloudflare_worker_warmup",
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      last_hit_at: (/* @__PURE__ */ new Date()).toISOString()
    })
  });
  const text = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.status,
    text: text.slice(0, 500)
  };
}
__name(saveCandidatesToSupabase, "saveCandidatesToSupabase");
async function handleWarmup(request, env, ctx) {
  const started = Date.now();
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "invalid_json"
    }, 400);
  }
  const query = String(body.query || "").trim();
  const singer = String(body.singer || "").trim();
  const deep = body.deep !== false;
  const limit = Math.max(1, Math.min(Number(body.limit || 6), 8));
  if (!query || normalizeText(query).length < 2) {
    return json({
      ok: false,
      error: "query_too_short"
    }, 400);
  }
  ctx.waitUntil((async () => {
    const urls = buildLrclibUrls(query, singer, deep);
    const primaryResult = await raceUrls(urls.slice(0, 2), 12e3);
    let rows = Array.isArray(primaryResult.rows) ? primaryResult.rows.slice() : [];
    if (!rows.length && deep && urls.length > 2) {
      const fallbackResult = await raceUrls(urls.slice(2, 4), 8e3);
      rows = Array.isArray(fallbackResult.rows) ? fallbackResult.rows.slice() : [];
    }
    const candidates = processRows(rows, query, limit);
    if (candidates.length) {
      await saveCandidatesToSupabase(env, query, candidates);
    }
  })());
  return json({
    ok: true,
    accepted: true,
    mode: "background_cache_warmup",
    query,
    query_norm: normalizeText(query),
    message: "Warm-up started. You can close the browser.",
    ms: Date.now() - started
  });
}
__name(handleWarmup, "handleWarmup");
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "mehfil-lrclib-proxy" });
    }
    if (request.method === "POST" && url.pathname === "/warmup") {
      return handleWarmup(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/provider-links") {
      return handleProviderLinks(request, env, ctx);
    }
        if (request.method === "GET" && url.pathname === "/search") {
      return handleSearch(request, ctx);
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
