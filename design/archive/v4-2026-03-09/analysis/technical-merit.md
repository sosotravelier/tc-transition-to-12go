---
status: complete
last_updated: 2026-03-17
agent: technical-merit
---

# Technical Merit Analysis

## Architecture Quality Assessment

### Pragmatic Minimalist

#### Boundary Clarity

The Pragmatic Minimalist design proposes a single service that does "exactly what the current four services do after you strip away all the unnecessary layers." However, the design does not propose an explicit boundary between the client-facing layer and the 12go-facing layer. The architecture is described as "functions that receive HTTP requests and make HTTP calls" -- there is no adapter interface, no domain model, and no formal separation between the inbound contract types and the outbound 12go types.

The design explicitly recommends PHP inside F3 (the monolith), which means the 12go client cannot be replaced without touching the HTTP handlers: the handlers, the 12go client, and the response mappers are all colocated within the F3 codebase, sharing Symfony's service container and routing infrastructure. If F3's internal API surface changes during decomposition, the B2B code is directly in the blast radius.

The fallback option (standalone PHP Symfony service) would provide better boundary clarity, but the primary recommendation is monolith embedding.

#### Error Handling Robustness

The design inherits the existing error handling patterns documented in the codebase analysis: HTTP status code mapping (400->RequestArgumentException, 401->AuthenticationException, etc.) and the `ErrorResponse` parsing with fields/messages/reasons structure. It explicitly calls out that these patterns should be ported.

However, the design does not propose any new error handling strategy beyond porting the existing logic. Specifically:

- **12go timeout**: Not addressed. The existing 65s timeout is inherited but no circuit breaker or fallback is proposed.
- **Partial/malformed 12go response**: Not addressed. The existing deserialization logic either succeeds or throws.
- **Status code translation**: Inherited from existing code (12go 400 -> client 400, 12go 500 -> client 502).
- **Circuit breaker**: Not proposed. The design explicitly says "no caching layer," which means there is no fallback when 12go is slow or unavailable. For a proxy, this is acceptable -- a circuit breaker on a single upstream just converts slow failures to fast failures, which is marginal value.

#### Concurrency Model Assessment

The design recommends PHP-FPM, which uses process-based concurrency. Each FPM worker handles one request at a time. This model has well-understood failure modes:

- **Worker pool exhaustion**: If all workers are blocked waiting on 12go, new requests queue. Mitigated by configuring `pm.max_children` appropriately.
- **No goroutine leaks or event loop blocking**: Process isolation means one slow request cannot cascade.
- **Memory**: Request-scoped. No cross-request memory leaks by design.

The downside is that concurrent 12go calls within a single request (GetItinerary makes 3 calls) must be sequential in PHP-FPM unless async extensions are used. The design does not address this.

#### Performance Estimate

- **Search latency overhead**: ~8-15ms. PHP-FPM per-request bootstrap (OPcache mitigates to ~1-2ms), JSON deserialization of 12go search response via PHP's `json_decode` (~1-3ms for a large response), search response mapping/restructuring (~2-5ms), JSON serialization of client response (~1-3ms), HTTP connection overhead to 12go (reused via Guzzle/Symfony HttpClient persistent connections, ~0-2ms per reused connection).
- **Throughput ceiling**: ~200-400 req/s on a single container with 8 FPM workers. Bottleneck is I/O (12go API wait), not CPU. Each worker is blocked during the 12go call (typically 100-500ms for search), so throughput = workers / average_latency.
- **Memory footprint**: ~160-240MB (8 FPM workers at 20-30MB each). Container limit: 256MB.
- **Startup time**: ~2-3 seconds (FPM worker pool init).

The station ID mapping lookups are on the hot path (every search request), but an in-memory PHP array lookup (or APCu cache) is sub-microsecond and negligible.

Inside F3, there is additional overhead: the Symfony kernel boots with F3's full service container, routes, and middleware. This could add 2-5ms of framework overhead compared to a standalone Symfony app. OPcache mitigates this but does not eliminate it.

#### Resilience Design

- **Circuit breaker**: Not proposed. Acceptable for a single-upstream proxy.
- **Retry policy**: Defers to existing Polly exponential backoff pattern (conceptually). No specific retry strategy is proposed for the new service.
- **Timeout strategy**: Inherits 65s timeout from existing config (to accommodate 12go's 60s recheck). No per-operation timeouts proposed.
- **Seat lock TTL**: Defers to 12go's native implementation (being developed). No in-process TTL management needed.
- **Notification delivery**: Acknowledges the webhook forwarding problem but notes that "forward to where" is genuinely open. No retry strategy for client webhook delivery is proposed.

#### Observability Design

Inside F3, the design inherits F3's existing Datadog APM (`dd-trace-php` auto-instrumentation) and Monolog structured logging. This provides full trace propagation for incoming HTTP requests and outgoing 12go calls with zero additional code.

As a standalone service, the design would need to wire Datadog APM explicitly, but the PHP ecosystem support is well-documented.

The design does not specify custom metrics beyond what Datadog APM auto-instruments. It does not discuss the health check endpoint (though F3 presumably has one). It does not address correlation ID threading through 12go calls.

#### Scores

- C4: Search Performance (x3): 3/5 -- PHP-FPM adds per-request overhead (~8-15ms). Inside F3, the full framework boot path adds further latency. Connection pooling is available via Guzzle/Symfony HttpClient but not explicitly designed. Sequential 12go calls for GetItinerary (3 calls) is a weakness. Not bad, but not optimized.
- C5: Simplicity (x3): 5/5 -- The design's core philosophy is simplicity. "Just functions that receive HTTP requests and make HTTP calls." Single service, <5K LOC target, no abstractions beyond what a single-supplier proxy requires. The best simplicity story of any design.
- C8: Infrastructure Fit (x2): 5/5 -- Inside F3: zero infrastructure changes, zero new containers, zero DevOps burden. Even as a standalone PHP service: identical Docker image, identical FPM config, identical Datadog setup. Best infrastructure fit of any design.
- C9: Disposability (x2): 2/5 -- The primary recommendation (inside F3) has the worst disposability. There is no adapter boundary. No domain interfaces. No separation between 12go-specific code and client-facing code. When F3 is decomposed, the B2B code is collateral damage. The fallback (standalone PHP) is better but still lacks formal adapter boundaries that the Disposable Architecture proposes.
- C10: Elegance (x1): 4/5 -- The design matches the problem well. A proxy problem gets a proxy solution. The "should we rewrite at all?" analysis and the "unconventional idea" section demonstrate clear thinking about the problem-solution fit. Deducted one point because the monolith recommendation creates a mismatch between "this is just a proxy" and "embed it in a large codebase."
- C11: Monitoring/Observability (x1): 3/5 -- Inside F3, inherits good observability for free. But the design does not design observability; it inherits it passively. No custom metrics, no explicit correlation ID strategy, no health check design.

---

### Disposable Architecture

#### Boundary Clarity

This design has the **best boundary clarity of any proposal**. It proposes three explicit layers:

1. **Inbound Adapter** (semi-permanent): HTTP controllers, version negotiation, correlation headers, feature flag router.
2. **Domain Layer** (permanent): `IBookingGateway`, `ITripSearcher`, `INotificationSender` interfaces. Domain models (`Trip`, `Booking`, `Money`, `StationId`).
3. **Outbound Adapter** (disposable): `TwelveGoBookingGateway`, `TwelveGoTripSearcher`, `TwelveGoClient`, and all mappers.

The `IBookingGateway` interface is the critical boundary. It uses domain types only -- no 12go concepts leak through. The design explicitly labels which code is permanent, semi-permanent, and disposable. The outbound adapter can be replaced without touching controllers, domain logic, or contract tests.

The directory structure (`Adapters/Outbound/TwelveGo/`) physically isolates all 12go-specific code. When F3 is decomposed, "only the adapter implementation behind `IBookingGateway` changes."

#### Error Handling Robustness

The design proposes three-level testing that addresses error handling:

- **Mapper unit tests**: Test with recorded 12go responses (JSON fixtures), including error responses.
- **Adapter integration tests**: WireMock replays test the full adapter pipeline including error handling.
- **Contract tests**: Hurl files validate client-facing error responses.

The design does not explicitly detail how 12go timeouts, malformed JSON, or status code translation work beyond inheriting the existing patterns. However, the adapter boundary means all error handling is concentrated in the outbound adapter, making it easy to find and modify.

The design also proposes **drift detection**: periodically running the adapter against real 12go staging to detect API surface changes. This is a proactive error handling strategy that no other design proposes.

#### Concurrency Model Assessment

The design is language-agnostic by construction, deferring the concurrency model to the language choice. It evaluates C#, PHP, and Go. The concurrency characteristics depend on the chosen language:

- **.NET**: Thread pool with async/await. Well-understood.
- **PHP**: FPM process-based. Well-understood.
- **Go**: Goroutine-based. Well-understood.

The design does not specify which language to use, which is both a strength (it works in any) and a weakness (it does not commit to a performance profile).

#### Performance Estimate

Since the design is language-agnostic, the performance estimate depends on the implementation language:

- **Search latency overhead**: ~5-15ms depending on language. The adapter boundary adds one interface dispatch per call (negligible). The real overhead is serialization/deserialization and the mapping logic.
- **Throughput ceiling**: Language-dependent. The adapter boundary itself does not limit throughput.
- **Memory footprint**: The domain model types, mapping tables (~10K station entries), and in-memory caches are the same regardless of language. Estimated 100-256MB depending on runtime.

The feature flag infrastructure (DB table + in-memory cache with 30s refresh) adds a per-request lookup cost, but this is an in-memory hash map lookup -- sub-microsecond.

The **per-client + per-endpoint routing** via feature flags adds a conditional check per request (~1 microsecond). Negligible.

#### Resilience Design

- **Circuit breaker**: Not explicitly proposed, but the adapter boundary makes it trivial to add one wrapping `IBookingGateway`.
- **Retry policy**: Not explicitly designed. The adapter could implement retries internally.
- **Timeout strategy**: Not specified beyond noting 12go's 60s recheck timeout.
- **Seat lock TTL**: Not addressed (defers to 12go's native endpoint).
- **Notification delivery**: Proposes a dedicated `IWebhookAuthenticator` interface with swappable implementations. Webhook retry is not addressed.

The resilience design is structurally sound (the adapter boundary makes resilience patterns easy to add) but not explicitly implemented.

#### Observability Design

The design proposes:
- Inbound: Correlation ID middleware, version negotiation middleware.
- Outbound: All 12go calls go through `TwelveGoClient`, which is the natural instrumentation point.
- Contract tests via Hurl files validate response shapes including headers.

However, the design does not specify Datadog APM integration, custom metrics, or structured logging configuration. It notes that "PHP ecosystem benefits" (including Datadog APM tracing integration) are lost by not being in F3 and "must be wired explicitly."

#### Scores

- C4: Search Performance (x3): 3/5 -- Language-agnostic design means performance depends on implementation choice. The adapter boundary adds negligible overhead (interface dispatch). The feature flag routing adds negligible overhead. But the design does not commit to connection pooling, does not address sequential vs. parallel 12go calls, and does not estimate specific latency numbers. Same fundamental performance as any well-implemented proxy in the chosen language.
- C5: Simplicity (x3): 3/5 -- Single service, but with three explicit layers, domain interfaces, contract tests, feature flag infrastructure, and a database table for flags. The adapter boundary pattern adds structural complexity beyond a simple proxy. The Hurl contract tests, WireMock fixtures, and drift detection are valuable but represent additional moving parts. The design acknowledges this: "The adapter boundary pattern requires more upfront design than a simple pass-through proxy."
- C8: Infrastructure Fit (x2): 3/5 -- The design explicitly says it "avoids embedding in F3" and is language-agnostic. If implemented in .NET, infrastructure fit is poor (new runtime for DevOps). If in PHP standalone, infrastructure fit is good. If in Go, infrastructure fit is moderate. The design does not commit, so I score based on the average case. The MariaDB table for feature flags fits 12go's existing infrastructure.
- C9: Disposability (x2): 5/5 -- This is the defining criterion for this design, and it achieves it fully. The adapter boundary is clean. The `IBookingGateway` interface uses domain types only. The outbound adapter is physically isolated in `Adapters/Outbound/TwelveGo/`. Contract tests validate the permanent boundary. Survivability analysis shows ~60% of the codebase survives F3 decomposition. The most expensive replacement is the booking schema mapper (~500 lines) -- everything else is straightforward. This is the reference design for disposability.
- C10: Elegance (x1): 4/5 -- The separation of concerns is natural and well-motivated. Permanent vs. disposable labeling is a clear organizing principle. The survivability analysis table is an excellent design artifact. However, the three-layer architecture is borderline over-engineered for a 13-endpoint proxy -- the domain layer with its interfaces and domain models adds a translation step that a simpler proxy would skip.
- C11: Monitoring/Observability (x1): 2/5 -- The design is architecturally sound for observability (clear instrumentation points at the adapter boundary) but does not specify the actual observability implementation. No Datadog APM design, no structured logging format, no custom metrics, no health check endpoint. These are noted as "must be wired explicitly" but not designed.

---

### Data Flow Architect

#### Boundary Clarity

The Data Flow Architect design focuses on event emission and correlation, not on the proxy architecture itself. The boundary between client-facing and 12go-facing concerns is implicit in the data flow diagrams but not architecturally specified. The design shows:

```
Request Handler -> 12go API -> Response Transformer -> Event Emitter
```

The "Request Handler" and "Response Transformer" are separate conceptual boxes in the diagram, but no interface or adapter boundary is proposed. The 12go client is assumed to exist but its isolation from the HTTP handlers is not designed.

#### Error Handling Robustness

The design addresses error handling primarily through event emission. Every endpoint has a corresponding `*_failed` event type (`b2b.search.failed`, `b2b.booking.reserve_failed`, etc.) with error codes and descriptions. This provides excellent observability into errors but does not specify how errors are handled at the application level.

12go timeout handling, partial response handling, and status code mapping are not addressed.

#### Concurrency Model Assessment

The design recommends PHP/Symfony. The concurrency model is PHP-FPM (process-based), same as the Pragmatic Minimalist and Platform Engineer designs. The key concurrency consideration is the `kernel.terminate` event for post-response event emission -- this fires after the response is sent to the client, ensuring event emission does not block the request path. This is a well-designed concurrency pattern.

#### Performance Estimate

- **Search latency overhead**: ~8-12ms for the proxy transformation. Event emission via `kernel.terminate` adds zero client-facing latency. The structured logging approach (JSON to stdout) adds sub-millisecond per event, but this happens after the response is sent.
- **Throughput ceiling**: Same as PHP-FPM: ~200-400 req/s per container with 8 workers. Event emission does not affect throughput because it is post-response.
- **Memory footprint**: ~160-240MB (8 FPM workers). The event emission adds negligible memory overhead (one structured log line per request).

The key performance insight in this design is correct: events are emitted AFTER the HTTP response, using Symfony's `kernel.terminate` lifecycle hook. This is the right pattern for a latency-sensitive proxy that also needs to emit telemetry.

#### Resilience Design

- **Circuit breaker**: Not proposed.
- **Retry policy**: Not discussed for 12go calls. The structured log pipeline has inherent unreliability (logs can be dropped under load), which the design acknowledges.
- **Timeout strategy**: Not specified.
- **Event delivery**: The design explicitly evaluates event delivery guarantees (Kafka vs. structured logs vs. direct ClickHouse) and recommends structured logs with the caveat that they can drop events. This is an honest trade-off.
- **Notification delivery**: The webhook flow includes event emission (`b2b.notification.received`) but does not address client webhook retry.

#### Observability Design

This is the **strongest observability design** of any proposal. It specifies:

- **17 event types** with full JSON schema examples for every significant endpoint.
- **Correlation ID strategy**: End-to-end from client header through 12go's `x-request-id` to ClickHouse queries.
- **Performance breakdown**: Every event includes `total_latency_ms`, `twelvego_latency_ms`, and `transform_latency_ms`.
- **Per-client dimensions**: Every event includes `client_id` for per-client analytics.
- **Structured logging pipeline**: JSON to stdout -> Datadog Agent -> Datadog Logs + ClickHouse.
- **ClickHouse query examples** for tracing a user journey.

The design also correctly identifies the 12go propagation limitations: `x-request-id` reaches 12go's GELF logs but not Datadog APM spans. Cross-system tracing requires querying both systems by correlation ID.

#### Scores

- C4: Search Performance (x3): 3/5 -- Same PHP-FPM overhead as other PHP designs. The post-response event emission via `kernel.terminate` is the right pattern and adds zero client latency. But the design does not address connection pooling, parallel 12go calls, or response transformation optimization.
- C5: Simplicity (x3): 3/5 -- The event emission infrastructure adds significant conceptual complexity. 17 event types with JSON schemas, a correlation ID propagation strategy, a structured logging pipeline, and ClickHouse integration are not simple. The proxy itself is simple, but the telemetry layer doubles the design surface area.
- C8: Infrastructure Fit (x2): 4/5 -- PHP/Symfony aligns with 12go infrastructure. Structured logging via Monolog uses 12go's existing Datadog Agent. The design explicitly avoids new infrastructure (no Kafka producer for Phase 1). The ClickHouse pipeline is the one new component, but it uses existing Datadog log forwarding.
- C9: Disposability (x2): 2/5 -- No adapter boundary is proposed. The design focuses on events and correlation, not on architectural isolation. When F3 is decomposed, the event schemas survive (they are format specifications), but the proxy code has no clean seam for replacement. The event schema is designed as language-agnostic, which helps portability.
- C10: Elegance (x1): 3/5 -- The event design is thorough and well-motivated. The post-response emission pattern is correct. But the design is incomplete as an architecture proposal -- it designs the observability layer without designing the proxy architecture itself.
- C11: Monitoring/Observability (x1): 5/5 -- The best observability design of any proposal. Comprehensive event schema, end-to-end correlation, per-client dimensions, performance breakdowns, ClickHouse integration, and an honest assessment of cross-system tracing limitations.

---

### Team-First Developer

#### Boundary Clarity

The design proposes a standalone PHP Symfony service with this structure:

```
Controller/ -> TwelveGo/ (HTTP client + DTOs) -> Mapper/ (pure transforms) -> Contract/ (client types)
```

The `TwelveGo/` directory contains the 12go HTTP client and all 12go-specific types. The `Mapper/` directory contains pure transformation functions. The `Contract/` directory contains client-facing response types.

This provides functional separation but not interface-level isolation. There are no domain interfaces (`IBookingGateway` or equivalent). The design explicitly advises against interfaces for single-implementation classes: "Do NOT create interfaces for classes with single implementations." This means the 12go client cannot be swapped without changing the controller code that calls it.

The boundary is implicit (directory-based) rather than explicit (interface-based).

#### Error Handling Robustness

The design addresses error handling through:
- An `ErrorResponseMiddleware.php` in the middleware layer.
- Controller-level error handling that catches HTTP errors from `TwelveGoClient` and throws domain exceptions.

However, specific error handling strategies (12go timeout, partial response, status code mapping) are not detailed. The focus is on developer experience and AI-friendliness of the codebase structure, not on resilience patterns.

#### Concurrency Model Assessment

PHP-FPM, same as other PHP designs. Process-based concurrency with request-scoped memory. The design's Docker Compose setup is minimal: just the PHP application container and optionally WireMock. No Redis, no Kafka, no MariaDB dependency.

The design explicitly notes that the inner loop is fast: "edit -> save -> curl (or test runner) -> see result. No compilation step. No container restart."

#### Performance Estimate

- **Search latency overhead**: ~5-10ms. Standalone Symfony (without F3's full service container) boots faster than F3. PHP-FPM with OPcache. Guzzle/Symfony HttpClient with persistent connections for 12go calls.
- **Throughput ceiling**: ~200-400 req/s per container (8 FPM workers).
- **Memory footprint**: ~160-240MB (8 workers at 20-30MB each).
- **Startup time**: ~2-3 seconds.

The standalone service avoids F3's framework overhead, giving it a slight performance advantage over the Pragmatic Minimalist's monolith recommendation.

#### Resilience Design

Not addressed in detail. The design focuses on developer experience, not on resilience patterns. No circuit breaker, no retry policy, no explicit timeout configuration beyond what Symfony HttpClient provides by default.

#### Observability Design

The design proposes:
- Structured logging with Monolog (JSON format for Datadog).
- Correlation ID propagation via `CorrelationIdMiddleware.php`.
- Datadog APM via `dd-trace-php` extension.
- Health check endpoint.
- Per-request correlation ID in every log entry.

The debugging workflow is well-designed: "Find the correlation ID from the client error report -> Search Datadog logs -> See the full request/response flow." This is practical and effective.

However, custom metrics beyond what Datadog auto-instruments are not specified. No alerting strategy, no per-client monitoring dimensions.

#### Scores

- C4: Search Performance (x3): 3/5 -- Same PHP-FPM characteristics as other PHP designs. Standalone Symfony avoids F3's overhead. Connection pooling available via Symfony HttpClient. No explicit optimization for the search hot path.
- C5: Simplicity (x3): 4/5 -- Single service, clean directory structure, no abstractions beyond what is needed. The explicit "Patterns to Avoid" list (no provider pattern, no repository pattern, no interfaces for single implementations) prevents over-engineering. The AGENTS.md file is a simplicity-enabling artifact. Slightly more structured than the Pragmatic Minimalist (has `Mapper/`, `Contract/`, `Middleware/` separation) but this structure serves clarity, not complexity.
- C8: Infrastructure Fit (x2): 4/5 -- Standalone PHP Symfony service. Same runtime as F3, same Docker image base, same Datadog APM. Slightly below the Pragmatic Minimalist's F3 embedding (which is zero-infrastructure-change) because it requires a new container deployment, but identical to F3 in technology stack.
- C9: Disposability (x2): 3/5 -- Better than the Pragmatic Minimalist (standalone service, not embedded in F3) but worse than the Disposable Architecture (no formal adapter boundary). The `TwelveGo/` directory provides physical isolation of 12go code. The "Translator Test Suite" concept (language-independent test fixtures) would improve disposability if implemented, but it is described as "rejected as the primary strategy." The AI-friendly codebase structure (small files, pure mappers) makes future rewrites easier.
- C10: Elegance (x1): 3/5 -- The design is pragmatic and well-structured, but not architecturally distinctive. The strong focus on developer experience and AI-friendliness is appropriate for the problem, but the architecture patterns are standard Symfony MVC. The "Patterns to Avoid" list is more interesting than the patterns chosen.
- C11: Monitoring/Observability (x1): 3/5 -- Datadog APM auto-instrumentation, structured logging, correlation ID propagation. Practical and effective. Not as comprehensive as the Data Flow Architect's event schema design, but more concrete than the Disposable Architecture's placeholder.

---

### Platform Engineer

#### Boundary Clarity

The design proposes a standalone PHP Symfony service with the same directory structure as the Team-First Developer design. The architecture is described through the infrastructure lens: "It receives requests from B2B clients in one shape, translates them, calls 12go's HTTP API, translates the response back, and returns it."

No formal adapter boundary or domain interface is proposed. The client configuration (API key mapping) lives in a MariaDB table, loaded at startup or per-request with cache. The 12go client configuration lives in `.env` files.

The boundary between client-facing and 12go-facing concerns is implicit in the directory structure, not enforced by interfaces.

#### Error Handling Robustness

The design's on-call runbook addresses error handling from an operational perspective:
- "If 12go is returning 500s: check 12go status, nothing to do on our side"
- "If 12go is returning 400s: check request transformation logic"
- "If B2B proxy itself is erroring: look at PHP error logs"

This is operationally sound but does not specify application-level error handling patterns. PHP-FPM's `request_terminate_timeout = 65s` handles the 12go timeout case at the process level (kill the worker after 65s).

#### Concurrency Model Assessment

PHP-FPM with `pm = static` and 8 workers. The design provides specific configuration:

```ini
pm = static
pm.max_children = 8
pm.max_requests = 1000
request_terminate_timeout = 65s
```

The rationale is solid: static pool is more predictable for fixed resource limits. `max_requests = 1000` prevents memory creep. `65s` timeout exceeds 12go's 60s recheck maximum.

Failure mode analysis: "502 if FPM is down, 504 if upstream (12go) times out, memory limit exceeded per-request (restart worker, next request succeeds)." These are well-understood PHP-FPM failure modes.

#### Performance Estimate

- **Search latency overhead**: ~8-12ms (same as other standalone PHP designs). The design provides the most detailed resource specification of any proposal.
- **Throughput ceiling**: Explicitly calculated: 8 workers / average_latency. At 200ms average search latency, throughput = 40 req/s per container. At 100ms, 80 req/s. This is a realistic estimate.
- **Memory footprint**: Explicitly specified: 128MB request, 256MB limit. 8 workers at 20-30MB each = 160-240MB steady state.
- **Startup time**: ~2-3 seconds.
- **Container size**: ~80-120MB (php:8.3-fpm-alpine + Composer deps + Datadog ext).
- **Build time**: ~2-3 minutes.

#### Resilience Design

- **Circuit breaker**: Not proposed. The health check design explicitly separates liveness from 12go availability: "If 12go is down, the service is still 'healthy' -- it will return errors to callers, but it should not be killed and restarted." This is the correct design philosophy for a proxy.
- **Retry policy**: Not explicitly designed for 12go calls.
- **Timeout strategy**: `request_terminate_timeout = 65s` at the FPM level. Symfony HttpClient timeout should be set to match.
- **Graceful shutdown**: PHP-FPM SIGTERM handling with `process_control_timeout = 30s`. In-flight requests complete before shutdown.

#### Observability Design

This design has the **most detailed infrastructure-level observability specification**:

- **Datadog APM**: `dd-trace-php` auto-instrumentation. Explicit environment variables (`DD_SERVICE=b2b-proxy`, `DD_TRACE_SAMPLE_RATE=1.0`, `DD_LOGS_INJECTION=true`).
- **Auto-instrumented spans**: Incoming Symfony HTTP requests + outgoing Guzzle/HttpClient calls. "For this service, the automatic instrumentation covers everything we need."
- **Manual instrumentation**: Business-level span tags (`client_id`, `booking_id`). Example code provided.
- **Correlation ID**: Middleware with Datadog trace ID fallback. Code example.
- **Structured logging**: Monolog JSON format with `dd.trace_id` and `dd.span_id` injection.
- **Custom metrics**: 7 metrics with specific types (Counter, Histogram) and tag dimensions (`endpoint`, `client_id`, `status_code`).
- **Alerting**: 6 alerts with thresholds, severities, and channels.
- **On-call runbook**: Step-by-step debugging procedures for 4 failure scenarios.

#### Scores

- C4: Search Performance (x3): 3/5 -- Same PHP-FPM overhead as other PHP designs. The detailed resource specifications are excellent for capacity planning but do not change the fundamental latency characteristics. No explicit search optimization (connection pooling, parallel calls, hot-path optimization).
- C5: Simplicity (x3): 4/5 -- Standalone PHP Symfony service. Same simplicity as the Team-First Developer design. The on-call runbook, CI/CD pipeline specification, and resource limits add operational documentation without adding code complexity.
- C8: Infrastructure Fit (x2): 5/5 -- This is the defining criterion for this design. Every infrastructure detail is specified: Dockerfile matching F3's base image, FPM config, Datadog APM setup, CI/CD pipeline mirroring F3's process, nginx reverse proxy, `.env` cascade matching Symfony conventions. "The easiest possible conversation: 'It is another PHP service, identical to F3.'"
- C9: Disposability (x2): 2/5 -- Same as the Pragmatic Minimalist: no adapter boundary, no domain interfaces. The standalone service is better than F3 embedding, but the 12go client code is not isolated behind a replaceable interface. The emphasis on infrastructure alignment makes the design operationally smooth but architecturally coupled to the current 12go API shape.
- C10: Elegance (x1): 3/5 -- The infrastructure design is thorough and well-motivated. The health check philosophy ("do not check 12go") is correct. The FPM configuration is well-reasoned. But the application architecture itself is not designed -- it is implied to be a standard Symfony CRUD-like structure.
- C11: Monitoring/Observability (x1): 5/5 -- Tied with the Data Flow Architect for best observability. The Datadog APM integration is concrete and complete (env vars, auto-instrumentation coverage, manual span tags, correlation ID propagation with code examples). The custom metrics specification (7 metrics with types and tags) and alerting design (6 alerts with thresholds) go beyond observability into operational readiness. The on-call runbook is a unique and valuable artifact.

---

### Clean Slate Designer

#### Boundary Clarity

The design proposes three layers: Handler -> Transformer -> 12go Client. The separation is clear:

1. **`handler/`**: Thin HTTP handlers that validate requests, call transformers, call the 12go client, and return responses.
2. **`transform/`**: Pure functions with no I/O dependencies. "They take 12go types and mapping tables as input and return client types."
3. **`twelvego/`**: "A dumb HTTP client. It knows how to inject auth and parse errors. It does not transform data."

Additionally, `api/client_types.go` (client-facing types) and `twelvego/types.go` (12go types) are physically separated.

However, there are no interfaces. The handlers directly call the 12go client and transformers. Replacing the 12go client means changing every handler that references it. This is Go convention (explicit dependencies, no DI container), but it means the boundary is structural (directory-based) rather than contractual (interface-based).

The design acknowledges this gap: "When F3 is eventually refactored, this service may need to be absorbed, rewritten, or kept as-is." The mitigation is that "the design is deliberately thin (13 endpoints, ~2K lines) so that rewriting it is cheap."

#### Error Handling Robustness

The design provides the most detailed error surface analysis:

```
12go 400 Bad Request -> client 400 with field names reverse-mapped
12go 401 -> client 401
12go 404 -> client 404
12go 422 "Trip is no longer available" -> client 404
12go 500+ -> client 502 Bad Gateway
12go timeout -> client 504 Gateway Timeout
12go recheck array non-empty -> client 206 Partial Content
```

The error translation includes **field name reverse-mapping**: "Field names must be reverse-mapped using the cached name-to-supplier-name dictionary." This is a detail that other designs miss.

Go's explicit error handling (`(result, error)` return pattern) forces every error case to be handled. No exception swallowing, no silent failures. This is a structural advantage for correctness.

#### Concurrency Model Assessment

Go's goroutine model is the best fit for this proxy pattern:

- Each incoming request is handled by a goroutine (lightweight, thousands concurrent).
- GetItinerary's 3 12go calls can be made concurrently with `sync.WaitGroup` or `errgroup`.
- No thread pool exhaustion risk (goroutines are multiplexed onto OS threads).
- No event loop blocking risk.
- Memory: goroutine stack starts at 2KB, grows as needed.

Failure modes:
- **Goroutine leaks**: Possible if 12go calls never return and timeouts are not set. Mitigated by per-request context timeouts.
- **Memory**: With thousands of concurrent requests, goroutine stacks could accumulate. Manageable with context timeouts.

#### Performance Estimate

- **Search latency overhead**: ~2-5ms. Go's HTTP server has near-zero overhead. `encoding/json` deserialization is fast for known struct shapes (~0.5-1ms for a search response). Transformation is pure CPU work on in-memory data (~1-2ms). `encoding/json` serialization of client response (~0.5-1ms). No per-request framework bootstrap.
- **Throughput ceiling**: Thousands of req/s per instance. Go's net/http can handle 10K+ req/s for simple handlers. The bottleneck is 12go API latency (I/O-bound), not Go's processing capacity.
- **Memory footprint**: ~20-50MB under normal load. In-memory maps for station/operator IDs (~a few MB). No per-request memory overhead beyond goroutine stacks.
- **Startup time**: ~50ms. Single binary, no runtime initialization.
- **Container size**: ~15-25MB (scratch or distroless base + static binary).

This is the **best performance profile of any design** by a significant margin. Go's HTTP proxy performance is well-documented (it is the language of Envoy, Traefik, Caddy).

The in-memory ID mapping lookups (station, operator, seat class) are on the hot path but are hash map lookups: O(1), nanosecond-scale.

Connection pooling to 12go: Go's `net/http` client pools connections by default (`http.Transport.MaxIdleConnsPerHost`). Keep-alive is enabled by default. No configuration needed for correct connection reuse.

#### Resilience Design

- **Circuit breaker**: Not proposed. The design is deliberately minimal: "no feature flags" in the decision log.
- **Retry policy**: Not proposed. The design acknowledges this under "What This Design Ignores."
- **Timeout strategy**: Go's `context.Context` with deadline is the standard pattern but not explicitly designed.
- **Seat lock TTL**: Defers to 12go.
- **In-memory state**: The booking schema cache with TTL is the main resilience concern. On service restart, all cached schemas are lost. Clients would need to call GetItinerary again before CreateBooking. This is noted as a limitation.

The design explicitly acknowledges what it ignores: event emission, infrastructure operational burden, observability, and F3 replaceability. These are honest omissions, not oversights.

#### Observability Design

The design explicitly states: "This design does not include metrics, tracing, or structured logging. Those must be added for production."

Under "What This Design Ignores": "A production version would need all of these, adding ~200-300 lines of observability and operational code."

This is honest but means the observability score is necessarily low. The design is a pure proxy architecture; observability is treated as a separate concern to be layered on.

#### Scores

- C4: Search Performance (x3): 5/5 -- The best search performance of any design. Go's net/http adds ~1-2ms overhead. Connection pooling is built-in and enabled by default. In-memory hash map lookups for ID mapping are nanosecond-scale. No per-request framework bootstrap. GetItinerary's 3 12go calls can be parallelized via goroutines. The estimated ~2-5ms total proxy overhead is the lowest of any proposal.
- C5: Simplicity (x3): 5/5 -- ~2K lines of Go code. ~40 files. Three layers (handler/transformer/client). No DI container, no middleware pipeline (beyond 3 global middlewares), no database, no message broker. "A developer can read the entire codebase in an afternoon." The irreducible complexity analysis is the most honest assessment of what the proxy actually needs.
- C8: Infrastructure Fit (x2): 2/5 -- Go is a new runtime for 12go's DevOps team. No one on the current team knows Go. The design acknowledges this: "The on-call engineer does not know how to debug a Go panic stack trace." Datadog APM (`dd-trace-go`) requires manual instrumentation, unlike PHP's auto-instrumentation. This would be the first Go service in the fleet -- a guinea pig for all operational processes.
- C9: Disposability (x2): 3/5 -- The design is thin enough (~2K lines) that rewriting it is cheap regardless of target language. The transformation logic is isolated in `transform/` as pure functions. However, there are no interfaces separating the 12go client from the handlers. The design proposes documenting "transformation rules in a language-agnostic format (e.g., as test fixtures with input/output pairs) so they can be ported to any language" -- good idea, not formally implemented. Disposability is achieved through smallness, not through architectural boundaries.
- C10: Elegance (x1): 5/5 -- The most architecturally elegant design. The problem is "a stateless HTTP translation layer between two fixed API surfaces," and the solution is exactly that: 13 HTTP handlers, pure transformation functions, and a thin HTTP client. No patterns applied for their own sake. The irreducible complexity analysis, the operation type classification (5 types), and the decision log demonstrate clear architectural thinking. The language choice (Go) matches the problem domain (HTTP proxy) precisely.
- C11: Monitoring/Observability (x1): 1/5 -- The design explicitly does not include monitoring or observability. "This design does not include metrics, tracing, or structured logging." While honest, a production service without observability is not deployable. This is the single biggest gap in an otherwise excellent design.

---

### Summary Observations on All PHP Designs

Four designs recommend PHP (Pragmatic Minimalist, Data Flow Architect, Team-First Developer, Platform Engineer). Their performance characteristics are similar because they all use PHP-FPM. The differentiators are:

- **Pragmatic Minimalist**: F3 embedding (worst disposability, best infra fit)
- **Data Flow Architect**: Event emission focus (best event design, moderate proxy design)
- **Team-First Developer**: Developer experience focus (best DX documentation, moderate architecture)
- **Platform Engineer**: Infrastructure focus (best operational design, moderate architecture)

---

## Comparative Scoring Matrix

| Design | C4 Performance (x3) | C5 Simplicity (x3) | C8 Infra Fit (x2) | C9 Disposability (x2) | C10 Elegance (x1) | C11 Observability (x1) | Weighted Total |
|---|---|---|---|---|---|---|---|
| Pragmatic Minimalist | 3 (9) | 5 (15) | 5 (10) | 2 (4) | 4 (4) | 3 (3) | **45** |
| Disposable Architecture | 3 (9) | 3 (9) | 3 (6) | 5 (10) | 4 (4) | 2 (2) | **40** |
| Data Flow Architect | 3 (9) | 3 (9) | 4 (8) | 2 (4) | 3 (3) | 5 (5) | **38** |
| Team-First Developer | 3 (9) | 4 (12) | 4 (8) | 3 (6) | 3 (3) | 3 (3) | **41** |
| Platform Engineer | 3 (9) | 4 (12) | 5 (10) | 2 (4) | 3 (3) | 5 (5) | **43** |
| Clean Slate Designer | 5 (15) | 5 (15) | 2 (4) | 3 (6) | 5 (5) | 1 (1) | **46** |

---

## Technical Architecture Recommendation

**The Clean Slate Designer has the highest weighted total (46)** driven by its exceptional search performance (5/5) and simplicity (5/5) scores. From a pure technical merit standpoint, it is the best design: the problem is an HTTP proxy, and the solution is the thinnest possible HTTP proxy in the language best suited for HTTP proxies.

However, I must note that the Clean Slate design achieves its top score partly by deferring critical concerns (observability, infrastructure fit) that other designs address. If I were to score a "production-ready Clean Slate" (with observability and infrastructure concerns added), the simplicity score would decrease slightly and the observability score would increase, likely landing at a similar total.

**From a structural integrity perspective**, the best architecture is the Clean Slate design's three-layer pattern (handler/transformer/client) combined with the Disposable Architecture's adapter boundary and the Platform Engineer's observability specification. This composite design would look like:

1. A standalone service (not inside F3)
2. Three layers: inbound HTTP handlers, pure transformation functions, typed 12go HTTP client
3. An interface boundary (`IBookingGateway` or Go equivalent) between handlers and the 12go client
4. Hurl-based contract tests for the permanent client boundary
5. Datadog APM with auto-instrumentation plus custom `client_id` span tags
6. Structured logging with correlation ID propagation
7. In-memory ID mapping tables loaded at startup

The language choice is the key variable. Go gives the best performance and simplicity but the worst infrastructure fit. PHP gives the best infrastructure fit but the weakest performance and the limitation of sequential 12go calls within a single request. For a system where search latency is the highest-priority technical requirement, Go's performance advantage (~2-5ms overhead vs. ~8-15ms for PHP) is meaningful but not decisive -- the 12go API response time (100-500ms for search) dominates either way.

**My recommendation on pure technical merit: standalone PHP Symfony service with the Clean Slate's three-layer architecture and the Disposable Architecture's adapter boundary.** This combines the best infrastructure fit with the best architectural patterns. The PHP performance overhead (~8-15ms) is acceptable given that 12go's API latency dominates. The adapter boundary ensures the 12go client can be replaced when F3 is decomposed. The standalone deployment avoids F3's local development friction.

---

## Cross-Design Technical Observations

### 1. All designs agree on eliminating local persistence

Every design proposes zero local database, relying entirely on 12go as the source of truth. This is the correct decision for a proxy. The only state that requires cross-request persistence is the booking schema field name cache (from GetItinerary to CreateBooking). For a single instance, in-memory with TTL is sufficient. For multiple instances, Redis is needed. No design over-designs this.

### 2. The booking schema mapper is the irreducible complexity

Every design identifies the booking schema parser (~500 lines in the existing C#, with 20+ dynamic field patterns) as the single most complex component. The Clean Slate design estimates it at ~300 lines in Go. The Team-First Developer says ~300-400 lines in PHP. This transformation is the one piece that cannot be simplified further -- it is a direct consequence of 12go's dynamic checkout API shape.

### 3. Connection pooling to 12go is universally under-specified

Only the Clean Slate design notes that Go's `net/http` pools connections by default. The PHP designs do not specify Guzzle/Symfony HttpClient connection pooling configuration. For a proxy where every request makes at least one upstream call, connection reuse is critical for both latency and throughput. PHP's Symfony HttpClient does support persistent connections when configured correctly, but no PHP design provides the configuration.

### 4. Sequential vs. parallel 12go calls for GetItinerary

GetItinerary requires 3 12go calls: GetTripDetails, AddToCart, GetBookingSchema. These are sequential in the current system (each depends on the previous). In Go, the first call (GetTripDetails) produces the tripId needed for AddToCart, so true parallelism is not possible for all three. However, the data dependency chain is: TripDetails(tripId) -> AddToCart(tripId, datetime) -> GetBookingSchema(cartId). This is inherently sequential. No design can optimize this without changing the 12go API.

### 5. The health check design question reveals architectural maturity

The Platform Engineer's health check design ("does NOT check 12go API connectivity") is the correct answer. A proxy health check that checks upstream availability creates cascading restarts when the upstream is down -- exactly when you need the proxy to be alive and returning meaningful errors. The Pragmatic Minimalist and Clean Slate designs do not address health checks at all. This is a small but telling indicator of operational maturity.

### 6. No design proposes a circuit breaker, and this is correct

For a single-upstream proxy, a circuit breaker converts slow failures to fast failures. The benefit is marginal: the client gets a 503 immediately instead of waiting 65s for a timeout. The cost is implementation complexity and the risk of false trips. Given the solo developer constraint and the fact that 12go is the only backend, the absence of a circuit breaker is the right simplicity trade-off. If 12go is down, the proxy returns errors; when 12go recovers, the proxy recovers immediately. No state to reset.

### 7. The F3 monolith vs. standalone service decision has clear technical implications

Embedding in F3 trades disposability for infrastructure fit. A standalone service trades infrastructure simplicity for architectural isolation. The technical merit analysis clearly favors standalone: the adapter boundary is cleaner, the performance is better (no F3 framework overhead), and the deployment is independent. The monolith arguments (Team Lead's "easier to refactor when everything is together") are organizational, not technical.
