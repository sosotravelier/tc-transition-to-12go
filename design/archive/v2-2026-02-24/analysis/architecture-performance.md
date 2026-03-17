---
status: draft
last_updated: 2026-02-24
---

# Analysis v2: Architecture and Performance

## Scope

This analysis re-evaluates the five design options (A: Monolith PHP, B1: Micro .NET, B2: Micro PHP, B3: Micro Go, B4: Micro TS) against the **refined evaluation criteria** in [evaluation-criteria.md](../evaluation-criteria.md), focusing on architecture and performance dimensions.

**Criteria analyzed** (with weights):

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Maintainability | x3 | Long-term code health, readability, onboarding cost |
| Simplicity | x2 | Minimal moving parts, easy to reason about |
| Testing Ease | x2 | Straightforward to write and maintain tests |
| Search Performance | x1 | Latency and throughput (5ms added latency tolerable) |
| Elegance | x1 | Clean architecture, well-known patterns |

**Maximum possible score**: (5×3) + (5×2) + (5×2) + (5×1) + (5×1) = **45**

---

## Executive Summary

- **A: Monolith PHP**: Strongest search performance (in-process), weakest maintainability due to coupling to 12go internals. Simplicity and elegance suffer from shared codebase complexity.
- **B1: Micro .NET**: Best maintainability and testing ease for the current team. Clean separation, familiar patterns. Search performance adequate (5ms overhead tolerable).
- **B2: Micro PHP**: Good infrastructure alignment; maintainability and testing ease reduced by team ramp-up. Simplicity and elegance solid.
- **B3: Micro Go**: Highest elegance and search performance; maintainability and testing ease penalized by learning curve and less familiar tooling.
- **B4: Micro TS**: Strong AI-friendliness and testing; maintainability and elegance good. Search performance adequate.

**Key insight**: With search latency tolerance (5ms added acceptable), performance differences between microservices shrink. Maintainability and simplicity dominate the architecture score.

---

## Detailed Scoring by Option

### A: Monolith (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| Maintainability | 2 | 6 | **Below average.** B2B layer lives in `src/B2bApi/` but depends on 12go internals (`BookingProcessor`, `SearchService`). Deep coupling (~25 deps on BookingProcessor) means changes to 12go can break B2B. Booking schema mapper (~500 lines) is complex and tightly coupled. Onboarding requires understanding both B2B contract and 12go internals. Refund flow uses HTTP self-calls—fragile. Tribal knowledge risk is high. |
| Simplicity | 4 | 8 | **Good.** Single codebase, single deployment, no cross-service HTTP. Seat lock is in-process Redis. Flow is obvious: Controllers → Services → 12go services. Moving parts are minimal. Complexity comes from integration depth, not orchestration. |
| Testing Ease | 3 | 6 | **Acceptable.** Symfony DI allows mocking 12go services. Integration tests run against MariaDB/Redis. Booking schema mapper is testable in isolation. However, testing requires spinning up 12go internals or complex mocks. Refund flow self-calls add test complexity. Flakiness risk from shared state. |
| Search Performance | 5 | 5 | **Excellent.** In-process calls eliminate HTTP overhead. Search: ~5ms (vs ~50–150ms HTTP). Sub-200ms p95 easily achieved. Uses 12go's Redis directly. Throughput: 1000+ req/sec per instance. |
| Elegance | 3 | 3 | **Acceptable.** Simple layering (Controllers → Services → 12go). No DDD/CQRS overhead—appropriate for translation layer. But coupling to 12go internals undermines separation of concerns. B2B logic mixed with 12go domain. Patterns are ad-hoc where integration is deep. |

**Total: 28 / 45**

---

### B1: Microservice (.NET 8)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| Maintainability | 5 | 15 | **Excellent.** Stateless proxy with clear HTTP contract to 12go. Domain boundaries are strong—changes to 12go API surface are explicit. Mappers are pure functions; services orchestrate. 12go client isolated. Code is self-documenting for .NET developers. Onboarding: team is immediately productive. Risk of recreating old patterns (MediatR, SI abstractions) exists but mitigated by 10K LOC discipline. |
| Simplicity | 5 | 10 | **Excellent.** Two services (Search & Master Data, Booking). Minimal API reduces boilerplate. No framework bloat. Seat lock is in-process `ConcurrentDictionary`. Flow is obvious: Endpoints → Services → Clients. Clean separation, no complex orchestration. |
| Testing Ease | 5 | 10 | **Excellent.** xUnit + Moq + AutoFixture. Mock `ITwelveGoApi` (Refit interface) trivially. Integration tests with `WebApplicationFactory`. Contract tests validate response shapes. No complex setup. Team knows the stack. |
| Search Performance | 4 | 4 | **Good.** HTTP round-trip adds ~50–150ms. With 5ms added latency tolerable, this is acceptable. Sub-200ms p95 achievable with proper connection pooling. Minimal API handles 2.1M req/sec (cold start ~10ms). AOT reduces container size. |
| Elegance | 4 | 4 | **Good.** Layered (Endpoints → Services → Clients). Refit + Polly for retry/circuit breaker. Error mapping from 12go to client contracts. Booking schema parser is self-contained. Well-known patterns. Slight deduction: risk of over-abstraction if discipline lapses. |

**Total: 43 / 45**

---

### B2: Microservice (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| Maintainability | 3 | 9 | **Acceptable.** Stateless HTTP proxy with strong isolation. Vertical slices (Search, Booking, MasterData) keep structure clear. `TwelveGoClient` isolated; mappers are services. However: team ramp-up (4–6 weeks) for .NET developers. PHP syntax differences (arrays vs collections, null safety) add cognitive load. Future maintainers may be 12go PHP devs—good alignment. Code health is good; onboarding cost is the drag. |
| Simplicity | 4 | 8 | **Good.** Two services. Vertical slices over service-layer. No over-engineering. Symfony HttpClient with retry/circuit breaker. Seat lock is in-process. Flow is clear. Slightly more moving parts than monolith; fewer than a polyglot microservice sprawl. |
| Testing Ease | 4 | 8 | **Good.** PHPUnit + Symfony test client. Mock `TwelveGoClient` straightforwardly. Integration tests with test containers. Booking schema mapper tests are critical and achievable. Less familiar to .NET team; tooling is solid. |
| Search Performance | 4 | 4 | **Good.** ~50–150ms HTTP overhead. With 5ms tolerance, acceptable. PHP-FPM handles 500–1000 req/sec per instance. Symfony HttpClient is efficient. Connection pooling enabled. |
| Elegance | 4 | 4 | **Good.** Vertical slices, thin controllers. Error mapping via exception hierarchy. Appropriate for stateless proxy. No framework bloat. Well-applied patterns. |

**Total: 33 / 45**

---

### B3: Microservice (Go)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| Maintainability | 3 | 9 | **Acceptable.** Excellent isolation—stateless HTTP proxy with explicit interfaces. Handlers, services, clients clearly separated. Mappers are pure functions. Code is minimal and readable. **But**: steep learning curve (2–4 weeks productive, 2–3 months proficiency). Future maintainers may be 12go Go devs—strong alignment. Onboarding cost for current .NET team is high. Explicit error handling (no exceptions) is a mental shift. |
| Simplicity | 4 | 8 | **Good.** Two services. Flat package structure. Chi router is minimal. No framework overhead. Seat lock uses `sync.Map` with TTL cleanup. Flow is obvious. Slightly more complex: explicit error handling, goroutines vs async/await. |
| Testing Ease | 3 | 6 | **Acceptable.** Standard `testing` + `testify`. Table-driven tests. Mock interfaces manually. HTTP handler tests with `httptest`. Solid tooling but less familiar to .NET developers. No DI container—manual wiring in tests. |
| Search Performance | 5 | 5 | **Excellent.** ~20–50ms HTTP + mapping. Goroutines handle concurrency. 2000+ req/sec per instance. Efficient JSON. Best microservice latency. |
| Elegance | 5 | 5 | **Excellent.** Flat structure, idiomatic Go. No abstractions for abstraction's sake. Handlers decode/encode; services orchestrate; clients handle HTTP. Textbook clean. |

**Total: 33 / 45**

---

### B4: Microservice (TypeScript/Node.js)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| Maintainability | 4 | 12 | **Good.** Stateless HTTP proxy. NestJS modules group functionality. `TwelveGoClientService` isolated; mappers are services. Strong AI-friendliness—Cursor/Claude generate correct code. Team ramp-up: 4 weeks productive, 8 weeks proficiency. TypeScript structural typing is familiar to .NET devs. Code health is good; slightly less self-documenting than .NET for this team. |
| Simplicity | 4 | 8 | **Good.** Two services. NestJS modules provide structure. Seat lock is in-process `Map`. Layered (Controllers → Services → Clients). Flow is clear. NestJS adds some framework overhead but keeps things organized. |
| Testing Ease | 5 | 10 | **Excellent.** Jest + NestJS testing utilities. Mock `TwelveGoClientService` via DI. E2E tests with `Test.createTestingModule`. Contract tests with `openapi-validator`. AI tools excel at Jest/NestJS. |
| Search Performance | 4 | 4 | **Good.** ~50–150ms HTTP overhead. NestJS handles ~22K req/sec. Node.js event loop efficient for I/O-bound. With 5ms tolerance, acceptable. |
| Elegance | 4 | 4 | **Good.** NestJS provides structure. Exception filters, retry/circuit breaker. Appropriate for proxy layer. Well-known patterns. Slight overhead vs Fastify, but sufficient. |

**Total: 38 / 45**

---

## Comparative Scoring Matrix

| Design | Maintainability (×3) | Simplicity (×2) | Testing Ease (×2) | Search Perf (×1) | Elegance (×1) | **Total** |
|--------|----------------------|----------------|-------------------|------------------|---------------|-----------|
| **A: Monolith PHP** | 2 (6) | 4 (8) | 3 (6) | 5 (5) | 3 (3) | **28** |
| **B1: Micro .NET** | 5 (15) | 5 (10) | 5 (10) | 4 (4) | 4 (4) | **43** |
| **B2: Micro PHP** | 3 (9) | 4 (8) | 4 (8) | 4 (4) | 4 (4) | **33** |
| **B3: Micro Go** | 3 (9) | 4 (8) | 3 (6) | 5 (5) | 5 (5) | **33** |
| **B4: Micro TS** | 4 (12) | 4 (8) | 5 (10) | 4 (4) | 4 (4) | **38** |

---

## Criterion-by-Criterion Assessment

### Maintainability (×3)

**Best**: B1 Micro .NET (5) — Team is immediately productive; clear boundaries; self-documenting for .NET devs.

**Worst**: A Monolith PHP (2) — Deep coupling to 12go internals; tribal knowledge; fragile refund flow.

**Analysis**: Maintainability is the highest-weighted criterion. B1 wins because the team's .NET expertise and zero ramp-up mean code stays healthy. B4 is strong due to AI-friendliness. A-monolith suffers from coupling; B2 and B3 suffer from team ramp-up.

---

### Simplicity (×2)

**Best**: B1 Micro .NET (5) — Minimal API, two services, obvious flow, no framework bloat.

**Worst**: A Monolith PHP (4) — Still "good" due to single codebase; complexity is in integration depth.

**Analysis**: All options score 4 or 5. B1 edges ahead with minimal boilerplate and team familiarity. A-monolith has fewest moving parts but integration complexity offsets that. B3's explicit error handling and goroutines add slight complexity.

---

### Testing Ease (×2)

**Best**: B1 Micro .NET (5), B4 Micro TS (5) — Familiar tooling, easy mocking, integration test support.

**Worst**: A Monolith PHP (3), B3 Micro Go (3) — Monolith: complex setup, shared state. Go: less familiar patterns, manual mocking.

**Analysis**: .NET and TypeScript have mature testing ecosystems and team/AI familiarity. PHP is good but less familiar. Go's table-driven tests and manual interface mocking are solid but require learning.

---

### Search Performance (×1)

**Best**: A Monolith PHP (5), B3 Micro Go (5) — Monolith: in-process ~5ms. Go: ~20–50ms, 2000+ req/sec.

**Worst**: None score below 4 — All microservices achieve sub-200ms p95 with 5ms tolerance.

**Analysis**: With "5ms added latency tolerable," the performance bar is lowered. Monolith and Go still excel; others are acceptable. This criterion has lowest weight, so differences matter less.

---

### Elegance (×1)

**Best**: B3 Micro Go (5) — Flat structure, idiomatic, minimal abstractions.

**Worst**: A Monolith PHP (3) — Coupling undermines separation; ad-hoc where integration is deep.

**Analysis**: Go's simplicity and explicit design win. .NET, PHP, and TypeScript all score 4 with clean patterns. Monolith's coupling to 12go internals reduces elegance.

---

## Summary and Recommendation

Under the refined criteria (Maintainability ×3, Simplicity ×2, Testing Ease ×2, Search Performance ×1, Elegance ×1):

1. **B1 Micro .NET** leads with **43/45**, driven by maintainability, simplicity, and testing ease. Search performance is adequate given the 5ms tolerance.
2. **B4 Micro TS** is second with **38/45**, strong on maintainability and testing, good elsewhere.
3. **B2 Micro PHP** and **B3 Micro Go** tie at **33/45**. PHP aligns with infrastructure; Go excels on performance and elegance. Both suffer from team ramp-up.
4. **A Monolith PHP** scores **28/45**, penalized by maintainability (coupling) and testing ease. Search performance is best, but with low weight it doesn't compensate.

**Architecture & Performance recommendation**: B1 Micro .NET remains the strongest choice under these criteria. The high weight on maintainability and testing ease favors the option where the team is immediately productive and code health is easiest to preserve.

---

**Document Status**: Draft  
**Last Updated**: 2026-02-24  
**Reference**: [evaluation-criteria.md](../evaluation-criteria.md), [v1 architecture-performance](../../v1/analysis/architecture-performance.md)
