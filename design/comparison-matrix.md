---
status: draft
last_updated: 2026-03-17
---

# Comparison Matrix (v5)

Scored against [evaluation-criteria.md](evaluation-criteria.md) (v5) calibrated for solo developer reality.

## Hard Constraint Check (Pass/Fail)

All 6 designs pass the hard constraints:

| Constraint | PM | CS | PE | DA | TF | DI |
|---|---|---|---|---|---|---|
| All 13 client-facing endpoints preserved | Pass | Pass | Pass | Pass | Pass | Pass |
| Money format preserved (strings, net/gross/taxes) | Pass | Pass | Pass | Pass | Pass | Pass |
| Header conventions preserved | Pass | Pass | Pass | Pass | Pass | Pass |
| 206 Partial Content behavior preserved | Pass | Pass | Pass | Pass | Pass | Pass |
| No new client-facing changes | Pass | Pass | Pass | Pass | Pass | Pass |

**Legend**: PM = Pragmatic Minimalist, CS = Clean Slate Designer, PE = Platform Engineer, DA = Data Flow Architect, TF = Team-First Developer, DI = Disposable Architecture

---

## Per-Criterion Scores

### High Weight (x3)

| # | Criterion | PM | CS | PE | DA | TF | DI | Scored by |
|---|---|---|---|---|---|---|---|---|
| C1 | Implementation Effort | 3 | 3 | 3 | 2 | 3 | 2 | Execution Realist |
| C2 | Solo Developer Fit | 2 | 1 | 2 | 2 | 2 | 2 | Execution Realist |
| C3 | AI-Friendliness | 3 | 4 | 3.5 | 3 | 3.5 | 2.5 | AI Friendliness |
| C4 | Search Performance | 3 | 5 | 3 | 3 | 2 | 3 | Technical Merit |
| C5 | Simplicity | 4 | 5 | 4 | 2 | 4 | 3 | Technical Merit |

### Medium Weight (x2)

| # | Criterion | PM | CS | PE | DA | TF | DI | Scored by |
|---|---|---|---|---|---|---|---|---|
| C6 | Migration Risk | 4 | 4 | 4 | 3 | 4 | 4 | Execution Realist |
| C7 | Testing Ease | 3 | 4 | 3.5 | 3 | 4 | 3.5 | AI Friendliness |
| C8 | Infrastructure Fit | 5 | 2 | 5 | 4 | 5 | 3 | Technical Merit |
| C9 | Disposability | 2 | 3 | 2 | 2 | 3 | 5 | Technical Merit |

### Low Weight (x1)

| # | Criterion | PM | CS | PE | DA | TF | DI | Scored by |
|---|---|---|---|---|---|---|---|---|
| C10 | Elegance | 3 | 5 | 3 | 2 | 3 | 4 | Technical Merit (authoritative) |
| C11 | Monitoring/Observability | 2 | 2 | 5 | 4 | 3 | 2 | Technical Merit |
| C12 | Development Velocity | 3 | 3 | 3 | 2 | 3 | 2 | Execution Realist |

**C10 supplementary scores (AI navigability lens, from AI Friendliness agent)**: PM=3, CS=5, PE=3.5, DA=3, TF=4, DI=3. These are context only; the weighted total uses Technical Merit's authoritative C10 score above.

---

## Weighted Totals

```
Score = (C1 + C2 + C3 + C4 + C5) × 3
      + (C6 + C7 + C8 + C9) × 2
      + (C10 + C11 + C12) × 1
```

| Design | High (×3) | Medium (×2) | Low (×1) | **Total** | % of Max (130) |
|---|---|---|---|---|---|
| **Clean Slate Designer** (Go) | (3+1+4+5+5)=18 → 54 | (4+4+2+3)=13 → 26 | (5+2+3)=10 | **90** | 69% |
| **Platform Engineer** (PHP standalone) | (3+2+3.5+3+4)=15.5 → 46.5 | (4+3.5+5+2)=14.5 → 29 | (3+5+3)=11 | **86.5** | 67% |
| **Team-First Developer** (PHP/F3) | (3+2+3.5+2+4)=14.5 → 43.5 | (4+4+5+3)=16 → 32 | (3+3+3)=9 | **84.5** | 65% |
| **Pragmatic Minimalist** (PHP/F3) | (3+2+3+3+4)=15 → 45 | (4+3+5+2)=14 → 28 | (3+2+3)=8 | **81** | 62% |
| **Disposable Architecture** (ACL pattern) | (2+2+2.5+3+3)=12.5 → 37.5 | (4+3.5+3+5)=15.5 → 31 | (4+2+2)=8 | **76.5** | 59% |
| **Data Flow Architect** (event overlay) | (2+2+3+3+2)=12 → 36 | (3+3+4+2)=12 → 24 | (2+4+2)=8 | **68** | 52% |

### Arithmetic Verification

Each row verified manually:

- **CS**: 3(18) + 2(13) + 1(10) = 54 + 26 + 10 = 90 ✓
- **PE**: 3(15.5) + 2(14.5) + 1(11) = 46.5 + 29 + 11 = 86.5 ✓
- **TF**: 3(14.5) + 2(16) + 1(9) = 43.5 + 32 + 9 = 84.5 ✓
- **PM**: 3(15) + 2(14) + 1(8) = 45 + 28 + 8 = 81 ✓
- **DI**: 3(12.5) + 2(15.5) + 1(8) = 37.5 + 31 + 8 = 76.5 ✓
- **DA**: 3(12) + 2(12) + 1(8) = 36 + 24 + 8 = 68 ✓

---

## Red Team Fatal Flaws

| Design | Fatal Flaw? | Summary |
|---|---|---|
| **Pragmatic Minimalist** | No | F3 local dev friction is High/High but not fatal. Booking schema parser risk is High/Medium. |
| **Clean Slate Designer** | **Conditional** | Fatal if DevOps refuses Go container OR management blocks non-PHP service. The "one system" directive and zero Go expertise in the org are the blockers. |
| **Platform Engineer** | No | Two-codebase overhead is real but manageable. Team Lead may insist on F3 co-location. |
| **Data Flow Architect** | **Yes -- not a complete design** | Must be combined with another design. Cannot be selected standalone. Its event architecture should be adopted as an overlay. |
| **Team-First Developer** | No | PHP learning curve for booking schema parser is the primary risk. AGENTS.md and fixture-driven approach are strong mitigations. |
| **Disposable Architecture** | **Conditional** | Adapter boundary will likely be shortcut under Q2 deadline pressure. Best treated as a pattern overlay, not a standalone choice. |

---

## Key Scoring Tensions

**1. Clean Slate scores highest overall but has a fatal organizational flaw (C2=1, C8=2).**
Go scores 5/5 on Performance, Simplicity, and Elegance, but 1/5 on Solo Developer Fit and 2/5 on Infrastructure Fit. If these two criteria were not High/Medium weight, Go would dominate. The question is whether organizational constraints override technical merit.

**2. Team-First Developer scores highest on Medium-weight criteria (32/40).**
C6=4, C7=4, C8=5, C9=3 give it the strongest medium-tier score, beating all PHP designs on Testing and Disposability due to fixture-driven approach and namespace isolation.

**3. Platform Engineer wins on observability but loses to TF on testing and disposability.**
PE's 5/5 on Monitoring/Observability is unique, but it's a x1 criterion. PE's lack of adapter boundary (C9=2) and application architecture detail hurts.

**4. Disposable Architecture has the best C9 (5/5) but the worst C1 and C3.**
The adapter pattern is the most architecturally sound for F3 decomposition but the most expensive to implement for a solo developer under deadline.

**5. Data Flow Architect is the only design that addresses the event pipeline gap.**
Its C11=4 reflects real value (14 critical events identified), but as a non-complete design it cannot be selected. Its event architecture must be grafted onto the winner.
