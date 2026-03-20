# Q2 Implementation Plan: B2B API in F3

**Meeting** | Mar 25, 2026 | ~45 min
**Presenter** | Soso
**Audience** | Eliran, Shauly, Sana, Eyal

---

## Purpose

Follow-up to the Feb 25 architecture decision meeting and the Mar 18 team lead sync. The architecture decision (PHP inside F3) has been made. The Search POC is complete. This meeting moves from "should we?" to "here's how, here's what's hard, and here's what I need."

**Goal**: Align stakeholders on the Q2 implementation plan — what endpoints we're building, what the known challenges are per endpoint, what was learned from the Search POC, and what dependencies must be resolved.

---

## What Should Be Presented

### 1. What We Learned from the Search POC in F3

From Shauly (Mar 18): _"I want you to emphasize what you learned about working in F3 — the instability of the local environment, communication, the buddy, that it was easy to write but [there were challenges], the pipeline."_

- **Local development environment** — Docker/F3 setup friction, years of migration scripts, stability issues
- **Code writing experience** — what was straightforward (calling internal services, response mapping) vs what was harder
- **CI/CD pipeline** — how it works (merge → staging → QA sign-off → production), what's good about it
- **Communication needs** — why the PHP buddy sessions are necessary, what questions came up

### 2. Per-Endpoint Challenges and Approach

From Shauly: _"What are the main challenges in each one of the APIs? Not just listing endpoints — what are the problems and how we're going to tackle them."_

For each of the 10 endpoints (3 master data + 7 booking), present:
- What it does (one line)
- Which F3 internal services it calls
- Known challenges / open problems
- Proposed approach

Key challenges to highlight:
- **Search**: Incomplete results / recheck mechanism (206 Partial Content), client timeout expectations
- **GetItinerary**: Booking schema parser (P4) — the single biggest risk
- **CreateBooking**: Schema field reassembly, bracket-notation serialization
- **Booking IDs**: Decision needed on encryption (validate with Sana)
- **Cancellation policy**: Basic `full_refund_until` for Q2, structured policy later (Sana confirmed: not in search)

### 3. Timeline and Task Breakdown

- 13 calendar weeks, 11 working weeks (vacation Apr 9-19)
- Week-by-week deliverables
- Early warning signals and thresholds
- What's committed vs what's deferred vs what's conditional

### 4. Dependencies and Help Needed

- PHP developer buddy sessions (approved by Shauly)
- QA resource (under discussion — Jerko as candidate)
- Kafka event spec from data team (needed by week 6)
- Monitoring/metrics discovery (Shauly co-owns)
- Webhook/notification service — offload or defer?

### 5. Decisions Needed from This Meeting

| # | Decision | Who Decides |
|---|----------|-------------|
| 1 | Booking ID encryption for new clients — raw 12go `bid` or obfuscated? | Sana + Shauly |
| 2 | Feature flag strategy for merged B2B code in F3 | Sana |
| 3 | Who is the PHP buddy? | Shauly / Sana |
| 4 | First new client — is there one lined up, or building for hypothetical? | Eliran / Shauly |
| 5 | Webhook/notifications — defer or assign to another developer? | Shauly / Eliran |

---

## Prior Context (for audience)

- **Feb 25 meeting**: Architecture options presented (monolith vs microservice). Decision deferred pending POC. ([meeting brief](../2026-02-25-microservice-vs-monolith-architecture-decision/meeting-brief.md))
- **Search POC**: Completed inside F3. All 4 search types return HTTP 200 with correct B2B contract shape.
- **Mar 17-18 syncs with Shauly**: PHP inside F3 confirmed as architecture. Scope = new client onboarding (no backward compatibility). 10 endpoints committed. gRPC out of scope. ([Mar 18 Q&A](../2026-03-18-team-lead-sync/meeting-questions.md))

---

## Document to Prepare

The main presentation document (to be written separately) should cover sections 1-4 above in detail, with diagrams where helpful. Format: similar to the Feb 25 meeting brief — technical enough for Sana and Eyal, strategic enough for Eliran.
