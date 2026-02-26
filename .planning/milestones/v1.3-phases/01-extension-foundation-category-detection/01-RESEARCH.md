# Phase 1: Extension Foundation + Category Detection - Research

**Researched:** 2026-02-23
**Domain:** Chrome Manifest V3 extension development + YouTube Data API v3
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-01 | Chrome Manifest v3 extension with service worker, content script, and popup | manifest.json structure, background.service_worker, content_scripts, action.default_popup — all verified via official Chrome docs |
| CORE-02 | User can enter YouTube Data API v3 key once, persisted across sessions | chrome.storage.local — verified async get/set API, 10 MB limit, persists until extension removal |
| CORE-03 | Extension re-initializes filtering on YouTube SPA navigation (no page reload needed) | chrome.webNavigation.onHistoryStateUpdated fires on YouTube pushState; yt-navigate-finish custom DOM event also available as fallback — both verified |
| CATD-01 | Extension extracts video ID from the current YouTube watch page | URLSearchParams.get('v') on window.location — simple, reliable, no regex needed for standard /watch?v= pages |
| CATD-02 | Extension detects the current video's category via YouTube Data API v3 | videos.list with part=snippet returns snippet.categoryId; 1 quota unit per batch of up to 50 IDs — verified via Google docs |
</phase_requirements>

---

## Summary

This phase builds a complete Chrome MV3 extension skeleton: a service worker, a content script, and a popup — then wires up the full data pipeline from "user navigates to a YouTube video" to "category ID logged in console." It is pure plumbing work; no UI beyond a minimal API-key input field is needed.

The single most important constraint that shapes every architectural decision is that **content scripts cannot make cross-origin requests** even when the extension holds `host_permissions`. This is a security enforcement by Chrome, not a configuration issue. All calls to `https://www.googleapis.com` must be made in the service worker and the result relayed back to the content script via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. This pattern is officially documented and must be the foundation of this phase.

YouTube navigates between videos without full page reloads (SPA). The content script is injected once per page load, so re-detection of navigation must be handled either through `chrome.webNavigation.onHistoryStateUpdated` (reliable, fires in the service worker) or by listening to the `yt-navigate-finish` DOM custom event inside the content script. Both approaches are valid; combining them provides maximum coverage.

**Primary recommendation:** Build a plain-JavaScript (no bundler) MV3 extension. Three files drive all logic: `manifest.json`, `service-worker.js`, and `content-script.js`. Add a minimal `popup.html` + `popup.js` for API key input. No third-party libraries are needed or recommended for this phase.

---

## Standard Stack

### Core

| Library/API | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Chrome Extensions MV3 | Current (Chrome 120+) | Extension platform | Required by Chrome for all new extensions |
| chrome.storage.local | Built-in | Persist API key across sessions | Extension-specific, survives browser restart, accessible from all extension contexts |
| chrome.runtime.sendMessage / onMessage | Built-in | Content script → service worker → content script message relay | Official Chrome IPC mechanism for cross-context communication |
| chrome.webNavigation.onHistoryStateUpdated | Built-in | Detect YouTube SPA navigation from service worker | Fires on pushState; lets service worker notify content script of new video |
| YouTube Data API v3 videos.list | REST | Get snippet.categoryId for video IDs | Official Google API; snippet.categoryId is the only stable category signal |

### Supporting

| Library/API | Version | Purpose | When to Use |
|-------------|---------|---------|-------------|
| URLSearchParams | Browser built-in | Extract video ID from current URL | Use in content script: `new URL(window.location.href).searchParams.get('v')` |
| fetch() | Browser built-in | HTTP call to YouTube API from service worker | Service workers do not support XMLHttpRequest; fetch() is the correct replacement |
| yt-navigate-finish DOM event | YouTube internal | Secondary SPA nav signal in content script | Use as a fallback listener inside content script alongside URL polling |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain JS (no bundler) | Webpack / Vite with TypeScript | Bundler adds toolchain complexity unnecessary for a ~3-file personal extension; TypeScript brings value at scale, not for this POC |
| chrome.storage.local | chrome.storage.sync | Sync requires Google sign-in and has 8 KB per-item limit; local is simpler and sufficient for single-device personal use |
| chrome.webNavigation.onHistoryStateUpdated | MutationObserver in content script | webNavigation fires in service worker (already the right place to orchestrate), doesn't depend on DOM stability; MutationObserver requires DOM selector tuning after every YouTube redesign |
| YouTube Data API v3 | Scraping YouTube page DOM | DOM scraping breaks when YouTube updates markup; API is stable and returns category reliably |

**Installation:** No npm dependencies. This is a plain-file Chrome extension loaded via developer mode (`chrome://extensions` → Load unpacked). No `npm install` required for Phase 1.

---

## Architecture Patterns

### Recommended Project Structure

```
tfy/
├── manifest.json              # Extension manifest (MV3)
├── service-worker.js          # Background: API calls, message relay, navigation events
├── content-script.js          # Injected into youtube.com/watch: reads URL, listens for nav
├── popup.html                 # API key input UI
├── popup.js                   # Reads/writes API key to chrome.storage.local
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Pattern 1: Content Script → Service Worker API Proxy

**What:** Content script cannot call googleapis.com directly. It sends a message to the service worker carrying the video ID(s), the service worker reads the API key from storage and performs the fetch, then sends the result back.

**When to use:** Always — this is the only valid architecture for cross-origin calls from MV3 extensions.

**Example:**
```javascript
// content-script.js
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

async function fetchCategoryForVideo(videoId) {
  const response = await chrome.runtime.sendMessage({
    type: 'GET_VIDEO_CATEGORY',
    videoIds: [videoId]
  });
  if (response.error) {
    console.error('[TFY] API error:', response.error);
    return null;
  }
  return response.categories; // { [videoId]: categoryId }
}
```

```javascript
// service-worker.js
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_CATEGORY') {
    handleCategoryRequest(message.videoIds, sendResponse);
    return true; // Keep channel open for async response
  }
});

async function handleCategoryRequest(videoIds, sendResponse) {
  try {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
      sendResponse({ error: 'No API key configured' });
      return;
    }
    const ids = videoIds.join(','); // up to 50 IDs per request
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const categories = {};
    for (const item of data.items) {
      categories[item.id] = item.snippet.categoryId;
    }
    sendResponse({ categories });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}
```

### Pattern 2: SPA Navigation Detection

**What:** YouTube never does a full page reload between videos. The content script is only injected once. Navigation must be detected continuously.

**When to use:** Always on YouTube — SPA is YouTube's default navigation mode.

**Approach A (preferred): Service worker detects navigation, re-injects or messages content script**

```javascript
// service-worker.js
// Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.url.includes('youtube.com/watch')) {
    // Notify the content script that URL has changed
    chrome.tabs.sendMessage(details.tabId, {
      type: 'YT_NAVIGATION',
      url: details.url
    });
  }
}, { url: [{ hostContains: 'youtube.com' }] });
```

```javascript
// content-script.js — receives navigation event from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YT_NAVIGATION') {
    const videoId = new URL(message.url).searchParams.get('v');
    if (videoId) {
      onVideoChanged(videoId);
    }
  }
});
```

**Approach B (fallback inside content script): yt-navigate-finish DOM event**

```javascript
// content-script.js — secondary approach, YouTube fires this custom event
document.addEventListener('yt-navigate-finish', () => {
  const videoId = new URL(window.location.href).searchParams.get('v');
  if (videoId) {
    onVideoChanged(videoId);
  }
});
```

### Pattern 3: API Key Storage and Retrieval

**What:** User enters API key once in popup; all extension contexts read from chrome.storage.local.

```javascript
// popup.js
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage

document.getElementById('save-btn').addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value.trim();
  await chrome.storage.local.set({ apiKey: key });
  document.getElementById('status').textContent = 'Saved.';
});

// Load existing key on popup open
document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('api-key-input').value = apiKey;
  }
});
```

### Pattern 4: Minimal manifest.json for This Phase

```json
{
  "manifest_version": 3,
  "name": "TFY — Topic Focused YouTube",
  "version": "0.1.0",
  "description": "Filters YouTube sidebar to keep you on-topic",
  "permissions": [
    "storage",
    "webNavigation"
  ],
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://www.youtube.com/*"
  ],
  "background": {
    "service_worker": "service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/watch*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

### Anti-Patterns to Avoid

- **Making fetch() from content script to googleapis.com:** Chrome will block it with a CORS error regardless of host_permissions. host_permissions only apply to the service worker context.
- **Storing API key in localStorage:** Content scripts share the page's localStorage (youtube.com's), not the extension's. Use chrome.storage.local exclusively.
- **Registering event listeners asynchronously in service worker:** Chrome may miss events if listeners are not registered at the top level of the service worker script.
- **Using setTimeout/setInterval in service worker for polling:** Service worker is terminated after 30 seconds of inactivity; timers are cancelled. Use chrome.alarms or event-driven patterns instead.
- **Only listening to window.onload for navigation:** YouTube never fully reloads the page between videos; DOMContentLoaded and load only fire on the initial tab open.
- **Checking URL on document_start:** Run content script at document_idle; at document_start the URL may not yet reflect the video being watched.
- **Targeting "https://www.youtube.com/*" in content_scripts matches:** This would inject on all YouTube pages (homepage, search, etc.). Target "https://www.youtube.com/watch*" to limit injection to video pages only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-origin API calls from content script | Custom CORS workaround, background fetch polyfill | chrome.runtime.sendMessage relay to service worker | The only correct solution; CORS workarounds don't work in MV3 |
| Persistent key-value storage | Custom localStorage wrapper | chrome.storage.local | localStorage from content script writes to youtube.com's storage, not extension storage |
| SPA navigation detection | Polling setInterval on URL | chrome.webNavigation.onHistoryStateUpdated | webNavigation fires exactly when pushState fires; polling burns CPU and races with DOM state |
| YouTube video ID extraction | Custom regex for all YouTube URL formats | `new URL(window.location.href).searchParams.get('v')` | Standard /watch?v= format; URLSearchParams handles encoding correctly and requires no regex |
| YouTube API batching logic | Custom queue/batch system | Comma-separated `id` parameter in videos.list | Google's API natively accepts up to 50 comma-separated video IDs in one request costing 1 quota unit |

**Key insight:** MV3 Chrome extension APIs already solve every infrastructure problem in this phase. Building custom solutions for storage, messaging, or navigation detection would reintroduce exactly the bugs those APIs were designed to prevent.

---

## Common Pitfalls

### Pitfall 1: Content Script Cross-Origin Request Failure

**What goes wrong:** Developer puts `host_permissions: ["https://www.googleapis.com/*"]` in manifest.json and calls `fetch(googelapis_url)` from the content script, expecting it to work. Chrome blocks the request with a CORS or network error.

**Why it happens:** Content scripts run in the context of the web page (youtube.com), not the extension origin. host_permissions apply to the extension origin (the service worker), not to content scripts.

**How to avoid:** ALL calls to external APIs must be made in `service-worker.js`. Content script sends a `chrome.runtime.sendMessage` and awaits the response. Service worker performs `fetch()` and replies with `sendResponse()`.

**Warning signs:** `fetch` from content script returns "Failed to fetch" or browser console shows CORS error for googleapis.com.

### Pitfall 2: Service Worker Silently Killed, Message Lost

**What goes wrong:** Content script sends a message, but the service worker was terminated by Chrome before the listener re-registered, so the message is never received.

**Why it happens:** Service workers are ephemeral; Chrome terminates them after ~30 seconds of inactivity. On the next event, Chrome restarts the worker, but if the message arrived during the gap, it may be lost.

**How to avoid:** Register all `chrome.runtime.onMessage.addListener` calls at the top level of the service worker script (not inside functions or event handlers). Top-level listeners are restored when Chrome restarts the worker. For Phase 1, message-driven fetch calls will inherently re-wake the worker.

**Warning signs:** Intermittent failures where category fetch works sometimes but not others; service worker shows "(inactive)" in chrome://extensions.

### Pitfall 3: Async sendResponse in onMessage Without `return true`

**What goes wrong:** Service worker's `onMessage` listener does async work (awaits fetch), but the message channel closes before `sendResponse` is called because the listener returned `undefined`.

**Why it happens:** Chrome closes the message channel after the listener returns unless the listener explicitly returns `true` (keeping the channel open).

**How to avoid:** Always `return true` from `onMessage` when the response will be sent asynchronously. Chrome 146+ supports returning a Promise directly, but `return true` is safer for cross-version compatibility.

**Warning signs:** `sendResponse` call appears to succeed but content script receives `undefined` or `null` as the response.

### Pitfall 4: YouTube SPA Navigation Missed After Initial Inject

**What goes wrong:** Content script detects the video on initial page load but never detects subsequent navigation (clicking another video in sidebar/search). Appears to work but silently stops after first video.

**Why it happens:** content_scripts are injected once per page load. YouTube doesn't reload the page on video navigation.

**How to avoid:** Implement BOTH the `chrome.webNavigation.onHistoryStateUpdated` relay in the service worker AND the `yt-navigate-finish` listener inside the content script. The webNavigation approach is more reliable; yt-navigate-finish is a YouTube-internal event that may change.

**Warning signs:** Console logs only appear for the first video visited in a tab, not for subsequent navigation.

### Pitfall 5: YouTube Data API Quota Exhaustion

**What goes wrong:** Extension makes one API call per video (1 quota unit), and the user watches many videos in a day, approaching the 10,000 unit/day default limit.

**Why it happens:** Each `videos.list` call with `part=snippet` costs 1 quota unit. Phase 1 only fetches 1 video ID per navigation, so cost is minimal. However, Phase 2 will fetch up to 50 sidebar IDs per navigation.

**How to avoid for Phase 1:** Each navigation to a watch page calls videos.list with one video ID = 1 unit. For 10,000 units/day, a user would need to navigate to 10,000 distinct videos in a day (not a real risk). No caching needed in Phase 1, but document the pattern for Phase 2.

**Warning signs:** API returns HTTP 403 with `quotaExceeded` in the error body.

### Pitfall 6: content_scripts match pattern too broad

**What goes wrong:** Using `"https://www.youtube.com/*"` injects the content script on YouTube homepage, search results, channel pages, etc. Script runs unnecessarily everywhere.

**Why it happens:** Overly broad match pattern.

**How to avoid:** Use `"https://www.youtube.com/watch*"` to target only video watch pages where a `v` query parameter will be present.

**Warning signs:** Content script `console.log` appears on YouTube homepage.

---

## Code Examples

Verified patterns from official sources:

### Full manifest.json for Phase 1
```json
{
  "manifest_version": 3,
  "name": "TFY — Topic Focused YouTube",
  "version": "0.1.0",
  "description": "Filters YouTube sidebar suggestions to stay on-topic",
  "permissions": ["storage", "webNavigation"],
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://www.youtube.com/*"
  ],
  "background": {
    "service_worker": "service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/watch*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

### Extract Video ID from URL
```javascript
// content-script.js
// Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
// (URLSearchParams is the standard browser API for query parameter parsing)

function getCurrentVideoId() {
  return new URL(window.location.href).searchParams.get('v');
}
```

### chrome.storage.local — Get/Set API Key
```javascript
// popup.js
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage

async function saveApiKey(key) {
  await chrome.storage.local.set({ apiKey: key });
}

async function getApiKey() {
  const result = await chrome.storage.local.get('apiKey');
  return result.apiKey || null;
}
```

### YouTube Data API v3 — Fetch Category by Video ID
```javascript
// service-worker.js
// Source: https://developers.google.com/youtube/v3/docs/videos/list
// Quota cost: 1 unit per call regardless of how many IDs (up to 50)

async function fetchVideoCategories(videoIds, apiKey) {
  const ids = videoIds.slice(0, 50).join(','); // max 50 per request
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', ids);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`YouTube API error: ${res.status}`);
  }
  const data = await res.json();

  const result = {};
  for (const item of (data.items || [])) {
    result[item.id] = item.snippet.categoryId;
  }
  return result; // { videoId: categoryId, ... }
}
```

### Service Worker — Full Message Handler
```javascript
// service-worker.js
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

// CRITICAL: Register at top-level — not inside an async function
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_CATEGORY') {
    // Return true BEFORE the async work to keep channel open
    handleCategoryRequest(message.videoIds)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  }
});

async function handleCategoryRequest(videoIds) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    return { error: 'No API key set. Please open extension popup and enter your YouTube API key.' };
  }
  const categories = await fetchVideoCategories(videoIds, apiKey);
  return { categories };
}
```

### Navigation Detection — Service Worker Side
```javascript
// service-worker.js
// Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation

// CRITICAL: Register at top-level
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    const url = new URL(details.url);
    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      chrome.tabs.sendMessage(details.tabId, {
        type: 'YT_NAVIGATION',
        videoId: url.searchParams.get('v')
      }).catch(() => {
        // Content script may not be ready yet — ignore
      });
    }
  },
  { url: [{ hostEquals: 'www.youtube.com' }] }
);
```

### Navigation Detection — Content Script Fallback
```javascript
// content-script.js
// yt-navigate-finish is a YouTube internal event — may change; use as fallback only

document.addEventListener('yt-navigate-finish', () => {
  const videoId = new URL(window.location.href).searchParams.get('v');
  if (videoId) {
    chrome.runtime.sendMessage({ type: 'GET_VIDEO_CATEGORY', videoIds: [videoId] })
      .then(response => {
        if (response && response.categories) {
          const categoryId = response.categories[videoId];
          console.log(`[TFY] Video ${videoId} → category ${categoryId}`);
        }
      });
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MV2 background pages (persistent) | MV3 service workers (ephemeral) | Chrome 88+ MV3 introduced; MV2 deprecated 2023 | Service workers terminate when idle — no global state, no XMLHttpRequest, use fetch() |
| XMLHttpRequest in background | fetch() in service worker | MV3 (2020) | Service workers don't support XHR; fetch() is the required replacement |
| Sync message passing in background | Async sendMessage with `return true` | MV3 | All Chrome APIs are promise-based; message responses require explicit channel-keep-alive |
| background.page persistent script | background.service_worker | MV3 | Worker is event-driven, not persistent |
| content script XHR to external APIs | Service worker proxy pattern | Chrome 73+ security change | Content scripts blocked from cross-origin requests regardless of host_permissions |

**Deprecated/outdated:**
- `background.persistent: true` in manifest: Not supported in MV3. Removed.
- `XMLHttpRequest` in service workers: Not available. Use `fetch()`.
- `chrome.extension.sendRequest`: Removed. Use `chrome.runtime.sendMessage`.
- `background.scripts` array (MV2): Replaced by `background.service_worker` (single file) in MV3.
- Returning a Promise from `onMessage` listener to send async response: Only supported Chrome 146+; use `return true` + `sendResponse()` for broader compatibility.

---

## Open Questions

1. **Does `yt-navigate-finish` remain reliable in 2026?**
   - What we know: It has been used by many YouTube extension developers (vidIQ, various open-source extensions). It fires after YouTube finishes rendering the new video page.
   - What's unclear: It is an internal YouTube event, not a documented public API. YouTube may rename or remove it.
   - Recommendation: Use `chrome.webNavigation.onHistoryStateUpdated` as the primary mechanism (it's a Chrome API, stable). Use `yt-navigate-finish` as a belt-and-suspenders fallback in the content script. Do not depend on it exclusively.

2. **Service worker messaging race condition on first load**
   - What we know: On initial page load, the content script may be ready before the service worker has fully initialized and registered its listeners.
   - What's unclear: The exact timing window where messages can be dropped.
   - Recommendation: In the content script, wrap the initial `sendMessage` in a small retry loop (up to 3 attempts with 500ms delay) if the response is null/undefined. This covers the race without complex lifecycle tracking.

3. **YouTube API categoryId vs. snippet.categoryId mapping**
   - What we know: `snippet.categoryId` returns a numeric string (e.g., "28" for Science & Technology). Phase 1 only needs to log this — no human-readable name lookup is required.
   - What's unclear: Whether the category IDs are stable across regions. YouTube's `videoCategories.list` endpoint returns region-specific category names for a given categoryId.
   - Recommendation: For Phase 1, log the raw categoryId. Phase 2 can optionally fetch the category name via `videoCategories.list` if needed.

---

## Sources

### Primary (HIGH confidence)

- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests — Cross-origin request rules for content scripts vs service workers
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging — sendMessage, onMessage, async response with `return true`
- https://developer.chrome.com/docs/extensions/reference/api/storage — chrome.storage.local get/set, 10 MB limit, accessibility from all extension contexts
- https://developer.chrome.com/docs/extensions/reference/api/webNavigation — onHistoryStateUpdated fires on pushState
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts — matches patterns, run_at values, all fields
- https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events — 30-second termination timer, top-level listener registration requirement
- https://developers.google.com/youtube/v3/docs/videos/list — part=snippet, snippet.categoryId, comma-separated id parameter for batching

### Secondary (MEDIUM confidence)

- https://www.javaspring.net/blog/detect-youtube-video-change-with-injected-javascript/ — Combined MutationObserver + History API approach for SPA detection; confirms need for dual-method strategy
- https://developers.google.com/youtube/v3/determine_quota_cost — 1 quota unit per videos.list call regardless of batch size (up to 50 IDs)

### Tertiary (LOW confidence — for validation)

- yt-navigate-finish event: Widely reported by YouTube extension developers (multiple GitHub projects) but undocumented by YouTube. Treat as unstable implementation detail.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are official Chrome and Google docs, verified 2026
- Architecture: HIGH — message proxy pattern is the only valid MV3 cross-origin architecture; officially documented
- Pitfalls: HIGH — cross-origin restriction, return-true requirement, and service-worker termination are all documented behaviors; yt-navigate-finish reliability is MEDIUM (undocumented event)

**Research date:** 2026-02-23
**Valid until:** 2026-08-23 (Chrome extension APIs are stable; YouTube Data API v3 has been stable for years; yt-navigate-finish reliability should be re-verified if YouTube ships a major frontend rewrite)
