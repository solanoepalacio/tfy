# Requirements: Focus Filter

**Defined:** 2026-02-13
**Core Value:** Prevent distraction by keeping only topic-aligned related videos in view while researching YouTube content.

## v1 Requirements

### Filtering

- [ ] **FILTER-01**: Filter the related-video list so only items whose topic similarity matches the chosen session topic family remain visible instead of the full YouTube feed.
- [ ] **FILTER-02**: Let the user maintain a blocklist of distracting topics/keywords and offer retry suggestions when a blocked video would otherwise appear.

### Workspace

- [ ] **UI-01**: Display the current YouTube video metadata (feed the user’s pasted URL) and the filtered related list together in a dual-panel workspace so the researcher never loses context.
- [ ] **UI-02**: Provide a slider or control that adjusts filtering sensitivity (strict vs. broad topic match) with immediate feedback on the filtered list.

### Context Management

- [ ] **CTX-01**: Start each session by pasting the first video link, capture its topic metadata, and let the user queue new topic contexts that update the filter framing without touching the browser tab.

### Data & Persistence

- [ ] **DATA-01**: Integrate with the YouTube Data API v3 using scoped OAuth/API keys, partial `part`/`fields`, ETag caching, and local persistence so metadata/related candidates stay quota-friendly.

### Compliance & Boundaries

- [ ] **COMP-01**: Run as a standalone app that never modifies the YouTube page, persists YouTube data for no more than 30 days with revocation support, and surfaces required branding/attribution in the filtered list.

## v2 Requirements

### Differentiation

- **DIFF-01**: Seeded topic contexts, AI summaries, or analytics (view/subscriber ratios, recency, duration) that help researchers quickly surface high-signal videos.
- **DIFF-02**: Saved collaborative contexts so multiple sessions or teammates can reuse research runways once the solo workflow stabilizes.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Browser extensions or DOM injections | Focus Filter must stay external to the browser (no additional permissions or overlays). |
| Embedded playback controls (auto advancing/skipping) | Playback stays in YouTube; the app only surfaces filtered candidates. |
| Fine-grained topic taxonomy for v1 | Keep the initial scope broad (CS vs. cooking) to prove the concept before investing in narrow distinctions. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILTER-01 | TBD | Pending |
| FILTER-02 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| CTX-01 | TBD | Pending |
| DATA-01 | TBD | Pending |
| COMP-01 | TBD | Pending |
| DIFF-01 | TBD | Pending |
| DIFF-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 0 (updated by roadmap)
- Unmapped: 7 ⚠️

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after initial definition*
