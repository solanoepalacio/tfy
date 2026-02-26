# Requirements: TFY — Topic Focused YouTube

**Defined:** 2026-02-24
**Core Value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching — eliminating cross-interest distraction during focused research sessions.

## v1.2 Requirements

### Documentation

- [x] **DOC-01**: Reader understands what TFY does and why it exists (motivation + problem statement)
- [x] **DOC-02**: Reader understands this extension is a POC built entirely by AI agents as an agentic engineering exercise
- [x] **DOC-03**: Reader can identify prerequisites before installing (Chrome, Google Cloud project, YouTube Data API v3 key)
- [x] **DOC-04**: Reader can install the extension in Chrome developer mode from a fresh clone
- [x] **DOC-05**: Reader can configure the extension by entering their YouTube Data API v3 key in the popup
- [x] **DOC-06**: Reader understands daily usage — how filtering works, the popup toggle, collapsed labels, and Shorts suppression

## v1.3 Requirements

Bug-fix release. No new user-facing features. Fixes two runtime correctness failures that cause filtering to silently not work and the popup to display stale state.

### SPA Navigation

- [ ] **SPAV-01**: Filtering activates automatically when navigating from the YouTube homepage to a watch page (no page reload required)
- [ ] **SPAV-02**: Filtering activates automatically on any in-app YouTube navigation to a watch page (e.g., clicking related videos, navigating back and forward)

### Tab State

- [ ] **TABST-01**: Popup clears the category display when the associated YouTube watch tab is closed
- [ ] **TABST-02**: Popup shows the correct category for the currently active YouTube tab when multiple YouTube tabs are open
- [ ] **TABST-03**: Closing a non-YouTube tab (e.g., Gmail) does not affect the popup's category display

## Future Requirements

### Hardening

- **HARD-01**: In-memory tab registry survives service worker restart (chrome.storage.session mirror)
- **HARD-02**: Orphaned per-tab storage keys from previous browser sessions are cleaned up on extension startup

## Out of Scope

| Feature | Reason |
|---------|--------|
| Manual topic input | Extension infers topic from current video — no override needed for POC |
| Keyword/semantic similarity matching | Category-based matching sufficient for POC |
| Chrome Web Store publishing | Personal developer mode only |
| Cross-browser support | Chrome only |
| Usage analytics or suggestion counts | Filtered sidebar speaks for itself |
| Homepage feed filtering | No "current video" to match against on homepage — different product |
| Contributing guide | Personal-use POC, no external contributors expected |
| Changelog / release notes | Not needed for single-user dev project |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOC-01 | Phase 5 | Complete |
| DOC-02 | Phase 5 | Complete |
| DOC-03 | Phase 5 | Complete |
| DOC-04 | Phase 5 | Complete |
| DOC-05 | Phase 5 | Complete |
| DOC-06 | Phase 5 | Complete |
| SPAV-01 | Phase 6 | Pending |
| SPAV-02 | Phase 6 | Pending |
| TABST-01 | Phase 7 | Pending |
| TABST-02 | Phase 7 | Pending |
| TABST-03 | Phase 7 | Pending |

**Coverage:**
- v1.2 requirements: 6 total — all complete ✓
- v1.3 requirements: 5 total
- v1.3 mapped to phases: 5
- v1.3 unmapped: 0 ✓

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-26 after v1.3 milestone start*
