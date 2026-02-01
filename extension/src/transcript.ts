/**
 * YouTube transcript fetching for the Chrome extension.
 * Uses direct YouTube API calls (no npm dependency needed at runtime).
 */

export interface TranscriptEntry {
  text: string;
  start: number;
  duration: number;
}

/**
 * Extract video ID from various YouTube URL formats.
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if a URL is a YouTube video URL.
 */
export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed)/.test(url);
}

/**
 * Default InnerTube API key (public, embedded in every YouTube page).
 */
const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/**
 * Fetch the transcript for a YouTube video.
 *
 * Uses YouTube's InnerTube API with an Android client context to obtain
 * caption track URLs, then fetches and parses the XML captions.
 *
 * Approach adapted from jdepoix/youtube-transcript-api and
 * danielxceron/youtube-transcript.
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptEntry[]> {
  // Use InnerTube player API with Android client to get caption tracks.
  // The Android client does not require a PO (Proof of Origin) token,
  // unlike the WEB client which returns empty timedtext responses.
  const playerResponse = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.youtube.com",
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
        "User-Agent":
          "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
          },
        },
        videoId,
      }),
    },
  );

  if (!playerResponse.ok) {
    throw new Error(`InnerTube API returned ${playerResponse.status}`);
  }

  const playerData = await playerResponse.json();

  if (playerData?.playabilityStatus?.status !== "OK") {
    const reason =
      playerData?.playabilityStatus?.reason || "unknown reason";
    throw new Error(`Video is not playable: ${reason}`);
  }

  const trackList =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!trackList || trackList.length === 0) {
    throw new Error(
      "No captions found for this video. The video may not have subtitles enabled.",
    );
  }

  // Find English track (prefer manual captions over auto-generated)
  let track = trackList.find(
    (t: any) => t.languageCode === "en" && t.kind !== "asr",
  );
  if (!track) {
    track = trackList.find((t: any) => t.languageCode === "en");
  }
  if (!track) {
    track = trackList[0];
  }

  // Fetch the actual transcript XML
  const baseUrl = track.baseUrl.replace("&fmt=srv3", "");
  const captionResponse = await fetch(baseUrl, {
    headers: {
      "User-Agent":
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
    },
  });
  if (!captionResponse.ok) {
    throw new Error(`Failed to fetch captions: ${captionResponse.status}`);
  }

  const xml = await captionResponse.text();
  if (!xml) {
    throw new Error("Caption endpoint returned empty response.");
  }

  return parseTranscriptXml(xml);
}

/**
 * Parse YouTube transcript XML into structured entries.
 */
function parseTranscriptXml(xml: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const texts = doc.querySelectorAll("text");

  for (let i = 0; i < texts.length; i++) {
    const node = texts[i];
    const start = parseFloat(node.getAttribute("start") || "0");
    const duration = parseFloat(node.getAttribute("dur") || "0");
    // Decode HTML entities in text
    const text = decodeHtmlEntities(node.textContent || "");
    entries.push({ text, start, duration });
  }

  return entries;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}

/**
 * Format seconds as MM:SS or HH:MM:SS.
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Generate a YouTube URL that links to a specific timestamp.
 */
export function makeTimestampUrl(videoId: string, seconds: number): string {
  const t = Math.floor(seconds);
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s`;
}

/**
 * Build formatted transcript text with timestamps for LLM input.
 */
export function buildTranscriptText(entries: TranscriptEntry[]): string {
  return entries
    .map((e) => {
      const minutes = Math.floor(e.start / 60);
      const seconds = Math.floor(e.start % 60);
      return `[${minutes}:${seconds.toString().padStart(2, "0")}] ${e.text}`;
    })
    .join("\n");
}

/**
 * Find the best matching transcript entry for a given quote.
 */
export function findQuoteTimestamp(
  quote: string,
  entries: TranscriptEntry[],
  threshold: number = 0.4
): TranscriptEntry | null {
  const quoteLower = quote.toLowerCase().trim();
  const quoteWords = new Set(quoteLower.split(/\s+/));

  let bestMatch: TranscriptEntry | null = null;
  let bestScore = 0.0;

  for (let i = 0; i < entries.length; i++) {
    for (let windowSize = 1; windowSize < Math.min(5, entries.length - i + 1); windowSize++) {
      const windowEntries = entries.slice(i, i + windowSize);
      const combinedText = windowEntries.map((e) => e.text).join(" ").toLowerCase();
      const combinedWords = new Set(combinedText.split(/\s+/));

      // Check direct substring containment
      if (combinedText.includes(quoteLower)) {
        return windowEntries[0];
      }

      // Word overlap score
      if (quoteWords.size === 0) continue;
      let overlap = 0;
      for (const word of quoteWords) {
        if (combinedWords.has(word)) overlap++;
      }
      const score = overlap / quoteWords.size;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = windowEntries[0];
      }
    }
  }

  return bestScore >= threshold ? bestMatch : null;
}
