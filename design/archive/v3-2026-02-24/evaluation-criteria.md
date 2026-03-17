---
status: draft
last_updated: 2026-02-24
---

# Evaluation Criteria (v3)

## Scoring System

Each alternative is scored 1-5 on each criterion:
- **1** = Poor / High risk / High effort
- **2** = Below average
- **3** = Acceptable / Moderate
- **4** = Good
- **5** = Excellent / Low risk / Low effort

Final score = weighted sum of all criteria.

## Criteria

### Critical Weight (x7)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 1 | **Infrastructure Fit** | How naturally the solution fits into 12go's mature, revenue-generating EC2/Docker infrastructure. | Native alignment; uses existing runtime, base images, and deployment patterns. | "Foreign body" runtime (e.g., .NET in a 15-service PHP soup) requiring new expertise. |

### Strategic Weight (x5)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 2 | **Future Extensibility** | Alignment with 12go's long-term technical direction (PHP/Symfony or Go). | Naturally evolves with the company's platform unification strategy. | Technological dead-end; service becomes an "orphan" in the fleet. |
| 3 | **Operational Complexity** | On-call burden, debugging tools, and cognitive load for 12go's DevOps/Ops teams. | Standard 12go runbook; debugging uses same tools as core services (PHP/Go). | Requires unique tooling and specialized knowledge to troubleshoot in production. |
| 4 | **Development Velocity** | Speed of modifying endpoints or adding features after the initial MVP. | Change an endpoint in hours; fast feedback loops and familiar testing. | Every change is a multi-day effort involving unfamiliar framework patterns. |

### Execution Weight (x3)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 5 | **Implementation Effort** | Time and complexity to build a working MVP that achieves parity for all 13 endpoints. | MVP in 8-10 weeks; logic can be easily ported or translated. | 4+ months; requires rewriting complex domain logic from scratch. |
| 6 | **Team Competency Match** | Alignment with the transition team's 12+ years of .NET expertise. | Team is immediately productive with zero ramp-up time. | Team needs 4-6 weeks of training; high "drudgery risk" impacting retention. |
| 7 | **Maintainability (.NET)** | Long-term code health and onboarding cost if maintained by **.NET developers**. | Clean, self-documenting code; easy for the current team to maintain. | High cognitive load; fragile logic translation from C# to another language. |
| 8 | **Maintainability (PHP)** | Long-term code health and onboarding cost if maintained by **PHP developers**. | Standard Symfony/PHP patterns; easy for 12go's core team to take over. | "C#-style" PHP or foreign runtime (.NET/Go) that PHP devs cannot troubleshoot. |
| 9 | **Migration Risk** | Risk of breaking existing B2B clients during the cutover. | Zero-downtime; transparent transition; easy rollback. | High-risk cutover; potential for subtle logic divergence in mapping. |
| 10 | **AI-Friendliness** | Synergy with AI tools (Cursor/Claude) for code generation and refactoring. | AI generates 80%+ of correct code; perfect context for indexing. | AI struggles with patterns; requires frequent manual correction. |

### Performance & Quality Weight (x2)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 11 | **Search Performance** | Latency and throughput for search. *Not neglectable, but 5ms added latency is tolerable.* | Sub-200ms p95; zero detectable overhead vs. current 12go performance. | Detectable latency lag that affects search conversion/experience. |
| 12 | **Testing Ease** | Straightforwardness of writing and maintaining unit/integration tests. | Mature testing ecosystem; easy mocking; fast test suites. | Flaky tests; complex test harness; difficult to mock dependencies. |

### Base Weight (x1)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 13 | **Simplicity** | Minimal moving parts and obvious system flow. | Single service/module; <10K LOC; obvious data flow. | Complex orchestration; many abstractions; hard to reason about. |
| 14 | **Elegance** | Clean architecture and adherence to well-known patterns. | Textbook separation of concerns; no "hacks" or ad-hoc solutions. | Inconsistent patterns; tight coupling; "duct-tape" integration logic. |
| 15 | **Observability** | Integration with Datadog and OpenTelemetry for tracing and logging. | First-class tracing; standard correlation IDs; rich structured logs. | Manual instrumentation required; gaps in tracing coverage. |

## Score Calculation

```
Score = (C1) * 7
      + (C2 + C3 + C4) * 5
      + (C5 + C6 + C7 + C8 + C9 + C10) * 3
      + (C11 + C12) * 2
      + (C13 + C14 + C15) * 1
```

**Maximum possible score**: (7 * 5) + (15 * 5) + (30 * 3) + (10 * 2) + (15 * 1) = 35 + 75 + 90 + 20 + 15 = **235**

## Scoring Guidelines

- **Strategic Alignment Over Execution Speed**: Long-term fit in 12go's mature ecosystem is now the primary driver (7x).
- **Maintainability Split**: Evaluate maintainability through two lenses: the current builders (.NET) and the potential long-term owners (PHP).
- **Foreign Body Risk**: Weigh the cost of introducing a non-standard runtime (.NET) against the benefit of team productivity.
- **Performance Tolerance**: 5ms added search latency is acceptable, but reliability and horizontal scalability are required.
- **Team Retention**: Consider the psychological impact of moving to a "legacy" or "less-preferred" stack for a senior .NET team.
