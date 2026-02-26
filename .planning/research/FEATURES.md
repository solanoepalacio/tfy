# Feature Research

**Domain:** Chrome Extension (YouTube sidebar filter)
**Researched:** 2026-02-20 (v1.0–v1.2), updated 2026-02-26 (v1.3 bug fixes)
**Confidence:** HIGH

## How This Research Was Conducted

Analyzed 10+ YouTube distraction/focus extensions from the Chrome Web Store, including market leaders (Unhook: 1M users, 4.9 stars; DF Tube: 100K users; BlockTube: 100K users) and niche competitors closest to TFY's concept (YouTube Focus Mode: 1K users, category-based blocking; YouTube Blocker: 10K users, educational category filtering; Study Mode YouTube: 1K users). Also analyzed RYS (Remove YouTube Suggestions: 20K users, 80+ features) and UnDistracted (70K users, multi-platform).

For the v1.3 bug-fix milestone, code-level analysis of the existing extension (`content-script.js`, `service-worker.js`, `popup.js`, `manifest.json`) was performed to identify exact architectural gaps, supplemented with Chrome Extensions API documentation research.

## The Competitive Landscape at a Glance

The YouTube focus/distraction space breaks into three tiers:

1. **Nuclear option** (Unhook, DF Tube, RYS, Focused YouTube): Hide/remove entire UI sections wholesale. Sidebar gone. Homepage gone. Comments gone. Binary on/off per section. This is where 95% of extensions live.

2. **Content-level blocking** (BlockTube, Study Mode YouTube): Block specific channels, keywords, or regex patterns. More surgical, but requires manual configuration.

3. **Category-aware filtering** (YouTube Focus Mode, YouTube Blocker): Use YouTube categories to decide what to show/hide. **This is where TFY lives**, and it's the least crowded tier with only ~2 competitors, both small and stale.

**Key insight:** No extension currently does what TFY proposes — *automatically* matching sidebar suggestions to the *currently playing* video's category. YouTube Focus Mode lets you manually select allowed categories. YouTube Blocker hardcodes educational categories. TFY's "infer from current video" approach is genuinely novel in this space.

---

## v1.3 Bug Fix Feature Research

This section was added for the v1.3 milestone. It documents expected behavior for the two runtime bugs identified in PROJECT.md.

### Bug 1: Tab State Management — What the Popup Should Show

#### Problem Diagnosis (from code analysis)

The content script writes `currentVideoCategory` to `chrome.storage.local` when it detects the current video's category (content-script.js line 201). The popup reads this value unconditionally on every open (popup.js lines 15-18). The service worker never clears it. Result: if you close the YouTube tab, open the popup on a non-YouTube tab, and see "Watching: Science & Technology" — which is stale data from the closed tab.

The root cause is that `currentVideoCategory` in storage is global (not tab-scoped), so it leaks across tab lifecycle events.

#### Expected Behavior: Tab Closed

**Table Stakes** — Users expect popup state to reflect reality.

| Scenario | Expected Popup Behavior | Current Behavior (Bug) |
|----------|------------------------|------------------------|
| Active tab is a YouTube watch page | Show "Watching: [Category]" | Works correctly |
| Active tab is NOT a YouTube page | Show neutral state: "Open a YouTube video to begin" or blank category | Shows stale category from last closed YouTube tab |
| YouTube tab is closed, user opens popup on another tab | Neutral state — no category shown | Shows stale category (BUG) |
| All YouTube tabs closed | Neutral state | Shows stale category (BUG) |

**Standard Chrome Extension Pattern:**
`chrome.tabs.onRemoved` fires in the service worker when any tab closes, receiving `(tabId, removeInfo)`. Extensions use this to clean up per-tab state. In this case: if the closed tab was the one that set `currentVideoCategory`, clear it from storage. This is the canonical MV3 approach — register the listener at top level in the service worker (not in an async callback, because Chrome needs top-level listeners to wake a terminated worker).

**Confidence:** HIGH — `chrome.tabs.onRemoved` is documented Chrome Extensions API.

**Complexity:** LOW — Single listener registration, one `chrome.storage.local.remove('currentVideoCategory')` call, one guard check in popup.js.

**Dependency on existing architecture:** Service worker already has top-level listener registration pattern established (see line 7 in service-worker.js). The same pattern applies for `chrome.tabs.onRemoved`.

#### Expected Behavior: Multi-Tab

When the user has multiple YouTube tabs open, the popup should reflect the category of the **currently active tab**, not whichever tab last wrote to storage.

**Problem:** `currentVideoCategory` is a single flat key in storage. If Tab A is watching "Science & Technology" and Tab B is watching "Music", whichever tab most recently wrote wins. If the user switches to Tab A and opens the popup, they may see Tab B's category if Tab B wrote last.

**Standard Pattern:** Two approaches are common in the extension ecosystem:

1. **Tab-scoped storage keys** — store as `currentVideoCategory_[tabId]` instead of a flat key. Popup queries the active tab ID first, then reads the tab-specific key. Clean isolation, but changes the content-script write pattern.

2. **Popup reads active tab ID, queries content script directly** — popup uses `chrome.tabs.query({ active: true, currentWindow: true })` to get the active tab, then sends a message to the content script asking for the current category. Content script responds from its in-memory `currentCategoryId` variable. No storage coordination needed.

**Recommendation for TFY v1.3:** Option 2 (popup queries content script) is simpler because the content script already holds `currentCategoryId` in memory. No storage key scheme changes needed. The popup already uses `chrome.tabs.query` in the toggle handler (popup.js line 35) — the same pattern extends to category display.

**Fallback:** If the active tab is not a YouTube watch page (content script not present), the message send will fail silently — the popup should catch this and show the neutral "not on YouTube" state.

**Confidence:** MEDIUM — Pattern derived from code analysis and Chrome Extensions API documentation; not verified against a published reference implementation.

**Complexity:** LOW-MEDIUM — Requires changing popup.js from storage read to message-based query. The content script needs a handler for the new message type.

**Dependency on existing architecture:** Content script already has `chrome.runtime.onMessage.addListener` handling `TFY_TOGGLE` and `YT_NAVIGATION`. A new `GET_CURRENT_CATEGORY` message type fits the same pattern. Popup.js already uses `chrome.tabs.query` in the toggle handler.

---

### Bug 2: SPA Navigation — Expected Behavior

#### Problem Diagnosis (from code analysis)

The manifest declares the content script with `"matches": ["https://www.youtube.com/watch*"]`. This means Chrome only injects the content script when a tab navigates directly to a `youtube.com/watch` URL. It is NOT injected when the tab is on the YouTube homepage (`youtube.com`) or search results (`youtube.com/results`).

**The navigation path that fails:**
1. User opens a new tab, navigates to `youtube.com` (homepage) — content script NOT injected.
2. User clicks a video thumbnail — YouTube SPA pushes a new history state to `youtube.com/watch?v=...`.
3. Service worker receives `webNavigation.onHistoryStateUpdated` and sends `YT_NAVIGATION` to the tab.
4. The tab has no content script to receive the message. The `.catch(() => {})` in service-worker.js silently swallows the error.
5. No filtering occurs.

The `yt-navigate-finish` fallback in the content script (line 299) is also unreachable in this scenario — there is no content script to have registered that event listener.

Both navigation-detection mechanisms (service worker relay + YouTube internal event) are already implemented correctly for the **tab-already-on-watch-page** case. Only the **homepage-first navigation** case is broken.

#### Expected Behavior

**Table Stakes** — Filtering should activate whenever the user arrives at a YouTube watch page, regardless of where they navigated from.

| Navigation Path | Expected Result | Current Behavior |
|-----------------|----------------|------------------|
| Direct to `youtube.com/watch?v=...` | Filtering activates on page load | Works (content script injected at document_idle) |
| `youtube.com/watch?v=A` → `youtube.com/watch?v=B` (in-page nav) | Filtering resets and reactivates for new video | Works (YT_NAVIGATION message + yt-navigate-finish fallback) |
| `youtube.com` (homepage) → click video → `youtube.com/watch?v=...` | Filtering activates after navigation | **Broken** (no content script in tab) |
| `youtube.com/results?...` (search) → click video | Filtering activates after navigation | **Broken** (no content script in tab) |
| Other site → click YouTube link → `youtube.com/watch?v=...` | Filtering activates on page load | Works (triggers full page load, content script injected) |

This is a known and well-documented problem in the YouTube extension ecosystem. Multiple extension review discussions cite "stops working when I navigate from the homepage" as a top complaint. The standard solution is one of:

1. **Expand manifest matches to `youtube.com/*`** — inject the content script on all YouTube pages, not just watch pages. The content script already guards against non-watch-page contexts (it reads the video ID and returns early if not found). This is the simplest change: one manifest edit.

2. **Dynamic injection via `chrome.scripting.executeScript`** — when the service worker detects a navigation to a watch page in a tab that doesn't have the content script running, inject it programmatically. Requires the `scripting` permission in the manifest. More precise but more complex.

**Recommendation for TFY v1.3:** Option 1 (expand manifest matches) is the correct fix. It requires:
- Change `"matches": ["https://www.youtube.com/watch*"]` to `"matches": ["https://www.youtube.com/*"]` in manifest.json.
- The content script's initial load IIFE (lines 248-256 in content-script.js) already exits gracefully if no video ID is found in the URL — no guard changes needed.
- The `yt-navigate-finish` fallback (line 299) will now also fire in the homepage → watch navigation case because the content script will be present.

**Caveat:** Expanding the match pattern means the content script runs on every YouTube page, including the homepage, search, etc. The content script does minimal work on non-watch pages (the IIFE exits early, styles are injected but have no effect without watch-page DOM). API quota is not affected (no `GET_VIDEO_CATEGORY` call fires without a video ID).

**Confidence:** HIGH — Content script match pattern limitation is a documented Chrome Extensions behavioral constraint. The fix is confirmed by multiple external references and direct code analysis.

**Complexity:** LOW — Single manifest.json edit. No logic changes to content script are required. The existing guard in the IIFE already handles non-watch pages correctly.

**Dependency on existing architecture:** Both SPA navigation handlers already exist and work correctly for the cases they currently cover. This fix extends coverage to the homepage-first case by ensuring the content script is present.

---

## Feature Landscape

### Table Stakes (Must Have or Product Feels Broken)

These are features users expect from *any* YouTube sidebar-modifying extension. Without them, the extension feels incomplete or buggy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Toggle on/off via popup** | Every competing extension has this (Unhook, DF Tube, RYS, Study Mode). Users need to disable the extension without uninstalling it. | Low | Simple popup with toggle state stored in `chrome.storage`. Every competitor does this. Non-negotiable. |
| **Sidebar suggestion filtering** | This IS the core product. If the sidebar isn't filtered, nothing works. | Medium | The actual DOM manipulation + API call to determine category. Core complexity of TFY. |
| **Current video category detection** | Without knowing the current video's category, you can't filter. This is the "input" to the entire system. | Medium | YouTube Data API v3 `videos.list` with `snippet.categoryId`. Requires extracting video ID from URL. |
| **Graceful handling of API failures** | API quota exhaustion, network errors, invalid keys. If the extension silently breaks, user thinks YouTube changed. | Low | Show a small indicator when filtering is inactive due to errors. Users of YouTube Blocker complain about this in reviews. |
| **Popup reflects current reality** | The popup must show what is actually happening right now — not stale state from a closed tab. Users trust the popup as a status indicator. If it lies, trust in the extension breaks. | Low | Requires tab close cleanup (Bug 1) and active-tab-scoped reads. Standard extension pattern. |
| **Persist settings across sessions** | Toggle state, API key should survive browser restart. Every extension does this. | Low | `chrome.storage.local` or `chrome.storage.sync`. |
| **Handle YouTube SPA navigation** | YouTube is a Single Page Application. Page navigations don't trigger full reloads. If extension only runs on page load, it breaks on every in-app navigation. | Medium | `MutationObserver` or `yt-navigate-finish` event. **Critical for correctness** — every competitor that fails here gets 1-star reviews. |
| **Filtering activates from homepage navigation** | Users commonly open YouTube, browse the homepage, then click a video. Filtering must activate in this flow. This is table stakes for a YouTube extension because it is the primary entry path to a watch page. | Low | Requires expanding manifest match pattern to cover all YouTube pages, not just watch pages. |

### Differentiators (Competitive Advantage)

These are features that set TFY apart from the crowded "hide everything" market.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Auto-infer category from current video** | No competitor does this. YouTube Focus Mode requires manual category selection. YouTube Blocker hardcodes categories. TFY automatically adapts to whatever you're watching. Zero configuration per session. | Medium | Already built. API call per video navigation. This is TFY's core differentiator. |
| **Collapse (not remove) off-topic suggestions** | Unhook, DF Tube, RYS all *remove* content entirely. TFY's "hidden: off-topic" label with category name preserves user agency. You see there ARE suggestions, you choose not to look. | Medium | Already built. |
| **Category label display in popup** | Show the detected category of the current video in the popup. Gives user confidence the extension understands what they're watching. | Low | Already built — shows "Watching: [Category]". The v1.3 fix makes this accurate instead of stale. |
| **Accurate popup state per active tab** | Popup reflects the category of the *currently active* YouTube tab, not whichever tab last wrote to storage. When switching tabs, the popup updates to match. | Low | Requires the v1.3 multi-tab fix. Differentiates from naive single-state storage implementations. |

### Anti-Features (Commonly Requested, Often Problematic)

Features to explicitly NOT build.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Manual category allowlist/blocklist UI** | YouTube Focus Mode and YouTube Blocker do this. | Defeats TFY's core value prop of *automatic* topic matching. If you're manually configuring categories, you're just another Focus Mode clone. | The auto-infer approach is the alternative. |
| **Keyword/regex content filtering** | BlockTube and Study Mode YouTube offer this. | Massive scope creep. Turns a focused sidebar filter into a general content blocker. | Keep category-based for POC. |
| **Homepage feed filtering** | Unhook, DF Tube, RYS all filter the homepage. | TFY's value is *on the video watch page*. Homepage has no "current video" to match against. | Out of scope. The homepage problem is better solved by Unhook. |
| **Tab-scoped storage key scheme** | Seems natural for multi-tab support — store `currentVideoCategory_[tabId]`. | Adds coordination complexity and storage pollution across tab lifetimes. Must clean up on every tab close. | Use message-based query from popup to content script instead — simpler and avoids storage coordination entirely. |
| **Polling the active tab for category state** | Ensures popup is always fresh. | Polling is expensive and unnecessary. Chrome's event model (tab activation events, message passing) is the right mechanism. Polling fights the platform. | React to events: `chrome.tabs.onActivated`, message from content script on navigation. |
| **Block/hide YouTube Shorts** | The #1 most common feature across all competitors. | Shorts are a separate UI surface. Supporting Shorts doubles DOM manipulation code for a feature unrelated to sidebar filtering. | Out of scope. Already implemented as a simple CSS rule (`ytd-reel-shelf-renderer { display: none }`). No logic extension needed. |
| **Cross-browser support** | Already out of scope in PROJECT.md. | Chrome-only is correct for personal-use developer mode. Adding Firefox means WebExtension polyfill, different manifest, testing matrix explosion. | Chrome only. Already decided. |

---

## Feature Dependencies

```
                    ┌──────────────────────┐
                    │  Chrome Extension     │
                    │  Manifest v3 Setup    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  API Key Storage      │
                    │  (chrome.storage)     │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼─────────────────────┐
    │ Video ID        │  │ Popup UI   │  │ SPA Navigation Detection    │
    │ Extraction      │  │ (toggle +  │  │ (webNavigation API +        │
    │ (from URL)      │  │  category) │  │  yt-navigate-finish)        │
    └─────────┬──────┘  └─────┬──────┘  └──────┬─────────────────────┘
              │               │                │
              │               │  requires      │ requires
              │               │  active-tab    │ content script present
              │               │  query         │ in tab (manifest match fix)
              │               │                │
    ┌─────────▼──────────────────────────────────▼──────────┐
    │              Current Video Category Detection          │
    │              (YouTube Data API v3 call)                │
    └─────────────────────────┬──────────────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  Sidebar Suggestion Scanning   │
              │  (DOM traversal + API calls    │
              │   for each suggestion's        │
              │   category)                    │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  Category Comparison &         │
              │  DOM Manipulation              │
              │  (collapse off-topic items)    │
              └───────────────────────────────┘
```

**v1.3 dependency additions:**

```
Tab Lifecycle Events (chrome.tabs.onRemoved)
    └──clears──> currentVideoCategory in storage
                     └──read by──> Popup category display

Popup open event
    └──queries active tab via chrome.tabs.query──> content script GET_CURRENT_CATEGORY message
                                                        └──responds with──> in-memory currentCategoryId
                                                        └──if no content script──> neutral "not on YouTube" state

Manifest match pattern (youtube.com/*)
    └──enables content script injection on all YouTube pages──>
              └──enables yt-navigate-finish listener to fire on homepage→watch navigation
              └──enables YT_NAVIGATION message to be received on homepage→watch navigation
```

**Dependency notes:**
- The multi-tab popup fix (query content script directly) requires the SPA navigation fix (expanded manifest match) to be fully correct. If the content script is not present in the tab (homepage case), the message send fails — this failure must be caught and treated as "neutral state." The expanded match pattern eliminates most of these cases, but the popup must still handle the failure gracefully.
- Tab close cleanup (chrome.tabs.onRemoved) is independent of the SPA navigation fix. It can be implemented separately.
- Both fixes are low-risk and do not change any existing filtering logic.

---

## MVP Definition

### Launch With (v1) — Already Built

- [x] Chrome Manifest v3 extension skeleton (background service worker, content script, popup)
- [x] Extract video ID from YouTube watch page URL
- [x] Detect current video's category via YouTube Data API v3
- [x] Store API key in extension storage (entered once, persisted)
- [x] Scan sidebar suggestion elements for their video IDs
- [x] Look up category for each sidebar suggestion video
- [x] Compare suggestion categories to current video category
- [x] Collapse off-topic suggestions with CSS (not remove from DOM)
- [x] "Hidden: [category] · [title]" label on collapsed items
- [x] Popup with on/off toggle
- [x] Shorts shelf suppression
- [x] README.md with full documentation

### Add After Validation (v1.x) — Already Built

- [x] Category label display in popup ("Watching: Science & Technology")
- [x] Rich collapsed labels with video title and category name

### v1.3 Bug Fixes (Active)

- [ ] **Tab close cleanup** — `chrome.tabs.onRemoved` in service worker clears `currentVideoCategory` from storage when the tab that set it closes. Popup then shows neutral state when no YouTube watch tab is active.
- [ ] **Multi-tab accuracy** — Popup queries active tab's content script directly for category (message-based, not storage-read). Falls back to neutral state if content script not present.
- [ ] **SPA navigation from homepage** — Manifest match pattern expanded to `youtube.com/*`. Content script present in tab from initial YouTube page load. `yt-navigate-finish` and `YT_NAVIGATION` message handlers fire correctly on homepage → watch navigation.

### Future Consideration (v2+)

- [ ] Batch API calls (already partially done — `unknownIds.slice(0, 50)` in content-script.js, but caching is session-only)
- [ ] Persistent category cache across sessions (video categories don't change — cache video_id→category_id in `chrome.storage.local`)
- [ ] Allowlist specific channels (always show regardless of category)
- [ ] Related category grouping (Science & Technology + Education both qualify when watching a lecture)
- [ ] Tag-based matching (finer-grained than category if categories prove too broad)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Risk | Priority |
|---------|------------|---------------------|------|----------|
| Toggle on/off (popup) | HIGH | LOW | LOW | **P0 — Shipped** |
| Current video category detection | HIGH | MEDIUM | MEDIUM (API quota) | **P0 — Shipped** |
| Sidebar filtering by category | HIGH | MEDIUM | HIGH (DOM fragility) | **P0 — Shipped** |
| SPA navigation (watch→watch) | HIGH | MEDIUM | MEDIUM | **P0 — Shipped** |
| Collapse with "hidden: off-topic" label | HIGH | LOW | LOW | **P0 — Shipped** |
| API key storage | HIGH | LOW | LOW | **P0 — Shipped** |
| **Tab close cleanup (Bug 1)** | HIGH | LOW | LOW | **P0 — v1.3 fix** |
| **Multi-tab popup accuracy (Bug 1)** | HIGH | LOW | LOW | **P0 — v1.3 fix** |
| **SPA from homepage (Bug 2)** | HIGH | LOW | LOW | **P0 — v1.3 fix** |
| Category label in popup | MEDIUM | LOW | LOW | **P1 — Shipped** |
| Batch API calls | MEDIUM | MEDIUM | LOW | **P1 — Critical for quota** |
| Persistent category cache | MEDIUM | LOW | LOW | **P2 — After validation** |
| Channel allowlist | LOW | MEDIUM | LOW | **P2 — If needed** |
| Related category grouping | MEDIUM | LOW | LOW | **P2 — If category too strict** |

---

## Competitor Feature Analysis

### Tier 1: Market Leaders (Nuclear Approach)

#### Unhook (1,000,000 users, 4.9 stars)
- **Approach:** Toggle individual UI sections on/off (sidebar, homepage, comments, Shorts, etc.)
- **Strengths:** Comprehensive coverage, excellent UX, granular toggles, tiny size (39KB)
- **What it lacks:** No content-awareness. It's all-or-nothing per section.
- **TFY positioning:** Unhook hides the entire sidebar. TFY *filters* it. Fundamentally different value prop.
- **Source:** https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid (Confidence: HIGH)

#### DF Tube (100,000 users, 4.7 stars)
- **Approach:** Same as Unhook — toggle sections. Last updated Nov 2019.
- **Strengths:** Simple, focused, educational positioning.
- **What it lacks:** Stale — not updated in 6+ years. Same all-or-nothing limitation.
- **Source:** https://chromewebstore.google.com/detail/df-tube-distraction-free/mjdepdfccjgcndkmemponafgioodelna (Confidence: HIGH)

#### RYS — Remove YouTube Suggestions (20,000 users, 4.8 stars)
- **Approach:** 80+ granular toggles across every YouTube UI element.
- **Relevant feature:** "Show reveal box for sidebar suggestions" — similar concept to TFY's collapse-with-label, but applied to all suggestions, not filtered by relevance.
- **Source:** https://lawrencehook.com/rys/features/ (Confidence: HIGH)

### Tier 2: Content-Level Blocking

#### BlockTube (100,000 users, 3.9 stars)
- **Approach:** Block by channel, keyword, regex. Requires manual configuration.
- **What it lacks:** No automatic topic awareness.
- **Source:** https://chromewebstore.google.com/detail/blocktube/bbeaicapbccfllodepmimpkgecanonai (Confidence: HIGH)

### Tier 3: Category-Aware (Direct Competitors)

#### YouTube Focus Mode (1,000 users, 3.8 stars)
- **Approach:** User manually selects allowed YouTube categories in popup.
- **Critical difference from TFY:** User picks categories manually. TFY infers from current video. Zero configuration is TFY's core advantage.
- **Source:** https://chromewebstore.google.com/detail/youtube-focus-mode/jedeklblgiihonnldgldeagmbkhlblek (Confidence: HIGH)

#### YouTube Blocker (10,000 users, 4.5 stars)
- **Approach:** Hardcodes allowed categories to Education, Science & Technology, and Howto & Style.
- **Critical difference from TFY:** YouTube Blocker has a fixed definition of "good." TFY's definition is dynamic — whatever topic you're currently exploring.
- **Source:** https://chromewebstore.google.com/detail/youtube-blocker/oohcfepaadomnocmmkejhnfhcddpdpab (Confidence: HIGH)

### Competitive Gap Summary

| Capability | Unhook | DF Tube | RYS | BlockTube | YT Focus Mode | YT Blocker | **TFY** |
|-----------|--------|---------|-----|-----------|---------------|------------|---------|
| Hide entire sidebar | Yes | Yes | Yes | No | No | No | No |
| Filter sidebar by relevance | No | No | No | No | Yes (manual) | Yes (hardcoded) | **Yes (auto)** |
| Auto-detect current topic | No | No | No | No | No | No | **Yes** |
| Zero-config per session | Yes* | Yes* | Yes* | No | No | Yes | **Yes** |
| Collapse vs remove | No | No | Reveal box | No | No | No | **Yes** |
| Accurate popup state (multi-tab) | N/A | N/A | N/A | N/A | N/A | N/A | **After v1.3** |
| Works on homepage→watch nav | N/A | N/A | N/A | N/A | N/A | N/A | **After v1.3** |

*Zero-config because they hide everything — no topic detection needed.

---

## Key Takeaways for Roadmap

1. **The core concept is genuinely differentiated.** Don't dilute it by adding Unhook-style section hiding. The value is in smart filtering, not bulk removal.

2. **API quota is the #1 technical risk.** Fetching categories for 10-20 sidebar suggestions per page navigation could burn through the 10,000 unit/day default quota fast. Caching is essential for sustained use.

3. **YouTube DOM fragility is the #1 maintenance risk.** DF Tube died because YouTube changed its DOM. DOM selectors must be isolated and easy to update.

4. **v1.3 bugs are both low-complexity, high-correctness-impact.** Both fixes require minimal code changes (one manifest line, one service worker listener, one popup query change) but eliminate the two most visible behavioral failures. They should ship together as they share the context of "extension is unreliable when navigating YouTube naturally."

5. **The manifest match pattern fix (Bug 2) is a prerequisite for the popup accuracy fix (Bug 1) to be fully meaningful.** Once the content script is present on all YouTube pages, the popup can reliably query it for current state. Without the manifest fix, the popup query still fails on homepage-loaded tabs.

## Sources

- Chrome Extensions API — chrome.tabs.onRemoved: https://developer.chrome.com/docs/extensions/reference/api/tabs (Confidence: HIGH)
- Chrome Extensions API — webNavigation.onHistoryStateUpdated: https://developer.chrome.com/docs/extensions/reference/api/webNavigation (Confidence: HIGH)
- Content script match pattern limitation (SPA problem): https://wxt.dev/guide/essentials/content-scripts.html (Confidence: MEDIUM)
- Chrome extensions SPA support pattern: https://medium.com/@softvar/making-chrome-extension-smart-by-supporting-spa-websites-1f76593637e8 (Confidence: MEDIUM)
- Unhook Chrome Web Store: https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid (Confidence: HIGH)
- DF Tube Chrome Web Store: https://chromewebstore.google.com/detail/df-tube-distraction-free/mjdepdfccjgcndkmemponafgioodelna (Confidence: HIGH)
- RYS Features page: https://lawrencehook.com/rys/features/ (Confidence: HIGH)
- BlockTube Chrome Web Store: https://chromewebstore.google.com/detail/blocktube/bbeaicapbccfllodepmimpkgecanonai (Confidence: HIGH)
- YouTube Focus Mode Chrome Web Store: https://chromewebstore.google.com/detail/youtube-focus-mode/jedeklblgiihonnldgldeagmbkhlblek (Confidence: HIGH)
- YouTube Blocker Chrome Web Store: https://chromewebstore.google.com/detail/youtube-blocker/oohcfepaadomnocmmkejhnfhcddpdpab (Confidence: HIGH)

---
*Feature research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-20 (v1.0–v1.2 features), updated 2026-02-26 (v1.3 bug fixes)*
