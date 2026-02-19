# Scale & Performance Review: Hybrid BFF / Thin Proxy (Bun/TypeScript)

## Overall Performance Assessment

The thin proxy philosophy is sound from a performance perspective — less code means fewer places to introduce latency. Bun claims impressive benchmarks (~200K req/s), but production maturity matters more than synthetic throughput for a travel platform. The design correctly identifies that search is a single HTTP passthrough adding <1ms, making this workload an excellent fit for any async I/O runtime. The main performance concern is Bun's production readiness — an unproven runtime failure at 3 AM is a worse outcome than 2ms of additional latency on a proven one.

## Search Latency Analysis

Expected overhead: **1-2ms at p95** for Bun, **2-4ms for Node.js fallback**. Search is a single 12go call with JSON reshaping — the thinnest possible path. Bun's optimized HTTP server and JavaScriptCore engine provide slightly faster JSON parsing than Node.js's V8, but the difference (<1ms) is irrelevant when 12go's search takes 50-500ms. For multi-call endpoints (GetItinerary = 3 sequential calls), total latency is dominated by 12go: **sum of 3 12go round-trips + 2-4ms** transformation. No parallelization opportunity since calls are dependent.

## Throughput Characteristics

Bun: ~200K req/s raw, ~50-80K with JSON transformation. Node.js (fallback): ~68K req/s. Both runtimes use a single-threaded event loop — excellent for I/O-bound proxying, but a single CPU-bound operation blocks all concurrent requests. For this proxy workload, this is fine: JSON transformation of a typical search response (10-30KB) takes <1ms, far below the event loop blocking threshold. The real throughput limit is concurrent outbound connections to 12go. Bun's HTTP client is less battle-tested than Node.js's `undici` or .NET's `SocketsHttpHandler` — connection pooling behavior under sustained load deserves explicit validation.

## Connection Management

This is the design's weakest point from a performance perspective. Bun's built-in `fetch` doesn't expose connection pool configuration as granularly as .NET's `SocketsHttpHandler` or Go's `net/http.Transport`. You can't easily set `MaxConnectionsPerServer`, `IdleTimeout`, or `PooledConnectionLifetime`. The design doesn't specify which HTTP client library will be used for 12go calls. For production, I'd recommend `undici` (even within Bun — it's compatible) for its explicit `Pool` API with configurable `connections`, `pipelining`, and `keepAliveTimeout`. Without explicit connection pool tuning, you risk either connection starvation (too few idle connections during spikes) or connection exhaustion (too many connections overwhelming 12go).

## Caching Assessment

The stateless, no-cache approach is appropriate. The design correctly defers to 12go's Redis. At ~3K LOC, there's almost nothing to cache internally — no computed aggregations, no derived data. If search caching becomes necessary, JavaScript's native `Map` or an LRU cache (`lru-cache` npm package) provides sub-microsecond in-memory reads. The simplicity of the codebase means caching can be added to any endpoint in <30 minutes.

## Resource Utilization

Bun: ~50-100MB baseline memory (JavaScriptCore runtime). Node.js: ~80-150MB (V8 engine + heap). Both are higher than Go (~20-30MB) but lower than .NET (~150-200MB). CPU utilization will be minimal — the event loop will spend most of its time `await`-ing 12go responses. Under load, memory grows linearly with in-flight requests (buffered JSON responses). A 10KB response × 1,000 concurrent requests = ~10MB of request buffers — manageable. Bun's memory efficiency advantage over Node.js (~40% less) is real but not decisive at this scale.

## Horizontal Scaling

Stateless single-process design scales trivially behind a load balancer. No shared state, no distributed coordination. Bun starts in 15-30ms; Node.js in 60-120ms — both fast enough for scaling events. Since the event loop is single-threaded, each container uses one CPU core efficiently. To utilize multi-core instances, run N containers (where N = available cores) behind a local reverse proxy or use Docker's replicas. This is standard practice for event-loop runtimes.

## Performance Risks

1. **Bun production stability**: Bun 1.2 is young. Unknown failure modes under sustained production load — memory leaks, connection handling edge cases, and GC behavior (JavaScriptCore vs V8) are less documented. The Node.js fallback is a good safety net, but switching runtime mid-production is not zero-cost.
2. **Event loop blocking**: A malformed 12go response or unexpectedly large JSON payload could block the event loop during JSON.parse. For a 1MB search response (extreme case), JSON.parse takes ~10-15ms — enough to delay other concurrent requests. Mitigation: set response size limits on the HTTP client.
3. **Notification delivery in the event loop**: The in-memory retry queue with multiple delivery goroutines is straightforward in Go but trickier in a single-threaded event loop. Ensure retry timers don't create memory pressure from accumulated `setTimeout` references.
4. **No explicit connection pool config**: As noted above, the design needs to specify connection pooling parameters.

## Optimization Opportunities

- Use `undici` Pool explicitly with `connections: 50, pipelining: 1` for 12go
- Set response body size limits to prevent event loop blocking on large payloads
- Use `JSON.parse` with a reviver function for lazy parsing of unused fields in large responses
- Run multiple Bun/Node.js processes per EC2 instance for multi-core utilization
- Consider streaming JSON transformation for search responses to reduce memory allocation

## Score Adjustments

The self-assessed Search Performance score of 5 is accurate — single-call passthrough latency is negligible. I'd adjust Infrastructure Fit from 4 to **3** from a performance operations perspective: Bun is unproven in production, connection pool configuration is under-specified, and DevOps has no operational playbook for Bun memory dumps, profiling, or crash analysis. The Node.js fallback mitigates this, but the design recommends Bun as primary.
