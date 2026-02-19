# Scale & Performance Review: Trimmed .NET Service

## Overall Performance Assessment

This is an excellent choice for a latency-sensitive I/O-bound proxy. .NET 8 Minimal API with `SocketsHttpHandler` and async/await delivers best-in-class HTTP connection management and throughput characteristics. The translation layer will add <5ms of overhead at p95 — negligible against 12go's 50-500ms response times. The design correctly identifies that 12go's MariaDB is the bottleneck, not our proxy.

## Search Latency Analysis

Expected end-to-end search latency: **12go response time + 2-5ms** for our layer. Breakdown of our overhead: ~1ms request deserialization, ~0.5ms route matching + middleware, ~1-2ms JSON re-serialization via `System.Text.Json` (source-generated serializers could push this under 1ms), ~0.5ms response writing. At p99, GC pauses on .NET 8's concurrent GC add <2ms. With `SocketsHttpHandler`'s connection pooling and keep-alive, there's no TCP/TLS handshake cost on warmed connections. For the 1-minute recheck scenario, the 30-second timeout in the Polly resilience pipeline is appropriate — the client should receive a 206 Partial Content well before that.

## Throughput Characteristics

.NET 8 Minimal API benchmarks at ~2.1M req/s plaintext and ~300-400K req/s with JSON serialization on a modern server. For this proxy workload, the limiting factor is concurrent outbound connections to 12go, not CPU. With the default `ThreadPool` and `async/await`, a single instance can sustain **5,000-10,000 concurrent in-flight requests** to 12go before connection pool saturation becomes a concern. `SocketsHttpHandler` with `PooledConnectionLifetime = 5min` handles DNS rotation and connection recycling gracefully.

## Connection Management

The strongest point of this design. `IHttpClientFactory` + `SocketsHttpHandler` is the gold standard for outbound HTTP connection management in any runtime. Connection pooling, keep-alive, DNS TTL handling, and TLS session resumption are all handled automatically. The `PooledConnectionLifetime` of 5 minutes is well-chosen — long enough to avoid churn, short enough to pick up DNS changes. One consideration: the design should explicitly set `MaxConnectionsPerServer` (default is `int.MaxValue`) to avoid overwhelming 12go during traffic spikes. A value of 100-200 connections per instance would be appropriate given 12go's 8 EC2 instances.

## Caching Assessment

The stateless, no-cache design is correct. 12go already caches search results in Redis. Adding another caching layer introduces staleness risk and cache invalidation complexity for minimal gain. The escape hatch (add `IDistributedCache` with Redis) is well-documented and genuinely trivial in .NET — it's a DI registration and a 3-line wrapper. Don't add it until p95 search latency data from production demands it.

## Resource Utilization

Memory footprint: ~150-200MB per instance under moderate load (this includes the .NET runtime). CPU utilization will be very low — JSON serialization is the only CPU work, and `System.Text.Json` is highly optimized. Under load, expect <10% CPU utilization with the bottleneck being `await`-ing 12go responses. The service will be almost entirely I/O-wait. Graceful degradation: .NET's thread pool adapts to load with hill-climbing; under extreme load, requests queue in Kestrel's connection queue with configurable limits.

## Horizontal Scaling

Stateless design means trivial horizontal scaling behind a load balancer. No shared state, no sticky sessions, no distributed locks. Each instance is identical. Scaling unit is a Docker container. With 12go as the bottleneck, you'll likely need only 2-3 instances for redundancy, not throughput. Add instances if connection pool limits per instance are reached or for availability zones.

## Performance Risks

1. **GC pauses at p99**: .NET 8 concurrent GC keeps pauses under 2ms typically, but large JSON payloads (search responses with 50+ trips) could trigger Gen2 collections. Mitigate with `ServerGarbageCollection=true` and monitoring p99.9 latency.
2. **GetBookingDetails latency increase**: Moving from local DB read (~1-5ms) to proxying 12go adds ~30-100ms. Acceptable for this endpoint, but monitor client polling patterns.
3. **Connection pool exhaustion**: If 12go slows down (rechecks, DB pressure), in-flight requests stack up holding connections. The Polly timeout at 30s is the safety valve.

## Optimization Opportunities

- Enable `System.Text.Json` source generators for zero-allocation serialization on hot paths
- Consider response streaming for large search responses instead of buffering
- HTTP/2 multiplexing to 12go (if supported) would reduce connection count
- Set explicit `MaxConnectionsPerServer` on `SocketsHttpHandler`

## Score Adjustments

The design's self-assessed Search Performance score of 4 is fair. I'd keep it at **4** — the .NET overhead is negligible, but it's still an extra network hop compared to PHP's direct MariaDB access. All other performance-related scores are accurate. No adjustments needed.
