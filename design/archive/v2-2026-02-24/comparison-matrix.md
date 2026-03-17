---
status: draft
last_updated: 2026-02-24
---

# Comparison Matrix (v2)

This matrix re-evaluates the transition options based on the refined criteria in [evaluation-criteria.md](evaluation-criteria.md).

## Score Summary

| Criterion (Weight) | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **High Weight (x3)** | | | | | |
| 1. Implementation Effort | 2 (6) | 5 (15) | 3 (9) | 3 (9) | 4 (12) |
| 2. Infrastructure Fit | 5 (15) | 4 (12) | 5 (15) | 5 (15) | 4 (12) |
| 3. Maintainability | 2 (6) | 5 (15) | 3 (9) | 3 (9) | 4 (12) |
| 4. Development Velocity | 2 (6) | 5 (15) | 2 (6) | 3 (9) | 4 (12) |
| 5. Migration Risk | 5 (15) | 4 (12) | 4 (12) | 4 (12) | 4 (12) |
| 6. Future Extensibility | 4 (12) | 2 (6) | 4 (12) | 5 (15) | 2 (6) |
| **Medium Weight (x2)** | | | | | |
| 7. Team Competency Match | 1 (2) | 5 (10) | 2 (4) | 3 (6) | 4 (8) |
| 8. Simplicity | 4 (8) | 5 (10) | 4 (8) | 4 (8) | 4 (8) |
| 9. Operational Complexity | 5 (10) | 3 (6) | 4 (8) | 3 (6) | 4 (8) |
| 10. Testing Ease | 3 (6) | 5 (10) | 4 (8) | 3 (6) | 5 (10) |
| **Low Weight (x1)** | | | | | |
| 11. Search Performance | 5 (5) | 4 (4) | 4 (4) | 5 (5) | 4 (4) |
| 12. AI-Friendliness | 3 (3) | 4 (4) | 4 (4) | 3 (3) | 5 (5) |
| 13. Elegance | 3 (3) | 4 (4) | 4 (4) | 5 (5) | 4 (4) |
| 14. Monitoring/Observability | 5 (5) | 4 (4) | 5 (5) | 4 (4) | 5 (5) |
| **Weighted Total** | **102** | **127** | **108** | **112** | **118** |
| **Rank** | **5** | **1** | **4** | **3** | **2** |

## Key Changes in v2 Analysis

1.  **Maintainability & Velocity Dominance**: Maintainability (x3) and Development Velocity (x3) are now high-weight. This strongly favors **.NET (B1)** and **TypeScript (B4)** because the team can write cleaner code faster in these stacks.
2.  **Performance De-prioritization**: Search Performance moved from High (x3) to Low (x1), with a tolerance for 5ms added latency. This removed the primary advantage of **Monolith-PHP (A)** and **Go (B3)**.
3.  **Future Alignment**: Future Extensibility (x3) now weighs heavily. This penalizes **.NET (B1)** and **TypeScript (B4)** as "third stacks" but boosts **Go (B3)** and **PHP (A/B2)**.
4.  **AI Synergy**: **TypeScript (B4)** scores highest in AI-Friendliness and Testing Ease, making it the strongest alternative to .NET.

## Rank Comparison (v1 vs v2)

| Option | v1 Rank | v1 Score | v2 Rank | v2 Score | Change |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Micro-.NET (B1)** | 1 | 118 | 1 | 127 | - |
| **Micro-TS (B4)** | 2 | 113 | 2 | 118 | - |
| **Micro-Go (B3)** | 3 | 105 | 3 | 112 | - |
| **Micro-PHP (B2)** | 4 | 102 | 4 | 108 | - |
| **Monolith-PHP (A)** | 5 | 98 | 5 | 102 | - |

Despite the criteria changes, the overall ranking remains remarkably stable. **.NET 8 (B1)** increased its lead due to the high weights on velocity and maintainability, which are the team's core strengths.

## Recommendation Summary

The v2 analysis reinforces **.NET 8 Microservice (B1)** as the optimal choice for immediate transition success, while acknowledging **Go (B3)** as the most strategically aligned with 12go's future. **TypeScript (B4)** remains the best "modern" alternative with high AI-augmented velocity.
