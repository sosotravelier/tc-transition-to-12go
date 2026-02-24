---
status: draft
last_updated: 2026-02-24
---

# Recommendation v2: 12go Transition System Design

## TL;DR
Based on the refined evaluation criteria (v2), we strongly reaffirm the recommendation for the **.NET 8 Microservice (Alternative B1)**. The high weights placed on **Maintainability (x3)**, **Development Velocity (x3)**, and **Implementation Effort (x3)** make .NET 8 the standout choice for the current team. The acceptance of a **5ms search latency overhead** further validates the microservice approach over a monolith. **TypeScript (B4)** remains the strongest modern alternative, while **Go (B3)** is the best choice for long-term strategic alignment if the team is willing to accept a 4-week ramp-up.

---

## Primary Recommendation: .NET 8 Microservice (B1)

### Why This Approach (v2 Context)
- **Maintainability Dominance (Score: 5/5, Weighted: 15)**: .NET 8 provides the cleanest, most self-documenting environment for the current team. Explicit boundaries and familiar patterns ensure long-term code health.
- **Maximum Velocity (Score: 5/5, Weighted: 15)**: Zero learning curve and direct logic porting from existing services ensure the fastest path to MVP and the highest speed for future changes.
- **Performance Tolerance**: With 12go's tolerance for 5ms added latency on search, the performance advantage of in-process PHP or Go binaries is no longer a decisive factor. .NET 8 Minimal API easily meets the sub-200ms p95 requirement.
- **AOT Infrastructure**: Using .NET 8 AOT compilation addresses "infrastructure fit" concerns by producing small (~90MB), fast-starting containers that behave like Go binaries.

### Key Strengths
- **Team-Productivity Lock-in**: Developers remain highly motivated and productive in their primary stack, reducing retention risk.
- **Robustness**: Best-in-class error handling (Polly) and testing (xUnit/Moq) ecosystem.
- **Stateless Simplicity**: The design eliminates local caching (DynamoDB/HybridCache), simplifying operations significantly.

### Known Trade-offs
- **Technology Diversity**: Introduces a third runtime (.NET) alongside 12go's PHP and Go.
- **Future Alignment**: Lower alignment with 12go's potential move toward Go (G3), requiring dedicated .NET ownership.

---

## The Modern Alternative: TypeScript/Node.js (B4)

TypeScript (B4) is the **Rank 2** option (Score: 118). It is the best choice if:
- **AI-Augmented Development** is the primary strategy (highest AI-friendliness score: 5/5).
- There is a desire to move to a **more common web stack** that attracts a broader hiring pool.
- **Infrastructure Fit** is prioritized over immediate .NET familiarity.

---

## The Strategic Alternative: Go (B3)

Go (B3) is the **Rank 3** option (Score: 112). It is the best choice if:
- **Long-term Platform Unification** with 12go's future G3 architecture is the top priority.
- The team is prepared for a **2-4 week ramp-up** and a mental model shift (error handling, goroutines).

---

## Updated Comparison (v1 vs v2)

| Option | v1 Rank | v2 Rank | v2 Score | Key Driver for v2 |
| :--- | :---: | :---: | :---: | :--- |
| **.NET 8 (B1)** | 1 | 1 | 127/150 | High weights on Maintainability & Velocity. |
| **TypeScript (B4)** | 2 | 2 | 118/150 | Best AI-synergy and strong testing ease. |
| **Go (B3)** | 3 | 3 | 112/150 | Best Future Extensibility alignment. |
| **Micro-PHP (B2)** | 4 | 4 | 108/150 | Best Infrastructure Fit; poor Team Match. |
| **Monolith (A)** | 5 | 5 | 102/150 | Best Performance (now de-prioritized); poor Maintainability. |

---

## Strategic Decision for Stakeholders

The choice depends on which "High-Weight" criterion is the ultimate tie-breaker:
1. **If Speed & Reliability** are paramount: **.NET 8 (B1)**.
2. **If Platform Unification** is paramount: **Go (B3)**.
3. **If AI-Velocity & Hiring** are paramount: **TypeScript (B4)**.

We remain firm in recommending **.NET 8 (B1)** as the path with the highest probability of success for the current team composition and timeline.

---

## Next Steps
1. **Finalize .NET 8 AOT POC**: Verify image size and startup time on a sample search endpoint.
2. **DevOps Consultation**: Confirm .NET 8 Docker support within 12go's EC2 infrastructure.
3. **Draft Implementation Plan**: Detailed tasks for Phase 1 (Auth Bridge + Station Mapping).
