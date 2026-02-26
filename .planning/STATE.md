# Project State: TFY

## Current Status

**Active Phase:** Not started (defining requirements)
**Current Plan:** —
**Progress:** [░░░░░░░░░░] 0%

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching.
**Current focus:** v1.3 — Bug Fixes (defining requirements)

## Phase Status

| Phase | Name | Status | Plans | Progress |
|-------|------|--------|-------|----------|
| 1 | Extension Foundation + Category Detection | Complete | 3/3 | 100% |
| 2 | Sidebar Filtering | Complete | 2/2 | 100% |
| 3 | Popup Controls + Toggle Persistence | Complete | 2/2 | 100% |
| 4 | Observability & Shorts Suppression | Complete | 1/1 | 100% |
| 5 | Write README | Complete | 1/1 | 100% |

## Decisions

- Content script scoped to youtube.com/watch* only — prevents injection on YouTube homepage and search pages
- API key stored in chrome.storage.local — persists across browser restarts unlike sessionStorage/localStorage
- All API calls routed through service worker — content scripts cannot call googleapis.com due to Chrome cross-origin restrictions
- [Phase 02-sidebar-filtering]: 20px max-height on tfy-hidden class keeps ::before label visible; unknown-category items not collapsed
- [Phase 03-popup-controls-toggle-persistence]: Re-enable path checks currentCategoryId first (no API call) before falling back to initForVideo
- [Phase 04-observability-shorts-suppression]: CSS attr(data-tfy-label) on ::before renders dynamic label from DOM attribute set by collapseElement
- [Phase 05-write-readme]: Pointed readers to console.cloud.google.com for API key setup without walking through GCP UI — avoids staleness, respects reader's prior knowledge
- [Phase 05-write-readme]: Used blockquote for agentic POC callout to make it visually distinct from prose sections

## Recent Activity

- 2026-02-24: Completed 05-01 — README.md written and human cold-read approved. Phase 5 complete. v1.2 milestone complete.
- 2026-02-26: v1.3 milestone started — defining requirements for tab state + SPA navigation bug fixes

## Stopped At

v1.3 milestone started. Defining requirements.

---
*Last updated: 2026-02-26 — Milestone v1.3 started*
