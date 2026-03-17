---
status: complete
last_updated: 2026-03-17
---

# Comparison Matrix (v4)

This matrix aggregates scores from the four Phase 3 analyzer agents. Each criterion is scored by one authoritative agent (see `evaluation-criteria.md` coverage table). Arithmetic verified manually.

---

## Score Key

- **1** = Poor / High risk / High effort
- **5** = Excellent / Low risk / Low effort
- Weights: High criteria ×3, Medium ×2, Low ×1
- Maximum possible score: **130**

---

## Per-Criterion Score Sources

| Criterion | Weight | Scored By |
|---|---|---|
| C1 Implementation Effort | ×3 | Execution Realist |
| C2 Solo Developer Fit | ×3 | Execution Realist |
| C3 AI-Friendliness | ×3 | AI Friendliness |
| C4 Search Performance | ×3 | Technical Merit |
| C5 Simplicity | ×3 | Technical Merit |
| C6 Migration Risk | ×2 | Execution Realist |
| C7 Testing Ease | ×2 | AI Friendliness |
| C8 Infrastructure Fit | ×2 | Technical Merit |
| C9 Disposability | ×2 | Technical Merit |
| C10 Elegance | ×1 | Technical Merit (authoritative); AI Friendliness (supplementary) |
| C11 Monitoring/Observability | ×1 | Technical Merit |
| C12 Development Velocity | ×1 | Execution Realist |

---

## Full Scores

| Design | C1 (×3) | C2 (×3) | C3 (×3) | C4 (×3) | C5 (×3) | C6 (×2) | C7 (×2) | C8 (×2) | C9 (×2) | C10 (×1) | C11 (×1) | C12 (×1) | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Disposable Architecture | 4 | 4 | 3.5 | 3 | 3 | 4 | 4.0 | 3 | 5 | 4 | 2 | 4 | **94.5** |
| Team-First Developer | 3 | 2 | 3.5 | 3 | 4 | 4 | 4.0 | 4 | 3 | 3 | 3 | 3 | **85.5** |
| Pragmatic Minimalist | 3 | 2 | 3.0 | 3 | 5 | 4 | 3.0 | 5 | 2 | 4 | 3 | 2 | **85.0** |
| Platform Engineer | 3 | 2 | 3.0 | 3 | 4 | 4 | 2.5 | 5 | 2 | 3 | 5 | 3 | **83.0** |
| Clean Slate Designer | 2 | 1 | 3.5 | 5 | 5 | 3 | 4.0 | 2 | 3 | 5 | 1 | 2 | **81.5** |
| Data Flow Architect | 2 | 2 | 3.0 | 3 | 3 | 3 | 3.0 | 4 | 2 | 3 | 5 | 2 | **73.0** |

---

## Weighted Subtotal Verification

Formula: `(C1+C2+C3+C4+C5)×3 + (C6+C7+C8+C9)×2 + (C10+C11+C12)×1`

| Design | High ×3 | Medium ×2 | Low ×1 | Total |
|---|---|---|---|---|
| Disposable Architecture | (4+4+3.5+3+3)×3 = 17.5×3 = **52.5** | (4+4+3+5)×2 = 16×2 = **32** | (4+2+4)×1 = **10** | **94.5** |
| Team-First Developer | (3+2+3.5+3+4)×3 = 15.5×3 = **46.5** | (4+4+4+3)×2 = 15×2 = **30** | (3+3+3)×1 = **9** | **85.5** |
| Pragmatic Minimalist | (3+2+3+3+5)×3 = 16×3 = **48** | (4+3+5+2)×2 = 14×2 = **28** | (4+3+2)×1 = **9** | **85.0** |
| Platform Engineer | (3+2+3+3+4)×3 = 15×3 = **45** | (4+2.5+5+2)×2 = 13.5×2 = **27** | (3+5+3)×1 = **11** | **83.0** |
| Clean Slate Designer | (2+1+3.5+5+5)×3 = 16.5×3 = **49.5** | (3+4+2+3)×2 = 12×2 = **24** | (5+1+2)×1 = **8** | **81.5** |
| Data Flow Architect | (2+2+3+3+3)×3 = 13×3 = **39** | (3+3+4+2)×2 = 12×2 = **24** | (3+5+2)×1 = **10** | **73.0** |

---

## Red Team Fatal Flaws Per Design

| Design | Amplified Error Scenario | Severity | Likelihood |
|---|---|---|---|
| **Disposable Architecture** | The domain layer does not match the decomposed F3's new API paradigm (could be event-driven vs. request/response), making the "permanent" layer require rewriting too. Additionally: design does not choose a language, creating ambiguity. | High | Medium |
| **Team-First Developer** | No 12go team member is assigned to maintain the standalone PHP service post-departure — the PHP rationale collapses, but the language choice has already cost 2-4 weeks vs. .NET. | High | Medium |
| **Pragmatic Minimalist** | Per-endpoint migration turns out to be incompatible across the booking funnel (itinerary IDs not compatible between old and new services), requiring full-funnel cutover or per-client routing — both rejected by this design. | High | Medium |
| **Platform Engineer** | DevOps does not treat a standalone PHP Symfony container identically to F3, requiring restructuring to fit F3's build/deploy conventions. (Unresolved: question G4.) | Critical | Medium |
| **Clean Slate Designer** | Go's JSON handling for the booking schema mapper proves unmanageable at month 3, requiring a language rewrite. Plus: no one on the team can maintain Go in production. | Critical | High |
| **Data Flow Architect** | Data team needs Kafka, not structured logs — complete event emission rewrite required. Three months of structured-log events are not retroactively replayable. (Data team call still unresolved as of Mar 17.) | Critical | High |

---

## Cross-Cutting Notes

**C10 Elegance — supplementary AI Friendliness sub-scores (not used in totals):**

| Design | AI Friendliness C10 | Technical Merit C10 (authoritative) |
|---|---|---|
| Pragmatic Minimalist | 4.0 | 4 |
| Disposable Architecture | 3.5 | 4 |
| Data Flow Architect | 3.0 | 3 |
| Team-First Developer | 4.0 | 3 |
| Platform Engineer | 3.0 | 3 |
| Clean Slate Designer | 4.5 | 5 |

**Language underpins C1 and C2 scores.** Disposable Architecture's lead (94.5) reflects C# implementation — if mandated to PHP, C1 drops from 4→3 and C2 drops from 4→2, reducing the total to ~79.5, making it competitive with Team-First Developer.

**Data Flow Architect is not a standalone design.** It scored 73 as an architecture proposal; its event schema work is orthogonal to the proxy architecture and should be adopted as a layer over whichever design is chosen.

**Unresolved blocking questions affect all scores:**
- G4 (DevOps standalone PHP support) — blocks Platform Engineer and Team-First Developer
- Data team call (event schema requirements) — blocks Data Flow Architect
- G3 (12go preferred language) — affects all language scores

---

## Score Range Context

| Band | Range | Meaning |
|---|---|---|
| Strong recommendation | 90-130 | Substantially outperforms alternatives |
| Competitive | 80-89 | Good design, viable choice, trade-offs are real |
| Conditional | 70-79 | Viable only if specific conditions are met |
| Not recommended | <70 | Significant gaps; combine with another design or reject |
