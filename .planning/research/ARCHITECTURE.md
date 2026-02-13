# Architecture Research

**Domain:** YouTube-focused video research assistant
**Researched:** 2026-02-13
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Workspace Layer (Electron/Native)              │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Video Pane  │  │ Filter Panel │  │ Metadata    │  │ Controls &  │      │
│  │ (Player)    │  │ (Sensitivity)│  │ Preview     │  │ Notifications│     │
│  └────┬────────┘  └────┬─────────┘  └────┬───────┘  └────┬────────┘      │
│       │                 │                │                │              │
├───────┴─────────────────┴────────────────┴────────────────┴──────────────┤
│                            Orchestration Layer                            │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────────┐  ┌───────────────────────┐  │
│  │ YouTube Query  │  │ Similarity Engine   │  │ Settings + Session   │  │
│  │ Adapter        │  │ (Embeddings + ANN)  │  │ Manager               │  │
│  └────────┬───────┘  └────────────┬───────┘  └─────────────┬───────────┘  │
│           │                        │                        │              │
├───────────┴────────────────────────┴────────────────────────┴──────────────┤
│                               Data & Persistence Layer                        │
│  ┌────────────┐  ┌───────────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Metadata   │  │ Embedding Store   │  │ Cache Layer   │  │ Local Graph/ │ │
│  │ Cache      │  │ (Vector DB/FILE)  │  │ (ETag/GZip)   │  │ Session Log  │ │
│  └────────────┘  └───────────────────┘  └──────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Video Pane / Filter UI | Renders the current video, visualization of filtered related list, exposes sensitivity sliders | Electron/ Tauri UI consuming store events, uses native WebView for player or YouTube iframe API |
| YouTube Query Adapter | Constructs requests (videos, related/search) via YouTube Data API, handles auth, quota-friendly partial responses and ETags | Node/Python service with HTTP client, supports part/fields whitelisting per [YouTube Data API docs](https://developers.google.com/youtube/v3/getting-started) |
| Similarity Engine | Generates embeddings (SBERT, OpenAI or local LLM), indexes via local ANN search for similarity filtering, returns reranked list | Service that spawns embedding workers, stores vectors in Milvus/Chromadb/Pinecone-style store (local or hosted) |
| Settings & Session Manager | Persists workspace state, filter sensitivity, user preferences across restarts | JSON + file-based store or sqlite with sync to OS key-value store |
| Metadata Cache | Stores fetched video resources (snippet, stats) with per-resource TTL, supports fast lookups and dedup | LRU cache backed by sqlite or low-latency KV with ETag timestamps, gzipped payloads for bandwidth saving |
| Embedding Store | Maintains dense vectors for metadata chunks, supports ANN queries, similarity thresholds, and refresh pipelines | Lightweight vector DB (e.g., Chroma runtime, sqlite+FAISS, Milvus standalone) with batch upserts from metadata cache |

## Recommended Project Structure

```
src/
├── ui/                   # Renderer layer (Electron/Tauri/desktop) handling video canvas + filtering controls
│   ├── components/       # Filter panel, video pane, notifications, sensitivity controls
│   └── store/            # Local observable store (Zustand/Jotai/mobx) shared with backend
├── services/             # APIs and background tasks
│   ├── youtube/           # YouTube Data API adapter, quota tracker, auth helpers
│   ├── similarity/         # Embedding worker, ANN index management, batching logic
│   └── cache/              # Metadata cache, config persistence, ETag handler
├── core/                 # Shared types, feature flags, telemetry
└── scripts/               # Setup, tooling (e.g., env gen, local vector store bootstrapping)
```

### Structure Rationale

- **ui/**: Keeps UI-specific components decoupled from orchestration logic so filter adjustments are pure view/state sync.
- **services/**: Group all systems that touch external APIs (YouTube) or heavy computation (embeddings) so they can be parallelized/tested independently.
- **core/**: Centralizes domain types (VideoResource, FilterPolicy) and telemetry used across UI and services to prevent drift.

## Architectural Patterns

### Pattern 1: Partial Response + Cache-First API Proxy

**What:** Use the mandatory `part` and optional `fields` parameters to request only metadata needed for filtering; cache responses with ETags and gzip to stay within YouTube Data API quota constraints listed in the official overview.
**When to use:** Every metadata fetch from YouTube, since the Standard quota is 10K units/day and search/list calls cost 1-100 units [YouTube docs].
**Trade-offs:** Extra complexity in payload construction and cache invalidation, but reduces network and quota pressure.

**Example:**
```ts
const fields = `items(id,snippet(title,categoryId,description),statistics(viewCount))`;
await http.get('/videos', { params: { part: 'snippet,statistics', fields, id, key } });
// Cache ETag + payload for reuse; hit GET with If-None-Match to surface 304 responses.
```

### Pattern 2: Local Similarity Layer with Embedding + ANN

**What:** Extract text (title, description, auto-captions) from cached metadata, chunk it, produce embeddings via SBERT or OpenAI, and insert into a lightweight vector index; queries compute filter-sensitivity-modulated similarity scores before the UI renders candidates.
**When to use:** Once metadata cache populates related videos; necessary for filtering beyond exact YouTube relevancy.
**Trade-offs:** Requires local compute + storage but gives deterministic control over filtering; vector indexes can be kept small via TTL and chunk dedup.

**Example:**
```ts
const chunks = chunkText(video.snippet.description);
const vectors = await model.embed(chunks);
await annIndex.upsert(vectors.map((vec, idx) => ({ id: `${video.id}-${idx}`, values: vec, metadata: { videoId: video.id } })));
const neighbors = await annIndex.query({ vector: queryVec, topK: 20 });
```

## Data Flow

### Request Flow

```
[User selects video/filter]                                  
        ↓
[UI Controller] → [Filter Policy] → [Orchestration Engine]
                  ↓                ↓
       [YouTube Adapter] → [Metadata Cache/ETag] ← [Cache Layer]
                  ↓
           [Similarity Engine] → [Embedding Store / ANN]
                  ↓
           [Filtered candidates] ← [Vector Scores]
        ↓
[UI Renderer receives reranked related list]
```

### State Management

```
[Settings Store]
    ↓ (subscribe)
[UI Filter Panel] ←→ [Sync Actions] → [Background Services] → [Persistent Config]
```

### Key Data Flows
1. **Metadata ingestion:** Video ID → YouTube Data API (part/fields trimmed) → Metadata Cache → Background embedding/ANN upsert.
2. **Filter sensitivity loop:** UI slider → Filter Policy → Similarity Engine weighting → ANN query → UI rerender with scores.

## Build Order Implications

1. **Phase 1 – YouTube integration + metadata cache:** Implement API adapter, caching strategy (ETags, part/fields) and display of fetched related list. Without this, there's no data to filter.
2. **Phase 2 – Workspace UI + sensitivity controls:** Once metadata stabilizes, build connectors to show video details and allow users to adjust filter sensitivity; stub similarity responses initially.
3. **Phase 3 – Local similarity layer:** Add embedding pipeline, local vector store, ANN queries that feed the filter sensitivity loop; tune chunking, refresh, and TTLs.
4. **Phase 4 – Resilience & telemetry:** Harden quota handling (exponential backoff), persist workspace state, surface usage metrics for debugging.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Single process with local vector index, write operations limited to workspace actions, cache stored in sqlite/JSON. |
| 1k-100k users | Split background YouTube fetcher from UI (separate worker); deploy vector store on dedicated host or use managed service (Chroma, Milvus). Use shared cache with TTL invalidation. |
| 100k+ users | Rate-limit YouTube calls per user, shard vector index per user cohort, consider pre-embedding popular videos and replicating them across nodes. |

### Scaling Priorities

1. **First bottleneck:** YouTube quota – mitigate via caching, partial responses, shared proxy.
2. **Second bottleneck:** Embedding/ANN latency – move to async workers, batch uploads, or managed vector db with GPU/CPU autoscaling.

## Anti-Patterns

### Anti-Pattern 1: Treat every filter change as a fresh API call
**What:** UI adjusts sensitivity → new related list fetched from YouTube each time.
**Why it's wrong:** YouTube search/list hits consume quota, yield inconsistent relevance.
**Do this instead:** Cache results locally, rerank via similarity layer; only fetch new data when video changes or cache TTL expires.

### Anti-Pattern 2: Embedding each video request inline in UI thread
**What:** UI directly calls embedding model synchronously inside event handler.
**Why it's wrong:** Blocks renderer, fails to reuse embeddings.
**Do this instead:** Background worker/pipeline persists embeddings; UI subscribes to index refresh events.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| YouTube Data API v3 | REST via backend proxy / signed client, use OAuth2/API key, require part/fields, support ETags and gzip compression | Quota 10k/day (default); search cost 100 units → cache aggressively per [YouTube docs]. |
| Embedding runtime (local SBERT or external provider) | Async worker invoking local model or LLM API, output dense vector for ANN upsert | Keep chunk size bounded; reuse tokens when filter adjusts. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| UI ↔ Orchestration Engine | IPC/events (Electron IPC or Tauri invoke) | Avoid business logic in UI; orchestrator provides filtered list and metadata.
| YouTube Adapter ↔ Cache Layer | Direct function calls, returns cached payload with freshness info | Use ETAG and timestamps to skip repeated fetch.
| Similarity Engine ↔ Embedding Store | Queue/broker (e.g., BullMQ) or event -> worker | Embedding refresh triggered by metadata changes; ensures ANN index stays fresh.

## Sources

- [YouTube Data API v3 Getting Started](https://developers.google.com/youtube/v3/getting-started) (official doc describing resource parts, quota, ETags, partial responses).
- [Pinecone: Semantic Search primer](https://www.pinecone.io/learn/semantic-search/) (vector similarity flow: embeddings + ANN re-ranking, justification for local similarity layer). 

---
*Architecture research for: Focus Filter*  
*Researched: 2026-02-13*
