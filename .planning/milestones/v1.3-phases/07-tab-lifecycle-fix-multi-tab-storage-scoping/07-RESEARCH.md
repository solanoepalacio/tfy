# Phase 7: Tab Lifecycle Fix + Multi-Tab Storage Scoping — Research

**Researched:** 2026-02-26
**Domain:** Chrome Extension MV3 — tab lifecycle events, per-tab storage scoping, popup state synchronization
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TABST-01 | Popup clears the category display when the associated YouTube watch tab is closed | `chrome.tabs.onRemoved` in service worker + per-tab storage key `currentVideoCategory_${tabId}` + popup reads from active tab's scoped key |
| TABST-02 | Popup shows the correct category for the currently active YouTube tab when multiple YouTube tabs are open | Per-tab storage key schema prevents cross-tab bleed; popup queries active tab ID and reads `currentVideoCategory_${tabId}` at open time |
| TABST-03 | Closing a non-YouTube tab (e.g., Gmail) does not affect the popup's category display | `onRemoved` handler guards on whether the closed tab's ID has a scoped key before acting; unrelated tab IDs have no entry, so nothing is cleared |
</phase_requirements>

---

## Summary

The root cause of all three TABST requirements is a single shared storage key `currentVideoCategory` in `chrome.storage.local`. When any YouTube watch tab sets this key, it overwrites what any other tab wrote. When a tab closes, nothing clears the key. When the popup opens, it blindly reads the global key regardless of which tab is active.

The fix is a two-part schema change: (1) scope the storage key to a tab ID — `currentVideoCategory_${tabId}` — so each tab owns its own entry; (2) register `chrome.tabs.onRemoved` in the service worker to delete a tab's scoped key when that tab closes. The popup then reads the active tab's ID at open time and fetches the scoped key for that ID. This satisfies all three requirements with minimal code change and no new permissions.

The content script already passes its `tabId` implicitly via `sender.tab.id` in any message it sends to the service worker, and can also read its own `tabId` from `chrome.devtools.inspectedWindow` — but the simplest approach is for the content script to call `chrome.runtime.sendMessage` to a new `GET_TAB_ID` handler in the service worker, or alternatively use `chrome.tabs.getCurrent()` from within the popup context (which is supported) and query from the service worker side. The cleanest MV3 pattern is to have the content script receive its own `tabId` from the service worker on first navigation or via the existing `YT_NAVIGATION` message which already carries `details.tabId` in the service worker.

**Primary recommendation:** Migrate `currentVideoCategory` → `currentVideoCategory_${tabId}` across content-script.js (write), service-worker.js (onRemoved cleanup), and popup.js (read by active tab ID). Register `chrome.tabs.onRemoved` at top-level in the service worker alongside the existing listeners.

---

## Standard Stack

### Core
| API | Since | Purpose | Why Standard |
|-----|-------|---------|--------------|
| `chrome.tabs.onRemoved` | MV2/MV3 | Fires when any tab closes; provides `tabId` and `removeInfo.isWindowClosing` | Only way to detect tab close from a service worker |
| `chrome.tabs.onActivated` | MV2/MV3 | Fires when active tab in a window changes; provides `activeInfo.tabId` | Required for TABST-02 — popup must know which tab became active |
| `chrome.storage.local` | MV2/MV3 | Stores per-tab category with key `currentVideoCategory_${tabId}` | Already in use; tab-ID-scoped keys are the conventional approach |
| `chrome.tabs.query` | MV2/MV3 | Used in popup.js to identify the active tab before reading storage | Already used for toggle; extend the same pattern |

### Supporting
| API | Since | Purpose | When to Use |
|-----|-------|---------|-------------|
| `chrome.storage.session` | MV3 Chrome 102+ | In-memory storage, cleared on browser restart | HARD-01 future requirement only — out of scope for Phase 7 |
| `sender.tab.id` | MV2/MV3 | Available in service worker `onMessage` handler to identify which tab sent a message | Use when content script sends a message that includes storage writes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-tab storage key `currentVideoCategory_${tabId}` | In-memory Map in service worker (`tabCategoryMap`) | Map is lost on service worker restart (HARD-01 problem); storage key survives worker restart. Use storage for Phase 7. |
| `chrome.tabs.onRemoved` cleanup | Content script `beforeunload` + message to SW | `beforeunload` is unreliable in Chrome (tabs can be force-closed without firing it); `onRemoved` is the authoritative signal |
| Popup queries active tab ID via `chrome.tabs.query` | Popup subscribes to `chrome.storage.onChanged` | `onChanged` is more complex; querying at popup-open time is simpler and sufficient since popup is opened on demand |

**Installation:** No new packages. All APIs are native Chrome Extension MV3.

---

## Architecture Patterns

### Current Storage Schema (BROKEN)
```
chrome.storage.local:
  apiKey                  → string
  filteringEnabled        → boolean
  currentVideoCategory    → string   ← shared by ALL tabs, last-write wins
```

### Target Storage Schema (Phase 7)
```
chrome.storage.local:
  apiKey                       → string
  filteringEnabled             → boolean
  currentVideoCategory_${tabId} → string   ← per-tab, written by content script
                                            ← deleted by service worker on tab close
```

### Pattern 1: Per-Tab Key Write (content-script.js)

**What:** When content script writes the current video's category, it includes its own `tabId` in the key.
**When to use:** Inside `initForVideo()` after successfully fetching the current video category.

The content script does not have direct access to its own `tabId` via a synchronous API. It receives it via `chrome.runtime.sendMessage` — the service worker already has access to `sender.tab.id` in the `onMessage` handler. The cleanest approach: the content script sends `SET_VIDEO_CATEGORY` message with the category name; the service worker writes `currentVideoCategory_${sender.tab.id}` using the sender's tab ID. This removes the need for the content script to know its own ID.

```javascript
// content-script.js — inside initForVideo(), replace the direct storage write
// OLD:
chrome.storage.local.set({ currentVideoCategory: currentCategoryName });

// NEW: delegate storage write to service worker (which has sender.tab.id)
chrome.runtime.sendMessage({
  type: 'SET_VIDEO_CATEGORY',
  categoryName: currentCategoryName
});

// Also on navigation teardown — clear via service worker:
chrome.runtime.sendMessage({ type: 'CLEAR_VIDEO_CATEGORY' });
```

```javascript
// service-worker.js — in the onMessage handler
if (message.type === 'SET_VIDEO_CATEGORY') {
  // sender.tab.id is the content script's tab ID
  await chrome.storage.local.set({
    [`currentVideoCategory_${sender.tab.id}`]: message.categoryName
  });
  return;
}
if (message.type === 'CLEAR_VIDEO_CATEGORY') {
  await chrome.storage.local.remove(`currentVideoCategory_${sender.tab.id}`);
  return;
}
```

**Alternative (content script reads its own tabId):** Have the content script call a `GET_TAB_ID` message on startup and cache the returned `sender.tab.id`. This adds a round-trip but keeps storage writes local. The delegate pattern above is simpler.

### Pattern 2: Tab Close Cleanup (service-worker.js)

**What:** Register `chrome.tabs.onRemoved` at top-level; delete the scoped key when a tab closes.
**When to use:** Always. Must be top-level per MV3 service worker requirements.

```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved
// Register at TOP LEVEL — not inside a function or async callback
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Remove the scoped key for this tab regardless of isWindowClosing
  // (window close = all tabs close = each fires onRemoved individually)
  await chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});
```

**Note:** `removeInfo.isWindowClosing` is `true` when the tab closed because its parent window closed. We do NOT need to check this flag — we always clean up regardless of why the tab closed.

### Pattern 3: Popup Reads Scoped Key (popup.js)

**What:** At popup open time, query active tab, then read that tab's scoped storage key.
**When to use:** In the `DOMContentLoaded` handler.

```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-query
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
// tab may be null if the popup opens without a focused window (edge case)
if (tab?.url?.includes('youtube.com/watch')) {
  const key = `currentVideoCategory_${tab.id}`;
  const result = await chrome.storage.local.get(key);
  const category = result[key];
  if (category) {
    document.getElementById('current-category').textContent = `Watching: ${category}`;
  }
  // If no key found (tab closed or not on watch page): show neutral state (blank)
}
```

### Pattern 4: YT_NAVIGATION Storage Clear (content-script.js)

The `YT_NAVIGATION` handler already calls `chrome.storage.local.remove('currentVideoCategory')` — this must be updated to use the delegate message `CLEAR_VIDEO_CATEGORY` instead.

### Anti-Patterns to Avoid

- **Registering `onRemoved` inside an async function or callback:** Service worker will not reliably re-register after restart. Always register at top level.
- **Using `chrome.storage.remove('currentVideoCategory')` (unscoped key):** The old key is now dead. All reads/writes/removes must use the scoped key.
- **Calling `chrome.tabs.getCurrent()` from the content script:** Returns `undefined` for content scripts — only works for extension pages (popup, options). Use the service-worker delegate pattern instead.
- **Checking `removeInfo.isWindowClosing` to skip cleanup:** Always clean up. A window close fires `onRemoved` for each tab individually, so cleanup still happens correctly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detect tab close | Custom ping/heartbeat from content script | `chrome.tabs.onRemoved` in service worker | Heartbeat is unreliable; `onRemoved` is the authoritative event |
| Know which tab is active | Track focus state manually | `chrome.tabs.query({ active: true, currentWindow: true })` | Query at popup-open time is accurate and simple |
| Per-tab storage namespace | Custom serialization/Map | String key prefix `currentVideoCategory_${tabId}` | `chrome.storage.local` already supports arbitrary string keys; prefix is idiomatic |

**Key insight:** Chrome provides exactly the right lifecycle events for this problem. The entire fix is wiring existing events to storage operations — no custom state tracking needed.

---

## Common Pitfalls

### Pitfall 1: Listener Registration Outside Top Level

**What goes wrong:** `chrome.tabs.onRemoved.addListener(...)` placed inside an async function, a `.then()`, or a conditional block fails silently after service worker restart. The listener was registered during the first activation but is gone after the worker wakes up idle.
**Why it happens:** MV3 service workers are terminated when idle. On restart, only synchronous top-level code re-registers listeners.
**How to avoid:** Place ALL `chrome.tabs.*` listener registrations at the very top of service-worker.js, alongside the existing `chrome.runtime.onMessage.addListener` and `chrome.webNavigation.onHistoryStateUpdated.addListener`.
**Warning signs:** Tab close cleanup works in dev tools when service worker is kept alive, but fails in normal use after ~30 seconds of inactivity.

### Pitfall 2: `chrome.tabs.getCurrent()` Returns Undefined in Content Scripts

**What goes wrong:** Content script calls `chrome.tabs.getCurrent()` expecting its own tab ID; gets `undefined`.
**Why it happens:** `chrome.tabs.getCurrent()` is documented for extension pages only (popup, background, options). Content scripts are not extension pages.
**How to avoid:** Use the service-worker delegate pattern — the service worker has `sender.tab.id` in `onMessage`. Or have the YT_NAVIGATION message relay the tabId back to the content script.
**Warning signs:** `tab` variable is `undefined`; `tab.id` throws TypeError.

### Pitfall 3: Stale Global Key Coexists With Scoped Key

**What goes wrong:** Code partially migrated — some paths still write/read `currentVideoCategory` (unscoped), others use `currentVideoCategory_${tabId}`. Popup reads wrong key and shows stale data.
**Why it happens:** Two code paths write to storage (`initForVideo` and the YT_NAVIGATION teardown `remove`). Both must be migrated atomically.
**How to avoid:** Do a complete search for all references to `currentVideoCategory` in content-script.js and popup.js and replace every one. Remove the unscoped key from any storage.set/get/remove call.
**Warning signs:** TABST-02 fails — popup shows the last-closed tab's category instead of the active tab's.

### Pitfall 4: Missing `tabs` Permission for `onRemoved`

**What goes wrong:** `chrome.tabs.onRemoved` listener is registered but never fires because the `tabs` permission is missing.
**Why it happens:** Some tab events require explicit `"tabs"` permission in manifest.json.
**How to avoid:** Check manifest — TFY already has `"activeTab"` permission. Verify: `chrome.tabs.onRemoved` requires the `"tabs"` permission, NOT just `"activeTab"`. `activeTab` only grants temporary access to the active tab when the user invokes the extension. Add `"tabs"` to the `permissions` array in manifest.json.
**Warning signs:** `onRemoved` listener registered without error, but storage keys are never cleaned up.

### Pitfall 5: Popup Opens on Non-YouTube Tab

**What goes wrong:** User opens popup while on Gmail; `tab.url` does not contain `youtube.com/watch`; popup attempts to read a scoped key for a Gmail tab ID that has no entry; shows blank (correct), but might error if not null-guarded.
**Why it happens:** `chrome.tabs.query({ active: true, currentWindow: true })` returns the CURRENTLY active tab, which may not be YouTube.
**How to avoid:** Guard on `tab?.url?.includes('youtube.com/watch')` before reading the scoped key. If the active tab is not a YouTube watch page, show the neutral state. This satisfies TABST-03 indirectly (Gmail tab close → no scoped key → popup shows neutral when focused on YouTube tabs that do have entries).
**Warning signs:** TABST-03 test fails because popup shows garbage or throws.

---

## Code Examples

### Complete Service Worker Changes

```javascript
// service-worker.js — chrome.runtime.onMessage.addListener (UPDATED)
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_CATEGORY') {
    handleCategoryRequest(message.videoIds)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open
  }
  if (message.type === 'SET_VIDEO_CATEGORY') {
    // sender.tab.id is authoritative — content script cannot spoof it
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

// TOP-LEVEL registration — must not be inside a function
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Always clean up regardless of removeInfo.isWindowClosing
  chrome.storage.local.remove(`currentVideoCategory_${tabId}`);
});
```

### Complete Popup Changes

```javascript
// popup.js — DOMContentLoaded handler (UPDATED)
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-query
document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('api-key-input').value = apiKey;
    document.getElementById('status').textContent = 'API key loaded.';
  }

  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  document.getElementById('toggle-filtering').checked = filteringEnabled;

  // TABST-01/02/03: Read per-tab scoped key for the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes('youtube.com/watch')) {
    const key = `currentVideoCategory_${tab.id}`;
    const result = await chrome.storage.local.get(key);
    const category = result[key];
    if (category) {
      document.getElementById('current-category').textContent = `Watching: ${category}`;
    }
    // else: tab exists but no category yet — neutral state (blank) is correct
  }
  // else: not on a YouTube watch page — neutral state
});
```

### Content Script Storage Write Change

```javascript
// content-script.js — inside initForVideo(), replace direct storage write
// OLD (line ~204):
// chrome.storage.local.set({ currentVideoCategory: currentCategoryName });

// NEW: delegate to service worker which has the tab ID via sender.tab.id
chrome.runtime.sendMessage({
  type: 'SET_VIDEO_CATEGORY',
  categoryName: currentCategoryName
}).catch(() => {}); // Non-fatal — popup will show blank if this fails

// content-script.js — inside YT_NAVIGATION handler, replace direct storage remove
// OLD (line ~261):
// chrome.storage.local.remove('currentVideoCategory');

// NEW:
chrome.runtime.sendMessage({ type: 'CLEAR_VIDEO_CATEGORY' }).catch(() => {});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global `currentVideoCategory` key in chrome.storage.local | Per-tab `currentVideoCategory_${tabId}` key | Phase 7 | Eliminates last-write-wins race; each tab owns its entry |
| No tab-close cleanup | `chrome.tabs.onRemoved` deletes scoped key | Phase 7 | Popup shows neutral state after tab close (TABST-01) |
| Popup reads global key | Popup reads scoped key for active tab ID | Phase 7 | Popup shows correct tab's category (TABST-02) |

**Deprecated/outdated:**
- `currentVideoCategory` (unscoped): Replace entirely with `currentVideoCategory_${tabId}`. No migration path needed — on first run, the old unscoped key is simply never read again (popup reads scoped key; it won't find anything until content script writes to the new scoped key). The old key can be left in storage harmlessly; optional cleanup can remove it.

---

## Open Questions

1. **Does `chrome.tabs.onRemoved` require `"tabs"` permission?**
   - What we know: Chrome docs state `onRemoved` is in the `chrome.tabs` namespace. The `"activeTab"` permission provides temporary per-tab access only.
   - What's unclear: Whether `onRemoved` specifically requires `"tabs"` permission or works with just host permissions.
   - Recommendation: Add `"tabs"` to the permissions array in manifest.json as the safe default. This is a minor permission with no user-visible grant dialog in MV3 for normal tab info.

2. **Should the old unscoped `currentVideoCategory` key be actively removed on Phase 7 startup?**
   - What we know: The old key exists in any browser that ran a previous version of TFY.
   - What's unclear: Whether stale data in the old key could cause confusion.
   - Recommendation: Add a one-time cleanup in the service worker (`chrome.storage.local.remove('currentVideoCategory')`) at top level. This is a no-op if the key doesn't exist, and removes any stale state from previous versions.

---

## Sources

### Primary (HIGH confidence)
- https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved — `tabId` and `removeInfo` structure including `isWindowClosing`
- https://developer.chrome.com/docs/extensions/reference/api/tabs#method-query — `chrome.tabs.query` parameters, `active` + `currentWindow`
- https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onActivated — `activeInfo` structure
- https://developer.chrome.com/docs/extensions/reference/api/storage — `chrome.storage.local` limits and use cases
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events — top-level listener registration requirement

### Secondary (MEDIUM confidence)
- Codebase analysis of service-worker.js, popup.js, content-script.js — confirmed existing patterns and exact lines to change

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are official Chrome Extension MV3 APIs verified against developer.chrome.com
- Architecture: HIGH — per-tab key prefix pattern is well-established and verified against existing codebase
- Pitfalls: HIGH — top-level listener requirement verified against official service worker events docs; `getCurrent()` limitation is documented; `tabs` permission requirement confirmed

**Research date:** 2026-02-26
**Valid until:** 2026-04-26 (Chrome extension APIs are stable; 60-day validity appropriate)
