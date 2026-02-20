# Architecture Research

**Domain:** Chrome Extension (YouTube sidebar filter)
**Researched:** 2026-02-20
**Confidence:** HIGH

Sources are Chrome official documentation (developer.chrome.com) and YouTube Data API v3 official documentation (developers.google.com/youtube/v3). All architectural patterns below are verified against current Manifest V3 official docs.

## Standard Architecture

### System Overview

```
+----------------------------------------------------------+
|  Chrome Browser                                          |
|                                                          |
|  +---------------------------------------------------+  |
|  | YouTube Tab (youtube.com/watch?v=...)              |  |
|  |                                                    |  |
|  |  +----------------------------------------------+ |  |
|  |  | Content Script  (content.js)                 | |  |
|  |  |                                              | |  |
|  |  |  - Reads video ID from URL/DOM              | |  |
|  |  |  - Extracts sidebar suggestion video IDs    | |  |
|  |  |  - Observes DOM for SPA navigation changes  | |  |
|  |  |  - Collapses/expands sidebar items          | |  |
|  |  |  - Injects CSS for collapse styling         | |  |
|  |  |                                              | |  |
|  |  +---------------------|------------------------+ |  |
|  +------------------------|---------------------------+  |
|                           | chrome.runtime.sendMessage   |
|                           | (video IDs to look up)       |
|                           v                              |
|  +---------------------------------------------------+  |
|  | Service Worker  (background.js)                    |  |
|  |                                                    |  |
|  |  - Receives messages from content script           |  |
|  |  - Calls YouTube Data API v3 via fetch()           |  |
|  |  - Returns category data to content script         |  |
|  |  - Reads API key from chrome.storage               |  |
|  |  - Caches category lookups (chrome.storage.session)|  |
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
|  +----+-----+  +--------------------+   |                |
|       |         | chrome.storage     |<--+                |
|       +-------->| .local / .session  |                   |
|                 |                    |                    |
|                 | - apiKey           |                    |
|                 | - enabled (toggle) |                    |
|                 | - category cache   |                    |
|                 +--------------------+                   |
+----------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **manifest.json** | Declares permissions, content script injection rules, service worker registration, popup action | JSON config file; root of entire extension |
| **Content Script** (`content.js`) | DOM interaction on YouTube pages: extract video IDs, observe navigation, apply/remove sidebar filters | Injected into `*://www.youtube.com/watch*` via manifest `content_scripts` |
| **Service Worker** (`background.js`) | API gateway: receives video ID lookups from content script, calls YouTube Data API v3, returns category info; manages extension lifecycle events | Registered in manifest `background.service_worker`; uses `fetch()` for API calls |
| **Popup** (`popup.html` + `popup.js`) | User-facing toggle UI: on/off switch, displays current state, stores preference | Small HTML page rendered when user clicks extension icon |
| **Injected CSS** (`content.css`) | Styling for collapsed suggestions and "hidden: off-topic" labels | Declared in manifest `content_scripts.css` |
| **chrome.storage** | Persistent state: API key, toggle state, category cache | `chrome.storage.local` for API key + toggle; `chrome.storage.session` for ephemeral category cache |

## Recommended Project Structure

```
tfy2/
├── manifest.json            # Extension manifest (MV3)
├── background.js            # Service worker — API calls, message handling
├── content.js               # Content script — DOM manipulation on YouTube
├── content.css              # Injected stylesheet for sidebar filtering UI
├── popup/
│   ├── popup.html           # Popup markup
│   ├── popup.js             # Popup logic (toggle, API key input)
│   └── popup.css            # Popup styling
├── icons/
│   ├── icon16.png           # Toolbar icon
│   ├── icon48.png           # Extensions page icon
│   └── icon128.png          # Chrome Web Store / install icon
└── README.md                # Developer notes (optional)
```

### Structure Rationale

**Flat source layout, no build step.** For a personal-use POC Chrome extension, a build system (webpack, Vite, etc.) adds complexity without meaningful benefit. Chrome loads raw JS/HTML/CSS directly. The flat structure means:

- No transpilation step during development
- Instant reload on file save (via `chrome://extensions` reload)
- Fewer moving parts to debug
- Manifest v3 requires all code bundled with the extension (no remote code), so a flat structure satisfies this natively

**Popup in its own directory** because it's a self-contained mini-app (HTML + JS + CSS) separate from the content script world. This keeps the root clean.

**No `src/` wrapper** because the entire project IS the extension source. Chrome loads from the root directory. Adding `src/` would require either pointing Chrome at `src/` (confusing) or copying files out (build step).

## Architectural Patterns

### Pattern 1: Message-Passing Bridge (Content Script <-> Service Worker)

**What:** Content scripts cannot make cross-origin API calls directly (they inherit the page's origin). The service worker has extension origin privileges. Therefore, all YouTube Data API calls must go through the service worker via `chrome.runtime.sendMessage()`.

**When:** Any time the content script needs data it cannot access from the page DOM.

**Why (official docs):** Per Chrome docs on cross-origin requests: "Content scripts initiate requests on behalf of the web origin that the content script has been injected into and therefore content scripts are also subject to the same origin policy." The service worker, however, can make cross-origin requests if `host_permissions` are declared in the manifest.

**Example:**

```javascript
// content.js — request category for video IDs
const response = await chrome.runtime.sendMessage({
  type: 'GET_CATEGORIES',
  videoIds: ['dQw4w9WgXcQ', 'abc123']
});
// response = { 'dQw4w9WgXcQ': '10', 'abc123': '28' }

// background.js — handle the request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CATEGORIES') {
    fetchCategories(message.videoIds)
      .then(categories => sendResponse(categories));
    return true; // keep channel open for async response
  }
});
```

**Key detail:** When using `sendResponse` asynchronously, the listener MUST `return true` to keep the message channel open. This is documented explicitly in Chrome's messaging docs and is the #1 source of bugs in MV3 extensions.

### Pattern 2: Static Content Script Declaration

**What:** Declare content scripts in `manifest.json` with match patterns so Chrome auto-injects them on matching pages. No need for programmatic injection for this use case.

**When:** The set of pages is well-known and stable (YouTube watch pages).

**Example:**

```json
{
  "content_scripts": [{
    "matches": ["*://www.youtube.com/watch*"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }]
}
```

**Why `document_idle`:** This is the default and preferred value. Chrome injects after the DOM is complete but before all subresources load. For YouTube (a SPA), the initial DOM will be ready, but we still need MutationObserver for SPA navigation (see Pattern 4).

### Pattern 3: Service Worker as Stateless API Gateway

**What:** The service worker should be treated as an ephemeral, event-driven process. It can shut down after 30 seconds of inactivity. All persistent state goes in `chrome.storage`, not in global variables.

**When:** Always in MV3. This is not optional — it's how MV3 service workers work.

**Official lifecycle (from Chrome docs):**
- Terminates after 30 seconds of inactivity
- Any single request taking >5 minutes will terminate it
- `fetch()` responses taking >30 seconds to arrive will terminate it
- Receiving an event or calling an extension API resets the 30-second timer

**Example — loading state from storage, not globals:**

```javascript
// background.js — CORRECT: read from storage each time
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CATEGORIES') {
    chrome.storage.local.get(['apiKey']).then(({ apiKey }) => {
      if (!apiKey) {
        sendResponse({ error: 'NO_API_KEY' });
        return;
      }
      fetchFromYouTubeAPI(apiKey, message.videoIds)
        .then(categories => sendResponse(categories));
    });
    return true;
  }
});
```

### Pattern 4: MutationObserver for YouTube SPA Navigation

**What:** YouTube is a Single-Page Application. Navigating between videos does NOT trigger a full page reload, which means the content script's initial execution may only fire once. To detect navigation between watch pages, use a `MutationObserver` on a stable DOM node or listen to `yt-navigate-finish` events.

**When:** Every time the user clicks a video link within YouTube.

**Example:**

```javascript
// content.js — detect YouTube SPA navigation
// YouTube fires a custom event on navigation
document.addEventListener('yt-navigate-finish', () => {
  if (window.location.pathname === '/watch') {
    onVideoPageLoad();
  }
});

// Also handle initial page load
if (window.location.pathname === '/watch') {
  onVideoPageLoad();
}
```

**Alternative approach using URL polling (simpler, more robust):**

```javascript
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.pathname === '/watch') {
      onVideoPageLoad();
    }
  }
}).observe(document.body, { subtree: true, childList: true });
```

### Pattern 5: chrome.storage.onChanged for Cross-Component Reactivity

**What:** When the popup changes the toggle state in `chrome.storage`, the content script (and service worker) can react immediately via `chrome.storage.onChanged` listener, without requiring explicit message passing.

**When:** Toggle on/off state changes, API key updates.

**Example:**

```javascript
// content.js — react to toggle changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    if (changes.enabled.newValue) {
      applyFiltering();
    } else {
      removeFiltering();
    }
  }
});

// popup.js — toggle writes to storage
document.getElementById('toggle').addEventListener('change', (e) => {
  chrome.storage.local.set({ enabled: e.target.checked });
});
```

**Why this over message passing:** `chrome.storage` is directly accessible from content scripts (one of the few `chrome.*` APIs that is). This avoids the round-trip through the service worker just to relay a boolean. The content script reads storage directly; the popup writes to it. Both share the same storage namespace.

## Data Flow

### Request Flow: Video Page Load to Filtered Sidebar

```
1. User navigates to youtube.com/watch?v=VIDEO_ID
   (or SPA-navigates within YouTube)

2. Content Script detects navigation
   ├── Extracts current video ID from URL: new URL(location.href).searchParams.get('v')
   └── Waits for sidebar to render (MutationObserver or retry loop)

3. Content Script extracts sidebar suggestion video IDs
   ├── Queries DOM for sidebar recommendation elements
   └── Extracts video ID from each suggestion's <a href> or data attribute

4. Content Script sends ALL video IDs (current + sidebar) to Service Worker
   └── chrome.runtime.sendMessage({ type: 'GET_CATEGORIES', videoIds: [...] })

5. Service Worker receives message
   ├── Checks chrome.storage.session for cached categories (avoid redundant API calls)
   ├── Identifies which video IDs are NOT yet cached
   └── Batches uncached IDs into YouTube Data API v3 request(s)

6. Service Worker calls YouTube Data API v3
   ├── GET https://www.googleapis.com/youtube/v3/videos
   │   ?part=snippet&id=ID1,ID2,ID3,...&fields=items(id,snippet/categoryId)&key=API_KEY
   ├── API returns categoryId for each video
   ├── Quota cost: 1 unit per request (can batch up to 50 IDs per request)
   └── Caches results in chrome.storage.session

7. Service Worker responds to Content Script
   └── sendResponse({ 'VIDEO_ID': '28', 'SIDEBAR_ID_1': '10', ... })

8. Content Script applies filtering
   ├── Compares each sidebar video's categoryId to current video's categoryId
   ├── Matching category → leave visible
   ├── Non-matching category → collapse with "hidden: off-topic" label
   └── Attach click handler to label for expand/collapse toggle
```

### State Management

**Three storage tiers, each for a specific purpose:**

| Storage Area | Data | Lifecycle | Accessible From |
|-------------|------|-----------|-----------------|
| `chrome.storage.local` | `apiKey`, `enabled` (toggle) | Persists across browser restarts, extension updates | Content script, service worker, popup (all) |
| `chrome.storage.session` | Category cache (`{ videoId: categoryId }`) | Cleared on browser restart or extension reload | Service worker (default); can enable for content scripts |
| URL | Current video ID | Per-navigation; from `location.href` | Content script (same-page access) |

**Why `chrome.storage.local` for API key (not `chrome.storage.sync`):** This is personal-use, single-device. `sync` has lower quotas (100KB total, 8KB/item) and write rate limits (120/min). `local` has 10MB limit and no sync overhead. For a personal extension, syncing settings across devices adds no value.

**Why `chrome.storage.session` for category cache:** Session storage is in-memory only, cleared on restart. Category lookups are ephemeral — we don't need them across sessions. This avoids polluting persistent storage with stale cache data and avoids cache invalidation complexity.

### Key Data Flows

**Flow 1: Initial Setup (one-time)**
```
User opens popup → enters API key → popup.js writes to chrome.storage.local
→ chrome.storage.onChanged fires in background.js (optional: validate key)
→ Extension is now functional
```

**Flow 2: Toggle On/Off**
```
User clicks popup toggle → popup.js writes { enabled: true/false } to chrome.storage.local
→ chrome.storage.onChanged fires in content.js
→ Content script applies or removes filtering immediately
```

**Flow 3: Page Navigation (core loop)**
```
YouTube SPA navigation → content.js detects URL change
→ content.js reads chrome.storage.local for enabled state
→ If disabled, stop. If enabled, continue.
→ content.js extracts video IDs from page
→ content.js sends message to service worker
→ service worker checks session cache, calls API for uncached IDs
→ service worker responds with category map
→ content.js filters sidebar
```

**Flow 4: Sidebar Late-Loading**
```
YouTube sidebar loads more suggestions (lazy loading / infinite scroll)
→ MutationObserver in content.js detects new sidebar elements
→ content.js extracts new video IDs
→ Sends only NEW IDs to service worker (avoid re-requesting)
→ Receives categories, filters new items
```

## Anti-Patterns

### Anti-Pattern 1: Making API Calls from Content Script

**What:** Using `fetch()` to call `googleapis.com` directly from `content.js`.

**Why bad:** Content scripts run in the web page's origin (`youtube.com`). Cross-origin requests from content scripts are subject to the same-origin policy of the host page. Even with `host_permissions` in the manifest, content scripts CANNOT make privileged cross-origin requests. Only the service worker and extension pages (popup, options) can.

**Instead:** Always proxy API calls through the service worker via `chrome.runtime.sendMessage()`.

### Anti-Pattern 2: Storing State in Service Worker Global Variables

**What:** Keeping a category cache or API key in a `let`/`const` at module scope in `background.js`.

**Why bad:** MV3 service workers terminate after 30 seconds of inactivity. All global variables are lost. The service worker is NOT a long-running background page (that was MV2). If you store state in globals, it will silently disappear.

**Instead:** Use `chrome.storage.session` for ephemeral caches, `chrome.storage.local` for persistent data. Load from storage on every message handler invocation.

### Anti-Pattern 3: Not Handling YouTube SPA Navigation

**What:** Running filtering logic only on `document_idle` injection and assuming it covers all page views.

**Why bad:** YouTube is a SPA. When a user clicks a sidebar suggestion, YouTube navigates without a full page reload. The content script's initial injection code runs only once per full page load. Without SPA navigation detection, the filter stops working after the first navigation.

**Instead:** Use `yt-navigate-finish` event listener or MutationObserver-based URL change detection. Re-run the filtering flow on each navigation to a `/watch` page.

### Anti-Pattern 4: Requesting Full Video Resources from YouTube API

**What:** Calling `videos.list` with `part=snippet` and no `fields` parameter, pulling the entire snippet object for every video.

**Why bad:** Wastes bandwidth and parsing time. The `snippet` part includes title, description, thumbnails (multiple sizes), tags, etc. We only need `categoryId`. While the quota cost is the same (1 unit per `list` call), the response payload is dramatically larger.

**Instead:** Use the `fields` parameter to request only what you need:
```
?part=snippet&fields=items(id,snippet/categoryId)
```
This returns only the video ID and category ID. Response is ~50 bytes per video instead of ~2KB+.

### Anti-Pattern 5: One API Call Per Video

**What:** Making a separate YouTube Data API request for each sidebar suggestion.

**Why bad:** YouTube sidebar typically shows 15-20+ suggestions. At 1 API call per video, that's 20 API calls per page load. The daily quota is 10,000 units — that's only 500 page views before exhausting quota. Plus it's slow (20 sequential network round-trips).

**Instead:** The `videos.list` endpoint accepts comma-separated IDs (up to 50 per request). Batch all video IDs into a single call. One page load = 1 API call = 1 quota unit.

### Anti-Pattern 6: Using `innerHTML` for Collapse Labels

**What:** Constructing the "hidden: off-topic" label using `.innerHTML` with dynamic content.

**Why bad:** Content Security Policy in MV3 is strict. Using `innerHTML` with any dynamic content risks XSS and may violate CSP. Chrome's official docs explicitly warn against this pattern.

**Instead:** Use `document.createElement()` and `.textContent` to build UI elements safely.

## Integration Points

### External Services

| Service | Integration Pattern | Auth | Quota | Notes |
|---------|---------------------|------|-------|-------|
| YouTube Data API v3 | `fetch()` from service worker to `https://www.googleapis.com/youtube/v3/videos` | API key in query string (`key=`) | 1 unit per `videos.list` call; 10,000 units/day default | Batch up to 50 video IDs per request. Use `part=snippet&fields=items(id,snippet/categoryId)` for minimal response. |

**API Call Template:**
```
GET https://www.googleapis.com/youtube/v3/videos
  ?part=snippet
  &id=VIDEO_ID_1,VIDEO_ID_2,...,VIDEO_ID_N
  &fields=items(id,snippet/categoryId)
  &key=YOUR_API_KEY
```

**Response shape (with fields filter):**
```json
{
  "items": [
    { "id": "dQw4w9WgXcQ", "snippet": { "categoryId": "10" } },
    { "id": "abc123",       "snippet": { "categoryId": "28" } }
  ]
}
```

**Quota math for this extension:**
- 1 API call per YouTube page navigation (batching all video IDs)
- ~10,000 page navigations per day before hitting quota
- Aggressive browsing: ~50-100 page views/day = <1% of quota
- Session caching prevents re-fetching videos already looked up

### Internal Boundaries (Message Passing)

```
+------------------+     chrome.runtime.sendMessage()     +------------------+
|                  | ----------------------------------->  |                  |
|  Content Script  |     { type, videoIds }               | Service Worker   |
|  (content.js)    | <-----------------------------------  | (background.js)  |
|                  |     sendResponse({ categories })     |                  |
+------------------+                                      +------------------+
        |                                                         |
        |   chrome.storage.local.get/set                          |   chrome.storage.local.get
        |   chrome.storage.onChanged                              |   chrome.storage.session.get/set
        v                                                         v
+------------------------------------------------------------------------+
|                        chrome.storage                                  |
|  .local:  { apiKey: "...", enabled: true }                             |
|  .session: { categoryCache: { "videoId": "categoryId", ... } }        |
+------------------------------------------------------------------------+
        ^
        |   chrome.storage.local.set
        |
+------------------+
|  Popup           |
|  (popup.js)      |
|  - toggle on/off |
|  - API key input |
+------------------+
```

**Message Protocol (recommended):**

| Message Type | Sender | Receiver | Payload | Response |
|-------------|--------|----------|---------|----------|
| `GET_CATEGORIES` | content.js | background.js | `{ type: 'GET_CATEGORIES', videoIds: string[] }` | `{ [videoId]: categoryId }` or `{ error: string }` |

Keep the message protocol minimal. For this POC, a single message type is sufficient. The toggle state flows through `chrome.storage` (not messages), so no message type is needed for it.

### Manifest Permissions Required

```json
{
  "manifest_version": 3,
  "permissions": ["storage"],
  "host_permissions": ["https://www.googleapis.com/*"],
  "content_scripts": [{
    "matches": ["*://www.youtube.com/watch*"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html"
  }
}
```

**Permission rationale:**
- `storage` — Required for `chrome.storage.local` and `chrome.storage.session`
- `host_permissions: ["https://www.googleapis.com/*"]` — Required for the service worker to `fetch()` the YouTube Data API v3. Without this, requests are blocked by CORS.
- Content script `matches` — Only `youtube.com/watch*` pages, not all of YouTube. Minimal permission scope.
- No `activeTab`, `tabs`, or other permissions needed — content script is statically declared, not programmatically injected.

## Build Order (Dependencies Between Components)

The components have clear dependency ordering that informs phase structure:

```
Phase 1: Manifest + Scaffold
  └── manifest.json (everything depends on this)
  └── Empty placeholder files

Phase 2: Service Worker + YouTube API Integration
  └── background.js: message listener + YouTube API fetch
  └── Can be tested independently (chrome.runtime messages from DevTools console)
  └── Depends on: manifest.json declaring service_worker + host_permissions

Phase 3: Content Script (DOM Extraction)
  └── content.js: extract video ID from URL, extract sidebar video IDs
  └── Depends on: service worker being functional (to send messages to)
  └── Can partially test by logging to console before wiring to service worker

Phase 4: Content Script (Filtering + UI)
  └── content.js: apply/remove sidebar filtering based on categories
  └── content.css: collapse styling, "hidden: off-topic" label
  └── Depends on: working category lookup from Phase 2-3

Phase 5: Popup (Toggle + Config)
  └── popup.html/js/css: on/off toggle, API key input
  └── Depends on: chrome.storage schema (but can be built in parallel)

Phase 6: SPA Navigation + Edge Cases
  └── MutationObserver / yt-navigate-finish handling
  └── Sidebar lazy-load handling
  └── Depends on: all core functionality working on initial page load
```

**Key dependency insight:** The service worker (API integration) is the foundation. Build it first and verify API calls work before investing in DOM manipulation. The popup is relatively independent — it only reads/writes `chrome.storage` — so it can be built in parallel with the content script.

## Sources

- Chrome Extension Service Workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers (HIGH confidence — official docs)
- Chrome Extension Service Worker Lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle (HIGH confidence — official docs)
- Chrome Extension Message Passing: https://developer.chrome.com/docs/extensions/develop/concepts/messaging (HIGH confidence — official docs, updated 2025-12-03)
- Chrome Extension Content Scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (HIGH confidence — official docs)
- Chrome Extension Cross-Origin Requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests (HIGH confidence — official docs)
- chrome.storage API: https://developer.chrome.com/docs/extensions/reference/api/storage (HIGH confidence — official docs, updated 2025-12-19)
- YouTube Data API v3 Videos.list: https://developers.google.com/youtube/v3/docs/videos/list (HIGH confidence — official docs, updated 2025-08-28)
- YouTube Data API v3 Overview & Quota: https://developers.google.com/youtube/v3/getting-started (HIGH confidence — official docs, updated 2026-02-12)

---
*Architecture research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-20*
