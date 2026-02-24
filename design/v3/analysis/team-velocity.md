---
status: draft
last_updated: 2026-02-24
---

# Analysis v3: Team & Velocity

## Executive Summary

This analysis evaluates the five architectural alternatives against the "Team & Velocity" criteria defined in [evaluation-criteria.md](../evaluation-criteria.md). The focus is on the speed of delivery, the match with the existing transition team (senior .NET developers), and the long-term maintainability from the perspectives of both the current builders (.NET developers) and the potential long-term owners (12go's PHP core team).

**Key Findings:**
- **.NET 8 Microservice (B1)** strongly optimizes for the current team. It provides the highest development velocity and perfect competency match, but introduces a major risk in "Maintainability (PHP)" if the service is handed over to 12go's core team.
- **Micro PHP (B2)** represents the inverse: it optimizes heavily for the eventual handoff to 12go's core team, but severely penalizes the current .NET team's velocity and competency match.
- **Micro Go (B3)** provides a strong balanced middle ground. It offers good velocity after a brief ramp-up and is highly maintainable by 12go's broader engineering organization (which uses Go strategically), while remaining accessible enough for the .NET team to learn and maintain.
- **Micro TS (B4)** is excellent for the .NET team's productivity and morale but creates an "orphan" Node.js backend service that neither the .NET team (long-term) nor the PHP team wants to own natively.

**Recommendation:** If the transition team will maintain the service indefinitely, **.NET 8 (B1)** is the definitive choice. If a handover to 12go's core team is guaranteed, **Micro Go (B3)** or **Micro PHP (B2)** provide safer long-term organizational alignment.

---

## Evaluation Criteria & Weights

From [evaluation-criteria.md](../evaluation-criteria.md):
- **4. Development Velocity (Weight: x5):** Speed of modifying endpoints or adding features after the initial MVP.
- **6. Team Competency Match (Weight: x3):** Alignment with the transition team's 12+ years of .NET expertise.
- **7. Maintainability (.NET) (Weight: x3):** Long-term code health and onboarding cost if maintained by .NET developers.
- **8. Maintainability (PHP) (Weight: x3):** Long-term code health and onboarding cost if maintained by PHP developers.

**Maximum Possible Score: 70**

---

## Detailed Scoring by Option

### A: Monolith (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **4. Development Velocity** | 2 | 10 | **Below average.** After an initial MVP, velocity remains low due to the sheer size of the monolith. Every change requires coordination with existing 12go codebase and navigating complex legacy patterns. |
| **6. Team Competency Match** | 1 | 3 | **Poor.** The team has zero PHP experience. High drudgery risk as developers navigate an unfamiliar language, dynamic typing, and different architectural paradigms. |
| **7. Maintainability (.NET)** | 1 | 3 | **Poor.** The current team will struggle to maintain the codebase elegantly. High cognitive load and risk of misapplying patterns. |
| **8. Maintainability (PHP)** | 5 | 15 | **Excellent.** Standard Symfony/PHP patterns located directly inside their existing monolith. Very easy for 12go's core team to take over. |
| **Total** | | **31** | |

---

### B1: Microservice (.NET 8)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **4. Development Velocity** | 5 | 25 | **Excellent.** The team is immediately productive. Fast feedback loops, familiar tools, and the ability to change endpoints in hours. |
| **6. Team Competency Match** | 5 | 15 | **Excellent.** Perfect alignment with the team's 12+ years of .NET expertise. Zero ramp-up required. |
| **7. Maintainability (.NET)** | 5 | 15 | **Excellent.** Clean, self-documenting code built using best-practice .NET patterns that any new .NET hire could easily maintain. |
| **8. Maintainability (PHP)** | 1 | 3 | **Poor.** "Foreign body" runtime. 12go's PHP developers cannot troubleshoot or extend a C# application without significant cross-training. |
| **Total** | | **58** | |

---

### B2: Microservice (PHP/Symfony)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **4. Development Velocity** | 3 | 15 | **Acceptable.** A smaller, focused codebase allows for faster iteration than the monolith once the team is ramped up, though slower than native .NET. |
| **6. Team Competency Match** | 2 | 6 | **Below average.** Avoids legacy entanglement, but still requires the .NET team to learn PHP and Symfony from scratch. |
| **7. Maintainability (.NET)** | 2 | 6 | **Below average.** The .NET team maintaining PHP long-term is likely to introduce "C#-style" PHP, which can be awkward and unidiomatic. |
| **8. Maintainability (PHP)** | 5 | 15 | **Excellent.** Standard Symfony/PHP in a modern microservice. Very easy for 12go's core PHP team to take over and maintain. |
| **Total** | | **42** | |

---

### B3: Microservice (Go)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **4. Development Velocity** | 4 | 20 | **Good.** After a modest ramp-up, Go's simplicity and fast compilation allow for rapid iteration and high velocity. |
| **6. Team Competency Match** | 3 | 9 | **Acceptable.** Requires significant mental shifts (goroutines, explicit errors, no LINQ), but the small surface area of the language makes it learnable. |
| **7. Maintainability (.NET)** | 3 | 9 | **Acceptable.** The .NET team can maintain it, but must consciously avoid porting heavy OOP patterns into Go's interface/struct model. |
| **8. Maintainability (PHP)** | 4 | 12 | **Good.** While not PHP, Go is a recognized strategic runtime within 12go's ecosystem. The ops/backend team has existing tooling and capacity to maintain Go services. |
| **Total** | | **50** | |

---

### B4: Microservice (TypeScript/Node.js)

| Criterion | Score | Weighted | Rationale |
|-----------|-------|----------|-----------|
| **4. Development Velocity** | 4 | 20 | **Good.** High velocity after ramp-up due to a rich npm ecosystem, excellent AI generation accuracy, and fast feedback loops. |
| **6. Team Competency Match** | 4 | 12 | **Good.** TypeScript's static typing, async/await model, and frameworks like NestJS feel extremely familiar to ASP.NET Core developers. |
| **7. Maintainability (.NET)** | 4 | 12 | **Good.** Very maintainable for .NET developers given the syntactic and conceptual similarities. |
| **8. Maintainability (PHP)** | 2 | 6 | **Below average.** Not a standard backend stack at 12go. Backend PHP devs will find the async Node.js ecosystem and tooling foreign compared to PHP/Go. |
| **Total** | | **50** | |

---

## Comparative Matrix

| Option | 4. Dev Velocity (x5) | 6. Team Match (x3) | 7. Maint (.NET) (x3) | 8. Maint (PHP) (x3) | Total (Max 70) |
|--------|----------------------|--------------------|----------------------|---------------------|----------------|
| **A: Monolith PHP** | 2 (10) | 1 (3) | 1 (3) | 5 (15) | **31** |
| **B1: Micro .NET** | 5 (25) | 5 (15) | 5 (15) | 1 (3) | **58** |
| **B2: Micro PHP** | 3 (15) | 2 (6) | 2 (6) | 5 (15) | **42** |
| **B3: Micro Go** | 4 (20) | 3 (9) | 3 (9) | 4 (12) | **50** |
| **B4: Micro TS** | 4 (20) | 4 (12) | 4 (12) | 2 (6) | **50** |
