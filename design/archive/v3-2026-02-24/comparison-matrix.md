---
status: draft
last_updated: 2026-02-24
depends_on: design/v3/evaluation-criteria.md
---

# Architectural Comparison Matrix (v3)

This matrix evaluates the five architectural alternatives against the 15 criteria defined in [Evaluation Criteria v3](evaluation-criteria.md). 

Scores are calculated as `Raw Score (1-5) * Weight`.

| Category / Weight | # | Criterion | A (Monolith PHP) | B1 (Micro .NET) | B2 (Micro PHP) | B3 (Micro Go) | B4 (Micro TS) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Critical (x7)** | 1 | Infrastructure Fit | 5 (**35**) | 2 (**14**) | 5 (**35**) | 4 (**28**) | 2 (**14**) |
| **Critical Subtotal**| | | **35** | **14** | **35** | **28** | **14** |
| | | | | | | | |
| **Strategic (x5)** | 2 | Future Extensibility | 5 (**25**) | 1 (**5**) | 5 (**25**) | 5 (**25**) | 2 (**10**) |
| | 3 | Operational Complexity | 5 (**25**) | 1 (**5**) | 4 (**20**) | 3 (**15**) | 2 (**10**) |
| | 4 | Development Velocity | 2 (**10**) | 5 (**25**) | 3 (**15**) | 4 (**20**) | 4 (**20**) |
| **Strategic Subtotal**| | | **60** | **35** | **60** | **60** | **40** |
| | | | | | | | |
| **Execution (x3)** | 5 | Implementation Effort | 1 (**3**) | 5 (**15**) | 2 (**6**) | 3 (**9**) | 4 (**12**) |
| | 6 | Team Competency Match | 1 (**3**) | 5 (**15**) | 2 (**6**) | 3 (**9**) | 4 (**12**) |
| | 7 | Maintainability (.NET) | 1 (**3**) | 5 (**15**) | 2 (**6**) | 3 (**9**) | 4 (**12**) |
| | 8 | Maintainability (PHP) | 5 (**15**) | 1 (**3**) | 5 (**15**) | 4 (**12**) | 2 (**6**) |
| | 9 | Migration Risk | 5 (**15**) | 4 (**12**) | 4 (**12**) | 4 (**12**) | 4 (**12**) |
| | 10 | AI-Friendliness | 2 (**6**) | 5 (**15**) | 3 (**9**) | 4 (**12**) | 5 (**15**) |
| **Execution Subtotal**| | | **45** | **75** | **54** | **63** | **69** |
| | | | | | | | |
| **Perf & Qual (x2)** | 11 | Search Performance | 5 (**10**) | 4 (**8**) | 4 (**8**) | 5 (**10**) | 4 (**8**) |
| | 12 | Testing Ease | 3 (**6**) | 5 (**10**) | 4 (**8**) | 3 (**6**) | 5 (**10**) |
| **Perf & Qual Subtotal**| | | **16** | **18** | **16** | **16** | **18** |
| | | | | | | | |
| **Base (x1)** | 13 | Simplicity | 4 (**4**) | 5 (**5**) | 4 (**4**) | 4 (**4**) | 4 (**4**) |
| | 14 | Elegance | 3 (**3**) | 4 (**4**) | 4 (**4**) | 5 (**5**) | 4 (**4**) |
| | 15 | Observability | 5 (**5**) | 4 (**4**) | 5 (**5**) | 4 (**4**) | 5 (**5**) |
| **Base Subtotal** | | | **12** | **13** | **13** | **13** | **13** |
| | | | | | | | |
| **FINAL SCORE** | | **(Max: 235)** | **168** | **155** | **178** | **180** | **154** |

## Ranking
1. **Option B3: Microservice Go (180 points)**
2. **Option B2: Microservice PHP/Symfony (178 points)**
3. **Option A: Monolith PHP (168 points)**
4. **Option B1: Microservice .NET 8 (155 points)**
5. **Option B4: Microservice TypeScript (154 points)**