# Scale & Performance Review: TypeScript/Node.js Service

## Overall Performance Assessment

A well-designed proxy service on a proven runtime. Node.js 22 LTS with Fastify and `undici` is a mature, battle-tested stack for I/O-bound HTTP proxying — used at Netflix, PayPal, and Walmart at scales far exceeding B2B API traffic. The design makes the right call choosing Node.js over Bun for production stability. The `undici` Pool provides explicit connection management, and Fastify's schema-first validation adds negligible overhead (~0.5ms). Total translation layer cost is 2-5ms at p95 — entirely acceptable when 12go responds in 50-500ms.

## Search Latency Analysis

Expected overhead: **2-5ms at p95**. Breakdown: ~0.5ms Fastify routing + plugin pipeline, ~0.5ms Zod request validation, ~1-2ms `undici` connection acquisition + HTTP call overhead, ~1ms JSON transformation (native JS — no serialization framework), ~0.5ms response writing. At p99, V8's incremental GC may add 1-3ms. The key advantage of Node.js for this workload: `JSON.parse` and `JSON.stringify` are implemented in C++ inside V8, making JSON handling faster than Go's `encoding/json` (reflection-based) and comparable to .NET's `System.Text.Json` source generators. For the 1-minute recheck scenario, the `AbortSignal.timeout(30_000)` on undici requests is the correct approach.

## Throughput Characteristics

Fastify on Node.js 22: ~9,164 req/s with JSON serialization per core (Fastify benchmarks). For this proxy workload, throughput is limited by concurrent outbound 12go calls, not framework overhead. The `undici` Pool with `connections: 20` can sustain ~20 concurrent in-flight requests to 12go per connection slot. With pipelining disabled (correct for a REST API), this means ~20 concurrent 12go calls per instance. For B2B traffic volumes, this is likely sufficient, but I'd recommend increasing to `connections: 50-100` and monitoring pool utilization. Node.js's single-threaded event loop means one container uses one CPU core — run N containers for N-core instances.

## Connection Management

The `undici` Pool configuration is well-specified: `connections: 20, pipelining: 1, keepAliveTimeout: 30_000`. This is better than the BFF alternative's unspecified connection management. Recommendations: increase `connections` to 50-100 for production (20 may bottleneck during traffic spikes when 12go is slow), add `connect.timeout: 5000` to fail fast on connection issues, and set `bodyTimeout: 30000` to match the overall request timeout. `undici` handles HTTP keep-alive, connection reuse, and idle connection cleanup automatically. It does not handle DNS TTL rotation as gracefully as .NET's `SocketsHttpHandler` — consider adding `pipelining: 0` and periodic pool recreation or using `undici`'s `Agent` with DNS interceptors for long-running instances.

## Caching Assessment

The stateless approach is correct and well-justified. The Redis caching escape hatch shown in the design is trivially simple — `JSON.stringify`/`JSON.parse` makes cache serialization a non-concern (unlike .NET where `IDistributedCache` serializes to `byte[]`). One note: if in-memory caching for master data is needed, Node.js's single-threaded model means no `RWMutex` equivalent is needed — a simple `Map` with TTL is thread-safe by default (the event loop guarantees sequential execution). This is actually simpler than Go or .NET.

## Resource Utilization

Memory: ~100-150MB per instance (V8 heap baseline + `undici` buffers + request context). Under sustained load with 100 concurrent requests buffering 10KB responses: ~101-151MB — modest growth. V8's generational GC performs well for short-lived allocations (request/response buffers), which is exactly this workload's pattern. CPU: near-zero utilization — the event loop spends >95% of time in `epoll_wait` (waiting for 12go responses). The `runtimeMetrics: true` dd-trace option will export event loop lag, which should stay under 5ms for this workload. If it exceeds 10ms, investigate blocking code paths.

## Horizontal Scaling

Stateless, single-process design scales linearly behind a load balancer. Node.js 22 starts in 60-120ms — fast enough for auto-scaling. Each container uses one core; for 4-core EC2 instances, run 3-4 containers (leaving headroom for the Datadog agent). No shared state between instances. The `process.on('SIGTERM')` graceful shutdown with `app.close()` ensures in-flight requests complete during rolling deployments. Scaling strategy: start with 2-3 instances for redundancy, add based on p95 event loop lag and 12go connection pool utilization metrics.

## Performance Risks

1. **Event loop blocking**: The booking schema parser iterates over ~20-100 fields with regex matching — this is microseconds, not milliseconds, so it's safe. The real risk is `JSON.parse` on unexpectedly large 12go responses. Set a `maxRedirections: 0` and body size limit on `undici` requests.
2. **V8 GC at p99**: Under sustained high throughput, V8's major GC (mark-sweep) can cause 5-15ms pauses. For a B2B API, this is acceptable. If p99.9 latency matters, use `--max-old-space-size=256` to keep the heap small and GC pauses short.
3. **`undici` pool exhaustion**: If 12go degrades (500ms+ responses), 20 connections × 500ms = 40 req/s throughput cap. Increase `connections` to 100 and add circuit breaker logic (the design mentions retry but not circuit breaking).
4. **No explicit backpressure**: If 12go is completely down, Fastify will queue requests in memory. Add a connection/request limit plugin to return 503 early rather than accumulating memory.

## Optimization Opportunities

- Increase `undici` Pool `connections` to 50-100 for production
- Add circuit breaker (e.g., `cockatiel` or `opossum`) for 12go calls
- Use Fastify's built-in `serializer` with `fast-json-stringify` for response serialization (~2-3x faster than `JSON.stringify` for known schemas)
- Consider `node --max-old-space-size=256` to keep GC pauses minimal
- Monitor event loop lag via dd-trace `runtimeMetrics` — alert if >10ms

## Score Adjustments

The self-assessed Search Performance score of 5 is accurate — Node.js event loop is ideal for this I/O proxy pattern. I'd adjust the overall assessment: this design is performance-comparable to the .NET alternative (both add 2-5ms), slightly behind Go (1-3ms) and significantly behind PHP Option A Phase 2 (eliminates HTTP hop entirely). The `undici` Pool configuration should be tightened — 20 connections is conservative for production. Adding a circuit breaker for 12go calls is a gap worth addressing.
