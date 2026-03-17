---

## status: draft
last_updated: 2026-02-24

# Analysis v3: Architecture and Performance

## Scope

This analysis evaluates the five architectural options (A: Monolith PHP, B1: Microservice .NET, B2: Microservice PHP, B3: Microservice Go, B4: Microservice TypeScript) against the **Architecture & Performance** criteria defined in [evaluation-criteria.md](../evaluation-criteria.md).

**Criteria analyzed** (with weights):


| #   | Criterion            | Weight | Description                                                              |
| --- | -------------------- | ------ | ------------------------------------------------------------------------ |
| 2   | Future Extensibility | x5     | Alignment with 12go's long-term technical direction (PHP/Symfony or Go). |
| 11  | Search Performance   | x2     | Latency and throughput for search. (5ms added latency is tolerable).     |
| 12  | Testing Ease         | x2     | Straightforwardness of writing and maintaining unit/integration tests.   |
| 13  | Simplicity           | x1     | Minimal moving parts and obvious system flow.                            |
| 14  | Elegance             | x1     | Clean architecture and adherence to well-known patterns.                 |


**Maximum possible score**: (5×5) + (5×2) + (5×2) + (5×1) + (5×1) = **55**

---

## Executive Summary

- **A: Monolith PHP** achieves the best search performance due to in-process execution, but is penalized on testing ease due to complex setup and shared state. It aligns well with the company's PHP strategy but suffers in elegance due to coupling.
- **B1: Microservice .NET** scores exceptionally well on testing ease, simplicity, and elegance due to the transition team's deep expertise. However, its fatal flaw is Future Extensibility (Score 1), as it represents a technological dead-end in a PHP/Go ecosystem.
- **B2: Microservice PHP** provides strong alignment with Future Extensibility and solid scores across testing, simplicity, and elegance. Search performance is acceptable within the 5ms tolerance.
- **B3: Microservice Go** represents the pinnacle of Future Extensibility alongside PHP, offering superior microservice search performance and high elegance. Testing ease is acceptable but requires learning new patterns.
- **B4: Microservice TS** offers great testing and simplicity but is misaligned with the company's long-term strategic direction (Future Extensibility), relegating it to an "orphan" service risk.

**Key insight**: Under v3 criteria, **Future Extensibility (x5)** heavily dominates this dimension. Options that don't align with 12go's target architectures (PHP or Go) are severely penalized, overshadowing pure testing or simplicity advantages. **Microservice Go (B3)** and **Microservice PHP (B2)** emerge as the clear leaders in this category.

---

## Detailed Scoring by Option

### A: Monolith (PHP/Symfony)


| #   | Criterion            | Score | Weighted | Rationale                                                                                                                                                                   |
| --- | -------------------- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Future Extensibility | 5     | 25       | **Excellent.** 12go is a PHP/Symfony shop. Building directly into the monolith ensures absolute alignment with the core platform's future.                                  |
| 11  | Search Performance   | 5     | 10       | **Excellent.** In-process calls eliminate HTTP overhead. Search: ~5ms (vs ~50–150ms HTTP). Sub-200ms p95 easily achieved. Uses 12go's Redis directly.                       |
| 12  | Testing Ease         | 3     | 6        | **Acceptable.** Testing requires spinning up 12go internals or complex mocks. Refund flow self-calls add test complexity. Flakiness risk from shared state in the monolith. |
| 13  | Simplicity           | 4     | 4        | **Good.** Single codebase, single deployment, no cross-service HTTP. Flow is obvious. Complexity comes from integration depth rather than orchestration.                    |
| 14  | Elegance             | 3     | 3        | **Acceptable.** Coupling to 12go internals (e.g., `BookingProcessor`, `SearchService`) undermines separation of concerns. B2B logic is mixed with 12go domain concepts.     |


**Total: 48 / 55**

---

### B1: Microservice (.NET 8)


| #   | Criterion            | Score | Weighted | Rationale                                                                                                                                                                           |
| --- | -------------------- | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Future Extensibility | 1     | 5        | **Poor.** 12go has no .NET in its core infrastructure. This service would become an immediate "orphan" and a technological dead-end in the company's platform unification strategy. |
| 11  | Search Performance   | 4     | 8        | **Good.** HTTP round-trip adds ~50–150ms, but with a 5ms latency tolerance, this is acceptable. Minimal API with AOT handles high throughput efficiently.                           |
| 12  | Testing Ease         | 5     | 10       | **Excellent.** The transition team has deep expertise in xUnit, Moq, and AutoFixture. Integration tests via `WebApplicationFactory` are trivial to set up.                          |
| 13  | Simplicity           | 5     | 5        | **Excellent.** Minimal API reduces boilerplate. Clean separation, stateless proxy, no complex orchestration.                                                                        |
| 14  | Elegance             | 4     | 4        | **Good.** Clean layered architecture (Endpoints → Services → Clients) using Refit and Polly. Well-known patterns.                                                                   |


**Total: 32 / 55**

---

### B2: Microservice (PHP/Symfony)


| #   | Criterion            | Score | Weighted | Rationale                                                                                                                                                             |
| --- | -------------------- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Future Extensibility | 5     | 25       | **Excellent.** Naturally evolves with 12go's PHP/Symfony ecosystem. Future maintenance can easily be handed off to the core team.                                     |
| 11  | Search Performance   | 4     | 8        | **Good.** HTTP overhead is acceptable within the 5ms tolerance. PHP-FPM with Symfony HttpClient handles concurrency well with connection pooling.                     |
| 12  | Testing Ease         | 4     | 8        | **Good.** PHPUnit and Symfony test client provide a solid testing ecosystem. Mocking is straightforward, though slightly less familiar to the current team than .NET. |
| 13  | Simplicity           | 4     | 4        | **Good.** Vertical slices over a service layer. No over-engineering. Clear stateless proxy flow.                                                                      |
| 14  | Elegance             | 4     | 4        | **Good.** Thin controllers, logical separation of concerns, and standard exception mapping. Appropriate for a proxy layer.                                            |


**Total: 49 / 55**

---

### B3: Microservice (Go)


| #   | Criterion            | Score | Weighted | Rationale                                                                                                                                                                |
| --- | -------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2   | Future Extensibility | 5     | 25       | **Excellent.** Go is explicitly called out as a target language for 12go's future platform direction. Highly aligned strategically.                                      |
| 11  | Search Performance   | 5     | 10       | **Excellent.** Lowest latency among microservices (~20–50ms HTTP + mapping). Native goroutines provide exceptional concurrency and throughput.                           |
| 12  | Testing Ease         | 3     | 6        | **Acceptable.** Standard `testing` package is solid, but table-driven tests and manual interface mocking present a learning curve for the current team. No DI container. |
| 13  | Simplicity           | 4     | 4        | **Good.** Flat package structure and minimal router (Chi). Explicit error handling and goroutine concurrency add slight mental overhead but remain structurally simple.  |
| 14  | Elegance             | 5     | 5        | **Excellent.** Idiomatic Go encourages a textbook clean architecture. No abstractions for abstraction's sake. Explicit, readable, and highly elegant.                    |


**Total: 50 / 55**

---

### B4: Microservice (TypeScript/Node.js)


| #   | Criterion            | Score | Weighted | Rationale                                                                                                                                                           |
| --- | -------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Future Extensibility | 2     | 10       | **Below average.** While modern and popular, Node.js/TS is not the target backend architecture for 12go (PHP or Go). It risks becoming an isolated stack over time. |
| 11  | Search Performance   | 4     | 8        | **Good.** Event loop handles I/O bound proxy workloads efficiently. Latency is acceptable within the given tolerance.                                               |
| 12  | Testing Ease         | 5     | 10       | **Excellent.** Jest and NestJS testing utilities are robust. High AI-friendliness makes test generation extremely fast and reliable.                                |
| 13  | Simplicity           | 4     | 4        | **Good.** NestJS modules organize code well. Standard layered approach.                                                                                             |
| 14  | Elegance             | 4     | 4        | **Good.** NestJS provides strong structural patterns, decorators, and exception filters suitable for this workload.                                                 |


**Total: 36 / 55**

---

## Comparative Scoring Matrix


| Design              | Future Extensibility (×5) | Search Perf (×2) | Testing Ease (×2) | Simplicity (×1) | Elegance (×1) | **Total** |
| ------------------- | ------------------------- | ---------------- | ----------------- | --------------- | ------------- | --------- |
| **A: Monolith PHP** | 5 (25)                    | 5 (10)           | 3 (6)             | 4 (4)           | 3 (3)         | **48**    |
| **B1: Micro .NET**  | 1 (5)                     | 4 (8)            | 5 (10)            | 5 (5)           | 4 (4)         | **32**    |
| **B2: Micro PHP**   | 5 (25)                    | 4 (8)            | 4 (8)             | 4 (4)           | 4 (4)         | **49**    |
| **B3: Micro Go**    | 5 (25)                    | 5 (10)           | 3 (6)             | 4 (4)           | 5 (5)         | **50**    |
| **B4: Micro TS**    | 2 (10)                    | 4 (8)            | 5 (10)            | 4 (4)           | 4 (4)         | **36**    |


