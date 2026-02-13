# Stack Research

**Domain:** Topic-filtered YouTube workspace (Focus Filter)
**Researched:** 2026-02-13
**Confidence:** MEDIUM

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Tauri (Rust + native webview) | 2.0 (Rust 1.93.1) | Provide the shell that hosts the Svelte UI, manages OS integrations (tray, clipboard), and keeps the package small. | Tauri 2.0 advertises <600 KB Linux/macOS bundles by shipping only metadata and relying on the OS web renderer; pairing it with the current Rust 1.93 toolchain keeps the glue code safe, performant, and compatible with Tauri’s security model for desktop apps that live outside the browser. | MEDIUM |
| Svelte 5.51.0 + SvelteKit (@sveltejs/adapter-auto 7.0.1 / v2) | Svelte 5.51.0 &amp; adapter-auto 7.0.1 | Drive the interactive UI, route between “current video” and “topic context” panels, and synthesize server loads for Tauri’s preload scripts. | Svelte 5 compiles features into vanilla JS, trimming runtime overhead, while SvelteKit v2 plus the adapter-auto plugin keep the frontend in sync with Tauri’s bundler and provide fetch/load hooks for calling the YouTube Data API. | MEDIUM |
| YouTube Data API | v3 | Fetch video metadata, related-video lists, channel/topic details, and apply topic-based filters server-side. | The v3 documentation is the canonical surface for metadata and related results, and the API terms (YouTube API Services Terms of Service) require every client to go through this service rather than scraping; using it keeps Focus Filter compliant with Google’s quotas while giving access to the topicDetails field we need. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| tokio | 1.49.0 | Async runtime for parallel YouTube API requests, vector-store lookups, and background topic-queue processing inside the Rust/tauri backend. | Always — enables non-blocking fetching, rate-limiting, and scheduling of sensitivity-adjusted similarity reruns. | MEDIUM |
| reqwest | 0.13.1 | TLS-enabled HTTP client to call https://www.googleapis.com/youtube/v3/{videos,search} and pull metadata for new topic contexts. | For every network fetch with OAuth bearer tokens, especially when we batch related-video metadata or queue background refreshes. | MEDIUM |
| rusqlite | 0.38.0 | Persist queued topic contexts, sensitivity settings, and YouTube video IDs locally for offline research sessions. | Use when a new context is queued or sensitivity knobs are adjusted so the workspace can recover state between launches. | MEDIUM |
| oauth2 | 5.0.0 | Handle the Google OAuth 2.0 flow inside the Rust backend so Tauri-hosted UI can request temporary credentials without embedding secrets. | When calling any API endpoint that requires an OAuth access token beyond the simple API key (e.g., retrieving private playlists or higher quota). | MEDIUM |
| sentence-transformers | 5.2.2 | Generate 768/1536-dimensional embeddings for the current video metadata + descriptions so we can compute cosine similarity to related candidates. | Run after fetching metadata to score topic affinity; 5.2.2 upgrades to HuggingFace Transformers v5 and has on-device inference optimizations for CPU-bound desktops. | HIGH |
| Qdrant vector database | 1.16.3 (+ qdrant-client 1.16.2) | Store the embedding index and efficiently query nearest neighbors for topic filtering and sensitivity thresholds. | Use for every similarity search, whether on the desktop (Edge mode) or via a small cloud instance; qdrant-client keeps Python or Rust code in sync with the latest wire format. | MEDIUM |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js | 24.13.1 (LTS) | Compile Svelte/SvelteKit, run Vite dev server, and power the Tauri frontend packaging. | LTS ensures compatibility with @tauri-apps/cli@2+ and the npm/pnpm ecosystems that ship the web assets. |
| pnpm | 10.29.3 | Deterministic, hybrid-lock installs for the workspace (frontend + Tauri). | pnpm’s strict node_modules layout pairs well with Tauri’s bundler and keeps dependency storage minimal; the latest patch release fixes `pnpm list` OOMs on deep trees. |
| Cargo (via Rust 1.93.1) | Build the Tauri backend, run `tauri dev`, and package release binaries. | Bundled with Rust 1.93.1 so compile targets align with nightly features used by Tauri 2.0 (e.g., `tauri::api::path`). |

## Installation

```bash
# Core initialization
npm create tauri-app@latest focus-filter -- --template vanilla
cd focus-filter
pnpm install
pnpm add -D @tauri-apps/cli@2.0.0
pnpm add svelte@5.51.0 @sveltejs/kit@2.0.0 @sveltejs/adapter-auto@7.0.1

# Python tooling for embeddings + vector search
pip install "sentence-transformers==5.2.2" "qdrant-client==1.16.2"
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Tauri + Svelte | Electron + React/Vite | Opt for Electron only if you already depend heavily on native Node APIs/plugins that Tauri cannot mirror; otherwise the Electron runtime (full Chromium + Node runtime) forces you to ship a 40+ MB base and loses the native-webview security stance that Focus Filter needs (Tauri’s docs emphasize the 600 KB minimum bundle). |
| SentenceTransformers + Qdrant | OpenAI embeddings + managed vector DB | Choose a hosted embedding/vector service when you need multi-region consistency or GPU inference you can’t run locally; for a research-mode desktop where privacy and offline control matter, the open-source stack keeps data on-device and reduces recurring API spend. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Electron packaging with bundled Chromium | Electron requires shipping its entire `electron` binary tree (per Electron packaging docs), which bloats Focus Filter and contradicts the “portable research workspace” requirement. | Tauri 2.0 relies on the OS webview and keeps payload small. |
| Scraping YouTube web pages | The YouTube API Services Terms of Service explicitly require API access and prohibit scraping or re-embedding content without attribution; non-compliance risks quota removal. | Always call the YouTube Data API v3 with client credentials. |
| Heavy LLM + retrieval chains for every UI update | Calling GPT-style models per filter is slow/expensive and unnecessary for a metadata-only topic filter. | Embed metadata locally via sentence-transformers and filter via Qdrant. |

## Stack Patterns by Variant

**If the workspace must stay offline (air-gapped research mode):**
- Use SentenceTransformers 5.2.2 inside the desktop app to generate embeddings at launch.
- Run Qdrant Edge (beta) as an in-process vector store (no background service) and optionally sync snapshots to Qdrant Cloud when connectivity returns (per Qdrant Edge docs).
**If the workspace can reach the network:**
- Host Qdrant 1.16.3 on a small cloud or use Qdrant Cloud but keep metadata in rusqlite for fast context switching.
- Refresh embeddings via CPU-backed SentenceTransformers or offload to a GPU-backed API (e.g., OpenAI embeddings) only for particularly heavy topic sweeps.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Svelte 5.51.0 | @sveltejs/kit v2 / adapter-auto 7.0.1 | SvelteKit v2 compiles against Svelte 5, so updating both simultaneously avoids mismatched compiler/runtime behavior. |
| Rust 1.93.1 | Tauri 2.0 | Tauri’s prerelease relies on Rust 1.93 toolchain features; the `tauri-apps/cli@2` release targets the same version. |
| SentenceTransformers 5.2.2 | Transformers v5 / qdrant-client 1.16.2 | The release explicitly bumps transformers to v5 and drops mandatory `requests`, making it compatible with the latest qdrant-client’s async API. |
| Qdrant 1.16.3 | qdrant-client 1.16.2 | Matching release numbers ensure the gRPC/protobuf contract stays aligned when storing embeddings locally. |

## Sources

- https://tauri.app/ — Tauri 2.0 landing page describing the minimal bundle size and security-first desktop model. (Confidence: MEDIUM)
- https://github.com/sveltejs/svelte/releases/tag/svelte%405.51.0 — Official Svelte 5.51.0 release notes. (Confidence: MEDIUM)
- https://github.com/sveltejs/kit/releases/tag/@sveltejs/adapter-auto@7.0.1 — Latest SvelteKit adapter release, documenting the v2 ecosystem. (Confidence: MEDIUM)
- https://developers.google.com/youtube/v3/docs/videos/list — YouTube Data API v3 reference for metadata/related results (last updated 2025-08-28). (Confidence: HIGH)
- https://developers.google.com/youtube/terms/api-services-terms-of-service — YouTube API Services Terms of Service (2025) mandates official API usage and compliance. (Confidence: HIGH)
- https://www.rust-lang.org/ — Rust 1.93.1 stable release page. (Confidence: MEDIUM)
- https://nodejs.org/en/ — Node.js 24.13.1 LTS listing. (Confidence: MEDIUM)
- https://github.com/pnpm/pnpm/releases/tag/v10.29.3 — pnpm 10.29.3 release notes. (Confidence: MEDIUM)
- https://github.com/seanmonstar/reqwest/releases/tag/v0.13.1 — Reqwest 0.13.1 release. (Confidence: MEDIUM)
- https://github.com/tokio-rs/tokio/releases/tag/tokio-1.49.0 — Tokio 1.49.0 release. (Confidence: MEDIUM)
- https://github.com/rusqlite/rusqlite/releases/tag/v0.38.0 — Rusqlite 0.38.0 release. (Confidence: MEDIUM)
- https://github.com/ramosbugs/oauth2-rs/releases/tag/5.0.0 — oauth2 5.0.0 release outlining Reqwest/HTTP client updates. (Confidence: MEDIUM)
- https://github.com/huggingface/sentence-transformers/releases/tag/v5.2.2 — SentenceTransformers 5.2.2 release (Transformers v5 support). (Confidence: HIGH)
- https://github.com/qdrant/qdrant/releases/tag/v1.16.3 — Qdrant 1.16.3 release notes. (Confidence: MEDIUM)
- https://github.com/qdrant/qdrant-client/releases/tag/v1.16.2 — Qdrant client 1.16.2 release. (Confidence: MEDIUM)
- https://qdrant.tech/edge — Qdrant Edge description for embedded, offline-friendly vector search. (Confidence: MEDIUM)
- https://www.electronjs.org/docs/latest/tutorial/application-packaging — Electron packaging doc showing the need to ship the entire runtime, motivating Tauri instead. (Confidence: MEDIUM)
- https://platform.openai.com/docs/guides/embeddings — OpenAI embeddings guide, used to justify SaaS alternative for large-scale similarity if needed. (Confidence: MEDIUM)
