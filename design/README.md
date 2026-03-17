---
status: complete
last_updated: 2026-02-24
---

# Design Documentation

Architecture evaluation and recommendation documents for the 12go transition.

## Versioned Evaluations (v1, v2, v3)

Three iterations of the evaluation framework, each refining criteria weights and analysis depth:

| Version | Evaluation Criteria | Comparison Matrix | Analysis | Recommendation |
|---------|---------------------|-------------------|----------|----------------|
| **v1** | [evaluation-criteria.md](v1/evaluation-criteria.md) | [comparison-matrix.md](v1/comparison-matrix.md) | [analysis/](v1/analysis/) | [recommendation.md](v1/recommendation.md) |
| **v2** | [evaluation-criteria.md](v2/evaluation-criteria.md) | [comparison-matrix.md](v2/comparison-matrix.md) | [analysis/](v2/analysis/) | [recommendation.md](v2/recommendation.md) |
| **v3** | [evaluation-criteria.md](v3/evaluation-criteria.md) | [comparison-matrix.md](v3/comparison-matrix.md) | [analysis/](v3/analysis/) | [recommendation.md](v3/recommendation.md) |

**Primary recommendation**: v1 recommends .NET 8 Microservices (B1). v2 and v3 refine the criteria (e.g., v3 emphasizes long-term platform alignment) and may yield different conclusions—see each version's recommendation for details.

## Shared Design Artifacts

| Document | Description |
|----------|-------------|
| [decision-map.md](decision-map.md) | Key decisions and rationale |
| [poc-plan.md](poc-plan.md) | Search POC in F3 — scope, success criteria, evaluation framework |
| [f3-demolition-compatibility.md](f3-demolition-compatibility.md) | Supplementary criterion: how each option survives F3 breakdown |
| [alternatives/](alternatives/) | Option A (Monolith) and Option B (Microservice) designs |
