# Project State: TFY

## Current Status

**Active Phase:** Phase 7 — Tab Lifecycle Fix + Multi-Tab Storage Scoping
**Current Plan:** Not started
**Progress:** [█████████░] 92%

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching.
**Current focus:** v1.3 — Bug Fixes (Phase 7: Tab Lifecycle Fix + Multi-Tab Storage Scoping)

## Phase Status

| Phase | Name | Status | Plans | Progress |
|-------|------|--------|-------|----------|
| 1 | Extension Foundation + Category Detection | Complete | 3/3 | 100% |
| 2 | Sidebar Filtering | Complete | 2/2 | 100% |
| 3 | Popup Controls + Toggle Persistence | Complete | 2/2 | 100% |
| 4 | Observability & Shorts Suppression | Complete | 1/1 | 100% |
| 5 | Write README | Complete | 1/1 | 100% |
| 6 | SPA Navigation Fix | Complete | 2/2 | 100% |
| 7 | Tab Lifecycle Fix + Multi-Tab Storage Scoping | Not started | 0/TBD | 0% |

## Decisions

- Content script scoped to youtube.com/watch* only — prevents injection on YouTube homepage and search pages
- API key stored in chrome.storage.local — persists across browser restarts unlike sessionStorage/localStorage
- All API calls routed through service worker — content scripts cannot call googleapis.com due to Chrome cross-origin restrictions
- [Phase 02-sidebar-filtering]: 20px max-height on tfy-hidden class keeps ::before label visible; unknown-category items not collapsed
- [Phase 03-popup-controls-toggle-persistence]: Re-enable path checks currentCategoryId first (no API call) before falling back to initForVideo
- [Phase 04-observability-shorts-suppression]: CSS attr(data-tfy-label) on ::before renders dynamic label from DOM attribute set by collapseElement
- [Phase 05-write-readme]: Pointed readers to console.cloud.google.com for API key setup without walking through GCP UI — avoids staleness, respects reader's prior knowledge
- [Phase 05-write-readme]: Used blockquote for agentic POC callout to make it visually distinct from prose sections
- [v1.3 roadmap]: Phase 6 before Phase 7 — manifest match expansion is prerequisite for popup-to-content-script messaging used in tab state fix; SPA fix independently verifiable
- [v1.3 roadmap]: TABST-01/02/03 bundled in Phase 7 — per-tab storage key schema change (currentVideoCategory_${tabId}) and onRemoved cleanup must land as a unit; split creates new mismatches
- [v1.3 roadmap]: Hardening requirements (HARD-01 session mirror, HARD-02 startup sweep) deferred to Future Requirements — not required for correctness, only long-session resilience
- [Phase 06-spa-navigation-fix]: Declarative match pattern expansion (youtube.com/*) chosen over programmatic scripting injection — simpler, no new permissions required
- [Phase 06-spa-navigation-fix]: injectTFYStyles moved inside IIFE/nav handlers — prevents ytd-reel-shelf-renderer:display:none from applying on YouTube homepage (out of scope)
- [Phase 06-spa-navigation-fix]: initForVideo calls disconnectSidebarObserver() as first line — correct teardown point for rapid navigation race prevention
- [Phase 06-spa-navigation-fix]: All 5 SPA navigation test scenarios confirmed passing in Chrome browser — SPAV-01 and SPAV-02 verified by human

## Recent Activity

- 2026-02-24: Completed 05-01 — README.md written and human cold-read approved. Phase 5 complete. v1.2 milestone complete.
- 2026-02-26: v1.3 milestone started — requirements defined (SPAV-01, SPAV-02, TABST-01, TABST-02, TABST-03)
- 2026-02-26: v1.3 roadmap created — Phases 6 and 7 added; 100% requirement coverage
- 2026-02-26: Completed 06-01 — Manifest match expanded, observer hardened, initForVideo idempotent, dead code removed. SPAV-01 and SPAV-02 complete.
- 2026-02-26: Completed 06-02 — Human verified all 5 SPA navigation test scenarios in Chrome. Phase 6 complete.

## Stopped At

Completed 06-02-PLAN.md — Phase 6 complete. Ready to plan and execute Phase 7 (Tab Lifecycle Fix + Multi-Tab Storage Scoping).

---
*Last updated: 2026-02-26 — 06-02 human verification approved, Phase 6 complete*
