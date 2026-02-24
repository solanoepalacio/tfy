// content-script.js
// Injected into youtube.com/watch* pages at document_idle (URL is stable by then).

// ─── CSS Injection ─────────────────────────────────────────────────────────────

function injectTFYStyles() {
  if (document.getElementById('tfy-styles')) return;
  const style = document.createElement('style');
  style.id = 'tfy-styles';
  style.textContent = `
    yt-lockup-view-model.tfy-hidden {
      max-height: 20px !important;
      overflow: hidden !important;
      opacity: 0.5;
    }
    yt-lockup-view-model.tfy-hidden::before {
      content: 'hidden: off-topic';
      display: block;
      font-size: 11px;
      color: #888;
      padding: 2px 8px;
      line-height: 16px;
    }
  `;
  document.head.appendChild(style);
}

function extractVideoIdFromRenderer(el) {
  try {
    const anchor = el.querySelector('a[href*="watch?v="]');
    if (!anchor) return null;
    return new URL(anchor.href).searchParams.get('v');
  } catch (err) {
    return null;
  }
}

function collapseElement(el) {
  el.classList.add('tfy-hidden');
}

function resetAllCollapsed() {
  document.querySelectorAll('.tfy-hidden').forEach(el => el.classList.remove('tfy-hidden'));
}

// Inject styles immediately so they're available before any filtering runs
injectTFYStyles();

// ─── Session Cache + Filtering Engine ────────────────────────────────────────

let currentCategoryId = null;  // category of the currently-watched video
let sidebarObserver = null;    // MutationObserver instance
const sessionCategoryCache = new Map(); // videoId -> categoryId, reset on navigation
let lastProcessedVideoId = null; // prevents double-filtering when both nav signals fire

async function filterSidebar() {
  if (!currentCategoryId) return;

  const renderers = Array.from(document.querySelectorAll('yt-lockup-view-model'));
  const idToRenderer = new Map();
  for (const el of renderers) {
    const id = extractVideoIdFromRenderer(el);
    if (id) idToRenderer.set(id, el);
  }

  const unknownIds = Array.from(idToRenderer.keys())
    .filter(id => !sessionCategoryCache.has(id))
    .slice(0, 50);

  if (unknownIds.length > 0) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_VIDEO_CATEGORY',
        videoIds: unknownIds
      });
      if (!response || !response.categories) {
        console.warn('[TFY] Sidebar filter: category fetch failed');
        return;
      }
      for (const [id, catId] of Object.entries(response.categories)) {
        sessionCategoryCache.set(id, catId);
      }
    } catch (err) {
      console.warn('[TFY] Sidebar filter: category fetch failed', err.message);
      return;
    }
  }

  let collapsed = 0;
  const total = idToRenderer.size;
  for (const [id, el] of idToRenderer.entries()) {
    const cat = sessionCategoryCache.get(id);
    if (cat !== undefined && cat !== currentCategoryId) {
      collapseElement(el);
      collapsed++;
    }
  }
  console.log(`[TFY] Sidebar filter: collapsed ${collapsed} of ${total} suggestions`);
}

function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    setTimeout(() => observeSidebar(callback), 300);
    return;
  }
  sidebarObserver = new MutationObserver((mutations) => {
    let found = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('yt-lockup-view-model') ||
          node.querySelectorAll('yt-lockup-view-model').length > 0
        ) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) callback();
  });
  sidebarObserver.observe(container, { childList: true, subtree: true });
}

function disconnectSidebarObserver() {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}

async function initForVideo(videoId) {
  // Fetch current video's category
  let response = await chrome.runtime.sendMessage({
    type: 'GET_VIDEO_CATEGORY',
    videoIds: [videoId]
  });

  // Single retry after 500ms to handle service worker cold-start race
  if (!response) {
    await new Promise(r => setTimeout(r, 500));
    response = await chrome.runtime.sendMessage({
      type: 'GET_VIDEO_CATEGORY',
      videoIds: [videoId]
    });
  }

  if (response?.categories?.[videoId]) {
    currentCategoryId = response.categories[videoId];
    console.log(`[TFY] Current video category: ${currentCategoryId}`);
  } else {
    console.warn('[TFY] Could not determine current video category — sidebar filtering skipped');
    return;
  }

  await filterSidebar();
  observeSidebar(filterSidebar);
  // Delayed pass to catch items rendered between observer-attach and first MutationObserver callback
  setTimeout(filterSidebar, 1000);
}

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
if (initialVideoId) {
  lastProcessedVideoId = initialVideoId;
  initForVideo(initialVideoId);
}

// ─── SPA Navigation (Primary: service worker relay) ───────────────────────────
// Service worker detects pushState via webNavigation.onHistoryStateUpdated
// and sends a YT_NAVIGATION message with the new videoId.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YT_NAVIGATION') {
    if (message.videoId === lastProcessedVideoId) return; // deduplicate
    lastProcessedVideoId = message.videoId;

    // Teardown previous video state
    resetAllCollapsed();
    disconnectSidebarObserver();
    sessionCategoryCache.clear();
    currentCategoryId = null;

    // Initialize filtering for new video
    initForVideo(message.videoId);
  }
});

// ─── SPA Navigation (Fallback: YouTube internal event) ────────────────────────
// yt-navigate-finish is a YouTube-internal custom DOM event fired after the new
// video page finishes rendering. It is undocumented and may change.
// Use only as a belt-and-suspenders fallback alongside the service worker relay.
document.addEventListener('yt-navigate-finish', () => {
  const videoId = new URL(window.location.href).searchParams.get('v');
  if (!videoId || videoId === lastProcessedVideoId) return; // deduplicate
  lastProcessedVideoId = videoId;

  // Teardown previous video state
  resetAllCollapsed();
  disconnectSidebarObserver();
  sessionCategoryCache.clear();
  currentCategoryId = null;

  // Initialize filtering for new video
  initForVideo(videoId);
});
