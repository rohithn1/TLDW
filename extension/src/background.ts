/**
 * Background service worker for the TLDW Chrome extension.
 * Handles context menu creation and click events.
 */

// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tldw-summarize",
    title: "TL;DW",
    contexts: ["link"],
  });
});

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
