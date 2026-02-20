# Stack Research

**Domain:** Chrome Extension (YouTube DOM manipulation + API)
**Researched:** 2026-02-20
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Chrome Manifest V3 | 3 | Extension platform | Required for current Chrome. MV2 is deprecated — Chrome is actively removing MV2 support. MV3 uses service workers instead of background pages, requires all code bundled locally. |
| Vanilla JavaScript (ES2022+) | — | All extension code | No framework needed. The extension has 4 small files (content script, service worker, popup, CSS). Adding React/Vue/Svelte would add a build step, bundle bloat, and complexity for zero benefit at this scope. Chrome's content script environment supports modern JS natively. |
| YouTube Data API v3 | v3 | Video category metadata | The only supported YouTube API. Provides `videos.list` (1 quota unit) to get `snippet.categoryId` for any video ID. Also `videoCategories.list` (1 quota unit) to resolve category IDs to human-readable names. REST API, no client library needed — simple `fetch()` calls with API key. |
| Chrome Storage API | `chrome.storage.local` | Persist API key, toggle state, category cache | Built-in, no dependencies. Content scripts can access `chrome.storage.local` directly. 10 MB limit (more than enough). Survives browser restarts and cache clears, unlike `localStorage`. |
| Chrome Messaging API | `chrome.runtime.sendMessage` | Content script ↔ service worker communication | Built-in. Content scripts cannot make cross-origin API calls directly (YouTube API is at `googleapis.com`). The service worker handles API calls and sends results back via messaging. One-time request pattern is sufficient — no need for long-lived connections. |

**Confidence: HIGH** — All of the above is verified against official Chrome Extension documentation (developer.chrome.com, last updated 2025-12) and YouTube Data API documentation (developers.google.com, last updated 2026-02-12).

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chrome-types` | 0.1.416 | TypeScript type definitions for Chrome Extension APIs | **Only if using TypeScript or JSDoc type checking.** Provides autocomplete and type safety for `chrome.*` APIs. Zero runtime cost — types only. Published by Google (GoogleChrome org). |

**Confidence: HIGH** — Version verified via npm registry 2026-02-20.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Chrome DevTools | Debug all extension components | Inspect popup via right-click → Inspect. Service worker debugging via `chrome://extensions` → "Inspect views: service worker". Content script console appears in the page's DevTools. |
| `chrome://extensions` | Load unpacked extension | Enable Developer Mode → "Load unpacked" → select extension directory. Click refresh icon after code changes. |
| No bundler needed | — | Vanilla JS with ES modules isn't used in MV3 content scripts (they don't support `import`). All files are standalone scripts loaded via `manifest.json`. For this project's 4-file scope, a bundler adds complexity with no benefit. |
| No package manager needed | — | Zero npm dependencies at runtime. The extension is pure browser APIs + one REST API call. If adding `chrome-types` for dev, a minimal `package.json` can be added later. |

## Project File Structure

```
tfy2/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — handles YouTube API calls
├── content.js             # Content script — observes and filters YouTube sidebar DOM
├── content.css            # Styles for collapsed/hidden suggestions
├── popup.html             # Popup UI — toggle on/off
├── popup.js               # Popup logic — reads/writes toggle state
├── popup.css              # Popup styling
└── icons/                 # Extension icons (16, 48, 128 px)
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Key manifest.json Shape

```json
{
  "manifest_version": 3,
  "name": "TFY2 — Topic Focused YouTube",
  "version": "0.1.0",
  "description": "Filter YouTube sidebar suggestions by video category",
  "permissions": [
    "storage"
  ],
  "host_permissions": [
    "https://www.googleapis.com/youtube/v3/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["content.js"],
      "css": ["content.css"],
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
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Key Manifest Decisions

| Decision | Rationale |
|----------|-----------|
| `"storage"` permission | Required for `chrome.storage.local` to persist API key, toggle state, and category cache. |
| `host_permissions` for `googleapis.com` | The service worker needs to `fetch()` the YouTube Data API. Content scripts can't do this (wrong origin). The service worker can if the host is declared. |
| Static `content_scripts` declaration | The content script should always run on YouTube pages. Static declaration is simpler than programmatic injection and requires no `scripting` permission. |
| `run_at: "document_idle"` | Default and preferred. Ensures DOM is ready before content script runs. YouTube's SPA navigation means we also need a MutationObserver anyway, so exact timing is less critical. |
| No `activeTab` permission | Not needed — we always run on YouTube via match pattern, not on-click. |
| No `tabs` permission | Not needed — content script communicates via `chrome.runtime.sendMessage`, not via tab queries. |

## YouTube Data API v3 — Specific Usage

### Endpoints Needed

| Endpoint | Quota Cost | Purpose | When Called |
|----------|-----------|---------|------------|
| `GET /youtube/v3/videos?part=snippet&id={videoId}&fields=items(id,snippet/categoryId)&key={API_KEY}` | 1 unit | Get category ID for a video | Once per video page load (for current video + each sidebar suggestion) |
| `GET /youtube/v3/videoCategories?part=snippet&regionCode=US&key={API_KEY}` | 1 unit | Get human-readable category names | Once on first load, then cache indefinitely (categories rarely change) |

### Quota Budget

- **Default quota:** 10,000 units/day
- **Cost per video lookup:** 1 unit (using `videos.list` with `part=snippet`)
- **Batch lookup:** Up to 50 video IDs per request (comma-separated `id` parameter)
- **Typical page:** 1 current video + ~20 sidebar suggestions = 1 API call (batch all IDs)
- **Estimated daily capacity:** ~10,000 page loads/day — far more than personal use requires

### API Key Authentication

- **No OAuth needed.** `videos.list` with `part=snippet` and `videoCategories.list` are public data endpoints. An API key (not OAuth token) is sufficient.
- The API key is stored in `chrome.storage.local` and used only in the service worker's `fetch()` calls.
- The `fields` parameter should be used to minimize response size: `fields=items(id,snippet/categoryId)`.

**Confidence: HIGH** — Verified against official YouTube Data API v3 documentation (developers.google.com/youtube/v3). Quota costs confirmed: `videos.list` = 1 unit, `videoCategories.list` = 1 unit. Batch `id` parameter confirmed as comma-separated list.

## Installation

No installation needed for the extension itself — it's loaded as an unpacked extension.

For optional TypeScript type checking during development:

```bash
# Only if you want JSDoc/TS type checking
npm init -y
npm install -D chrome-types
```

Then use a `jsconfig.json` or `tsconfig.json` to enable type checking:

```json
{
  "compilerOptions": {
    "checkJs": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "DOM"],
    "types": ["chrome-types"]
  },
  "include": ["*.js"]
}
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Vanilla JS | TypeScript + bundler (esbuild/Vite) | If the extension grows beyond ~10 files or needs shared modules between content script and service worker. At POC scope (4 JS files), the build step overhead isn't justified. |
| Vanilla JS | React/Preact for popup | Only if the popup becomes a complex multi-view UI (settings pages, dashboards). A single toggle doesn't warrant a framework. |
| `chrome.storage.local` | `chrome.storage.sync` | If the user wants settings synced across Chrome instances. For personal single-machine use, `local` is simpler and has higher limits (10 MB vs 100 KB). |
| `chrome.runtime.sendMessage` (one-time) | `chrome.runtime.connect` (long-lived port) | If content script needs to stream data or maintain ongoing conversation with service worker. Our pattern is request-response (send video IDs, get categories back), so one-time messages are simpler. |
| REST `fetch()` to YouTube API | Google API Client Library (`gapi`) | Never for an extension. `gapi` is designed for web pages, loads remote code (banned in MV3), and is massive overkill for two REST endpoints. |
| `MutationObserver` for sidebar changes | `setInterval` polling | Never. Polling is wasteful, imprecise, and misses rapid DOM changes. `MutationObserver` is the correct API for watching YouTube's dynamic sidebar. |
| Static content script in manifest | `chrome.scripting.executeScript` (programmatic) | If the extension needed to inject conditionally (e.g., only when user clicks). We always want to run on YouTube, so static declaration is simpler and doesn't need the `scripting` permission. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Manifest V2** | Deprecated. Chrome is actively disabling MV2 extensions. Background pages are removed. No future support. | Manifest V3 |
| **`gapi` (Google API Client Library)** | Loads remote JavaScript — banned in MV3 (no remotely hosted code). Also ~100 KB for what two `fetch()` calls accomplish. | Direct `fetch()` to REST endpoints |
| **React / Vue / Svelte** | Requires bundler, adds build step, increases extension size. The popup is one toggle. The content script manipulates DOM directly. No component tree needed. | Vanilla JS + DOM APIs |
| **jQuery** | Unnecessary in 2026. `document.querySelectorAll`, `MutationObserver`, `fetch` cover all needs. Adds 87 KB for zero benefit. | Native DOM APIs |
| **Webpack** | Complex config, slow builds, overkill for 4 JS files with no imports. | No bundler (or esbuild if eventually needed) |
| **`window.localStorage` in content script** | Shared with YouTube's own storage. Cleared when user clears browsing data. Not accessible from service worker. | `chrome.storage.local` |
| **`XMLHttpRequest`** | Legacy API. Not available in service workers (MV3). | `fetch()` |
| **OAuth 2.0 authentication** | Not needed. `videos.list` with `part=snippet` is a public data endpoint. API key authentication is sufficient for reading video categories. OAuth adds complexity (consent screen, token refresh) for zero benefit in this use case. | API key parameter (`key=`) |
| **YouTube `search.list` endpoint** | Costs 100 quota units per call (vs 1 unit for `videos.list`). Would burn through 10K daily quota in 100 calls. Some people use search to get video metadata — this is a quota trap. | `videos.list` with batch `id` parameter (1 unit, up to 50 IDs) |
| **Content Security Policy overrides** | MV3 content scripts run in an isolated world with their own CSP. No need to modify it. Attempting to loosen CSP is a security anti-pattern. | Default CSP (no changes needed) |

## Stack Patterns by Extension Component

### Content Script Pattern
```
content.js runs on youtube.com:
1. Extract current video ID from URL (window.location parsing)
2. Observe sidebar DOM with MutationObserver for suggestion elements
3. Extract video IDs from sidebar suggestion links (href parsing)
4. Send video IDs to service worker via chrome.runtime.sendMessage
5. Receive category data back
6. Compare categories → collapse/show sidebar items by toggling CSS classes
7. Re-run on YouTube SPA navigation (listen for yt-navigate-finish event)
```

### Service Worker Pattern
```
background.js handles API calls:
1. Listen for messages from content script (chrome.runtime.onMessage)
2. Receive batch of video IDs
3. Fetch category data from YouTube API (with caching)
4. Return category map to content script
5. Service worker sleeps when idle (MV3 lifecycle — no persistent background)
```

### Popup Pattern
```
popup.html/js handles user toggle:
1. On open: read toggle state from chrome.storage.local
2. Display on/off toggle
3. On toggle: write new state to chrome.storage.local
4. Content script reads state on each page/navigation to decide whether to filter
```

## Version Compatibility

| Component | Minimum Chrome Version | Notes |
|-----------|----------------------|-------|
| Manifest V3 | Chrome 88+ | MV3 introduced in Chrome 88 (Jan 2021). Stable and mature by 2026. |
| `chrome.storage.session` | Chrome 102+ | Not needed for this project (we use `local`), but available if needed. |
| Service workers | Chrome 88+ | Part of MV3. |
| `MutationObserver` | All modern browsers | Supported since Chrome 18. |
| `fetch()` in service worker | Chrome 88+ | Available in MV3 service workers. |
| `chrome.storage.local` | Chrome 88+ | Promise-based API in MV3. |
| YouTube Data API v3 | N/A (REST API) | Stable since 2014. No deprecation planned. |

## Sources

- **Chrome Extension MV3 Overview:** https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 (official, current)
- **Chrome Extension Get Started:** https://developer.chrome.com/docs/extensions/get-started (official, current)
- **Chrome Content Scripts:** https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (official, current)
- **Chrome Service Workers:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers (official, current)
- **Chrome Storage API:** https://developer.chrome.com/docs/extensions/reference/api/storage (official, last updated 2025-12-19)
- **Chrome Message Passing:** https://developer.chrome.com/docs/extensions/develop/concepts/messaging (official, last updated 2025-12-03)
- **YouTube Data API v3 Overview:** https://developers.google.com/youtube/v3/getting-started (official, last updated 2026-02-12)
- **YouTube Videos: list:** https://developers.google.com/youtube/v3/docs/videos/list (official, last updated 2025-08-28)
- **YouTube VideoCategories: list:** https://developers.google.com/youtube/v3/docs/videoCategories/list (official, last updated 2025-08-28)
- **chrome-types npm package:** npm registry, version 0.1.416 (verified 2026-02-20)

---
*Stack research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-20*
