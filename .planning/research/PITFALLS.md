# Pitfalls Research

**Domain:** Chrome Extension — Tab State Management + YouTube SPA Navigation (v1.3 Bug Fixes)
**Researched:** 2026-02-26
**Confidence:** HIGH (sourced from Chrome official docs, verified against actual extension source code, community-confirmed patterns)

---

## Critical Pitfalls

These cause fundamental breakage — the bugs being fixed in v1.3 either reappear or new bugs are introduced.

---

### Pitfall 1: Registering tabs.onRemoved Inside an Async Function or Callback

**What goes wrong:**
The `tabs.onRemoved` listener is placed inside an async IIFE, a `Promise.then()`, or any other async context — not at the top level of `service-worker.js`. Chrome restores only top-level listeners when it restarts an idle service worker. A listener registered inside an async callback is registered after the first event loop tick, meaning it is never registered when the service worker wakes from termination. The tab close event fires, the service worker wakes, but the listener isn't there to receive it. The storage entry `currentVideoCategory` is never cleared.

**Why it happens:**
Developers who want to read from storage before registering the listener write code like:

```javascript
// WRONG — listener registered after async gap
chrome.storage.local.get('someKey').then(({ someKey }) => {
  chrome.tabs.onRemoved.addListener((tabId) => { /* ... */ });
});
```

This is the most common MV3 listener registration mistake. The service worker lifecycle docs explicitly state: all event listeners must be registered synchronously in the first turn of the event loop (top-level), or they will be missed when the service worker is restarted by an event.

**How to avoid:**
Register `chrome.tabs.onRemoved.addListener(...)` at the top level of `service-worker.js`, with no surrounding async context. If you need storage data inside the handler, call `chrome.storage.local.get` inside the callback body, not outside:

```javascript
// CORRECT — top-level registration
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Async work goes INSIDE the handler, not wrapping the addListener call
  const data = await chrome.storage.local.get('trackedTabs');
  // ...
});
```

**Warning signs:**
- `chrome.tabs.onRemoved` never fires when tested after Chrome has been idle for 60+ seconds.
- Works in DevTools (service worker inspector keeps worker alive) but fails in normal use.
- Adding `console.log` directly inside the listener never prints after a service worker restart.

**Phase to address:** Phase 1 (Tab Lifecycle Fix) — The listener registration pattern must be set correctly from the start. It cannot be patched after the fact without restructuring.

**Confidence:** HIGH — Directly stated in Chrome's official service worker events documentation. Verified against the existing `service-worker.js` which already demonstrates this pattern correctly for `onMessage` and `onHistoryStateUpdated`.

---

### Pitfall 2: Storing currentVideoCategory as a Global Key Instead of Per-Tab

**What goes wrong:**
`currentVideoCategory` is stored in `chrome.storage.local` as a single flat key. With one YouTube tab open this works. With two YouTube tabs open, each content script instance writes to the same key, and whichever tab performed a navigation most recently "wins." The popup reads a category belonging to a different tab than the one the user is looking at. When the user switches tabs, the popup shows the wrong video's category. When the user closes the tab that "won" last, the key is cleared even though the other tab is still watching a video.

**Why it happens:**
The straightforward approach of `chrome.storage.local.set({ currentVideoCategory: name })` stores only one value with no tab identity. When two content script instances (in two different tabs) both call this, there is no coordination — last-writer-wins, which is non-deterministic.

**How to avoid:**
Key the stored state by tab ID:

```javascript
// In content-script.js — tag category with this tab's ID
const tabId = /* obtained from service worker or chrome.tabs.getCurrent() */;
chrome.storage.local.set({ [`tab_${tabId}_category`]: categoryName });

// In popup.js — read based on the active tab's ID
const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
const key = `tab_${activeTab.id}_category`;
const result = await chrome.storage.local.get(key);
```

Alternative (simpler): have the service worker maintain a `tabCategories: { [tabId]: categoryName }` object, updated via message from content script, and cleaned up in `tabs.onRemoved`.

**Warning signs:**
- Opening two YouTube tabs with different videos shows the second tab's category in the popup when viewing the first.
- Closing one YouTube tab makes the popup show "No category" even though another YouTube tab is still open.
- Race logs show two rapid `chrome.storage.local.set` calls to the same key from different tabs.

**Phase to address:** Phase 1 (Tab Lifecycle Fix) — Must be addressed when adding `tabs.onRemoved`. If you clear `currentVideoCategory` on tab close without per-tab keying, you can accidentally clear the category for a tab that is still open.

**Confidence:** HIGH — Verified by reading `popup.js` and `content-script.js`. Both use the unkeyed `currentVideoCategory` key. `chrome.storage` has no transactions (confirmed by Chrome docs), so concurrent writes from two content script contexts produce non-deterministic state.

---

### Pitfall 3: Clearing Storage in tabs.onRemoved Without Verifying the Tab Was a YouTube Watch Tab

**What goes wrong:**
`tabs.onRemoved` fires for every tab closed in Chrome — YouTube tabs, Gmail tabs, settings tabs, everything. If the handler unconditionally removes `currentVideoCategory` (or related state) on any tab close, closing an unrelated tab (a Google search, an email) silently wipes the popup's category display for the currently active YouTube tab.

**Why it happens:**
The `tabs.onRemoved` callback only provides `tabId` and `removeInfo: { windowId, isWindowClosing }`. It does NOT provide the URL of the closed tab. Without storing a mapping of `tabId → "was a YouTube watch tab"` somewhere accessible to the service worker, you cannot know which tab was closed.

The `tabs.onRemoved` handler has no direct access to the closed tab's URL — the tab is already gone by the time the callback fires.

**How to avoid:**
Maintain a tab registry in the service worker (or in `chrome.storage.session`). Track which tab IDs belong to YouTube watch pages. Populate it in `chrome.webNavigation.onHistoryStateUpdated` (already present in the service worker) or in `chrome.tabs.onUpdated`. Only clean up state in `tabs.onRemoved` when the closed `tabId` is in this registry:

```javascript
// Strategy 1: in-memory Map (fast, but lost on service worker restart)
const ytTabIds = new Set();

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  const url = new URL(details.url);
  if (url.pathname === '/watch' && url.searchParams.get('v')) {
    ytTabIds.add(details.tabId);
  }
}, { url: [{ hostEquals: 'www.youtube.com' }] });

chrome.tabs.onRemoved.addListener((tabId) => {
  if (ytTabIds.has(tabId)) {
    ytTabIds.delete(tabId);
    // Safe to clean up per-tab category state now
    chrome.storage.local.remove(`tab_${tabId}_category`);
  }
});
```

An in-memory `Set` is acceptable here because the service worker only needs to track tabs that are currently open — if the service worker restarts, `chrome.webNavigation.onHistoryStateUpdated` will re-populate the set as tabs continue navigating.

**Warning signs:**
- Closing a Gmail tab causes the popup to stop showing the YouTube video's category.
- `tabs.onRemoved` logic fires and removes state more often than expected.
- Popup shows "No category" after tab activity unrelated to YouTube.

**Phase to address:** Phase 1 (Tab Lifecycle Fix) — Must be built into the `tabs.onRemoved` implementation from the start.

**Confidence:** HIGH — Verified by reading `chrome.tabs.onRemoved` API docs (MDN, Chrome). The callback only receives `tabId` and `removeInfo`; the URL is not available. The tab is already removed before the callback fires.

---

### Pitfall 4: tabs Permission Not Declared When tabs.onRemoved Handler Needs Tab URL Data

**What goes wrong:**
The developer adds `tabs.onRemoved`, tries to look up the closed tab's URL before the handler fires (e.g., using `chrome.tabs.get(tabId)` hoping the tab still exists), or tries to use `tabs.query` in a way that requires the `"tabs"` permission. Without `"tabs"` in `manifest.json`, these calls silently return undefined or stripped tab objects with no URL.

Separately: if the developer tries to add `chrome.tabs.onUpdated` to build the tab registry (to know which tabs are YouTube watch pages), they may not realize `tabs.onUpdated` fires even without `"tabs"` permission but the `tab.url` property in the callback is undefined unless `"tabs"` is declared.

**Why it happens:**
The manifest currently declares `"activeTab"` but not `"tabs"`. `activeTab` only grants temporary, gesture-triggered access to the currently active tab — it does NOT grant persistent access to all tabs. `tabs.onRemoved` itself does not require the `"tabs"` permission to receive the event, but accessing `tab.url` or `tab.pendingUrl` in any tabs API callback does require it.

The solution is simple: to track YouTube tab URLs persistently (for the tab registry), add `"tabs"` to the manifest permissions. Alternatively, use `webNavigation` events (already present and already requiring `"webNavigation"` permission) to build the registry without needing `"tabs"` — since `webNavigation` event details always include the URL.

**How to avoid:**
Use the already-present `chrome.webNavigation.onHistoryStateUpdated` (which provides `details.url` and `details.tabId` without needing `"tabs"` permission) to build the tab registry. This avoids the permission escalation and is already in the service worker:

```javascript
// Already present — add tabId tracking here
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    const url = new URL(details.url);
    const videoId = url.searchParams.get('v');
    if (url.pathname === '/watch' && videoId) {
      ytTabIds.add(details.tabId); // Track the tab
      // ... existing YT_NAVIGATION relay logic ...
    }
  },
  { url: [{ hostEquals: 'www.youtube.com' }] }
);
```

If you do need `"tabs"` permission for other reasons, add it to manifest. But prefer avoiding it by leveraging `webNavigation` which is already declared.

**Warning signs:**
- `tab.url` is undefined in `tabs.onUpdated` callback even though the tab is clearly on YouTube.
- `chrome.tabs.get(tabId)` returns a tab object but its `url` property is missing.
- Manifest lint tools warn about missing `"tabs"` permission.

**Phase to address:** Phase 1 (Tab Lifecycle Fix) — Manifest permissions must be verified before the tab lifecycle code is written.

**Confidence:** HIGH — Directly from Chrome docs: `"tabs"` permission is required to read `url`, `pendingUrl`, `title`, or `favIconUrl` from `tabs.Tab` objects. `chrome.tabs.onRemoved` fires without `"tabs"` permission.

---

### Pitfall 5: Popup Reads Storage Once on DOMContentLoaded — Never Responds to Tab Changes

**What goes wrong:**
The popup reads `currentVideoCategory` from storage exactly once: on `DOMContentLoaded`. If the user opens the popup while on Tab A (Science & Technology), then switches to Tab B (Music) without closing the popup, the popup still shows "Science & Technology." The popup is not stale because storage was never updated — it's stale because the popup never re-read storage or responded to the user switching tabs.

This is separate from the tab-close bug but compounds it. Even after fixing tab-close cleanup, the popup can show outdated information if the user navigates between YouTube tabs while the popup is open.

**Why it happens:**
Popup lifetime: the popup is destroyed and recreated each time the user opens it. On a given open, it reads storage once. There is no mechanism to react to storage changes or tab activation changes during the popup's lifetime unless explicitly coded.

**How to avoid:**
Two complementary approaches:

1. **Listen for storage changes** — `chrome.storage.onChanged.addListener` lets the popup reactively update when the service worker writes new category state for the active tab.

2. **Read storage scoped to the active tab** — On `DOMContentLoaded`, determine which tab is active (`chrome.tabs.query`), and read the per-tab key (`tab_${tabId}_category`) rather than a global key. This ensures that each popup open reflects the correct tab even without reactive updates.

For a simple fix: approach 2 alone is sufficient since the popup is destroyed and recreated on each open, and `chrome.tabs.query({ active: true, currentWindow: true })` gives the current tab at open time.

**Warning signs:**
- Popup shows category from a closed or background tab.
- Switching YouTube tabs and re-opening the popup shows the same (wrong) category.
- Category does not clear after the YouTube tab is closed, even after the storage fix is applied.

**Phase to address:** Phase 2 (Popup State Fix) — This is the popup-side of the fix. Must be addressed in tandem with the storage cleanup in Phase 1.

**Confidence:** HIGH — Verified by reading `popup.js`. The popup reads from the global `currentVideoCategory` key once, with no per-tab scoping and no reactive update mechanism.

---

### Pitfall 6: Duplicate Initialization When Both SPA Navigation Signals Fire for the Same Navigation

**What goes wrong:**
For a single YouTube SPA navigation, both the service worker relay (`YT_NAVIGATION` message) and the `yt-navigate-finish` DOM event fire. The `lastProcessedVideoId` guard in `content-script.js` deduplicates them — but only if they both arrive with the same `videoId`. A race condition exists: if `yt-navigate-finish` fires and calls `initForVideo` before the service worker message arrives, `lastProcessedVideoId` is set to the new video ID. When the service worker message then arrives with the same ID, the guard catches it and skips it correctly.

However: if the message arrives first and `initForVideo` starts running asynchronously (it calls `chrome.runtime.sendMessage` which is async), `lastProcessedVideoId` is set but `currentCategoryId` is still null. If `yt-navigate-finish` fires during this window, the guard catches it and does NOT call `initForVideo` again — correct. But if `yt-navigate-finish` fires with the same video ID after `initForVideo` has already set `currentCategoryId`, the sidebar observer gets attached twice (the first call from the service worker message did not disconnect before the second came in).

The specific risk: calling `observeSidebar(filterSidebar)` twice on the same `#secondary` container creates two `MutationObserver` instances watching the same container. Both fire on every sidebar mutation, calling `filterSidebar` twice for every new sidebar item.

**Why it happens:**
The deduplication guard (`if (message.videoId === lastProcessedVideoId) return`) is set at the START of each handler. But `initForVideo` is async and sets `currentCategoryId` later. If both signals arrive before the async operation completes, the second signal is blocked by the guard (correct). If they arrive far enough apart that the first one finishes, the guard works. The edge case is re-navigation: user clicks video A, then immediately clicks video B before A's `initForVideo` resolves. The teardown logic for video A may not have run, and if `observeSidebar` was called for A, it's still running when B starts.

**How to avoid:**
Ensure `disconnectSidebarObserver()` is always called before any `observeSidebar()` call. The current code does this in the `YT_NAVIGATION` and `yt-navigate-finish` handlers (teardown block), but verify it also happens inside `initForVideo` itself before calling `observeSidebar`:

```javascript
async function initForVideo(videoId) {
  disconnectSidebarObserver(); // Guard against double-observer if called twice
  // ... rest of initForVideo ...
  observeSidebar(filterSidebar);
}
```

This makes the function idempotent regarding observer attachment — calling it twice disconnects the first observer before attaching the second.

**Warning signs:**
- `filterSidebar` calls logged twice per sidebar mutation.
- `chrome.runtime.sendMessage` called twice for the same set of video IDs in rapid succession.
- Console shows two "[TFY] Current video category" log lines for the same video.

**Phase to address:** Phase 1 (SPA Navigation Fix) — Needs to be verified and hardened when the SPA navigation path is tested end-to-end.

**Confidence:** MEDIUM — Based on code analysis of `content-script.js`. The `lastProcessedVideoId` guard handles most cases. The double-observer risk exists in rapid re-navigation scenarios or if the timing between the two signals widens unexpectedly.

---

### Pitfall 7: yt-navigate-finish Fires on Non-Watch Page Navigations

**What goes wrong:**
The `yt-navigate-finish` event fires for ALL YouTube SPA navigations — not just video watch page navigations. Navigating from `/watch?v=abc` to the YouTube homepage `/`, to `/search?q=something`, to a YouTube channel page, to a playlist — all fire `yt-navigate-finish`. The current content script guard `if (!videoId || videoId === lastProcessedVideoId) return` handles the case where the new URL has no `v` parameter (i.e., non-watch pages), but the handler still runs, accesses `window.location.href`, and calls `chrome.storage.local.remove('currentVideoCategory')` even when navigating to a page that has no video context.

The more significant issue: the content script is only injected on `youtube.com/watch*` pages. If the user navigates away from a watch page (watch → homepage), the content script STAYS alive in its tab (SPA — no new document). The existing `yt-navigate-finish` listener will fire for the non-watch navigation, run the teardown (reset, disconnect, remove storage) — which is actually correct behavior. But if the user then navigates back to a watch page (homepage → watch), `yt-navigate-finish` fires again, `videoId` is now present, and `initForVideo` runs. This is the intended behavior.

The risk area: `chrome.storage.local.remove('currentVideoCategory')` in the `yt-navigate-finish` handler also fires when navigating between non-watch pages (homepage → search). At that point there is no `currentVideoCategory` to remove, so it is a no-op and harmless. But with per-tab keying (fix for Pitfall 2), the remove call must use the correct per-tab key — not a global one. Ensure the remove call uses `tab_${tabId}_category`.

**Why it happens:**
`yt-navigate-finish` is an undocumented YouTube-internal DOM event that fires for every client-side navigation in the SPA, regardless of destination URL. The event provides no navigation destination info itself — you have to read `window.location.href` after it fires to determine where you are.

**How to avoid:**
Keep the existing URL check (`const videoId = new URL(window.location.href).searchParams.get('v'); if (!videoId ...) return;`). This is already correct. Add a note that this guard is load-bearing — do not remove it when refactoring.

When implementing per-tab storage (Pitfall 2 fix), ensure teardown calls use the tab-scoped key, not the global key.

**Warning signs:**
- Console shows `[TFY]` teardown logs when navigating to YouTube homepage.
- Storage operations (set/remove) happen for non-watch navigations.
- If the `?v` check is accidentally removed, `initForVideo` is called with `undefined` as the videoId.

**Phase to address:** Phase 1 (SPA Navigation Fix) — The guard is already in place; this is a verification concern and a heads-up for refactoring.

**Confidence:** HIGH — Verified by reading content-script.js. The `yt-navigate-finish` event behavior on non-watch pages is confirmed by community documentation (yt-navigate-finish fires for all SPA navigations).

---

## Moderate Pitfalls

These cause subtle bugs or maintenance problems but don't immediately break core functionality.

---

### Pitfall 8: Service Worker In-Memory Tab Registry Lost on Restart Creates Missed Cleanup

**What goes wrong:**
The tab registry (the `Set` of YouTube watch tab IDs) is stored in a JavaScript variable in the service worker. The service worker terminates after 30 seconds of inactivity. When a tab is closed after the service worker has been idle (and thus terminated), the service worker wakes on `tabs.onRemoved`, but its in-memory registry is empty. The handler sees an empty registry, cannot match the `tabId`, and skips the storage cleanup. Stale `tab_${tabId}_category` entries accumulate in `chrome.storage.local`.

**Prevention:**
Two-layer defense:

1. **Mirror the registry in `chrome.storage.session`** — `storage.session` persists through service worker restarts but clears when the browser closes (matching tab lifecycle expectations). Write to session storage whenever the in-memory registry changes. On service worker startup, read from session storage to rebuild the registry.

2. **Use a cleanup sweep** — On `chrome.runtime.onStartup` or periodically (e.g., via `chrome.alarms`), query all open tabs and remove storage keys for tab IDs that no longer exist.

For this specific extension's complexity level, option 2 (periodic cleanup) is simpler than option 1. Stale entries have low impact (they waste a few bytes of storage), so a cleanup on service worker startup via `chrome.runtime.onInstalled` or `onStartup` is sufficient.

**Warning signs:**
- `chrome.storage.local` accumulates `tab_*_category` keys over time that correspond to long-closed tabs.
- Popup shows stale category for a tab that was closed hours ago (service worker restarted between close and popup open).

**Phase to address:** Phase 2 (Hardening) — The basic fix can land without this; this is a robustness improvement.

**Confidence:** MEDIUM — Based on known MV3 service worker termination behavior. The impact for this extension is low (stale storage bytes, not functional breakage), but the pattern is worth knowing.

---

### Pitfall 9: observeSidebar Retry Loop Accumulates Timers on Rapid Navigation

**What goes wrong:**
`observeSidebar` in `content-script.js` uses a polling retry when `#secondary` is not yet present: `setTimeout(() => observeSidebar(callback), 300)`. If the user navigates rapidly (video A → video B → video C before the 300ms fires), multiple pending `setTimeout` calls from different navigation attempts are outstanding. When they eventually fire, each one finds `#secondary` (from the current, most recent navigation) and attaches an additional observer, defeating `disconnectSidebarObserver()`.

**Prevention:**
Store the retry timer reference and cancel it in the teardown:

```javascript
let sidebarObserverRetryTimer = null;

function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    sidebarObserverRetryTimer = setTimeout(() => observeSidebar(callback), 300);
    return;
  }
  // ...attach observer...
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
```

The current teardown sequence (`resetAllCollapsed(); disconnectSidebarObserver(); ...`) calls `disconnectSidebarObserver()` on navigation, but without cancelling the timer, the retry can fire after teardown on rapid navigation.

**Warning signs:**
- Multiple "[TFY] Current video category" console lines for the same video after rapid back-to-back navigation.
- `filterSidebar` runs N times per mutation where N > 1, correlating with how quickly the user navigated.

**Phase to address:** Phase 1 (SPA Navigation Fix) — Should be addressed when the SPA navigation path is tested with rapid navigation.

**Confidence:** MEDIUM — Based on code analysis of `observeSidebar`. This is a real edge case for fast users or automated testing.

---

### Pitfall 10: fetchAndLogCategory Is a Dead Code Path That Makes the Same API Call as initForVideo

**What goes wrong:**
`content-script.js` has `fetchAndLogCategory` (lines 215-241) which logs the current video category to the console. It is called nowhere in the current code — `initForVideo` handles the category fetch and logging. If `fetchAndLogCategory` were accidentally called alongside `initForVideo`, it would double the API requests for the current video's category lookup.

**Prevention:**
Remove `fetchAndLogCategory` as dead code before the v1.3 changes land, or convert it into a debug utility with a clear flag. This prevents it from being accidentally wired up by future changes.

**Warning signs:**
- API quota counter increments twice per navigation instead of once.
- Two simultaneous `GET_VIDEO_CATEGORY` messages in service worker logs for the same video on the same navigation.

**Phase to address:** Phase 1 (Cleanup) — Minor, but prevents future confusion.

**Confidence:** HIGH — Verified by reading content-script.js. `fetchAndLogCategory` has no callers. `initForVideo` performs the same lookup with additional logic on top.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Global `currentVideoCategory` storage key | Simple to write and read | Multi-tab race conditions; popup shows wrong tab's category | Never for multi-tab use — key by tabId |
| Clearing all TFY state in tabs.onRemoved unconditionally | Simple cleanup logic | Clearing state for unrelated tabs (Gmail close clears YouTube state) | Never — always verify the closed tab was a tracked YouTube tab |
| In-memory only tab registry (no session storage mirror) | No storage overhead | Service worker restart causes missed cleanup | Acceptable for MVP given low impact; address in hardening phase |
| Ignoring `isWindowClosing` flag in tabs.onRemoved | Simpler handler | When browser window closes, onRemoved fires for every tab in the window simultaneously — if each handler writes to storage, you get N concurrent writes | Acceptable — the per-tab key cleanup is idempotent, concurrent removes for different keys cause no conflict |
| Removing `fetchAndLogCategory` without a test pass | Cleaner codebase | If tests reference it, tests break | Acceptable immediately — it has no callers |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `tabs.onRemoved` → storage cleanup | Using `chrome.storage.local.remove('currentVideoCategory')` with global key | Use per-tab key `tab_${tabId}_category`; only remove when tabId is in the tab registry |
| `tabs.onRemoved` callback | Calling `chrome.tabs.get(tabId)` inside the handler to get the URL | Tab is already removed; `tabs.get` returns an error. Use the pre-built tab registry instead |
| Service worker `webNavigation.onHistoryStateUpdated` → tab registry | Building the registry in a separate listener from the existing one | Modify the existing `onHistoryStateUpdated` listener to also update the registry — don't add a second listener for the same event |
| Popup reading per-tab category | Querying `chrome.tabs.query({ active: true, currentWindow: true })` to get the current tab ID | This is correct — but ensure the query runs before reading storage, not in parallel with it |
| Content script writing per-tab category | Content scripts don't have direct access to their own `tabId` | Use a message to the service worker to get the tab ID, or use `chrome.tabs.getCurrent()` (available in content scripts) — `chrome.tabs.getCurrent` works in content scripts and returns the tab the script is running in |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `tabs.onRemoved` firing for every tab close in Chrome | High service worker wake frequency if user closes many tabs | The handler itself is fast (a registry check and a storage remove) — acceptable cost | Not a performance concern at any realistic tab count |
| Per-tab storage keys accumulating in `chrome.storage.local` | Storage grows unboundedly over long browser sessions | Cleanup on `runtime.onStartup`; remove stale keys for tabs that no longer exist | After dozens of sessions; each entry is tiny but compounds over months |
| `chrome.storage.local.get` inside `tabs.onRemoved` for every close event | Storage read on every tab close in Chrome | Cache the tab registry in memory; only read from storage if in-memory is empty | With many tabs open and rapid tab closing |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tab ID as storage key without validation | Attackers cannot forge tab IDs in extension context — not an external attack surface | Not a concern for a personal-use, developer-mode extension |
| Storing category names (not IDs) in storage | Category names are display strings from YouTube API — no PII, no credentials | Acceptable; no security risk for this data |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Popup shows "Watching: Science & Technology" after the tab was closed | User confused — they think an old tab is still active | Clear the popup category display when no YouTube watch tabs are open |
| Popup shows wrong tab's category when multiple YouTube tabs open | User focused on Tab A, popup shows Tab B's category | Scope popup display to the currently active tab's category |
| After SPA navigation, popup still shows old video's category until popup is closed and reopened | Stale category lingers until popup refresh | On navigation, service worker updates per-tab storage; popup reads at open time from per-tab key |

---

## "Looks Done But Isn't" Checklist

- [ ] **tabs.onRemoved fires correctly after idle** — Close Chrome DevTools for the service worker, wait 60 seconds, close the YouTube tab. Popup should show no category (not the stale one).
- [ ] **Closing non-YouTube tab does not wipe category** — With YouTube tab showing "Science & Technology", close an unrelated Gmail tab. Popup must still show "Science & Technology".
- [ ] **Multi-tab: popup shows active tab's category** — Open Tab A (Music video) and Tab B (Science video). Click on Tab B. Open popup — must show "Science & Technology", not "Music".
- [ ] **Tab close with two YouTube tabs open** — With Tab A and Tab B both watching YouTube, close Tab B. Open popup with Tab A active — must show Tab A's category, not blank.
- [ ] **tabs.onRemoved listener is registered at top level** — Verify in service-worker.js that `chrome.tabs.onRemoved.addListener(...)` is at module scope, not inside any function, callback, or async block.
- [ ] **SPA navigation fires initForVideo only once per navigation** — Navigate to a new video; confirm console shows exactly one "[TFY] Current video category" log.
- [ ] **Rapid navigation leaves exactly one MutationObserver active** — Navigate video A → B → C quickly; confirm only one observer fires per sidebar mutation.
- [ ] **No dead `setTimeout` timers after navigation teardown** — Navigate while `#secondary` retry loop is pending; confirm only the new navigation's observer is eventually attached.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Listener registered in async context (Pitfall 1) | LOW | Move `addListener` call to module top level; remove wrapping async code |
| Global storage key instead of per-tab (Pitfall 2) | MEDIUM | Change content-script to use `tab_${tabId}_category`; update popup to query active tabId first; update service worker cleanup to use same key |
| Unconditional tabs.onRemoved cleanup (Pitfall 3) | LOW | Add tab registry (Set); gate cleanup on registry membership |
| Missing `"tabs"` permission (Pitfall 4) | LOW | Add `"tabs"` to manifest permissions array; or restructure to use webNavigation instead |
| Double MutationObserver from rapid navigation (Pitfall 6/9) | LOW | Add `disconnectSidebarObserver()` at top of `initForVideo`; cancel retry timer in disconnect |

---

## Pitfall-to-Phase Mapping

| Pitfall | # | Prevention Phase | Verification |
|---------|---|------------------|--------------|
| tabs.onRemoved listener in async context | 1 | Phase 1 (Tab Lifecycle) | Inspect source; wait 60s idle; close tab; confirm popup clears |
| Global storage key, multi-tab collision | 2 | Phase 1 (Tab Lifecycle) | Open 2 YouTube tabs; popup shows active tab's category |
| tabs.onRemoved fires for all tabs | 3 | Phase 1 (Tab Lifecycle) | Close non-YouTube tab; confirm YouTube popup unchanged |
| Missing tabs permission for tab URL access | 4 | Phase 1 (Tab Lifecycle) | Manifest review; webNavigation used for tab registry |
| Popup reads storage once, not reactive | 5 | Phase 2 (Popup Fix) | Switch YouTube tabs; reopen popup; verify correct category |
| Duplicate initForVideo on dual signal | 6 | Phase 1 (SPA Nav Fix) | One initForVideo log per navigation in console |
| yt-navigate-finish on non-watch pages | 7 | Phase 1 (SPA Nav Fix) | Navigate watch → home; teardown fires but no initForVideo call |
| In-memory registry lost on SW restart | 8 | Phase 2 (Hardening) | Check storage for stale tab keys after long idle session |
| Orphaned observeSidebar retry timers | 9 | Phase 1 (SPA Nav Fix) | Rapid 3-navigation test; one observer in memory afterward |
| fetchAndLogCategory dead code | 10 | Phase 1 (Cleanup) | grep for fetchAndLogCategory callers; confirm zero |

---

## Sources

- **Chrome Extension Service Worker Lifecycle (event listener registration):** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle (HIGH — official docs; "all event listeners must be registered synchronously in the first turn of the event loop")
- **chrome.tabs.onRemoved API (callback parameters):** https://developer.chrome.com/docs/extensions/reference/api/tabs (HIGH — official docs; callback receives only `tabId` and `removeInfo: { windowId, isWindowClosing }`, no URL)
- **chrome.tabs permission requirements:** https://developer.chrome.com/docs/extensions/reference/api/tabs (HIGH — official docs; `"tabs"` required to read `url`, `pendingUrl`, `title`, `favIconUrl`)
- **chrome.storage — no transactions:** https://developer.chrome.com/docs/extensions/reference/api/storage (HIGH — official docs; confirmed no transactional writes)
- **MV3 service worker listeners stop working (community):** https://groups.google.com/a/chromium.org/g/chromium-extensions/c/05BZLHHxMmc (MEDIUM — community-reported, aligns with official docs on async listener registration)
- **yt-navigate-finish fires for all SPA navigations:** https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72 (MEDIUM — community-documented behavior; not officially documented by YouTube)
- **chrome.storage concurrent write race conditions:** https://groups.google.com/a/chromium.org/g/chromium-extensions/c/y5hxPcavRfU (MEDIUM — community-documented; aligns with official docs on no transaction support)
- **Content script not reinjected on SPA navigation:** https://groups.google.com/a/chromium.org/g/chromium-extensions/c/32lLHYjQUQQ (HIGH — confirmed behavior; content scripts only inject on document creation)
- **Existing TFY source code analysis:** `/home/solanoe/code/tfy/service-worker.js`, `content-script.js`, `popup.js`, `manifest.json` (HIGH — direct code inspection)

---

*Pitfalls research for: Chrome Extension v1.3 — Tab State Management + SPA Navigation Bug Fixes*
*Researched: 2026-02-26*
