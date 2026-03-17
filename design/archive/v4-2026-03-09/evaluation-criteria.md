---
status: draft
last_updated: 2026-03-17
---

# Evaluation Criteria (v5)

Revised evaluation rubric calibrated for the **solo developer reality** confirmed in the March 17 Team Lead sync. Key changes from v4:

- **All criteria recalibrated for 1 developer (Soso), not 3-4** — scoring anchors, weights, and descriptions rebuilt from scratch
- **"Team Competency Match" renamed to "Solo Developer Fit"** — it's one person's skills, not a team's
- **Simplicity elevated from Medium (x2) to High (x3)** — a solo developer cannot afford complexity; this is now a survival criterion
- **Development Velocity demoted from Medium (x2) to Low (x1)** — with one person, raw velocity matters less than not getting stuck; absorbed into Implementation Effort and Solo Developer Fit
- **AI-Friendliness remains High (x3)** — AI is Soso's "team"; this is the primary force multiplier
- **Implementation Effort recalibrated** — "2-3 weeks with 3 devs" is meaningless; anchors now reflect what one AI-assisted developer can do in Q2
- **Disposability elevated from Low (x1) to Medium (x2)** — F3 refactoring is now confirmed for Q2 planning, making double-migration risk concrete

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
| C1 | **Implementation Effort** | Time and complexity for one AI-assisted developer to build a working MVP that passes all 13 endpoints | Soso ships MVP in 3-4 weeks solo with AI assistance; most code is AI-generated with light review | 3+ months solo, major unknowns, requires learning a new ecosystem from scratch before productive work begins |
| C2 | **Solo Developer Fit** | How well the tech stack aligns with Soso's specific skills (12 years .NET, senior-level) and the solo developer constraint | Soso is immediately productive on day 1, deep expertise in the stack, can debug production issues alone at 3am | Stack requires months of learning, Soso is a beginner, cannot independently diagnose and fix production issues |
| C3 | **AI-Friendliness** | How well the design (language + framework + architecture) works with Claude Code for initial build, ongoing maintenance, debugging, and test generation — AI is Soso's "team" | AI generates correct, idiomatic code on first try; tests are AI-generatable; AI can navigate and modify the codebase autonomously | AI struggles with patterns; generated code frequently wrong; Soso must manually fix most AI output |
| C4 | **Search Performance** | Latency overhead introduced by the proxy layer for the search endpoint (the most latency-sensitive operation) | < 5ms added overhead, correct connection pooling, no blocking on hot path | > 50ms added overhead, synchronous serialization, no connection reuse |
| C5 | **Simplicity** | Minimal moving parts, easy for one person to hold the entire system in their head | Single service, < 5K LOC, obvious call flow, one person can understand everything without documentation | Multiple services, complex orchestration, 10+ layers; impossible for one person to reason about the whole system |

### Medium Weight (x2)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|---|---|---|---|
| C6 | **Migration Risk** | Risk of breaking existing clients during the transition, especially critical with one developer who can't parallel-track fixes and new work | Zero-downtime, parallel run possible, easy rollback; one person can manage the cutover safely | Big-bang cutover, hard to rollback, client-visible failures; requires coordinated effort beyond one developer |
| C7 | **Testing Ease** | How straightforward it is to write and maintain tests, especially with AI generating them | Simple unit tests for transformations, easy mocking, AI generates correct test cases; Soso can maintain test suite alone | Complex test setup, flaky tests, hard to isolate logic; test maintenance becomes a second job |
| C8 | **Infrastructure Fit** | How naturally the solution deploys on 12go's EC2/Docker infrastructure, and how readily 12go DevOps will accept it | Drops into existing infra, DevOps has experience with the runtime, zero new infrastructure required | Requires new infrastructure support, unknown runtime to DevOps, additional operational burden |
| C9 | **Disposability** | How easy is it to replace or significantly modify this service when F3 is decomposed? Clean adapter boundaries, formalized contracts, minimal coupling to current 12go API surface | Clean adapter boundary, contract tests in place, 12go client is an isolated layer; replacement is a bounded task | Deep coupling to current 12go API shape, no boundary between proxy logic and 12go specifics; replacement means rewrite |

### Low Weight (x1)

| # | Criterion | Description | What 5 Looks Like | What 1 Looks Like |
|---|---|---|---|---|
| C10 | **Elegance** | Architecture patterns match the problem; separation of concerns is natural, not forced | Textbook clean for a proxy service, patterns well-applied, code reads like documentation | Patterns applied for their own sake, mismatch between problem complexity and solution complexity |
| C11 | **Monitoring/Observability** | Integration with Datadog, correlation ID propagation, structured logging, distributed tracing | Native Datadog APM support, full trace propagation, structured logs with correlation ID | Manual instrumentation, no trace propagation, incomplete metrics |
| C12 | **Development Velocity** | Speed of adding new features or modifying endpoints after MVP, for a single developer with AI | Change an endpoint in hours; AI generates the change, Soso reviews and ships | Every change requires navigating unfamiliar patterns; modifications take days even with AI help |

---

## Score Calculation

```
Score = (C1 + C2 + C3 + C4 + C5) × 3
      + (C6 + C7 + C8 + C9) × 2
      + (C10 + C11 + C12) × 1
```

**Maximum possible score**: (5×5 × 3) + (4×5 × 2) + (3×5 × 1) = 75 + 40 + 15 = **130**

---

## Analyzer Agent Coverage

Each analyzer agent scores a specific subset of criteria:

| Agent | Criteria Scored |
|---|---|
| **Execution Realist** | C1 (Implementation Effort), C2 (Solo Developer Fit), C6 (Migration Risk), C12 (Development Velocity) |
| **AI Friendliness** | C3 (AI-Friendliness), C7 (Testing Ease), C10 (Elegance — partial, AI navigability lens only) |
| **Technical Merit** | C4 (Search Performance), C5 (Simplicity), C8 (Infrastructure Fit), C9 (Disposability), C10 (Elegance — authoritative score), C11 (Monitoring/Observability) |
| **Red Team** | Does not score. Produces failure mode analysis per design. |

**C10 Elegance scoring rule**: Technical Merit produces the authoritative C10 score. AI Friendliness produces a supplementary C10 sub-score from the AI navigability lens only (does the architecture use well-known patterns that AI tools generate and navigate reliably?). The Comparison Matrix Synthesizer uses Technical Merit's C10 score for the weighted total; the AI Friendliness sub-score is noted as context.

**C9 Disposability**: Scored by Technical Merit, which evaluates boundary clarity and adapter isolation for each design. The Disposable Architecture design agent's proposals inform this scoring but do not evaluate other designs.

---

## Scoring Guidelines

When scoring, consider:
- **Soso is the sole developer** — 12 years .NET experience, 2 years at the company, senior-level
- **AI tools (Claude Code with multi-agent workflows) are Soso's "team"** — this is the primary productivity multiplier, not a nice-to-have
- **Q2 2026 deadline** — new clients must onboard on the new system; architecture decision needed ASAP
- **Not throwaway** — the design will live for a significant time during gradual client migration; it needs to be reasonably solid
- **F3 refactoring is real** — Q2 planning starts; code inside F3 may face a second migration; this makes disposability a concrete concern, not academic
- **No local persistence** — rely on 12go as source of truth; eliminates database management overhead but requires additional API calls for some data
- **Scope reduction possible** — gRPC module can be scoped out, booking notification could be offloaded; score based on the core 13 endpoints
- **Search latency matters most** — booking funnel latency is secondary
- **12go's DevOps manages infrastructure** — we don't control the runtime environment
- **Simplicity is survival** — a solo developer who cannot hold the entire system in their head will drown; complexity is the enemy
- **The system may need to be maintained by different people (or AI tools) in 6+ months** — clarity and AI-navigability matter for handoff

---

## Comparison to v1-v4 Criteria

| Criterion | v1-v3 Weight | v4 Weight | v5 Weight | v5 Rationale |
|---|---|---|---|---|
| Implementation Effort | x3 | x3 | x3 | Unchanged — still critical; anchors recalibrated for 1 developer |
| Team Competency Match → Solo Developer Fit | x3 | x3 | x3 | Renamed; recalibrated for one person's skills, not a team's |
| AI-Friendliness | x2 | x3 | x3 | Unchanged from v4 — AI is now the entire "team" |
| Search Performance | x3 | x3 | x3 | Unchanged — system requirement, not team-dependent |
| Simplicity | x2 | x2 | **x3** | **Elevated** — solo developer cannot afford complexity |
| Development Velocity | x2 | x2 | **x1** | **Demoted** — with one person, velocity is subsumed by effort and fit |
| Migration Risk | x2 | x2 | x2 | Unchanged — one person makes safe migration even more critical |
| Testing Ease | x1→x2 | x2 | x2 | Unchanged from v4 — AI test generation remains first-class |
| Infrastructure Fit | x3→x2 | x2 | x2 | Unchanged from v4 |
| Disposability | — | x1 | **x2** | **Elevated** — F3 refactoring confirmed for Q2 planning; double-migration risk is now concrete |
| Elegance | x1 | x1 | x1 | Unchanged |
| Monitoring/Observability | x1 | x1 | x1 | Unchanged |
| Maintainability | x2 | — | — | Removed in v4; covered by Disposability + AI-Friendliness |
| Operational Complexity | x2 | — | — | Removed in v4; folded into Infrastructure Fit |
| Strategic Alignment | varies | — | — | Removed in v4; unknowable |
| Future Extensibility | x1 | — | — | Removed in v4; unknowable |
