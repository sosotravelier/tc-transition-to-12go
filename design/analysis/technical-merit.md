---
status: draft
last_updated: 2026-03-17
agent: technical-merit
---

# Technical Merit Analysis

## Architecture Quality Assessment

### Pragmatic Minimalist

#### Boundary Clarity

The Pragmatic Minimalist recommends PHP/Symfony as a bundle inside F3. The design does not propose a formal boundary between client-facing handlers and the 12go client. The architecture is described as "one service, flat structure, direct HTTP calls" with explicit rejection of layered abstractions. The call chain for a search request is: Symfony controller -> 12go HTTP client -> transform response -> return. There is no outbound interface or adapter abstraction -- the controller calls 12go directly through a typed HTTP client.

This means the 12go client cannot be replaced without touching the HTTP handlers. Every handler directly references 12go-specific types and calls. When F3 is decomposed and the upstream API changes, every handler must be modified. The design acknowledges this trade-off explicitly in its self-critique section: "monitoring and observability are handwaved" and it does not address what happens when F3 is restructured.

The client contract side is also not formally tested -- there are no contract test fixtures proposed. Shadow traffic comparison is mentioned, but no durable artifact survives a reimplementation.

#### Error Handling Robustness

The design preserves the existing error handling patterns from the .NET codebase: HTTP status code mapping (400 -> validation error, 404 -> not found, 500+ -> server error, timeout -> 504). This is stated as "port the existing patterns" but no specific timeout strategy is described. There is no circuit breaker proposed, and the design explicitly rejects adding caching or state beyond Redis for the booking schema mapping.

For partial 12go responses (malformed JSON), there is no explicit handling described. The design relies on the Symfony HTTP client and PHP's `json_decode` for deserialization, which would throw on malformed input, but the mapping to a client-friendly error is not specified.

12go timeout handling: not explicitly addressed beyond "use 12go timeouts." No per-operation timeout budget is described.

#### Concurrency Model Assessment

PHP-FPM uses a process-per-request model. Each request runs in a single process with no shared state. Concurrent requests are handled by separate FPM workers. This is the simplest possible concurrency model: no goroutine leaks, no thread pool exhaustion, no event loop blocking. The failure mode under load is worker pool exhaustion, which FPM handles gracefully by queuing requests.

However, for GetItinerary (which requires 3 parallel 12go calls: trip details + add to cart + checkout schema), the design does not discuss parallelism. In standard PHP-FPM, these calls would be sequential unless Symfony's async HTTP client is used. The design mentions Symfony HttpClient but does not specify whether parallel requests are used for multi-call endpoints. If sequential, GetItinerary adds the latency of all three calls serially rather than the max of the three.

The most significant concurrency concern is the per-request memory model for ID mapping tables. The design acknowledges this: "Station ID mapping tables must be loaded per-request or cached externally." With thousands of station, operator, POI, and seat class mappings, loading these per-request from Redis or a file adds measurable latency to every request. The design proposes Redis, but every search request would then include a Redis round-trip for ID lookups -- adding 1-5ms depending on the number of lookups and Redis locality.

#### Performance Estimate

- **Search latency overhead**: ~8-15ms (PHP-FPM process startup overhead ~1ms, JSON deserialization ~2-3ms for a typical search response with 15-30 trips, station ID mapping lookups from Redis ~2-5ms for multiple bidirectional lookups, JSON serialization ~2-3ms, Symfony HTTP kernel overhead ~1-2ms). If ID mappings are loaded per-request from a JSON file instead of Redis, add more.
- **Throughput ceiling**: ~200-400 req/s with 8 FPM workers (I/O bound on 12go API wait time; each worker blocks for the duration of the upstream call). Workable for B2B traffic patterns.
- **Memory footprint**: ~160-320MB (8 FPM workers x 20-40MB each). Container image ~120-150MB.
- **Startup time**: ~2-3s cold start for PHP-FPM + Symfony container compilation.

#### Resilience Design

- **Circuit breaker**: Not proposed. For a single-upstream proxy, a circuit breaker adds marginal value -- if 12go is down, there is no fallback. However, a circuit breaker would prevent cascading resource exhaustion (all FPM workers blocked waiting on a dead upstream). Its absence is a minor gap.
- **Retry policy**: Mentions "raw Polly" (the .NET library) as something to preserve, but since the recommendation is PHP, no specific retry library or policy is described. This is a gap.
- **Timeout strategy**: Not specified per-operation. No total request timeout budget described.
- **Seat lock TTL**: Mentions "fake lock until 12go ships native support" but no in-process TTL management details.
- **Notification delivery**: Webhook retry is not addressed. What happens if the client's webhook endpoint is down is not discussed.

#### Observability Design

The design says "use Datadog" but does not specify which metrics must be preserved. It acknowledges this in self-critique: "Monitoring and observability are handwaved." No structured logging format is proposed. No correlation ID propagation implementation is described. The Datadog APM integration would be automatic through `dd-trace-php` (if deployed as a standalone Symfony service) or inherited from F3 (if deployed as a bundle). But the design does not specify custom metrics, alerting thresholds, or health check design.

The health check design is not described at all.

#### Scores

- C4: Search Performance (x3): 3/5 -- Per-request ID mapping loading adds latency; sequential multi-call endpoints unaddressed; but search is a single 12go call and the overhead is manageable
- C5: Simplicity (x3): 4/5 -- Single service inside F3, minimal moving parts, flat structure. Loses a point because embedding in F3 means inheriting F3's complexity for local development
- C8: Infrastructure Fit (x2): 5/5 -- PHP inside F3 is the zero-infrastructure-change option; identical to every other container on 12go's fleet
- C9: Disposability (x2): 2/5 -- No adapter boundary, no outbound interface, no contract tests. Every handler directly couples to 12go types. When F3 is decomposed, the entire service must be rewritten, not adapted
- C10: Elegance (x1): 3/5 -- Architecture matches the problem (thin proxy) but the deliberate rejection of any boundary means the design is correct-for-now but structurally unable to evolve
- C11: Monitoring/Observability (x1): 2/5 -- Self-admittedly handwaved. Inherits F3's Datadog APM but proposes no custom metrics, no alerting, no health check

---

### Clean Slate Designer

#### Boundary Clarity

The Clean Slate design proposes Go with a clear three-layer architecture: HTTP handler -> endpoint logic -> 12go client, with shared `transform` and `mapper` packages. The 12go client (`internal/twelvego/`) is a separate package with its own types (`models.go`) and error handling (`errors.go`). The transform layer (`internal/transform/`) contains pure functions that convert between 12go types and client-facing types.

This is a meaningful separation. The 12go client can be replaced by implementing a new package with the same function signatures. However, there is no formal interface -- the endpoint logic imports and calls `twelvego.Search()` directly. The boundary is enforced by Go package visibility (internal packages), not by interface contracts. This is adequate for a small codebase (~35 files) but less rigorous than a formal port/adapter pattern.

The client contract side is better: the design proposes writing a TC API OpenAPI spec first, using it as the contract test. Response types are implicitly defined by the handler response structures.

#### Error Handling Robustness

The design explicitly maps 12go HTTP status codes to client-facing errors in a table: 400 -> validation error with field translation, 404 -> not found, 500+ -> 502, timeout -> 504 or IncompleteResults (202). The error surface analysis is the most thorough of any design.

Go's explicit error handling (`if err != nil`) ensures every error path is visible. The `twelvego/errors.go` file is dedicated to error response parsing and mapping. Partial/malformed JSON would be caught by Go's `encoding/json` deserializer, which returns typed errors that can be mapped to appropriate client responses.

No circuit breaker is proposed. The design explicitly notes this is a single-upstream proxy.

#### Concurrency Model Assessment

Go's goroutine model is the strongest fit for this workload. For GetItinerary's 3 parallel 12go calls, the design mentions `errgroup` for parallel execution -- a natural Go pattern that handles failure of any sub-call gracefully. Goroutines are lightweight (~4KB stack) so thousands of concurrent requests create negligible overhead.

Failure modes under load: goroutine leaks are the primary risk, but with explicit `context.Context` propagation and timeouts (standard Go HTTP patterns), goroutines are bounded by request timeouts. No thread pool exhaustion risk.

In-memory hash maps for ID mappings persist across requests (unlike PHP). Station, operator, POI, and seat class mappings are loaded once at startup and shared across all goroutines. Go's `sync.Map` or a read-only `map` with startup initialization means zero per-request overhead for ID lookups.

#### Performance Estimate

- **Search latency overhead**: ~2-4ms (Go HTTP server overhead ~0.1ms, JSON deserialization ~1-2ms, in-memory station ID lookups ~0.01ms, JSON serialization ~1-2ms, net/http client overhead ~0.1ms). This is the lowest overhead of any design.
- **Throughput ceiling**: ~5,000-10,000 req/s (goroutine per request, limited only by 12go upstream latency and network I/O). Far exceeds B2B traffic needs.
- **Memory footprint**: ~10-30MB for the Go process + ID mapping tables (~5-10MB for thousands of entries). Container image ~20MB (distroless).
- **Startup time**: ~50-100ms. Excellent for scaling and restarts.

#### Resilience Design

- **Circuit breaker**: Not proposed. Design notes single-upstream makes it less necessary.
- **Retry policy**: Not explicitly described, but Go's `net/http` client supports custom `RoundTripper` implementations for retry logic. The design inherits Polly-style retry from the existing system conceptually but does not specify the Go implementation.
- **Timeout strategy**: Go's `context.Context` propagation naturally supports per-operation timeouts. The design's three-layer architecture passes context through, enabling total request timeout with per-12go-call sub-timeouts.
- **Seat lock TTL**: "In-memory map with TTL" for booking schema cache and incomplete results. Mentions `store/schema_cache.go` with TTL. On service restart, this in-memory state is lost -- noted as acceptable for single-instance deployment with fallback to re-fetching checkout schema.
- **Notification delivery**: Mentions "forward HTTP POST to client's webhook URL" but no retry policy for failed deliveries.

#### Observability Design

The design explicitly acknowledges gaps: "This design emits no events. No Kafka, no ClickHouse writes, no per-client performance metrics." It proposes structured request/response logging as the minimum viable observability.

For Datadog APM, the design notes that `dd-trace-go` requires manual instrumentation: `httptrace.WrapClient()` for outbound calls, manual span creation for business logic. This is more work than PHP's auto-instrumentation. Correlation ID propagation requires explicit header injection/extraction.

No health check endpoint is described. No custom metrics. No alerting.

#### Scores

- C4: Search Performance (x3): 5/5 -- Lowest latency overhead (~2-4ms), in-memory ID mappings on hot path, correct connection pooling via Go's net/http, goroutines for parallel multi-call endpoints
- C5: Simplicity (x3): 5/5 -- Single binary, ~35 files, ~2000 LOC estimated, three layers with obvious call flow, one person can read the entire codebase in an afternoon
- C8: Infrastructure Fit (x2): 2/5 -- Go is not on 12go's fleet. New Dockerfile template, new process model, DevOps has no Go operational experience. The smallest Docker image means nothing if the ops team cannot debug it
- C9: Disposability (x2): 3/5 -- Package-level separation between twelvego client and handlers, but no formal interface. Transform functions are pure and testable. OpenAPI spec proposed as contract test. Better than Pragmatic Minimalist but weaker than Disposable Architecture
- C10: Elegance (x1): 5/5 -- Best match between problem complexity and solution complexity. A thin proxy implemented as a thin service. No patterns applied for their own sake. Three layers for a system that needs exactly three layers
- C11: Monitoring/Observability (x1): 2/5 -- Explicitly acknowledges no events, no metrics, no Kafka. Manual Datadog instrumentation required. Structured logging proposed but not designed

---

### Platform Engineer

#### Boundary Clarity

The Platform Engineer recommends a standalone PHP/Symfony service (not inside F3). The design focuses heavily on infrastructure concerns (Docker, Datadog, CI/CD, on-call runbooks) but provides minimal detail on the internal architecture of the service. No layer structure is described. No outbound interface or adapter boundary is proposed. The design describes the observability and deployment story in detail but not the code architecture.

The 12go client is mentioned as using "Guzzle HTTP clients" with Datadog auto-instrumentation but no separation from the handler layer is described. The handler -> 12go call path is implied as direct.

The client contract is preserved through "the same 13 endpoints with identical URL patterns" but no contract test mechanism is proposed.

#### Error Handling Robustness

The design describes on-call runbook procedures for diagnosing errors (check Datadog APM -> check 12go health -> check container logs -> restart) but does not specify how the application handles errors programmatically. No error mapping table, no timeout strategy, no partial response handling.

#### Concurrency Model Assessment

Same as Pragmatic Minimalist: PHP-FPM process-per-request model. The design specifies 4-8 workers per container with ~20-40MB each. Sequential request handling with no goroutine-style parallelism for multi-call endpoints. The concurrency model is simple and well-understood but adds latency for GetItinerary.

The standalone deployment model means independent scaling: B2B traffic bursts do not affect F3's worker pool. This is a meaningful advantage over the F3-embedded approach.

#### Performance Estimate

- **Search latency overhead**: ~8-15ms (same as Pragmatic Minimalist for the PHP overhead, but as a standalone service it avoids F3's Symfony kernel boot overhead -- however, it still needs its own Symfony kernel). The ID mapping loading story is unaddressed.
- **Throughput ceiling**: ~200-400 req/s with 8 FPM workers. Independently scalable by adding containers.
- **Memory footprint**: ~256-512MB (design specifies 512MB limit, 256MB request). Container image ~120-150MB.
- **Startup time**: ~2-3s for PHP-FPM + Symfony.

#### Resilience Design

- **Circuit breaker**: Not proposed.
- **Retry policy**: Not specified.
- **Timeout strategy**: FPM's `process_control_timeout = 30` for graceful shutdown. Docker `stop_grace_period: 35s`. But no application-level timeout for 12go calls.
- **Seat lock TTL**: Not addressed.
- **Notification delivery**: Webhook received/forwarded metrics proposed, but no retry policy for failed client webhook delivery.
- **Health check**: Explicitly designed. `GET /health` returns process status without calling 12go. A deeper `/health/ready` check is mentioned for operational dashboards. This is the most thoughtful health check design of any proposal.

#### Observability Design

This is the strongest observability design of all six proposals:

- **Datadog APM**: `dd-trace-php` auto-instruments Symfony HTTP kernel and Guzzle clients. Zero manual instrumentation for the critical path.
- **Structured logging**: JSON via Monolog's `JsonFormatter` with `dd.trace_id` and `dd.span_id` auto-injected. Concrete log format specified with Datadog-parseable fields.
- **Custom metrics**: 10 specific DogStatsD metrics defined (`b2b.request.count`, `b2b.request.duration`, `b2b.12go_api.count`, `b2b.12go_api.duration`, `b2b.12go_api.error_rate`, etc.) with `client_id` and `endpoint` tags.
- **Alerting**: Three concrete alert definitions (12go error rate > 5%, P95 latency > 5s, zero traffic canary) with severity levels and window sizes.
- **Correlation ID**: Reads `x-correlation-id` from inbound, sets as span tag, forwards to 12go calls.

#### Scores

- C4: Search Performance (x3): 3/5 -- Same PHP-FPM overhead as Pragmatic Minimalist; ID mapping loading unaddressed; sequential multi-call endpoints unaddressed
- C5: Simplicity (x3): 4/5 -- Single standalone service, small codebase (~2500 LOC estimated). Loses a point vs Clean Slate because a separate Symfony project still has Symfony's service container, config YAML, and bundle boilerplate
- C8: Infrastructure Fit (x2): 5/5 -- Identical to F3's containers. Same base image, same FPM config, same Datadog. DevOps copies existing config. Zero new infrastructure
- C9: Disposability (x2): 2/5 -- No adapter boundary described. No outbound interface. No contract tests. When F3 is decomposed, this service has the same coupling problem as Pragmatic Minimalist, but as a separate deployment it is at least independently replaceable
- C10: Elegance (x1): 3/5 -- The infrastructure design is elegant and operationally mature. The application architecture is not designed at all -- the design says what wraps the code but not how the code is structured
- C11: Monitoring/Observability (x1): 5/5 -- The most complete observability design. Concrete metrics, alerting rules, structured logging format, health check endpoint, on-call runbook

---

### Data Flow Architect

#### Boundary Clarity

The Data Flow Architect design is focused on the event/data pipeline rather than the HTTP proxy architecture. It proposes a "Dual-Mode Event Emission" pattern with a `B2bEventEmitter` service that wraps Kafka producers for analytics events. The design does not describe the HTTP handler -> 12go client boundary in detail. The architecture diagram shows `B2B Proxy Service` as a single box with event emission as the primary architectural concern.

The design is language-agnostic (recommends PHP/Symfony for alignment but notes the pattern works in any language). It proposes a structured event schema with per-endpoint event specifications (27 event types across 13 endpoints). This is the most thorough event design of any proposal.

However, from a technical architecture perspective, the event emission layer is orthogonal to the proxy architecture. The design does not address how the proxy itself is structured -- it addresses what the proxy emits. This makes it difficult to evaluate boundary clarity, error handling, or concurrency model.

#### Error Handling Robustness

Not addressed. The design focuses on events, not on how errors are handled in the request path. Error events are defined (`b2b.search.failed`, `b2b.booking.failed`) but the mechanism for producing them (how does the code decide a search failed?) is not described.

#### Concurrency Model Assessment

Not addressed. The design defers to the language/framework choice for concurrency model.

#### Performance Estimate

The event emission layer adds overhead: Kafka producer calls on the hot path (even async ones) add latency. The design proposes "fire-and-forget async emission" which minimizes hot-path impact but still requires serialization of the event payload.

- **Search latency overhead**: +1-3ms for event emission on top of whatever the base proxy adds. The Kafka producer serialization and network buffer flush are the cost.
- **Throughput ceiling**: Kafka producers are the bottleneck concern. With async emission, the proxy throughput is unaffected, but Kafka cluster sizing becomes a consideration.
- **Memory footprint**: Kafka producer buffers add ~20-50MB to the base proxy footprint.

#### Resilience Design

The design proposes a "Circuit Breaker for Event Emission" -- if Kafka is unavailable, events are dropped (not queued indefinitely) to prevent backpressure from affecting the proxy's primary function. This is thoughtful: the proxy should not fail because the analytics pipeline is down.

However, the proxy's own resilience (12go timeouts, retries, partial responses) is not addressed.

#### Observability Design

The event-first approach means observability is built into the architecture. Every endpoint emits a structured event with timing breakdowns (`total_ms`, `upstream_ms`, `transform_ms`), client context (`client_id`, `correlation_id`), and error details. These events flow to ClickHouse for analytics.

Custom DogStatsD metrics are proposed for real-time dashboards. The design includes a concrete Kafka topic structure and event schema standard.

However, the distributed tracing story (Datadog APM propagation through 12go calls) is not addressed. The events are a parallel observability channel, not a replacement for trace-level debugging.

#### Scores

- C4: Search Performance (x3): 3/5 -- Event emission adds marginal latency; the base proxy architecture is unaddressed so performance depends entirely on whichever proxy design is adopted alongside this event layer
- C5: Simplicity (x3): 2/5 -- Adding Kafka producers, event schemas, dual-mode emission (Kafka + Datadog), and 27 event types to a 13-endpoint proxy significantly increases complexity. For a solo developer, this is a substantial amount of additional code to write, test, and maintain
- C8: Infrastructure Fit (x2): 4/5 -- 12go already has Kafka. But the B2B service adding its own Kafka producer means a new producer client in the fleet, new topics to create and manage, new consumer configuration for the data pipeline. Not zero-config
- C9: Disposability (x2): 2/5 -- The event schema is well-defined and durable, but the proxy architecture has no adapter boundary. The event layer itself would survive F3 decomposition (events are backend-agnostic) but the proxy code would not
- C10: Elegance (x1): 2/5 -- The event design is thorough and well-structured, but it is solving a different problem than the one at hand. The primary problem is a proxy; the event layer is a secondary concern. Applying a full event architecture to a thin translation layer is over-engineering from a proxy perspective, even if the events themselves are valuable
- C11: Monitoring/Observability (x1): 4/5 -- Excellent event-level observability with structured schemas and timing breakdowns. Loses a point because Datadog APM trace propagation is not addressed, and the distributed tracing story through 12go calls is missing

---

### Team-First Developer

#### Boundary Clarity

The Team-First Developer recommends PHP/Symfony inside F3 (same as Pragmatic Minimalist) but provides a more detailed codebase structure. The separation is: `Controller/` (HTTP handlers), `Service/` (mappers and 12go client), `DTO/Request/` (TC-format types), `DTO/Response/` (TC-format types), `DTO/TwelveGo/` (12go types). The `TwelveGoClient.php` is a separate service class.

This is a meaningful organizational separation: the 12go types live in their own namespace (`DTO/TwelveGo/`), the mappers are separate services (`SearchMapper.php`, `BookingSchemaMapper.php`), and the controllers do not directly reference 12go types -- they call mapper services that return TC-format DTOs.

However, there is no formal outbound interface. The controllers call `TwelveGoClient` directly (through Symfony DI). The 12go client is a concrete class, not an interface implementation. Replacing the 12go client requires changing the DI binding and the client class, but the controllers' dependency on the mapper service signatures provides some isolation.

The design proposes an `AGENTS.md` context file for AI tool navigation, which is a novel approach to maintainability.

#### Error Handling Robustness

Not explicitly designed. The design focuses on developer experience patterns: "explicit error handling -- catch 12go HTTP errors and map to TC error responses" is stated as a principle, but no error mapping table or timeout strategy is provided. The design defers to Symfony's HTTP client error handling.

#### Concurrency Model Assessment

Same PHP-FPM model as Pragmatic Minimalist and Platform Engineer. The design does not address parallel 12go calls for multi-step endpoints or the per-request ID mapping loading problem.

#### Performance Estimate

- **Search latency overhead**: ~10-20ms. Same PHP overhead as other PHP designs, but embedded in F3 means the request passes through F3's full Symfony kernel (including middleware, event listeners, etc. for the monolith). The F3 kernel boot for each request includes code that has nothing to do with B2B -- this is shared infrastructure overhead.
- **Throughput ceiling**: Shared with F3's worker pool. B2B requests compete with F3's consumer-facing traffic for FPM workers. No independent scaling.
- **Memory footprint**: Shared with F3. No additional container overhead.

#### Resilience Design

Not addressed. The design focuses on developer workflow, not production resilience.

#### Observability Design

Inherits F3's Datadog APM automatically. The `B2bRequestSubscriber` enriches spans with `client_id`. Monolog structured logging with GELF. The design does not propose custom metrics or alerting rules.

#### Scores

- C4: Search Performance (x3): 2/5 -- F3's full Symfony kernel overhead on every B2B request; shared FPM worker pool means B2B latency is affected by F3 load; per-request ID mapping loading not addressed; no parallel multi-call endpoints
- C5: Simplicity (x3): 4/5 -- One codebase (inside F3), clear file structure, ~2500-3500 LOC estimated. But living inside F3 means the developer must navigate F3's larger codebase for routing, DI configuration, and debugging
- C8: Infrastructure Fit (x2): 5/5 -- Inside F3 means zero additional infrastructure. Not even an additional container
- C9: Disposability (x2): 3/5 -- Better than Pragmatic Minimalist due to explicit namespace separation (DTO/TwelveGo/ vs DTO/Response/) and mapper service isolation. The mappers are pure functions that can be preserved. But no formal interface means the boundary is convention-enforced, not type-enforced. Under deadline pressure, shortcuts through the boundary are easy
- C10: Elegance (x1): 3/5 -- Good organizational structure with clear naming conventions. The AGENTS.md pattern for AI navigability is clever. But the design does not address the proxy's architectural concerns -- it addresses the developer's experience of working with the proxy
- C11: Monitoring/Observability (x1): 3/5 -- Inherits F3's Datadog APM. B2bRequestSubscriber for span enrichment. But no custom metrics, no alerting, no health check (health check is F3's concern)

---

### Disposable Architecture

#### Boundary Clarity

The Disposable Architecture design has the strongest boundary design of all six proposals. It proposes a ports-and-adapters structure:

- **Inbound ports** (`ports/inbound/`): HTTP handlers for all 13 endpoints
- **Outbound ports** (`ports/outbound/`): Formal interfaces (`ITravelProvider`, `IBookingProvider`, `IPostBookingProvider`, `INotificationSink`)
- **Adapters** (`adapters/twelvego/`): Current 12go implementation of the outbound interfaces
- **Domain** (`domain/models/`): Types defined by the client contract, not by 12go

The outbound interfaces are defined in terms of domain types, not 12go types. `ITravelProvider.Search()` returns a `SearchResult`, not an `OneTwoGoSearchResponse`. This is the critical architectural decision: the mapping from 12go's response to domain types happens inside the adapter. When F3 is decomposed, a new adapter implements the same interface.

The design also proposes contract test fixtures (language-agnostic HTTP request/response pairs) that survive reimplementation. The testing strategy explicitly separates "ACL unit tests" (permanent, test client contract) from "adapter unit tests" (disposable, test 12go mapping). The survivability analysis estimates 40% permanent / 60% disposable code, which is a realistic breakdown.

#### Error Handling Robustness

Error handling is addressed at the boundary level: the design defines an error surface table mapping 12go errors to client expectations (400 with fields -> field-level validation, "Trip is no longer available" -> 404, timeout -> 504 or 202). The adapter is responsible for translating 12go errors to domain error types; the inbound handlers translate domain errors to HTTP responses. This two-step translation is correct for a port/adapter architecture.

However, the design does not specify timeout budgets, retry policies, or partial response handling in detail. It defers to the adapter implementation.

#### Concurrency Model Assessment

The design is language-agnostic and does not specify a concurrency model. It evaluates PHP, .NET, and Go for boundary expressiveness, noting that .NET provides the strongest compile-time boundary enforcement while PHP provides convention-based enforcement. The concurrency model depends on the language choice, which is left as "a separate decision."

For the outbound interfaces, the design notes that `ITravelProvider.Search()` is a single-call operation while `IBookingProvider.GetSchema()` orchestrates multiple 12go calls. The multi-call orchestration lives in the adapter, not in the handler. This is architecturally correct.

#### Performance Estimate

The adapter indirection adds one layer of function call overhead (~negligible) compared to direct 12go client calls. The domain type construction (creating `SearchResult` from 12go types inside the adapter) is comparable to the transformation overhead in other designs. The performance characteristics depend on the language choice:

- **If Go**: ~2-5ms overhead (similar to Clean Slate + one extra layer of abstraction)
- **If PHP**: ~10-18ms overhead (similar to other PHP designs + adapter layer)
- **If .NET**: ~3-6ms overhead (strong serialization performance + adapter layer)

The adapter pattern does NOT add meaningful latency. The indirection is a function call, not a network hop or serialization boundary.

- **Throughput ceiling**: Language-dependent
- **Memory footprint**: Language-dependent + the outbound port interfaces add no memory overhead

#### Resilience Design

- **Circuit breaker**: Not explicitly proposed. The adapter boundary is where a circuit breaker would naturally live (inside the adapter, transparent to the handler).
- **Retry policy**: Not specified. Would live inside the adapter.
- **Timeout strategy**: Not specified. Context/cancellation propagation through the adapter interface is implied but not designed.
- **Seat lock TTL**: "Fake implementation initially, switch to 12go native endpoint when available" -- managed in the adapter.
- **Notification delivery**: Webhook handler separates inbound verification (pluggable `IWebhookVerifier` interface with `NullVerifier` -> `IpAllowlistVerifier` -> `HmacSignatureVerifier` progression) from notification transformation and delivery. The verifier interface is well-designed for evolution.
- **Feature flags**: `b2b_client_config` table in MariaDB with per-client on/off state. Loaded into memory at startup, refreshed periodically.

#### Observability Design

Not the primary focus. The design defers to the Platform Engineer's observability recommendations. The contract test fixtures provide behavioral observability (does the system still produce correct output?), but runtime observability (metrics, traces, logs) is not designed.

The `IWebhookVerifier` interface design implies structured logging at the verification boundary, but this is not specified.

#### Scores

- C4: Search Performance (x3): 3/5 -- Language-agnostic; the adapter pattern adds negligible overhead but the design does not commit to a language with specific performance characteristics. If Go, this would be 5/5; if PHP, 3/5
- C5: Simplicity (x3): 3/5 -- The ports-and-adapters pattern adds structural complexity compared to a flat proxy. Four namespaces (ports/inbound, ports/outbound, adapters/twelvego, domain) instead of three layers. For a solo developer, the boundary discipline requires constant vigilance. However, the design is explicit about which code is permanent and which is disposable, which is a form of simplicity
- C8: Infrastructure Fit (x2): 3/5 -- Language-agnostic, so infrastructure fit depends on the choice. The MariaDB table for client config uses existing infrastructure. But the design does not commit to a deployment model
- C9: Disposability (x2): 5/5 -- This is the reference design for disposability. Formal outbound interfaces, domain types independent of 12go, language-agnostic contract tests, explicit survivability analysis (40% permanent / 60% disposable). When F3 is decomposed, the replacement path is clear: implement new adapter against new API, run existing contract tests
- C10: Elegance (x1): 4/5 -- The ports-and-adapters pattern is the correct pattern for a system sitting between two moving targets (locked-in client contract, changing backend). The pattern matches the problem. Loses a point because the pattern adds complexity that a simple proxy does not strictly need today -- it is an investment in future replaceability
- C11: Monitoring/Observability (x1): 2/5 -- Not addressed. Defers to other designs. The contract test fixtures are a form of behavioral observability but not runtime observability

---

## Comparative Scoring Matrix

| Design | C4 Performance (x3) | C5 Simplicity (x3) | C8 Infra Fit (x2) | C9 Disposability (x2) | C10 Elegance (x1) | C11 Observability (x1) | Weighted Total |
|---|---|---|---|---|---|---|---|
| Pragmatic Minimalist | 3 | 4 | 5 | 2 | 3 | 2 | 3(3)+3(4)+2(5)+2(2)+1(3)+1(2) = 9+12+10+4+3+2 = **40** |
| Clean Slate Designer | 5 | 5 | 2 | 3 | 5 | 2 | 3(5)+3(5)+2(2)+2(3)+1(5)+1(2) = 15+15+4+6+5+2 = **47** |
| Platform Engineer | 3 | 4 | 5 | 2 | 3 | 5 | 3(3)+3(4)+2(5)+2(2)+1(3)+1(5) = 9+12+10+4+3+5 = **43** |
| Data Flow Architect | 3 | 2 | 4 | 2 | 2 | 4 | 3(3)+3(2)+2(4)+2(2)+1(2)+1(4) = 9+6+8+4+2+4 = **33** |
| Team-First Developer | 2 | 4 | 5 | 3 | 3 | 3 | 3(2)+3(4)+2(5)+2(3)+1(3)+1(3) = 6+12+10+6+3+3 = **40** |
| Disposable Architecture | 3 | 3 | 3 | 5 | 4 | 2 | 3(3)+3(3)+2(3)+2(5)+1(4)+1(2) = 9+9+6+10+4+2 = **40** |

---

## Technical Architecture Recommendation

**Clean Slate Designer (Go)** produces the best overall technical architecture, scoring highest on performance, simplicity, and elegance. Its search latency overhead (~2-4ms) is the lowest by a factor of 3-5x compared to PHP designs. Its codebase size (~35 files, ~2000 LOC) is the smallest. Its concurrency model (goroutines) is the best fit for an I/O-bound proxy with multi-call endpoints.

However, the Clean Slate design scores poorly on Infrastructure Fit (2/5) because Go is foreign to 12go's operational fleet. This is not a language prejudice -- it is a concrete operational risk: the DevOps team cannot debug Go processes, set meaningful alerting thresholds, or perform the standard PHP-FPM diagnostic steps they rely on at 3am.

**If Infrastructure Fit is the binding constraint**, the strongest PHP design combines:
1. **Platform Engineer's** standalone Symfony approach (independent scaling, blast radius isolation, complete observability design)
2. **Disposable Architecture's** adapter boundary pattern (outbound interfaces, domain types, contract tests)
3. **Team-First Developer's** namespace organization (clear DTO separation, mapper service isolation)

This composite would be a standalone PHP/Symfony service with formal outbound interfaces, scoring approximately: C4=3, C5=3, C8=5, C9=4, C10=4, C11=5 = 3(3)+3(3)+2(5)+2(4)+1(4)+1(5) = 9+9+10+8+4+5 = **45**, competitive with the Clean Slate score.

**The single design I would build**, evaluating architecture quality alone and ignoring team considerations: Clean Slate Designer's Go proxy with the Disposable Architecture's adapter boundary bolted in. Three layers become four: handler -> endpoint logic -> outbound interface -> 12go adapter. The 12go adapter is explicitly disposable. The inbound contract is tested with OpenAPI validation. Total overhead: ~3-5ms, ~40 files, ~2500 LOC. Operationally, it would require investing 2-3 days in Go-specific Docker health checks, Datadog instrumentation, and a deployment runbook for the DevOps team.

---

## Cross-Design Technical Observations

### 1. The ID Mapping Loading Problem Is Under-Addressed

Every design requires station, operator, POI, and seat class ID mappings on the hot path (every search request does bidirectional station ID translation). Go and .NET designs solve this trivially with in-memory maps loaded at startup. PHP designs have a fundamental tension: FPM's per-request model means either loading thousands of mapping entries per request (unacceptable latency), using Redis for lookups (adds 1-5ms per search), or switching to a persistent-worker model (Swoole/RoadRunner, which changes PHP's operational profile entirely). No PHP design adequately addresses this. The Platform Engineer's design does not mention it. The Pragmatic Minimalist mentions Redis. Neither quantifies the impact.

### 2. Multi-Call Endpoint Parallelism Is Unaddressed in PHP Designs

GetItinerary requires three 12go API calls (trip details + add to cart + checkout schema). In Go, these are trivially parallelized with `errgroup`. In .NET, `Task.WhenAll()`. In PHP-FPM's synchronous model, these calls run sequentially unless Symfony's async HTTP client is explicitly used. None of the PHP designs mention this. The difference between 3 sequential calls (~600ms total if each takes ~200ms) and 3 parallel calls (~200ms total) is significant for the second-most-latency-sensitive endpoint.

### 3. No Design Proposes a Circuit Breaker, and That Is Correct

For a single-upstream proxy where 12go is the sole backend, a circuit breaker has limited value. If 12go is down, opening the circuit breaker just returns errors faster -- there is no fallback. The only benefit is preventing FPM worker exhaustion (all workers blocked on a dead upstream), which is addressed by per-request timeouts. The absence of circuit breakers across all designs reflects correct engineering judgment.

### 4. The Disposable Architecture Pattern Is Orthogonal to Language Choice

The adapter boundary pattern (outbound interface defined in domain terms, 12go-specific code behind the interface) works in Go, PHP, and .NET. The Clean Slate Designer's package-level separation in Go is a lightweight version of the same idea. The Disposable Architecture design correctly notes this: "The pattern is portable; the deployment model is a separate decision." Any final design should adopt this pattern regardless of language.

### 5. Observability Has a Natural Owner

The Platform Engineer design is the only one with a production-ready observability specification (10 metrics, 3 alerts, structured log format, health check endpoint). This design should be the reference for observability regardless of which architecture or language is chosen. Its `b2b.` metric prefix, DogStatsD integration pattern, and alert definitions are directly usable.

### 6. Contract Testing Is Under-Specified Everywhere Except Disposable Architecture

Only the Disposable Architecture proposes language-agnostic contract test fixtures that survive reimplementation. The Pragmatic Minimalist mentions shadow traffic. The Clean Slate Designer mentions OpenAPI validation. But only the Disposable Architecture designs test artifacts that explicitly survive the F3 decomposition. Given that F3 refactoring is confirmed for Q2 planning, contract tests are not academic -- they are the most durable artifact of this entire project.
