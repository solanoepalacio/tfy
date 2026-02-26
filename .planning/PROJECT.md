# TFY — Topic Focused YouTube

## What This Is

A personal-use Chrome browser extension that filters YouTube's sidebar suggestions to only show videos related to the topic you're currently watching. When you're deep in a computer science rabbit hole, you won't see cooking or gaming videos pulling your attention away. Off-topic suggestions are collapsed with a small label, not removed — so you can expand them if you choose. Built entirely by AI agents (GSD + Claude) as an agentic engineering POC.

## Core Value

When watching a YouTube video, the sidebar suggestions stay on-topic with what you're currently watching — eliminating cross-interest distraction during focused research sessions.

## Requirements

### Validated

- ✓ Detect the category of the currently playing YouTube video via YouTube Data API v3 — v1.0
- ✓ Filter sidebar suggestions by comparing their category to the current video's category — v1.0
- ✓ Collapse off-topic suggestions with a small "hidden: off-topic" label — v1.0
- ✓ Provide a popup with a toggle to turn filtering on/off — v1.0
- ✓ Store and use a personal YouTube Data API v3 key — v1.0
- ✓ Hidden sidebar items display the video's title and category on the collapsed label — v1.1
- ✓ Shorts shelf panel is hidden on YouTube watch pages — v1.1
- ✓ README.md documents motivation, agentic POC origin, prerequisites, install, setup, and usage — v1.2
- ✓ Filtering activates automatically on YouTube SPA navigation without requiring a page reload — v1.3
- ✓ Popup clears category state when the associated video tab is closed — v1.3
- ✓ Popup shows correct category for the currently active YouTube tab when multiple tabs are open — v1.3

### Active

(No active requirements — v1.3 milestone complete. Define requirements for next milestone via `/gsd:new-milestone`.)

### Out of Scope

- Manual topic input — the extension infers topic from the current video, no manual override needed for POC
- Keyword/semantic similarity matching — category-based matching is sufficient for POC, can refine later
- Publishing to Chrome Web Store — personal developer mode only
- Cross-browser support — Chrome only
- Usage analytics or suggestion counts — not needed; the filtered sidebar speaks for itself
- In-memory tab registry with session storage mirror (HARD-01) — correctness not required for normal use, deferred to future
- Orphaned per-tab storage key cleanup on startup (HARD-02) — covered by one-time migration in v1.3; full sweep deferred

## Context

- YouTube organizes videos into categories (e.g., "Science & Technology", "Education", "Howto & Style") accessible via the YouTube Data API v3
- The suggestion sidebar is the primary source of distraction — YouTube's algorithm surfaces genuinely interesting content from other interest areas
- The user researches many different topics across sessions (CS, cooking, etc.) and wants topic isolation per session
- The YouTube Data API v3 requires a Google Cloud project API key — the user already has one
- Developer mode installation means no Chrome Web Store constraints (manifest v3 still required for modern Chrome)
- Shipped v1.3 with ~490 LOC across manifest.json, service-worker.js, content-script.js, popup.js, popup.html
- Tech stack: Chrome Manifest V3, vanilla JS content script, service worker, YouTube Data API v3

## Constraints

- **Platform**: Chrome browser only — developer mode sideloading
- **API**: YouTube Data API v3 — personal API key, subject to quota limits (10,000 units/day default)
- **Manifest**: Chrome Manifest v3 — required for current Chrome versions
- **Scope**: POC — category-level matching, not keyword/semantic analysis

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Category-based matching over keyword similarity | Simpler for POC, YouTube categories are well-defined | ✓ Good — works correctly, no false positives |
| Collapse off-topic vs hide completely | User wants awareness of hidden content with option to expand | ✓ Good — CSS collapse preserves DOM, label gives context |
| Infer topic from current video vs manual input | Reduces friction — no setup per session needed | ✓ Good — zero-config UX |
| Personal API key stored in extension | Developer-only use, no need for OAuth or key management UI | ✓ Good — simple and sufficient for POC |
| Declarative match pattern expansion (youtube.com/*) over programmatic scripting injection | No new permissions required, simpler SPA fix | ✓ Good — eliminated SPAV-01/02 root cause cleanly |
| Delegate category writes from content script to service worker | Service worker has authoritative sender.tab.id | ✓ Good — correct tab ID without content-script workarounds |
| Per-tab storage key `currentVideoCategory_${tabId}` over shared global key | Single shared key was root cause of TABST-01/02/03 | ✓ Good — fixed all three TABST bugs at root cause |
| `chrome.tabs.onRemoved` registered at top level in service worker | MV3 service workers only re-register top-level synchronous listeners on restart | ✓ Good — correct MV3 pattern, survives worker restart |

---
*Last updated: 2026-02-26 after v1.3 milestone*
