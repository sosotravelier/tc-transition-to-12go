# Comparison Matrix

## Scoring Methodology

Each alternative was self-assessed by its design agent against 14 criteria (scored 1-5), then reviewed by 6 independent reviewers: Systems Architect, AI-Augmented Architect, Business Risk Assessor, Scale & Performance Engineer, DevOps & Infrastructure Architect, and Developer Experience Advocate.

**Adjusted scores** reflect reviewer consensus. Where reviewers disagreed, the domain expert's opinion for that criterion was weighted more heavily (e.g., AI-Augmented Architect for AI-Friendliness, DevOps Architect for Infrastructure Fit). Where multiple reviewers independently suggested the same adjustment, it was applied.

**Formula**: High(×3) + Medium(×2) + Low(×1). Maximum = 140.

> **Note on BFF (04) self-assessment**: The design document reported a self-assessment total of 99/140, but the per-criterion scores actually sum to 116/140 (arithmetic error: 48+54+14 = 116, not 99). Reviewers worked from the 99 figure, but this matrix uses per-criterion scores and computes totals correctly.

---

## Score Summary

| # | Criterion (Weight) | .NET (01) | PHP (02) | Go (03) | BFF (04) | TS (05) |
|---|---------------------|-----------|----------|---------|----------|---------|
| 1 | Implementation Effort (×3) | **4** | 2 ↓ | 3 | **4** | 3 |
| 2 | Team Competency Match (×3) | **5** | 2 | 2 | 2 ↓ | 3 |
| 3 | Search Performance (×3) | 4 | **5** | **5** | **5** | **5** |
| 4 | Infrastructure Fit (×3) | **5** | **5** | **5** | 3 ↓ | 4 |
| | *High Weight Subtotal* | *54* | *42* | *45* | *42* | *45* |
| 5 | Maintainability (×2) | 4 ↓ | 3 | 4 | 4 | 4 |
| 6 | Development Velocity (×2) | 4 ↓ | 2 | 2 ↓ | **5** | 4 ↓ |
| 7 | Simplicity (×2) | **5** | 3 ↓ | **5** | **5** | **5** |
| 8 | AI-Friendliness (×2) | **5** | 3 ↓ | 4 | **5** | **5** |
| 9 | Operational Complexity (×2) | **5** | 4 ↓ | **5** | 3 ↓ | 4 |
| 10 | Migration Risk (×2) | 4 | 3 ↓ | 4 | 4 | 4 |
| | *Medium Weight Subtotal* | *54* | *36* | *48* | *52* | *52* |
| 11 | Future Extensibility (×1) | 2 ↓ | **4** | 3 ↓ | 3 | 3 |
| 12 | Elegance (×1) | 4 | 3 | 4 | 3 | **4** |
| 13 | Testing Ease (×1) | 4 | 4 | 4 | 4 | **5** |
| 14 | Monitoring/Observability (×1) | **5** | 4 | 4 | 3 ↓ | 4 |
| | *Low Weight Subtotal* | *15* | *15* | *15* | *13* | *16* |
| | **Weighted Total** | **123** | **93** | **108** | **107** | **113** |
| | **Rank** | **#1** | **#5** | **#3** | **#4** | **#2** |

*↓ = score lowered from self-assessment based on reviewer feedback*

### Self-Assessment vs. Adjusted Scores

| Alternative | Self-Assessed | Adjusted | Delta | Primary Adjustments |
|-------------|-------------|----------|-------|---------------------|
| .NET (01) | 128 | **123** | -5 | Maintainability 5→4, Dev Velocity 5→4, Future Extensibility 3→2 |
| PHP (02) | 104 | **93** | -11 | Impl Effort 3→2, Simplicity 4→3, AI-Friendliness 4→3, Op Complexity 5→4, Migration Risk 4→3 |
| Go (03) | 112 | **108** | -4 | Dev Velocity 3→2, Future Extensibility 5→3 |
| BFF (04) | 116* | **107** | -9 | Team Competency 3→2, Infra Fit 4→3, Op Complexity 4→3, Monitoring 4→3 |
| TS (05) | 115 | **113** | -2 | Dev Velocity 5→4 |

*\*BFF self-assessment reported as 99 due to arithmetic error; actual per-criterion total is 116*

---

## Key Differentiators

The decision hinges on three high-weight criteria that separate the alternatives most sharply:

### 1. Team Competency Match (×3) — The Decisive Criterion

| | .NET | PHP | Go | BFF | TS |
|---|---|---|---|---|---|
| Score | **5** | 2 | 2 | 2 | 3 |
| Weighted impact | **15** | 6 | 6 | 6 | 9 |

.NET's 5 vs. the field's 2-3 creates a **6-9 point gap at ×3 weight = 18-27 points of total score difference**. This single criterion accounts for most of .NET's lead. The only alternative that narrows the gap is TypeScript (3), thanks to syntactic similarity to C# (same designer, same `async/await` paradigm, same type system concepts).

### 2. Implementation Effort (×3) — Time to MVP

| | .NET | PHP | Go | BFF | TS |
|---|---|---|---|---|---|
| Score | **4** | 2 | 3 | **4** | 3 |
| Realistic MVP | 3 weeks | 10-14 weeks | 6-8 weeks | 4-5 weeks | 4-5 weeks |

.NET and BFF tie on score, but .NET's 3-week MVP requires zero ramp-up. BFF's 4-5 weeks includes 1-2 weeks of TypeScript learning. PHP's adjusted score of 2 reflects reviewer consensus that the 6-8 week self-estimate is optimistic (10-14 weeks realistic with f3 ramp-up).

### 3. Infrastructure Fit (×3) — Deployment Friction

| | .NET | PHP | Go | BFF | TS |
|---|---|---|---|---|---|
| Score | **5** | **5** | **5** | 3 | 4 |

Three alternatives score 5 (drops into existing infrastructure). BFF's Bun runtime was flagged by 3 of 6 reviewers as introducing unnecessary risk (experimental Datadog support, unproven in production). TypeScript/Node.js scores 4 — well-understood industry-wide but new for 12go's DevOps.

### 4. Search Performance (×3) — Technical Differentiator

All non-.NET alternatives score 5. .NET scores 4 — functionally equivalent for a proxy workload (both add 2-5ms overhead), but PHP Option A's Phase 2 direct MariaDB access is the only design that fundamentally eliminates the HTTP round-trip. However, this benefit only materializes after an additional 4-8 weeks beyond MVP.

### 5. Post-Ramp-Up Velocity (×2)

| | .NET | PHP | Go | BFF | TS |
|---|---|---|---|---|---|
| Dev Velocity | 4 | 2 | 2 | **5** | 4 |
| AI-Friendliness | **5** | 3 | 4 | **5** | **5** |

BFF and TypeScript lead on development velocity and AI-friendliness. These advantages compound over time but only materialize after ramp-up completes. For a team focused on a medium-term strategic window, the timing to benefit from this velocity advantage is limited.

---

## Reviewer Consensus

### Where All 6 Reviewers Agreed

- **.NET is the lowest-risk, fastest-to-deliver option.** No reviewer disputed the fundamental advantage of building in the team's native language during a system migration period.
- **PHP's dominant risk is human, not technical.** Every reviewer identified team satisfaction and stack alignment as critical factors. The technical design (especially direct MariaDB access) is sound. The question is whether the team can maintain productivity and focus during a language transition.
- **Go's strategic alignment with 12go is speculative.** "Considering Go, but nothing decided" is not a signal strong enough to justify a language change. All reviewers recommended getting a concrete commitment from 12go before choosing Go.
- **The booking schema parser is the highest-risk component regardless of language.** 20+ dynamic wildcard patterns, bracket-notation serialization, and edge cases that only surface with specific operators. This must be the #1 testing priority in every alternative.
- **BFF should use Node.js 22 LTS, not Bun.** Every reviewer who addressed this point recommended switching to Node.js. Bun's performance advantage is irrelevant when 12go responds in 50-500ms. Its production maturity gap, experimental Datadog support, and unfamiliarity to DevOps are avoidable risks.
- **All alternatives correctly identify the system as a stateless proxy.** Zero local databases is the right default. Storage should only be added for concrete requirements (notification outbox, audit trail).

### Where Reviewers Diverged

| Topic | Range of Opinion | Resolution |
|-------|-----------------|------------|
| .NET Future Extensibility | 2 (Business Risk) vs. 3 (self-assessment) | Adjusted to **2** — maintaining .NET inside a PHP shop is harder than acknowledged |
| Go Implementation Effort | 2 (Business Risk) vs. 3 (self, Systems Architect) | Kept at **3** — ramp-up eventually contributes to implementation; majority view |
| Go Team Competency Match | 1 (Business Risk) vs. 2 (self, all others) | Kept at **2** — zero experience is bad but AI bridges 60-70% |
| TS Team Competency Match | 2 (Business Risk) vs. 3 (Systems Architect, self) | Kept at **3** — TS-to-C# similarity is genuine; ecosystem gap is real but smaller |
| BFF as a viable standalone design | "Best problem decomposition" (Systems Architect) vs. "Merge with Alt 05" (Systems Architect) | The BFF's endpoint classification analysis is the most useful artifact; its runtime choice (Bun) weakens execution |
| PHP Search Performance timing | 5 for Phase 2 only; Phase 1 MVP = 4 | Scored **5** (the design's target state) with caveat that MVP matches .NET |

---

## Risk Heat Map

| Risk Category | .NET (01) | PHP (02) | Go (03) | BFF (04) | TS (05) |
|---------------|-----------|----------|---------|----------|---------|
| **Migration Timeline** | LOW | HIGH | MEDIUM | MEDIUM | LOW-MEDIUM |
| **Team Retention** | LOW | HIGH | MEDIUM-HIGH | MEDIUM | MEDIUM |
| **Client Disruption** | LOW | MEDIUM | LOW | LOW | LOW |
| **Knowledge Transfer** | MEDIUM | LOW | MEDIUM | MEDIUM | LOW-MEDIUM |
| **Operational** | LOW | MEDIUM | LOW | MEDIUM-HIGH | LOW-MEDIUM |

### Risk Commentary

**Migration Timeline**
- **.NET**: 7-8 weeks total. Team writes code from day 1. Booking schema parser is the only timeline risk.
- **PHP**: 13-21 weeks total. Includes PHP ramp-up, f3 codebase learning, and the long road from HTTP proxy (Phase 1) to direct service access (Phase 4). Extends significantly into the projected transition window.
- **Go**: 10-12 weeks total. 2-week ramp-up produces no shippable code. "C# in Go" during weeks 3-4 requires refactoring.
- **BFF**: 8-10 weeks total (with Node.js). Smallest codebase reduces timeline, but TypeScript ramp-up is underestimated at "1-2 days."
- **TS**: 8-9 weeks total. 1-week ramp-up, then nearly matches .NET velocity.

**Team Retention**
- **.NET**: Stabilizing force. Developers feel competent and in control during the migration.
- **PHP**: "A team writing code under significant stack friction produces brittle, poorly-tested software." (DX Advocate)
- **Go**: Could be career investment or a challenging transition. Depends entirely on team interest.
- **BFF/TS**: TypeScript generally perceived as a desirable skill. Higher skills-to-stack alignment than PHP/Go.

**Knowledge Transfer** (in case of team composition changes)
- **.NET**: Any .NET developer maintains it, but .NET is a standalone stack in 12go's ecosystem.
- **PHP**: 12go's own engineers maintain it natively. Best long-term ownership story.
- **Go**: Only valuable if 12go adopts Go. Otherwise maintained by neither team.
- **BFF/TS**: Largest global developer pool. Easiest to hire replacements, but TS is a technology island.

**Operational**
- **BFF**: Highest operational risk due to Bun's immaturity and experimental Datadog support. Drops to LOW-MEDIUM if switched to Node.js.
- **PHP**: Shared failure domain with f3. A bad f3 deploy breaks B2B endpoints even if B2B code is fine.

---

## Summary by Alternative

### #1: Trimmed .NET (123/140) — The Safe Bet

**Strongest in**: Team Competency (5), Infrastructure Fit (5), Operational Simplicity (5), Migration Risk (lowest), Time to MVP (fastest).

**Weakest in**: Future Extensibility (2) — .NET becomes an orphan in 12go's PHP/Go ecosystem.

**Choose when**: Speed and safety are paramount, team stability is a priority, and you accept the strategic tradeoff of a standalone .NET service.

### #2: TypeScript/Node.js (113/140) — The Smart Investment

**Strongest in**: AI-Friendliness (5), Testing Ease (5), Simplicity (5), Development Velocity after ramp-up (4), largest future maintainer pool.

**Weakest in**: Team Competency Match (3) — TypeScript is close to C# but the npm/Node.js ecosystem is genuinely foreign. 1-week ramp-up is real.

**Choose when**: AI-augmented development velocity is a priority, you want the largest hiring pool for future maintainers, and the team is willing to invest 1 week of learning.

### #3: Go Service (108/140) — The Strategic Bet

**Strongest in**: Search Performance (5), Infrastructure Fit (5), Simplicity (5), Operational Complexity (5), best resource footprint (10MB image, 20MB RAM).

**Weakest in**: Team Competency Match (2), Development Velocity (2) — 2+ week ramp-up, "C# in Go" syndrome. Strategic alignment is speculative.

**Choose when**: 12go commits to Go as their future language AND the team is genuinely excited about learning Go.

### #4: Hybrid BFF (107/140) — The Analytical Outlier

**Strongest in**: Smallest codebase (~3K LOC), best problem decomposition (endpoint classification analysis is valuable for all alternatives), Development Velocity (5), AI-Friendliness (5).

**Weakest in**: Infrastructure Fit (3) — Bun is an unnecessary production risk. Team Competency (2), Operational Complexity (3), Monitoring (3) — all Bun-related downgrades.

**Note**: If Bun were replaced with Node.js 22 LTS (as all reviewers recommend), this design effectively merges with Alternative 5. Its unique value is the endpoint classification analysis, not the runtime choice.

### #5: PHP Integration (93/140) — The Long Game

**Strongest in**: Search Performance (5, Phase 2 only), Infrastructure Fit (5), Future Extensibility (4) — only option that puts code inside 12go's platform, best long-term ownership story.

**Weakest in**: Implementation Effort (2), Team Competency (2), Development Velocity (2), Migration Risk (3) — the "PHP tax" on a .NET team is approximately 30 points.

**Choose when**: 12go leadership wants B2B logic inside f3, a dedicated 12go PHP veteran is available for 6+ weeks, and the team genuinely consents to writing PHP.

---

## Close Races and Caveats

1. **Go (108) vs. BFF (107)** — a 1-point difference is not meaningful. Both are viable middle-ground options with different trade-off profiles. Go bets on 12go's future; BFF bets on TypeScript's AI advantage. Neither should be chosen or rejected based on this margin.

2. **TypeScript (113) vs. .NET (123)** — the 10-point gap is entirely explained by Team Competency Match (5 vs. 3 at ×3 weight = 6 points) and the downstream effects of language learning on Development Velocity and Implementation Effort. If the team is willing to invest 1-2 weeks in TypeScript, the gap narrows over time as AI-friendliness and JSON-native handling compound.

3. **PHP's score is conditional.** If 12go takes ownership, the long-term score is ~120+ (remove the team competency tax). The 93 reflects the current team building it, not the platform's inherent quality.

4. **All non-.NET alternatives converge to ~108-113** when team competency costs are excluded. The architectural problem (stateless JSON proxy) is language-agnostic. The decision is primarily about people, not technology.
