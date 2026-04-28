const BUILD_ID = "detail-2026-04-25-clean-lrclib-ovh-saregama-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const APP_USER_AGENT = "MehfilLyrics/1.0 contact:mehfil-app";

type DetailBody = {
  lookup_key?: string;
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

function cleanLyricsText(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[[0-9:.]+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!|[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectScript(text: string) {
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

async function safeJson(url: string, timeoutMs = 3500) {
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

async function safeText(url: string, timeoutMs = 6000) {
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

function buildSongFromMetaLyrics(meta: Record<string, unknown>) {
  const lyrics = cleanLyricsText(String(meta.lyrics || meta.preview || ""));

  if (!lyrics || lyrics.length < 8) return null;

  return {
    title: String(meta.title || "").trim(),
    singer: String(meta.singer || "").trim(),
    movie: String(meta.movie || "").trim(),
    lyrics,
    source_name: String(meta.source_name || "Online").trim(),
    source_url: String(meta.source_url || "").trim(),
    script: String(meta.script || detectScript(lyrics)),
    is_partial: String(meta.lyrics || "").trim().length < 20
  };
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

async function fetchFromSaregama(meta: Record<string, unknown>) {
  const sourceUrl = String(meta.source_url || "").trim();
  const title = String(meta.title || "").trim();
  const singer = String(meta.singer || "").trim();
  const movie = String(meta.movie || "").trim();

  if (!sourceUrl || !sourceUrl.includes("saregama.com/song-lyrics/")) {
    return null;
  }

  const response = await safeText(sourceUrl, 6500);

  if (!response.ok || !response.text) {
    return null;
  }

  const pageText = stripHtmlToText(response.text);
  const lyrics = extractSaregamaLyricsFromText(pageText, title);

  if (!lyrics) return null;

  return {
    title,
    singer,
    movie,
    lyrics,
    source_name: "Saregama",
    source_url: sourceUrl,
    script: detectScript(lyrics),
    is_partial: false
  };
}

async function fetchFromLrclib(meta: Record<string, unknown>) {
  const title = String(meta.title || "").trim();
  const singer = String(meta.singer || "").trim();

  if (!title) return null;

  const urls: string[] = [];

  // Direct exact lookup if singer is available.
  if (title && singer) {
    const getParams = new URLSearchParams();
    getParams.set("track_name", title);
    getParams.set("artist_name", singer);
    urls.push(`https://lrclib.net/api/get?${getParams.toString()}`);
  }

  // Track search.
  const trackParams = new URLSearchParams();
  trackParams.set("track_name", title);
  if (singer) trackParams.set("artist_name", singer);
  urls.push(`https://lrclib.net/api/search?${trackParams.toString()}`);

  // Broad keyword search.
  const qParams = new URLSearchParams();
  qParams.set("q", singer ? `${title} ${singer}` : title);
  urls.push(`https://lrclib.net/api/search?${qParams.toString()}`);

  for (const url of urls) {
    const result = await safeJson(url, 5000);

    const rows = Array.isArray(result)
      ? result
      : result && typeof result === "object"
        ? [result]
        : [];

    for (const row of rows) {
      const safeRow = row as Record<string, unknown>;

      const lyrics = cleanLyricsText(
        String(safeRow.plainLyrics || safeRow.plain_lyrics || safeRow.syncedLyrics || safeRow.synced_lyrics || "")
      );

      if (!lyrics || lyrics.length < 20) continue;

      return {
        title: String(safeRow.trackName || safeRow.track_name || title),
        singer: String(safeRow.artistName || safeRow.artist_name || singer),
        movie: String(safeRow.albumName || safeRow.album_name || meta.movie || ""),
        lyrics: lyrics.slice(0, 18000),
        source_name: "LRCLIB",
        source_url: "https://lrclib.net/",
        script: detectScript(lyrics),
        is_partial: false
      };
    }
  }

  return null;
}

async function fetchFromOvh(meta: Record<string, unknown>) {
  const title = String(meta.title || "").trim();
  const singer = String(meta.singer || "").trim();
  const movie = String(meta.movie || "").trim();

  if (!title || !singer) return null;

  const lyricsData = await safeJson(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(singer)}/${encodeURIComponent(title)}`,
    3500
  );

  const lyrics = cleanLyricsText(String((lyricsData as Record<string, unknown>)?.lyrics || ""));

  if (!lyrics || lyrics.length < 20) return null;

  return {
    title,
    singer,
    movie,
    lyrics: lyrics.slice(0, 18000),
    source_name: "lyrics.ovh",
    source_url: String(meta.source_url || "https://lyrics.ovh/"),
    script: detectScript(lyrics),
    is_partial: false
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json()) as DetailBody;

    if (!body.lookup_key) {
      return json({
        build_id: BUILD_ID,
        error: "Missing lookup_key"
      }, 400);
    }

    let meta: Record<string, unknown>;

    try {
      meta = JSON.parse(String(body.lookup_key || "{}"));
    } catch {
      return json({
        build_id: BUILD_ID,
        error: "Invalid lookup_key JSON"
      }, 400);
    }

    const provider = String(meta.provider || "");

    let song = buildSongFromMetaLyrics(meta);

    if (!song) {
      if (provider === "saregama") {
        song = await fetchFromSaregama(meta);
      } else if (provider === "lrclib") {
        song = await fetchFromLrclib(meta);
      } else if (provider === "ovh") {
        song = await fetchFromOvh(meta);
      }
    }

    if (!song && provider === "ovh") {
      song = await fetchFromLrclib(meta);
    }

    if (!song) {
      return json({
        build_id: BUILD_ID,
        error: "No lyrics found from this provider",
        debug: {
          provider,
          title: meta.title || "",
          singer: meta.singer || "",
          status: meta.status || "",
          reason: "metadata_only_or_provider_has_no_lyrics"
        }
      }, 404);
    }

    return json({
      build_id: BUILD_ID,
      song,
      debug: {
        provider,
        lyrics_length: String(song.lyrics || "").length,
        is_partial: !!song.is_partial
      }
    });
  } catch (error) {
    return json({
      build_id: BUILD_ID,
      error: String((error as Error)?.message || error || "Unknown error")
    }, 500);
  }
});
