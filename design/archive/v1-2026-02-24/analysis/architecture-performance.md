# Analysis: Architecture and Performance

## Executive Summary

This analysis evaluates five design variants (A-monolith PHP, B-microservice in PHP, .NET, Go, TypeScript) from architecture and performance perspectives. Findings:

- **A-monolith (PHP)**: Strongest performance (in-process calls, ~5–10ms latency), highest coupling, simplest deployment.
- **B-microservice (.NET)**: Best team fit (zero learning curve), moderate performance (~50–150ms HTTP overhead), clean separation.
- **B-microservice (PHP)**: Balanced performance (~50–150ms), moderate complexity, requires PHP ramp-up.
- **B-microservice (Go)**: Excellent performance (~20–50ms), smallest binaries, steepest learning curve.
- **B-microservice (TypeScript)**: Strong AI tooling, good type safety, moderate performance, familiar async model.

**Key trade-offs:**
- **Performance vs. coupling**: Monolith eliminates HTTP hops but ties to 12go internals.
- **Team productivity vs. infrastructure alignment**: .NET maximizes immediate productivity; PHP aligns with 12go stack.
- **Simplicity vs. scalability**: Monolith is simpler; microservices enable independent scaling.

**Recommendation**: For performance-critical search, A-monolith PHP offers the lowest latency. For maintainability and team velocity, B-microservice .NET provides the best balance.

---

## Comparison by Design/Language

### A: Monolith (PHP/Symfony)

**Architectural integrity**: ⭐⭐⭐ (3/5)

**Domain boundaries**: Weak isolation. B2B layer calls 12go services directly (`SearchService`, `BookingProcessor`). Changes to 12go internals can break B2B. Mitigation: same codebase enables coordination.

**Pattern appropriateness**: Simple layering (Controllers → Services → 12go services). No DDD/CQRS overhead. Appropriate for a translation layer.

**Error handling**: Leverages Symfony exception handling. 12go service exceptions propagate; B2B layer maps to client errors. Refund flow uses HTTP self-calls (risk).

**Separation of concerns**: Medium. B2B logic is isolated in `src/B2bApi/`, but depends on 12go internals. Booking schema mapping is complex (~500 lines) but contained.

**Performance & scalability**: ⭐⭐⭐⭐⭐ (5/5)

**Latency**: Excellent. In-process calls eliminate HTTP overhead:
- Search: ~5ms (vs ~150ms HTTP)
- GetItinerary: ~10ms (vs ~200ms HTTP)
- Booking steps: ~10ms each (vs ~200ms HTTP)

**Throughput**: PHP-FPM handles concurrency. Search is DB-backed (MariaDB); Redis caching is internal. Expected: 1000+ req/sec per instance.

**Connection management**: N/A (in-process). No connection pooling needed.

**Caching**: Uses 12go's Redis. No additional cache layer. Stations snapshot to S3 preserves contract.

**Simplicity & testing**: ⭐⭐⭐⭐ (4/5)

**Moving parts**: Minimal. Single codebase, single deployment, no cross-service calls. Seat lock is in-process Redis.

**Testing ease**: Good. Mock 12go services via Symfony DI. Integration tests run against MariaDB/Redis. Booking schema mapper is testable in isolation.

**Architectural concerns**:
- Deep coupling to `BookingProcessor` (~25 dependencies) and `SearchService` (~20 dependencies)
- Refund flow uses HTTP self-calls (performance/risk)
- Cart hash TTL must match PreBookingCache (5 days)
- Webhook processing is new code path

---

### B: Microservice (.NET 8)

**Architectural integrity**: ⭐⭐⭐⭐ (4/5)

**Domain boundaries**: Strong isolation. Stateless proxy with clear HTTP contract to 12go. Changes to 12go API surface are explicit.

**Pattern appropriateness**: Simple layered (Endpoints → Services → Clients). Minimal API reduces boilerplate. No framework bloat.

**Error handling**: Robust. Refit + Polly for retry/circuit breaker. Error mapping from 12go to client contracts. Global exception handler.

**Separation of concerns**: Excellent. 12go client isolated; mappers are pure functions; services orchestrate. Booking schema parser is self-contained.

**Performance & scalability**: ⭐⭐⭐⭐ (4/5)

**Latency**: Good with HTTP overhead:
- Search: ~50–150ms (HTTP round-trip + mapping)
- GetItinerary: ~200–300ms (3 sequential calls)
- Booking steps: ~200–300ms each

**Throughput**: Minimal API handles 2.1M req/sec (cold start ~10ms). AOT reduces container size (~90–100MB). Connection pooling via `HttpClient`.

**Connection management**: Excellent. `HttpClient` with connection pooling (`MaxIdleConnsPerHost: 10`). Keep-alive enabled.

**Caching**: None (stateless). Eliminates cache invalidation bugs. 12go Redis handles caching.

**Simplicity & testing**: ⭐⭐⭐⭐⭐ (5/5)

**Moving parts**: Two services (Search & Master Data, Booking). Clean separation. Seat lock is in-process `ConcurrentDictionary`.

**Testing ease**: Excellent. xUnit + Moq + AutoFixture. Mock `ITwelveGoApi` (Refit interface). Integration tests with `WebApplicationFactory`. Contract tests validate response shapes.

**Architectural concerns**:
- Risk of recreating old patterns (MediatR, SI framework abstractions)
- Code size discipline needed (< 10K lines)
- Separate deployment pipeline from 12go PHP infrastructure

---

### B: Microservice (PHP/Symfony)

**Architectural integrity**: ⭐⭐⭐⭐ (4/5)

**Domain boundaries**: Strong isolation. Stateless HTTP proxy. Vertical slices (Search, Booking, MasterData) with shared components.

**Pattern appropriateness**: Vertical slices over service-layer. Appropriate for stateless proxy. No over-engineering.

**Error handling**: Good. Symfony HttpClient with retry/circuit breaker. Error mapping via exception hierarchy. Global exception listener.

**Separation of concerns**: Good. `TwelveGoClient` is isolated; mappers are services; controllers are thin. Booking schema mapper is complex but contained.

**Performance & scalability**: ⭐⭐⭐⭐ (4/5)

**Latency**: Good with HTTP overhead:
- Search: ~50–150ms (HTTP + mapping)
- GetItinerary: ~200–300ms (3 sequential calls)
- Booking steps: ~200–300ms each

**Throughput**: PHP-FPM handles concurrency. Symfony HttpClient is efficient. Expected: 500–1000 req/sec per instance.

**Connection management**: Good. Symfony HttpClient with connection pooling. Keep-alive enabled.

**Caching**: None (stateless). Eliminates cache complexity.

**Simplicity & testing**: ⭐⭐⭐⭐ (4/5)

**Moving parts**: Two services. Vertical slices keep structure clear. Seat lock is in-process.

**Testing ease**: Good. PHPUnit + Symfony test client. Mock `TwelveGoClient`. Integration tests with test containers. Booking schema mapper tests are critical.

**Architectural concerns**:
- Team ramp-up (4–6 weeks for .NET developers)
- PHP syntax differences (arrays vs collections, null safety)
- AI tooling effectiveness (~8/10 for Symfony boilerplate, ~6/10 for complex logic)

---

### B: Microservice (Go)

**Architectural integrity**: ⭐⭐⭐⭐⭐ (5/5)

**Domain boundaries**: Excellent isolation. Stateless HTTP proxy with explicit interfaces. Clean separation between handlers, services, clients.

**Pattern appropriateness**: Flat package structure. Idiomatic Go. No framework overhead. Chi router is minimal.

**Error handling**: Explicit error returns. Error wrapping with `fmt.Errorf`. Circuit breaker via `gobreaker`. Retry via `go-retryablehttp`.

**Separation of concerns**: Excellent. Handlers decode/encode; services orchestrate; clients handle HTTP. Mappers are pure functions.

**Performance & scalability**: ⭐⭐⭐⭐⭐ (5/5)

**Latency**: Excellent:
- Search: ~20–50ms (HTTP + mapping, efficient JSON)
- GetItinerary: ~100–200ms (3 sequential calls, goroutines for parallelization possible)
- Booking steps: ~100–200ms each

**Throughput**: Excellent. Native goroutines handle concurrency. Expected: 2000+ req/sec per instance.

**Connection management**: Excellent. `http.Transport` with connection pooling (`MaxIdleConnsPerHost: 10`). Keep-alive enabled.

**Caching**: None (stateless).

**Simplicity & testing**: ⭐⭐⭐ (3/5)

**Moving parts**: Two services. Flat structure is simple. Seat lock uses `sync.Map` with TTL cleanup.

**Testing ease**: Good. Standard `testing` package + `testify`. Table-driven tests. Mock interfaces manually. HTTP handler tests with `httptest`. Less familiar to .NET developers.

**Architectural concerns**:
- Steep learning curve (2–4 weeks productive, 2–3 months proficiency)
- Explicit error handling (no exceptions)
- Goroutines vs async/await mental model shift
- AI tooling effectiveness (~7/10, may generate non-idiomatic code)

---

### B: Microservice (TypeScript/Node.js)

**Architectural integrity**: ⭐⭐⭐⭐ (4/5)

**Domain boundaries**: Strong isolation. Stateless HTTP proxy. NestJS modules group functionality.

**Pattern appropriateness**: Layered (Controllers → Services → Clients). NestJS provides structure. Appropriate for proxy layer.

**Error handling**: Good. NestJS exception filters. Retry/circuit breaker via custom services. Error mapping to client contracts.

**Separation of concerns**: Good. `TwelveGoClientService` is isolated; mappers are services; controllers are thin. Booking schema mapper is complex but contained.

**Performance & scalability**: ⭐⭐⭐⭐ (4/5)

**Latency**: Good with HTTP overhead:
- Search: ~50–150ms (HTTP + mapping)
- GetItinerary: ~200–300ms (3 sequential calls, Node.js event loop handles concurrency)
- Booking steps: ~200–300ms each

**Throughput**: NestJS handles ~22K req/sec. Node.js event loop is efficient for I/O-bound operations. Expected: 1000+ req/sec per instance.

**Connection management**: Good. Axios/`@nestjs/axios` with connection pooling. Keep-alive enabled.

**Caching**: None (stateless).

**Simplicity & testing**: ⭐⭐⭐⭐ (4/5)

**Moving parts**: Two services. NestJS modules provide structure. Seat lock is in-process `Map`.

**Testing ease**: Excellent. Jest + NestJS testing utilities. Mock `TwelveGoClientService` via DI. E2E tests with `Test.createTestingModule`. Contract tests with `openapi-validator`.

**Architectural concerns**:
- Team ramp-up (4 weeks productive, 8 weeks proficiency)
- TypeScript type system differences (structural vs nominal)
- NestJS performance overhead (vs Fastify, but sufficient for proxy workload)

---

## Architectural Integrity Assessment

### Domain Boundaries

**Best**: Go microservice (5/5) — explicit interfaces, clear separation  
**Worst**: A-monolith PHP (3/5) — tight coupling to 12go internals

**Analysis**: Microservices enforce boundaries via HTTP contracts. Monolith relies on code organization and coordination.

### Pattern Appropriateness

**Best**: Go microservice (5/5) — minimal, idiomatic  
**Worst**: A-monolith PHP (3/5) — simple but coupled

**Analysis**: All designs avoid over-engineering. Go's flat structure is simplest; monolith's layering is appropriate but coupled.

### Error Handling

**Best**: .NET microservice (5/5) — Refit + Polly, comprehensive  
**Worst**: A-monolith PHP (3/5) — relies on Symfony, refund flow risk

**Analysis**: .NET's retry/circuit breaker is most robust. Monolith's error handling is adequate but refund flow is risky.

### Separation of Concerns

**Best**: .NET microservice (5/5) — clear layers, isolated components  
**Worst**: A-monolith PHP (3/5) — B2B code isolated but depends on 12go internals

**Analysis**: Microservices naturally separate concerns. Monolith's separation is organizational, not architectural.

---

## Performance & Scalability Assessment

### Latency (Search Endpoint)

**Best**: A-monolith PHP (5/5) — ~5ms in-process  
**Worst**: B-microservice TypeScript (4/5) — ~50–150ms HTTP overhead

**Analysis**: Monolith eliminates HTTP overhead. Microservices add ~50–150ms per call. Go's efficiency reduces overhead (~20–50ms).

### Throughput

**Best**: Go microservice (5/5) — 2000+ req/sec per instance  
**Worst**: PHP microservice (4/5) — 500–1000 req/sec per instance

**Analysis**: Go's goroutines excel at concurrency. PHP-FPM is efficient but less so than Go. .NET Minimal API is competitive.

### Connection Management

**Best**: .NET microservice (5/5) — `HttpClient` with pooling  
**Worst**: N/A — all handle connection pooling adequately

**Analysis**: All designs use connection pooling. .NET's `HttpClient` is well-optimized.

### Caching Strategy

**Best**: A-monolith PHP (5/5) — uses 12go's Redis directly  
**Worst**: N/A — all eliminate redundant caching

**Analysis**: Monolith leverages 12go's Redis. Microservices eliminate caching (stateless proxy). Both are appropriate.

---

## Simplicity vs. Complexity Trade-offs

### Moving Parts Count

**Best**: A-monolith PHP (5/5) — single codebase, single deployment  
**Worst**: B-microservice Go (3/5) — two services, explicit error handling adds complexity

**Analysis**: Monolith minimizes moving parts. Microservices add operational overhead but improve isolation.

### Testing Ease

**Best**: .NET microservice (5/5) — xUnit + Moq, familiar tooling  
**Worst**: Go microservice (3/5) — table-driven tests, explicit error handling less familiar

**Analysis**: .NET's testing stack aligns with team expertise. Go's testing is solid but requires learning.

### Code Complexity

**Best**: Go microservice (5/5) — flat structure, minimal abstractions  
**Worst**: A-monolith PHP (3/5) — booking schema mapper complexity, refund flow risk

**Analysis**: Go's simplicity shines. Monolith's complexity comes from 12go integration, not architecture.

---

## Comparative Scoring Matrix

Based on [evaluation-criteria.md](../evaluation-criteria.md), focusing on architecture/performance criteria:

| Design/Language | Search Performance (x3) | Simplicity (x2) | Elegance (x1) | Testing Ease (x1) | Weighted Total |
|----------------|-------------------------|------------------|---------------|-------------------|----------------|
| **A: Monolith (PHP)** | 5 (15) | 4 (8) | 3 (3) | 4 (4) | **30** |
| **B: Microservice (.NET)** | 4 (12) | 5 (10) | 4 (4) | 5 (5) | **31** |
| **B: Microservice (PHP)** | 4 (12) | 4 (8) | 4 (4) | 4 (4) | **28** |
| **B: Microservice (Go)** | 5 (15) | 3 (6) | 5 (5) | 3 (3) | **29** |
| **B: Microservice (TypeScript)** | 4 (12) | 4 (8) | 4 (4) | 4 (4) | **28** |

**Scoring rationale**:

- **Search Performance**: A-monolith PHP (5) and Go (5) for lowest latency; others (4) due to HTTP overhead.
- **Simplicity**: .NET (5) for team familiarity; A-monolith (4) for single codebase; Go (3) for learning curve.
- **Elegance**: Go (5) for minimal, idiomatic design; .NET/PHP/TypeScript (4) for clean patterns; A-monolith (3) for coupling.
- **Testing Ease**: .NET (5) for familiar tooling; A-monolith/PHP/TypeScript (4) for good tooling; Go (3) for less familiar patterns.

---

**Document Status**: Complete  
**Last Updated**: 2026-02-23
