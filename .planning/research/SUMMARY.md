# Project Research Summary

**Project:** Focus Filter
**Domain:** Topic-filtered YouTube workspace
**Researched:** 2026-02-13
**Confidence:** MEDIUM

## Executive Summary

Focus Filter is a desktop research workspace that clears the noise from YouTube by pairing a lightweight Tauri shell with a Svelte/SvelteKit renderer. Experts build this kind of assistant by hosting the UI in a native webview, delegating YouTube Data API calls to hardened Rust services, and orchestrating embeddings/vector search outside the browser so we never exhaust the platform’s quotas or violate Google’s policies.

The recommended approach is to first lock down governance/compliance and the core metadata pipeline (partial responses, ETag caching, scoped OAuth) so every other feature has a reliable data source. With that in place the UI can focus on the dual-panel layout, blocklists, and sensitivity controls before rolling out the embedding-backed similarity layer, seeded topic queue, and eventual AI summaries.

Key risks are quota burnout, policy breaches, and accidentally misrepresenting YouTube results. Caching + partial requests with graceful degradation, a 30-day retention limit plus revocation handling, and surface-level attribution in the UI keep the workspace compliant while preserving the sidelined research flow.

## Key Findings

### Recommended Stack

The stack centers on Tauri 2.0 (Rust 1.93.1), Svelte 5.51.0/SvelteKit adapter-auto 7.0.1, and the YouTube Data API v3, which together keep the bundle small, the UI snappy, and the data contract compliant. Supporting libraries (tokio, reqwest, sentence-transformers, Qdrant, rusqlite) enable background fetching, OAuth-safe calls, local embeddings, vector search, and persisted state.

**Core technologies:**
- Tauri 2.0 + Rust 1.93.1: Native shell, OS integrations, secure IPC, and the minimal bundle size Focus Filter demands.
- Svelte 5.51.0 + SvelteKit adapter-auto 7.0.1: Component-driven UI, load/fetch hooks that bridge the renderer to YouTube metadata, and compatibility with the Tauri bundler.
- YouTube Data API v3: Canonical metadata surface and quota-safe enforcement of must-fetch fields to keep filtering honest and compliant.
- SentenceTransformers 5.2.2 + Qdrant 1.16.3: On-device embeddings and ANN that deliver sensitivity-aware reranking without pinging expensive LLM services.

See `.planning/research/STACK.md` for the full table of versions and alternatives.

### Expected Features

Table stakes include topic-aware filtering that hides unrelated results, a persistent blocklist with replacements, and the dual-panel workspace (current video + filtered related list). Differentiators layer in AI-assisted summaries, trend metrics and filter tuning, and a seeded topic context that remembers research runways. Future work defers AI summaries/audio playback, analytics-rich trend scoring, and saved/collaborative contexts until the crowd has validated the solo filtering flow.

**Must have (table stakes):**
- Topic-aware search filtering / DOM-level hiding
- Custom blocklist + replacements
- Dual-panel current video + curated related list

**Should have (competitive):**
- AI-assisted topic categorization & summaries
- Trend metrics + filter tuning (view/sub ratio, duration, freshness)
- Seeded topic contexts + sensitivity tuning

**Defer (v2+):**
- AI-powered summaries & audio playback
- Trend scoring + analytics layer
- Saved contexts + collaboration

Details and dependencies are in `.planning/research/FEATURES.md`.

### Architecture Approach

The architecture splits UI, orchestration, and persistence: Svelte/Tauri components render the video pane and control surface, orchestration services (query adapter, similarity engine, session manager) handle data and policy enforcement, and caches/vector stores persist metadata, embeddings, and filter preferences. Cache-first API proxies, background embedding workers, and vector indexes keep requests quota-safe while allowing UI responsiveness.

**Major components:**
1. Video Pane / Filter UI — renders the current video, filtered related list, and sensitivity controls inside the native window.
2. YouTube Query Adapter + Metadata Cache — issues partial responses, honors ETags, and feeds the workspace layer without re-fetching every filter change.
3. Similarity Engine + Embedding Store — chunks metadata, embeds it, and drives ANN queries for topic-sensitive reranking.

Architecture patterns and data flow diagrams live in `.planning/research/ARCHITECTURE.md`.

### Critical Pitfalls

Quota misuse, policy violations, and branding misrepresentation are the most dangerous traps. The research surfaces them as high-priority risks we must weave into every phase of planning.

1. **Quota burnout from naive YouTube Data API usage** — reuse ETags, request trimmed `part`/`fields`, cache results, and throttle/search only on meaningful navigation.
2. **Policy breaches by over-retaining or misrepresenting YouTube data** — publish a privacy policy, keep data no longer than 30 days, delete on revoke, and validate compliance before moving beyond metadata ingestion.
3. **Misrepresenting filtered results / branding (including Made for Kids handling)** — leave YouTube-provided text untouched, show attribution per branding guidelines, and disable tracking for Made for Kids content.

See `.planning/research/PITFALLS.md` for warning signs, gotchas, and recovery playbooks.

## Implications for Roadmap

Based on the combined research, the roadmap should progress from governance + data to UI, and finally to the similarity-driven differentiation.

### Phase 1: Governance & Core Data
**Rationale:** Compliance and quota-safe API access must be solved before the workspace displays anything; this layer also defines the cache-first data contract everyone else depends on.
**Delivers:** Privacy policy + revocation flow, scoped OAuth, YouTube Data API adapter with ETag/fields trimming, metadata cache, and the filtered result stream that the UI consumes.
**Addresses:** Table-stake filtering, blocklists, and dual-panel expectations (Topic-aware filter, Custom blocklist, Dual-panel view).
**Avoids:** Quota burnout (Pitfall 1) and data-retention violations (Pitfall 2).

### Phase 2: Workspace UI & Filtering Controls
**Rationale:** Once data is reliable, the renderer can safely show current video + filtered results, expose blocklist controls, and let users adjust sensitivity without hammering the API or turning off compliance features.
**Delivers:** Tauri/Svelte dual-panel UI, blocklist management, sensitivity slider, seeded queue stub, and action buttons that keep research manual.
**Addresses:** Table stakes plus the seeded context queue and sensitivity tuning that make the workspace feel like an anchored workflow.
**Uses:** Tauri 2.0 + Svelte 5.51.0/SvelteKit adapter-auto 7.0.1, Node.js 24.13.1, pnpm 10.29.3 (see `.planning/research/STACK.md`).
**Implements:** Video Pane/Filter UI, YouTube Query Adapter, Settings & Session Manager (per `.planning/research/ARCHITECTURE.md`).
**Avoids:** Treating every filter change as a new API call (Anti-pattern in architecture research).

### Phase 3: Similarity & Resilience
**Rationale:** Differentiators such as topic-aware similarity, sensitivity-based reranking, and future AI summaries require embeddings, vector search, and telemetry so we can trust the filtered list’s signal.
**Delivers:** SentenceTransformers 5.2.2 + Qdrant 1.16.3 embedding pipeline, localized vector store, ANN-based reranking, refresh/TTL policies, and telemetry/backoff for quota-pressure.
**Addresses:** Seeded topic contexts, filter sensitivity tuning, and the groundwork for AI summaries/trend scoring (v2+ items).
**Uses:** tokio + reqwest-powered Rust workers, sentence-transformers, Qdrant, rusqlite persistence.
**Implements:** Similarity Engine, Embedding Store, Metadata Cache updates, and session persistence tuning.
**Avoids:** Misrepresenting filtered results or stripping YouTube branding (Pitfall 3).

### Phase Ordering Rationale
- Compliance/quota infrastructure (Phase 1) feeds every subsequent component with governed metadata, so it must precede UI and similarity work.
- The UI/filter layer (Phase 2) needs stable data and cache hooks before introducing heavyweight embeddings, letting us test table stakes fast.
- Similarity + resilience (Phase 3) adds compute-heavy reranking only after the workspace can already display and control filtered lists, preventing early quota burnout.

### Research Flags

Phases likely needing deeper research:
- **Phase 1:** Quota simulations, privacy language, and token revocation workflows need dedicated `/gsd-research-phase` slices to validate limits and policy text.
- **Phase 3:** Embedding chunking thresholds, vector store sizing, and sensitivity weighting strategies require experimentation to avoid performance traps.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Tauri + Svelte renderer with IPC-bound filter controls already maps to documented patterns; existing UI architectures in the research docs provide actionable references.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Versions sourced from official Tauri/Svelte docs and medium-confidence library releases. |
| Features | MEDIUM | Based on multiple community README analyses with consistent expectations. |
| Architecture | MEDIUM | Draws on standard cache-first, similarity-driven patterns recommended in the architecture research. |
| Pitfalls | MEDIUM | Derived from YouTube’s official quotas and developer policies. |

**Overall confidence:** MEDIUM

### Gaps to Address
- Quota modeling gap: run realistic YouTube Data API workloads before Phase 2 to confirm caching/backoff thresholds.
- Seeded topic queue behavior: validate how pasted seed videos map to filtered lists and how users understand sensitivity sliders before Phase 3.
- Offline embedding viability: ensure the sentence-transformers + Qdrant stack runs acceptably on target desktop hardware; if not, plan a hybrid cloud fallback.

## Sources

### Primary (HIGH confidence)
- https://developers.google.com/youtube/v3/docs/videos/list — Quota costs, partial responses, and ETag guidance (Stack + Architecture findings).
- https://developers.google.com/youtube/terms/developer-policies — Data retention, branding, and revocation rules (Pitfalls findings).
- https://github.com/huggingface/sentence-transformers/releases/tag/v5.2.2 — Embedding/model release used for the local similarity engine (Stack finding, rated HIGH).

### Secondary (MEDIUM confidence)
- https://tauri.app/ — Tauri 2.0 bundle/security rationale and OS integrations (Stack research).
- https://github.com/sveltejs/svelte/releases/tag/svelte%405.51.0 — Verified Svelte 5 features needed for UI (Stack research).
- https://github.com/qdrant/qdrant/releases/tag/v1.16.3 — Vector store release that matches qdrant-client 1.16.2 (Stack research).

### Tertiary (LOW confidence)
- https://raw.githubusercontent.com/Vaishnavigade88/youtube-topic-filter-chrome-extension/main/README.md — DOM-filtering expectation (Feature research).
- https://raw.githubusercontent.com/skyturkish/youtube-video-filter/main/README.md — Blocklist/replacement behavior inspiration (Feature research).
- https://raw.githubusercontent.com/mohammedali2005/youtube/main/README.md — AI-assisted summarization intent (Feature research).

---
*Research completed: 2026-02-13*
*Ready for roadmap: yes*
