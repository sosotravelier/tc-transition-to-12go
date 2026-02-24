---
status: draft
last_updated: 2026-02-24
evaluation_basis: design/v2/evaluation-criteria.md
supersedes: design/v1/analysis/risk-migration.md
---

# Analysis v2: Risk and Migration

## Scope

This document re-evaluates the five design alternatives on **two high-weight criteria (x3)** from the refined evaluation framework:

1. **Migration Risk** — Risk of breaking existing clients during the transition  
2. **Future Extensibility** — Alignment with 12go's future direction (possibly Go)

Scoring scale: 1 (Poor/High risk) to 5 (Excellent/Low risk). Reference: [evaluation-criteria.md](../evaluation-criteria.md).

---

## Criterion 1: Migration Risk (x3)

**What 5 looks like:** Zero-downtime, parallel run possible  
**What 1 looks like:** Big-bang cutover, high risk

### A: Monolith (PHP/Symfony)

| Score | **5/5** |
|-------|---------|
| **Rationale** | The monolith offers the cleanest migration path. The B2B API layer lives inside `frontend3` — same process, same infrastructure, same deployment pipeline. No new endpoints, no auth bridge, no HTTP proxy layer. Clients keep identical URLs, headers, and contracts. Rollback is a code revert or feature flag; no traffic re-routing. Coexistence is native: the old .NET services can remain running until the B2B module is validated, then decommissioned in a single cutover. Per-client gradual rollout is harder (gateway routing by `client_id` is unverified), but the cutover itself is a transparent switch. |

### B1: Microservice (.NET 8)

| Score | **4/5** |
|-------|---------|
| **Rationale** | Requires new infrastructure (Docker container, deployment pipeline), an authentication bridge (`clientId` + `x-api-key` → 12go `apiKey`), and HTTP proxy semantics. However, parallel run is straightforward: route traffic at the API Gateway from old services to the new .NET service. Rollback is a traffic switch (seconds to minutes). Shadow traffic validation is possible before cutover. Per-client gradual rollout depends on gateway capabilities (G1, G2 in decision-map). The main risk is the auth mapping table — it must exist and be correct before any client is migrated. No big-bang; the hybrid strategy (search transparent, booking new URL) further reduces risk. |

### B2: Microservice (PHP/Symfony)

| Score | **4/5** |
|-------|---------|
| **Rationale** | Same migration mechanics as B1: new service, auth bridge, HTTP proxy. Deployment aligns with 12go's existing PHP/Docker stack, so infrastructure rollout may be slightly smoother than .NET. Parallel run and rollback are identical. No structural advantage over B1 for migration risk; the technology choice does not change the cutover strategy. |

### B3: Microservice (Go)

| Score | **4/5** |
|-------|---------|
| **Rationale** | Same as B1/B2: new service, auth bridge, traffic routing. Go's minimal resource footprint makes side-by-side running easier (lower infra cost during dual operation), but this is a minor advantage. Rollback and parallel run are equivalent. The learning curve affects *timeline* (and thus when migration can start), not the migration risk itself once the service is ready. |

### B4: Microservice (TypeScript/Node.js)

| Score | **4/5** |
|-------|---------|
| **Rationale** | Identical migration mechanics to B1–B3. New service, auth bridge, traffic switch. Node.js is familiar to modern DevOps; deployment pipelines are well-understood. No structural difference in migration risk. |

---

## Criterion 2: Future Extensibility (x3)

**What 5 looks like:** Naturally evolves with 12go's stack  
**What 1 looks like:** Dead-end technology choice

### A: Monolith (PHP/Symfony)

| Score | **4/5** |
|-------|---------|
| **Rationale** | The B2B layer is *inside* the 12go monolith. It uses the same codebase, same services, same deployment. Any evolution of 12go's stack (e.g., gradual migration to Go, refactoring of core services) will naturally include the B2B module if it is part of the same repo. No separate service to maintain or migrate. PHP is 12go's current stack — 12go's team can maintain it. If 12go moves to Go, the B2B module would need extraction or rewrite, but that would be a 12go-wide decision, not an orphaned third-party service. Slightly below 5 because PHP may not be 12go's *future* direction (Go is under consideration). |

### B1: Microservice (.NET 8)

| Score | **2/5** |
|-------|---------|
| **Rationale** | .NET adds a new runtime to a primarily PHP/Go platform. 12go's team has no .NET expertise; future maintenance would require specialized hiring or cross-training. If 12go moves toward Go (as indicated in G3), the .NET service becomes an orphan — a separate codebase, separate toolchain, separate deployment. It does not "naturally evolve" with 12go; it requires ongoing investment from a .NET-capable team. High bus factor risk if the current team rotates. |

### B2: Microservice (PHP/Symfony)

| Score | **4/5** |
|-------|---------|
| **Rationale** | PHP/Symfony is 12go's current primary stack. The microservice uses the same framework as `frontend3` (Symfony 6.4). 12go's core team can maintain it without learning a new language. If 12go evolves within PHP (e.g., Symfony 7.x, PHP 8.4), the B2B service can follow. If 12go moves to Go, PHP would still be the "legacy" stack they know — lower orphan risk than .NET. Not 5 because Go is under consideration as 12go's future direction. |

### B3: Microservice (Go)

| Score | **5/5** |
|-------|---------|
| **Rationale** | Go is explicitly under consideration by 12go (G3). Choosing Go aligns with their likely future direction. The service would be built in a language 12go may adopt for new services — it naturally evolves with their stack. No technology mismatch, no orphan risk. If 12go standardizes on Go, this service is already there. Best strategic alignment. |

### B4: Microservice (TypeScript/Node.js)

| Score | **2/5** |
|-------|---------|
| **Rationale** | TypeScript has no alignment with 12go's ecosystem (PHP today, possibly Go tomorrow). It is a third stack — not 12go's core, not the team's core. Broad hiring pool and AI synergy do not change the fact that 12go's future direction is PHP/Go. The service would be maintained by whoever built it or by hiring TS specialists; it does not "naturally evolve" with 12go. Dead-end from a platform-unification perspective. |

---

## Comparative Scoring Matrix (Criteria 5 & 6 Only)

| Option | Migration Risk | Future Extensibility | Weighted Subtotal |
|--------|----------------|----------------------|-------------------|
| **A: Monolith PHP** | 5 (15) | 4 (12) | **27** |
| **B1: Micro .NET** | 4 (12) | 2 (6) | **18** |
| **B2: Micro PHP** | 4 (12) | 4 (12) | **24** |
| **B3: Micro Go** | 4 (12) | 5 (15) | **27** |
| **B4: Micro TS** | 4 (12) | 2 (6) | **18** |

*Weighted subscore = (Migration Risk × 3) + (Future Extensibility × 3). Maximum for these two criteria = 30.*

---

## Summary

- **Migration Risk:** The monolith (A) is the clear winner — transparent switch, no new infra, no auth bridge. All microservice options (B1–B4) tie at 4/5: they require an auth bridge and traffic routing, but support parallel run and rollback.
- **Future Extensibility:** Go (B3) leads; PHP options (A, B2) follow; .NET (B1) and TypeScript (B4) trail as orphan/third-stack choices.
- **Combined (these two criteria):** A and B3 tie at 27. B2 is close at 24. B1 and B4 tie at 18.

This analysis does not include the other 12 criteria. The full evaluation in `evaluation-criteria.md` weighs Implementation Effort, Infrastructure Fit, Maintainability, Development Velocity, Team Competency Match, and others — which may shift the overall ranking.
