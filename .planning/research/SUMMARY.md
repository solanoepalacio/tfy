# Project Research Summary

**Project:** TFY2 — Topic Focused YouTube
**Domain:** Chrome Extension (YouTube sidebar filter)
**Researched:** 2026-02-20
**Confidence:** HIGH

## Executive Summary

TFY2 is a Chrome Manifest V3 extension that filters YouTube's sidebar suggestions by comparing each suggestion's category to the currently-playing video's category, collapsing off-topic items rather than removing them. This is a genuinely novel approach in a crowded space — existing extensions either nuke the entire sidebar (Unhook, DF Tube) or require manual category selection (YouTube Focus Mode). TFY2's "auto-infer from current video" mechanic is its core differentiator and the reason it needs only 4-7 files with zero npm dependencies. The recommended stack is pure Vanilla JS on Manifest V3, communicating with the YouTube Data API v3 via a service worker, with `chrome.storage` for persistence. No build step, no framework, no bundler.

The architecture follows a clean three-component model: a content script that observes YouTube's DOM and applies filtering, a service worker that proxies YouTube API calls and manages caching, and a popup for on/off toggling. The critical architectural patterns are MutationObserver-based sidebar observation (YouTube loads suggestions lazily), message-passing between content script and service worker (content scripts can't make cross-origin API calls), and stateless service worker design (MV3 terminates workers after 30s of inactivity). All patterns are well-documented in official Chrome extension docs.

The two highest risks are **YouTube DOM fragility** (YouTube updates its frontend every 1-4 weeks with no stable API for extensions) and **API quota exhaustion** (10,000 units/day default, easily burned through without batching and caching). Both are fully mitigable: centralize DOM selectors for easy updates, and batch up to 50 video IDs per API call (1 quota unit) with aggressive caching since video categories never change. The third risk — YouTube SPA navigation silently breaking the content script — is the #1 cause of 1-star reviews across competitors and must be handled correctly from the first commit.

## Key Findings

### Recommended Stack

Pure Vanilla JavaScript on Chrome Manifest V3 with zero runtime dependencies. The extension has ~7 files total — adding React, TypeScript, or a bundler would add build complexity for no benefit at this scope.

**Core technologies:**
- **Chrome Manifest V3:** Required platform — MV2 is deprecated and actively being removed
- **Vanilla JavaScript (ES2022+):** No framework needed for 4 JS files; Chrome's content script environment supports modern JS natively
- **YouTube Data API v3:** `videos.list` (1 quota unit, batch up to 50 IDs) for category lookups; `videoCategories.list` (1 unit) for human-readable names; API key auth only — no OAuth needed
- **Chrome Storage API:** `chrome.storage.local` for API key + toggle persistence; `chrome.storage.session` for ephemeral category cache
- **Chrome Messaging API:** `chrome.runtime.sendMessage` for content script ↔ service worker communication (content scripts can't make cross-origin fetches)

**What NOT to use:** React/Vue/Svelte (overkill), jQuery (dead weight), Webpack (unnecessary for 4 files), `gapi` client library (banned in MV3 — loads remote code), OAuth (not needed for public endpoints), `search.list` endpoint (100 units/call vs 1 unit for `videos.list`).

### Expected Features

The competitive landscape has three tiers: nuclear section-hiders (Unhook: 1M users), content-level blockers (BlockTube: 100K users), and category-aware filters (YouTube Focus Mode: 1K users). TFY2 occupies the least crowded tier with a genuinely unique auto-inference mechanic.

**Must have (table stakes):**
- Toggle on/off via popup — every competitor has this
- Sidebar suggestion filtering by category — this IS the product
- Current video category detection via YouTube API
- YouTube SPA navigation handling — #1 cause of competitor 1-star reviews
- Collapse (not remove) off-topic suggestions with "hidden: off-topic" label
- Graceful API error handling — extension must never break YouTube
- API key persistence in `chrome.storage.local`
- Extension icon badge showing active/inactive state

**Should have (differentiators, post-v1 validation):**
- Category label display in popup ("Current: Science & Technology")
- Hidden/shown count ("Showing 4 of 12")
- Batch API calls (up to 50 IDs per request) — critical for quota
- Category cache in `chrome.storage.local` — video categories never change

**Defer (v2+):**
- Channel allowlist (always show subscribed channels)
- Tag-based matching (if categories too coarse)
- Related category grouping ("Science & Tech" ≈ "Education")
- Homepage/Shorts/comments filtering — different products entirely

### Architecture Approach

Three-component architecture with `chrome.storage` as the shared state bus. The content script handles all DOM interaction (video ID extraction, sidebar observation via MutationObserver, collapse/expand UI). The service worker handles all YouTube API communication (receives batched video IDs, checks cache, calls API, returns category map). The popup reads/writes toggle state to `chrome.storage.local`, which the content script reacts to via `chrome.storage.onChanged`. No direct popup↔content script communication needed.

**Major components:**
1. **Content Script** (`content.js` + `content.css`) — DOM observation, video ID extraction, sidebar filtering, collapse UI
2. **Service Worker** (`background.js`) — YouTube API gateway, category caching, message handling; must be stateless (no global variables)
3. **Popup** (`popup.html/js/css`) — User toggle, API key input; communicates via `chrome.storage` only
4. **chrome.storage** — Shared state: `.local` for persistent config (API key, toggle), `.session` for ephemeral cache (video→category map)

**Key patterns:**
- Message-passing bridge for cross-origin API calls
- MutationObserver for lazy-loaded sidebar elements
- `yt-navigate-finish` event for SPA navigation detection
- `chrome.storage.onChanged` for cross-component reactivity (popup toggle → content script)
- Stateless service worker (read state from storage on every message)

### Critical Pitfalls

1. **YouTube SPA navigation breaks content script** — YouTube uses `history.pushState`, not full page reloads. Content script initialization only runs once. Must listen for `yt-navigate-finish` events and re-run the entire filtering pipeline on each navigation. _Phase 1 — architectural foundation._

2. **Sidebar loads asynchronously and incrementally** — `querySelectorAll` at any single point misses future elements. Must use `MutationObserver` on the sidebar container with debounced processing. Handle both initial batch and scroll-triggered lazy loads. _Phase 1 — core observation mechanism._

3. **MV3 service worker terminates and loses state** — All global variables vanish after 30s idle. Store everything in `chrome.storage` (`.local` for persistent, `.session` for cache). Design every message handler to read state from storage, not globals. _Phase 1 — architectural constraint._

4. **API quota exhaustion from naive calling** — 20 sidebar suggestions × individual API calls = 20 units/page view. Batch up to 50 IDs in one call (1 unit). Cache aggressively — video categories never change. Without this, quota exhausts in a few hundred page views. _Phase 2 — must be built into API layer from the start._

5. **YouTube DOM selector fragility** — YouTube updates its frontend every 1-4 weeks. Custom element tag names (`ytd-compact-video-renderer`) are more stable than classes/IDs but have no stability guarantee. Centralize all selectors in one location. Design for graceful degradation (show unfiltered rather than crash). _Phase 1 — selector strategy must be centralized from day 1._

## Implications for Roadmap

Based on research, the extension has a clear dependency chain that dictates build order. The architecture research explicitly identifies 6 phases, which I've consolidated into 4 phases based on natural groupings and the dependency graph.

### Phase 1: Extension Scaffold + Core Infrastructure
**Rationale:** Everything depends on the manifest, service worker lifecycle, and content script injection model. The three critical Phase 1 pitfalls (SPA navigation, lazy sidebar loading, service worker state loss) must be solved architecturally before any feature code.
**Delivers:** Working extension skeleton that loads on YouTube, detects SPA navigations, observes sidebar DOM changes, and has a functioning content script ↔ service worker message bridge. No actual filtering yet — just the plumbing.
**Addresses:** Manifest setup, SPA navigation detection, MutationObserver infrastructure, message-passing protocol, chrome.storage schema
**Avoids:** Pitfalls 1 (SPA nav), 2 (lazy sidebar), 3 (service worker state), 5 (selector fragility), 6 (existing tabs), 7 (video ID extraction), 8 (observer scope)

### Phase 2: YouTube API Integration + Category Detection
**Rationale:** With the scaffold proven, wire up the actual YouTube Data API calls. This is where the core value proposition comes alive — detecting the current video's category and looking up sidebar suggestion categories. Batching and caching must be built in from the start (not retrofitted).
**Delivers:** Service worker that accepts video IDs, calls YouTube API with batching (up to 50 IDs), caches results in `chrome.storage.session`, and returns a category map. Content script sends extracted video IDs and receives category data.
**Addresses:** Current video category detection, sidebar video category lookup, API key storage, batch API calls, category caching
**Avoids:** Pitfalls 4 (quota exhaustion), 9 (message race conditions), 10 (API key exposure), 11 (forgetting current video lookup)

### Phase 3: Sidebar Filtering + Collapse UI
**Rationale:** With category data flowing, implement the actual filtering logic and visual treatment. This is the user-visible feature — comparing categories and collapsing off-topic items. Depends entirely on Phases 1-2 being solid.
**Delivers:** Off-topic sidebar suggestions are collapsed with "hidden: off-topic" labels. Click-to-expand handlers. CSS styling for collapsed state. Visual feedback that filtering is active.
**Addresses:** Category comparison logic, DOM manipulation (collapse/expand), "hidden: off-topic" labels, content.css styling, icon badge for active state
**Avoids:** UX pitfalls (FOUC, aggressive hiding, no visual feedback)

### Phase 4: Popup + Polish
**Rationale:** The popup is relatively independent — it only reads/writes `chrome.storage`. Build it last so the core filtering experience is proven before investing in UI chrome. This phase also handles edge cases and quality-of-life improvements.
**Delivers:** Popup with on/off toggle + API key input. Toggle immediately enables/disables filtering. Error state display. Category label and hidden count (post-v1 enhancements).
**Addresses:** Toggle on/off, API key entry UI, error state handling, graceful degradation, persist settings across sessions
**Avoids:** None critical — this is the lowest-risk phase

### Phase Ordering Rationale

- **Scaffold → API → Filtering → UI** follows the dependency chain: you can't filter without category data, you can't get category data without the API bridge, you can't build the API bridge without the message-passing infrastructure
- Phase 1 addresses **7 of 11 identified pitfalls** — it's the highest-risk phase and must be thorough
- The popup (Phase 4) has zero dependencies on the content script or service worker beyond `chrome.storage` — it could technically be built in parallel with Phases 2-3, but it's lowest priority since the developer can toggle via DevTools during development
- API integration (Phase 2) is isolated before filtering (Phase 3) so the API layer can be tested independently via DevTools console before wiring it into DOM manipulation

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 1 (Scaffold):** YouTube DOM structure exploration needed. The exact selectors for `ytd-compact-video-renderer`, sidebar container, and video ID extraction require hands-on DevTools inspection of the live YouTube page. Community knowledge suggests `.data` property on Polymer elements, but this needs verification. _Confidence: MEDIUM on YouTube DOM specifics._
- **Phase 3 (Filtering UI):** CSS collapse strategy needs testing. The exact CSS approach (`visibility:hidden` + `height:0` vs `display:none` vs wrapper element) affects both performance and YouTube's own scripts. Need to verify YouTube doesn't error when expected elements are visually hidden.

**Phases with standard patterns (skip deep research):**
- **Phase 2 (API Integration):** YouTube Data API v3 is extremely well-documented. Endpoint shapes, quota costs, batching behavior, and field filtering are all verified from official docs. _Confidence: HIGH._
- **Phase 4 (Popup):** Standard Chrome extension popup pattern. Toggle + storage is the most documented pattern in Chrome extension development. _Confidence: HIGH._

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official Chrome & YouTube API docs (2025-2026 updates). Zero ambiguity on MV3, storage APIs, messaging patterns. |
| Features | HIGH | Analyzed 10+ competing extensions with user counts and ratings. Competitive gap analysis based on actual Chrome Web Store listings. TFY2's auto-infer differentiator confirmed as novel. |
| Architecture | HIGH | All patterns sourced from official Chrome extension documentation. Message-passing, service worker lifecycle, content script injection — all well-documented with code examples. |
| Pitfalls | HIGH (Chrome/API), MEDIUM (YouTube DOM) | Chrome extension pitfalls are well-documented. YouTube DOM specifics (element names, `.data` properties, custom events) are community-observed patterns with no official stability guarantee. |

**Overall confidence:** HIGH — The extension platform (Chrome MV3) and API (YouTube Data v3) are both mature, well-documented technologies. The main uncertainty is YouTube's DOM structure, which is inherently unstable and requires ongoing maintenance.

### Gaps to Address

- **YouTube sidebar DOM structure:** Exact selectors and video ID extraction strategy need hands-on verification via DevTools. The `.data` property pattern on `ytd-compact-video-renderer` is community knowledge, not officially documented. _Resolve during Phase 1 implementation with live DOM inspection._
- **YouTube category granularity:** YouTube has ~32 video categories. It's unknown whether category-level matching will be precise enough for a good UX (e.g., "Entertainment" is very broad). _Resolve during Phase 3 testing. If too coarse, the "related category grouping" v2 feature becomes more urgent._
- **`yt-navigate-finish` event reliability:** This custom event is not officially documented by YouTube. It's been stable for years in the extension community but could be removed. _Implement with MutationObserver URL-polling fallback from day 1._
- **Flash of unfiltered content (FOUC):** Users may briefly see unfiltered sidebar before API response arrives. The CSS-first approach (hide-then-reveal) needs testing to ensure it doesn't cause perceived jank. _Resolve during Phase 3 with CSS injection via manifest._

## Sources

### Primary (HIGH confidence)
- Chrome Extension MV3 docs — migration, service workers, content scripts, messaging, storage (developer.chrome.com, updated 2025-12)
- YouTube Data API v3 — videos.list, videoCategories.list, quota costs, batching (developers.google.com, updated 2026-02-12)
- MDN MutationObserver — API reference and usage patterns (developer.mozilla.org)
- Chrome Web Store listings — Unhook (1M users), BlockTube (100K), DF Tube (100K), RYS (20K), YouTube Blocker (10K), YouTube Focus Mode (1K), Study Mode YouTube (1K)
- npm registry — chrome-types package v0.1.416 (verified 2026-02-20)

### Secondary (MEDIUM confidence)
- YouTube custom element tag names (`ytd-compact-video-renderer`, `ytd-watch-next-secondary-results-renderer`) — community-inspected, stable in practice, no official guarantee
- YouTube SPA navigation events (`yt-navigate-finish`) — widely used in extension community, not officially documented
- YouTube Polymer element `.data` property — community knowledge for extracting video metadata from custom elements

### Tertiary (LOW confidence)
- YouTube DOM update frequency ("every 1-4 weeks") — anecdotal from extension developer forums; actual frequency varies

---
*Research completed: 2026-02-20*
*Ready for roadmap: yes*
