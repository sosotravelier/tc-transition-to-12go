---
status: draft
last_updated: 2026-02-24
---

# Evaluation Criteria (v2)

## Scoring System

Each alternative is scored 1-5 on each criterion:
- **1** = Poor / High risk / High effort
- **2** = Below average
- **3** = Acceptable / Moderate
- **4** = Good
- **5** = Excellent / Low risk / Low effort

Final score = weighted sum of all criteria.

## Criteria

### High Weight (x3)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 1 | **Implementation Effort** | Time and complexity to build a working MVP that passes all 13 endpoints | MVP in 2-3 weeks with 3 devs | 3+ months, major unknowns |
| 2 | **Infrastructure Fit** | How naturally the solution deploys on 12go's EC2/Docker infrastructure | Drops into existing infra seamlessly | Requires new infrastructure |
| 3 | **Maintainability** | Long-term code health, readability, onboarding cost for future devs | Clean, self-documenting, easy to extend | Spaghetti, tribal knowledge required |
| 4 | **Development Velocity** | Speed of adding new features or modifying endpoints after MVP | Change an endpoint in hours | Every change is a multi-day effort |
| 5 | **Migration Risk** | Risk of breaking existing clients during the transition | Zero-downtime, parallel run possible | Big-bang cutover, high risk |
| 6 | **Future Extensibility** | Alignment with 12go's future direction (possibly Go) | Naturally evolves with 12go's stack | Dead-end technology choice |

### Medium Weight (x2)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 7 | **Team Competency Match** | How well the tech stack aligns with the team's existing .NET expertise | Team is immediately productive | Team needs months of training |
| 8 | **Simplicity** | Minimal moving parts, easy to reason about the whole system | Single service, < 5K LOC, obvious flow | Multiple services, complex orchestration |
| 9 | **Operational Complexity** | Deployment, monitoring, debugging, on-call overhead | Single deployment, Datadog integration | Multiple deployments, custom tooling |
| 10 | **Testing Ease** | How straightforward it is to write and maintain tests | Simple unit tests, easy mocking | Complex test setup, flaky tests |

### Low Weight (x1)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|-----------|-------------|-------------------|-------------------|
| 11 | **Search Performance** | Latency and throughput for the search endpoint at 12go's scale. *5ms added latency with 12go endpoint is tolerable.* | Sub-200ms p95, scales horizontally | Seconds of latency, bottlenecks |
| 12 | **AI-Friendliness** | How well the codebase works with Cursor/Claude/Copilot for development | AI generates correct code on first try | AI struggles with the patterns |
| 13 | **Elegance** | Clean architecture, separation of concerns, well-known patterns | Textbook clean, patterns well-applied | Hacky, inconsistent, ad-hoc |
| 14 | **Monitoring/Observability** | Integration with Datadog, correlation IDs, structured logging, tracing | Native Datadog support, full tracing | Manual instrumentation needed |

## Score Calculation

```
Score = (C1 + C2 + C3 + C4 + C5 + C6) * 3
      + (C7 + C8 + C9 + C10) * 2
      + (C11 + C12 + C13 + C14) * 1
```

**Maximum possible score**: (30 * 3) + (20 * 2) + (20 * 1) = 90 + 40 + 20 = **150**

## Scoring Guidelines

When scoring, consider:
- The team has 3-4 .NET developers and uncertain retention
- AI-augmented development is the norm, not the exception
- **Search latency is acceptable** — 5ms added latency with 12go endpoint is tolerable; booking latency is secondary
- 12go's DevOps manages infrastructure — we don't
- The solution may need to be maintained by different people in 6+ months
- Simplicity is preferred over "correct" architecture when trade-offs exist
