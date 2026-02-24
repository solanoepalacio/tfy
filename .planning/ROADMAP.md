# Roadmap: TFY — Topic Focused YouTube

## Milestones

- ✅ **v1.0 MVP** - Phases 1-3 (shipped 2026-02-24)
- ✅ **v1.1 Observability & Shorts Suppression** - Phase 4 (shipped 2026-02-24)
- 🚧 **v1.2 Readme Documentation** - Phase 5 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) - SHIPPED 2026-02-24</summary>

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
- [x] 01-03-PLAN.md — Human verification: end-to-end test in Chrome browser

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
**Plans:** 2/2 plans complete

Plans:
- [x] 02-01-PLAN.md — Sidebar filtering engine: CSS injection, video ID extraction, session cache, filterSidebar(), MutationObserver, initForVideo()
- [x] 02-02-PLAN.md — Navigation wiring + human verification: wire initForVideo() to all navigation handlers with deduplication

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
**Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md — Toggle implementation: popup checkbox UI, storage persistence, content script startup guard and TFY_TOGGLE handler
- [x] 03-02-PLAN.md — Human verification: end-to-end toggle test in Chrome browser

</details>

<details>
<summary>✅ v1.1 Observability & Shorts Suppression (Phase 4) - SHIPPED 2026-02-24</summary>

### Phase 4: Observability & Shorts Suppression

**Goal:** Hidden sidebar items reveal what they contain, and the Shorts panel is unconditionally hidden on watch pages — giving the user full awareness of what is filtered and eliminating Shorts as a distraction vector.

**Requirements:**
- LABL-01: Hidden sidebar items display the video's title and category name on the collapsed label (e.g., "hidden: Gaming · How to speedrun Minecraft")
- SHRT-01: The Shorts shelf panel (ytm-shorts-lockup-view-model-v2) is hidden on all YouTube watch pages

**Success Criteria:**
1. When a sidebar suggestion is collapsed, its label shows the video title and category name — not just "hidden: off-topic"
2. The Shorts shelf panel is not visible anywhere in the sidebar on any YouTube watch page, regardless of filtering state
3. Label content updates correctly when navigating between videos via SPA navigation

**Dependencies:** Phase 3
**Plans:** 1/1 plans complete

Plans:
- [x] 04-01-PLAN.md — Rich labels (LABL-01) + Shorts suppression (SHRT-01): update content-script.js CSS and filtering logic

</details>

### 🚧 v1.2 Readme Documentation (In Progress)

**Milestone Goal:** Write a complete README that explains the extension's motivation, the agentic POC origin, and guides a new user through install, API key setup, and daily usage.

#### Phase 5: Write README

**Goal:** A reader with no prior context can understand what TFY is, why it exists, and how to install, configure, and use it — entirely from the README.

**Depends on**: Phase 4
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06
**Success Criteria** (what must be TRUE):
  1. Reader can state what TFY does and what problem it solves without looking at any other file
  2. Reader understands the extension was built entirely by AI agents as an agentic engineering POC
  3. Reader knows exactly what they need before installing (Chrome, Google Cloud project, YouTube Data API v3 key)
  4. Reader can install the extension in Chrome developer mode from a fresh clone using only the README steps
  5. Reader can enter their API key and see the extension filtering their sidebar after following the README
**Plans**: 1 plan

Plans:
- [ ] 05-01-PLAN.md — Write README.md: motivation, agentic POC note, prerequisites, install, configure, usage

---

## Requirement Coverage

### v1.0 Requirements

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

**v1.0 Coverage: 10/10 (100%)**

### v1.1 Requirements

| Requirement | Phase | Description |
|-------------|-------|-------------|
| LABL-01 | Phase 4 | Hidden items display video title and category on the collapsed label |
| SHRT-01 | Phase 4 | Shorts shelf panel hidden on all YouTube watch pages |

**v1.1 Coverage: 2/2 (100%)**

### v1.2 Requirements

| Requirement | Phase | Description |
|-------------|-------|-------------|
| DOC-01 | Phase 5 | Reader understands what TFY does and why it exists |
| DOC-02 | Phase 5 | Reader understands this is a POC built entirely by AI agents |
| DOC-03 | Phase 5 | Reader can identify prerequisites before installing |
| DOC-04 | Phase 5 | Reader can install the extension in Chrome developer mode from a fresh clone |
| DOC-05 | Phase 5 | Reader can configure the extension by entering their API key in the popup |
| DOC-06 | Phase 5 | Reader understands daily usage — filtering, toggle, collapsed labels, Shorts suppression |

**v1.2 Coverage: 6/6 (100%)**

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Extension Foundation + Category Detection | v1.0 | 3/3 | Complete | 2026-02-24 |
| 2. Sidebar Filtering | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Popup Controls + Toggle Persistence | v1.0 | 2/2 | Complete | 2026-02-24 |
| 4. Observability & Shorts Suppression | v1.1 | 1/1 | Complete | 2026-02-24 |
| 5. Write README | 1/1 | Complete    | 2026-02-24 | - |

---
*Roadmap created: 2026-02-20*
*Phase 1 planned: 2026-02-23*
*Phase 2 planned: 2026-02-23*
*Phase 3 planned: 2026-02-24*
*Phase 4 added: 2026-02-24 (v1.1 milestone)*
*Phase 5 added: 2026-02-24 (v1.2 milestone)*
