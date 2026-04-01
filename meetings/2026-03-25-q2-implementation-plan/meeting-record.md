---
status: complete
last_updated: 2026-03-25
---

# Meeting Record: Q2 Implementation Plan — B2B API in F3

**Date** | Mar 25 (pre-meeting + Part 1) and Mar 30 (Part 2), 2026
**Participants** | Soso, Shauly, Eliran, Eyal, Avikhai, Oleksandr (Part 1 only)
**Purpose** | Present Q2 implementation plan for migrating TC B2B API endpoints into F3. Align stakeholders on scope, per-endpoint challenges, dependencies, and decisions needed.

---

## Key Topics

### 1. Q2 Scope

Soso presented the scope as 10 endpoints (7 booking + 3 master data) for new clients only, using 12go native IDs. The meeting challenged several aspects:

- **Static data (3 endpoints)**: Eyal suggested stations/operators belong with the catalog team. Eliran agreed: "the ownership should be on teams because it's very catalog oriented." No decision was made — Eliran will talk with the catalog team. If they take ownership, these 3 endpoints leave Soso's plate but must still be in someone's Q2 plan.
- **SeatLock**: Eliran questioned: "It's being developed for all integrations on 12go... why do we need to do anything?" Shauly: David is implementing the TC→12go connection. By the time Soso reaches SeatLock, it should already be available. Eliran cautioned against "doing some temporary solution for a solution that will be solved anyway."
- **Search recheck**: The POC is done but has no recheck mechanism. This was pushed to the search team and product (see §4 below). Not Soso's to solve.
- **Migration plan added as deliverable**: Shauly: "We also need to commit here for a migration plan... what needs to be done but not the coding." This is a documentation deliverable for Q2.
- **gRPC confirmed out of scope**.
- **Using 12go IDs**: Eyal noted this is "a product decision, not a technical decision" — needs formal product confirmation. Soso: "It's not set in stone."

### 2. Parallel Discovery (Monitoring, Kafka Events)

- Monitoring/metrics: Soso explained the gap between TC's Grafana dashboards and 12go's Datadog. Discovery needed.
- **Kafka events**: Eliran pushed for a **unified approach** — send one set of events serving both TC and 12go rather than building TC-specific events. Eyal confirmed TC events describe the full funnel (search→confirm); 12go uses different tooling (not BigQuery). Shauly: "Maybe it's already being sent. I don't know." Eliran: "The BI data is a track you need to further investigate."
- **No owner assigned** for Kafka event investigation.

### 3. Search POC Learnings

- Soso completed the search POC fully with AI — code writing took ~2 days, local env setup was the hard part.
- Sana previously confirmed local env instability was likely a one-time event. Shauly countered: "I still think you will have something because we need to do bookings on that environment."
- Even with a microservice approach, F3 local env would still be needed for feature development.
- **PHP buddy**: Eliran suggested **Valeri** as the contact for local env support. Oleksandr offered to add Soso to the **F3 guild Slack thread**. Soso also requested periodic sync calls.

### 4. Search — Recheck Mechanism

The longest single discussion across both sessions. The presentation flagged recheck as high difficulty; the meeting effectively moved it off Soso's plate.

- Eyal: "This is not a technical issue... we need to first decide product-wise how we want the API to behave." Not every B2B client request should trigger a call to the provider — rate limits, quotas, look-to-book ratios.
- Eyal: the syncer is "a more natural component to handle B2B clients."
- Avikhai confirmed BookAway rechecks after 100ms and only once — "it does nothing basically." FerryScanner also has issues.
- Avikhai: "We need to come up with the best practice for clients to utilize the 206/recheck."
- Eliran: "It's probably search needs to handle this." Avikhai agreed: "deep in the kishka of search."
- **Outcome**: Recheck is a product + search team problem. Soso's search endpoint (from POC) works without recheck.

**Itinerary ID format**: Avikhai deferred it — "let's take it off now." Shauly noted metadata (search time, passenger count) is embedded in current IDs and used for events. Not decided.

### 5. Static Data (Stations, Operators, POIs)

- Shauly questioned POI endpoint: "I'm not familiar with it." Also questioned whether to start with static data at all.
- Eyal suggested catalog team ownership: "Stations and operators are things the catalog will need to expose to clients."
- Current TC mechanism explained: Fuji listener → S3 → temp S3 → signed URL.
- **Keep TC format or adopt 12go format?** Avikhai: "Do as much as we can not to change something on the client side." Eliran: "For new customers, it will be right to take it from [whatever makes sense]."
- Soso flagged: design is ready (tables, TC contract mapping), but if catalog team has a bigger vision they'd redo it. If onboarding new clients by end of Q2, this must be in someone's sprint.
- **No decision on ownership** — Eliran to discuss with catalog team.

### 6. Booking Funnel — Schema and Approach

The booking funnel occupied most of Part 2. Key discussion was about the implementation approach.

- **Booking schema parser** (~1,180 lines) confirmed as biggest risk.
- Eyal argued booking flow is fundamentally different from search: "The connect flow and the 12go flow is different... the cart that 12go has that we don't have... the booking schema... it's totally different."
- **Eyal's alternative proposal**: Instead of calling 12go's B2B API (JSON → re-translate), call F3's internal business logic directly — "get the object model from the business logic and translate it to a different API."
- Soso skeptical: "I doubt on 12go side there will be some DDD design or separate core." Controllers call application services that directly query DB — thin layer.
- **Shauly shut down scope expansion**: "I don't want to get into that project to do some changing in the API... it's a bit out of scope."
- Eyal estimated booking flow extraction (autonomous service) "will not be in Q2 probably not in Q4" — but this refers to the full extraction, not Soso's translation approach.
- **Outcome**: Proceed with current approach (same as search POC). Soso will explore whether a dedicated internal F3 method can reduce the booking schema transformation. Not guaranteed to help.

**Booking ID**: Shauly: "I think we should consider using the 12go API booking ID." Eliran: "The guidance should be that we need to follow 12go wherever we can." Eyal: "It's a string for the client. It shouldn't break anyone." **Decided: use 12go native booking ID for new clients.**

**SeatLock**: Eliran questioned need (see §1). Shauly: it'll be ready by the time Soso needs it. Left in scope but lowest priority.

**Incomplete Results**: Avikhai confirmed must keep it — "clients expect it." Shauly noted timeout is 15-20 seconds (not 60). High difficulty — requires background job + DB write + polling endpoint.

### 7. Post-Booking Operations

- **GetBookingDetails**: Low difficulty — runtime API call to 12go replaces local DB read. No persistence needed.
- **GetTicket**: Eyal: "If clients are getting a URL, I don't think it matters if the URL is S3 or 12go." Avikhai on branding: "This is what we get today. We don't do anything." Soso: worst case, re-upload to S3. Likely simpler than "medium" difficulty.
- **CancelBooking**: Low — use 12go's refund_amount directly. Vlad's revenue changes align.

Eliran asked if we checked for data gaps between TC booking model and 12go — Soso/Shauly believe covered. Shauly: "We are trying to keep not adding additional things" before migration.

### 8. Notifications

- Soso presented three approaches (extend webhook table / in-process F3 / keep old .NET services).
- Key challenge: 12go doesn't send client ID in notifications. Need booking ID → client mapping.
- **Shauly: can be deferred** — "Clients usually don't understand until they are deeply invested on production that they want this feature."
- Eyal: clients can always poll (get booking details) instead of push notifications.
- **Outcome**: Not a Q2 blocker for new client onboarding. Can be deferred or offloaded.

### 9. Client Identity & Authentication

- Soso proposed removing `client_id` from URL — derive identity from API key only.
- **Eyal pushed back**: enables future impersonation, log visibility, security. "If we change it now, it will be harder to break it again."
- **Avikhai**: "I don't understand the real value of removing the client ID... it needs to be extremely justified."
- Soso conceded: "Agreed. It was my duty to push."
- **Outcome: Keep `client_id` in URL.** Don't validate correspondence initially (like TC did early on). Add validation later.
- Need a `b2b_clients` table or column to store human-readable client_id mapped to 12go's `usr_id`.
- Shauly wants meaningful string names, not just 12go's numeric agent ID.
- Auth mechanism: Soso already added X-API-Key header support in F3. Reuses 12go's authentication internally.
- Eliran: "12go should become yet another brand... not have separate mechanisms."
- Eyal: B2B auth may need to evolve faster than 12go B2C auth — worth having flexibility.

### 10. Existing Client Migration (Q3+, plan drafted in Q2)

- **Station/operator IDs**: Avikhai: "I don't see a way to avoid" the mapping.
- **Old bookings**: Keep old .NET services for post-booking operations until bookings expire naturally. Shauly alternative: migrate active bookings into 12go system. Old non-12go bookings (FlixBus, DeOniBus) expire by ~Nov 2026. Eliran: "Maybe this one can just be resolved by time passing."
- **API keys**: Eliran: "Let's check if we can add [old key] to 12go systems... also good for security reasons to rotate." Avikhai: "The API key would be the smallest issue."
- **DNS/URL routing**: Eyal: "It's just a different mapping in the DNS." Could use v2 path prefix for migration routing. **Action: Shauly to open task for Tal** to investigate options. Eliran: "Tal will be the owner."

### 11. Testing

- Shauly suggested extending existing TC end-to-end tests (same API, different IDs).
- Eliran: need tests in 12go pipeline — "their deploys can also break us."
- QA automation engineer was let go — someone needs to pick up that work.

### 12. Post-Meeting Wrap-up (Shauly + Soso)

- Shauly requested a Jira epic with stories for **everything** — not just Soso's implementation tasks, but also open items, unresolved decisions, and work that may be assigned to others. Shauly: "Even for the open items that we have... for example the recheck — I want to have stories for that, that either will decide to postpone it maybe for next phase or it will let someone handle it, maybe you maybe somebody else. I just want to have the flexibility for that and also to create the visibility."
- The epic is a **project tracker**, not just a developer task list. Items owned by Eliran, Tal, catalog team, search team, product — all should have stories.
- Soso committed to creating by Thursday (Mar 27).
- Shauly wants touchpoint with Eliran on Monday (Mar 31).
- Shauly asked for Claude Code methodology help for his own analysis work.

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | Use 12go native booking IDs for new clients | Shauly, Eyal, Eliran |
| 2 | Keep `client_id` in URL path (don't remove) | Eyal, Avikhai (consensus) |
| 3 | Booking flow: proceed with F3 internal service calls (same as search POC); explore optimization for booking schema | Shauly (proceed), Eyal (explore) |
| 4 | Recheck/206 is product + search team responsibility, not Soso's | Eliran, Eyal, Avikhai |
| 5 | Notifications can be deferred — not needed for new client onboarding | Shauly |
| 6 | Follow 12go conventions (IDs, auth, formats) wherever possible | Eliran |
| 7 | Valeri as PHP buddy; Soso added to F3 guild Slack thread | Eliran, Oleksandr |
| 8 | DNS routing investigation → Tal (DevOps) | Shauly, Eliran |
| 9 | Create Jira epic with stories for all transition work | Shauly |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| Soso | Create Jira epic and stories for all Q2 transition work items | Mar 27, 2026 |
| Soso | Explore whether booking schema can use internal F3 method (bypass API JSON) | During implementation |
| Soso | Draft existing client migration plan (documentation, not code) | Q2 |
| Oleksandr | Add Soso to F3 guild Slack thread | Immediate |
| Eliran | Talk to Valeri about being PHP buddy for Soso | Immediate |
| Eliran | Discuss stations/operators ownership with catalog team | TBD |
| Eliran | Finalize owners for open items from this meeting | TBD |
| Tal | Investigate DNS/routing options for base URL migration | TBD |
| Shauly | Define recheck/206 behavior with product + search team | Q2 |
| Shauly+Soso | Touchpoint with Eliran on Monday Mar 31 | Mar 31, 2026 |
| Avikhai | Define best practice for B2B clients using 206/recheck | TBD |

---

## Key Quotes

> "I don't want to get into that project to do some changing in the API and then have another... it's a bit out of scope of what we are trying to do here." — Shauly

> "In the booking flow, it's a different thing... the gaps are greater... it's not just calling the same things in different names." — Eyal

> "The guidance should be that we need to follow 12go wherever we can." — Eliran

> "I don't understand the real value of removing the client ID... it needs to be extremely justified." — Avikhai

> "BookAway rechecks after 100 milliseconds and only once — it does nothing basically." — Avikhai

> "Clients usually don't understand until they are deeply invested on production that they want this feature." — Shauly (on notifications)

> "It's probably search needs to handle this." — Eliran (on recheck mechanism)

> "Even I got it. So that's amazing." — Avikhai (on the presentation)

---

## Open Questions (Carried Forward)

- **Stations/operators ownership** — Catalog team or Soso? Eliran to discuss. If catalog takes it, "10 endpoints" shrinks to 7 for Soso.
- **Recheck/206 for B2B** — Product decision needed. Search team likely owns implementation. Not blocking Soso's Q2 work.
- **Itinerary ID format** — Deferred from this meeting ("let's take it off now" — Avikhai). Needs decision before search endpoint goes to production.
- **Using 12go IDs** — Eyal flagged as product decision needing formal confirmation, not just technical assumption.
- **Booking schema optimization** — Can a dedicated F3 internal method reduce the ~1,180-line transformation? Unknown until Soso explores during implementation.
- **Client onboarding flow** — How is a new B2B client created? Where is client_id stored? Needs resolution before first client.
- **Ticket branding** — 12go logo vs client branding on PDFs. Product decision.
- **Kafka events** — What events does data team need? Unified with 12go or separate? No owner assigned.
- **End-to-end test ownership** — QA engineer gone. Who maintains/extends automation tests?
- **Unified API initiative** — Shauly leading parallel investigation (asked by Eliran) into whether TC API can serve 12go traffic. Related to ID/convention decisions.
