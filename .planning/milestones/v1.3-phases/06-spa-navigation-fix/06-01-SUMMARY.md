---
phase: 06-spa-navigation-fix
plan: 01
subsystem: extension
tags: [chrome-extension, content-script, manifest, spa-navigation, mutation-observer]

# Dependency graph
requires:
  - phase: 04-observability-shorts-suppression
    provides: injectTFYStyles, sidebarObserver, observeSidebar, disconnectSidebarObserver, initForVideo functions
provides:
  - Expanded content_scripts match to youtube.com/* (root-cause fix for SPAV-01/SPAV-02)
  - Timer-aware observer teardown via sidebarObserverRetryTimer
  - Idempotent initForVideo (disconnects previous observer before any async work)
  - Watch-page-only CSS injection (injectTFYStyles gated on video init paths)
  - Dead code removal (fetchAndLogCategory removed)
affects: [07-tab-lifecycle-fix]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sidebarObserverRetryTimer pattern: always cancel pending setTimeout handles before disconnecting the MutationObserver to prevent phantom retries on navigation"
    - "Idempotency guard pattern: async init functions call teardown as first line so re-entrant calls are safe"
    - "Watch-page CSS guard: injectTFYStyles called only in watch-page-gated code paths, never at module top-level"

key-files:
  created: []
  modified:
    - manifest.json
    - content-script.js

key-decisions:
  - "Declarative match pattern expansion (youtube.com/*) chosen over programmatic scripting injection — simpler, no new permissions required"
  - "injectTFYStyles moved inside IIFE/nav handlers rather than staying at top-level — prevents ytd-reel-shelf-renderer:display:none from applying on YouTube homepage (out of scope per REQUIREMENTS.md)"
  - "initForVideo calls disconnectSidebarObserver() as first line — correct teardown point is the start of a new init, not just on explicit nav teardown"

patterns-established:
  - "Observer teardown pattern: cancel retry timer + disconnect observer as a single atomic operation in disconnectSidebarObserver"
  - "CSS injection scope pattern: style injection gated on watch-page paths to avoid unintended homepage side-effects"

requirements-completed: [SPAV-01, SPAV-02]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 6 Plan 01: SPA Navigation Fix Summary

**Manifest match expanded to youtube.com/* with timer-aware observer teardown, idempotent initForVideo, watch-page-only CSS injection, and dead code removal**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T15:19:05Z
- **Completed:** 2026-02-26T15:20:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Expanded content_scripts match from `youtube.com/watch*` to `youtube.com/*` — root-cause fix for SPAV-01 and SPAV-02; content script now present in all YouTube tabs including homepage navigation
- Added `sidebarObserverRetryTimer` variable and wired it through `observeSidebar` and `disconnectSidebarObserver` — prevents phantom retry callbacks after navigation teardown
- Made `initForVideo` idempotent by calling `disconnectSidebarObserver()` as its first line — rapid navigation can no longer accumulate duplicate observers
- Moved `injectTFYStyles()` from unconditional module top-level into watch-page-gated code paths (IIFE, YT_NAVIGATION handler, yt-navigate-finish handler) — Shorts CSS rule no longer fires on YouTube homepage
- Removed `fetchAndLogCategory` dead code function (28 lines, zero callers)

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand manifest match pattern to youtube.com/*** - `4c75c71` (feat)
2. **Task 2: Harden content-script.js — timer tracking, idempotent init, watch-page CSS guard, dead code removal** - `501675a` (feat)

**Plan metadata:** (docs commit — see final state update)

## Files Created/Modified
- `manifest.json` — content_scripts[0].matches[0] changed from `https://www.youtube.com/watch*` to `https://www.youtube.com/*`
- `content-script.js` — sidebarObserverRetryTimer added, disconnectSidebarObserver hardened, initForVideo made idempotent, injectTFYStyles gated to watch paths, fetchAndLogCategory removed

## Decisions Made
- Used declarative match pattern expansion (not programmatic scripting injection) — correct tool, no new permissions needed
- Moved `injectTFYStyles()` inside IIFE and nav handlers rather than removing it — maintains correct behavior on watch pages while preventing homepage CSS side-effects
- `initForVideo` calls `disconnectSidebarObserver()` as its first line rather than only in caller teardown — more robust; handles races where callers skip teardown

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SPAV-01 and SPAV-02 requirements are fulfilled by this plan
- Phase 7 (Tab Lifecycle Fix + Multi-Tab Storage Scoping) can now proceed — manifest match expansion is prerequisite for popup-to-content-script messaging used in that phase

---
*Phase: 06-spa-navigation-fix*
*Completed: 2026-02-26*
