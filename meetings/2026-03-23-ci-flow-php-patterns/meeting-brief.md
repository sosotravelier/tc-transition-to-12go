# CI/CD Flow, Local Environment, and PHP Patterns

**Meeting** | Mar 23, 2026 | ~30 min
**Presenter** | Soso
**Audience** | TBD (12go veteran)

---

## Purpose

Knowledge-transfer session with an experienced 12go developer covering three areas: the CI/CD pipeline after merge (deployment flow, environments, access), local development environment stability, and PHP patterns for background processing and DB schema isolation.

---

## Current Project Status

- **Architecture**: Team-First Developer (PHP/Symfony inside F3) — resolved. B2B API lives inside the F3 monolith as a new module.
- **Search POC**: Code-reviewed and approved by Sana; not yet merged. Needs feature flag before merge.
- **PHP buddy sessions**: Approved by Shauly (2x/week initially), person not yet assigned.
- **Last meeting** (Mar 18 with Shauly): Confirmed Q2 scope = new client onboarding only, 7 core endpoints. Booking ID encryption decision still open. Kafka event topology needs research.
- **Local environment**: Setup took ~2 days with help from Yehor. Root cause was a 2024 migration failure (`SUPPLY-41`) that silently left the DB partially migrated, cascading for 2 years.

## Questions for Discussion

### 1. CI/CD Pipeline After Merge

- After merging to master, what happens? Is it deployed automatically?
- To which environment does it deploy? (staging? production?)
- How do I access that environment? Do I need Tailscale VPN?
- Since the B2B API adds new endpoints, does DevOps need to configure anything on the AWS side (e.g., API Gateway routing) to make them publicly accessible?

### 2. Local Environment Stability

- Context: Setup required ~2 days of debugging with help from Yehor. A single migration failure (`SUPPLY-41` in 2024) silently broke the DB and cascaded for 2 years. See [Q2 presentation](../2026-03-25-q2-implementation-plan/presentation.md) for full details.
- Is this a common occurrence? On a daily basis, how often do you hit migration issues?
- Or is it a one-time setup pain that I shouldn't worry about going forward?

### 3. Separate DB Schema for B2B

- Would it be plausible to define a separate migration schema for B2B-specific tables?
- Goal: avoid depending on years of existing F3 migration history for B2B-only data.
- Tradeoff: lose ability to do relational joins with existing F3 tables.
- This is exploratory — just want to understand if it's feasible and if anyone has done something similar.

### 4. Background Jobs / Async Processing in PHP

- How are background jobs handled in the F3 codebase?
- Does PHP have something like fire-and-forget processes?
- Or does it require publishing to RabbitMQ and consuming from a background worker?
- Context: B2B may need async processing for incomplete search results and potentially for webhook notification delivery.

## Agenda

1. CI/CD pipeline walkthrough (merge -> deploy -> access)
2. Local environment — expected stability and maintenance patterns
3. Separate DB schema feasibility for B2B module
4. Background job patterns in PHP/F3
5. Open questions and follow-ups

---

## Decisions Needed

| # | Decision | Who Decides |
|---|----------|-------------|
| 1 | Whether new endpoints need AWS Gateway configuration | DevOps / 12go veteran to advise |
| 2 | Feasibility of separate B2B DB schema | 12go veteran to advise |

---

## Prior Context

- [Mar 18 Team Lead Sync](../2026-03-18-team-lead-sync/meeting-record.md) — Q2 scope confirmed, PHP buddy approved
- [Q2 Implementation Plan presentation](../2026-03-25-q2-implementation-plan/presentation.md) — local env issues documented, per-endpoint challenges
