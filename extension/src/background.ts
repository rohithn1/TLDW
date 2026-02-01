/**
 * Background service worker for the TLDW Chrome extension.
 * Handles context menu creation and click events.
 */

const YOUTUBE_URL_PATTERNS = [
  "*://www.youtube.com/watch*",
  "*://youtube.com/watch*",
  "*://m.youtube.com/watch*",
  "*://youtu.be/*",
  "*://www.youtube.com/embed/*",
  "*://youtube.com/embed/*",
  "*://www.youtube.com/shorts/*",
  "*://youtube.com/shorts/*",
];

/**
 * Ensure the context menu item exists. Uses removeAll + create to avoid
 * "duplicate id" errors when the service worker restarts.
 */
function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "tldw-summarize",
      title: "Summarize with TL;DW",
      contexts: ["link"],
      targetUrlPatterns: YOUTUBE_URL_PATTERNS,
    });
  });
}

// Create context menu on install/update
chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
});

// Re-create context menu on browser startup (service worker may have been killed)
chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

// Also ensure menu exists whenever the service worker wakes up.
// This covers edge cases where Chrome kills and restarts the worker
// outside of onInstalled/onStartup (e.g. after idle timeout).
ensureContextMenu();

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tldw-summarize" && info.linkUrl) {
    // Store the URL so the popup can read it
    chrome.storage.local.set({ tldw_pending_url: info.linkUrl }, () => {
      // Open the popup by showing the extension
      // Note: We can't programmatically open the popup, so we open it in a new tab
      // with the URL as a parameter
      const popupUrl = chrome.runtime.getURL("popup.html") + "?url=" + encodeURIComponent(info.linkUrl!);

      chrome.tabs.create({ url: popupUrl });
    });
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "get_pending_url") {
    chrome.storage.local.get("tldw_pending_url", (result) => {
      sendResponse({ url: result.tldw_pending_url || null });
      // Clear it after reading
      chrome.storage.local.remove("tldw_pending_url");
    });
    return true; // Keep message channel open for async response
  }
});
