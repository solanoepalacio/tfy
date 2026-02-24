# Project State: TFY

## Current Status

**Active Phase:** Phase 5 — Write README
**Current Plan:** 05-01 (not started)
**Progress:** [████████░░] 80%

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching.
**Current focus:** v1.2 — Readme Documentation (Phase 5)

## Phase Status

| Phase | Name | Status | Plans | Progress |
|-------|------|--------|-------|----------|
| 1 | Extension Foundation + Category Detection | Complete | 3/3 | 100% |
| 2 | Sidebar Filtering | Complete | 2/2 | 100% |
| 3 | Popup Controls + Toggle Persistence | Complete | 2/2 | 100% |
| 4 | Observability & Shorts Suppression | Complete | 1/1 | 100% |
| 5 | Write README | Not started | 0/1 | 0% |

## Decisions

- Content script scoped to youtube.com/watch* only — prevents injection on YouTube homepage and search pages
- API key stored in chrome.storage.local — persists across browser restarts unlike sessionStorage/localStorage
- All API calls routed through service worker — content scripts cannot call googleapis.com due to Chrome cross-origin restrictions
- [Phase 02-sidebar-filtering]: 20px max-height on tfy-hidden class keeps ::before label visible; unknown-category items not collapsed
- [Phase 03-popup-controls-toggle-persistence]: Re-enable path checks currentCategoryId first (no API call) before falling back to initForVideo
- [Phase 04-observability-shorts-suppression]: CSS attr(data-tfy-label) on ::before renders dynamic label from DOM attribute set by collapseElement

## Recent Activity

- 2026-02-24: Completed 04-01 — rich collapsed labels via CATEGORY_NAMES + data-tfy-label, Shorts shelf hidden via CSS. Phase 4 complete.
- 2026-02-24: v1.2 roadmap created — Phase 5 (Write README) added covering DOC-01 through DOC-06

## Stopped At

Phase 5 ready to plan — write 05-01-PLAN.md.

---
*Last updated: 2026-02-24 — v1.2 milestone roadmap created, Phase 5 ready to plan*
