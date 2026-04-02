---
status: complete
last_updated: 2026-03-30
---

# Meeting Record: Team Lead Sync Before Holidays

**Date** | Mar 30, 2026
**Participants** | Soso, Shauly
**Purpose** | Quick sync before Soso's week-long holiday. Align on immediate next steps, review Jira story breakdown, and discuss Claude Code workflow.

---

## Key Topics

### 1. Immediate Implementation Priority — Get Itinerary

Shauly wants to set aside the operator topic and focus on Get Itinerary as the next endpoint to implement. The approach: take the itinerary from the search response and build Get Itinerary **without the booking schema** — just the trip details and booking token creation, no seat map.

Shauly also asked to **split Get Itinerary and Schema into two separate tasks**. The schema is a prerequisite for Create Booking but not for Get Itinerary itself.

### 2. Logging and Error Handling

Shauly raised the need for proper logs and error handling across endpoints. Soso noted that search logging was minimal — "maybe only request" — and the logging approach for F3 needs further investigation.

### 3. Jira Story Breakdown

Soso walked through the draft story list being prepared for the Jira epic:

- **Foundation**: Client ID support and B2B table in F3 (common dependency, can be done later)
- **Static data**: Stations, operators, POIs (3 stories)
- **Get Itinerary** (split from schema)
- **Booking schema** (separate, prerequisite for Create Booking)
- **Create Booking**, **Confirm Booking**, **Cancel Booking**
- **Post-booking operations**: SeatLock, notifications
- **Recheck** (separate story — Avikhai thinks syncer approach is better, based on FerryScanner call)
- **DNS URL routing** investigation (DevOps)
- **Kafka events** investigation
- **Monitoring/metrics** analysis
- **End-to-end tests** migration to pipeline
- **gRPC** (separate, could be offloaded)
- **Migration data tasks** (station export, ID correspondence)
- **Integration environment** story

Shauly confirmed: migration-related tasks should be documented in the plan but **not created as Jira tickets** yet unless part of the milestone. He wants the full migration path documented to avoid surprises.

### 4. Recheck Update — FerryScanner Call

Shauly relayed information from a call he and Avikhai had with FerryScanner. Avikhai believes that instead of the recheck mechanism, their syncer (similar to the prefetch) is the correct way to handle it. This aligns with the previous meeting's decision to move recheck off Soso's plate.

### 5. Validations in Booking Flow

Shauly emphasized keeping front-end validations based on the booking schema before sending requests downstream. Experience shows that relying only on 12go's internal validations leads to harder-to-debug failures when things break deeper in the integration layer.

### 6. Testing

The team needs to understand what developer tests 12go has — unit tests, end-to-end tests, CI coverage. Soso noted no tests were running during CI automation, but there may be something else.

Shauly mentioned he recently updated existing end-to-end tests (after closing a bus operator integration) using AI. The same tests could be adapted for B2B by changing the URL and some IDs — relatively low effort.

### 7. Integration Environment

Shauly wants an explicit story for investigating the integration environment. It theoretically exists but they need to understand how it's connected and whether it works out of the box.

### 8. Monday Meeting — Booking Flow Deep-Dive

Shauly blocked time on Monday (Mar 31) from 1:00–3:30 PM for a focused session on the booking flow. He wants to go deeper on what needs to happen there and align on the approach.

### 9. Possible Move from Jira to Linear

Shauly mentioned the company is probably moving to Linear. There's a migration path from Jira to Linear, so work tracked in Jira now should carry over.

### 10. Claude Code Workflow Discussion

Extended discussion about Shauly's experience learning Claude Code. Topics covered:
- Difference between Claude Code CLI and the web-based "co-work" mode
- How skills work (markdown files, slash commands, workspace-scoped)
- Worktrees and file creation behavior
- Creating reusable prompts/skills for repetitive queries (e.g., BigQuery analysis parameterized by client ID)
- Sharing skills across projects — currently workspace-scoped, not globally portable

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | Next implementation priority: Get Itinerary without booking schema | Shauly |
| 2 | Split Get Itinerary and Schema into two separate tasks | Shauly |
| 3 | Migration plan: document the full path but no Jira tickets for migration tasks yet | Shauly |
| 4 | Integration environment: create as a separate story | Shauly |
| 5 | Monday (Mar 31) meeting to deep-dive on booking flow, 1:00–3:30 PM | Shauly |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| Soso | Start implementing Get Itinerary endpoint (without schema) | Before holidays |
| Soso | Finalize Jira story breakdown and add to epic | Before Monday meeting |
| Shauly | Lead Monday meeting — booking flow deep-dive (1:00–3:30 PM) | Mar 31, 2026 |
| Shauly | Complete alert/monitoring analysis (benchmark current state) | TBD |
| Soso | Add logging and error handling approach to implementation | TBD |

---

## Key Quotes

> "I want to put the operator at the side. I want to see what we can progress in the next few days." — Shauly

> "I don't want a Jira ticket for that at the moment unless we'll decide that this is a part of the milestone. I just want to have the full migration path to understand what are the stages needed, that we are not shooting our leg." — Shauly (on migration planning)

> "Instead of the recheck, they have like a syncer or something like that which is similar to our prefetch, and he thinks that this is the correct way to handle it." — Shauly (relaying Avikhai's view from FerryScanner call)

> "When we have good validations at the beginning we are getting better results. If we don't do that and pass it to the integration, then things start to fail there and it's harder to understand." — Shauly (on keeping booking schema validations)

> "I'm trying to do some analysis of what we have right now just to see that our alerts are what we need and we don't have more than that." — Shauly (on monitoring benchmark)

---

## Open Questions (Carried Forward)

- **Logging approach in F3** — What logging exists? What level for B2B endpoints? Needs investigation.
- **12go developer tests** — What unit/integration/E2E tests exist in F3 CI? Unknown.
- **Integration environment** — How is it connected? Out of the box or needs configuration?
- **gRPC offloading** — Could someone else take the gRPC story? Shauly suggested it.
- **Recheck mechanism** — Avikhai favors syncer approach over recheck. Still needs product decision (carried from previous meeting).
