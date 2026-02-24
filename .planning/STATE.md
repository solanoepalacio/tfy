# Project State: TFY2

## Current Status

**Active Phase:** Not started (defining requirements)
**Current Plan:** —
**Progress:** [░░░░░░░░░░] 0%

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching.
**Current focus:** v1.2 — Readme Documentation

## Phase Status

| Phase | Name | Status | Plans | Progress |
|-------|------|--------|-------|----------|
| 1 | Extension Foundation + Category Detection | Complete | 3/3 | 100% |
| 2 | Sidebar Filtering | Complete | 2/2 | 100% |
| 3 | Popup Controls + Toggle Persistence | Complete | 2/2 | 100% |
| 4 | Observability & Shorts Suppression | Complete | 1/1 | 100% |

## Decisions

- Content script scoped to youtube.com/watch* only — prevents injection on YouTube homepage and search pages
- API key stored in chrome.storage.local — persists across browser restarts unlike sessionStorage/localStorage
- type=password on API key input — masks key in popup UI without additional complexity
- PNG icons generated with raw Node.js zlib — no external npm dependency needed for dev-mode placeholders
- All API calls routed through service worker — content scripts cannot call googleapis.com due to Chrome cross-origin restrictions
- return true in onMessage listener keeps channel open for async sendResponse
- Single retry on null response handles service worker cold-start race (avoids infinite loops if no API key)
- yt-navigate-finish DOM event used as fallback navigation detection alongside service worker relay
- [Phase 02-sidebar-filtering]: 20px max-height on tfy-hidden class keeps ::before label visible; session cache cleared by navigation handlers not initForVideo; unknown-category items not collapsed to avoid hiding potentially on-topic content
- [Phase 02-sidebar-filtering]: lastProcessedVideoId deduplication set before initForVideo call; fetchAndLogCategory retained with no call sites
- [Phase 03-popup-controls-toggle-persistence]: Separate chrome.storage.local.get calls for apiKey and filteringEnabled kept per existing pattern
- [Phase 03-popup-controls-toggle-persistence]: Re-enable path checks currentCategoryId first (no API call) before falling back to initForVideo
- [Phase 03-popup-controls-toggle-persistence]: Human verification in real Chrome browser is required for popup/content-script messaging — automated tests cannot replicate chrome.tabs.sendMessage across popup/tab boundary
- [Phase 04-observability-shorts-suppression]: CATEGORY_NAMES const maps YouTube category IDs to human-readable names for rich collapsed labels
- [Phase 04-observability-shorts-suppression]: CSS attr(data-tfy-label) on ::before renders dynamic label from DOM attribute set by collapseElement
- [Phase 04-observability-shorts-suppression]: Both ytd-reel-shelf-renderer and ytm-shorts-lockup-view-model-v2 targeted for Shorts shelf suppression

## Recent Activity

- 2026-02-20: Roadmap created
- 2026-02-23: Completed 01-01 — Chrome MV3 extension scaffold (manifest.json, icons, popup.html, popup.js)
- 2026-02-23: Completed 01-02 — service-worker.js (YouTube Data API proxy + SPA navigation relay) and content-script.js (video ID extraction + category logging)
- 2026-02-23: Reached 01-03 checkpoint — human browser verification required before Phase 2
- 2026-02-23: Completed 01-03 — human verified all 5 end-to-end steps passed; Phase 1 complete
- 2026-02-24: Completed 02-01 — complete sidebar filtering engine (CSS injection, batched API cache, MutationObserver, initForVideo orchestrator)
- 2026-02-24: 02-02 Task 1 done — navigation handlers wired to initForVideo() with lastProcessedVideoId deduplication and teardown cycle; at human-verify checkpoint
- 2026-02-24: Completed 03-01 — filtering toggle checkbox in popup with chrome.storage.local persistence and TFY_TOGGLE message handler in content-script
- 2026-02-24: Completed 03-02 — human-verified end-to-end toggle: OFF reveals sidebar immediately, ON re-collapses within ~1s, state persists across Chrome restart. Phase 3 complete.
- 2026-02-24: v1.1 roadmap created — Phase 4 (Observability & Shorts Suppression) added covering LABL-01 and SHRT-01
- 2026-02-24: Completed 04-01 — rich collapsed labels via CATEGORY_NAMES + data-tfy-label, Shorts shelf hidden via CSS. Phase 4 complete.

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01-extension-foundation-category-detection | 01 | 1min | 2 | 6 |
| 01-extension-foundation-category-detection | 02 | 1min | 2 | 2 |
| 01-extension-foundation-category-detection | 03 | 1min | 1 | 0 |
| 02-sidebar-filtering | 01 | 1min | 2 | 1 |
| 02-sidebar-filtering | 02 | 2min | 1 | 1 |
| 03-popup-controls-toggle-persistence | 01 | 1min | 2 | 4 |
| 03-popup-controls-toggle-persistence | 02 | 0min | 1 | 0 |
| 04-observability-shorts-suppression | 01 | 5min | 2 | 1 |

## Stopped At

Milestone v1.2 started — defining requirements.

---
*Last updated: 2026-02-24 — Milestone v1.2 started*
