# Q2 Deliverables Proposal — Team Lead Sync Mar 18, 2026

**Prepared by**: Soso
**Context**: Team Lead needs to commit to Q2 deliverables. He is pushing for the system to be ready in F3 to onboard new clients. Soso is the sole developer. This proposal defines what "ready" means, what is committed, what is deferred, and what must be delegated.

---

## Architecture Decision: PHP/Symfony Inside F3

Based on 6 design proposals and 4 independent evaluations (see `design/recommendation.md`):

- **Language**: PHP/Symfony
- **Deployment**: Inside F3 monolith (not standalone microservice)
- **Rationale**: Organizational alignment (one codebase, Team Lead's co-location preference from Mar 17), long-term maintainability by the team, infrastructure reuse, no new DevOps burden
- **Integration approach**: Call F3's internal PHP services directly (in-process), not via HTTP. Search POC already proved this — `SearchService`, `SearchFilterBuilder`, `TripPoolRepository` called directly. Same approach for booking funnel.
- **Search POC**: Already proven — all 4 search types return HTTP 200 with correct B2B contract shape in F3

**Decision needed from Team Lead**: Confirm PHP inside F3. This was his preference on Mar 17 — making it official unblocks implementation.

---

## What "Ready to Onboard New Clients" Means

New client onboarding is **fundamentally simpler** than migrating existing clients because we don't need backward compatibility with legacy ID formats or legacy systems.

### Key Simplification: New Clients Use Native IDs

Since new clients have no history with our system, they receive **12go native IDs** everywhere:

- **Booking IDs**: 12go `bid` (integer) directly — no KLV encoding, no short ID generation, no Caesar cipher encryption
- **Station IDs**: 12go native station IDs — no Fuji CMS ID mapping needed
- **Operator IDs**: 12go native operator IDs — no Fuji mapping needed
- **POI IDs**: 12go native POI/province IDs — no Fuji mapping needed

This eliminates P1 (station ID mapping), P5 (booking ID transition), P6 (in-flight booking safety), and most of P7's ID translation concerns **for Q2 scope**. These problems only resurface when we migrate existing clients (Q3+).

| Concern                               | New Clients (Q2)    | Existing Client Migration (Q3+)                    |
| ------------------------------------- | ------------------- | -------------------------------------------------- |
| Booking ID format                     | 12go `bid` directly | Required — KLV decoding + short ID mapping table   |
| Station/Operator/POI ID mapping       | 12go native IDs     | Required — Fuji CMS ↔ 12go bidirectional mapping   |
| In-flight booking safety (P6)         | Not applicable      | Required — mid-funnel cutover risk                 |
| Booking schema parser (P4)            | **Required**        | Required                                           |
| Auth key mapping (P3)                 | **Required**        | Required                                           |
| API contract fidelity (P7)            | **Required** (minus ID translation) | Required (full, including ID translation) |
| Webhook notifications (P2)            | **Required** (if clients need them) | Required                             |

### Implementation Approach: Internal F3 Services, Not HTTP

Since the B2B module lives inside F3, all booking funnel operations call **F3's internal PHP services directly** (in-process), not via HTTP. This is the same approach proven by the Search POC, which calls `SearchService`, `SearchFilterBuilder`, `TripPoolRepository` directly.

### Minimum Viable "New Client Ready" = 7 Core Booking Endpoints + Master Data

A new client can onboard when they can (a) discover available stations and (b) complete the full booking funnel:

**Master Data (prerequisite for onboarding)**:

| #   | Endpoint       | Source                             | Complexity                                        |
| --- | -------------- | ---------------------------------- | ------------------------------------------------- |
| 1   | **Stations**   | F3 internal station data (MariaDB) | Low-Medium — expose 12go native station IDs in B2B response format |
| 2   | **Operators**  | F3 internal operator data          | Low — response mapping                            |
| 3   | **POIs**       | F3 internal POI/province data      | Low — response mapping                            |

**Booking Funnel** (all via F3 internal services, no HTTP hops):

| #   | Endpoint              | F3 Internal Services Used                                          | Complexity                                                             |
| --- | --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 4   | **Search**            | `SearchService`, `SearchFilterBuilder`, `TripPoolRepository`       | Medium — response mapping, 206 Partial Content for recheck             |
| 5   | **GetItinerary**      | `CartHandler`, checkout services, booking form manager              | **High** — booking schema parser (P4), field-name mapping cache        |
| 6   | **CreateBooking**     | Reservation services (in-process reserve + status)                 | **High** — schema field reassembly, bracket-notation serialization     |
| 7   | **ConfirmBooking**    | Confirmation services (in-process confirm + status)                | Medium — status mapping, payment handling                              |
| 8   | **GetBookingDetails** | Booking detail services                                            | Low-Medium — response mapping                                          |
| 9   | **GetTicket**         | Ticket/voucher services                                            | Low — ticket URL extraction                                            |
| 10  | **CancelBooking**     | Refund option + refund services                                    | Medium — cancellation policy mapping, refund flow                      |

### New Client Onboarding Approach

New clients are given new endpoint URLs and new API keys directly — they connect to the new B2B module in F3 from day one. There is no routing, no feature flags, no gateway logic involved.

### Plus These Cross-Cutting Requirements

| Requirement                | Approach                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Authentication             | Config table: `client_id` → API key                                                    |
| Booking schema field cache | Redis with 1hr TTL (PHP-FPM needs external cache for cross-request state)              |
| API contract fidelity (P7) | Money as strings, pricing structure, status mapping, date formats, correlation headers (all using 12go native IDs — no ID translation needed for new clients) |
| Basic observability        | F3's Datadog PHP tracer (`dd-trace`) auto-instruments HTTP requests/responses. Custom business metrics (e.g. booking.reserved) require explicit DogStatsD calls — added per-endpoint as they are built. |


---

## What I Am Committing To (Q2)

### Committed: 10 Endpoints (7 Booking + 3 Master Data) + New Client Onboarding Capability

**Target**: By end of Q2 (June 2026), the system can onboard **at least one new client** end-to-end — from station discovery through the full booking funnel — inside F3.

### Realistic Timeline (~13 calendar weeks, 11 working weeks)

**Note**: Soso is on vacation Apr 9-19 (8 working days). Search POC is already implemented and will be merged — the first booking funnel endpoint to build from scratch is GetItinerary.

| Week  | Dates (approx)  | Deliverable                                                                | Validation Gate                                                              |
| ----- | --------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | Mar 23-27       | F3 environment setup, B2B module structure, merge Search POC, fix recheck URL handling | Environment stable, Search endpoint merged and returning correct responses. Confirm native ID strategy with Team Lead. |
| 2-3   | Mar 30 - Apr 8  | GetItinerary + booking schema parser                                       | Parser tests pass against C# fixtures; GetItinerary returns correct response |
| —     | **Apr 9-19**    | **Vacation (no work)**                                                     | —                                                                            |
| 4-5   | Apr 21 - May 2  | CreateBooking + ConfirmBooking                                             | End-to-end booking against 12go staging                                      |
| 6-7   | May 5-16        | GetBookingDetails + GetTicket + CancelBooking                              | Post-booking operations tested                                               |
| 8     | May 19-23       | Master data endpoints (Stations, Operators, POIs) + Kafka event emission   | Station list returns correct B2B format; events flowing to Kafka             |
| 9-10  | May 26 - Jun 6  | Shadow traffic comparison for search, integration testing, bug fixing      | Search responses match current system                                        |
| 11-12 | Jun 9-20        | First new client onboarding (internal test client), monitoring, hardening  | Client completes full flow: station discovery → search → book → manage       |


**Buffer**: Weeks 11-12 are buffer/hardening. If booking schema parser takes longer than weeks 2-3 (the biggest risk), this buffer absorbs it.

### Early Warning Signals (When to Adjust)


| Signal                  | Threshold                          | Action                                          |
| ----------------------- | ---------------------------------- | ----------------------------------------------- |
| F3 environment issues   | > 2 days of setup friction in week 1 | Escalate for hands-on support from PHP developer; this is the only viable path |
| Booking schema parser   | Not code-complete by end of week 3 | Reassess timeline; cut scope aggressively       |
| GetItinerary (first new endpoint) | > 5 working days          | Reassess PHP learning curve; scope reduction    |


---

## What Is NOT Committed for Q2

### Scoped Out Entirely


| Item                                            | Reason                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **gRPC Search Integration** (Google Metasearch) | Team Lead agreed this could be scoped out (Mar 17). Entirely different protocol, low priority for new client onboarding.              |
| **Existing client migration**                   | Different problem: requires Fuji↔12go station ID mapping, booking ID mapping table (short IDs are opaque — cannot be decoded, need DB export from Denali PostgreSQL), in-flight booking safety. Q3 or later. |
| **Backward compatibility with legacy IDs**       | New clients use 12go native IDs everywhere (stations, operators, bookings). Fuji CMS ID translation and KLV/short booking ID decoding are only needed for existing client migration. |
| **Performance testing**                         | Open question from Mar 17. Not blocking for first new client; can follow in Q3.                                                       |

**Kafka event emission — conditionally committed**: Soso will implement Kafka event emission (week 8), BUT someone else must first clarify: which events are required, what data they carry, and where the data comes from. This is a data team + Team Lead responsibility. If requirements are delivered by week 6, events ship in Q2. If not, events slip.


### Deferred to After First Client Onboarding


| Item                                                     | When                                  | Why                                                                                                     |
| -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Incomplete Results / polling endpoint**                | After core endpoints                  | 206 Partial Content on Search is committed; the polling endpoint is secondary.                          |
| **Legacy booking ID mapping** (P5)                        | When existing client migration starts | KLV IDs can be decoded to extract 12go `bid`. Short IDs (10-char Base62) are opaque — require a mapping table exported from Denali's PostgreSQL `BookingEntities` table. Both populations need handling for existing client migration. |
| **Custom DogStatsD metrics** (PE's 10 metrics, 3 alerts) | Post-MVP                              | Auto-instrumentation via Datadog APM for launch; custom metrics are an enhancement.                     |


---

## What I Expect to Be Delegated / Supported

These are **not optional requests** — they are dependencies that block or significantly risk the Q2 deliverable if unaddressed.

### Must Be Delegated


| Item                                              | Who                  | Why                                                                                                                                                                                                                                        | Impact if Not Done                                                                                                                        |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Booking Notifications / Webhook Receiver** (P2) | Another developer    | Different topology (inbound webhook → client resolution → outbound delivery). Entirely separate from the request-response booking funnel. Complex: bid→client_id resolution, outbound webhook delivery, notification shape transformation. | New clients cannot receive booking status updates. They can poll GetBookingDetails as a workaround, but this is not acceptable long-term. |
| **Monitoring/Metrics Discovery**                  | Team Lead (with cooperation from PHP side) | Exploration work: what metrics exist in current .NET services, what the PHP platform already tracks, what gaps remain. This is a management/operational concern, not a developer task.                                                      | We fly blind on what metrics to preserve. Some dashboards may go dark.                                                                    |
| **Kafka Event Requirements Specification**        | Data team + Soso (pairing session) | 25+ Kafka events currently emitted by .NET services. Soso needs to be paired with someone from the data team (or an architect/BA) to go over exact event requirements — which events, what data, where it comes from. Soso will implement the emission. Spec needed by week 6. | Kafka event emission slips past Q2. Data pipelines break when .NET is decommissioned.                                                     |
| **QA Resource**                                   | Team Lead            | Solo developer producing endpoints needs someone testing behind them on 12go staging ("conveyor belt" approach from Mar 17). Without QA, integration testing falls on Soso, adding 30-50% to timeline.                                     | Timeline extends by 3-5 weeks. Bugs discovered late.                                                                                      |


### Must Be Supported (Not Delegated, But Required)


| Item                                   | Who              | What                                                                                                                | When             |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **PHP developer sessions + F3 support** | Existing PHP developer | 1-hour sessions **twice a week** for first 2 weeks (Soso prepares questions, they resolve together; includes F3 local dev/Docker issues). Then **once a week** for 1 month. Then as-needed as Soso becomes more self-sufficient. | Weeks 1-2: 2x/week. Weeks 3-6: 1x/week. After: as needed. |
| **12go API clarifications**            | PHP-side engineering | Recheck mechanism, per-client pricing, and other integration questions as they arise.                               | As needed        |
| **Architecture decision confirmation** | Team Lead        | PHP inside F3 — confirm today.                                                                                      | Today (Mar 18)   |


---

## Explicit Assumptions

Everything above depends on these assumptions being true. If any assumption is wrong, the timeline changes.


| #   | Assumption                                                                                               | If Wrong...                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | F3 local development is workable (Search POC issues are resolvable in ~2 days)                           | Escalate for hands-on support from PHP developer. F3 is the only viable path — standalone service is not an option.                                              |
| A2  | Booking schema parser can be ported from C# to PHP in 2-3 weeks using AI assistance and C# test fixtures | Parser is the single biggest risk. If it takes 4-6 weeks, timeline extends — all 10 endpoints are committed, scope reduction means pushing the end date out.     |
| A3  | 12go staging environment is available and stable for QA testing after local development                   | If staging is unreliable, QA is blocked. Need recorded fixtures as fallback for local testing.                                                                    |
| A4  | New clients use 12go native IDs (stations, operators, bookings) — no backward compatibility with Fuji CMS IDs needed for Q2 | If Team Lead insists on Fuji ID compatibility for new clients too, station ID mapping work is added (~1 week). Soso can extract the data himself. |
| A5  | "New client onboarding" means: client can discover stations, search, book, and manage bookings through the API | Does NOT mean: client receives webhook notifications (delegated), client can use gRPC (scoped out). |
| A6  | Webhook notifications are delegated to another developer                                                 | If Soso must also build the notification receiver, add 2-3 weeks and push the end date.                                                                          |
| A7  | QA resource is assigned by week 4                                                                        | Without QA, Soso does integration testing alone. Timeline extends or quality drops.                                                                              |
| A8  | Kafka event requirements are specified (by data team pairing) by week 6                                  | If not, Kafka emission slips past Q2. Soso will implement it, but cannot define what events the data team needs.                                                  |


---

## Summary for Team Lead

**What you can commit to Q2**: The B2B system inside F3 is ready to onboard new clients through 10 endpoints — 3 master data (Stations, Operators, POIs) + 7 booking funnel (Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, GetTicket, CancelBooking).

**What this does NOT include**: Webhook notifications (must be delegated), existing client migration (including legacy ID backward compatibility), gRPC, performance testing. Kafka events are conditionally committed — requirements must come from data team by week 6.

**What you must provide**: QA resource, PHP developer sessions (2x/week then 1x/week), monitoring/metrics discovery (Team Lead responsibility), data team pairing for Kafka event spec.

**Biggest risk**: Booking schema parser port (weeks 2-3). If it's not code-complete by week 3, we know the timeline needs adjustment.

**Decision needed today**: Confirm PHP inside F3 as the architecture.

---

## Appendix: Open Questions Requiring External Input

These are unresolved questions from the design phase that don't block starting but need answers during Q2:


| #   | Question                                                          | Who Answers              | When Needed                               |
| --- | ----------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| 1   | What events does the data team need from the new system?          | Data team (pairing with Soso) | By week 6 — blocks Kafka emission     |
| 2   | How does the platform handle per-client pricing/markup?           | PHP-side engineering     | Before first client onboarding (week 11)  |
| 3   | Confirm: new clients use 12go native IDs (no Fuji backward compatibility needed for Q2) | Team Lead | **Week 1 — blocks endpoint design decisions** |


