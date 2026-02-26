# Project Research Summary

**Project:** TFY (Track For You) — Chrome Extension YouTube Sidebar Filter
**Domain:** Chrome Manifest V3 Extension — v1.3 Bug Fixes
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

TFY is a personal-use Chrome MV3 extension that filters YouTube sidebar suggestions based on the currently playing video's category, auto-inferred via the YouTube Data API v3. The product is already built and functionally complete through v1.2. The v1.3 milestone is a focused bug-fix release targeting two runtime correctness failures: stale popup state after tab close, and broken filtering when users navigate to a watch page from the YouTube homepage via SPA navigation. Both bugs are well-understood, low-risk to fix, and require minimal code changes — no new files, no new dependencies, no build-step changes.

The recommended approach for v1.3 is to address the two bugs in dependency order. The SPA navigation fix (expand the content script match pattern from `youtube.com/watch*` to `youtube.com/*`) must come first because it ensures the content script is present in all YouTube tabs, which is a prerequisite for the popup-to-content-script messaging that correctly solves multi-tab state accuracy. The tab lifecycle fix (add `chrome.tabs.onRemoved` + per-tab storage keying routed through the service worker) follows. The popup is updated last to read per-tab storage keys using the active tab ID from `chrome.tabs.query`. All three fixes are modifications to existing files only.

The primary implementation risk is not feature complexity but MV3 service worker lifecycle correctness: all event listeners must be registered at the top level of `service-worker.js` (not inside async callbacks or conditional blocks), or they will be silently lost when Chrome terminates the idle worker. The existing codebase already demonstrates the correct top-level registration pattern for `onMessage` and `onHistoryStateUpdated`. The fix must follow the same pattern for `onRemoved`. A secondary risk is that per-tab storage cleanup must be gated on a tab registry (populated by the already-present `onHistoryStateUpdated` listener) — otherwise closing a non-YouTube tab (Gmail, Google Docs) silently wipes the popup's category display for a still-open YouTube tab.

---

## Key Findings

### Recommended Stack

No new frameworks, libraries, or build steps are required for v1.3. The fix draws on four Chrome APIs not currently registered in the extension:

**Core technologies (new for v1.3):**
- `chrome.tabs.onRemoved` — Detect tab close in service worker; fires with `(tabId, removeInfo)` for every tab closed in Chrome; no `"tabs"` permission required for the event itself; clean up per-tab storage entry on receipt
- `chrome.tabs.onActivated` — Optional; detect active tab switch; `activeInfo.tabId` available immediately; tab URL requires `chrome.tabs.get(tabId)` and the `"tabs"` permission
- `chrome.scripting.executeScript` — Programmatic content script injection fallback; used when `sendMessage` throws (content script absent in tab); requires `"scripting"` permission; treated as optional hardening, not the primary fix
- Per-tab storage key scheme (`currentVideoCategory_${tabId}`) — Replaces global flat `currentVideoCategory` key; eliminates multi-tab race conditions; writer is the service worker (using `sender.tab.id` from `onMessage`), not the content script

**Critical storage shape change:** The flat `currentVideoCategory` string key in `chrome.storage.local` becomes `currentVideoCategory_${tabId}`. This is a breaking change to how the content script writes and the popup reads category state. The service worker acts as the sole writer because content scripts cannot reliably obtain their own `tabId` — `chrome.tabs.getCurrent()` is not available in content scripts; the reliable path is routing the write through `chrome.runtime.sendMessage` and using `sender.tab.id` in the service worker's `onMessage` handler.

**No new manifest permissions are required** for the core fixes. `chrome.tabs.onRemoved` fires without `"tabs"`. The `webNavigation` permission (already declared) provides `details.tabId` and `details.url` for building the tab registry — no `"tabs"` permission needed for that path.

### Expected Features

The core product is complete. v1.3 adds no new user-visible capabilities — it makes existing capabilities work correctly in flows that previously failed silently.

**Must have (table stakes — being fixed in v1.3):**
- Popup reflects current reality — users trust the popup as a status indicator; showing stale data from a closed tab breaks that trust
- Filtering activates from homepage navigation — navigating YouTube home then clicking a video is the primary user entry path; filtering must activate in this flow, not only on hard page loads to `/watch` URLs
- Multi-tab popup accuracy — popup must show the active tab's category, not whichever tab last wrote to the global storage key

**Already shipped and working (do not break):**
- Toggle on/off via popup — every competitor has this; TFY has it
- Auto-infer category from current video — TFY's core differentiator; no competitor does this automatically; zero configuration per session
- Collapse (not remove) off-topic suggestions with "Hidden: [category] · [title]" label — preserves user agency
- SPA navigation within watch pages — handled via `webNavigation.onHistoryStateUpdated` relay + `yt-navigate-finish` DOM event fallback with `lastProcessedVideoId` deduplication guard
- Shorts shelf suppression — simple CSS rule; no logic changes needed

**Defer (v2+):**
- Persistent category cache across sessions — video categories never change; a `chrome.storage.local` video_id→category_id map would reduce API calls significantly across sessions
- Related category grouping — Education + Science & Technology both qualify when watching a lecture; requires category relationship logic
- Channel allowlist — always show specific channels regardless of category
- Keyword/regex filtering — out of scope; contradicts TFY's zero-configuration value proposition

**Anti-features (explicitly excluded):**
- Manual category allowlist/blocklist UI — defeats the auto-infer differentiator; makes TFY a YouTube Focus Mode clone
- Homepage feed filtering — no "current video" to match against on the homepage; different product
- Tab-scoped storage key scheme as top-level design (use service-worker-mediated writes instead) — direct tab ID storage from content scripts is unreliable
- Polling for active tab state — fights Chrome's event model; use `chrome.tabs.onActivated` events instead

### Architecture Approach

TFY follows the canonical Chrome MV3 three-component architecture: content script for DOM interaction, service worker as a stateless API gateway, and `chrome.storage.local` as the shared state bus. The v1.3 changes reinforce this separation: content scripts route category storage writes through the service worker (which has `sender.tab.id`), rather than writing to storage directly. This eliminates the multi-tab race condition at its root.

**Major components and their v1.3 changes:**
1. `manifest.json` — Declares permissions and content script rules; match pattern changes from `https://www.youtube.com/watch*` to `https://www.youtube.com/*`
2. `content-script.js` — DOM interaction on all YouTube pages; replaces `chrome.storage.local.set({ currentVideoCategory })` with `chrome.runtime.sendMessage({ type: 'STORE_CURRENT_CATEGORY', categoryName })`; IIFE guard already exits gracefully on non-watch pages (no `?v` param)
3. `service-worker.js` — Adds `chrome.tabs.onRemoved` at top level to clear per-tab storage; adds `STORE_CURRENT_CATEGORY` message handler using `sender.tab.id`; updates existing `onHistoryStateUpdated` handler to maintain a tab registry (`Set` of YouTube watch tab IDs)
4. `popup.js` — Replaces global `currentVideoCategory` read with: query active tab (`chrome.tabs.query`), construct per-tab key, read `currentVideoCategory_${tabId}`

**Key architectural patterns carried forward:**
- All service worker event listeners registered at top level (not in async callbacks)
- Service worker is stateless — all persistent state in `chrome.storage.local`; in-memory structures (tab registry `Set`) can be rebuilt from `webNavigation` events after service worker restart
- Message-passing bridge: content script → service worker for all writes and API calls; service worker → content script for navigation relay and toggle
- `sender.tab.id` in `onMessage` handler is the authoritative source of a content script's tab ID

### Critical Pitfalls

1. **Registering `tabs.onRemoved` inside an async callback** — Chrome restores only top-level listeners after idle service worker termination; a listener inside `.then()` or an async IIFE is silently lost when the worker wakes. Register at module scope; async work goes inside the handler body. The existing `onMessage` and `onHistoryStateUpdated` registrations demonstrate the correct pattern.

2. **Global `currentVideoCategory` storage key with multiple tabs** — Last-writer-wins is non-deterministic across tabs; popup shows the wrong tab's category. Fix: key by `tabId` (`currentVideoCategory_${tabId}`), written by the service worker using `sender.tab.id`.

3. **`tabs.onRemoved` fires for every tab close in Chrome, not just YouTube tabs** — Closing a Gmail tab unconditionally clears YouTube state. Gate cleanup on a tab registry (`Set` of known YouTube watch tab IDs, populated by the already-present `onHistoryStateUpdated` listener).

4. **`chrome.tabs.get(tabId)` called inside `tabs.onRemoved`** — The tab is already destroyed when the handler fires; `tabs.get` returns an error. Use the pre-built tab registry instead of looking up tab metadata at close time.

5. **Orphaned `observeSidebar` retry timers from rapid navigation** — `observeSidebar` uses `setTimeout` retry when `#secondary` is not yet present; rapid navigation leaves pending timers that attach additional `MutationObserver` instances after teardown. Fix: store the timer reference and cancel it in `disconnectSidebarObserver`.

---

## Implications for Roadmap

The v1.3 changes have a clear dependency order confirmed by all four research files. Three phases are recommended.

### Phase 1: SPA Navigation Fix
**Rationale:** The manifest match pattern expansion from `watch*` to `/*` is a prerequisite for the popup accuracy fix. Once the content script is present in all YouTube tabs (including those starting on the homepage), the popup can reliably send a message to the content script (or read the per-tab storage key that the service worker wrote). This is also the lowest-risk change — a single manifest line — and is independently verifiable before touching the storage architecture. The SPA fix also requires verifying that `disconnectSidebarObserver` correctly cancels the retry timer (Pitfall 9) and is called at the top of `initForVideo` to prevent double observer attachment (Pitfall 6).
**Delivers:** Filtering activates when users navigate from the YouTube homepage to a watch page. Both the `yt-navigate-finish` fallback and the `YT_NAVIGATION` service worker relay work correctly in the homepage-first navigation path.
**Addresses:** Bug 2 (SPA navigation from non-watch pages); table-stakes feature "filtering activates from homepage navigation"
**Avoids:** Pitfall 6 (duplicate `initForVideo` on dual SPA signals), Pitfall 7 (`yt-navigate-finish` fires on non-watch pages — existing `?v` guard is load-bearing), Pitfall 9 (orphaned `observeSidebar` retry timers)
**Files changed:** `manifest.json` (one line), `content-script.js` (verify IIFE guard; add timer cancel to `disconnectSidebarObserver`; add `disconnectSidebarObserver` call at top of `initForVideo`)

### Phase 2: Tab Lifecycle Fix + Multi-Tab Storage Scoping
**Rationale:** These two changes must be implemented together. Adding `onRemoved` to clear `currentVideoCategory` (the old global key) while the popup reads a per-tab key creates a new mismatch. The write path (content script sends `STORE_CURRENT_CATEGORY`, service worker keys by `sender.tab.id`) and the cleanup path (`onRemoved` removes per-tab key, gated on tab registry) must land as a unit. The tab registry is built by augmenting the already-present `onHistoryStateUpdated` handler — do not add a second listener for the same event.
**Delivers:** Popup shows neutral state when no YouTube watch tab is active. Popup shows the correct tab's category when multiple YouTube tabs are open. Closing one YouTube tab does not clear another tab's category display. Closing a non-YouTube tab has no effect on popup state.
**Addresses:** Bug 1 (stale popup state after tab close); multi-tab accuracy (popup reflects active tab)
**Avoids:** Pitfall 1 (`onRemoved` in async context), Pitfall 2 (global storage key), Pitfall 3 (unconditional cleanup for all tab closes), Pitfall 4 (avoid `"tabs"` permission by using `webNavigation` for tab registry), Pitfall 5 (popup reads storage once — per-tab key at open time is the fix)
**Files changed:** `service-worker.js` (add `onRemoved` listener at top level; add `STORE_CURRENT_CATEGORY` handler; update `onHistoryStateUpdated` to populate tab registry), `content-script.js` (replace direct `chrome.storage.local.set` with `sendMessage({ type: 'STORE_CURRENT_CATEGORY' })`), `popup.js` (read `currentVideoCategory_${tab.id}` using active tab from `chrome.tabs.query`)

### Phase 3: Cleanup + Hardening
**Rationale:** Low-risk housekeeping that improves long-session correctness and maintainability. Can be deferred if scope needs to tighten but adds meaningful robustness with minimal risk.
**Delivers:** Removal of dead `fetchAndLogCategory` function (Pitfall 10). Optional: `chrome.storage.session` mirror for the in-memory tab registry to survive service worker restarts (Pitfall 8). Optional: `chrome.runtime.onStartup` sweep to remove orphaned per-tab keys from previous browser sessions.
**Addresses:** Pitfall 8 (in-memory tab registry lost on service worker restart causes stale storage), Pitfall 10 (dead `fetchAndLogCategory` code with no callers)
**Files changed:** `content-script.js` (remove `fetchAndLogCategory`); `service-worker.js` (add session storage mirror for tab registry; add startup cleanup sweep)

### Phase Ordering Rationale

- Phase 1 before Phase 2 because the manifest match expansion ensures the content script is present in tabs that originate from the YouTube homepage, which is the precondition for the popup accurately querying content script state. Without Phase 1, the popup messaging pattern still fails on homepage-first tabs.
- Phase 2 atomically bundles tab-close cleanup and per-tab storage keying because they share the same storage key schema. Implementing either in isolation introduces a new bug (clearing the wrong key, or reading a key that was never written with the new scheme).
- Phase 3 is hardening — the two primary bugs are resolved by Phases 1 and 2. Phase 3 prevents edge-case regression over long sessions (service worker restarts, stale key accumulation) and removes dead code before it can be accidentally wired up.

### Research Flags

All phases have well-documented patterns. No phases require `/gsd:research-phase` during planning.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (SPA Nav Fix):** Single manifest line + code verification. Chrome's content script injection model is definitively documented. The IIFE guard behavior on non-watch pages is confirmed by direct code inspection.
- **Phase 2 (Tab Lifecycle Fix):** All APIs are official Chrome APIs with clear signatures and permission requirements. The `sender.tab.id` pattern for obtaining tab ID in a content script context is documented in Chrome messaging docs. The tab registry pattern using `webNavigation` to avoid `"tabs"` permission is confirmed in official docs.
- **Phase 3 (Cleanup):** Housekeeping only. No new API surface. `chrome.storage.session` behavior is documented.

**One verification item to address during Phase 1 execution (not a research gap):** The exact timing window between dual SPA navigation signals (`YT_NAVIGATION` relay vs `yt-navigate-finish` DOM event) during rapid re-navigation has not been empirically measured. The fix (call `disconnectSidebarObserver` at the top of `initForVideo`) is correct by construction, but verify with a rapid three-video navigation test that exactly one `[TFY]` category log line appears per navigation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All new APIs sourced from official Chrome for Developers docs; no undocumented behavior in the fix paths; version minimums well below current Chrome stable |
| Features | HIGH | Bug fix scope verified against actual extension source code; competitive landscape research from v1.0–v1.2 confirmed TFY's differentiator remains novel; v1.3 bug behaviors confirmed by direct code path analysis |
| Architecture | HIGH | All patterns from official Chrome MV3 docs; `sender.tab.id`, top-level listener registration, `chrome.storage.session` vs `local` — all definitively documented; existing codebase validates patterns work in practice |
| Pitfalls | HIGH (critical), MEDIUM (moderate) | Critical pitfalls (Pitfalls 1–7) verified against official docs and direct source analysis; moderate pitfalls (Pitfall 8 service worker restart, Pitfall 9 timer accumulation) based on code analysis and known MV3 lifecycle behavior |

**Overall confidence:** HIGH

### Gaps to Address

- **FEATURES.md vs ARCHITECTURE.md approach discrepancy for popup category query:** FEATURES.md (§ Bug 1 Expected Behavior: Multi-Tab) recommends querying the content script directly via `GET_CURRENT_CATEGORY` message as the multi-tab fix. ARCHITECTURE.md and STACK.md both implement per-tab storage keying via the service worker as the primary approach. The storage keying approach is more robust (works even while the content script is initializing or if it has not yet received a video), and all code examples in the research files use storage keying. Treat the message-based query as a supplementary option, not the primary implementation. Resolve in Phase 2 by following the storage keying approach.

- **In-memory tab registry behavior after service worker restart:** The `Set` of YouTube watch tab IDs is in-memory and resets when Chrome terminates the idle service worker. After restart, `onHistoryStateUpdated` will re-populate the registry as tabs navigate, but a tab close event that fires immediately after a service worker wake (before any navigation event re-populates the registry) will be missed. Impact is low — a stale storage key accumulates (a few bytes) but does not cause functional breakage since the popup reads an active-tab-scoped key at open time. Address in Phase 3 with `chrome.storage.session` mirror.

- **`yt-navigate-finish` event stability:** Not officially documented by YouTube. Confirmed stable by multiple independent extension developers and community sources, but could be removed in a future YouTube frontend update. The extension already has `webNavigation.onHistoryStateUpdated` as the primary SPA detection mechanism. The `yt-navigate-finish` listener is belt-and-suspenders. No action needed for v1.3 beyond preserving the existing fallback.

---

## Sources

### Primary (HIGH confidence)
- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) — `onRemoved`, `onActivated`, `query`, `get` signatures; permission requirements for `url` access vs event-only access
- [chrome.scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) — `executeScript` signature; `"scripting"` permission requirement
- [Chrome Extension Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — top-level listener registration requirement; 30-second idle termination; event-driven wake behavior
- [Chrome Extension Message Passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) — `sender.tab.id` availability in `onMessage` handler; `return true` for async `sendResponse`
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) — `local` vs `session` semantics; no transaction support (concurrent writes are non-deterministic)
- [chrome.webNavigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) — `onHistoryStateUpdated` for SPA pushState detection; `details.tabId` and `details.url` available without `"tabs"` permission
- [Manifest — content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) — static injection only fires on document creation (hard page load); SPA navigation does not re-inject
- [chrome.tabs permission requirements](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) — `"tabs"` required only to read `url`, `pendingUrl`, `title`, `favIconUrl` from Tab objects
- Direct source code analysis: `service-worker.js`, `content-script.js`, `popup.js`, `manifest.json` in this repo (HIGH — ground truth)

### Secondary (MEDIUM confidence)
- [tabs.onRemoved — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onRemoved) — `removeInfo` shape: `{ windowId: number, isWindowClosing: boolean }`; tab URL not available in callback
- [WXT content scripts guide](https://wxt.dev/guide/essentials/content-scripts.html) — content script match pattern limitation for SPA sites
- [Chrome Extensions SPA support (Medium)](https://medium.com/@softvar/making-chrome-extension-smart-by-supporting-spa-websites-1f76593637e8) — SPA injection patterns
- [MV3 service worker listener loss (Chromium groups)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/05BZLHHxMmc) — community-confirmed async listener registration failures; aligns with official lifecycle docs
- [chrome.storage concurrent write race conditions (Chromium groups)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/y5hxPcavRfU) — community-documented; corroborates no-transaction official docs
- [Content script not reinjected on SPA navigation (Chromium groups)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/32lLHYjQUQQ) — confirmed behavior; content scripts only inject on document creation

### Tertiary (MEDIUM confidence — undocumented YouTube internals)
- [yt-navigate-finish event confirmation (GitHub)](https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72) — `yt-navigate-finish` and `yt-page-data-updated` event names confirmed by multiple extension developers; not officially documented by YouTube; stable in practice for years

### Competitor analysis (HIGH confidence for market positioning)
- Unhook (1M users, 4.9 stars) — nuclear sidebar removal; different value proposition from TFY
- DF Tube (100K users, last updated 2019) — same nuclear approach; stale
- YouTube Focus Mode (1K users, 3.8 stars) — manual category selection; TFY's auto-infer is the differentiator
- YouTube Blocker (10K users, 4.5 stars) — hardcoded education categories; TFY's dynamic matching is the differentiator
- BlockTube (100K users, 3.9 stars) — keyword/channel blocking; different approach; no category awareness

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
