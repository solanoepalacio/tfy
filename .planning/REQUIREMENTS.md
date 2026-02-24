# Requirements: TFY2 — Topic Focused YouTube

**Defined:** 2026-02-20
**Core Value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching.

## v1.0 Requirements (Complete)

### Extension Core

- [x] **CORE-01**: Chrome Manifest v3 extension with service worker, content script, and popup
- [x] **CORE-02**: User can enter YouTube Data API v3 key once, persisted across sessions
- [x] **CORE-03**: Extension re-initializes filtering on YouTube SPA navigation (no page reload needed)
- [x] **CORE-04**: Toggle state persists across browser restarts

### Category Detection

- [x] **CATD-01**: Extension extracts video ID from the current YouTube watch page
- [x] **CATD-02**: Extension detects the current video's category via YouTube Data API v3

### Sidebar Filtering

- [x] **FILT-01**: Extension identifies sidebar suggestion videos and retrieves their categories (batched API calls, up to 50 IDs per request)
- [x] **FILT-02**: Extension compares each suggestion's category to the current video's category
- [x] **FILT-03**: Off-topic suggestions are collapsed via CSS (not removed from DOM)

### Popup

- [x] **POPU-01**: User can toggle filtering on/off from the extension popup

## v1.1 Requirements

Requirements for current milestone. Each maps to roadmap phases.

### Label Observability

- [ ] **LABL-01**: Hidden sidebar items display the video's title and category name on the collapsed label (e.g., "hidden: Gaming · How to speedrun Minecraft")

### Shorts Suppression

- [ ] **SHRT-01**: The Shorts shelf panel (ytm-shorts-lockup-view-model-v2) is hidden on all YouTube watch pages

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Caching & Performance

- **CACH-01**: Cache category lookups in chrome.storage.local (video categories are immutable)
- **CACH-02**: Handle lazy sidebar / infinite scroll adding more suggestions after initial scan

### UI Enhancements

- **UIEN-01**: Category label display in popup ("Current: Science & Technology")
- **UIEN-02**: Count of hidden vs shown suggestions ("Showing 4 of 12")
- **UIEN-03**: "Hidden: off-topic" expandable label on collapsed items (click to reveal)
- **UIEN-04**: Extension icon badge indicating active/inactive filtering state

### Reliability

- **RELI-01**: Graceful error state UI when API fails (indicator that filtering is inactive)

### Social

- **SOCL-01**: Allowlist subscribed channels (always show regardless of category)

### Matching Refinement

- **MTCH-01**: Related category grouping (e.g., "Science & Technology" + "Education" both match)
- **MTCH-02**: Tag-based matching for finer-grained topic similarity

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Manual category allowlist/blocklist UI | Defeats auto-infer value prop — TFY2's differentiator is zero-config |
| Keyword/regex content filtering | Different product entirely — use BlockTube for this |
| Homepage feed filtering | No "current video" context on homepage to match against |
| YouTube Shorts blocking | Previously deferred — now in scope as of v1.1 |
| Comments hiding | Unrelated to cross-topic distraction filtering |
| Autoplay control | YouTube has a native autoplay toggle |
| Time limits/scheduling | Different product category — use StayFocusd |
| Cross-browser support | Chrome developer mode only — personal use |
| Chrome Web Store publishing | Personal use, developer mode sideloading |
| Settings sync across devices | Single user, single device — chrome.storage.local sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 3 | Complete |
| CATD-01 | Phase 1 | Complete |
| CATD-02 | Phase 1 | Complete |
| FILT-01 | Phase 2 | Complete |
| FILT-02 | Phase 2 | Complete |
| FILT-03 | Phase 2 | Complete |
| POPU-01 | Phase 3 | Complete |
| LABL-01 | Phase 4 | Pending |
| SHRT-01 | Phase 4 | Pending |

**Coverage (v1.0):**
- v1.0 requirements: 10 total
- Mapped to phases: 10
- Status: All complete ✓

**Coverage (v1.1):**
- v1.1 requirements: 2 total
- Mapped to phases: 2
- Status: Phase 4 pending ✓

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-24 — v1.1 requirements mapped to Phase 4*
