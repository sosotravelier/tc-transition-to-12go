# Scale & Performance Review: Go Service

## Overall Performance Assessment

Go is arguably the best runtime choice for a latency-sensitive HTTP proxy. Goroutines provide massive concurrency at ~8KB memory per connection, GC pauses are consistently sub-millisecond, and the compiled binary starts in <100ms. For this specific workload — receive HTTP, call 12go, transform JSON, respond — Go's performance characteristics are overkill in the best possible way. The bottleneck will always be 12go's response time, and Go ensures our layer contributes virtually zero additional latency.

## Search Latency Analysis

Expected our-layer overhead: **1-3ms at p95**. Breakdown: ~0.3ms Chi routing + middleware, ~0.5ms JSON unmarshaling (Go's `encoding/json` is adequate; `json-iterator` or `sonic` could halve this), ~0.5ms transformation logic, ~0.5ms JSON marshaling, ~0.2ms response writing. At p99, Go's concurrent GC adds <0.5ms — the best GC behavior of any garbage-collected runtime in this comparison. Go's `net/http` Transport maintains persistent connections with configurable `MaxIdleConnsPerHost`, `IdleConnTimeout`, and TLS session caching. Total search latency: **12go response time + 1-3ms**.

## Throughput Characteristics

Go's goroutine scheduler handles thousands of concurrent connections with minimal overhead. A single Go instance can sustain **10,000-50,000 concurrent in-flight requests** — each goroutine waiting on 12go's response consumes ~8KB of stack (growing lazily) vs. ~1MB per thread in thread-per-request models. For this proxy workload, a single Go instance could handle the entire B2B traffic volume with headroom. The limiting factor shifts to 12go's capacity, not ours. The `hashicorp/go-retryablehttp` + `sony/gobreaker` combination is well-chosen — retries with backoff prevent cascade failures, and the circuit breaker provides fast-fail when 12go is degraded.

## Connection Management

Go's `net/http` Transport is production-proven at massive scale (Cloudflare, Google, Docker). Default settings are conservative; the design should explicitly configure: `MaxIdleConnsPerHost: 100` (default is 2 — far too low), `MaxConnsPerHost: 200`, `IdleConnTimeout: 90s`, `TLSHandshakeTimeout: 10s`. DNS resolution is cached by the Transport's dialer. The design mentions `retryablehttp.Client` which wraps the standard Transport — ensure the pooling configuration propagates correctly. One consideration: Go's HTTP client does not support HTTP/2 server push, but 12go's API likely doesn't use it.

## Caching Assessment

The stateless approach is correct. The in-memory `sync.RWMutex`-based cache for master data is a good pattern — zero external dependencies, sub-microsecond reads, periodic refresh from 12go. For search, the design correctly defers to 12go's Redis. If caching becomes necessary, `go-redis` is mature and the implementation would be ~30 lines. The `MasterDataCache` pattern shown is idiomatic and efficient — `sync.RWMutex` allows concurrent reads (the common case) with exclusive writes only during refresh.

## Resource Utilization

This is Go's strongest differentiator. Memory footprint: **~20-30MB RSS** for the entire service under moderate load. Compare: .NET at 150-200MB, Node.js at 100-200MB, PHP-FPM at 20-50MB per worker (but you need 50-200 workers). CPU utilization will be near-zero since JSON transformation is the only compute and Go's JSON encoder/decoder is reasonably optimized. Under extreme load, Go degrades gracefully — goroutines pile up in the scheduler but don't consume additional memory linearly like threads or PHP workers. The ~10-15MB Docker image (distroless) means fast pull times and low storage cost.

## Horizontal Scaling

Stateless single binary scales trivially behind a load balancer. <100ms cold start means new instances are immediately available — no warm-up period, no JIT compilation, no assembly loading. This makes Go particularly well-suited for auto-scaling on traffic spikes. Scaling unit: a single Docker container at 20-30MB. You could run 10 Go instances in the memory footprint of one .NET instance. In practice, 2-3 instances for redundancy is sufficient — 12go is the bottleneck, not us.

## Performance Risks

1. **`encoding/json` is Go's weakest standard library component**: For large search responses (50+ trips with nested travel options), JSON unmarshal/marshal could become measurable (~5-10ms for 500KB payloads). Mitigation: benchmark with production-sized responses; swap to `json-iterator/go` if needed (drop-in replacement, 3-5x faster).
2. **Error handling overhead**: The `if err != nil` pattern generates no runtime overhead (unlike exceptions), but ensure 12go error responses are parsed efficiently — don't regex-match error bodies on the hot path.
3. **Context cancellation propagation**: With 30s timeouts and 3-call orchestration (GetItinerary), ensure context deadlines cascade correctly. A 30s timeout on the outer request should leave room for all 3 12go calls, not timeout after the first.

## Optimization Opportunities

- Replace `encoding/json` with `json-iterator/go` or `bytedance/sonic` for 3-5x faster JSON processing
- Use `sync.Pool` for request/response buffer reuse to reduce GC pressure
- HTTP/2 to 12go for connection multiplexing (reduce pool size needed)
- `MaxIdleConnsPerHost` should be explicitly set (default 2 is inadequate)
- Consider `fasthttp` if raw throughput ever matters (unlikely — 12go is the bottleneck)

## Score Adjustments

The self-assessed Search Performance score of 5 is accurate — Go adds the least overhead of any alternative. The resource utilization story is best-in-class. I'd note that the design should include explicit `Transport` configuration (the defaults are too conservative for a proxy workload). No score changes needed; the performance assessment is honest and well-calibrated.
