# Roadmap: TFY2 — Topic Focused YouTube

**Created:** 2026-02-20
**Depth:** Quick (3-5 phases)
**Requirements:** 10 v1 requirements

## Phases

### Phase 1: Extension Foundation + Category Detection

**Goal:** A Chrome extension that loads on YouTube, survives SPA navigation, extracts the current video ID, and retrieves its category from the YouTube Data API — proving the entire plumbing chain works end-to-end.

**Requirements:**
- CORE-01: Chrome Manifest v3 extension with service worker, content script, and popup
- CORE-02: User can enter YouTube Data API v3 key once, persisted across sessions
- CORE-03: Extension re-initializes filtering on YouTube SPA navigation (no page reload needed)
- CATD-01: Extension extracts video ID from the current YouTube watch page
- CATD-02: Extension detects the current video's category via YouTube Data API v3

**Success Criteria:**
1. Extension loads in Chrome via developer mode and content script activates on youtube.com/watch pages
2. User can enter their YouTube API key in the popup and it persists after closing the browser
3. When user navigates between YouTube videos (without full page reload), the extension detects the new video and logs its category to the console
4. Service worker correctly proxies API calls from the content script using the stored API key, with batched video ID lookups (up to 50 per request)

**Dependencies:** None
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Extension scaffold: manifest.json, icons, popup with API key storage
- [x] 01-02-PLAN.md — Data pipeline: service-worker.js (API proxy + nav relay) + content-script.js (video ID + category log)
- [ ] 01-03-PLAN.md — Human verification: end-to-end test in Chrome browser

---

### Phase 2: Sidebar Filtering

**Goal:** Off-topic sidebar suggestions are collapsed with a visible label, so the user sees only same-category videos in the sidebar while watching a video.

**Requirements:**
- FILT-01: Extension identifies sidebar suggestion videos and retrieves their categories (batched API calls, up to 50 IDs per request)
- FILT-02: Extension compares each suggestion's category to the current video's category
- FILT-03: Off-topic suggestions are collapsed via CSS (not removed from DOM)

**Success Criteria:**
1. When watching a "Science & Technology" video, sidebar suggestions from other categories (e.g., "Entertainment", "Gaming") are visually collapsed
2. Collapsed suggestions show a small "hidden: off-topic" label and remain in the DOM (not removed)
3. When navigating to a different video via YouTube's SPA navigation, the sidebar re-filters based on the new video's category
4. Sidebar suggestions that load lazily (via scroll or YouTube's incremental loading) are filtered as they appear

**Dependencies:** Phase 1
**Estimated plans:** 1-2

---

### Phase 3: Popup Controls + Toggle Persistence

**Goal:** User can turn filtering on and off from the extension popup, and that choice sticks across browser restarts.

**Requirements:**
- POPU-01: User can toggle filtering on/off from the extension popup
- CORE-04: Toggle state persists across browser restarts

**Success Criteria:**
1. User can click a toggle in the extension popup to disable filtering, and all collapsed sidebar suggestions immediately become visible again
2. User can re-enable filtering from the popup and off-topic suggestions collapse again without reloading the page
3. Toggle state survives browser restart — if filtering was off when Chrome closed, it remains off when Chrome reopens

**Dependencies:** Phase 2
**Estimated plans:** 1

---

## Requirement Coverage

| Requirement | Phase | Description |
|-------------|-------|-------------|
| CORE-01 | Phase 1 | Chrome Manifest v3 extension with service worker, content script, and popup |
| CORE-02 | Phase 1 | User can enter YouTube Data API v3 key once, persisted across sessions |
| CORE-03 | Phase 1 | Extension re-initializes filtering on YouTube SPA navigation |
| CORE-04 | Phase 3 | Toggle state persists across browser restarts |
| CATD-01 | Phase 1 | Extension extracts video ID from the current YouTube watch page |
| CATD-02 | Phase 1 | Extension detects current video's category via YouTube Data API v3 |
| FILT-01 | Phase 2 | Extension identifies sidebar suggestions and retrieves their categories |
| FILT-02 | Phase 2 | Extension compares each suggestion's category to current video's category |
| FILT-03 | Phase 2 | Off-topic suggestions are collapsed via CSS (not removed from DOM) |
| POPU-01 | Phase 3 | User can toggle filtering on/off from the extension popup |

**Coverage: 10/10 (100%)**

---
*Roadmap created: 2026-02-20*
*Phase 1 planned: 2026-02-23*
