/**
 * Integration tests for TLDW Chrome Extension.
 *
 * Section 1 (transcript fetching) fetches transcripts from Node.js using the
 * same InnerTube API approach as the extension.  YouTube blocks headless Chrome
 * via bot detection, so we call the API directly from Node.js instead.
 *
 * Section 2 (full pipeline) is skipped unless an API key env var is set:
 *   OPENROUTER_API_KEY > ANTHROPIC_API_KEY > OPENAI_API_KEY
 */

import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "..", "dist");

// ─── Node-side transcript fetcher (mirrors extension logic) ─────────────────

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const RE_XML_TRANSCRIPT =
  /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

const HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&#x2f;": "/",
  "&#47;": "/",
  "&#xa0;": " ",
  "&nbsp;": " ",
};

function decodeHtml(text) {
  return text.replace(/&[^;]+;/g, (m) => HTML_ENTITIES[m] || m).trim();
}

async function fetchTranscriptNode(videoId) {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
    },
  );
  if (!res.ok) throw new Error(`InnerTube returned ${res.status}`);
  const data = await res.json();
  if (data?.playabilityStatus?.status !== "OK")
    throw new Error(`Video not playable: ${data?.playabilityStatus?.reason}`);
  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error("No caption tracks");
  const track = tracks.find((t) => t.languageCode === "en") || tracks[0];
  const xmlRes = await fetch(track.baseUrl.replace("&fmt=srv3", ""), {
    headers: {
      "User-Agent":
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
    },
  });
  const xml = await xmlRes.text();
  const entries = [];
  let m;
  const re = new RegExp(RE_XML_TRANSCRIPT.source, "g");
  while ((m = re.exec(xml)) !== null) {
    entries.push({ text: decodeHtml(m[3]), start: parseFloat(m[1]), duration: parseFloat(m[2]) });
  }
  return entries;
}

// ─── Test data ───────────────────────────────────────────────────────────────

const VIDEOS = {
  cancelled: {
    id: "yn_fkFH3FUc",
    prompt: "why is he being cancelled?",
    keywords: ["lab grown meat", "lab-grown", "meat", "controversial", "banned"],
    tsMin: 0,
    tsMax: 180,
  },
  penny: {
    id: "drq1p8ykq_Q",
    prompt: "so what hasnt happened in 232 years?",
    keywords: ["penny", "pennies", "discontinuing", "232 years", "cent"],
    tsMin: 1080,
    tsMax: 1260,
  },
};

// ─── Detect API key ──────────────────────────────────────────────────────────

function detectApiConfig() {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      model: "google/gemini-3-flash-preview",
      apiKey: process.env.OPENROUTER_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  return null;
}

// ─── Test harness ────────────────────────────────────────────────────────────

let browser;
let popupBaseUrl;
let passed = 0;
let failed = 0;
const results = [];

function logTest(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++;
  else failed++;
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
}

async function openPopup() {
  const page = await browser.newPage();
  await page.goto(popupBaseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  return page;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== TLDW Integration Tests ===\n");

  // 1. Launch Chrome with extension
  console.log("Launching Chrome with extension…");
  browser = await puppeteer.launch({
    headless: "new",
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
    ],
  });

  // 2. Find service worker & derive popup URL
  await new Promise((r) => setTimeout(r, 2000));

  const targets = browser.targets();
  const swTarget = targets.find(
    (t) => t.type() === "service_worker" && t.url().includes("background.js"),
  );

  if (!swTarget) {
    console.error("Service worker not found. Available targets:");
    for (const t of targets) console.error(`  type=${t.type()} url=${t.url()}`);
    await cleanup();
    process.exit(2);
  }

  const swCdp = await swTarget.createCDPSession();
  await swCdp.send("Runtime.enable");

  const urlResult = await swCdp.send("Runtime.evaluate", {
    expression: "chrome.runtime.getURL('popup.html')",
    returnByValue: true,
  });
  popupBaseUrl = urlResult.result.value;
  console.log(`Popup URL: ${popupBaseUrl}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Section 1: Transcript fetching (always runs)
  //  Runs from Node.js because YouTube blocks headless Chrome via bot
  //  detection.  The extension uses the same InnerTube Android-client
  //  approach which works in a real (non-headless) browser.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("--- Section 1: Transcript fetching ---");

  const transcriptCache = {};
  for (const [label, video] of Object.entries(VIDEOS)) {
    try {
      const entries = await fetchTranscriptNode(video.id);
      transcriptCache[video.id] = entries;

      const allHaveText = entries.every((e) => typeof e.text === "string" && e.text.length > 0);
      const allHaveStart = entries.every((e) => typeof e.start === "number");

      logTest(
        `Transcript fetch — ${label} (${video.id})`,
        entries.length > 0 && allHaveText && allHaveStart,
        `${entries.length} entries`,
      );
    } catch (err) {
      logTest(`Transcript fetch — ${label} (${video.id})`, false, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Section 2: Full pipeline (skipped without API key)
  // ═══════════════════════════════════════════════════════════════════════════
  const apiConfig = detectApiConfig();

  if (!apiConfig) {
    console.log(
      "\n--- Section 2: Full pipeline — SKIPPED (no API key env var) ---",
    );
    console.log(
      "  Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY to run.\n",
    );
  } else {
    console.log(
      `\n--- Section 2: Full pipeline (${apiConfig.provider}/${apiConfig.model}) ---`,
    );

    for (const [label, video] of Object.entries(VIDEOS)) {
      const page = await openPopup();
      try {
        const entries = transcriptCache[video.id];
        if (!entries || entries.length === 0) {
          logTest(`Pipeline — ${label}`, false, "transcript not available (skipped)");
          await page.close();
          continue;
        }

        const summary = await page.evaluate(
          async (transcriptEntries, prompt, config) => {
            const { summarizeVideo } = await import("./llm.js");
            const result = await summarizeVideo(transcriptEntries, prompt, config);
            return result;
          },
          entries,
          video.prompt,
          apiConfig,
        );

        // Structure validation
        const hasOneLiner =
          typeof summary.one_liner === "string" && summary.one_liner.length > 0;
        const hasSections =
          Array.isArray(summary.sections) && summary.sections.length > 0;

        logTest(
          `Pipeline structure — ${label}`,
          hasOneLiner && hasSections,
          `one_liner=${hasOneLiner}, sections=${summary.sections?.length ?? 0}`,
        );

        // Content keyword validation
        let fullText = (summary.one_liner || "").toLowerCase();
        for (const sec of summary.sections || []) {
          fullText += " " + (sec.summary || "").toLowerCase();
          fullText += " " + (sec.quote || "").toLowerCase();
          fullText += " " + (sec.title || "").toLowerCase();
        }
        const foundKeyword = video.keywords.some((kw) => fullText.includes(kw.toLowerCase()));

        logTest(
          `Pipeline keywords — ${label}`,
          foundKeyword,
          foundKeyword
            ? "keyword match found"
            : `none of [${video.keywords.join(", ")}] in response`,
        );

        // Timestamp validation
        const timestamps = (summary.sections || []).map(
          (s) => s._matched_start ?? -1,
        );
        const hasRelevantTs = timestamps.some(
          (ts) => ts >= video.tsMin && ts <= video.tsMax,
        );

        logTest(
          `Pipeline timestamps — ${label}`,
          hasRelevantTs,
          `expected ${video.tsMin}–${video.tsMax}s, got [${timestamps.join(", ")}]`,
        );
      } catch (err) {
        logTest(`Pipeline — ${label}`, false, err.message);
      } finally {
        await page.close();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== Test Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results) {
      if (r.status === "FAIL") console.log(`  - ${r.name}: ${r.detail}`);
    }
  }

  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

run().catch(async (err) => {
  console.error("Test runner error:", err);
  await cleanup();
  process.exit(2);
});
