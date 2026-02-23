// content-script.js
// Injected into youtube.com/watch* pages at document_idle (URL is stable by then).

// ─── Category Lookup ─────────────────────────────────────────────────────────

async function fetchAndLogCategory(videoId) {
  if (!videoId) return;
  console.log(`[TFY] Detected video: ${videoId}`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_VIDEO_CATEGORY',
      videoIds: [videoId]
    });

    if (!response) {
      console.warn('[TFY] No response from service worker — worker may be starting up. Retrying...');
      // Retry once after 500ms to handle service worker cold-start race
      await new Promise(r => setTimeout(r, 500));
      return fetchAndLogCategory(videoId);
    }

    if (response.error) {
      console.error('[TFY] Error:', response.error);
      return;
    }

    const categoryId = response.categories?.[videoId];
    console.log(`[TFY] Video ${videoId} → category ID: ${categoryId}`);
  } catch (err) {
    console.error('[TFY] sendMessage failed:', err.message);
  }
}

// ─── Initial Load ─────────────────────────────────────────────────────────────
// document_idle guarantees the URL reflects the current video
const initialVideoId = new URL(window.location.href).searchParams.get('v');
fetchAndLogCategory(initialVideoId);

// ─── SPA Navigation (Primary: service worker relay) ───────────────────────────
// Service worker detects pushState via webNavigation.onHistoryStateUpdated
// and sends a YT_NAVIGATION message with the new videoId.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YT_NAVIGATION') {
    fetchAndLogCategory(message.videoId);
  }
});

// ─── SPA Navigation (Fallback: YouTube internal event) ────────────────────────
// yt-navigate-finish is a YouTube-internal custom DOM event fired after the new
// video page finishes rendering. It is undocumented and may change.
// Use only as a belt-and-suspenders fallback alongside the service worker relay.
document.addEventListener('yt-navigate-finish', () => {
  const videoId = new URL(window.location.href).searchParams.get('v');
  fetchAndLogCategory(videoId);
});
