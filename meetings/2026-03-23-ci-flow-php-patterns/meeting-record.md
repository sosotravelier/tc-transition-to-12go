---
status: complete
last_updated: 2026-03-23
---

# Meeting Record: CI/CD Flow, Local Environment, and PHP Patterns

**Date** | Mar 23, 2026
**Participants** | Soso, Sana
**Purpose** | Knowledge transfer on CI/CD pipeline, local environment stability, separate DB schema feasibility, PHP background job patterns, and feature flags

---

## Key Topics

### 1. CI/CD Pipeline After Merge

- After merging to **master**, changes are deployed automatically to **Canary** (pre-production environment).
- Canary URL for F3: `https://recheck10.canary.12go.com`
- Soso needs **access to TeamCity** (CI/CD server).
- After verifying changes on Canary, Soso should ask **Sana** to deploy to production.
- **Alternative flow**: Instead of targeting master, PRs can target a **release branch**. In this case, changes deploy to `12go.io` (URL: `recheck10.12go.io`).
- **No AWS API Gateway changes needed** for new B2B endpoints — confirmed by Sana.
- **Tailscale VPN is required** for accessing environments.

### 2. Local Environment Stability

- Sana said migration issues like what Soso experienced **are not common** for him — "such issues never happen unless there's a real issue."
- There's a `12go //help` command available for help with 12go CLI commands.
- The 2-day setup pain Soso experienced was likely a one-time event (cascading from the 2024 `SUPPLY-41` migration failure), not a recurring problem.

### 3. Separate DB Schema for B2B

- **Confirmed feasible** — it's common practice in 12go to have separate schemas.
- In `12go/migrations/sql`, there are multiple schemas: a `common` schema that runs for all modules, plus separate schemas for separate modules.
- `default` schema is for catalog data. `trip_pool` and `pass_pool` are the ones Sana works with most.
- Having a separate B2B schema is "definitely plausible."

### 4. Background Jobs in PHP

- Two approaches exist: via **F2** or via **F3**.
- **F2 approach (not recommended)**: Involves publishing to a queue, reading it in F2, which then calls code in F3. Unnecessary indirection.
- **F3 approach (recommended)**: Described in the **README.md of frontend3**. Executes in the same process but after the HTTP response is sent.
- **Caveat**: This runs in the same PHP-FPM process, so long-running background tasks will tie up a worker thread and could affect throughput.

### 5. Feature Flags

- **No feature flag needed** for the new search endpoint — Sana's assessment.
- 12go uses **GrossBook** for feature flags and A/B tests.
- Features are enabled **per user**. Since 12go was originally B2C, they had granular user segmentation.
- **B2B challenge**: All users of a big B2B client share the same client identity. Enabling features per-client (rather than per-user) is plausible but would need a workaround.
- Currently, the **BFF generates unique identifiers** for clients, and they haven't done feature flags for B2B use cases yet.

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | No AWS API Gateway changes needed for new B2B endpoints | Sana |
| 2 | Separate DB schema for B2B is feasible and encouraged | Sana |
| 3 | Use F3 background job approach (not F2) for async processing | Sana |
| 4 | No feature flag needed for new search endpoint | Sana |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| Soso | Get TeamCity access | TBD |
| Soso | Read F3 README.md for background job pattern details | TBD |
| Soso | Investigate GrossBook for B2B feature flag feasibility if needed later | TBD |

---

## Key Quotes

> "Such issues never happen unless there's a real issue." — Sana (on local environment migration problems)

> "It's common to have separate schemas. In 12go/migrations/sql we have multiple schemas." — Sana (confirming B2B schema separation is feasible)

> "The F2 approach is not recommended. It involves publishing something to some queue, then reading it in F2 that calls a piece of code in F3." — Sana (on background job patterns)

> "There's no need to introduce a feature flag for this new search endpoint." — Sana

---

## Open Questions (Carried Forward)

- **B2B feature flags at scale** — If feature flags are needed later, how to enable per-client (not per-user) in GrossBook? BFF currently generates unique identifiers but no B2B feature flags exist yet. Needs further investigation if feature flags become a requirement.
- **Background job throughput impact** — F3 background jobs run in the same PHP-FPM process. For high-volume async operations (e.g., webhook delivery), need to assess whether this will bottleneck worker threads. May need RabbitMQ/queue-based approach for heavy workloads.
- **Booking ID encryption** — Still open from Mar 12.
- **Kafka event topology** — Still needs research / pairing session with data team.
