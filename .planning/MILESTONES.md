# Milestones

## v1.3 Bug Fixes (Shipped: 2026-02-26)

**Phases:** 6-7 (2 phases, 4 plans)
**Requirements:** SPAV-01, SPAV-02, TABST-01, TABST-02, TABST-03 — all complete
**Timeline:** 2026-02-26 (1 day)

**Key accomplishments:**
- Expanded `content_scripts` match to `youtube.com/*` — filtering now activates from the YouTube homepage without requiring a full page reload (SPAV-01)
- Idempotent `initForVideo` with timer-aware observer teardown — prevents duplicate observers on rapid SPA navigation (SPAV-02)
- Per-tab storage key `currentVideoCategory_${tabId}` replaces shared global key — popup clears correctly when YouTube tab is closed (TABST-01)
- Popup reads active tab's scoped storage key — shows correct category when multiple YouTube tabs are open simultaneously (TABST-02)
- Content script delegates category writes to service worker via `SET_VIDEO_CATEGORY` / `CLEAR_VIDEO_CATEGORY` messages — authoritative `sender.tab.id` prevents non-YouTube tab closes from affecting YouTube state (TABST-03)

**Archive:** `.planning/milestones/v1.3-ROADMAP.md`, `.planning/milestones/v1.3-REQUIREMENTS.md`

---

