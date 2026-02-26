# Architecture Research

**Domain:** Chrome Extension (YouTube sidebar filter)
**Researched:** 2026-02-26 (updated for v1.3 bug fixes)
**Confidence:** HIGH

Sources are Chrome official documentation (developer.chrome.com) and YouTube Data API v3 official documentation (developers.google.com/youtube/v3). All architectural patterns below are verified against current Manifest V3 official docs.

---

## v1.3 Bug Fix Architecture (Current Milestone)

This section covers the integration-point analysis for two runtime bugs being fixed in v1.3. The original v1.0 architecture is preserved below.

### The Two Bugs — Root Cause Analysis

**Bug 1: Tab Close — Stale Category in Popup**

The popup reads `currentVideoCategory` from `chrome.storage.local` on every open. This key is written by the content script when it determines the current video's category. Nothing clears it when the tab closes.

`service-worker.js` currently has no `chrome.tabs.onRemoved` listener. The fix is to add one.

**Bug 2: SPA Navigation — Content Script Not Re-Triggered**

The content script match pattern in `manifest.json` is `https://www.youtube.com/watch*`. This means Chrome only injects the content script on tabs that navigate directly to a watch page (full page load). If the user starts on the YouTube homepage (`youtube.com`) and clicks a video, YouTube does a SPA navigation — no page reload, so the content script is never injected into that tab at all.

The existing dual mechanism in `service-worker.js` (`webNavigation.onHistoryStateUpdated` relay) fires and tries to `chrome.tabs.sendMessage()` the content script, but the content script doesn't exist in that tab yet. The `.catch(() => {})` swallows the failure silently.

The fix is to expand the content script match pattern to cover all YouTube pages, handle the case where the URL is not a watch page on initial injection, and let the existing `YT_NAVIGATION` relay trigger `initForVideo()` when the user navigates to a watch page.

**Multi-Tab Scoping Problem**

`currentVideoCategory` in `chrome.storage.local` is a single global value. When multiple YouTube tabs are open, the popup shows whichever tab last set it, which may not be the active tab. Fix: key the stored category by `tabId`, and have the popup query the active tab's ID to read the right entry.

---

### Fix 1: Tab Close Detection

**Where the change lives:** `service-worker.js` only.

**API:** `chrome.tabs.onRemoved`

Callback signature: `(tabId: number, removeInfo: { windowId: number, isWindowClosing: boolean }) => void`

**Permission requirement:** `chrome.tabs.onRemoved` does NOT require the `"tabs"` permission. The `"tabs"` permission is only needed to access sensitive tab properties (`url`, `title`, `favIconUrl`). The event listener and `tabId` are available with no additional manifest change. The current manifest (`"storage"`, `"webNavigation"`, `"activeTab"`) is sufficient.

**What to clear:** `currentVideoCategory_<tabId>` (per-tab keyed entry — see multi-tab below). If using multi-tab scoped storage, delete only the entry for the closed tab.

**isWindowClosing flag:** When a window closes, `isWindowClosing: true` and `onRemoved` fires once per tab in that window. Each fire has the correct `tabId`. The cleanup logic is the same regardless of `isWindowClosing` — always remove the entry for that `tabId`.

**Integration point:** The listener must be registered at top level in `service-worker.js`, not inside a function or async callback. MV3 service workers restore only top-level listeners after idle termination. This is already the pattern used for the existing `chrome.runtime.onMessage` and `chrome.webNavigation.onHistoryStateUpdated` listeners.

```javascript
// service-worker.js — add at top level alongside existing listeners
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});
```

**Data flow change:**

```
Before:
  content-script.js → chrome.storage.local.set({ currentVideoCategory: name })
  popup.js          → chrome.storage.local.get('currentVideoCategory')  [reads single global]
  [tab closes]      → nothing clears currentVideoCategory

After:
  content-script.js → chrome.storage.local.set({ [`currentVideoCategory_${tabId}`]: name })
  popup.js          → chrome.tabs.query({active,currentWindow}) → get tabId
                    → chrome.storage.local.get(`currentVideoCategory_${tabId}`)
  service-worker.js → chrome.tabs.onRemoved → remove(`currentVideoCategory_${tabId}`)
```

**How the content script gets its own tabId:** Content scripts do not have direct access to their `tabId`. The standard pattern is to call `chrome.runtime.sendMessage({ type: 'GET_TAB_ID' })` once on injection and have the service worker respond with `sender.tab.id`. Alternatively, `chrome.tabs.getCurrent()` is not available in content scripts. The `sender` object in the service worker's `onMessage` handler already contains `sender.tab.id` — this is the reliable way to obtain the tab's ID from within a content script context.

A simpler alternative: content script sends `{ type: 'STORE_CATEGORY', categoryName, videoId }` to the service worker, and the service worker uses `sender.tab.id` to key the storage write. This keeps the tabId knowledge in the service worker where it's naturally available.

---

### Fix 2: SPA Navigation — Expanded Content Script Injection

**Where the change lives:** `manifest.json` (match pattern) + `content-script.js` (guard on initial run).

**Root cause:** The content script match pattern `https://www.youtube.com/watch*` means the script is only injected on tabs that load a watch URL. YouTube SPA navigation from the homepage does not trigger a new injection.

**Fix:** Expand the match pattern to `https://www.youtube.com/*` so the content script is present in all YouTube tabs regardless of starting URL.

**Guard on initial run:** The IIFE at the bottom of `content-script.js` must guard against running `initForVideo()` on non-watch pages:

```javascript
// Already correct — guard is present:
const initialVideoId = new URL(window.location.href).searchParams.get('v');
if (initialVideoId && filteringEnabled) {
  lastProcessedVideoId = initialVideoId;
  initForVideo(initialVideoId);
}
```

When the content script is injected on `youtube.com` (homepage), `initialVideoId` is null, so the IIFE exits cleanly. The existing `YT_NAVIGATION` message handler then fires when the user navigates to a watch page.

**CSS injection side effect:** `injectTFYStyles()` is called unconditionally at module load, before the IIFE. This is correct — styles are injected but only applied when elements with `.tfy-hidden` exist. No visible effect on non-watch pages. No change needed here.

**The `yt-navigate-finish` fallback:** The existing listener already guards with `const videoId = new URL(window.location.href).searchParams.get('v'); if (!videoId ...) return;` — this correctly does nothing on non-watch pages. No change needed here either.

**Manifest change required:**

```json
// manifest.json — change matches in content_scripts
"content_scripts": [
  {
    "matches": ["https://www.youtube.com/*"],   // was: ["https://www.youtube.com/watch*"]
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }
]
```

**Integration point:** The service worker's `webNavigation.onHistoryStateUpdated` listener already filters to `{ url: [{ hostEquals: 'www.youtube.com' }] }` and checks `url.pathname === '/watch'` before sending the `YT_NAVIGATION` message. No change needed in `service-worker.js` for the SPA fix.

---

### Fix 3: Multi-Tab Category Scoping

**Where the change lives:** `content-script.js` (write), `service-worker.js` (write + clear), `popup.js` (read).

**Problem:** `chrome.storage.local.set({ currentVideoCategory: name })` in `content-script.js` writes a single global key. With two YouTube tabs open, the popup always shows the last-written value regardless of which tab is active.

**Solution:** Key the stored value by tabId. The content script cannot directly access its own tabId, so the write must go through the service worker.

**Recommended approach — route the storage write through the service worker:**

Content script sends a message to store the category. Service worker uses `sender.tab.id` (available in the `onMessage` handler's `sender` argument) to write a per-tab key:

```javascript
// content-script.js — replace direct storage write
// Before: chrome.storage.local.set({ currentVideoCategory: currentCategoryName });
// After:
chrome.runtime.sendMessage({
  type: 'STORE_CURRENT_CATEGORY',
  categoryName: currentCategoryName
});

// service-worker.js — add handler
if (message.type === 'STORE_CURRENT_CATEGORY') {
  const tabId = sender.tab.id;
  chrome.storage.local.set({ [`currentVideoCategory_${tabId}`]: message.categoryName });
  return false; // no async response needed
}

// service-worker.js — tab close clears only this tab's entry
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});

// popup.js — read category for active tab only
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const key = `currentVideoCategory_${tab.id}`;
const result = await chrome.storage.local.get(key);
if (result[key]) {
  document.getElementById('current-category').textContent = `Watching: ${result[key]}`;
}
```

**Storage key cleanup on navigation:** When the content script detects a `YT_NAVIGATION` and calls `chrome.storage.local.remove('currentVideoCategory')`, it must also notify the service worker to remove the per-tab key, or the service worker can listen for `YT_NAVIGATION` relay and clear the key then. The cleaner path: content script sends `STORE_CURRENT_CATEGORY` with `null` or `undefined` when tearing down a video, and the service worker removes the key.

---

### Build Order for v1.3

The two bugs have an ordering dependency: the multi-tab scoping change (Fix 3) touches the same storage key that Fix 1 clears. They must be implemented together. Fix 2 is independent.

**Recommended order:**

1. **Fix 2 first — manifest + SPA injection guard**
   - Single-file manifest change + verify the IIFE guard is correct
   - No storage schema changes
   - Easiest to test: navigate YouTube from homepage → watch page
   - No downstream impact on other fixes

2. **Fix 1 + Fix 3 together — tab close + multi-tab keying**
   - Must be done together: if you add `onRemoved` to clear `currentVideoCategory` (singular), but the popup is reading a per-tab key, they're out of sync
   - Changes `content-script.js` (write path), `service-worker.js` (handler + onRemoved), `popup.js` (read path)
   - Test: open two YouTube tabs, verify popup shows correct tab's category; close tab, verify popup clears

**No new files required.** All three fixes are modifications to existing files. No new modules, no new manifest entries beyond the match pattern change and potentially the `"tabs"` permission (which is not needed — confirmed above).

---

### Component Changes Summary

| File | Change Type | What Changes |
|------|-------------|--------------|
| `manifest.json` | Modify | Content script `matches` pattern: `watch*` → `/*` |
| `service-worker.js` | Modify — add | `chrome.tabs.onRemoved` listener at top level |
| `service-worker.js` | Modify — add | `STORE_CURRENT_CATEGORY` message handler |
| `content-script.js` | Modify | Replace `chrome.storage.local.set({ currentVideoCategory })` with `sendMessage({ type: 'STORE_CURRENT_CATEGORY' })` |
| `popup.js` | Modify | Read `currentVideoCategory_${tabId}` instead of `currentVideoCategory` |

No new files. No new npm dependencies. No build step changes.

---

### Integration Points Explicit

| Integration Point | Before | After |
|-------------------|--------|-------|
| Content script stores category | `chrome.storage.local.set()` directly | `chrome.runtime.sendMessage({ type: 'STORE_CURRENT_CATEGORY' })` |
| Service worker knows tabId | N/A | `sender.tab.id` in onMessage handler |
| Storage key for category | `currentVideoCategory` (global) | `currentVideoCategory_${tabId}` (per-tab) |
| Tab close handling | Not handled | `chrome.tabs.onRemoved` clears per-tab key |
| Popup reads category | Global key lookup | Queries active tabId first, then reads per-tab key |
| Content script injection scope | `youtube.com/watch*` | `youtube.com/*` |

---

## Original v1.0 Architecture

### System Overview

```
+----------------------------------------------------------+
|  Chrome Browser                                          |
|                                                          |
|  +---------------------------------------------------+  |
|  | YouTube Tab (youtube.com/watch?v=...)              |  |
|  |                                                    |  |
|  |  +----------------------------------------------+ |  |
|  |  | Content Script  (content-script.js)          | |  |
|  |  |                                              | |  |
|  |  |  - Reads video ID from URL                  | |  |
|  |  |  - Extracts sidebar suggestion video IDs    | |  |
|  |  |  - Detects SPA navigation                   | |  |
|  |  |  - Collapses/expands sidebar items          | |  |
|  |  |  - Injects CSS for collapse styling         | |  |
|  |  |                                              | |  |
|  |  +---------------------|------------------------+ |  |
|  +------------------------|---------------------------+  |
|                           | chrome.runtime.sendMessage   |
|                           | (video IDs to look up)       |
|                           v                              |
|  +---------------------------------------------------+  |
|  | Service Worker  (service-worker.js)                |  |
|  |                                                    |  |
|  |  - Receives messages from content script           |  |
|  |  - Calls YouTube Data API v3 via fetch()           |  |
|  |  - Returns category data to content script         |  |
|  |  - Reads API key from chrome.storage               |  |
|  |  - Detects SPA navigation, relays to content script|  |
|  |  - [v1.3] Detects tab close, clears storage        |  |
|  |                                                    |  |
|  +---------------------------------------------------+  |
|        ^         |                      |                |
|        |         | fetch()              |                |
|        |         v                      |                |
|  +----------+  +--------------------+   |                |
|  | Popup    |  | YouTube Data API   |   |                |
|  | (UI)     |  | v3 (external)      |   |                |
|  |          |  +--------------------+   |                |
|  | toggle   |                           |                |
|  | on/off   |    chrome.storage         |                |
|  +----+-----+  +----------------------+ |                |
|       |         | chrome.storage.local |<-+               |
|       +-------->|                      |                  |
|                 | - apiKey             |                  |
|                 | - filteringEnabled   |                  |
|                 | - currentVideoCategory_<tabId>  [v1.3]  |
|                 +----------------------+                  |
+----------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **manifest.json** | Declares permissions, content script injection rules, service worker registration, popup action | JSON config file; root of entire extension |
| **content-script.js** | DOM interaction on YouTube pages: extract video IDs, observe navigation, apply/remove sidebar filters | Injected into `*://www.youtube.com/*` via manifest `content_scripts` (expanded in v1.3) |
| **service-worker.js** | API gateway: receives video ID lookups, calls YouTube Data API v3, returns category info; SPA navigation relay; tab lifecycle events | Registered in manifest `background.service_worker`; uses `fetch()` for API calls |
| **popup.html + popup.js** | User-facing toggle UI: on/off switch, displays current video's category, stores API key | Small HTML page rendered when user clicks extension icon |
| **chrome.storage.local** | Persistent state: API key, toggle state, per-tab category name | Keyed by `tabId` for category (v1.3+) |

## Recommended Project Structure

```
tfy/
├── manifest.json            # Extension manifest (MV3)
├── service-worker.js        # Service worker — API calls, message handling, tab lifecycle
├── content-script.js        # Content script — DOM manipulation on YouTube
├── popup.html               # Popup markup
├── popup.js                 # Popup logic (toggle, API key input, category display)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Structure Rationale

**Flat source layout, no build step.** For a personal-use POC Chrome extension, a build system (webpack, Vite, etc.) adds complexity without meaningful benefit. Chrome loads raw JS/HTML/CSS directly.

## Architectural Patterns

### Pattern 1: Message-Passing Bridge (Content Script to Service Worker)

**What:** Content scripts cannot make cross-origin API calls directly. The service worker has extension origin privileges. All YouTube Data API calls go through the service worker via `chrome.runtime.sendMessage()`.

**When:** Any time the content script needs data it cannot access from the page DOM, or needs the service worker's `sender.tab.id` to scope a storage write.

**Key detail:** When using `sendResponse` asynchronously, the listener MUST `return true` to keep the message channel open.

```javascript
// service-worker.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_CATEGORY') {
    handleCategoryRequest(message.videoIds)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async sendResponse
  }
  if (message.type === 'STORE_CURRENT_CATEGORY') {
    // sender.tab.id is available here — not in the content script
    chrome.storage.local.set({
      [`currentVideoCategory_${sender.tab.id}`]: message.categoryName
    });
    return false; // no async response needed
  }
});
```

### Pattern 2: Top-Level Listener Registration in Service Worker

**What:** All event listeners in the service worker must be registered at the top level of the module, not inside functions or async callbacks.

**Why:** Chrome restores only top-level listeners when restarting an idle service worker. Listeners registered inside async functions are lost after the worker terminates.

**When:** Always. This applies to every listener: `onMessage`, `onHistoryStateUpdated`, `onRemoved`.

```javascript
// CORRECT — top-level registration
chrome.tabs.onRemoved.addListener((tabId) => { ... });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { ... });
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => { ... }, { url: [...] });

// WRONG — listener inside async or conditional
chrome.runtime.onMessage.addListener(async (msg) => {
  const data = await chrome.storage.local.get('x');
  chrome.tabs.onRemoved.addListener(() => { ... }); // LOST after worker restart
});
```

### Pattern 3: Service Worker as Stateless API Gateway

**What:** The service worker should be treated as an ephemeral, event-driven process. It can shut down after 30 seconds of inactivity. All persistent state goes in `chrome.storage`, not in global variables.

**Official lifecycle (Chrome docs):**
- Terminates after 30 seconds of inactivity
- Any single request taking >5 minutes will terminate it
- `fetch()` responses taking >30 seconds to arrive will terminate it

### Pattern 4: Dual SPA Navigation Detection (belt-and-suspenders)

**What:** Use `chrome.webNavigation.onHistoryStateUpdated` in the service worker as the primary SPA detection mechanism. Use the YouTube-internal `yt-navigate-finish` DOM event in the content script as a fallback. Both use `lastProcessedVideoId` to deduplicate.

**Why two mechanisms:** `onHistoryStateUpdated` fires immediately on URL change but the content script may not yet be ready (race on initial injection). `yt-navigate-finish` fires after YouTube finishes rendering the new page but is undocumented. Together they cover all cases.

**The deduplication guard (already in code):**

```javascript
// content-script.js — present in both message handler and yt-navigate-finish listener
if (message.videoId === lastProcessedVideoId) return;
lastProcessedVideoId = message.videoId;
```

### Pattern 5: Per-Tab State Scoping

**What:** When an extension needs to store per-tab state in `chrome.storage.local`, use the tab's ID as part of the storage key.

**When:** Any value that differs across tabs (e.g., currently-watched video category, per-tab enabled state).

**Why not `chrome.storage.session`:** `chrome.storage.session` is in-memory and cleared on browser restart, which is appropriate for ephemeral cache. For values the popup needs to read (popup opens in a new context each time), `chrome.storage.local` is more reliable.

```javascript
// Write (service worker — has sender.tab.id)
chrome.storage.local.set({ [`currentVideoCategory_${sender.tab.id}`]: name });

// Read (popup — queries active tab first)
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const key = `currentVideoCategory_${tab.id}`;
const result = await chrome.storage.local.get(key);

// Clear on tab close (service worker)
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});
```

## Data Flow

### Request Flow: Video Page Load to Filtered Sidebar

```
1. User navigates to youtube.com/watch?v=VIDEO_ID (full load or SPA nav)

2. Content Script detects navigation
   ├── Full load: IIFE reads URL, calls initForVideo()
   ├── SPA (service worker relay): YT_NAVIGATION message fires
   └── SPA (fallback): yt-navigate-finish DOM event fires

3. initForVideo() sends current video ID to service worker
   └── GET_VIDEO_CATEGORY message → service worker → YouTube API

4. Service worker responds with { categories: { videoId: categoryId } }

5. Content script sets currentCategoryId, calls initForVideo() chain:
   └── filterSidebar() → observeSidebar(filterSidebar) → setTimeout(filterSidebar, 1000)

6. Content script sends STORE_CURRENT_CATEGORY to service worker
   └── Service worker writes currentVideoCategory_<tabId> to chrome.storage.local

7. Popup opens → queries active tabId → reads currentVideoCategory_<tabId>
```

### State Management

| Storage Area | Key | Value | Lifecycle | Writer | Reader |
|-------------|-----|-------|-----------|--------|--------|
| `chrome.storage.local` | `apiKey` | string | Persists | popup.js | service-worker.js |
| `chrome.storage.local` | `filteringEnabled` | boolean | Persists | popup.js | content-script.js |
| `chrome.storage.local` | `currentVideoCategory_<tabId>` | string | Until tab close | service-worker.js (via message) | popup.js |

## Scaling Considerations

This is a single-user personal extension. Scaling is not a concern. The architecture bottleneck is YouTube Data API quota (10,000 units/day), not compute or storage.

| Concern | At current usage | Notes |
|---------|-----------------|-------|
| API quota | ~50-100 calls/day, well under 10K limit | Session cache in content script prevents redundant calls |
| Storage size | Tiny (one key per open tab, cleared on close) | chrome.storage.local has 10MB limit |
| Service worker restarts | Non-issue | All listeners are top-level; all state is in storage |

## Anti-Patterns

### Anti-Pattern 1: Making API Calls from Content Script

**What:** Using `fetch()` to call `googleapis.com` directly from `content-script.js`.

**Why bad:** Content scripts run in the web page's origin (`youtube.com`). Cross-origin requests from content scripts are blocked. Only the service worker and extension pages can make privileged cross-origin requests.

**Instead:** Always proxy API calls through the service worker via `chrome.runtime.sendMessage()`.

### Anti-Pattern 2: Storing State in Service Worker Global Variables

**What:** Keeping a category cache or API key in a `let`/`const` at module scope in `service-worker.js`.

**Why bad:** MV3 service workers terminate after 30 seconds of inactivity. All global variables are lost silently.

**Instead:** Use `chrome.storage.session` for ephemeral caches, `chrome.storage.local` for persistent data.

### Anti-Pattern 3: Single Global Storage Key for Per-Tab State

**What:** Writing `{ currentVideoCategory: name }` — one global key — when multiple tabs may be open.

**Why bad:** Tab B overwrites Tab A's category. Popup always shows the last-written value, not the active tab's value.

**Instead:** Key by tabId: `{ ['currentVideoCategory_' + tabId]: name }`. Clean up on `chrome.tabs.onRemoved`.

### Anti-Pattern 4: Writing TabId-Scoped Storage from Content Script

**What:** Trying to call `chrome.tabs.getCurrent()` or similar from within the content script to get the tab's own ID for storage keying.

**Why bad:** `chrome.tabs.getCurrent()` returns `undefined` in content scripts (it only works in extension pages). Content scripts do not have a direct API to get their own tabId.

**Instead:** Route the storage write through the service worker using `chrome.runtime.sendMessage()`. The service worker's `onMessage` handler receives `sender.tab.id` automatically.

### Anti-Pattern 5: Registering Service Worker Listeners Inside Async Callbacks

**What:** Adding `chrome.tabs.onRemoved.addListener()` inside an async function body, a `.then()` callback, or a conditional block.

**Why bad:** After idle termination, Chrome restores only top-level listeners. Inner listeners are silently lost.

**Instead:** Register all event listeners at the top level of `service-worker.js`, unconditionally.

### Anti-Pattern 6: Narrow Content Script Match Pattern for SPA Sites

**What:** Using `youtube.com/watch*` as the match pattern for YouTube.

**Why bad:** If the user starts on `youtube.com` (homepage) and SPA-navigates to a video, the content script is never injected. The service worker's `onHistoryStateUpdated` relay fires and tries to `chrome.tabs.sendMessage()`, but there's no content script to receive it.

**Instead:** Match `youtube.com/*` and guard the content script IIFE to only run filtering logic when on a watch page.

## Integration Points

### External Services

| Service | Integration Pattern | Auth | Quota | Notes |
|---------|---------------------|------|-------|-------|
| YouTube Data API v3 | `fetch()` from service worker to `https://www.googleapis.com/youtube/v3/videos` | API key in query string (`key=`) | 1 unit per `videos.list` call; 10,000 units/day default | Batch up to 50 video IDs per request |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| content-script.js → service-worker.js | `chrome.runtime.sendMessage()` | `GET_VIDEO_CATEGORY`, `STORE_CURRENT_CATEGORY` messages |
| service-worker.js → content-script.js | `chrome.tabs.sendMessage()` | `YT_NAVIGATION`, `TFY_TOGGLE` messages |
| popup.js → chrome.storage | Direct `chrome.storage.local.get/set` | Reads per-tab category key using active tabId |
| service-worker.js → chrome.storage | Direct `chrome.storage.local.set/remove` | Writes per-tab category; clears on tab close |
| content-script.js → chrome.storage | Direct `chrome.storage.local.get` | Reads `filteringEnabled` only; writes routed through service worker |

### Manifest Permissions Required (v1.3)

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "webNavigation", "activeTab"],
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://www.youtube.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://www.youtube.com/*"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }]
}
```

**No new permissions needed for v1.3.** `chrome.tabs.onRemoved` does not require the `"tabs"` permission — that permission is only needed to access sensitive tab properties (`url`, `title`, `favIconUrl`). The existing permissions are sufficient for all three fixes.

## Sources

- Chrome Extension Service Workers (lifecycle, top-level listeners): https://developer.chrome.com/docs/extensions/develop/concepts/service-workers (HIGH confidence — official docs)
- chrome.tabs API — onRemoved, permissions: https://developer.chrome.com/docs/extensions/reference/api/tabs (HIGH confidence — official docs)
- Chrome Extension Message Passing (sender.tab.id): https://developer.chrome.com/docs/extensions/develop/concepts/messaging (HIGH confidence — official docs)
- chrome.storage API (local, session): https://developer.chrome.com/docs/extensions/reference/api/storage (HIGH confidence — official docs)
- chrome.webNavigation.onHistoryStateUpdated vs tabs.onUpdated for SPA: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onHistoryStateUpdated (MEDIUM confidence — MDN, corroborated by community sources)
- tabs.onRemoved permission requirement confirmation: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions (HIGH confidence — official docs)

---
*Architecture research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-26 (v1.3 bug fix update)*
