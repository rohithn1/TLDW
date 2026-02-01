/**
 * Popup UI logic for the TLDW Chrome extension.
 */

import { loadConfig, isConfigured, TLDWConfig } from "./config.js";
import { extractVideoId, fetchTranscript, formatTimestamp, makeTimestampUrl, TranscriptEntry } from "./transcript.js";
import { summarizeVideo, VideoSummary } from "./llm.js";

// DOM elements
const setupBanner = document.getElementById("setupBanner") as HTMLDivElement;
const openOptions = document.getElementById("openOptions") as HTMLAnchorElement;
const settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
const inputArea = document.getElementById("inputArea") as HTMLDivElement;
const urlInput = document.getElementById("urlInput") as HTMLInputElement;
const promptInput = document.getElementById("promptInput") as HTMLTextAreaElement;
const summarizeBtn = document.getElementById("summarizeBtn") as HTMLButtonElement;
const loading = document.getElementById("loading") as HTMLDivElement;
const loadingMsg = document.getElementById("loadingMsg") as HTMLParagraphElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;
const results = document.getElementById("results") as HTMLDivElement;

/**
 * Show or hide elements by toggling CSS classes.
 */
function showLoading(msg: string) {
  loadingMsg.textContent = msg;
  loading.classList.add("visible");
  inputArea.classList.add("hidden");
  results.classList.remove("visible");
  errorMsg.classList.remove("visible");
}

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("visible");
  loading.classList.remove("visible");
  inputArea.classList.remove("hidden");
}

function showResults() {
  results.classList.add("visible");
  loading.classList.remove("visible");
  inputArea.classList.add("hidden");
}

/**
 * Render the summary into the results area.
 */
function renderSummary(summary: VideoSummary, videoId: string) {
  results.innerHTML = "";

  // One-liner
  const oneLiner = document.createElement("div");
  oneLiner.className = "one-liner";
  oneLiner.textContent = summary.one_liner || "No summary available";
  results.appendChild(oneLiner);

  // Sections
  for (let i = 0; i < (summary.sections || []).length; i++) {
    const section = summary.sections[i];
    const sectionEl = document.createElement("div");
    sectionEl.className = "section";

    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = `#${i + 1} ${section.title || `Section ${i + 1}`}`;
    sectionEl.appendChild(title);

    const summaryText = document.createElement("div");
    summaryText.className = "section-summary";
    summaryText.textContent = section.summary || "";
    sectionEl.appendChild(summaryText);

    if (section.quote) {
      const quote = document.createElement("div");
      quote.className = "section-quote";
      quote.textContent = `"${section.quote}"`;
      sectionEl.appendChild(quote);
    }

    const startTime = section._matched_start || 0;
    const ts = formatTimestamp(startTime);
    const url = makeTimestampUrl(videoId, startTime);

    const link = document.createElement("a");
    link.className = "timestamp-link";
    link.href = url;
    link.target = "_blank";
    link.textContent = `\u25B6 ${ts}`;
    link.title = `Jump to ${ts} in video`;
    sectionEl.appendChild(link);

    results.appendChild(sectionEl);
  }

  showResults();
}

/**
 * Main summarize flow.
 */
async function handleSummarize(config: TLDWConfig) {
  const url = urlInput.value.trim();
  if (!url) {
    showError("Please enter a YouTube URL.");
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    showError("Could not extract video ID. Please enter a valid YouTube URL.");
    return;
  }

  const userPrompt = promptInput.value.trim() || null;

  summarizeBtn.disabled = true;
  errorMsg.classList.remove("visible");

  try {
    showLoading("Grabbing the transcript...");

    let entries: TranscriptEntry[];
    try {
      entries = await fetchTranscript(videoId);
    } catch (err: any) {
      showError(`Couldn't get transcript: ${err.message}`);
      summarizeBtn.disabled = false;
      return;
    }

    showLoading(`Got ${entries.length} transcript lines. Summarizing...`);

    const summary = await summarizeVideo(entries, userPrompt, config, (msg) => {
      showLoading(msg);
    });

    renderSummary(summary, videoId);
  } catch (err: any) {
    showError(`Error: ${err.message}`);
  } finally {
    summarizeBtn.disabled = false;
  }
}

/**
 * Initialize the popup.
 */
async function init() {
  const config = await loadConfig();

  // Check if configured
  if (!isConfigured(config)) {
    setupBanner.style.display = "block";
    summarizeBtn.disabled = true;
  }

  // Open options page
  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Settings gear icon
  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Check for URL from context menu or query parameter
  const params = new URLSearchParams(window.location.search);
  const pendingUrl = params.get("url");
  if (pendingUrl) {
    urlInput.value = pendingUrl;
  }

  // Also check for pending URL from background
  try {
    chrome.runtime.sendMessage({ type: "get_pending_url" }, (response) => {
      if (response?.url && !urlInput.value) {
        urlInput.value = response.url;
      }
    });
  } catch {
    // Not in extension context (e.g., opened directly)
  }

  // Summarize button click
  summarizeBtn.addEventListener("click", () => {
    if (config && isConfigured(config)) {
      handleSummarize(config);
    } else {
      showError("Please configure your LLM provider in Settings first.");
    }
  });

  // Enter key on prompt input
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      summarizeBtn.click();
    }
  });
}

init();
