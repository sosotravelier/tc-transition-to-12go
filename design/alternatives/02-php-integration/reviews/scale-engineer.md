# Scale & Performance Review: PHP Integration (Inside f3)

## Overall Performance Assessment

This is the only alternative that eliminates the HTTP round-trip to 12go entirely. Direct MariaDB and Redis access from within f3 makes Option A the fastest possible architecture for search latency. However, PHP-FPM's process-per-request concurrency model limits throughput per instance compared to async runtimes. This is mitigated by already running on 8 EC2 instances. The two-phase approach (HTTP proxy first, direct access later) means performance benefits are deferred — the MVP performs identically to the .NET alternative.

## Search Latency Analysis

**Phase 1 (HTTP proxy)**: Identical to other alternatives — 12go API response time + 3-10ms PHP overhead. PHP-FPM's per-request process model adds slightly more overhead than .NET's async pipeline due to process bootstrap, though OPcache eliminates compilation cost.

**Phase 2 (direct access)**: This is where PHP wins decisively. Estimated search latency: **30-100ms p95** (cached Redis hit: 5-15ms, MariaDB query: 30-80ms). By eliminating HTTP serialization/deserialization overhead (~20-50ms per call) and network round-trip (~5-15ms), GetItinerary's 3-call flow saves **75-195ms** compared to HTTP proxying. This is the single strongest performance argument across all 5 alternatives.

## Throughput Characteristics

PHP-FPM spawns a pool of worker processes — typically 50-200 per instance depending on memory. Each worker handles exactly one request at a time (no async I/O within a request). With 8 EC2 instances × ~100 workers = **~800 concurrent requests**. This is adequate for B2B traffic but significantly lower than the 5,000-10,000 concurrent connections achievable with .NET or Go. The saving grace: B2B API traffic is a fraction of f3's consumer traffic, and f3 already provisions for consumer scale. CPU-wise, PHP 8.3 with JIT handles JSON transformation efficiently — comparable to Node.js, slower than .NET/Go for computation-heavy work, but this is I/O-bound.

## Connection Management

**Phase 2 eliminates HTTP client connection management entirely** for most endpoints — this is a massive operational simplification. No connection pools to tune, no keep-alive timeouts, no DNS caching concerns. MariaDB connections are managed by f3's existing Doctrine connection pool. Redis connections are managed by Predis/phpredis, already configured in f3. For Phase 1 HTTP proxy mode, Symfony HttpClient provides connection pooling via curl multi handles, which is adequate but less sophisticated than .NET's `SocketsHttpHandler`.

## Caching Assessment

Best caching story of all alternatives. Direct access to 12go's Redis means the B2B module benefits from the same cache that serves f3's consumer traffic — no cache duplication, no staleness gap, no second cache layer to invalidate. Station/operator data can use APCu (per-worker in-memory cache with 5-minute TTL) for sub-millisecond reads. The design correctly avoids adding new caching infrastructure.

## Resource Utilization

PHP-FPM workers: ~20-50MB per worker, allocated on request start, released on completion. No long-lived heap, no GC pauses. This "shared nothing" model provides natural isolation — one bad request can't leak memory into subsequent requests. Total memory per EC2 instance: already budgeted for f3's existing workers. B2B endpoints add negligible memory overhead since they share the worker pool. CPU: expect minimal additional load — B2B traffic is small relative to consumer traffic. Monitor f3's existing CPU headroom.

## Horizontal Scaling

Already scales across 8 EC2 instances with no additional configuration. B2B endpoints inherit f3's load balancing, auto-scaling (if configured), and request distribution. No new infrastructure, no new scaling dimensions. The one concern: B2B traffic shares resources with consumer traffic. A B2B traffic spike could compete with consumer requests for PHP-FPM workers. Mitigation: configure a separate FPM pool for B2B endpoints with dedicated worker allocation, or accept shared pooling given B2B's small traffic share.

## Performance Risks

1. **Worker pool contention**: If 12go API slows down during Phase 1, PHP-FPM workers block synchronously, reducing capacity for all of f3 (including consumer traffic). The Symfony HttpClient async mode mitigates this, but PHP's fundamental per-request model means each slow request consumes a full worker.
2. **Phase 1 ≠ Phase 2**: The performance headline (sub-100ms search) only materializes in Phase 2. The MVP (Phase 1) performs identically to the .NET alternative. Budget 4-8 additional weeks to realize the performance benefits.
3. **f3 deployment coupling**: B2B code deploys with f3. A B2B bug that causes crashes or memory spikes affects consumer traffic. This is a production stability risk, not just a performance risk.

## Optimization Opportunities

- Dedicated PHP-FPM pool for B2B endpoints (resource isolation from consumer traffic)
- OPcache preloading for B2B classes to eliminate autoloader overhead
- Direct MariaDB read replicas for search queries (if 12go supports read/write splitting)
- Shared-nothing architecture means horizontal scaling is purely additive

## Score Adjustments

The self-assessed Search Performance score of 5 is deserved — **but only for Phase 2**. Phase 1 is a 4 (same as .NET proxy). I'd recommend the design clarify this distinction: "Score: 5 (Phase 2) / 4 (MVP)". The Infrastructure Fit score of 5 is accurate — zero new infrastructure is genuinely the best possible outcome for DevOps.
