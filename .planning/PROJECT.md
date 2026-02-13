# Focus Filter

## What This Is

Focus Filter is a standalone research-mode workspace for YouTube that lets you paste the first video you want to study and then surfaces a filtered related list that stays within the same topic family. It keeps the current video and the filtered list visible in one view, gives you controls to queue a new topic, and lets you dial the sensitivity of the topic similarity without touching your browser.

## Core Value

While researching, you only ever see related videos that match the topic you chose, so nothing pulls you away mid-session.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **REQ-01:** User can paste the first YouTube video link for a research session and the app loads metadata/related candidates through the YouTube Data API.
- [ ] **REQ-02:** The UI shows the selected video plus a filtered related list limited to the same broad topic family (e.g., CS vs cooking) using an initial content-similarity model.
- [ ] **REQ-03:** The interface allows queuing a new topic focus and adjusting filtering sensitivity without modifying the browser or embedding playback controls.

### Out of Scope

- Browser extensions or other modifications to the existing YouTube tab — the experience runs externally.
- Playback control or embedding video playback — Focus Filter only shows the primary video and the filtered related list.
- Fine-grained topic differentiation (prompt engineering vs agent training) for v1 — keep the scope broad.

## Context

- Desktop browser research sessions where the user often gets distracted by unrelated recommendations.
- Filtering uses a standalone app that fetches metadata through the YouTube Data API rather than scraping the browser DOM.
- The user wants a “special interface” visible alongside the video and the curated related list, keeping the browser untouched.

## Constraints

- **Technical:** No browser modifications (no extensions or injected scripts).
- **Platform:** Runs locally as a standalone desktop app paired with a YouTube tab.
- **Scope:** Broad topic matching only for v1 to keep filtering heuristics simple.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone desktop app instead of browser extension | Keeps browser untouched while still allowing research-controlled filtering | — Pending |
| Use YouTube Data API for metadata instead of scraping the DOM | Reliable access to related video lists without browser hooks | — Pending |
| Start with broad topic families (CS vs cooking) | Stabilizes filtering UX before exploring fine-grained topic distinctions | — Pending |

---
*Last updated: 2026-02-13 after initialization*
