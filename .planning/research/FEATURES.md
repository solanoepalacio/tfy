# Feature Research

**Domain:** Topic-filtered YouTube research workspace (Focus Filter)
**Researched:** 2026-02-13
**Confidence:** MEDIUM (based on live tool READMEs that confirm existing expectations)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Topic-aware search filtering / DOM-level hiding | Every topic-filtered helper must make YouTube’s search results stop surfacing unrelated rabbit holes; Vaishnavigade88’s Chrome extension explicitly filters search results via MutationObserver when you type a query, proving users expect this behavior | MEDIUM | Source: https://raw.githubusercontent.com/Vaishnavigade88/youtube-topic-filter-chrome-extension/main/README.md; this strategy avoids extra permissions or overlays by operating inside YouTube’s DOM while still hiding off-topic cards. |
| Custom blocklist + replacements | Researchers need to proactively block known distractors and surface usable alternatives; skyturkish’s extension lets you blacklist topics/keywords and swap in preferred content, so the expectation is to keep a user-editable blocklist with graceful fallback | MEDIUM | Source: https://raw.githubusercontent.com/skyturkish/youtube-video-filter/main/README.md; this inspires Focus Filter’s non-invasive, preference-driven filtering layer. |
| Dual-panel current video + curated related list | Focus Filter’s own brief (keep the current video and a filtered related list visible at the same time) describes the minimum workspace layout required to stay focused; missing it means the app reverts back to the noise-filled YouTube experience | LOW | Driven by project context; this layout anchors the researcher and makes filtered candidates immediately actionable. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI-assisted topic categorization & summaries | mohammedali2005’s channel summarizer derives topic labels and ChatGPT-powered summaries per video, which suggests that bundling filtering with summaries/audio playback surfaces what matters without rerunning the video | HIGH | Source: https://raw.githubusercontent.com/mohammedali2005/youtube/main/README.md; combining filtering with summaries shrinks cognitive load for research. |
| Trend metrics + filter tuning (view/subscriber ratio, duration, freshness) | uxama-ch’s Viral Topic Finder lets creators sort by view-to-subscriber ratio, duration, and recency—demonstrating that scoring filtered results by normalized interest boosts signal quality beyond raw relevance | MEDIUM | Source: https://raw.githubusercontent.com/uxama-ch/YouTube-Viral-Topic-Finder/main/README.md; layering analytics lets Focus Filter spotlight promising leads instead of just matching keywords. |
| Seeded topic contexts + sensitivity tuning | Focus Filter’s spec (paste the first video link to queue a context, adjust filtering sensitivity, and never mutate the browser) means we can offer a guided topic queue instead of starting from scratch each time | MEDIUM | Built-in requirement; this differentiator is what moves the app from another filter to a “research workspace” that remembers contexts. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Requesting extra permissions / overlay injection | “Make the filter a full-screen overlay” or “inject UI controls everywhere” seems helpful for control | Vaishnavigade88’s README touts being light and relying on MutationObserver precisely to avoid extra permissions; adding overlays increases maintenance, triggers permission prompts, and violates the “never modifies the browser” promise | Stick to DOM-level hiding and small, detachable controls as Focus Filter already intends; let user stay inside YouTube without big chrome changes. |
| Auto-clicking/auto-skipping videos | “Automatically skip to next relevant video” sounds efficient | Auto actions modify browser state and can break when YouTube’s DOM changes; the project vision explicitly forbids modifying the browser | Keep interactions manual or limited to UI you control (e.g., queue management) and avoid scripted navigation. |
| Overly strict filter combinations | Users like stacking filters (min views + min duration + low subs) to “guarantee” relevance | uxama-ch warns that applying too many strict filters can narrow results to zero and degrade discovery | Apply filters sequentially and surface warnings when the result set shrinks too much; provide quick toggles to loosen constraints. |

## Feature Dependencies

```
[Seeded topic context queue]
    └──requires──> [Topic filter engine]
                       └──requires──> [YouTube search metadata & query parser]

[AI summaries & audio playback]
    └──enhances──> [Filtered candidate list clarity]

[Overly strict filter combinations]
    ──conflicts──> [Noise reduction (table stake filtering)]
```

### Dependency Notes

- **Seeded topic context queue requires topic filter engine:** You must parse the initial video link or embedded query before you can keep queuing related items (project context + Vaishnavigade88 approach). Without the engine, you can’t enforce the topic-focused view.
- **AI summaries depend on transcripts/API:** The channel summarizer uses YouTube’s transcript data plus ChatGPT; the same pipeline powers faster judgments about relevance once filters narrow the list.
- **Strict filter stacks conflict with noise reduction:** When you stack duration, ratio, min views, and max subs (see uxama-ch’s recommendations), the filter set can yield nothing; expose loosen controls before it starves the workspace.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [x] Topic-aware search filtering that hides unrelated videos — without this the workspace is no different than YouTube.
- [x] Persistent topic/keyword blocklist with fallback replacements — blocking distractors is part of the core value proposition.
- [x] Dual-panel current video + curated related list — keeps context visible and actionable.

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] Seeded topic context queue (paste first video to start a topic runway) — improves speed for repeated research threads.
- [ ] Adjustable filter sensitivity slider — lets power users loosen/tighten the filter based on signal strength.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] AI-powered summaries & audio playback of filtered videos — high leverage for research but requires API orchestration.
- [ ] Trend scoring (view/sub ratio, recency, duration sorting) — analytics layer that can wait until filtering workflows stabilise.
- [ ] Saved contexts + collaboration — reuse topic queues across sessions or teammates once the solo flow proves valuable.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Topic-aware filter + blocklist | HIGH | MEDIUM | P1 |
| Dual-panel context view | HIGH | LOW | P1 |
| Seeded topic queue | MEDIUM | MEDIUM | P2 |
| Filter sensitivity tuning | MEDIUM | MEDIUM | P2 |
| AI summaries/audio playback | HIGH | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible after validation
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Vaishnavigade88 Extension | Skyturkish Filter | Viral Topic Finder | Our Approach |
|---------|---------------------|------------------|------------------|-------------|
| Topic-driven search filtering | ✅ hides unrelated results via MutationObserver (table stake) | ⛔ focuses on keyword blacklist rather than query sensitivity | ❌ tool starts from keyword lists, not live YouTube results | ✅ combines both query-aware filtering and blocklist to keep research space clean |
| Blocklist + replacements | ❌ no persistent list beyond query | ✅ lets you block topics/keywords and swap in preferred videos | ⚠️ filters are analytics-only; no blocking of entire topics | ✅ blocklist plus fallback ensures you never accidentally drift back to distractors |
| Trend/rating analytics | ❌ | ❌ | ✅ view-to-subscriber ratio + duration filters to surface promising leads | ✅ plan to expose scored filters once table stakes are reliable |
| AI summarization / audio | ❌ | ❌ | ❌ | ✅ future roadmap adds summaries/audio to reduce rewatching workloads |

## Sources

- https://raw.githubusercontent.com/Vaishnavigade88/youtube-topic-filter-chrome-extension/main/README.md
- https://raw.githubusercontent.com/skyturkish/youtube-video-filter/main/README.md
- https://raw.githubusercontent.com/mohammedali2005/youtube/main/README.md
- https://raw.githubusercontent.com/uxama-ch/YouTube-Viral-Topic-Finder/main/README.md

---
*Feature research for: topic-filtered YouTube workspace*
*Researched: 2026-02-13*
