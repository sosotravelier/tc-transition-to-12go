---
status: draft
last_updated: 2026-03-09
---

# Evaluation Criteria (v4)

This is the revised evaluation rubric aligned with the perspective-based agent set (v4). Key changes from v1-v3:
- **AI-Friendliness elevated to High weight (x3)** -- reflects how this team actually works
- **Strategic Alignment removed** -- 12go's direction is unknown; scoring it introduced false precision
- **Disposability added** as a new criterion -- given F3 will be decomposed, designs should be evaluated on how easy they are to replace or adapt
- **Client impact is a hard constraint (pass/fail)**, not a scored criterion -- all designs must preserve all 13 endpoints exactly; any design that doesn't is eliminated before scoring

## Hard Constraints (Pass/Fail)

Before scoring, verify each design passes these constraints:

| Constraint | Pass Criteria |
|---|---|
| All 13 client-facing endpoints preserved | Every endpoint from `prompts/context/system-context.md` is handled |
| Money format preserved | Amounts as strings, net/gross/taxes pricing structure |
| Header conventions preserved | `Travelier-Version`, `x-correlation-id`, `x-api-experiment` |
| 206 Partial Content behavior preserved | Incomplete supplier data returns 206, not 200 |
| No new client-facing changes | Clients should not need to change anything |

A design that fails any constraint is not scored.

---

## Scoring System

Each alternative is scored 1-5 on each criterion:
- **1** = Poor / High risk / High effort
- **2** = Below average
- **3** = Acceptable / Moderate
- **4** = Good
- **5** = Excellent / Low risk / Low effort

Final score = weighted sum of all criteria.

---

## Criteria

### High Weight (x3)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|---|---|---|---|
| 1 | **Implementation Effort** | Time and complexity to build a working MVP that passes all 13 endpoints with the actual team | MVP in 2-3 weeks with 3 devs | 3+ months, major unknowns, ramp-up required |
| 2 | **Team Competency Match** | How well the tech stack aligns with the team's existing .NET expertise and current skills | Team is immediately productive, no ramp-up | Team needs months of training before effective contribution |
| 3 | **AI-Friendliness** | How well the design (language + framework + architecture patterns) works with Cursor/Claude for initial build, ongoing maintenance, debugging, and test generation | AI generates correct, idiomatic code on first try; tests are AI-generatable | AI struggles with patterns; generated code frequently wrong or non-idiomatic |
| 4 | **Search Performance** | Latency overhead introduced by the proxy layer for the search endpoint (the most latency-sensitive operation) | < 5ms added overhead, correct connection pooling, no blocking on hot path | > 50ms added overhead, synchronous serialization, no connection reuse |

### Medium Weight (x2)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|---|---|---|---|
| 5 | **Development Velocity** | Speed of adding new features or modifying endpoints after MVP | Change an endpoint in hours, AI generates the change | Every change requires navigating unfamiliar framework patterns |
| 6 | **Simplicity** | Minimal moving parts, easy to reason about the whole system | Single service, < 5K LOC, obvious call flow | Multiple services, complex orchestration, 10+ layers |
| 7 | **Migration Risk** | Risk of breaking existing clients during the transition | Zero-downtime, parallel run possible, easy rollback | Big-bang cutover, hard to rollback, client-visible failures |
| 8 | **Testing Ease** | How straightforward it is to write and maintain tests | Simple unit tests for transformations, easy mocking, AI-generatable | Complex test setup, flaky tests, hard to isolate logic |
| 9 | **Infrastructure Fit** | How naturally the solution deploys on 12go's EC2/Docker infrastructure, and how readily 12go DevOps will accept it | Drops into existing infra, DevOps has experience with the runtime | Requires new infrastructure support, unknown to DevOps |

### Low Weight (x1)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|---|---|---|---|
| 10 | **Elegance** | Architecture patterns match the problem; separation of concerns is natural | Textbook clean for a proxy service, patterns well-applied | Patterns applied for their own sake, mismatch with problem complexity |
| 11 | **Monitoring/Observability** | Integration with Datadog, correlation ID propagation, structured logging, distributed tracing | Native Datadog APM support, full trace propagation, structured logs | Manual instrumentation, no trace propagation, incomplete metrics |
| 12 | **Disposability** | How easy is it to replace or significantly modify this service when F3 is decomposed? Clean adapter boundaries, formalized contracts, minimal coupling to current 12go API surface | Clean adapter boundary, contract tests in place, 12go client is an isolated layer | Deep coupling to current 12go API shape, no boundary between proxy logic and 12go specifics |

---

## Score Calculation

```
Score = (C1 + C2 + C3 + C4) * 3
      + (C5 + C6 + C7 + C8 + C9) * 2
      + (C10 + C11 + C12) * 1
```

**Maximum possible score**: (4×5 × 3) + (5×5 × 2) + (3×5 × 1) = 60 + 50 + 15 = **125**

---

## Analyzer Agent Coverage

Each analyzer agent scores a specific subset of criteria:

| Agent | Criteria Scored |
|---|---|
| **Execution Realist** | C1 (Implementation Effort), C2 (Team Competency Match), C5 (Development Velocity), C7 (Migration Risk) |
| **AI Friendliness** | C3 (AI-Friendliness), C8 (Testing Ease), C10 (Elegance -- partial, AI navigability lens only) |
| **Technical Merit** | C4 (Search Performance), C6 (Simplicity), C9 (Infrastructure Fit), C10 (Elegance -- authoritative score), C11 (Monitoring/Observability), C12 (Disposability) |
| **Red Team** | Does not score. Produces failure mode analysis per design. |

**C10 Elegance scoring rule**: Technical Merit produces the authoritative C10 score. AI Friendliness produces a supplementary C10 sub-score from the AI navigability lens only (does the architecture use well-known patterns that AI tools generate and navigate reliably?). The Comparison Matrix Synthesizer uses Technical Merit's C10 score for the weighted total; the AI Friendliness sub-score is noted as context.

**C12 Disposability**: Scored by Technical Merit, which evaluates boundary clarity and adapter isolation for each design. The Disposable Architecture design agent's proposals inform this scoring but do not evaluate other designs.

---

## Scoring Guidelines

When scoring, consider:
- The team is 3-4 .NET developers, AI-augmented, with one less-available team lead
- AI tools (Cursor/Claude) are used heavily -- this is a real productivity multiplier, not a footnote
- Search latency matters most; booking funnel latency is secondary
- 12go's DevOps manages infrastructure -- we don't control the runtime environment
- F3 will be decomposed (no timeline) -- disposability is a genuine concern, not academic
- Simplicity is preferred over "correct" architecture when trade-offs exist
- The system may need to be maintained by different people (or AI tools) in 6+ months

---

## Comparison to v1-v3 Criteria

| Criterion | v1-v3 Weight | v4 Weight | Rationale |
|---|---|---|---|
| Implementation Effort | x3 | x3 | Unchanged -- still most critical |
| Team Competency Match | x3 | x3 | Unchanged |
| Search Performance | x3 | x3 | Unchanged |
| Infrastructure Fit | x3 | x2 | Reduced -- important but secondary to team fit |
| AI-Friendliness | x2 | x3 | **Elevated** -- reflects actual team workflow |
| Maintainability | x2 | -- | Replaced by explicit Disposability criterion |
| Development Velocity | x2 | x2 | Unchanged |
| Simplicity | x2 | x2 | Unchanged |
| Operational Complexity | x2 | -- | Folded into Infrastructure Fit |
| Migration Risk | x2 | x2 | Unchanged |
| Future Extensibility | x1 | **removed** | Strategic alignment is unknowable |
| Elegance | x1 | x1 | Unchanged |
| Testing Ease | x1 | x2 | **Elevated** -- AI test generation is a first-class concern |
| Monitoring/Observability | x1 | x1 | Unchanged |
| Disposability | -- | x1 | **New** -- F3 decomposition is a real future event |
