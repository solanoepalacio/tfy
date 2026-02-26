// service-worker.js
// CRITICAL: ALL listeners must be registered at top-level — not inside functions or
// async callbacks. Chrome restores top-level listeners when restarting an idle worker.
// Listeners registered inside async functions will be lost after worker termination.

// ─── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_CATEGORY') {
    // Return true BEFORE async work — keeps the message channel open.
    // Without this, Chrome closes the channel before sendResponse is called.
    handleCategoryRequest(message.videoIds)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async sendResponse
  }
  if (message.type === 'SET_VIDEO_CATEGORY') {
    // sender.tab.id is authoritative — set per-tab scoped key
    chrome.storage.local.set({
      [`currentVideoCategory_${sender.tab.id}`]: message.categoryName
    });
    return; // no async response needed
  }
  if (message.type === 'CLEAR_VIDEO_CATEGORY') {
    chrome.storage.local.remove(`currentVideoCategory_${sender.tab.id}`);
    return;
  }
});

async function handleCategoryRequest(videoIds) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    return { error: 'No API key set. Open the extension popup and enter your YouTube Data API v3 key.' };
  }
  return fetchVideoCategories(videoIds, apiKey);
}

async function fetchVideoCategories(videoIds, apiKey) {
  const ids = videoIds.slice(0, 50).join(','); // API max: 50 IDs per request
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', ids);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const categories = {};
  for (const item of (data.items || [])) {
    categories[item.id] = item.snippet.categoryId;
  }
  return { categories }; // { categories: { videoId: categoryId, ... } }
}

// ─── SPA Navigation Detection ────────────────────────────────────────────────
// youtube.com/watch navigations use pushState — no page reload.
// chrome.webNavigation.onHistoryStateUpdated fires on every pushState call.
// Filter to watch pages only and relay the new videoId to the content script.

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    const url = new URL(details.url);
    const videoId = url.searchParams.get('v');
    if (url.pathname === '/watch' && videoId) {
      // Notify content script — wrap in catch because content script may not
      // be ready yet (e.g., initial tab load race). Failure is non-fatal.
      chrome.tabs.sendMessage(details.tabId, {
        type: 'YT_NAVIGATION',
        videoId
      }).catch(() => {
        // Content script not ready or tab closed — ignore silently
      });
    }
  },
  { url: [{ hostEquals: 'www.youtube.com' }] }
);

// ─── Tab Lifecycle Cleanup ────────────────────────────────────────────────
// TABST-01: Delete per-tab scoped storage key when any tab closes.
// Must be top-level — service worker re-registers listeners from top-level
// synchronous code only. Listeners inside async functions are lost on restart.
// isWindowClosing flag intentionally NOT checked — cleanup always runs
// (each tab in a closing window fires onRemoved individually anyway).
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});

// One-time migration: remove stale unscoped key from pre-Phase-7 versions.
// No-op if key does not exist.
chrome.storage.local.remove('currentVideoCategory');
