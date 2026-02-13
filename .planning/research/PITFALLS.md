# Pitfalls Research

**Domain:** Topic-filtered YouTube workspace (Focus Filter desktop)
**Researched:** 2026-02-13
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: Quota burnout from naive YouTube Data API usage

**What goes wrong:**
Every request to the YouTube Data API consumes quota units (10,000 units/day by default), and search/list operations can cost up to 100 units each. A naive workspace that re-fetches related videos on every navigation or search quickly exhausts that daily allotment and returns `quotaExceeded`/403 errors, bringing the filtered list to a halt.

**Why it happens:**
It is tempting to refresh the related list on every video change and to request the full set of metadata (all `part` segments) for every item. Each of those calls multiplies the quota footprint because the API charges more for `search`/`related` endpoints than for simple `videos.list` calls, and you lose the benefits of caching or partial responses.

**How to avoid:**
Design the integration layer during Phase 2 (Core API & Data) to reuse ETags, request `part`/`fields` selectively, cache results for the current workspace session, and preemptively degrade to previously cached related lists when the console reports quota stress. Push most heavy processing (topic similarity, filtering) to pre-computed batches so you’re not issuing dozens of `search` requests per minute.

**Warning signs:**
- Console shows sustained `quotaExceeded` responses or abrupt 403s
- Daily quota usage meter spikes whenever a new video loads
- Logs show repeated identical requests instead of cache hits

**Phase to address:**
Phase 2 (Core API & Data infrastructure)

Source: YouTube Data API Overview (https://developers.google.com/youtube/v3/getting-started, last updated 2026-02-12 UTC) outlines the quota system and the high cost of search requests.

---

### Pitfall 2: Policy breaches by over-retaining or misrepresenting YouTube data

**What goes wrong:**
To build a high-quality topic similarity engine, teams often retain every user preference and every related-list snapshot. That retention quickly violates the policy that prohibits storing non-authorized YouTube data for more than 30 calendar days, and it also ignores requirements for clear privacy policies, consent disclosures, and revocation handling.

**Why it happens:**
Filtering and personalization feel more reliable when every past video is cached, but Google’s policies actively forbid indefinite storage or unauthorized aggregation of API data. Likewise, a rushed launch can miss the mandate to provide a prominently accessible privacy policy that explains how YouTube data is used and how consent can be revoked.

**How to avoid:**
Phase 1 (Governance & Compliance) needs to lock down the legal/operational rules: publish a privacy policy that cites YouTube’s Terms and Google Privacy Policy, limit cached non-authorized data to 30-day snapshots (and refresh or delete afterward), delete data within seven days of user revocation, and regularly verify Made for Kids status before displaying a video so that tracking/data collection is disabled for those assets.

**Warning signs:**
- Privacy policy missing or out of sync with actual data handling
- Revoked tokens still being used (client API calls still succeed)
- Logs show data older than 30 days or aggregated mixes of unrelated channels

**Phase to address:**
Phase 1 (Governance & Compliance)

Source: YouTube API Services Developer Policies (https://developers.google.com/youtube/terms/developer-policies, sections III.A & III.E, last updated 2025-08-28 UTC) describe the privacy policy, data retention, revocation, and Made for Kids obligations.

---

### Pitfall 3: Misrepresenting filtered results and breaking branding/compliance

**What goes wrong:**
Focusing on a curated related list can tempt teams to rewrite titles, mix other video sources, or hide YouTube attribution, which violates the policy that prohibits modifying search results or obscuring YouTube branding and attribution for embedded content. Worse, if the workspace suppresses YouTube’s required notices (e.g., for Made for Kids videos), you may trigger audits or removal of API access.

**Why it happens:**
Creating a seamless workspace often means layering your own UI on top of YouTube data; without discipline, it’s easy to truncate titles, insert your own metadata columns, or fail to show the “YouTube” badge on each result. Mixing in other sources without clear labeling amplifies the risk.

**How to avoid:**
During Phase 3 (Experience & Safety) ensure every YouTube video entry is labeled as coming from YouTube, keep the API-provided text untouched (no rewriting or mixing with third-party results), and display YouTube Brand Features per the branding guidelines. For Made for Kids content, disable tracking and data collection as required instead of forcing the same experience as general videos.

**Warning signs:**
- Screens missing “YouTube” attribution near each video
- Related list includes mixed sources labeled as “YouTube”
- Compliance audits or warnings mention modified search results or branding

**Phase to address:**
Phase 3 (Experience & Safety)

Source: YouTube API Services Developer Policies, sections III.C & F (branding, feature parity, and re-branding restrictions).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip policy review and ship topic filtering fast | Faster MVP release | Risk of losing API access, non-compliant data handling, legal exposure | Never—phase 1 should cover compliance before dependent work starts |
| Hardcode a fixed set of related videos to avoid API calls | Eliminates quota concerns initially | Data becomes stale, undermines trust in filtered workspace | Only for offline demos; never in production |
| Store every user-related-YouTube payload indefinitely for reuse | Simplifies personalization code | Violates retention rules, increases breach impact | Not acceptable under YouTube policies |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| YouTube Data API `search`/`videos` endpoints | Requesting too many `part` values or ignoring `fields`, causing larger payloads and quota wastage | Define only needed `part`/`fields`, cache responses, reuse ETags, and gzip responses when possible (per YouTube Data API best practices) |
| YouTube API authorization | Requesting wide scopes upfront and caching tokens for too long | Request only the scopes actually used, ask incrementally in context, refresh/revoke tokens when consent is withdrawn (per Developer Policies Section D) |
| Generated filtered list UI | Merging other video sources without explicit labeling | Keep YouTube data separate, clearly label each source, show required branding (Developer Policies Section F) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-fetching related lists on every hover | API quota spikes, slow UI | Batch fetch per video change, reuse cached topic vectors for short windows, use ETags | ~10–20 related requests per minute; above that quota errors appear |
| Serial topic similarity computation in the UI thread | Desktop UI stutters, inability to show current video quickly | Offload similarity scoring to worker thread or backend batch job, precompute embeddings and reuse (common for topic filtering apps) | When topic list grows beyond tens of videos, latency spikes unless async |
| Not using HTTP caching headers | Every reload hits API | Respect ETags/If-None-Match, configure gzip, and serve cached lists when unchanged | Breaks once users open multiple instances or run for extended sessions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Embedding API keys in the desktop client package | Keys can be extracted, allowing quota theft or impersonation | Only store API credentials on a backend proxy service, rotate regularly, and do not check them into code (per Developer Policies Section D) |
| Not encrypting locally stored tokens or data | Stolen data exposes user history and consent | Encrypt tokens, delete on revoke, and keep data retention within YouTube’s 30-day window |
| Ignoring Made for Kids autoplay constraints | Capturing playback data could breach COPPA/GDPR | For every video displayed, check `madeForKids` via the API and disable advanced tracking/analytics when true |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing filtered list without acknowledging filtering (users don’t know why videos are missing) | Distrust in workspace; users may think results censored | Surface the filtering criteria (topic tags, similarity score) clearly; allow reverting to raw YouTube list |
| Too many unrelated filters stacked in UI | Feature overload, users can’t focus on one topic | Prioritize one primary topic filter, expose secondary filters progressively, and allow quick resets |
| Not surfacing YouTube attribution on every item | Users can’t verify source; compliance failures | Display YouTube branding and link back to YouTube context as required (Developer Policies Section F) |

## "Looks Done But Isn't" Checklist

- [ ] **Filtered list:** Doesn’t yet refresh with the new topic embeddings — verify by playing multiple videos and ensuring list updates within 1 second.
- [ ] **Compliance layer:** Privacy policy and revocation flow not published yet — verify legal copy exists and revoke token within 7 days of request.
- [ ] **Branding:** UI may omit per-item YouTube attribution — verify every related video shows the correct icon/text and links to YouTube.
- [ ] **Quota handling:** No circuit breaker for quotaExceeded yet — verify the dashboard shows graceful degradation when quota reaches 90%.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Quota exhaustion | MEDIUM | Temporarily serve cached related lists with a warning, throttle new requests, request quota extension via compliance audit (phase 2) |
| Policy violation flagged | HIGH | Pause API usage, audit retained data, delete historical snapshots older than 30 days, update privacy policy, re-certify compliance before re-enabling |
| Branding/compliance UI flagged | MEDIUM | Rework UI to explicitly show attribution, hide filtered metadata if necessary, run another compliance walkthrough in Phase 3 |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Quota burnout | Phase 2 (Core API & Data) | Monitor daily quota, ensure fallbacks kick in before 90% usage |
| Data retention violations | Phase 1 (Governance & Compliance) | Privacy policy published, data store audited monthly, revocation flow tested |
| Branding/search modification | Phase 3 (Experience & Safety) | UI review checklist; compliance sign-off that branding, attribution, and Made for Kids handling are present |

## Sources

- YouTube Data API Overview (https://developers.google.com/youtube/v3/getting-started, last updated 2026-02-12 UTC)
- YouTube API Services Developer Policies (https://developers.google.com/youtube/terms/developer-policies, last updated 2025-08-28 UTC)

---
*Pitfalls research for: Topic-filtered YouTube workspace (Focus Filter)*
*Researched: 2026-02-13*
