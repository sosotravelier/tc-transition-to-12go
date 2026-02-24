---
status: draft
last_updated: 2026-02-24
depends_on: design/v2/evaluation-criteria.md
---

# Analysis v2: Team Competency & Velocity

## Executive Summary

This analysis re-evaluates the five design alternatives (A: Monolith PHP, B1: Micro .NET, B2: Micro PHP, B3: Micro Go, B4: Micro TS) using the refined evaluation criteria focused on **implementation effort**, **development velocity**, **team competency match**, and **AI-friendliness**. The team consists of 3–4 senior .NET developers with 12+ years of experience and uncertain retention.

**Key Findings:**
- **.NET 8 Microservice (B1)** remains the strongest option for immediate productivity, with the lowest implementation effort and perfect team alignment.
- **TypeScript/Node.js Microservice (B4)** is the strongest alternative, offering excellent AI-friendliness and a manageable learning curve.
- **Monolith PHP (A)** and **Micro PHP (B2)** present the highest risk due to the steepest learning curve and longest time to MVP.
- **Go Microservice (B3)** sits in the middle—acceptable but with a noticeable ramp-up cost.

**Recommendation:** If team retention and fastest time-to-MVP are the priorities, **.NET 8 (B1)** is the logical choice. If AI-augmented development and long-term platform alignment matter more, **TypeScript (B4)** offers the best balance.

---

## Scoring Scale (from evaluation-criteria.md)

| Score | Meaning |
|-------|---------|
| 1 | Poor / High risk / High effort |
| 2 | Below average |
| 3 | Acceptable / Moderate |
| 4 | Good |
| 5 | Excellent / Low risk / Low effort |

**Criteria weights:** Implementation Effort (×3), Development Velocity (×3), Team Competency Match (×2), AI-Friendliness (×1)

---

## Detailed Scoring by Option

### A: Monolith (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **Implementation Effort** | 2 | 6 | **Below average.** Team has zero PHP experience. Learning a large, existing Symfony monolith while simultaneously implementing 13 endpoints is high-risk. Must navigate frontend3 internals, understand BookingFormManager, and coordinate with 12go codebase. Estimated 3–4+ months to MVP with major unknowns. No direct port path—all logic must be translated. |
| **Development Velocity** | 2 | 6 | **Below average.** Velocity remains low after MVP. Every change requires coordination with the existing monolith. Developers must understand Symfony service layer, Doctrine, and 12go-specific patterns. Change an endpoint = multi-day effort including merge conflicts and regression risk. |
| **Team Competency Match** | 1 | 2 | **Poor.** Team has zero PHP experience. Symfony's conventions (annotations, service container, Twig) are unfamiliar. Mental model shift from strongly-typed C# to PHP's dynamic typing. High "drudgery risk"—developers may feel they are moving backward technologically, impacting retention. |
| **AI-Friendliness** | 3 | 3 | **Moderate.** AI (Cursor/Claude) handles Symfony routing and attributes well. However, the complexity of the existing monolith's internals may lead to context window issues and incorrect assumptions. AI can generate boilerplate but struggles with domain-specific patterns in a large codebase. |
| **Total** | | **17** | |

---

### B1: Microservice (.NET 8)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **Implementation Effort** | 5 | 15 | **Excellent.** Zero learning curve. Team can port valuable logic (OneTwoGoApi client, BookingSchemaMapper, reserve data serialization) directly from supply-integration and Denali. MVP achievable in 8–10 weeks with 3 devs. No translation errors—copy, adapt, test. Recommendation doc estimates 10 weeks to full parity. |
| **Development Velocity** | 5 | 15 | **Excellent.** Team is immediately productive. Change an endpoint in hours. Familiar tools (Rider, xUnit, Moq). Fast feedback loops. No coordination overhead with 12go codebase—clean HTTP contract. Polly + Refit patterns already known. |
| **Team Competency Match** | 5 | 10 | **Excellent.** Perfect alignment. 12+ years of .NET expertise. Zero ramp-up. Team can guide AI tools with precision. No mental model shift. |
| **AI-Friendliness** | 4 | 4 | **Good.** C# has strong AI support. Strong typing helps prevent AI-generated hallucination bugs. Cursor/Claude handle verbosity well. Team's deep knowledge allows effective prompting and validation. Slightly behind TypeScript's corpus size. |
| **Total** | | **44** | |

---

### B2: Microservice (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **Implementation Effort** | 3 | 9 | **Acceptable.** Better than monolith—smaller, focused codebase. But still requires learning PHP and Symfony from scratch. 4–6 week ramp-up before meaningful progress. Estimated 3–4 months to MVP. Must port all logic (no in-process reuse). Symfony 6.4 matches frontend3, reducing framework mismatch. |
| **Development Velocity** | 2 | 6 | **Below average.** Initial velocity very low during ramp-up. After MVP, velocity improves but remains below .NET/TS. Every change requires PHP/Symfony context. Coordination with 12go infra is simpler than monolith (same stack) but developer productivity lags. |
| **Team Competency Match** | 2 | 4 | **Below average.** Better than monolith—focused scope, no legacy entanglement. Still requires 4–6 weeks to productive. PHP's array-heavy patterns and dynamic typing are unfamiliar. Symfony's service container and routing differ from .NET DI. |
| **AI-Friendliness** | 4 | 4 | **Good.** Simpler project structure than monolith helps AI stay within context. Symfony is well-documented; AI generates correct attribute-based routing. Less risk of context overflow. AI can help with boilerplate; team must validate domain logic. |
| **Total** | | **23** | |

---

### B3: Microservice (Go)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **Implementation Effort** | 3 | 9 | **Acceptable.** Go's simplicity accelerates learning. 2–4 week ramp-up. However, porting complex logic (BookingSchemaMapper, 20+ wildcard patterns) from C# to Go requires careful translation. No direct copy-paste. Estimated 3–4 months to MVP. Chi router is minimal; HTTP client patterns differ from Refit. |
| **Development Velocity** | 3 | 9 | **Acceptable.** After ramp-up, consistent progress. Go's simplicity allows fast iteration. But explicit error handling and lack of generics (pre-1.18 patterns) can slow certain transformations. Change an endpoint = half-day to day, not hours. |
| **Team Competency Match** | 3 | 6 | **Acceptable.** Go appeals to some developers. Syntax is simple. But goroutines, explicit error handling, and interface philosophy are significant shifts from .NET. No LINQ, no async/await—different concurrency model. Team can become proficient in 8–12 weeks. |
| **AI-Friendliness** | 3 | 3 | **Moderate.** AI is good at Go's simple syntax. However, models can generate non-idiomatic code (e.g., ignoring error returns, overusing interfaces). Inexperienced team might not catch subtle bugs. Go's smaller training corpus vs. TypeScript/C#. |
| **Total** | | **27** | |

---

### B4: Microservice (TypeScript/Node.js)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **Implementation Effort** | 4 | 12 | **Good.** 2-week ramp-up. TypeScript's syntax and async/await are familiar to .NET developers. NestJS architecture feels like ASP.NET Core (DI, controllers, modules). Can port logic with strong AI assistance. Estimated 10–12 weeks to MVP—slightly longer than .NET due to initial learning, but AI accelerates boilerplate. |
| **Development Velocity** | 4 | 12 | **Good.** High velocity after ramp-up. npm ecosystem provides tools for HTTP, validation, testing. Change an endpoint in hours to half-day. Slightly behind .NET due to occasional type-narrowing and ecosystem quirks, but very competitive. |
| **Team Competency Match** | 4 | 8 | **Good.** TypeScript's type system and async/await model are very familiar. NestJS feels like home for .NET devs. 2 weeks to productive, 8 weeks to proficient. Lower retention risk than PHP—modern, fast, AI-synergy. |
| **AI-Friendliness** | 5 | 5 | **Excellent.** TypeScript has the largest AI training corpus. AI generates correct controllers, services, and tests with 70–82% accuracy (per research). Type system provides perfect context for Cursor's codebase indexing. Best-in-class for AI-augmented development. |
| **Total** | | **37** | |

---

## Comparative Scoring Matrix

| Criterion (Weight) | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
|-------------------|------------------|-----------------|----------------|---------------|----------------|
| Implementation Effort (×3) | 2 (6) | 5 (15) | 3 (9) | 3 (9) | 4 (12) |
| Development Velocity (×3) | 2 (6) | 5 (15) | 2 (6) | 3 (9) | 4 (12) |
| Team Competency Match (×2) | 1 (2) | 5 (10) | 2 (4) | 3 (6) | 4 (8) |
| AI-Friendliness (×1) | 3 (3) | 4 (4) | 4 (4) | 3 (3) | 5 (5) |
| **Weighted Total** | **17** | **44** | **23** | **27** | **37** |
| **Rank** | **5** | **1** | **4** | **3** | **2** |

---

## Team Learning Curve & Velocity Summary

| Stack | Time to Productive | Time to MVP (13 endpoints) | Post-MVP Velocity |
|-------|--------------------|----------------------------|-------------------|
| **.NET 8** | Day 1 | 8–10 weeks | Excellent (hours per change) |
| **TS/Node** | 2 weeks | 10–12 weeks | High (hours to half-day) |
| **Go** | 4 weeks | 12–14 weeks | Moderate (half-day to day) |
| **PHP (Micro)** | 6 weeks | 14–16 weeks | Below average (multi-day) |
| **PHP (Monolith)** | 6+ weeks | 16+ weeks | Low (multi-day, coordination) |

---

## AI-Augmented Development Assessment

- **TypeScript (5/5):** AI generates complete controllers, services, and tests with high accuracy. Largest training corpus. Type system provides perfect context for codebase indexing. Best for AI-first workflows.
- **.NET (4/5):** AI handles C# verbosity well. Strong types prevent hallucination bugs. Team's expertise enables effective prompting. Slightly smaller corpus than TypeScript.
- **PHP (3–4/5):** Micro PHP (4) benefits from simpler structure. Monolith (3) suffers from context overflow. AI handles Symfony attributes well but can struggle with dynamic typing and array-heavy patterns.
- **Go (3/5):** AI excels at simple syntax but can produce non-idiomatic error handling. Smaller corpus. Team must validate AI output carefully.

---

## Recommendations for Team Productivity

1. **Leverage AI Rules:** Regardless of choice, create `.cursor/rules/` files to encode API contract conventions (money format, versioning, correlation IDs) so AI tools generate compliant code.
2. **Start Small:** If TS, Go, or PHP is chosen, implement the Search service first (stateless, simpler) to build confidence before tackling the complex Booking funnel.
3. **Formalize Porting:** If .NET is chosen, create a "Porting Guide" identifying which parts of the 340-project system are discarded vs. ported to keep the new service lean (< 10K LOC).
4. **Retention Consideration:** PHP presents the highest "drudgery risk." If team retention is uncertain, .NET or TypeScript reduce the risk of developers feeling they are moving backward technologically.

---

## Alignment with evaluation-criteria.md

This analysis uses the four criteria specified for the Team Competency & Velocity lens. The full evaluation framework in [evaluation-criteria.md](../evaluation-criteria.md) includes 14 criteria; this document focuses on the subset most relevant to team productivity and delivery speed. For the complete weighted score across all criteria, see [comparison-matrix.md](../comparison-matrix.md) and future consolidated analysis.
