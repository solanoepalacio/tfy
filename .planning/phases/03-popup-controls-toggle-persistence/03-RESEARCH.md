# Phase 3: Popup Controls + Toggle Persistence - Research

**Researched:** 2026-02-24
**Domain:** Chrome MV3 Extension — Popup UI, chrome.storage.local persistence, popup-to-content-script messaging
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POPU-01 | User can toggle filtering on/off from the extension popup | Popup UI toggle + `chrome.tabs.sendMessage` to notify content script immediately |
| CORE-04 | Toggle state persists across browser restarts | `chrome.storage.local` persists across browser restarts (confirmed in official docs) |
</phase_requirements>

---

## Summary

Phase 3 adds a toggle switch to the existing popup (`popup.html` / `popup.js`) and persists the enabled/disabled state in `chrome.storage.local`. The toggle state must be read by the content script on every page load and respected in real time when the user clicks the toggle while on a YouTube watch page.

The project already uses `chrome.storage.local` for the API key (`apiKey`). Adding a second key (`filteringEnabled`) follows the exact same pattern — no new storage mechanism needed. The existing storage permission in `manifest.json` covers this.

Communication flow: popup reads/writes state in storage → popup sends `TFY_TOGGLE` message to the active tab's content script via `chrome.tabs.sendMessage` → content script listens on `chrome.runtime.onMessage` and immediately collapses or reveals sidebar items. On initial page load the content script reads the toggle state from storage before calling `initForVideo`.

**Primary recommendation:** Store toggle state as `filteringEnabled` boolean in `chrome.storage.local`; popup writes it and notifies the content script via `chrome.tabs.sendMessage` on the active tab; content script reads it at startup and listens for live changes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chrome.storage.local` | MV3 built-in | Persist toggle state across browser restarts | Already used for `apiKey`; officially documented to survive restarts |
| `chrome.tabs.sendMessage` | MV3 built-in | Popup notifies content script of toggle change | Direct popup-to-content-script messaging; no service worker relay needed |
| `chrome.runtime.onMessage` | MV3 built-in | Content script receives toggle notifications | Already registered in content-script.js for `YT_NAVIGATION` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chrome.tabs.query` | MV3 built-in | Get the active tab ID in popup before calling sendMessage | Required to obtain tabId before `chrome.tabs.sendMessage` |
| HTML `<input type="checkbox">` or `<button>` toggle | Native | Toggle control in popup UI | Simple, zero-dependency; matches existing popup style |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chrome.storage.local` | `chrome.storage.session` | session clears on browser restart — violates CORE-04 |
| Direct `chrome.tabs.sendMessage` from popup | Route via service worker | Unnecessary complexity; popup has direct access to `chrome.tabs` API |
| Checkbox | Custom toggle button | Same result, checkbox is simpler with less CSS |

**Installation:** No new dependencies. All APIs are MV3 built-ins already available.

---

## Architecture Patterns

### Recommended File Changes

```
popup.html        # Add toggle control (checkbox or button) below API key section
popup.js          # Read filteringEnabled on load; write on toggle; sendMessage to active tab
content-script.js # Read filteringEnabled before initForVideo; handle TFY_TOGGLE message
```

No new files required. Service worker (`service-worker.js`) does not need changes.

### Pattern 1: Toggle State Storage

**What:** Store a boolean `filteringEnabled` in `chrome.storage.local`. Default to `true` (filtering on) when the key is absent — treat absence as enabled so the extension works out-of-the-box.

**When to use:** Whenever toggle state needs to survive browser restarts.

**Example:**
```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage

// Read (popup.js onload, content-script.js startup)
const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');

// Write (popup.js on toggle click)
await chrome.storage.local.set({ filteringEnabled: false });
```

### Pattern 2: Popup-to-Content-Script Notification

**What:** After writing new state to storage, popup queries the active YouTube tab and sends a message so the content script can react immediately — without waiting for page reload.

**When to use:** When popup needs to notify a currently-running content script of a state change.

**Example:**
```javascript
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

// In popup.js
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
  chrome.tabs.sendMessage(tab.id, { type: 'TFY_TOGGLE', enabled: newValue })
    .catch(() => {}); // Content script may not be injected on non-watch pages — safe to ignore
}
```

### Pattern 3: Content Script Toggle Handling

**What:** Content script listens for `TFY_TOGGLE` messages and applies or reverses CSS filtering immediately.

**When to use:** Real-time toggle response without page reload.

**Example:**
```javascript
// In content-script.js — add to existing onMessage listener

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TFY_TOGGLE') {
    if (message.enabled) {
      // Re-run filtering — re-collapse off-topic items
      filterSidebar();
    } else {
      // Remove all collapsed state immediately
      resetAllCollapsed();
    }
  }
  // ... existing YT_NAVIGATION handler unchanged
});
```

### Pattern 4: Content Script Startup Guard

**What:** Before calling `initForVideo`, content script reads `filteringEnabled` from storage. If disabled, skip all filtering.

**When to use:** Respecting persisted toggle state on page load.

**Example:**
```javascript
// In content-script.js — wrap the initial load block

const initialVideoId = new URL(window.location.href).searchParams.get('v');
if (initialVideoId) {
  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  lastProcessedVideoId = initialVideoId;
  if (filteringEnabled) {
    initForVideo(initialVideoId);
  }
}
```

**Note:** The initial load block is currently synchronous (`const initialVideoId = ...`). Wrapping it in an async IIFE is required to use `await chrome.storage.local.get`.

### Anti-Patterns to Avoid

- **Reading toggle state on every `filterSidebar()` call:** Unnecessary async overhead on every mutation callback. Read once at startup and on toggle message.
- **Storing toggle state in `chrome.storage.session`:** Clears on browser restart — violates CORE-04.
- **Removing DOM nodes when disabled:** The existing `resetAllCollapsed()` correctly removes the `tfy-hidden` CSS class instead of touching the DOM. Keep this approach.
- **Not catching `tabs.sendMessage` rejection:** The popup might be open on a non-watch YouTube page or a non-YouTube tab. Always `.catch(() => {})` the sendMessage call.
- **Using `tabs` permission when `activeTab` suffices:** The popup only needs the active tab. Declare `"activeTab"` in manifest permissions, not `"tabs"` (which grants broader access and triggers a more alarming install warning).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State persistence | Custom localStorage scheme | `chrome.storage.local` | localStorage in content script writes to youtube.com's storage domain (already noted in codebase comments); service worker has no localStorage at all |
| Cross-context state sync | Custom polling/event bus | Storage read at startup + single message on change | Simple, covers all cases, no polling overhead |

**Key insight:** The toggle state problem is solved entirely by the two APIs already in use. No new patterns needed — this is a feature addition, not an architecture change.

---

## Common Pitfalls

### Pitfall 1: Missing `activeTab` Permission

**What goes wrong:** `chrome.tabs.query()` returns the tab object but `chrome.tabs.sendMessage()` throws "Could not establish connection" or silently fails if the content script is not injected.

**Why it happens:** The content script is only injected on `youtube.com/watch*` pages. If popup is opened while on another tab, `tabs.query` returns that tab and `sendMessage` fails.

**How to avoid:** Always check `tab.url.includes('youtube.com/watch')` before calling `sendMessage`. Wrap in `.catch(() => {})`. This is safe — the stored value in `chrome.storage.local` is the source of truth; the message is just an optimization for immediate UI response.

**Warning signs:** `Unchecked runtime.lastError: Could not establish connection` in console.

### Pitfall 2: Initial Load Block is Synchronous

**What goes wrong:** The bottom of `content-script.js` runs a synchronous block to extract `initialVideoId` and call `initForVideo`. Adding an `await` in this block without an async IIFE causes a syntax error or silent failure.

**Why it happens:** Top-level `await` is not available in content scripts (they are not ES modules by default in Chrome extension MV3 — `content_scripts` use classic scripts unless `"type": "module"` is added to the content script declaration in manifest).

**How to avoid:** Wrap the initial load block in an immediately-invoked async function:
```javascript
(async () => {
  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  const initialVideoId = new URL(window.location.href).searchParams.get('v');
  if (initialVideoId && filteringEnabled) {
    lastProcessedVideoId = initialVideoId;
    initForVideo(initialVideoId);
  }
})();
```

**Warning signs:** `SyntaxError: await is only valid in async functions` in DevTools.

### Pitfall 3: Toggle Off Does Not Clear Observer

**What goes wrong:** User disables filtering. `resetAllCollapsed()` runs and sidebar items show. But the `MutationObserver` is still active. When YouTube renders new sidebar items, `filterSidebar()` is called again — but `filteringEnabled` is not rechecked, so items get collapsed again.

**Why it happens:** `sidebarObserver` fires `filterSidebar` via callback. If toggle disabled state is stored only in the message, not in a module-level variable, the observer callback still runs.

**How to avoid:** Maintain a module-level `let filteringEnabled = true` in `content-script.js`. When `TFY_TOGGLE` arrives with `enabled: false`, set this variable to `false` AND call `disconnectSidebarObserver()`. When re-enabled, call `initForVideo` again (or `filterSidebar` + `observeSidebar`).

**Warning signs:** Sidebar items collapse back shortly after user disables filtering.

### Pitfall 4: Toggle Default Is Undefined

**What goes wrong:** First install — `chrome.storage.local.get('filteringEnabled')` returns `{}` (empty object). Code does `const { filteringEnabled } = ...` and gets `undefined`. Strict equality check `if (filteringEnabled === true)` fails. Filtering is off on first install.

**Why it happens:** Storage key doesn't exist until first write.

**How to avoid:** Use destructuring default: `const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled')`.

**Warning signs:** Extension appears non-functional on fresh install despite no errors.

---

## Code Examples

Verified patterns from official sources:

### Reading State in Popup on Load
```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage
document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');  // existing
  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');

  document.getElementById('api-key-input').value = apiKey || '';
  document.getElementById('toggle-filtering').checked = filteringEnabled;
});
```

### Writing State and Notifying Content Script
```javascript
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
document.getElementById('toggle-filtering').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ filteringEnabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes('youtube.com/watch')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TFY_TOGGLE', enabled }).catch(() => {});
  }
});
```

### Content Script: Startup Guard
```javascript
// Wrap existing initial load in async IIFE
(async () => {
  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  const initialVideoId = new URL(window.location.href).searchParams.get('v');
  if (initialVideoId && filteringEnabled) {
    lastProcessedVideoId = initialVideoId;
    initForVideo(initialVideoId);
  }
})();
```

### Content Script: Handle TFY_TOGGLE Message
```javascript
// Add branch to existing onMessage listener
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TFY_TOGGLE') {
    filteringEnabled = message.enabled;  // update module-level variable
    if (message.enabled) {
      initForVideo(lastProcessedVideoId);  // re-initialize if we have a video
    } else {
      resetAllCollapsed();
      disconnectSidebarObserver();
    }
    return;
  }
  if (message.type === 'YT_NAVIGATION') {
    // ... existing code unchanged
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `localStorage` for extension state | `chrome.storage.local` | MV3 (Chrome 88+) | localStorage in content scripts writes to page domain, not extension; service worker has no localStorage |
| `chrome.storage.sync` for user prefs | `chrome.storage.local` | Per project decision (STATE.md) | Project explicitly chose local over sync — single device use case |
| Routing popup→content via service worker | Direct `chrome.tabs.sendMessage` from popup | MV3 allows popup as full extension context | Simpler; no service worker intermediary needed |

**Deprecated/outdated:**
- `chrome.tabs.executeScript`: Replaced by scripting API in MV3 — not needed here.
- MV2 `background.js` persistent page: Replaced by service worker — not applicable.

---

## Open Questions

1. **Should `TFY_TOGGLE` re-call `initForVideo` or just `filterSidebar`?**
   - What we know: `initForVideo` fetches current video category (API call) then runs filtering. `filterSidebar` reuses `currentCategoryId` already in memory.
   - What's unclear: If user disables then re-enables filtering during same session, `currentCategoryId` is still set. `filterSidebar()` is sufficient and cheaper than `initForVideo`.
   - Recommendation: If `currentCategoryId` is set when re-enabling, call `filterSidebar()` + `observeSidebar(filterSidebar)`. If `currentCategoryId` is null (was cleared), call `initForVideo(lastProcessedVideoId)`. This avoids unnecessary API calls.

2. **Manifest `activeTab` permission needed?**
   - What we know: `chrome.tabs.query({ active: true, currentWindow: true })` works for getting tabId. The official docs indicate `tabs` permission is for sensitive properties (url, title); popup has access to `chrome.tabs` without the `tabs` permission for basic operations.
   - What's unclear: Whether `tabs.sendMessage` requires any permission at all beyond having the content script injected.
   - Recommendation: Add `"activeTab"` to manifest permissions as the minimal addition. It grants temporary access to the active tab when the user clicks the extension action. This is the standard pattern for popup-initiated tab communication.

---

## Sources

### Primary (HIGH confidence)
- https://developer.chrome.com/docs/extensions/reference/api/storage — storage.local persistence guarantees, get/set API, data types
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging — popup-to-content-script via `chrome.tabs.sendMessage`, message patterns
- https://developer.chrome.com/docs/extensions/reference/api/tabs — tabs.query, tabs.sendMessage, activeTab permission behavior

### Secondary (MEDIUM confidence)
- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab — activeTab permission scope and duration (verified against official Chrome docs)
- WebSearch results cross-referenced with official docs for `chrome.tabs.query` permission requirements

### Tertiary (LOW confidence)
- None — all critical claims verified against official Chrome developer documentation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are Chrome built-ins documented at developer.chrome.com; project already uses them
- Architecture: HIGH — patterns derived from official docs and existing codebase patterns; no external libraries
- Pitfalls: HIGH — Pitfalls 1, 2, 4 are mechanically derivable from API behavior; Pitfall 3 derived from understanding existing observer pattern in codebase

**Research date:** 2026-02-24
**Valid until:** 2026-08-24 (Chrome extension APIs are stable; MV3 is current standard)
