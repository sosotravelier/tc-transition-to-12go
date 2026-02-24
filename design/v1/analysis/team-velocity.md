# Analysis: Team, Velocity, and AI-Friendliness

## Executive Summary

This analysis evaluates five design alternatives for the 12go transition through the dual lens of Developer Experience (DX) and AI-Augmented Development productivity. The team consists of 3-4 senior .NET developers with 12+ years of experience and uncertain retention.

**Key Findings:**
- **.NET 8 Microservice** is the clear winner for immediate productivity and team stability, leveraging existing expertise and excellent AI tooling.
- **TypeScript/Node.js Microservice** is the strongest alternative, offering the best AI training corpus and a manageable learning curve for .NET developers.
- **Go Microservice** provides strategic alignment but introduces significant mental model shifts that could impact short-term velocity.
- **PHP/Symfony** (Monolith or Microservice) presents the highest risk to team stability due to the steepest learning curve and less familiar paradigms for this specific team.

**Recommendation:** If team retention and immediate feature parity are the priorities, **.NET 8** is the logical choice. If modernizing the stack with a focus on AI-first development is preferred, **TypeScript/Node.js** offers the best long-term velocity.

---

## Comparison by Design/Language

### A: Monolith (PHP/Symfony)
- **Team Competency Match (1/5)**: Poor. Team has zero PHP experience. Learning a large, existing Symfony monolith while simultaneously implementing a complex transition is high-risk.
- **Development Velocity (2/5)**: Low. Velocity will be hampered by the learning curve and the need to coordinate changes with the existing 12go codebase.
- **AI-Friendliness (3/5)**: Moderate. AI (Cursor/Claude) handles Symfony well, but the complexity of the existing monolith's internals may lead to context window issues and incorrect assumptions.

### B: Microservice (.NET 8)
- **Team Competency Match (5/5)**: Excellent. Zero learning curve. Team can port valuable logic (OneTwoGoApi client, booking schema patterns) directly.
- **Development Velocity (5/5)**: High. Team is immediately productive. Fast feedback loops with familiar tools (Visual Studio/Rider, xUnit).
- **AI-Friendliness (4/5)**: Good. C# has strong AI support, and the team's deep knowledge allows them to guide AI tools very effectively.

### B: Microservice (PHP/Symfony)
- **Team Competency Match (2/5)**: Below average. Better than the monolith as the codebase is smaller and focused, but still requires learning a new language and framework.
- **Development Velocity (2/5)**: Low. Initial velocity will be very low during the 4-6 week ramp-up period.
- **AI-Friendliness (3/5)**: Moderate. Similar to the monolith, but simpler project structure helps AI tools stay within context.

### B: Microservice (Go)
- **Team Competency Match (3/5)**: Acceptable. While different, Go's simplicity appeals to some developers. However, explicit error handling and goroutines are significant shifts from .NET.
- **Development Velocity (3/5)**: Moderate. After a 2-4 week ramp-up, the simplicity of the language allows for consistent progress.
- **AI-Friendliness (3/5)**: Moderate. Go's AI support is good, but models can sometimes generate non-idiomatic code that an inexperienced team might not catch.

### B: Microservice (TypeScript/Node.js)
- **Team Competency Match (4/5)**: Good. TypeScript's syntax and async/await model are very familiar to .NET developers. NestJS architecture feels like ASP.NET Core.
- **Development Velocity (4/5)**: High. Short ramp-up (2 weeks). npm ecosystem provides a wealth of tools.
- **AI-Friendliness (5/5)**: Excellent. TypeScript has the largest AI training corpus. AI tools achieve 70-82% accuracy, significantly reducing boilerplate writing time.

---

## Team Learning Curve & DX Assessment

| Stack | Time to Productive | Time to Proficient | Joy Factor |
|---|---|---|---|
| **.NET 8** | Day 1 | Day 1 | High (Pride in craft) |
| **TS/Node** | 2 Weeks | 8 Weeks | High (Modern, fast) |
| **Go** | 4 Weeks | 12 Weeks | Moderate (Mixed feelings) |
| **PHP** | 6 Weeks | 16 Weeks | Low (Frustration) |

**Assessment**: The joy factor is highest with .NET due to mastery, and TS/Node due to its modern ecosystem and AI synergy. PHP presents a "drudgery risk" where developers may feel they are moving backward technologically, potentially impacting retention.

---

## AI-Augmented Development Assessment

- **TypeScript (Best)**: AI generates complete controllers, services, and tests with high accuracy. The type system provides perfect context for Cursor's codebase indexing.
- **.NET (Great)**: AI handles the verbosity of C# well, and the strong types help prevent AI-generated hallucination bugs.
- **Go (Good)**: AI is excellent at Go's simple syntax but struggles with idiomatic error handling and interface implementation without guidance.
- **PHP (Moderate)**: AI handles Symfony attributes and routing well, but can get confused by PHP's dynamic typing and array-heavy patterns.

---

## Recommendations for Team Productivity

1. **Leverage AI Rules**: Regardless of the choice, create `.cursor/rules/` files to encode API contract conventions (money format, versioning) to ensure AI tools generate compliant code.
2. **Start Small**: If TS, Go, or PHP is chosen, implement the Search service first (stateless, simpler) to build confidence before tackling the complex Booking service.
3. **Formalize Porting**: If .NET is chosen, create a "Porting Guide" to specifically identify which parts of the 340-project system are discarded vs. ported to keep the new service lean (< 10K LOC).

---

## Comparative Scoring Matrix

| Criterion (Weight) | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
|---|---|---|---|---|---|
| Team Competency Match (x3) | 1 (3) | 5 (15) | 2 (6) | 3 (9) | 4 (12) |
| Development Velocity (x2) | 2 (4) | 5 (10) | 2 (4) | 3 (6) | 4 (8) |
| AI-Friendliness (x2) | 3 (6) | 4 (8) | 4 (8) | 3 (6) | 5 (10) |
| **Total Weighted Score** | **13** | **33** | **18** | **21** | **30** |
