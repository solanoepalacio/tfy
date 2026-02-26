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
      content: attr(data-tfy-label);
      display: block;
      font-size: 11px;
      color: #888;
      padding: 2px 8px;
      line-height: 16px;
    }
    /* SHRT-01: Hide Shorts shelf on watch pages */
    ytd-reel-shelf-renderer,
    ytm-shorts-lockup-view-model-v2 {
      display: none !important;
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

function collapseElement(el, title, categoryName) {
  const label = (title && categoryName)
    ? `hidden: ${categoryName} · ${title}`
    : 'hidden: off-topic';
  el.setAttribute('data-tfy-label', label);
  el.classList.add('tfy-hidden');
}

function resetAllCollapsed() {
  document.querySelectorAll('.tfy-hidden').forEach(el => el.classList.remove('tfy-hidden'));
}

// ─── Session Cache + Filtering Engine ────────────────────────────────────────

let currentCategoryId = null;  // category of the currently-watched video
let sidebarObserver = null;    // MutationObserver instance
let sidebarObserverRetryTimer = null; // handle from observeSidebar's retry setTimeout
const sessionCategoryCache = new Map(); // videoId -> categoryId, reset on navigation
let lastProcessedVideoId = null; // prevents double-filtering when both nav signals fire
let filteringEnabled = true; // module-level; updated by TFY_TOGGLE message

const CATEGORY_NAMES = {
  '1': 'Film & Animation',
  '2': 'Autos & Vehicles',
  '10': 'Music',
  '15': 'Pets & Animals',
  '17': 'Sports',
  '18': 'Short Movies',
  '19': 'Travel & Events',
  '20': 'Gaming',
  '21': 'Videoblogging',
  '22': 'People & Blogs',
  '23': 'Comedy',
  '24': 'Entertainment',
  '25': 'News & Politics',
  '26': 'Howto & Style',
  '27': 'Education',
  '28': 'Science & Technology',
  '29': 'Nonprofits & Activism',
  '30': 'Movies',
  '31': 'Anime/Animation',
  '32': 'Action/Adventure',
  '33': 'Classics',
  '34': 'Comedy',
  '35': 'Documentary',
  '36': 'Drama',
  '37': 'Family',
  '38': 'Foreign',
  '39': 'Horror',
  '40': 'Sci-Fi/Fantasy',
  '41': 'Thriller',
  '42': 'Shorts',
  '43': 'Shows',
  '44': 'Trailers',
};

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
      const titleEl = el.querySelector('h3 a[href*="watch?v="]') || el.querySelector('h3');
      const title = titleEl ? titleEl.textContent.trim() : '';
      const categoryName = CATEGORY_NAMES[cat] || cat;
      collapseElement(el, title, categoryName);
      collapsed++;
    }
  }
}

function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    sidebarObserverRetryTimer = setTimeout(() => observeSidebar(callback), 300);
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
  if (sidebarObserverRetryTimer) {
    clearTimeout(sidebarObserverRetryTimer);
    sidebarObserverRetryTimer = null;
  }
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}

async function initForVideo(videoId) {
  disconnectSidebarObserver();  // idempotency guard — safe to call even if no observer attached
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
    const currentCategoryName = CATEGORY_NAMES[currentCategoryId] || currentCategoryId;
    console.log(`[TFY] Current video category: ${currentCategoryId} (${currentCategoryName})`);
    // Delegate storage write to service worker — it has sender.tab.id, content scripts do not
    chrome.runtime.sendMessage({
      type: 'SET_VIDEO_CATEGORY',
      categoryName: currentCategoryName
    }).catch(() => {}); // Non-fatal — popup shows blank if this fails
  } else {
    console.warn('[TFY] Could not determine current video category — sidebar filtering skipped');
    return;
  }

  await filterSidebar();
  observeSidebar(filterSidebar);
  // Delayed pass to catch items rendered between observer-attach and first MutationObserver callback
  setTimeout(filterSidebar, 1000);
}

// ─── Initial Load ─────────────────────────────────────────────────────────────
// document_idle guarantees the URL reflects the current video.
// Wrapped in async IIFE because content scripts use classic scripts (not ES modules)
// and top-level await is not available without "type": "module" in manifest.
(async () => {
  const { filteringEnabled: storedEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  filteringEnabled = storedEnabled;
  const initialVideoId = new URL(window.location.href).searchParams.get('v');
  if (initialVideoId && filteringEnabled) {
    lastProcessedVideoId = initialVideoId;
    injectTFYStyles();
    initForVideo(initialVideoId);
  }
})();

// ─── SPA Navigation (Primary: service worker relay) ───────────────────────────
// Service worker detects pushState via webNavigation.onHistoryStateUpdated
// and sends a YT_NAVIGATION message with the new videoId.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TFY_TOGGLE') {
    filteringEnabled = message.enabled;
    if (message.enabled) {
      // Re-enable: if we have a current video context, filter immediately
      if (currentCategoryId) {
        filterSidebar();
        observeSidebar(filterSidebar);
      } else if (lastProcessedVideoId) {
        initForVideo(lastProcessedVideoId);
      }
    } else {
      // Disable: reveal all hidden items and stop the observer
      resetAllCollapsed();
      disconnectSidebarObserver();
    }
    return;
  }
  if (message.type === 'YT_NAVIGATION') {
    if (message.videoId === lastProcessedVideoId) return; // deduplicate
    lastProcessedVideoId = message.videoId;

    // Teardown previous video state
    resetAllCollapsed();
    disconnectSidebarObserver();
    sessionCategoryCache.clear();
    currentCategoryId = null;
    chrome.runtime.sendMessage({ type: 'CLEAR_VIDEO_CATEGORY' }).catch(() => {});

    // Initialize filtering for new video
    if (filteringEnabled) { injectTFYStyles(); initForVideo(message.videoId); }
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
  if (filteringEnabled) { injectTFYStyles(); initForVideo(videoId); }
});
