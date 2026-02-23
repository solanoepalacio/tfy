# Phase 2: Sidebar Filtering - Research

**Researched:** 2026-02-23
**Domain:** Chrome MV3 content script DOM manipulation, MutationObserver, YouTube sidebar structure, CSS collapsing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | Extension identifies sidebar suggestion videos and retrieves their categories (batched API calls, up to 50 IDs per request) | YouTube sidebar uses `ytd-compact-video-renderer` elements; video IDs extractable from `a[href*="watch?v="]` inside each element; existing `GET_VIDEO_CATEGORY` service worker message + `fetchVideoCategories` already handles batching up to 50 IDs in one API call |
| FILT-02 | Extension compares each suggestion's category to the current video's category | Current video category already fetched and available from Phase 1's `fetchAndLogCategory` flow; comparison is simple string/number equality on `snippet.categoryId` values |
| FILT-03 | Off-topic suggestions are collapsed via CSS (not removed from DOM) | `element.style.maxHeight = '0'` + `overflow: hidden` + injected `::before` pseudo-element for label is the standard pattern; avoids YouTube's internal bookkeeping on rendered items |
</phase_requirements>

---

## Summary

Phase 2 extends the content script built in Phase 1 to do actual filtering. The work splits into three logical problems: (1) scraping sidebar video IDs from the DOM, (2) fetching their categories via the existing service worker API proxy, and (3) collapsing off-topic items visually with CSS while leaving the DOM intact.

The key architectural challenge is that YouTube's sidebar loads incrementally. The initial sidebar render populates roughly 20 suggestions, and more are added as the user scrolls. A `MutationObserver` watching the sidebar container (`#secondary` or `ytd-watch-next-secondary-results-renderer`) for `childList` mutations handles this: whenever new `ytd-compact-video-renderer` elements appear, the extension extracts their video IDs, fetches categories for any not-yet-seen IDs, and applies collapse styling. On SPA navigation, the observer must be disconnected, all applied styles reset, and the whole process restarted for the new video.

The batching strategy matters for API quota: collect all visible sidebar IDs at once (up to 50) and fire one `GET_VIDEO_CATEGORY` message, not one message per item. Phase 1's `fetchVideoCategories` already accepts an array of IDs and returns a map — reuse it directly. The extension already stores the current video's `categoryId` from Phase 1; that value is the comparison target for every sidebar item.

**Primary recommendation:** Extend `content-script.js` with a `filterSidebar(currentCategoryId)` function driven by a `MutationObserver` on `#secondary`. Collapse off-topic `ytd-compact-video-renderer` elements via inline style (`max-height: 0; overflow: hidden`). Inject a single `<style>` tag for the "hidden: off-topic" label using a CSS class, not per-element inline styles.

---

## Standard Stack

### Core

| API / Technique | Version | Purpose | Why Standard |
|-----------------|---------|---------|--------------|
| `MutationObserver` | Browser built-in | Detect lazily-added sidebar items as YouTube renders more suggestions | Only reliable way to react to YouTube's incremental DOM injection without polling |
| `document.querySelectorAll('ytd-compact-video-renderer')` | Browser built-in | Enumerate sidebar suggestion elements | Stable YouTube custom element name used across all known YouTube DOM manipulating extensions since 2019 |
| CSS class-based collapse (`max-height: 0; overflow: hidden`) | CSS | Visually hide off-topic items without removing from DOM | Satisfies FILT-03; `display:none` removes element from layout entirely; `visibility:hidden` leaves a blank gap; `max-height: 0` collapses the item cleanly |
| `chrome.runtime.sendMessage` (existing) | MV3 Chrome API | Send batched sidebar video IDs to service worker for category lookup | Already implemented in Phase 1; same `GET_VIDEO_CATEGORY` message type works with an array of IDs |
| `element.querySelector('a[href*="watch?v="]')` | Browser built-in | Extract video ID from a sidebar suggestion element | The `href` on the thumbnail/title anchor always contains `watch?v=<videoId>` — robust and selector-based |

### Supporting

| API / Technique | Version | Purpose | When to Use |
|-----------------|---------|---------|-------------|
| `URLSearchParams` | Browser built-in | Parse video ID from anchor href | Use `new URL(anchor.href).searchParams.get('v')` inside each `ytd-compact-video-renderer` |
| Injected `<style>` tag | CSS | Add `.tfy-hidden` class rule + `::before` label pseudo-element once | Inject once on script init; apply/remove the class per element — avoids setting many inline styles |
| `observer.disconnect()` + `observer.observe()` | MutationObserver API | Re-arm observer after SPA navigation cleanup | Call on `YT_NAVIGATION` message receipt before resetting state |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `max-height: 0` collapse | `display: none` | `display:none` fully removes from layout and may confuse YouTube's lazy-load scroll sentinel; `max-height:0` keeps element in flow |
| CSS class injection via `<style>` tag | Inline `element.style` per item | Per-element inline style is harder to reset on navigation; a single class rule is easy to un-apply by removing the class |
| `MutationObserver` on `#secondary` with `childList: true, subtree: true` | Polling `setInterval` | `setInterval` burns CPU, has latency, and misses rapid DOM bursts; `MutationObserver` is browser-native and zero-cost when idle |
| Reuse existing `GET_VIDEO_CATEGORY` service worker message | New message type | Phase 1 service worker already supports batched ID arrays; no new message type needed |

**Installation:** No new npm dependencies. Plain JS. No changes to manifest.json needed for Phase 2.

---

## Architecture Patterns

### Recommended Project Structure

```
tfy/
├── manifest.json              # Unchanged from Phase 1
├── service-worker.js          # Unchanged from Phase 1
├── content-script.js          # Extended: add sidebar filtering logic
├── popup.html                 # Unchanged from Phase 1
├── popup.js                   # Unchanged from Phase 1
└── icons/                     # Unchanged from Phase 1
```

All Phase 2 logic lives in `content-script.js`. No new files required.

### Pattern 1: Sidebar Video ID Extraction

**What:** For each `ytd-compact-video-renderer` in the sidebar, find the anchor tag whose href contains `watch?v=` and parse the video ID.

**When to use:** Called once when sidebar first renders, then again for each batch of new elements detected by MutationObserver.

```javascript
// content-script.js
// Source: DOM selector approach verified by multiple YouTube extension codebases

function extractVideoIdFromRenderer(rendererEl) {
  const anchor = rendererEl.querySelector('a[href*="watch?v="]');
  if (!anchor) return null;
  try {
    return new URL(anchor.href).searchParams.get('v');
  } catch {
    return null;
  }
}

function getSidebarVideoIds() {
  const renderers = document.querySelectorAll('ytd-compact-video-renderer');
  const ids = [];
  for (const el of renderers) {
    const id = extractVideoIdFromRenderer(el);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
```

### Pattern 2: CSS Collapse with Label (not DOM removal)

**What:** Inject a single `<style>` block once, then apply/remove a CSS class on individual `ytd-compact-video-renderer` elements.

**When to use:** Always — satisfies FILT-03 requirement to collapse via CSS, not remove.

```javascript
// content-script.js
// FILT-03: collapse via CSS, not DOM removal

function injectStyles() {
  if (document.getElementById('tfy-styles')) return; // already injected
  const style = document.createElement('style');
  style.id = 'tfy-styles';
  style.textContent = `
    .tfy-hidden {
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0.3 !important;
      transition: max-height 0.15s ease;
      position: relative;
    }
    .tfy-hidden::before {
      content: 'hidden: off-topic';
      display: block;
      font-size: 11px;
      color: #aaa;
      padding: 2px 8px;
      position: absolute;
      top: 0;
      left: 0;
    }
  `;
  document.head.appendChild(style);
}

function collapseElement(el) {
  el.classList.add('tfy-hidden');
}

function resetAllCollapsed() {
  document.querySelectorAll('.tfy-hidden').forEach(el => {
    el.classList.remove('tfy-hidden');
  });
}
```

**Note on label visibility:** `max-height: 0; overflow: hidden` means the `::before` pseudo-element will also be clipped. The label is only useful if `max-height` is set to a small non-zero value (e.g., `20px`) to show the label text. Consider `max-height: 20px` instead of `0` to expose the label. The success criteria says "collapsed suggestions show a small 'hidden: off-topic' label", so the label must remain visible — use `max-height: 20px`, not `0`.

### Pattern 3: MutationObserver for Lazy-Loaded Sidebar Items

**What:** Watch the sidebar container for new child elements. When new `ytd-compact-video-renderer` items appear, process them immediately.

**When to use:** After the initial filter pass; keep running for the duration of the video watch session.

```javascript
// content-script.js
// Source: MutationObserver API — MDN, browser built-in

let sidebarObserver = null;

function observeSidebar(onNewItems) {
  const secondary = document.querySelector('#secondary');
  if (!secondary) {
    // sidebar not yet in DOM — wait and retry
    setTimeout(() => observeSidebar(onNewItems), 300);
    return;
  }

  sidebarObserver = new MutationObserver((mutations) => {
    const addedRenderers = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Direct match
        if (node.matches('ytd-compact-video-renderer')) {
          addedRenderers.push(node);
        }
        // Descendants match (nested within added container)
        node.querySelectorAll('ytd-compact-video-renderer').forEach(el => {
          addedRenderers.push(el);
        });
      }
    }
    if (addedRenderers.length > 0) {
      onNewItems(addedRenderers);
    }
  });

  sidebarObserver.observe(secondary, { childList: true, subtree: true });
}

function disconnectSidebarObserver() {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }
}
```

### Pattern 4: Full Filter Flow

**What:** Orchestrate the end-to-end filter: get current video's category, collect sidebar IDs, fetch their categories in one batched call, apply CSS collapse.

**When to use:** Called on every video navigation (initial load + SPA navigation events).

```javascript
// content-script.js

let currentCategoryId = null; // set by Phase 1 fetchAndLogCategory flow

async function filterSidebar() {
  if (!currentCategoryId) return; // current video category not yet known

  const renderers = Array.from(document.querySelectorAll('ytd-compact-video-renderer'));
  if (renderers.length === 0) return;

  // Collect all video IDs present in sidebar
  const idToRenderer = new Map();
  for (const el of renderers) {
    const id = extractVideoIdFromRenderer(el);
    if (id) idToRenderer.set(id, el);
  }

  const videoIds = Array.from(idToRenderer.keys()).slice(0, 50);
  if (videoIds.length === 0) return;

  // Batch fetch categories via service worker
  const response = await chrome.runtime.sendMessage({
    type: 'GET_VIDEO_CATEGORY',
    videoIds
  });

  if (!response || response.error) {
    console.warn('[TFY] Sidebar filter: failed to fetch categories', response?.error);
    return;
  }

  // Apply collapse to off-topic items
  for (const [id, el] of idToRenderer) {
    const cat = response.categories?.[id];
    if (cat && cat !== currentCategoryId) {
      collapseElement(el);
    }
  }
}
```

### Pattern 5: SPA Navigation Cleanup

**What:** On `YT_NAVIGATION`, reset all collapsed items, disconnect the old observer, update `currentCategoryId`, then re-run filtering.

**When to use:** Every time a new video is loaded via SPA navigation.

```javascript
// content-script.js — expand existing YT_NAVIGATION handler

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YT_NAVIGATION') {
    // Reset state from previous video
    resetAllCollapsed();
    disconnectSidebarObserver();
    currentCategoryId = null;

    // Fetch new video's category (reuse Phase 1 flow)
    fetchAndLogCategory(message.videoId).then(() => {
      // currentCategoryId is now set inside fetchAndLogCategory
      filterSidebar();
      observeSidebar(handleNewSidebarItems);
    });
  }
});

function handleNewSidebarItems(newElements) {
  if (!currentCategoryId) return;
  // Process only the newly added elements, not all
  for (const el of newElements) {
    const id = extractVideoIdFromRenderer(el);
    if (!id) continue;
    // Batch: collect IDs of all unclassified new items, then fetch
    // For simplicity, re-run full filterSidebar (deduplication handled by idToRenderer Map)
  }
  filterSidebar(); // re-run — cheap since Map deduplication prevents re-fetching
}
```

**Important:** The above batches all sidebar IDs on each call to `filterSidebar`. For previously-processed items this means redundant API calls. A production optimization would cache `{ videoId: categoryId }` locally and only fetch unknown IDs. The requirements do not mandate caching in v1 (CACH-01 is listed as v2), so redundant fetches are acceptable for Phase 2 — but a simple in-memory `Map` cache within the content script session (not persisted) avoids re-fetching already-seen IDs.

### Anti-Patterns to Avoid

- **Removing `ytd-compact-video-renderer` from the DOM:** Violates FILT-03. YouTube's internal render engine may crash or behave unexpectedly if custom elements are removed. Use CSS class to collapse.
- **Setting `display: none` on sidebar items:** Fully removes from layout flow. May break YouTube's scroll/lazy-load sentinel, causing more items to never load. Use `max-height` collapse instead.
- **One `sendMessage` call per sidebar item:** 20 sidebar items = 20 API calls = 20 quota units. FILT-01 explicitly requires batching up to 50 IDs per request. One call per video costs 1 quota unit.
- **Observing `document.body` with `subtree: true`:** Too broad; fires on every DOM change on the entire page. Observe `#secondary` only.
- **Not disconnecting observer on navigation:** The old observer will keep firing on the new video's sidebar content, applying the old video's category filter to the new video's sidebar.
- **Injecting styles per-element via `element.style`:** Hard to reset on navigation. A CSS class applied/removed on elements with a single `<style>` tag is far easier to manage.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lazy DOM change detection | Polling `setInterval` on `querySelectorAll` count | `MutationObserver` | MutationObserver is native, zero-cost when idle, fires synchronously with DOM updates; polling has latency and wastes CPU |
| CSS collapse with label | Per-element `style` attribute manipulation | Single injected `<style>` tag + CSS class | Class-based approach is instantly reversible on navigation with one `querySelectorAll` + `classList.remove` sweep |
| Sidebar video ID parsing | Custom regex on element outerHTML | `element.querySelector('a[href*="watch?v="]')` + `URLSearchParams` | Selector is DOM-native; regex on HTML is fragile and fails on attribute order changes |
| Batched category fetching | Custom queue system | Existing `GET_VIDEO_CATEGORY` message with array payload | Phase 1 service worker already handles arrays of up to 50 IDs |

**Key insight:** YouTube's DOM is a moving target. Every custom solution that parses HTML strings or depends on exact element structure will break on YouTube redesigns. Use CSS selectors against stable element names (`ytd-compact-video-renderer`, `a[href*="watch?v="]`) and Chrome APIs for all state. Minimize DOM coupling.

---

## Common Pitfalls

### Pitfall 1: Sidebar Not Present When Content Script Runs

**What goes wrong:** `document.querySelector('#secondary')` returns `null` at `document_idle`, so the `MutationObserver` is never attached.

**Why it happens:** YouTube progressively renders the page. On `document_idle`, the main video player is ready but the sidebar's custom elements may still be rendering. `#secondary` exists in the HTML but `ytd-watch-next-secondary-results-renderer` (the inner container with actual suggestions) may not have any children yet.

**How to avoid:** Attach the `MutationObserver` to `#secondary` (the stable outer container that exists at `document_idle`). Use `subtree: true` and `childList: true` so it catches items added anywhere inside it, even before the inner renderer mounts. Also run an initial `filterSidebar()` pass after a 1-second delay to catch any items that rendered synchronously before the observer was attached.

**Warning signs:** Filtering works on hard page load but not when arriving via SPA navigation (where timing differs).

### Pitfall 2: `currentCategoryId` Not Set When `filterSidebar()` Runs

**What goes wrong:** `filterSidebar()` runs before the current video's category fetch completes, so all sidebar items pass the comparison (no `currentCategoryId` to compare against) and nothing is collapsed.

**Why it happens:** The category fetch is async (service worker message round-trip + network call). The sidebar MutationObserver callback fires while the fetch is in flight.

**How to avoid:** Guard `filterSidebar()` with `if (!currentCategoryId) return`. Update `currentCategoryId` inside the existing category fetch callback and call `filterSidebar()` from there. On the `YT_NAVIGATION` handler, the order must be: fetch current video category → set `currentCategoryId` → then call `filterSidebar()` and arm the observer.

**Warning signs:** Console shows `[TFY] currentCategoryId not set` but sidebar items are not collapsed.

### Pitfall 3: Double-Filtering on SPA Navigation

**What goes wrong:** Both the `YT_NAVIGATION` message listener and the `yt-navigate-finish` DOM event fire for the same navigation, causing `filterSidebar()` to run twice — wasting one full API call (1 quota unit) for a duplicate fetch.

**Why it happens:** Phase 1 deliberately uses both navigation signals as belt-and-suspenders. For Phase 2, both signals trigger filtering without deduplication.

**How to avoid:** Track a `isFilteringInProgress` boolean or compare the new `videoId` against the last-processed `videoId`. Skip if same video is already being processed. Alternatively, only use the `YT_NAVIGATION` service worker message (not the DOM event) to trigger filtering — the service worker relay is more reliable.

**Warning signs:** Console shows two `[TFY] filtering sidebar for video X` log lines per navigation.

### Pitfall 4: API Quota Exhaustion from Redundant Sidebar Fetches

**What goes wrong:** Every time the `MutationObserver` fires (even for minor DOM mutations), `filterSidebar()` calls `GET_VIDEO_CATEGORY` for all sidebar IDs again — including ones already fetched.

**Why it happens:** `filterSidebar()` has no memory of previously-fetched IDs.

**How to avoid:** Maintain an in-memory `Map` in the content script: `const categoryCache = new Map()`. Before calling `GET_VIDEO_CATEGORY`, filter `videoIds` to only IDs not already in the cache. After response, populate the cache. Reset the cache on navigation. This is a session-only cache (not `chrome.storage.local` — that's CACH-01, a v2 requirement). Even a session cache dramatically reduces API calls during a single video watch session.

**Warning signs:** DevTools Network tab shows repeated `googleapis.com` requests with the same video ID set within a single watch session.

### Pitfall 5: YouTube DOM Selector Instability

**What goes wrong:** `ytd-compact-video-renderer` or `a[href*="watch?v="]` selectors stop working after a YouTube update.

**Why it happens:** YouTube ships frequent A/B tests that restructure the DOM. Custom element names (`ytd-*`) have historically been more stable than class names, but they can change.

**How to avoid:** Do not use class-based selectors (`.ytd-compact-video-renderer`) — these are internal and change often. Use the element tag name (`ytd-compact-video-renderer`) and the URL pattern selector (`a[href*="watch?v="]`). Log failures explicitly: if `extractVideoIdFromRenderer` returns `null` for all renderers, log a warning so it's visible.

**Warning signs:** `getSidebarVideoIds()` returns an empty array despite visible sidebar items.

### Pitfall 6: `max-height: 0` Hiding the Label

**What goes wrong:** The "hidden: off-topic" label is not visible because `overflow: hidden` clips the `::before` pseudo-element.

**Why it happens:** `::before` is a child of the element; `overflow: hidden` clips children.

**How to avoid:** Use `max-height: 20px` (not `0`) to leave a sliver of space for the label text. The suggestion content below is hidden; just the label line remains visible. Alternatively, use a nested `<div>` label injected inside the element, positioned absolutely outside the overflow container.

**Warning signs:** Items disappear completely with no label visible.

---

## Code Examples

Verified patterns from official sources and cross-referenced implementations:

### Full MutationObserver Setup for YouTube Sidebar

```javascript
// content-script.js
// MutationObserver API: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
// Pattern verified by: no-youtube-recommendations, YouTube Shorts blocker, Return YouTube Dislike extensions

let sidebarObserver = null;

function observeSidebar(callback) {
  const container = document.querySelector('#secondary');
  if (!container) {
    setTimeout(() => observeSidebar(callback), 300);
    return;
  }
  sidebarObserver = new MutationObserver((mutations) => {
    let hasNewRenderers = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (
          node.matches?.('ytd-compact-video-renderer') ||
          node.querySelector?.('ytd-compact-video-renderer')
        ) {
          hasNewRenderers = true;
          break;
        }
      }
      if (hasNewRenderers) break;
    }
    if (hasNewRenderers) callback();
  });
  sidebarObserver.observe(container, { childList: true, subtree: true });
}
```

### CSS Injection for Collapsed State with Label

```javascript
// content-script.js
// Injected once at script init

function injectTFYStyles() {
  if (document.getElementById('tfy-styles')) return;
  const style = document.createElement('style');
  style.id = 'tfy-styles';
  style.textContent = `
    ytd-compact-video-renderer.tfy-hidden {
      max-height: 20px !important;
      overflow: hidden !important;
      opacity: 0.5;
    }
    ytd-compact-video-renderer.tfy-hidden::before {
      content: 'hidden: off-topic';
      display: block;
      font-size: 11px;
      color: #888;
      padding: 2px 8px;
      line-height: 16px;
    }
  `;
  document.head.appendChild(style);
}
```

### Session-Only Category Cache

```javascript
// content-script.js
// Resets on navigation; avoids duplicate API calls within a watch session

const sessionCategoryCache = new Map(); // videoId -> categoryId

async function fetchUnknownCategories(videoIds) {
  const unknown = videoIds.filter(id => !sessionCategoryCache.has(id));
  if (unknown.length === 0) return;

  const response = await chrome.runtime.sendMessage({
    type: 'GET_VIDEO_CATEGORY',
    videoIds: unknown.slice(0, 50) // batch cap
  });

  if (response?.categories) {
    for (const [id, cat] of Object.entries(response.categories)) {
      sessionCategoryCache.set(id, cat);
    }
  }
}

function resetSessionCache() {
  sessionCategoryCache.clear();
}
```

### Navigation Handler (Phase 2 Extension)

```javascript
// content-script.js — extend existing YT_NAVIGATION handler

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YT_NAVIGATION') {
    // 1. Teardown previous video state
    resetAllCollapsed();
    disconnectSidebarObserver();
    resetSessionCache();
    currentCategoryId = null;

    // 2. Re-initialize for new video
    const videoId = message.videoId;
    initForVideo(videoId);
  }
});

async function initForVideo(videoId) {
  // Fetch current video category (reuse Phase 1 flow, but store result)
  const response = await chrome.runtime.sendMessage({
    type: 'GET_VIDEO_CATEGORY',
    videoIds: [videoId]
  });

  if (response?.categories?.[videoId]) {
    currentCategoryId = response.categories[videoId];
    console.log(`[TFY] Current video category: ${currentCategoryId}`);
  } else {
    console.warn('[TFY] Could not determine current video category');
    return;
  }

  // 3. Run initial filter pass (items already in DOM)
  await filterSidebar();

  // 4. Watch for lazily added items
  observeSidebar(filterSidebar);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `display: none` to hide DOM elements | `max-height` CSS collapse | Ongoing best practice | Keeps element in layout flow; avoids breaking YouTube's scroll sentinel |
| Polling `setInterval` for DOM changes | `MutationObserver` | Available since Chrome 26, now universal | Zero CPU when idle, immediate callback on change |
| One API call per element | Batch all IDs in one `videos.list` call | Always the right approach | 1 quota unit for 50 IDs vs 50 units for 50 calls |
| `innerHTML` parsing for video IDs | DOM selector `querySelector('a[href*="watch?v="]')` | Best practice since modern DOM APIs | Resilient to HTML restructuring; no regex fragility |

**Deprecated/outdated:**
- Parsing video IDs from YouTube's `ytInitialData` JS variable: Was used by some extensions but brittle; the injected JSON structure changes frequently. Use DOM selectors instead.
- `IntersectionObserver` for lazy-load detection: Used for triggering fetches when items scroll into view — not needed here since MutationObserver fires when items are added to DOM (before they necessarily scroll into view).

---

## Open Questions

1. **Does `ytd-compact-video-renderer` remain the correct selector in 2026?**
   - What we know: This custom element name has been stable in YouTube's DOM since at least 2019 and is used by dozens of active extensions (uBlock Origin lists, Return YouTube Dislike, various YouTube userscripts).
   - What's unclear: YouTube is testing an expanded sidebar thumbnail UI (reported February 2026); the wrapper element name may change in A/B test variants.
   - Recommendation: Use `ytd-compact-video-renderer` as the primary selector. Log a warning if `getSidebarVideoIds()` returns 0 items when the sidebar is visually populated, so selector breakage is immediately detectable.

2. **What is the exact sidebar container selector for the MutationObserver target?**
   - What we know: `#secondary` is the stable outer container on the watch page. `ytd-watch-next-secondary-results-renderer` is the inner custom element. Both are present on the watch page.
   - What's unclear: Whether attaching the observer to `#secondary` vs `ytd-watch-next-secondary-results-renderer` makes a meaningful difference for lazy-load detection.
   - Recommendation: Observe `#secondary` (more stable, shallower hierarchy). Use `subtree: true` to catch items inside the inner renderer.

3. **Will `filterSidebar()` be called before `currentCategoryId` is set on initial page load?**
   - What we know: Phase 1's `fetchAndLogCategory` is async. The sidebar may render before the API call returns.
   - What's unclear: Exact timing between sidebar DOM population and API response on typical network conditions.
   - Recommendation: The guard `if (!currentCategoryId) return` in `filterSidebar()` handles this. The MutationObserver callback also calls `filterSidebar()` — once `currentCategoryId` is set, the next MutationObserver firing will process items. Alternatively, call `filterSidebar()` explicitly at the end of `initForVideo()` after setting `currentCategoryId`.

---

## Sources

### Primary (HIGH confidence)

- https://developers.google.com/youtube/v3/docs/videos/list — `videos.list` with `part=snippet`, `snippet.categoryId`, comma-separated `id` parameter, max 50 IDs
- https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver — MutationObserver API, `childList`, `subtree`, `observe()`, `disconnect()`, `addedNodes`
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging — `chrome.runtime.sendMessage` async pattern (established in Phase 1 research)
- https://developer.mozilla.org/en-US/docs/Web/CSS/max-height — `max-height: 0` / `overflow: hidden` pattern

### Secondary (MEDIUM confidence)

- https://gist.github.com/robleh/583165b8e3da40ad0f04154aefa75cb2 — uBlock Origin filter confirms `ytd-watch-next-secondary-results-renderer.ytd-watch-flexy` and `#secondary` as the sidebar container selectors
- https://greasyfork.org/en/scripts/480312-compact-youtube-layout/code — Confirms `ytd-compact-video-renderer` is the current (2024) element name for sidebar items and `#video-title.ytd-compact-video-renderer` for title targeting
- https://github.com/mklilley/no-youtube-recommendations — MutationObserver on `document.body` with `subtree: true` + `#secondary` selector pattern confirmed working
- https://piunikaweb.com/2026/02/04/youtube-sidebar-thumbnails-bigger-ui-test/ — Confirms YouTube sidebar structure active as of February 2026 (new thumbnail size A/B test but same DOM elements)

### Tertiary (LOW confidence — for validation)

- Multiple YouTube userscripts on GreasyFork confirm `ytd-compact-video-renderer` is current but YouTube DOM changes are routine; selector should be verified in browser before finalizing implementation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are browser built-ins or established Chrome extension APIs; verified via MDN and official Chrome docs
- Architecture: HIGH — MutationObserver + CSS class pattern is the canonical approach used by all serious YouTube extension projects; cross-verified across multiple sources
- YouTube DOM selectors: MEDIUM — `ytd-compact-video-renderer` and `#secondary` confirmed by multiple sources as of 2024-2026, but YouTube DOM is inherently unstable
- Pitfalls: HIGH — quota, race condition, and navigation reset issues are deterministic engineering problems, not speculative

**Research date:** 2026-02-23
**Valid until:** 2026-04-23 (YouTube DOM selectors should be re-verified if YouTube ships a major UI redesign; Chrome APIs and MutationObserver are stable indefinitely)
