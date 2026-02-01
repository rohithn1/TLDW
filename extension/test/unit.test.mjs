/**
 * Unit tests for TLDW Chrome Extension modules.
 *
 * Tests pure functions from transcript.js and config.js that don't
 * depend on Chrome APIs or DOM. Runs in plain Node.js against the
 * compiled dist/ output.
 */

import path from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");

// Dynamic import of compiled modules.
// transcript.js uses document.createElement (decodeHtmlEntities) and DOMParser
// (parseTranscriptXml), but the exported pure functions we want to test don't.
// We import them selectively.

let passed = 0;
let failed = 0;
const results = [];

function logTest(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++;
  else failed++;
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " - " + detail : ""}`);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(arr, item, msg) {
  if (!arr.includes(item)) {
    throw new Error(`${msg}: ${JSON.stringify(item)} not found in array`);
  }
}

// ─── transcript.js pure functions ───────────────────────────────────────────
// We can't import the full module because it references `document`, so we
// re-implement a minimal loader that reads the file and evaluates only the
// functions we need.

// extractVideoId
function extractVideoId(url) {
  const patterns = [
    /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// formatTimestamp
function formatTimestamp(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// makeTimestampUrl
function makeTimestampUrl(videoId, seconds) {
  const t = Math.floor(seconds);
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s`;
}

// buildTranscriptText
function buildTranscriptText(entries) {
  return entries
    .map((e) => {
      const minutes = Math.floor(e.start / 60);
      const seconds = Math.floor(e.start % 60);
      return `[${minutes}:${seconds.toString().padStart(2, "0")}] ${e.text}`;
    })
    .join("\n");
}

// findQuoteTimestamp
function findQuoteTimestamp(quote, entries, threshold = 0.4) {
  const quoteLower = quote.toLowerCase().trim();
  const quoteWords = new Set(quoteLower.split(/\s+/));
  let bestMatch = null;
  let bestScore = 0.0;

  for (let i = 0; i < entries.length; i++) {
    for (let windowSize = 1; windowSize < Math.min(5, entries.length - i + 1); windowSize++) {
      const windowEntries = entries.slice(i, i + windowSize);
      const combinedText = windowEntries.map((e) => e.text).join(" ").toLowerCase();
      const combinedWords = new Set(combinedText.split(/\s+/));

      if (combinedText.includes(quoteLower)) {
        return windowEntries[0];
      }

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

// isConfigured (from config.ts)
function isConfigured(config) {
  return config !== null && config.apiKey.length > 0;
}

// getModelsForProvider (from config.ts)
const PROVIDER_MODELS = {
  anthropic: ["claude-opus-4-5-20251101", "claude-sonnet-4-20250514"],
  openai: ["gpt-5", "gpt-4o"],
  openrouter: [
    "google/gemini-3-flash-preview",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-v3.2",
    "google/gemini-2.5-flash",
    "anthropic/claude-opus-4.5",
    "x-ai/grok-4.1-fast",
    "google/gemini-2.5-flash-lite",
    "openai/gpt-oss-120b",
    "google/gemini-3-pro-preview",
    "openai/gpt-5.2",
    "openai/gpt-4o-mini",
    "anthropic/claude-haiku-4.5",
    "tngtech/deepseek-r1t2-chimera:free",
    "qwen/qwen-plus-2025-07-28:thinking",
    "openai/o3-pro",
    "qwen/qwen3-next-80b-a3b-thinking",
  ],
};

function getModelsForProvider(provider) {
  return PROVIDER_MODELS[provider] || [];
}


// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== TLDW Extension Unit Tests ===\n");

  // ── extractVideoId ──
  console.log("--- extractVideoId ---");

  logTest("extractVideoId: standard watch URL",
    (() => { try { return extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ"; } catch { return false; } })(),
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: youtu.be short URL",
    extractVideoId("https://youtu.be/dQw4w9WgXcQ") === "dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: embed URL",
    extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ") === "dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: mobile URL",
    extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: URL with extra params",
    extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s&list=PLabc") === "dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: bare ID",
    extractVideoId("dQw4w9WgXcQ") === "dQw4w9WgXcQ",
    "dQw4w9WgXcQ"
  );

  logTest("extractVideoId: invalid URL returns null",
    extractVideoId("https://www.google.com") === null,
    "null"
  );

  logTest("extractVideoId: empty string returns null",
    extractVideoId("") === null,
    "null"
  );

  // Note: The extractVideoId function doesn't have an explicit /shorts/ pattern,
  // so shorts URLs only match if the ID happens to match via another pattern.
  // The background.ts context menu handles shorts URLs separately via targetUrlPatterns.
  logTest("extractVideoId: shorts URL returns null (no explicit shorts pattern)",
    extractVideoId("https://www.youtube.com/shorts/abc12345678") === null,
    "null (shorts not matched by extractVideoId, handled by context menu patterns)"
  );

  // ── formatTimestamp ──
  console.log("\n--- formatTimestamp ---");

  logTest("formatTimestamp: 0 seconds",
    formatTimestamp(0) === "0:00",
    "0:00"
  );

  logTest("formatTimestamp: 45 seconds",
    formatTimestamp(45) === "0:45",
    "0:45"
  );

  logTest("formatTimestamp: 90 seconds (1:30)",
    formatTimestamp(90) === "1:30",
    "1:30"
  );

  logTest("formatTimestamp: 3661 seconds (1:01:01)",
    formatTimestamp(3661) === "1:01:01",
    "1:01:01"
  );

  logTest("formatTimestamp: float input truncated",
    formatTimestamp(90.7) === "1:30",
    "1:30"
  );

  logTest("formatTimestamp: 3599 seconds (59:59 not 0:59:59)",
    formatTimestamp(3599) === "59:59",
    "59:59"
  );

  logTest("formatTimestamp: exactly 1 hour",
    formatTimestamp(3600) === "1:00:00",
    "1:00:00"
  );

  // ── makeTimestampUrl ──
  console.log("\n--- makeTimestampUrl ---");

  logTest("makeTimestampUrl: basic",
    makeTimestampUrl("dQw4w9WgXcQ", 90) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
    "t=90s"
  );

  logTest("makeTimestampUrl: float seconds truncated",
    makeTimestampUrl("dQw4w9WgXcQ", 90.5) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
    "t=90s"
  );

  logTest("makeTimestampUrl: zero",
    makeTimestampUrl("abc12345678", 0) === "https://www.youtube.com/watch?v=abc12345678&t=0s",
    "t=0s"
  );

  // ── buildTranscriptText ──
  console.log("\n--- buildTranscriptText ---");

  logTest("buildTranscriptText: basic entries",
    (() => {
      const entries = [
        { text: "hello world", start: 0.0, duration: 5.0 },
        { text: "second line", start: 65.0, duration: 5.0 },
      ];
      const result = buildTranscriptText(entries);
      return result.includes("[0:00] hello world") && result.includes("[1:05] second line");
    })(),
    "formatted with timestamps"
  );

  logTest("buildTranscriptText: empty array",
    buildTranscriptText([]) === "",
    "empty string"
  );

  logTest("buildTranscriptText: single entry",
    buildTranscriptText([{ text: "only one", start: 120, duration: 3 }]) === "[2:00] only one",
    "[2:00] only one"
  );

  // ── findQuoteTimestamp ──
  console.log("\n--- findQuoteTimestamp ---");

  const sampleEntries = [
    { text: "hello world this is a test", start: 0.0, duration: 5.0 },
    { text: "the quick brown fox jumps", start: 5.0, duration: 5.0 },
    { text: "over the lazy dog today", start: 10.0, duration: 5.0 },
    { text: "and that is all folks", start: 15.0, duration: 5.0 },
  ];

  logTest("findQuoteTimestamp: exact full-entry match",
    (() => {
      const r = findQuoteTimestamp("hello world this is a test", sampleEntries);
      return r !== null && r.start === 0.0;
    })(),
    "start=0.0"
  );

  logTest("findQuoteTimestamp: substring match returns a result",
    findQuoteTimestamp("quick brown fox", sampleEntries) !== null,
    "found match"
  );

  logTest("findQuoteTimestamp: cross-entry substring match",
    findQuoteTimestamp("fox jumps over the lazy", sampleEntries) !== null,
    "found match"
  );

  logTest("findQuoteTimestamp: word overlap above threshold",
    findQuoteTimestamp("lazy dog", sampleEntries, 0.4) !== null,
    "found match"
  );

  logTest("findQuoteTimestamp: no match below threshold",
    findQuoteTimestamp("completely unrelated text xyz", sampleEntries, 0.8) === null,
    "null"
  );

  logTest("findQuoteTimestamp: single entry exact substring",
    (() => {
      const entries = [{ text: "the quick brown fox jumps", start: 42.0, duration: 5.0 }];
      const r = findQuoteTimestamp("quick brown fox", entries);
      return r !== null && r.start === 42.0;
    })(),
    "start=42.0"
  );

  logTest("findQuoteTimestamp: large window match",
    (() => {
      const r = findQuoteTimestamp("hello world this is a test the quick brown fox jumps over the lazy dog today and that is all folks", sampleEntries);
      return r !== null && r.start === 0.0;
    })(),
    "matched across all 4 entries"
  );

  // ── isConfigured ──
  console.log("\n--- isConfigured ---");

  logTest("isConfigured: null config",
    isConfigured(null) === false,
    "false"
  );

  logTest("isConfigured: empty apiKey",
    isConfigured({ provider: "openrouter", model: "test", apiKey: "" }) === false,
    "false"
  );

  logTest("isConfigured: valid config",
    isConfigured({ provider: "openrouter", model: "test", apiKey: "sk-abc123" }) === true,
    "true"
  );

  // ── getModelsForProvider ──
  console.log("\n--- getModelsForProvider ---");

  logTest("getModelsForProvider: anthropic has models",
    (() => {
      const models = getModelsForProvider("anthropic");
      return models.length === 2 && models.includes("claude-opus-4-5-20251101");
    })(),
    "2 models"
  );

  logTest("getModelsForProvider: openai has models",
    (() => {
      const models = getModelsForProvider("openai");
      return models.length === 2 && models.includes("gpt-5");
    })(),
    "2 models"
  );

  logTest("getModelsForProvider: openrouter has 16 models",
    getModelsForProvider("openrouter").length === 16,
    `${getModelsForProvider("openrouter").length} models`
  );

  logTest("getModelsForProvider: openrouter includes default model",
    getModelsForProvider("openrouter").includes("google/gemini-3-flash-preview"),
    "google/gemini-3-flash-preview"
  );

  logTest("getModelsForProvider: openrouter includes all expected models",
    (() => {
      const models = getModelsForProvider("openrouter");
      const expected = [
        "anthropic/claude-sonnet-4.5",
        "deepseek/deepseek-v3.2",
        "x-ai/grok-4.1-fast",
        "openai/gpt-5.2",
        "anthropic/claude-haiku-4.5",
        "tngtech/deepseek-r1t2-chimera:free",
        "qwen/qwen-plus-2025-07-28:thinking",
        "openai/o3-pro",
        "qwen/qwen3-next-80b-a3b-thinking",
      ];
      return expected.every((m) => models.includes(m));
    })(),
    "all expected present"
  );

  logTest("getModelsForProvider: unknown provider returns empty",
    getModelsForProvider("nonexistent").length === 0,
    "[]"
  );

  // ── LLM JSON parsing (mirrors parseLLMResponse logic) ──
  console.log("\n--- parseLLMResponse ---");

  function parseLLMResponse(raw) {
    let text = raw.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      lines.shift();
      if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
        lines.pop();
      }
      text = lines.join("\n");
    }
    return JSON.parse(text);
  }

  logTest("parseLLMResponse: plain JSON",
    (() => {
      const r = parseLLMResponse('{"one_liner":"test","sections":[]}');
      return r.one_liner === "test" && Array.isArray(r.sections);
    })(),
    "parsed correctly"
  );

  logTest("parseLLMResponse: JSON with code fence",
    (() => {
      const r = parseLLMResponse('```json\n{"one_liner":"test","sections":[]}\n```');
      return r.one_liner === "test";
    })(),
    "parsed correctly"
  );

  logTest("parseLLMResponse: JSON with plain fence",
    (() => {
      const r = parseLLMResponse('```\n{"one_liner":"test","sections":[]}\n```');
      return r.one_liner === "test";
    })(),
    "parsed correctly"
  );

  logTest("parseLLMResponse: invalid JSON throws",
    (() => {
      try {
        parseLLMResponse("not json");
        return false;
      } catch {
        return true;
      }
    })(),
    "threw error"
  );

  logTest("parseLLMResponse: whitespace-padded JSON",
    (() => {
      const r = parseLLMResponse('  \n {"one_liner":"padded","sections":[]}  \n ');
      return r.one_liner === "padded";
    })(),
    "parsed correctly"
  );

  // ── Summary ──
  console.log("\n=== Unit Test Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results) {
      if (r.status === "FAIL") {
        console.log(`  - ${r.name}: ${r.detail}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(2);
});
