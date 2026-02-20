# Feature Research

**Domain:** Chrome Extension (YouTube sidebar filter)
**Researched:** 2026-02-20
**Confidence:** HIGH

## How This Research Was Conducted

Analyzed 10+ YouTube distraction/focus extensions from the Chrome Web Store, including market leaders (Unhook: 1M users, 4.9 stars; DF Tube: 100K users; BlockTube: 100K users) and niche competitors closest to TFY2's concept (YouTube Focus Mode: 1K users, category-based blocking; YouTube Blocker: 10K users, educational category filtering; Study Mode YouTube: 1K users). Also analyzed RYS (Remove YouTube Suggestions: 20K users, 80+ features) and UnDistracted (70K users, multi-platform).

## The Competitive Landscape at a Glance

The YouTube focus/distraction space breaks into three tiers:

1. **Nuclear option** (Unhook, DF Tube, RYS, Focused YouTube): Hide/remove entire UI sections wholesale. Sidebar gone. Homepage gone. Comments gone. Binary on/off per section. This is where 95% of extensions live.

2. **Content-level blocking** (BlockTube, Study Mode YouTube): Block specific channels, keywords, or regex patterns. More surgical, but requires manual configuration.

3. **Category-aware filtering** (YouTube Focus Mode, YouTube Blocker): Use YouTube categories to decide what to show/hide. **This is where TFY2 lives**, and it's the least crowded tier with only ~2 competitors, both small and stale.

**Key insight:** No extension currently does what TFY2 proposes — *automatically* matching sidebar suggestions to the *currently playing* video's category. YouTube Focus Mode lets you manually select allowed categories. YouTube Blocker hardcodes educational categories. TFY2's "infer from current video" approach is genuinely novel in this space.

---

## Feature Landscape

### Table Stakes (Must Have or Product Feels Broken)

These are features users expect from *any* YouTube sidebar-modifying extension. Without them, the extension feels incomplete or buggy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Toggle on/off via popup** | Every competing extension has this (Unhook, DF Tube, RYS, Study Mode). Users need to disable the extension without uninstalling it. | Low | Simple popup with toggle state stored in `chrome.storage`. Every competitor does this. Non-negotiable. |
| **Sidebar suggestion filtering** | This IS the core product. If the sidebar isn't filtered, nothing works. | Medium | The actual DOM manipulation + API call to determine category. Core complexity of TFY2. |
| **Current video category detection** | Without knowing the current video's category, you can't filter. This is the "input" to the entire system. | Medium | YouTube Data API v3 `videos.list` with `snippet.categoryId`. Requires extracting video ID from URL. |
| **Graceful handling of API failures** | API quota exhaustion, network errors, invalid keys. If the extension silently breaks, user thinks YouTube changed. | Low | Show a small indicator when filtering is inactive due to errors. Users of YouTube Blocker complain about this in reviews. |
| **Visual indication of filtering state** | User needs to know: is filtering active? Extension icon badge or popup state. Without this, user can't tell if extension is working. | Low | Badge text/color on extension icon. Standard Chrome extension pattern. |
| **Persist settings across sessions** | Toggle state, API key should survive browser restart. Every extension does this. | Low | `chrome.storage.local` or `chrome.storage.sync`. |
| **Handle YouTube SPA navigation** | YouTube is a Single Page Application. Page navigations don't trigger full reloads. If extension only runs on page load, it breaks on every in-app navigation. | Medium | `MutationObserver` or `yt-navigate-finish` event. **Critical for correctness** — every competitor that fails here gets 1-star reviews. |

### Differentiators (What Makes TFY2 Unique)

These are features that set TFY2 apart from the crowded "hide everything" market. The first two are already in the PROJECT.md scope.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Auto-infer category from current video** | No competitor does this. YouTube Focus Mode requires manual category selection. YouTube Blocker hardcodes categories. TFY2 automatically adapts to whatever you're watching. Zero configuration per session. | Medium | Already in scope. API call per video navigation. This is TFY2's core differentiator. |
| **Collapse (not remove) off-topic suggestions** | Unhook, DF Tube, RYS all *remove* content entirely. TFY2's "hidden: off-topic" label with expand preserves user agency. You see there ARE suggestions, you choose not to look. | Medium | Already in scope. Requires CSS collapse + click handler to expand. More respectful than hard removal. |
| **Category label display** | Show the detected category of the current video somewhere visible (popup or page). Gives user confidence the extension understands what they're watching. | Low | Small addition to popup or injected UI. Builds trust in the filtering logic. |
| **Count of hidden vs shown suggestions** | "Showing 4 of 12 suggestions (8 off-topic)" — gives immediate feedback that filtering is working. | Low | Simple counter in popup or badge. Unhook doesn't do this because it removes everything wholesale. |
| **Allowlist specific channels** | "Always show suggestions from channels I'm subscribed to, regardless of category." Handles the edge case where a trusted channel posts across categories. | Medium | Requires reading channel info from sidebar suggestion DOM elements. Nice post-v1 feature. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that competitors build but that TFY2 should deliberately NOT build, either because they conflict with the core concept or because they introduce disproportionate complexity.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Manual category allowlist/blocklist UI** | YouTube Focus Mode and YouTube Blocker do this. Users want control over which categories are "good." | Defeats TFY2's core value prop of *automatic* topic matching. If you're manually configuring categories, you're just another Focus Mode clone. The whole point is zero-config per session. | The auto-infer approach is the alternative. If POC reveals category matching is too coarse, refine the matching algorithm, don't add manual config. |
| **Keyword/regex content filtering** | BlockTube and Study Mode YouTube offer this. Power users want to block by title keywords. | Massive scope creep. Turns a focused sidebar filter into a general content blocker. BlockTube is 197KB for this reason. Keyword matching is a different product. | Keep category-based for POC. If category is insufficient, explore tag-based or description-based matching in v2, not user-configurable regex. |
| **Homepage feed filtering** | Unhook, DF Tube, RYS all filter the homepage. Users expect it. | TFY2's value is *on the video watch page* — filtering sidebar while watching. Homepage is a different context (no "current video" to match against). Adding homepage filtering means inventing a different matching strategy. | Out of scope. The homepage problem is better solved by Unhook (just hide it). TFY2 solves the *watching* problem. |
| **Block/hide YouTube Shorts** | The #1 most common feature across all competitors (Unhook, RYS, Clean YouTube, dedicated Shorts-blocking extensions). | Shorts are a separate UI surface with different DOM structure. Supporting Shorts doubles the DOM manipulation code for a feature unrelated to sidebar filtering. | Out of scope. Users who want Shorts blocking can layer Unhook on top of TFY2. |
| **Comments hiding** | Unhook, DF Tube, RYS, Study Mode all offer this. | Unrelated to topic-focused filtering. Comments are part of the *current* video's content, not distracting cross-topic suggestions. | Out of scope. Different problem. |
| **Disable autoplay** | DF Tube, RYS, Study Mode all offer this. | Built into YouTube's own UI. Chrome has autoplay settings. Reimplementing this adds no unique value and risks breaking when YouTube changes their autoplay API. | Tell user to use YouTube's native autoplay toggle. |
| **Time limits / scheduling** | RYS Premium, UnDistracted offer scheduled blocking. "Only filter during work hours." | Turns a content filter into a time management app. Different product category entirely. | Out of scope. Use a dedicated extension like StayFocusd for time limits. |
| **Cross-browser support** | Already out of scope in PROJECT.md. Firefox, Edge users ask for it. | Chrome-only is correct for personal-use developer mode. Adding Firefox means WebExtension polyfill, different manifest, testing matrix explosion. | Chrome only. Already decided correctly. |
| **Sync settings across devices** | UnDistracted, RYS Premium offer this. | For a single-user developer-mode extension, there's no second device to sync to. `chrome.storage.local` is sufficient. | Use `chrome.storage.local`, not `chrome.storage.sync`. |

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
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼─────────┐
    │ Video ID        │  │ Popup UI   │  │ SPA Navigation │
    │ Extraction      │  │ (toggle)   │  │ Detection      │
    │ (from URL)      │  │            │  │ (MutationObs)  │
    └─────────┬──────┘  └─────┬──────┘  └──────┬─────────┘
              │               │                │
              │               │                │
    ┌─────────▼──────────────────────────────────▼──────────┐
    │              Current Video Category Detection          │
    │              (YouTube Data API v3 call)                 │
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
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  "Hidden: off-topic" Labels    │
              │  + Expand/Collapse Handlers    │
              └───────────────────────────────┘
```

**Critical path:** Manifest setup → API key storage → Video ID extraction + SPA navigation → Category detection → Sidebar scanning → DOM manipulation → Collapse labels.

**Dependencies to note:**
- Sidebar suggestion scanning requires category lookup for *each* suggestion video. This means multiple API calls per page navigation, which directly impacts API quota.
- SPA navigation detection must trigger the *entire* pipeline (re-extract video ID → re-detect category → re-scan sidebar → re-filter).
- Popup toggle must be able to instantly restore collapsed items (not require page reload).

---

## MVP Definition

### Launch With (v1) — The POC

These directly map to the Active requirements in PROJECT.md.

- [x] Chrome Manifest v3 extension skeleton (background service worker, content script, popup)
- [x] Extract video ID from YouTube watch page URL
- [x] Detect current video's category via YouTube Data API v3
- [x] Store API key in extension storage (entered once, persisted)
- [x] Detect YouTube SPA navigations (re-trigger filtering on navigation)
- [x] Scan sidebar suggestion elements for their video IDs
- [x] Look up category for each sidebar suggestion video
- [x] Compare suggestion categories to current video category
- [x] Collapse off-topic suggestions with CSS (not remove from DOM)
- [x] Inject "hidden: off-topic" label on collapsed items, clickable to expand
- [x] Popup with on/off toggle
- [x] Extension icon badge indicating active/inactive state
- [x] Graceful error handling (API failures don't break YouTube)

### Add After Validation (v1.x) — If POC Works

These improve the experience once the core concept is validated.

- [ ] Category label display in popup ("Current: Science & Technology")
- [ ] Hidden/shown count ("Showing 4 of 12")
- [ ] Batch API calls to reduce quota usage (collect all suggestion video IDs, single `videos.list` call with comma-separated IDs — YouTube API supports up to 50 per call)
- [ ] Cache category lookups (video categories don't change — cache video_id→category_id in `chrome.storage.local` to avoid repeat API calls)
- [ ] Handle edge case: sidebar loads lazily / infinite scroll adds more suggestions after initial scan

### Future Consideration (v2+) — Only If Category Matching Proves Insufficient

- [ ] Allowlist subscribed channels (always show regardless of category)
- [ ] Tag-based matching (use video tags for finer-grained topic similarity when categories are too broad)
- [ ] "Related category" grouping (e.g., "Science & Technology" and "Education" are close enough to both show)
- [ ] Configurable strictness level (strict = exact category match only, loose = related categories allowed)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Risk | Priority |
|---------|------------|---------------------|------|----------|
| Toggle on/off (popup) | HIGH | LOW | LOW | **P0 — Must ship** |
| Current video category detection | HIGH | MEDIUM | MEDIUM (API quota) | **P0 — Must ship** |
| Sidebar filtering by category | HIGH | MEDIUM | HIGH (DOM fragility) | **P0 — Must ship** |
| SPA navigation handling | HIGH | MEDIUM | MEDIUM | **P0 — Must ship** |
| Collapse with "hidden: off-topic" label | HIGH | LOW | LOW | **P0 — Must ship** |
| API key storage | HIGH | LOW | LOW | **P0 — Must ship** |
| Error state handling | MEDIUM | LOW | LOW | **P0 — Must ship** |
| Extension icon badge | MEDIUM | LOW | LOW | **P0 — Must ship** |
| Category label in popup | MEDIUM | LOW | LOW | **P1 — Soon after** |
| Hidden/shown count | LOW | LOW | LOW | **P1 — Soon after** |
| Batch API calls | MEDIUM | MEDIUM | LOW | **P1 — Critical for quota** |
| Category cache | MEDIUM | LOW | LOW | **P1 — Critical for quota** |
| Lazy sidebar re-scan | MEDIUM | MEDIUM | MEDIUM | **P1 — After core works** |
| Channel allowlist | LOW | MEDIUM | LOW | **P2 — If needed** |
| Related category grouping | MEDIUM | LOW | LOW | **P2 — If category too strict** |
| Tag-based matching | MEDIUM | HIGH | HIGH (API quota x2) | **P2 — Only if categories fail** |

---

## Competitor Feature Analysis

### Tier 1: Market Leaders (Nuclear Approach)

#### Unhook (1,000,000 users, 4.9 stars)
- **Approach:** Toggle individual UI sections on/off (sidebar, homepage, comments, Shorts, etc.)
- **Strengths:** Comprehensive coverage, excellent UX, granular toggles, tiny size (39KB)
- **What it lacks:** No content-awareness. It's all-or-nothing per section. Can't say "show me related sidebar suggestions but hide unrelated ones."
- **TFY2 positioning:** Unhook hides the entire sidebar. TFY2 *filters* it. Fundamentally different value prop.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid), confidence: HIGH

#### DF Tube (100,000 users, 4.7 stars)
- **Approach:** Same as Unhook — toggle sections. Last updated Nov 2019.
- **Strengths:** Simple, focused, educational positioning.
- **What it lacks:** Stale — not updated in 6+ years. Same all-or-nothing limitation.
- **TFY2 positioning:** DF Tube is effectively abandoned. Demonstrates the risk of YouTube layout changes breaking CSS-based approaches.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/df-tube-distraction-free/mjdepdfccjgcndkmemponafgioodelna), confidence: HIGH

#### RYS — Remove YouTube Suggestions (20,000 users, 4.8 stars)
- **Approach:** 80+ granular toggles across every YouTube UI element. Premium tier for advanced features.
- **Strengths:** Most comprehensive option. Scheduling, password locks, reveal boxes, grayscale mode.
- **What it lacks:** Overwhelming UI. No content-awareness. Still section-based, just very granular sections.
- **Relevant feature:** "Show reveal box for sidebar suggestions" — similar concept to TFY2's collapse-with-label, but still hides everything, doesn't filter by relevance.
- **TFY2 positioning:** RYS is for power users who want to customize every pixel. TFY2 is for users who want automatic topic filtering with zero config.
- **Source:** [Features page](https://lawrencehook.com/rys/features/), confidence: HIGH

### Tier 2: Content-Level Blocking

#### BlockTube (100,000 users, 3.9 stars)
- **Approach:** Block specific channels and videos by name, keyword, regex. Block by video duration. Advanced JavaScript function blocking.
- **Strengths:** Powerful for users who know exactly what they want to block. Regex support. Hide watched videos.
- **What it lacks:** Requires manual configuration. No automatic topic awareness. Lower rating (3.9) suggests complexity issues.
- **TFY2 positioning:** BlockTube requires you to know *in advance* what to block. TFY2 automatically decides based on what you're currently watching.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/blocktube/bbeaicapbccfllodepmimpkgecanonai), confidence: HIGH

#### Study Mode: YouTube (1,000 users, 4.7 stars)
- **Approach:** Section hiding + custom word filters for videos and channels.
- **Strengths:** Clean educational positioning. Small and focused.
- **What it lacks:** Word filters are manual. No category awareness. Standard section-hiding approach.
- **TFY2 positioning:** Study Mode is a lighter Unhook with keyword filters. Different approach entirely.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/study-mode-youtube/hhjnoabnlicjpahfibejifhankpfahnd), confidence: HIGH

### Tier 3: Category-Aware (Direct Competitors)

#### YouTube Focus Mode (1,000 users, 3.8 stars)
- **Approach:** User manually selects allowed YouTube categories in popup. Videos not in selected categories are hidden across homepage, search, and sidebar.
- **Strengths:** Category-based filtering (closest to TFY2). Works on homepage + search + sidebar.
- **What it lacks:** Requires manual category selection (user must know/choose categories upfront). Last updated March 2021. Only 1,000 users. 3.8 star rating suggests issues.
- **Critical difference from TFY2:** User picks categories manually. TFY2 infers from current video. This is TFY2's core advantage — zero configuration.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/youtube-focus-mode/jedeklblgiihonnldgldeagmbkhlblek), confidence: HIGH

#### YouTube Blocker (10,000 users, 4.5 stars)
- **Approach:** Hardcodes allowed categories to Education, Science & Technology, and Howto & Style. Everything else is blocked.
- **Strengths:** Simple, opinionated. No configuration needed. Open source. 10K users with 4.5 stars.
- **What it lacks:** Hardcoded categories = inflexible. If you're watching music for focus, it blocks everything. No per-session adaptation.
- **Critical difference from TFY2:** YouTube Blocker has a fixed definition of "good" (educational). TFY2's definition of "good" is dynamic — whatever topic you're currently exploring.
- **Source:** [Chrome Web Store listing](https://chromewebstore.google.com/detail/youtube-blocker/oohcfepaadomnocmmkejhnfhcddpdpab), confidence: HIGH

### Competitive Gap Summary

| Capability | Unhook | DF Tube | RYS | BlockTube | YT Focus Mode | YT Blocker | **TFY2** |
|-----------|--------|---------|-----|-----------|---------------|------------|----------|
| Hide entire sidebar | Yes | Yes | Yes | No | No | No | No |
| Filter sidebar by relevance | No | No | No | No | Yes (manual) | Yes (hardcoded) | **Yes (auto)** |
| Auto-detect current topic | No | No | No | No | No | No | **Yes** |
| Zero-config per session | Yes* | Yes* | Yes* | No | No | Yes | **Yes** |
| Collapse vs remove | No | No | Reveal box | No | No | No | **Yes** |
| Still shows on-topic suggestions | No | No | No | N/A | Yes | Yes | **Yes** |

*Zero-config because they hide everything — no topic detection needed.

**TFY2's unique position:** The only extension that (a) auto-detects current video topic, (b) filters sidebar by relevance rather than hiding wholesale, and (c) collapses off-topic items rather than removing them. No existing extension does all three.

---

## Key Takeaways for Roadmap

1. **The core concept is genuinely differentiated.** Don't dilute it by adding Unhook-style section hiding. The value is in smart filtering, not bulk removal.

2. **API quota is the #1 technical risk.** Fetching categories for 10-20 sidebar suggestions per page navigation could burn through the 10,000 unit/day default quota fast (each `videos.list` call = 1 unit per video ID, but batching up to 50 IDs per call helps). Caching is not a "nice to have" — it's essential for sustained use.

3. **YouTube DOM fragility is the #1 maintenance risk.** DF Tube died because YouTube changed its DOM and the developer stopped updating. The extension must be designed so DOM selectors are isolated and easy to update.

4. **YouTube SPA navigation is a known stumbling block.** Multiple extension reviews across competitors cite "stops working when I navigate to a new video" as a top complaint. This must work flawlessly from day one.

5. **The collapse-with-label approach is a genuine UX differentiator.** RYS's "reveal box" is the closest competitor pattern, but it's applied to *everything*, not selectively. TFY2's approach of showing which specific items are off-topic is more informative.

## Sources

- Unhook Chrome Web Store listing: https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid (Confidence: HIGH)
- Unhook website: https://unhook.app (Confidence: HIGH)
- DF Tube Chrome Web Store listing: https://chromewebstore.google.com/detail/df-tube-distraction-free/mjdepdfccjgcndkmemponafgioodelna (Confidence: HIGH)
- BlockTube Chrome Web Store listing: https://chromewebstore.google.com/detail/blocktube/bbeaicapbccfllodepmimpkgecanonai (Confidence: HIGH)
- RYS Chrome Web Store listing: https://chromewebstore.google.com/detail/rys-remove-youtube-sugges/cdhdichomdnlaadbndgmagohccgpejae (Confidence: HIGH)
- RYS Features page: https://lawrencehook.com/rys/features/ (Confidence: HIGH)
- UnDistracted Chrome Web Store listing: https://chromewebstore.google.com/detail/undistracted-hide-faceboo/pjjgklgkfeoeiebjogplpnibpfnffkng (Confidence: HIGH)
- YouTube Focus Mode Chrome Web Store listing: https://chromewebstore.google.com/detail/youtube-focus-mode/jedeklblgiihonnldgldeagmbkhlblek (Confidence: HIGH)
- YouTube Blocker Chrome Web Store listing: https://chromewebstore.google.com/detail/youtube-blocker/oohcfepaadomnocmmkejhnfhcddpdpab (Confidence: HIGH)
- Study Mode YouTube Chrome Web Store listing: https://chromewebstore.google.com/detail/study-mode-youtube/hhjnoabnlicjpahfibejifhankpfahnd (Confidence: HIGH)

---
*Feature research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-20*
