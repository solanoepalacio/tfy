# Stack Research

**Domain:** Chrome Manifest V3 Extension — v1.3 Bug Fixes
**Researched:** 2026-02-26
**Confidence:** HIGH (Chrome extension APIs verified via official docs; YouTube DOM event names MEDIUM — undocumented internals confirmed by community)

---

## Scope

This is a **subsequent-milestone** research file for v1.3. The existing stack (MV3 service worker, content script, popup, `chrome.storage.local`, YouTube Data API v3, `chrome.webNavigation`, `chrome.runtime.sendMessage`) is not re-researched here.

**Only new APIs needed for two bugs:**

1. **Bug 1 — Stale popup state after tab close:** Popup reads `currentVideoCategory` from storage after the tab that set it has closed, showing stale data. Multi-tab: popup shows whatever the last-any-tab set, not the state of the currently active tab.
2. **Bug 2 — SPA navigation from non-watch pages:** Content script declared with `matches: ["youtube.com/watch*"]` is not injected when the user navigates from `youtube.com/` (or any non-watch URL) to a watch page via YouTube's pushState SPA navigation. The existing `webNavigation.onHistoryStateUpdated` handler sends `YT_NAVIGATION` to the content script, but the content script does not exist yet in that tab, so `chrome.tabs.sendMessage` silently fails.

---

## Recommended Stack — New APIs Only

### Core Technologies (New for v1.3)

| Technology | Version/Chrome Min | Purpose | Why Recommended |
|------------|-------------------|---------|-----------------|
| `chrome.tabs.onRemoved` | Chrome 4+ / MV3 | Detect tab close in service worker | Fires with `(tabId, removeInfo)` on every tab close; service worker uses `tabId` to delete that tab's category entry from storage — prevents stale data from persisting after tab close |
| `chrome.tabs.onActivated` | Chrome 18+ / MV3 | Detect active tab switch in service worker | Fires with `activeInfo.tabId` and `activeInfo.windowId` when user switches tabs; service worker can track which tab is "current" so popup reads the right tab's state |
| `chrome.tabs.get(tabId)` | Chrome 4+ / MV3 | Fetch tab URL inside `onActivated` callback | `onActivated` does not include tab URL; must call `chrome.tabs.get(tabId)` to get the `Tab` object and confirm the active tab is a YouTube watch page before acting |
| `chrome.scripting.executeScript` | Chrome 88+ / MV3 only | Programmatically inject content script into a tab | Fills the injection gap for SPA navigation from non-watch pages; called from service worker when `onHistoryStateUpdated` detects a `/watch` destination but `tabs.sendMessage` fails (content script absent) |

### Existing APIs Used by the Fixes (No Changes Needed)

| Technology | Role in Fix | Notes |
|------------|-------------|-------|
| `chrome.webNavigation.onHistoryStateUpdated` | Already detects SPA navigation; drives the `executeScript` injection trigger | Already registered at top-level in `service-worker.js`; only the handler body changes |
| `chrome.tabs.sendMessage` | Already used to relay `YT_NAVIGATION` to content script | Must now fall back to `executeScript` when `sendMessage` throws (content script absent) |
| `chrome.storage.local` | Must change storage shape to support per-tab state | Change from flat `currentVideoCategory` string to `tabCategories: { [tabId]: categoryName }` map |
| `chrome.tabs.query({ active: true, currentWindow: true })` | Popup reads active tab at open time | Already used in popup.js toggle handler; must now also use to read correct tab's category |

---

## Integration with Existing Architecture

### Bug 1: Stale popup state

**Root cause:** Storage uses a single `currentVideoCategory` key. Any tab can overwrite it. When the tab closes, no one clears it. Popup always reads the same flat key regardless of which tab is active.

**Storage shape change required:**

```js
// OLD (flat key, any tab overwrites):
chrome.storage.local.set({ currentVideoCategory: 'Science & Technology' });

// NEW (per-tab map, keyed by tabId):
const existing = await chrome.storage.local.get('tabCategories');
const tabCategories = existing.tabCategories || {};
tabCategories[tabId] = 'Science & Technology';
chrome.storage.local.set({ tabCategories });
```

**service-worker.js changes:**

Register `chrome.tabs.onRemoved` at top-level (outside functions — MV3 service workers only restore top-level listeners after idle termination):

```js
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const { tabCategories = {} } = await chrome.storage.local.get('tabCategories');
  delete tabCategories[tabId];
  await chrome.storage.local.set({ tabCategories });
});
```

**content-script.js changes:**

Content script needs its own `tabId` to key storage writes. Obtain it via:

```js
// In content script: ask service worker for the tab's own ID
// OR: content script can call chrome.tabs.query({active:true, currentWindow:true})
// OR: pass tabId via the YT_NAVIGATION message from service worker (cleanest)
```

Cleanest approach: service worker already knows `details.tabId` in `onHistoryStateUpdated`; it can pass `tabId` in the `YT_NAVIGATION` message. Content script uses it for storage writes.

**popup.js changes:**

```js
// At DOMContentLoaded — replace currentVideoCategory read with:
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const { tabCategories = {} } = await chrome.storage.local.get('tabCategories');
const currentVideoCategory = tab ? tabCategories[tab.id] : undefined;
if (currentVideoCategory) {
  document.getElementById('current-category').textContent = `Watching: ${currentVideoCategory}`;
} else {
  document.getElementById('current-category').textContent = '';
}
```

---

### Bug 2: SPA navigation from non-watch pages

**Root cause:** Content script `matches: ["youtube.com/watch*"]` means Chrome only injects it on hard page loads to watch URLs. When a user starts on `youtube.com/` and clicks a video, it's a pushState navigation — no page load, no injection. The `onHistoryStateUpdated` handler fires, calls `chrome.tabs.sendMessage`, which throws because the content script is absent.

**Fix pattern in service-worker.js:**

```js
// In onHistoryStateUpdated handler body, replace current sendMessage with:
try {
  await chrome.tabs.sendMessage(details.tabId, { type: 'YT_NAVIGATION', videoId, tabId: details.tabId });
} catch (err) {
  // Content script not present — inject it programmatically
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content-script.js']
    });
    // Content script IIFE runs on injection and reads videoId from window.location.href
    // No need to send YT_NAVIGATION — the IIFE handles initial load
  } catch (injectErr) {
    // Tab may have closed between navigation and injection — ignore silently
  }
}
```

**Why this works:** The content script's existing top-level IIFE already reads `window.location.href` on initialisation and calls `initForVideo(initialVideoId)`. When injected programmatically after SPA navigation, the URL is already the watch page URL, so the IIFE picks up the correct `videoId` without needing a separate `YT_NAVIGATION` message.

**Why the fallback `yt-navigate-finish` listener doesn't solve this:** The `yt-navigate-finish` listener is inside the content script. If the content script was never injected (SPA from non-watch page), the listener does not exist — there is nobody to listen.

---

## Permission Changes Required

| Permission | Status | Why Needed |
|------------|--------|-----------|
| `"tabs"` | **Must add** | Reading `tab.url` inside `onActivated` callback (and in popup via `chrome.tabs.query`) requires the `"tabs"` permission. `onRemoved` and `onActivated` fire without this permission, but the `Tab` object's `.url` property is only populated when `"tabs"` is declared. |
| `"scripting"` | **Must add** | `chrome.scripting.executeScript` requires the `"scripting"` permission. |
| `"webNavigation"` | Already present | Drives the injection trigger via `onHistoryStateUpdated`. |
| `"storage"` | Already present | Used for per-tab category map. |
| `"activeTab"` | Already present | Used by popup toggle handler. |

**Updated manifest.json permissions array:**

```json
["storage", "webNavigation", "activeTab", "tabs", "scripting"]
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `chrome.tabs.onRemoved` in service worker to clear storage | Content script listens for `beforeunload` and self-cleans | `beforeunload` does not fire reliably when a tab is force-closed, killed by Chrome, or when the browser itself closes. MV3 content scripts do not have a guaranteed teardown hook. |
| Per-tab `tabCategories` map in storage | Clear all storage state when any tab closes | Multi-tab scenario: user may have several YouTube watch tabs open simultaneously. Clearing all state on any close would break correct tabs. |
| `chrome.scripting.executeScript` (one-shot injection) | `chrome.scripting.registerContentScripts` (dynamic persistent registration) | Dynamic registration persists across sessions and requires tracking whether the registration already exists to avoid duplicates. Adds lifecycle management overhead. `executeScript` is a simpler one-shot fill for a specific navigation event. |
| Catch `tabs.sendMessage` failure → `executeScript` | Always call `executeScript` without trying `sendMessage` first | If content script is already running (normal watch-page hard load), injecting again would create a second instance with duplicate observers and listeners. Must check presence first. |
| Pass `tabId` in `YT_NAVIGATION` message from service worker | Content script calls `chrome.tabs.query({active:true,currentWindow:true})` to find own tabId | Content scripts can use `chrome.tabs.query` but the result is async and depends on whether the content script's tab is the active one — unreliable if the user has switched tabs. Service worker already knows `details.tabId` from `onHistoryStateUpdated`. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `chrome.tabs.onUpdated` for SPA detection | Fires multiple times per navigation for unrelated reasons (status changes, favicon updates, etc.); does not fire on pushState-only navigations without a page load | `chrome.webNavigation.onHistoryStateUpdated` (already in place) |
| `yt-navigate-finish` as the primary SPA nav solution | Undocumented YouTube internal event; the content script must already be running to receive DOM events — this event does not solve the injection-gap problem | `chrome.scripting.executeScript` for the injection gap; `yt-navigate-finish` stays as the belt-and-suspenders fallback for within-watch navigation |
| `history.pushState` monkey-patching from content script | Content script only exists on `/watch*` pages; cannot detect navigations that originate on non-watch pages | `chrome.webNavigation.onHistoryStateUpdated` in service worker handles all YouTube pushState calls regardless of origin page |
| Storing `tabId` as the "active tab" key in `chrome.storage.local` | `tabId` values are session-scoped integers recycled by Chrome; storing one and trusting it after tab close is exactly the stale-state problem being fixed | Always call `chrome.tabs.query({ active: true, currentWindow: true })` at popup open time to get a live `tabId` |
| `chrome.scripting.registerContentScripts` with a dynamic URL pattern | Requires registration persistence management; overkill for a targeted injection event | `chrome.scripting.executeScript` (one-shot, event-driven) |

---

## Version Compatibility

| API | Minimum Chrome Version | MV3 Support | Notes |
|-----|----------------------|-------------|-------|
| `chrome.tabs.onRemoved` | Chrome 4 | Yes | Must register at top-level in service worker — not inside async callbacks |
| `chrome.tabs.onActivated` | Chrome 18 | Yes | Must register at top-level; `activeInfo` shape: `{ tabId, windowId }` |
| `chrome.tabs.get(tabId)` | Chrome 4 | Yes — promise-based | Returns `Tab` object with `.url` when `"tabs"` permission declared |
| `chrome.tabs.query(queryInfo)` | Chrome 4 | Yes — promise-based | Used in popup; already in use |
| `chrome.scripting.executeScript` | Chrome 88 | MV3 only | Requires `"scripting"` permission; `target: { tabId }`, `files: [...]` |
| `chrome.webNavigation.onHistoryStateUpdated` | Chrome 16 | Yes | Already in use; no API-level changes needed |

All minimum versions are well below current Chrome stable (130+). No polyfills or version guards needed.

---

## Sources

- [chrome.tabs API — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/tabs) — `onRemoved`, `onActivated`, `query`, `get` signatures, permission requirements (HIGH confidence — official docs)
- [tabs.onRemoved — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onRemoved) — `removeInfo` shape: `{ windowId: number, isWindowClosing: boolean }` (HIGH confidence — official docs)
- [chrome.scripting API — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/scripting) — `executeScript` signature, `"scripting"` permission requirement (HIGH confidence — official docs)
- [chrome.webNavigation API — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) — `onHistoryStateUpdated` for SPA pushState detection (HIGH confidence — official docs, already in use)
- [Manifest — content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) — static injection only fires on hard page loads matching URL patterns; SPA nav does not trigger re-injection (HIGH confidence — official docs)
- [yt-navigate-finish GitHub issue discussion](https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72) — `yt-navigate-finish` and `yt-page-data-updated` event names confirmed by extension developers (MEDIUM confidence — undocumented YouTube internals, multiple independent sources agree)
- WebSearch results for tabs permission requirements, scripting API usage, SPA injection patterns — verified against official Chrome sources above

---

*Stack research for: Chrome MV3 extension — v1.3 tab lifecycle + SPA navigation bug fixes*
*Researched: 2026-02-26*
