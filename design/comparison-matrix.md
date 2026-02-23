# Comparison Matrix

## Score Summary


| Criterion (Weight)       | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
| ------------------------ | ---------------- | --------------- | -------------- | ------------- | ------------- |
| **High Weight (x3)**     |                  |                 |                |               |               |
| Implementation Effort    | 2 (6)            | 5 (15)          | 3 (9)          | 3 (9)         | 4 (12)        |
| Team Competency Match    | 1 (3)            | 5 (15)          | 2 (6)          | 3 (9)         | 4 (12)        |
| Search Performance       | 5 (15)           | 4 (12)          | 4 (12)         | 5 (15)        | 4 (12)        |
| Infrastructure Fit       | 5 (15)           | 4 (12)          | 5 (15)         | 5 (15)        | 4 (12)        |
| **Medium Weight (x2)**   |                  |                 |                |               |               |
| Maintainability          | 3 (6)            | 3 (6)           | 4 (8)          | 4 (8)         | 4 (8)         |
| Development Velocity     | 2 (4)            | 5 (10)          | 2 (4)          | 3 (6)         | 4 (8)         |
| Simplicity               | 4 (8)            | 5 (10)          | 4 (8)          | 3 (6)         | 4 (8)         |
| AI-Friendliness          | 3 (6)            | 4 (8)           | 4 (8)          | 3 (6)         | 5 (10)        |
| Operational Complexity   | 5 (10)           | 3 (6)           | 4 (8)          | 3 (6)         | 4 (8)         |
| Migration Risk           | 5 (10)           | 4 (8)           | 4 (8)          | 4 (8)         | 4 (8)         |
| **Low Weight (x1)**      |                  |                 |                |               |               |
| Future Extensibility     | 3 (3)            | 3 (3)           | 3 (3)          | 5 (5)         | 2 (2)         |
| Elegance                 | 3 (3)            | 4 (4)           | 4 (4)          | 5 (5)         | 4 (4)         |
| Testing Ease             | 4 (4)            | 5 (5)           | 4 (4)          | 3 (3)         | 4 (4)         |
| Monitoring/Observability | 5 (5)            | 4 (4)           | 5 (5)          | 4 (4)         | 5 (5)         |
| **Weighted Total**       | **98**           | **118**         | **102**        | **105**       | **113**       |
| **Rank**                 | **5**            | **1**           | **4**          | **3**         | **2**         |


## Key Differentiators

- **Immediate Productivity**: The **.NET 8 (B1)** option dominates in implementation effort and team competency, being the only stack with a zero-day learning curve.
- **Search Performance**: **Monolith-PHP (A)** and **Micro-Go (B3)** offer the lowest latencies due to in-process calls and Go's efficient HTTP handling, respectively.
- **AI Synergy**: **Micro-TS (B4)** offers the highest potential for AI-augmented velocity, leveraging the largest training corpus for transformation logic.
- **Infrastructure Risk**: **Monolith-PHP (A)** and **Micro-PHP (B2)** align best with 12go's core stack, reducing the "orphaned technology" risk.

## Analyzer Consensus

- **Consensus**: All analyzers agree that **.NET 8** provides the fastest path to feature parity but carries the highest long-term strategic risk within the 12go ecosystem.
- **Divergence**: The **Team & Velocity** analyzer favored **.NET**, while the **Operations** analyzer favored **PHP/Monolith**. The **Architecture** analyzer noted that while the **Monolith** is most performant, it is also the most coupled.

## Risk Heat Map


| Risk Category      | Monolith (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
| ------------------ | ------------ | --------------- | -------------- | ------------- | ------------- |
| Migration Timeline | HIGH         | LOW             | MEDIUM         | MEDIUM        | LOW           |
| Team Retention     | HIGH         | LOW             | HIGH           | MEDIUM        | LOW           |
| Client Disruption  | LOW          | MEDIUM          | MEDIUM         | LOW           | MEDIUM        |
| Knowledge Transfer | LOW          | HIGH            | LOW            | MEDIUM        | MEDIUM        |
| Operational        | LOW          | MEDIUM          | LOW            | MEDIUM        | MEDIUM        |


