# Phase 6: SPA Navigation Fix - Research

**Researched:** 2026-02-26
**Domain:** Chrome Extension MV3 — SPA Navigation, Content Script Injection Scope
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPAV-01 | Filtering activates automatically when navigating from the YouTube homepage to a watch page (no page reload required) | Root cause identified: content script not injected on homepage tabs. Fix: expand manifest match pattern to `youtube.com/*`. The existing `YT_NAVIGATION` relay already fires the right signal — the content script just isn't present to receive it. |
| SPAV-02 | Filtering activates automatically on any in-app YouTube navigation to a watch page (e.g., clicking related videos, navigating back and forward) | Dual-signal system already exists (`YT_NAVIGATION` + `yt-navigate-finish`). The SPAV-01 manifest fix covers all SPA cases since the content script will be present in any YouTube tab. Additional hardening needed: cancel pending retry timers on teardown, add `disconnectSidebarObserver()` guard inside `initForVideo`. |
</phase_requirements>

---

## Summary

Phase 6 fixes a single root-cause bug: the content script match pattern `https://www.youtube.com/watch*` means the content script is only injected into tabs that perform a full-page load on a watch URL. When the user starts on the YouTube homepage (`youtube.com`) and clicks a video, YouTube performs a SPA (pushState) navigation — no new document is created, so no new content script injection occurs. The service worker's `webNavigation.onHistoryStateUpdated` relay fires correctly and calls `chrome.tabs.sendMessage()`, but the content script is not present in that tab. The call is swallowed silently by the `.catch(() => {})` guard.

The fix is a two-line manifest change: expand `content_scripts[0].matches` from `["https://www.youtube.com/watch*"]` to `["https://www.youtube.com/*"]`. The content script is then injected into all YouTube tabs regardless of starting URL. The existing IIFE guard (`if (initialVideoId && filteringEnabled)`) already correctly handles non-watch injection — when the user lands on the homepage, `initialVideoId` is null and the IIFE exits without calling `initForVideo`. When the user later navigates to a watch page, the existing `YT_NAVIGATION` message handler fires and calls `initForVideo` with the correct video ID.

Two secondary hardening items also belong in this phase (both catalogued in existing PITFALLS.md): (1) the `observeSidebar` retry `setTimeout` accumulates timers on rapid navigation because `disconnectSidebarObserver` does not cancel the pending timer — fix by storing the timer reference and clearing it in disconnect; (2) `initForVideo` does not call `disconnectSidebarObserver` before calling `observeSidebar` — add that guard to make the function idempotent on double-call. Additionally, dead code `fetchAndLogCategory` should be removed before v1.3 ships to prevent future confusion and accidental double-API-call wiring.

**Primary recommendation:** Change the manifest match pattern to `youtube.com/*`, then harden `disconnectSidebarObserver` to cancel retry timers and add the idempotency guard inside `initForVideo`. Three files change total: `manifest.json`, `content-script.js`. Service worker and popup are untouched for this phase.

---

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `chrome.webNavigation.onHistoryStateUpdated` | MV3 | Detects YouTube SPA pushState navigations in the service worker | Official Chrome API for SPA navigation detection; already present in service-worker.js |
| `chrome.tabs.sendMessage` | MV3 | Relays navigation event from service worker to content script | Only API for service worker → content script messaging by tabId; already present |
| `yt-navigate-finish` DOM event | YouTube-internal | Belt-and-suspenders fallback navigation signal in content script | Fires after YouTube finishes rendering; already present as fallback |
| `MutationObserver` | Web standard | Watches `#secondary` for new sidebar items to filter | Only correct approach for observing YouTube's lazy-loaded sidebar; already present |
| `manifest.json` content_scripts matches | MV3 | Controls which pages inject the content script | Declarative; the root fix for SPAV-01/02 |

### Supporting

| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `lastProcessedVideoId` guard | in-code | Deduplicates dual navigation signals | Both `YT_NAVIGATION` and `yt-navigate-finish` fire for same navigation; guard prevents double init |
| `sidebarObserverRetryTimer` variable | in-code | Stores the setTimeout handle from observeSidebar retry loop | Cancel on teardown to prevent orphaned timers from rapid navigation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Expanding manifest match to `youtube.com/*` | Programmatic injection via `chrome.scripting.executeScript` | Programmatic injection requires `"scripting"` permission, more complex service worker logic, and must handle race conditions. Manifest expansion is simpler, declarative, and the right tool for "inject everywhere on this domain." |
| `yt-navigate-finish` fallback | Poll `window.location.href` on interval | Polling wastes CPU and is less reliable. The DOM event is already present and working. |

**Installation:** No new packages. This is pure extension manifest and JavaScript changes.

---

## Architecture Patterns

### Recommended Project Structure

```
tfy/
├── manifest.json            # CHANGED: matches pattern expanded to youtube.com/*
├── content-script.js        # CHANGED: observeSidebar timer tracking + initForVideo guard + dead code removal
├── service-worker.js        # UNCHANGED for Phase 6
├── popup.js                 # UNCHANGED for Phase 6
├── popup.html               # UNCHANGED
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Pattern 1: Expanded Match Pattern with IIFE Guard

**What:** Change manifest `content_scripts[0].matches` to `["https://www.youtube.com/*"]` so the content script is present in all YouTube tabs. The IIFE at the bottom of the content script guards `initForVideo()` against running on non-watch pages.

**When to use:** Any Chrome extension that needs to handle SPA navigation on a multi-page-pattern domain.

**Example:**
```json
// manifest.json
"content_scripts": [
  {
    "matches": ["https://www.youtube.com/*"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }
]
```

```javascript
// content-script.js — IIFE guard (already present, no change needed)
(async () => {
  const { filteringEnabled: storedEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  filteringEnabled = storedEnabled;
  const initialVideoId = new URL(window.location.href).searchParams.get('v');
  if (initialVideoId && filteringEnabled) {
    // Only runs on watch pages — null-safe guard
    lastProcessedVideoId = initialVideoId;
    initForVideo(initialVideoId);
  }
})();
```

When injected on `youtube.com` (homepage), `initialVideoId` is null — IIFE exits. When the user navigates to `/watch?v=...`, the `YT_NAVIGATION` message fires and the existing listener calls `initForVideo`.

### Pattern 2: Idempotent Observer Teardown

**What:** `disconnectSidebarObserver()` must also cancel any pending retry `setTimeout` from `observeSidebar`. Store the timer handle in a module-level variable. Add a `disconnectSidebarObserver()` call at the top of `initForVideo` to make it safe to call twice.

**When to use:** Any time a retry loop uses `setTimeout` and teardown can fire before the timer resolves.

**Example:**
```javascript
// content-script.js — add timer tracking
let sidebarObserverRetryTimer = null;  // NEW module-level variable

function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    sidebarObserverRetryTimer = setTimeout(() => observeSidebar(callback), 300);  // store handle
    return;
  }
  sidebarObserver = new MutationObserver((mutations) => {
    // ... existing logic unchanged ...
  });
  sidebarObserver.observe(container, { childList: true, subtree: true });
}

function disconnectSidebarObserver() {
  if (sidebarObserverRetryTimer) {
    clearTimeout(sidebarObserverRetryTimer);   // NEW: cancel pending retry
    sidebarObserverRetryTimer = null;
  }
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}

async function initForVideo(videoId) {
  disconnectSidebarObserver();  // NEW: guard against double-observer on double-call
  // ... rest of function unchanged ...
}
```

### Pattern 3: Dead Code Removal (fetchAndLogCategory)

**What:** `fetchAndLogCategory` (lines 215-241 of content-script.js) is unreachable — no callers. Remove it before v1.3 ships to prevent accidental wiring and duplicate API calls.

**When to use:** Any time a function has zero callers and its logic is superseded by another function.

**Why now:** `initForVideo` performs the same category lookup with more logic on top. Having both functions risks a future contributor accidentally calling `fetchAndLogCategory` alongside `initForVideo`, doubling API requests.

### Anti-Patterns to Avoid

- **Keeping the narrow match pattern and using programmatic injection instead:** `chrome.scripting.executeScript` requires the `"scripting"` permission, must be called from the service worker (which has its own race conditions), and is harder to verify. The manifest match pattern is the correct tool.
- **Adding a second `onHistoryStateUpdated` listener for the tab registry:** The service worker already has one. Modify the existing listener — do not add a second one for the same event.
- **Registering any new service worker listener inside an async callback:** All listeners must be top-level. Phase 6 does not add new listeners, so this is not a risk here — but confirm `service-worker.js` changes (if any) follow this pattern.
- **Removing the `if (!videoId || videoId === lastProcessedVideoId) return` guard from `yt-navigate-finish`:** This guard is load-bearing. `yt-navigate-finish` fires for all YouTube SPA navigations including homepage and search — the guard prevents `initForVideo` from running on non-watch-page navigations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SPA navigation detection | Custom `pushState` monkey-patching or `hashchange` listener | `chrome.webNavigation.onHistoryStateUpdated` (already present) | The Chrome API fires reliably on pushState; monkey-patching `history.pushState` in a content script is fragile and can break pages |
| Content script injection scoping | Programmatic `chrome.scripting.executeScript` in service worker | Manifest `content_scripts[].matches` pattern | Declarative injection is simpler, more reliable, and no permission escalation needed |
| Deduplication of dual nav signals | Complex state machine | `lastProcessedVideoId` string comparison (already present) | The simple guard already handles the race; the dual-signal system is belt-and-suspenders by design |

**Key insight:** All the machinery for SPA navigation is already built. The bug is purely a configuration problem (manifest scope too narrow). The fix is minimal: expand the scope, add one idempotency guard, cancel one timer.

---

## Common Pitfalls

### Pitfall 1: CSS Injection Side Effect of Expanding the Match Pattern

**What goes wrong:** `injectTFYStyles()` is called unconditionally at module top-level (line 56 of content-script.js), before the IIFE. After expanding the match pattern, the content script is injected on all YouTube pages including the homepage. The `tfy-styles` `<style>` block is injected into the homepage's `<head>`.

**Why it happens:** The style injection is unconditional — it runs regardless of whether the page is a watch page.

**How to avoid:** This is actually fine. The styles are scoped to `.tfy-hidden`, `yt-lockup-view-model.tfy-hidden`, `ytd-reel-shelf-renderer`, and `ytm-shorts-lockup-view-model-v2`. On the homepage, `ytd-reel-shelf-renderer` (Shorts shelf) will be hidden — this may be unexpected behavior on the homepage. Decide whether to guard the CSS injection to watch pages only or accept the Shorts shelf being hidden everywhere on YouTube. The simplest, lowest-risk fix: guard `injectTFYStyles()` in the IIFE alongside the `initForVideo` call, so it only runs on watch pages.

**Warning signs:** User reports Shorts hidden on homepage after extension update.

### Pitfall 2: `yt-navigate-finish` Fires Before DOM Is Ready

**What goes wrong:** `yt-navigate-finish` fires before `#secondary` exists in the DOM. The `observeSidebar` function's retry loop is the correct handler — but if teardown is not cancelling the retry timer, a prior navigation's timer fires for the new page's `#secondary`.

**Why it happens:** The 300ms retry in `observeSidebar` races with teardown when navigation is rapid.

**How to avoid:** Store the retry timer handle and cancel it in `disconnectSidebarObserver` (Pattern 2 above).

**Warning signs:** Multiple `[TFY] Current video category` console lines for the same video after rapid navigation between videos.

### Pitfall 3: The `TFY_TOGGLE` Message Handler Checks `youtube.com/watch` URL

**What goes wrong:** In `popup.js`, the toggle handler checks `if (tab?.url?.includes('youtube.com/watch'))` before sending `TFY_TOGGLE`. After expanding the content script to all YouTube pages, a user who has the popup open while on a non-watch YouTube page (e.g., homepage) will not receive the toggle message — correct and intentional. But if the user navigated to the homepage and then back to a watch page without the popup detecting it, the toggle might not work.

**Why it happens:** The popup only sends `TFY_TOGGLE` when the active tab URL includes `youtube.com/watch`. This is correct — the content script only does meaningful filtering on watch pages.

**How to avoid:** No change needed. The URL check in `popup.js` is correct. The `TFY_TOGGLE` message handler in the content script also uses the module-level `filteringEnabled` variable, which persists across SPA navigations within the same content script context.

**Warning signs:** None expected — this is the correct behavior.

### Pitfall 4: Duplicate Observer from Double `initForVideo` Call (Rapid Navigation)

**What goes wrong:** User navigates video A → B before A's `initForVideo` resolves. Navigation B triggers teardown (which calls `disconnectSidebarObserver`) and then `initForVideo(videoIdB)`. But A's `initForVideo` is still pending. When A's `initForVideo` eventually calls `observeSidebar(filterSidebar)`, a second observer is attached on top of B's observer.

**Why it happens:** `initForVideo` is `async`. The `lastProcessedVideoId` guard blocks the second signal from re-running `initForVideo`, but cannot stop the first call's in-flight async chain from completing and calling `observeSidebar`.

**How to avoid:** Add `disconnectSidebarObserver()` at the top of `initForVideo`. This makes the function idempotent — if it runs to completion after a subsequent call has already set up a new observer, calling disconnect at the start of any new `initForVideo` run will clean up the stale observer first.

**Warning signs:** `filterSidebar` fires twice per sidebar mutation. Two `[TFY] Current video category` log lines for the same video on rapid navigation.

---

## Code Examples

Verified patterns from official sources and existing codebase analysis:

### Manifest Match Pattern Change (the core fix)

```json
// manifest.json — BEFORE
"content_scripts": [
  {
    "matches": ["https://www.youtube.com/watch*"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }
]

// manifest.json — AFTER
"content_scripts": [
  {
    "matches": ["https://www.youtube.com/*"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }
]
```

Source: Chrome Extension manifest documentation — https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns

### Timer-Aware Sidebar Observer (Pitfall 2 / Pattern 2 fix)

```javascript
// content-script.js — modified module-level variables
let sidebarObserver = null;
let sidebarObserverRetryTimer = null;  // ADD THIS

// content-script.js — modified observeSidebar
function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    sidebarObserverRetryTimer = setTimeout(() => observeSidebar(callback), 300);  // STORE HANDLE
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

// content-script.js — modified disconnectSidebarObserver
function disconnectSidebarObserver() {
  if (sidebarObserverRetryTimer) {
    clearTimeout(sidebarObserverRetryTimer);   // ADD THIS
    sidebarObserverRetryTimer = null;           // ADD THIS
  }
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}

// content-script.js — modified initForVideo (first line added)
async function initForVideo(videoId) {
  disconnectSidebarObserver();  // ADD THIS — idempotency guard
  // ... rest of function unchanged ...
}
```

### CSS Injection Guard (Pitfall 1 — optional but recommended)

```javascript
// content-script.js — OPTION A: guard CSS injection in the IIFE (only inject on watch pages)
(async () => {
  const { filteringEnabled: storedEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  filteringEnabled = storedEnabled;
  const initialVideoId = new URL(window.location.href).searchParams.get('v');
  if (initialVideoId && filteringEnabled) {
    injectTFYStyles();  // MOVED: only inject on watch pages
    lastProcessedVideoId = initialVideoId;
    initForVideo(initialVideoId);
  }
})();

// Remove unconditional call: injectTFYStyles(); (currently line 56)

// NOTE: The yt-navigate-finish handler and YT_NAVIGATION handler must also call
// injectTFYStyles() when initializing for a video, since the script may be injected
// on a non-watch page and later navigate to a watch page.
```

Source: Existing codebase analysis — `/home/solanoe/code/tfy/content-script.js`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Content script on `youtube.com/watch*` only | Content script on `youtube.com/*` with IIFE guard | Phase 6 (v1.3) | Enables filtering when user starts on homepage and navigates to a video — the core SPAV-01/02 fix |
| `observeSidebar` retry loses timer handle | Store timer handle, cancel on disconnect | Phase 6 (v1.3) | Prevents orphaned observers accumulating on rapid navigation |
| `initForVideo` calls `observeSidebar` without disconnecting first | `initForVideo` calls `disconnectSidebarObserver()` first | Phase 6 (v1.3) | Makes the function idempotent, prevents double-observer on in-flight async race |

**Deprecated/outdated after Phase 6:**
- `fetchAndLogCategory` function: Dead code, superseded by `initForVideo`. Remove entirely.
- `"matches": ["https://www.youtube.com/watch*"]` in manifest: Replaced by `"https://www.youtube.com/*"`.

---

## Open Questions

1. **Should `injectTFYStyles()` be guarded to watch pages only?**
   - What we know: After expanding the match pattern, the style block injects on all YouTube pages. The `.tfy-hidden` styles are harmless everywhere. The `ytd-reel-shelf-renderer { display: none }` rule hides Shorts shelves on the homepage — may or may not be desired.
   - What's unclear: Is hiding Shorts on the homepage intentional? The original scope was "watch pages only." REQUIREMENTS.md says "Homepage feed filtering — Out of Scope."
   - Recommendation: Guard `injectTFYStyles()` so it only runs when on a watch page (inside the IIFE, gated on `initialVideoId`). Also ensure `injectTFYStyles()` is called in the `YT_NAVIGATION` and `yt-navigate-finish` handlers before `initForVideo`. This keeps the Shorts-hiding to watch pages only, consistent with original intent. Mark this decision in STATE.md.

2. **Does `popup.js` `TFY_TOGGLE` check `tab?.url?.includes('youtube.com/watch')` need to expand?**
   - What we know: After the manifest change, the content script is present in all YouTube tabs. But toggling on a non-watch page does nothing useful — there's no sidebar to filter.
   - What's unclear: Should the toggle work on non-watch pages (no-op accepted gracefully) or remain restricted to watch pages in the popup?
   - Recommendation: No change to the popup check. The content script already handles `TFY_TOGGLE` gracefully on any page (it just sets `filteringEnabled`). The popup's URL check avoids sending a message that would be ignored. This is fine as-is.

---

## Sources

### Primary (HIGH confidence)

- Chrome Extension manifest match patterns — https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns — confirmed `youtube.com/*` is the correct wildcard syntax for all paths
- Chrome Extension content scripts — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts — confirmed content scripts are NOT re-injected on SPA navigation; they persist in the tab after initial injection
- Existing TFY codebase — `/home/solanoe/code/tfy/content-script.js`, `manifest.json`, `service-worker.js`, `popup.js` — direct inspection, all behavioral claims verified against actual code
- `.planning/research/ARCHITECTURE.md` — v1.3 bug fix architecture research, HIGH confidence, sourced from Chrome official docs

### Secondary (MEDIUM confidence)

- `.planning/research/PITFALLS.md` — Pitfalls 6, 7, 9, 10 directly address Phase 6 concerns; sourced from Chrome official docs + code analysis
- `yt-navigate-finish` community documentation — https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72 — confirmed the event fires for all SPA navigations, not just watch pages

### Tertiary (LOW confidence)

- None required — all critical findings are HIGH or MEDIUM confidence from official docs and direct code inspection.

---

## Metadata

**Confidence breakdown:**
- Root cause of SPAV-01/02: HIGH — confirmed by reading manifest.json and service-worker.js; the `.catch(() => {})` silently swallowing the sendMessage failure is directly observable
- Fix (manifest match expansion): HIGH — documented Chrome behavior; match pattern reference confirmed from official docs
- Secondary hardening (timer cancel, initForVideo guard): MEDIUM-HIGH — code analysis of observeSidebar; the timer accumulation is a real code path with no cancel; the double-observer risk is theoretical but well-founded
- Dead code removal (fetchAndLogCategory): HIGH — confirmed zero callers by direct code inspection

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (Chrome MV3 APIs are stable; YouTube SPA behavior is stable but undocumented — 30 days)
