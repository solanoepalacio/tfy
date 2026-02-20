# Pitfalls Research

**Domain:** Chrome Extension (YouTube DOM manipulation + YouTube Data API v3)
**Researched:** 2026-02-20
**Confidence:** HIGH (sourced from Chrome official docs, YouTube API docs, MDN, and verified domain-specific patterns)

---

## Critical Pitfalls

These cause fundamental breakage — the extension appears broken to the user.

---

### Pitfall 1: YouTube SPA Navigation Destroys Your Content Script State

**What goes wrong:**
YouTube is a Single Page Application (SPA). When the user clicks a video link in the sidebar, YouTube does NOT perform a full page reload. It uses `history.pushState()` / `popstate` to swap content in-place. The URL changes from `/watch?v=abc` to `/watch?v=xyz`, but your content script's `document_idle` injection only fires on the *initial* full page load. After the first SPA navigation, your content script never re-runs. The sidebar fills with unfiltered suggestions and your extension appears dead.

**Why it happens:**
Chrome's content script injection (both static `"content_scripts"` in manifest and `document_idle`/`document_end` triggers) only fires on actual navigation events — full HTTP navigations that create a new document. YouTube's client-side routing does not create a new document; it reuses the existing one. The content script stays loaded in memory, but any initialization logic (finding the sidebar, reading the current video ID) ran only once for the first video.

**How to avoid:**
1. **Detect URL changes** — Listen for `yt-navigate-finish` custom events that YouTube fires after SPA navigation. This is the YouTube-specific signal. As a fallback, use a `MutationObserver` on `<title>` or poll `location.href`.
2. **Architecture: Separate initialization from detection** — Structure the content script so that the "find sidebar, read video ID, start filtering" logic is a callable function, not top-level imperative code. Call it on initial load AND on every SPA navigation.
3. **Extract video ID from URL on every navigation** — Parse `window.location.search` for the `v` parameter on each navigation event, not just once.

**Warning signs:**
- Extension works on first page load but stops working when clicking any video link.
- Extension works after a hard refresh (Ctrl+R) but not during normal browsing.
- `console.log` in content script shows it only runs once per session.

**Phase to address:** Phase 1 (Scaffold) — This is the #1 architectural decision. If you get this wrong, everything built on top fails.

**Confidence:** HIGH — Verified via Chrome docs on content script injection timing (only fires on document creation, not pushState).

---

### Pitfall 2: Sidebar Content Loads Asynchronously and Incrementally

**What goes wrong:**
You query the DOM for sidebar suggestion elements immediately after detecting a navigation, but the sidebar is empty or only partially loaded. YouTube lazily renders sidebar suggestions — they load in batches as the user scrolls, and the initial batch isn't present in the DOM when the page first "finishes" navigating. Your `querySelectorAll` finds 0 or only 2-3 elements, misses the other 15+, and the user sees unfiltered suggestions that loaded after your script ran.

**Why it happens:**
YouTube's sidebar renderer (`ytd-watch-next-secondary-results-renderer`) uses a lazy/virtual rendering strategy. Elements are added to the DOM progressively:
- Some arrive shortly after the main video player loads (maybe 200-500ms after navigation).
- More arrive as YouTube's recommendation engine responds.
- Even more arrive on scroll (infinite scroll / lazy loading).

A one-shot `querySelectorAll` at any single point in time will miss future elements.

**How to avoid:**
1. **Use `MutationObserver` on the sidebar container** — Observe `childList` mutations on the sidebar container element. Process each new batch of `<ytd-compact-video-renderer>` elements as they appear.
2. **Configure observer correctly** — Use `{ childList: true, subtree: true }` since YouTube's DOM is deeply nested and suggestion elements may be inserted at varying depths.
3. **Debounce processing** — YouTube may add elements one-by-one rapidly. Batch your processing with a short debounce (50-100ms) to avoid running your filter logic 20 times for 20 individual element insertions.
4. **Handle the container not existing yet** — The sidebar container itself may not exist when your script first runs after SPA navigation. You may need to observe a higher-level ancestor first, then switch to observing the sidebar container once it appears.

**Warning signs:**
- Some sidebar items are filtered but others are not.
- Filtering works inconsistently — sometimes 3 items are filtered, sometimes 15.
- Scrolling down reveals unfiltered items.

**Phase to address:** Phase 1 (Scaffold) — Core to the filtering mechanism. MutationObserver is the foundational pattern for this extension.

**Confidence:** HIGH — MutationObserver is the canonical approach per MDN and Chrome docs. YouTube's lazy rendering behavior is well-documented in the extension development community.

---

### Pitfall 3: MV3 Service Worker Terminates and Loses In-Memory State

**What goes wrong:**
You store the current video's category, the API response cache, or the enabled/disabled toggle in a JavaScript variable in the service worker. After 30 seconds of inactivity (no messages, no API calls), Chrome terminates the service worker. When the content script sends a message, the service worker wakes up — but all in-memory variables are `undefined`. The extension throws errors or returns wrong data.

**Why it happens:**
Per Chrome's official documentation: "Chrome terminates a service worker when one of the following conditions is met: After 30 seconds of inactivity." Global variables are lost on termination. This is a fundamental MV3 architectural constraint — there is no persistent background page anymore.

**How to avoid:**
1. **Use `chrome.storage.session` for ephemeral state** — API response caches, current video category, toggle state. `session` storage persists across service worker restarts but clears when the browser closes. It does NOT count against quota for the `local` storage area.
2. **Use `chrome.storage.local` for persistent config** — API key, user preferences that should survive browser restarts.
3. **Never use global `let`/`const`/`var` in service worker for state** — Only use them for constants (like API endpoints) or event handler registrations.
4. **Design service worker to be stateless** — Each message handler should read needed state from storage, process, and respond. Don't assume any prior state exists.

**Warning signs:**
- Extension works for the first few minutes, then starts returning null/undefined values.
- Works perfectly while DevTools (for the service worker) is open (because DevTools keeps the service worker alive), but breaks when DevTools is closed.
- Intermittent "cannot read property of undefined" errors in service worker logs.

**Phase to address:** Phase 1 (Scaffold) — Must be designed from the start. Retrofitting stateless service worker architecture is painful.

**Confidence:** HIGH — Directly from Chrome's official service worker lifecycle documentation.

---

### Pitfall 4: YouTube Data API Quota Exhaustion from Naive API Calling

**What goes wrong:**
The sidebar has ~20 video suggestions. For each video, you call `videos.list` to get its category. That's 20 API calls per page view. The user watches 10 videos in a session: 200 API calls. Over a day of research browsing (50 videos): 1,000 calls. Each `videos.list` costs 1 quota unit — so that's 1,000/10,000 daily quota. Sounds manageable, but:
- If you accidentally call on SPA navigation AND the initial mutation AND each batch of new sidebar items, you might triple-count.
- If you call `videos.list` individually (1 video ID per request) instead of batching (up to 50 IDs per request), you use 20x more requests than necessary.
- If you DON'T cache results, the same video appearing in sidebars across multiple pages causes redundant calls.

At worst case without batching/caching: 50 videos/day * 20 sidebar items * 1 call each = 1,000 units/day. With accidental re-triggering, easily 3,000-5,000 units/day. You have 10,000 total.

**Why it happens:**
The YouTube Data API v3 has a default quota of 10,000 units/day. `videos.list` costs 1 unit per call. But it accepts up to 50 comma-separated video IDs in a single call — still 1 unit. Most developers don't realize they can batch.

**How to avoid:**
1. **Batch video IDs** — `videos.list` accepts `id=VIDEO_ID_1,VIDEO_ID_2,...,VIDEO_ID_50` — one call, one quota unit, up to 50 results. Collect all sidebar video IDs first, then make ONE batched API call.
2. **Cache aggressively** — A video's category NEVER changes. Cache `videoId -> categoryId` in `chrome.storage.local`. Before any API call, filter out video IDs you've already cached. Over time, your cache will cover most popular videos.
3. **Use `fields` parameter** — Request only needed fields: `fields=items(id,snippet/categoryId)`. This reduces response size (bandwidth) though it doesn't reduce quota cost.
4. **Use the `part` parameter minimally** — `part=snippet` is sufficient for categoryId. Don't request `contentDetails`, `statistics`, etc.
5. **Deduplicate before calling** — The same video ID can appear in sidebar across navigations. Before batching, check your cache.

**Warning signs:**
- API returns HTTP 403 with reason `quotaExceeded` partway through the day.
- Network tab shows dozens of individual `videos.list` calls with single IDs.
- Extension works in the morning but stops working by afternoon.

**Phase to address:** Phase 2 (API Integration) — When API calls are first implemented, batching and caching must be built in from the start.

**Confidence:** HIGH — Quota costs directly verified from Google's official quota calculator page: `videos.list` = 1 unit, `videoCategories.list` = 1 unit, default = 10,000/day.

---

### Pitfall 5: Targeting Wrong DOM Selectors That Break on YouTube Updates

**What goes wrong:**
You target YouTube sidebar elements with CSS selectors like `#secondary .ytd-compact-video-renderer` or `ytd-watch-next-secondary-results-renderer`. YouTube updates their frontend code every 1-4 weeks. Tag names, class names, IDs, and DOM structure all change without notice. Your extension suddenly stops finding any sidebar elements and silently does nothing.

**Why it happens:**
YouTube is a Google Polymer/Lit web components application. Element names like `ytd-compact-video-renderer` are custom elements. While YouTube's top-level custom element names have been relatively stable (they're part of the web components API), internal class names, `id` attributes, and nesting depth change frequently. YouTube does NOT provide a stable DOM API for extensions.

**How to avoid:**
1. **Prefer custom element tag names over classes/IDs** — `ytd-compact-video-renderer` is a custom element tag and tends to be more stable than class names or IDs. Use `document.querySelectorAll('ytd-compact-video-renderer')` rather than `.style-scope.ytd-watch-next-secondary-results-renderer .video-item`.
2. **Use semantic structure, not positional selectors** — Avoid `:nth-child`, complex descendant chains, or layout-dependent selectors.
3. **Build resilient selectors with fallbacks** — Try primary selector first; if it returns 0 results, try fallback selectors. Log warnings when falling back so you notice breakage early.
4. **Isolate selector definitions** — Put all DOM selectors in a single constants file. When YouTube changes, you update one file, not scattered hardcoded strings.
5. **Accept this is inherently fragile** — You're building on an unstable surface. Design for graceful degradation: if selectors fail, the extension does nothing (shows unfiltered sidebar) rather than crashing or corrupting the page.

**Warning signs:**
- Extension stops working after a browser restart (YouTube updated in the background).
- `querySelectorAll` returns empty NodeLists in console testing.
- CSS rules no longer match any elements.

**Phase to address:** Phase 1 (Scaffold) — Selector strategy should be centralized from day 1. Accept and plan for this fragility.

**Confidence:** MEDIUM — YouTube's custom element tag names have been stable for years, but this cannot be guaranteed. No official stability commitment exists.

---

### Pitfall 6: Content Script Doesn't Run on Already-Open YouTube Tabs

**What goes wrong:**
You install/reload the extension in developer mode. YouTube is already open in a tab. You navigate to a video — the extension does nothing. You open a NEW tab with YouTube — it works. The existing tab never got the content script injected because static content script injection only occurs when a page is loaded AFTER the extension is installed.

**Why it happens:**
Static content scripts (`"content_scripts"` in manifest.json) are injected into pages that match the URL pattern when those pages are loaded. If the page was loaded BEFORE the extension was installed (or reloaded during development), the content script is not retroactively injected.

**How to avoid:**
1. **During development, just reload the YouTube tab after reloading the extension.** Accept this as a dev workflow limitation.
2. **Optionally: programmatic injection on install** — In the service worker's `chrome.runtime.onInstalled` listener, use `chrome.tabs.query` to find existing YouTube tabs and `chrome.scripting.executeScript` to inject into them. This is nice-to-have, not critical for personal-use.

**Warning signs:**
- "My extension doesn't work!" but only on tabs that were open before the extension was loaded.
- Works on some tabs but not others (the ones that were open during install).

**Phase to address:** Phase 1 (Scaffold) — Awareness is enough. Programmatic injection on install can be a Phase 3 polish item.

**Confidence:** HIGH — Directly from Chrome content scripts documentation: static scripts inject on page load, not retroactively.

---

### Pitfall 7: Extracting Video ID from Sidebar Items Is Harder Than Expected

**What goes wrong:**
You need the video ID of each sidebar suggestion to look up its category via the API. You assume you can just read the `href` attribute from an `<a>` tag inside each sidebar item. But YouTube's custom elements use complex shadow DOM structures, virtual DOM patterns, and the `href` may be on an ancestor element, not the individual item. Or the `href` is a relative URL. Or the video ID is embedded in a `data-*` attribute you didn't expect.

**Why it happens:**
YouTube's sidebar items (`ytd-compact-video-renderer`) contain nested custom elements. The clickable link element and the video data are organized in ways that don't follow simple HTML patterns. The video ID might be:
- In the `href` of an `<a>` tag (e.g., `/watch?v=VIDEO_ID`)
- In a `data` property on the custom element (accessible via JS properties, not attributes)
- In the element's internal `data` object (only accessible by reading the element's Polymer/Lit properties)

**How to avoid:**
1. **Inspect the actual DOM first** — Before writing extraction code, manually inspect YouTube's sidebar in DevTools. Look at the actual structure of `ytd-compact-video-renderer` elements.
2. **Try reading the element's `.data` property** — YouTube's Polymer elements often expose a `.data` JS property containing the video's metadata (including videoId). This is more reliable than parsing `href` attributes.
3. **Parse the `href` as a fallback** — Look for `<a>` tags with `href` containing `/watch?v=`. Use `URL` or `URLSearchParams` to reliably extract the `v` parameter. Don't regex the href.
4. **Use `URLSearchParams`** — `new URL(anchorElement.href).searchParams.get('v')` is reliable and handles edge cases (extra params, fragments).

**Warning signs:**
- Video IDs are `null` or `undefined` when passed to the API.
- API returns no results for the IDs you extracted.
- Some sidebar items return valid IDs but others don't.

**Phase to address:** Phase 1 (Scaffold) — Video ID extraction is the core input to the entire filtering pipeline.

**Confidence:** MEDIUM — YouTube's Polymer element structure is not officially documented. The `.data` property pattern is based on community knowledge.

---

## Moderate Pitfalls

These cause delays, confusion, or technical debt but won't necessarily break the extension completely.

---

### Pitfall 8: MutationObserver Runs Too Broadly and Tanks Performance

**What goes wrong:**
You set up a `MutationObserver` with `{ childList: true, subtree: true }` on `document.body` instead of on the specific sidebar container. YouTube's DOM is enormous and mutates constantly (video player updates, comments loading, ad injections, animations). Your observer callback fires hundreds of times per second, your filter logic runs on every mutation, and the page becomes sluggish.

**Prevention:**
- **Observe the narrowest possible container** — Find the sidebar's parent element and observe only that subtree. Not `document.body`.
- **Early-return in callback** — Check if added nodes are actually `ytd-compact-video-renderer` before doing any processing. Skip all other mutations.
- **Debounce expensive operations** — Batch mutations and process them in a `requestAnimationFrame` or `setTimeout(..., 50)` debounce.
- **Disconnect when not on a watch page** — If the user navigates away from `/watch`, disconnect the observer.

**Phase to address:** Phase 1 — Observer scope must be correct from the start.

---

### Pitfall 9: Message Passing Race Conditions Between Content Script and Service Worker

**What goes wrong:**
Content script detects SPA navigation, extracts video IDs, sends them to the service worker for API lookup. But the service worker was terminated (idle timeout) and hasn't fully restarted by the time the message arrives. Or the content script sends two rapid messages (for two quick navigations) and the responses arrive out of order. The content script applies stale category data from the previous video's sidebar.

**Prevention:**
- **Use `chrome.runtime.sendMessage` which auto-wakes the service worker** — Don't use `postMessage` / service worker messaging. Chrome extension messaging wakes the service worker automatically.
- **Include the video ID (or a request ID) in both request and response** — When the response arrives, verify it's for the *current* video, not a previous one. Discard stale responses.
- **Set a "current video" guard** — Before applying filter results, check that the current page's video ID still matches what was requested. If the user navigated away during the API call, discard.

**Phase to address:** Phase 2 (API Integration) — Becomes relevant when async API calls are introduced.

---

### Pitfall 10: API Key Exposed in Network Requests Visible to Page JavaScript

**What goes wrong:**
If the content script makes API calls directly (via `fetch` to `googleapis.com`), the API key is in the URL or headers, visible in the page's DevTools Network tab, and potentially accessible to YouTube's page-level JavaScript. For a personal-use extension this is low risk, but it's still sloppy.

**Prevention:**
- **Make API calls from the service worker, not the content script** — Content script sends video IDs to service worker via messaging. Service worker makes the fetch to YouTube API. API key lives only in the service worker context.
- **Store the API key in `chrome.storage.local`** — The service worker reads it from storage when needed. Never hardcode the API key in the content script.
- **Add `host_permissions` for the API domain** — In `manifest.json`, add `"https://www.googleapis.com/*"` to host_permissions so the service worker can make cross-origin fetches.

**Phase to address:** Phase 2 (API Integration) — Architectural decision when API calls are first implemented.

---

### Pitfall 11: Not Handling the "Current Video" Category Lookup

**What goes wrong:**
You need the category of the currently-playing video to compare against sidebar suggestions. But you only look up sidebar video categories, forgetting that you also need to fetch the current video's category. Or you extract the current video ID from the URL but make a separate API call for it instead of batching it with sidebar IDs.

**Prevention:**
- **Fetch current video's category as the FIRST step** — Before processing sidebar items, get the current video's category.
- **Cache it** — The current video's category won't change during the session. Cache it in `chrome.storage.session` keyed by video ID.
- **Batch with sidebar lookups** — Include the current video ID in the same `videos.list` batch call as sidebar IDs to save quota.

**Phase to address:** Phase 2 (API Integration) — Must be in the API flow from the start.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded CSS selectors scattered across files | Fast to write | One YouTube update breaks everything; have to hunt through all files | Never — centralize selectors from day 1 |
| Storing API key as a string constant in source code | Works immediately | Key committed to git; visible in source | Acceptable for POC since personal-use and private repo; move to `chrome.storage.local` for durability |
| Individual API calls per video ID | Simpler logic | 20x quota usage per page load | Never — batching is trivial to implement with `videos.list` |
| `setInterval` polling for URL changes instead of event-based detection | "Works" for SPA navigation | Constant CPU usage; delayed detection (depends on interval); inelegant | Only as a fallback if `yt-navigate-finish` event proves unreliable |
| Observing `document.body` instead of sidebar container | "Works" everywhere | Performance degradation; observer fires for every DOM change on the page | Only temporarily while bootstrapping, before sidebar container is identified |
| No API response caching | Simpler code; always fresh data | Quota exhaustion; slower filtering; unnecessary network requests | Never — a video's category is immutable; caching has zero downsides |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Content Script ↔ Service Worker messaging | Using `window.postMessage` (wrong API — that's for page ↔ content script communication) | Use `chrome.runtime.sendMessage` (content→SW) and `chrome.tabs.sendMessage` (SW→content) |
| YouTube Data API v3 `videos.list` | Requesting `part=snippet,contentDetails,statistics` when you only need categoryId | `part=snippet` + `fields=items(id,snippet/categoryId)` — minimal data |
| YouTube Data API v3 batch IDs | Passing IDs as separate API calls | Join up to 50 IDs as comma-separated string in `id` parameter: `id=ID1,ID2,ID3` |
| `chrome.storage.local` in content scripts | Assuming content script's `localStorage` === extension's storage | Content script's Web Storage APIs access the HOST page's storage (YouTube's). Use `chrome.storage.local` for extension storage, which IS accessible from content scripts |
| Manifest `host_permissions` | Forgetting to add API domain | Must include `"https://www.googleapis.com/*"` for service worker to fetch YouTube API |
| Manifest `permissions` | Requesting too many permissions | Minimum needed: `"storage"`, `"activeTab"` or host_permissions for YouTube |
| Content script `run_at` timing | Using `document_start` (DOM not ready) or `document_end` (may miss some elements) | `document_idle` (default) is correct — DOM is ready, but remember YouTube SPA navigation means you need MutationObserver regardless |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| MutationObserver on `document.body` with `subtree: true` | Page lag, high CPU, janky scrolling | Observe only the sidebar container element | Always — YouTube's DOM mutates constantly (player, comments, ads) |
| Synchronous DOM queries in MutationObserver callback | Each mutation triggers expensive `querySelectorAll` across entire document | Only process `mutation.addedNodes`, not the full DOM | With 10+ sidebar items loading in rapid succession |
| No debounce on observer callback | Filter logic runs 20 times for 20 individual element insertions | Collect mutations, process in batched `requestAnimationFrame` or 50ms `setTimeout` | During initial sidebar population (many elements added rapidly) |
| Re-fetching API data on every SPA navigation without checking cache | Unnecessary network requests; quota waste; slower UX | Check `chrome.storage.local` cache before any API call | After first few navigations when cache is warm |
| Applying CSS `display:none` to sidebar items (DOM thrashing) | Layout reflow for each hidden element | Use CSS classes with `visibility: hidden` + `height: 0` + `overflow: hidden`, or better: wrap in a collapse container | When hiding 15+ items simultaneously |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key in content script source code | Key visible to YouTube's page-level JavaScript (isolated worlds protect JS variables, but network requests are visible) | Keep API key in service worker only; make API calls from service worker |
| API key committed to git (public repo) | Key exposed to anyone who finds the repo | Add API key to `.gitignore`; store in `chrome.storage.local` loaded via options page, or use a config file excluded from git |
| Not validating API response data before injecting into DOM | XSS risk if API response is corrupted or contains unexpected HTML | Parse JSON responses with `JSON.parse`; never use `innerHTML` with API data; use `textContent` for any displayed text |
| `host_permissions` too broad | Unnecessary access to sites; if published, Chrome Web Store would reject | Scope to exactly `"*://*.youtube.com/*"` and `"https://www.googleapis.com/*"` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Removing sidebar items from DOM entirely (`element.remove()`) | YouTube's scripts may error when they can't find expected elements; user can't undo; page feels "broken" | Collapse with CSS (height: 0, overflow: hidden) + small clickable "hidden: off-topic" label |
| No visual feedback while API call is in progress | User sees unfiltered sidebar for 1-3 seconds, then items suddenly collapse — jarring | Show a subtle "filtering..." indicator, or hide sidebar items by default and reveal them as they pass the filter |
| Filtering on every navigation with no toggle | User can't see all suggestions even when they want to | Popup toggle (in scope); persist toggle state in `chrome.storage.local` |
| Aggressive filtering that hides too much | Sidebar has 0-2 visible items; user thinks YouTube is broken | Show collapsed items with expand affordance; consider showing a count ("12 off-topic items hidden") |
| Flash of unfiltered content (FOUC) | User briefly sees all suggestions before filtering kicks in | Apply a CSS rule immediately (via manifest CSS injection) that fades sidebar items until they're marked as "checked" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Works on SPA navigation, not just initial page load** — Click 3 video links in sequence; filtering must work on all 3 without manual refresh.
- [ ] **Sidebar items added AFTER initial load are filtered** — Scroll down in the sidebar to trigger lazy loading; new items must be filtered too.
- [ ] **Extension works after browser idle** — Leave Chrome idle for 5 minutes, then navigate YouTube. Service worker will have terminated; it must revive correctly.
- [ ] **API quota is sustainable** — Check Google Cloud Console quota usage after a realistic 30-minute browsing session. Estimate daily usage.
- [ ] **Toggle OFF actually stops filtering** — Toggling off in popup should immediately restore all collapsed sidebar items, not just stop filtering new ones.
- [ ] **Cache is actually being used** — After visiting the same popular video in sidebar twice, confirm no duplicate API calls in Network tab.
- [ ] **No errors in service worker console** — Open `chrome://extensions`, click "Service Worker" inspect link. No unhandled promise rejections or undefined variable errors.
- [ ] **Extension survives extension reload during development** — After clicking "Reload" on `chrome://extensions`, the already-open YouTube tab needs the content script re-injected (manual refresh or programmatic injection).

---

## Pitfall-to-Phase Mapping

| Pitfall | # | Prevention Phase | Verification |
|---------|---|------------------|--------------|
| YouTube SPA navigation breaks content script | 1 | Phase 1 (Scaffold) | Click 3 different videos; extension works on each |
| Sidebar lazy/incremental loading | 2 | Phase 1 (Scaffold) | Scroll sidebar; new items are processed |
| MV3 service worker state loss | 3 | Phase 1 (Scaffold) | Wait 5 min idle; service worker still responds to messages |
| API quota exhaustion | 4 | Phase 2 (API Integration) | Monitor Google Cloud Console after 30-min session |
| YouTube DOM selector fragility | 5 | Phase 1 (Scaffold) | All selectors in one constants file; fallback selector logic present |
| Content script not injected on existing tabs | 6 | Phase 1 (dev awareness) | Document in dev workflow; optionally add programmatic injection later |
| Video ID extraction from sidebar items | 7 | Phase 1 (Scaffold) | Log extracted video IDs; verify all are valid 11-char strings |
| MutationObserver scope too broad | 8 | Phase 1 (Scaffold) | Profile CPU during browsing; observer only fires for sidebar changes |
| Message passing race conditions | 9 | Phase 2 (API Integration) | Rapidly click 3 videos; no stale data applied |
| API key exposure | 10 | Phase 2 (API Integration) | Verify no API key visible in content script context |
| Forgetting current video category lookup | 11 | Phase 2 (API Integration) | Current video's category appears in logs/debug output |

---

## YouTube-Specific DOM Knowledge

These are not pitfalls per se, but critical domain knowledge needed to avoid the pitfalls above.

**Key YouTube custom elements (as of early 2026):**
| Element | What it is | Stability |
|---------|------------|-----------|
| `ytd-app` | Root application element | HIGH — unlikely to change |
| `ytd-watch-flexy` | Watch page container | HIGH — has been stable for years |
| `ytd-watch-next-secondary-results-renderer` | Sidebar suggestions container | MEDIUM — tag name stable, internal structure changes |
| `ytd-compact-video-renderer` | Individual sidebar video suggestion | MEDIUM — the primary element to target for filtering |
| `ytd-compact-radio-renderer` | Sidebar "Mix" playlist suggestion | MEDIUM — should also be processed/filtered |
| `ytd-compact-playlist-renderer` | Sidebar playlist suggestion | MEDIUM — may want to filter or skip |

**YouTube navigation events:**
| Event | Where to listen | What it means |
|-------|-----------------|---------------|
| `yt-navigate-finish` | `document` | SPA navigation completed; new page is rendered |
| `yt-navigate-start` | `document` | SPA navigation beginning; old page about to be replaced |
| `yt-page-data-updated` | `document` | Page data (title, metadata) has been updated |

**Confidence:** MEDIUM — These are community-observed patterns, not officially documented by YouTube. Tag names and event names may change without notice.

---

## Sources

- **Chrome Extension Service Worker Lifecycle:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle (HIGH confidence, official docs)
- **Chrome Extension Content Scripts:** https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (HIGH confidence, official docs)
- **Chrome Extension Message Passing:** https://developer.chrome.com/docs/extensions/develop/concepts/messaging (HIGH confidence, official docs)
- **Chrome Extension Events in Service Workers:** https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events (HIGH confidence, official docs)
- **Chrome Extension Storage and Cookies:** https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies (HIGH confidence, official docs)
- **YouTube Data API v3 Overview & Quota:** https://developers.google.com/youtube/v3/getting-started (HIGH confidence, official docs)
- **YouTube Data API v3 Quota Calculator:** https://developers.google.com/youtube/v3/determine_quota_cost (HIGH confidence, official docs — `videos.list` = 1 unit, `videoCategories.list` = 1 unit, default quota = 10,000/day)
- **MDN MutationObserver:** https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver (HIGH confidence, official MDN docs)
- **YouTube SPA navigation custom events (`yt-navigate-finish`):** Community-documented pattern (MEDIUM confidence — not officially documented by YouTube, but widely used and stable for years)
- **YouTube custom element tag names:** Community-inspected via DevTools (MEDIUM confidence — stable in practice but no official stability guarantee)

---
*Pitfalls research for: Chrome Extension (YouTube sidebar filter)*
*Researched: 2026-02-20*
