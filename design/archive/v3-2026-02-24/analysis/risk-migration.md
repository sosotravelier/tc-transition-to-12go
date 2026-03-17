---
status: draft
last_updated: 2026-02-24
evaluation_basis: design/v3/evaluation-criteria.md
---

# Analysis v3: Risk & Migration

## Executive Summary

This document evaluates the five architecture alternatives based strictly on the three **Execution Weight (x3)** criteria defined in the v3 evaluation framework: **Implementation Effort**, **Migration Risk**, and **AI-Friendliness**. 

The goal is to assess the practical reality of building the solution and moving clients over safely, factoring in the current team's `.NET` expertise and the amplifying effect of AI coding assistants (like Cursor/Claude).

**Key Findings:**
- **Microservice .NET (B1)** dominates this specific grouping (42/45). It requires zero ramp-up for the current team, allows for direct code porting, and offers perfect AI synergy for refactoring existing C# code.
- **Microservice TypeScript (B4)** performs very strongly (39/45) as a secondary option. The C#-to-TS paradigm maps well, and TS is arguably the most AI-friendly language ecosystem available, significantly lowering implementation effort.
- **Monolith PHP (A)** offers the absolute safest migration path for clients (5/5) but is severely penalized by the high implementation effort and lower AI-friendliness of working within a massive, legacy PHP codebase.
- All microservice options (B1–B4) share identical **Migration Risk (4/5)** profiles: they require an authentication bridge and gateway traffic routing, but support safe parallel runs and fast rollbacks.

---

## Detailed Scoring by Option

*Note: All criteria in this analysis carry a weight multiplier of **x3**. The maximum possible score per criterion is 15. The maximum total score for this document is 45.*

### A: Monolith (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **5. Implementation Effort** | 1/5 | 3 | **High Effort.** The current team consists of .NET experts. Forcing them to learn PHP/Symfony while navigating a 15-service legacy monolith and translating complex domain logic will push the MVP timeline to 4+ months. |
| **9. Migration Risk** | 5/5 | 15 | **Lowest Risk.** The B2B layer lives natively inside `frontend3`. No new endpoints, no HTTP proxy semantics, no auth bridge. Identical URLs and headers for B2B clients. Cutover is a transparent code deployment/feature flag. |
| **10. AI-Friendliness** | 2/5 | 6 | **Low Synergy.** AI struggles with implicit dependencies, dynamic typing, and the massive context window required to safely modify a mature PHP monolith. Frequent manual corrections will be needed. |
| **Total** | | **24** | |

### B1: Microservice (.NET 8)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **5. Implementation Effort** | 5/5 | 15 | **Lowest Effort.** The team has 12+ years of .NET expertise. Existing search/booking logic from Denali/Etna can be directly ported or refactored. An MVP in 8-10 weeks is highly realistic. |
| **9. Migration Risk** | 4/5 | 12 | **Acceptable Risk.** Requires a new infrastructure footprint, an auth bridge (`clientId` mapping), and gateway traffic routing. However, it supports safe parallel runs and instant traffic-switch rollbacks. |
| **10. AI-Friendliness** | 5/5 | 15 | **Perfect Synergy.** Strongly typed C# Minimal APIs provide perfect context. AI can flawlessly translate, refactor, and generate boilerplate for the existing C# models and services. |
| **Total** | | **42** | |

### B2: Microservice (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **5. Implementation Effort** | 2/5 | 6 | **High Effort.** While isolated from the monolith, the .NET team still must learn PHP and the Symfony framework from scratch. Translating C# domain logic to PHP idioms introduces significant friction. |
| **9. Migration Risk** | 4/5 | 12 | **Acceptable Risk.** Same migration mechanics as B1: new service, auth bridge, and API Gateway traffic switch. |
| **10. AI-Friendliness** | 3/5 | 9 | **Moderate Synergy.** AI understands PHP/Symfony well, but translating strict C# types into PHP loses some fidelity, requiring more manual developer intervention than TS or Go. |
| **Total** | | **27** | |

### B3: Microservice (Go)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **5. Implementation Effort** | 3/5 | 9 | **Moderate Effort.** Go is simpler to learn than Symfony, but its idioms (error handling, lack of heavy OOP/LINQ) require a paradigm shift for C# developers. Expect a 4-week ramp-up before productive output. |
| **9. Migration Risk** | 4/5 | 12 | **Acceptable Risk.** Standard microservice cutover. Go's minimal resource footprint makes side-by-side dual running extremely cheap and stable. |
| **10. AI-Friendliness** | 4/5 | 12 | **High Synergy.** Go's explicit syntax and simplicity make it very AI-friendly. AI generates highly correct Go code, though redesigning C# LINQ/architectures into Go structs may require human architectural guidance. |
| **Total** | | **33** | |

### B4: Microservice (TypeScript/Node.js)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **5. Implementation Effort** | 4/5 | 12 | **Low Effort.** Fast 2-week ramp-up. TS/Node paradigms map closely to modern C# (async/await, strict typing, DI), making the translation of existing logic fast and intuitive. |
| **9. Migration Risk** | 4/5 | 12 | **Acceptable Risk.** Standard microservice cutover via API Gateway and auth bridging. Familiar deployment pipelines. |
| **10. AI-Friendliness** | 5/5 | 15 | **Perfect Synergy.** TypeScript has arguably the strongest AI training data of any ecosystem. Cursor/Claude can perform C#-to-TS translations with near-perfect accuracy and minimal manual correction. |
| **Total** | | **39** | |

---

## Comparative Matrix

| Option | 5. Implementation Effort (x3) | 9. Migration Risk (x3) | 10. AI-Friendliness (x3) | Total Score (Max 45) |
|--------|-------------------------------|------------------------|--------------------------|----------------------|
| **A: Monolith PHP** | 3 | **15** | 6 | **24** |
| **B1: Micro .NET** | **15** | 12 | **15** | **42** |
| **B2: Micro PHP** | 6 | 12 | 9 | **27** |
| **B3: Micro Go** | 9 | 12 | 12 | **33** |
| **B4: Micro TS** | 12 | 12 | **15** | **39** |

*(Note: Highest score in each column is **bolded**.)*