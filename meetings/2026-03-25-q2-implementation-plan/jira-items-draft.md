# Q2 B2B API Transition — Jira Epic Stories

> Per Shauly: "Even for the open items... I want to have stories for that, that either will decide to postpone it maybe for next phase or it will let someone handle it."

### Jira Ticket Tracking

| # | Story | Jira | Status |
|---|-------|------|--------|
| — | **Epic: Q2 B2B API Transition** | **ST-2483** | Created 2026-04-02 |
| 5 | GetItinerary (without booking schema) | ST-2484 | Created 2026-04-02 |
| 1 | Spike: Q2 Open Decisions | — | Not yet created |
| 2 | Client Identity: client_id resolution | ST-2485 | Created 2026-04-03 — scope refined, two approaches for grooming |
| 3 | Static Data (Stations, Operators, POIs) | — | Not yet created |
| 5b | Booking Schema Parser | — | Not yet created |
| 6 | CreateBooking | — | Not yet created |
| 7 | ConfirmBooking | — | Not yet created |
| 8 | Post-Booking Operations | — | Not yet created |
| 9 | SeatLock | — | Not yet created |
| 10 | Notifications | — | Not yet created (deferrable) |

**Acceptance criteria applied to ALL endpoint stories:**

- Forward `x-correlation-id` header through 12go API calls and include in structured events
- Map `price_type` correctly (12go `price_restriction` integer → client enum `{Max, Min, Exact, Recommended}`)
- Emit structured JSON event (e.g., `search.completed`, `booking.created`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call

---

## 1. Spike: Q2 Open Decisions

**Type**: Spike
**Owner**: Shauly / Soso (facilitate), Product / Eyal / Eliran (decide)

Resolve all open decisions that block or influence Q2 implementation. Each is a subtask/checklist item:

- **Itinerary ID format** — 12go native vs KLV-encoded. Metadata (search time, pax count) is currently embedded and used for events. Deferred from Mar 25 meeting. Needs decision before search goes to production.
- **Confirm product approval: use 12go native IDs** — Eyal flagged as product decision, "not set in stone."
- **Static data response format** — Keep TC shape or adopt 12go native format? Avikhai leans toward preserving TC format.
- **Static data ownership** — Soso or catalog team? Eliran to discuss with catalog. If catalog takes it, Soso's scope shrinks to 7 endpoints. Must enter someone's Q2 sprint.
- **Ticket PDF branding** — 12go logo vs client branding. Currently using 12go ticket as-is. Product decision.
- **Notification architecture** — Approach A (extend webhook table) / B (in-process F3) / C (keep .NET). Can defer entire feature but decision on approach is useful early.

---

## 2. Foundation: Client Identity & B2B Module Setup

**Owner**: Soso
**Prerequisite for**: Any endpoint that needs client-specific behavior (metrics, logging, notifications, webhook routing)

Create the B2B infrastructure within F3:

**Acceptance Criteria:**

- Create separate B2B DB migration schema (like `trip_pool`, `pass_pool` — Sana confirmed feasible Mar 23). First time we need persistent storage, this schema is required. Initially needed for client identity, later for notifications.
- Create client identity storage — either new `b2b_clients` table in B2B schema OR add columns to existing `usr` table. Maps human-readable `client_id` ↔ 12go `usr_id`. Decision on which approach is part of Spike #1 implicitly.
- Implement API key → client resolution middleware: read `x-api-key` header (already in search POC PR), resolve to `client_id` for use in metrics/logs/tracing.
- Shauly wants meaningful string client names (not just 12go numeric agent ID).

**Context from meeting**: Eyal argued to keep `client_id` in URL for future impersonation/log visibility. Avikhai agreed. Don't validate client_id↔API key correspondence yet — add validation later (like David's middleware in TC).

---

## 3. Static Data (Stations, Operators, POIs)

**Owner**: Soso or Catalog team (blocked on Spike #1 ownership decision)
**Prerequisite**: Spike #1 (ownership + format decisions)

Implement master data endpoints for new clients.

**Acceptance Criteria:**

- `GET /v1/{client_id}/stations` — direct DB read from 12go tables, response shape transformation + localization
- `GET /v1/{client_id}/operating_carriers` — multi-transport operator splitting
- `GET /v1/{client_id}/pois` — POI-to-station mapping
- Decide S3 dump mechanism vs paginated HTTP response (current TC uses S3 pre-signed URLs for megabytes of data — Eyal explained the flow)
- All use 12go native IDs (no Fuji mapping for Q2)

**Notes**: Shauly questioned POI endpoint ("I'm not familiar with it"). Eyal suggested catalog team should own stations/operators. Design is ready (tables, TC contract mapping) but if catalog team has bigger vision they'd redo it.

---

## 5. GetItinerary (Booking Schema)

**Owner**: Soso + PHP buddy
**Prerequisite**: Foundation (#2 for client context), Search (#4 for itinerary IDs)
**Biggest technical risk in Q2.**

Implement GetItinerary endpoint including the booking schema parser — the most complex piece of the transition.

**Acceptance Criteria:**

- Call chain: `GET /trip/{tripId}` → `POST /cart` (add to cart) → `GET /checkout/{cartId}` (get schema)
- Port booking schema parser from C# to PHP (~1,180 lines of bracket-notation form field parsing). Use fixture-driven approach with 4 test fixtures extracted from .NET test data.
- **Explore Eyal's alternative**: instead of translating 12go's JSON API response, consider writing a dedicated F3 method that queries the database (or internal services) directly to build the booking schema in the desired format — avoiding the ~1,180-line transformation entirely. Not guaranteed to be simpler, but worth investigating before committing to the translation approach.
- Store parsed checkout schema and booking state in Redis (for cross-request state between GetItinerary and CreateBooking — PHP-FPM is per-request)
- Handle itinerary ID prefix branching logic
- Cancellation policy: basic `full_refund_until` for Q2. Structured policy later — placeholder, may require enrichment.

**Context**: Eyal argued booking flow is fundamentally different from search — "not just calling the same things in different names." The cart model (add to cart → checkout) doesn't exist in TC's API. Shauly overruled scope expansion but endorsed exploration.

---

## 6. CreateBooking

**Owner**: Soso
**Prerequisite**: GetItinerary (#5 — schema parser and Redis state)

**Acceptance Criteria:**

- Reconstruct bracket-notation keys from stored schema → assemble 12go `/reserve` request body
- Call `POST /reserve/{bookingId}`
- Use 12go native booking ID (decided in Mar 25 meeting — Shauly, Eyal, Eliran agreed)
- Handle timeout → async fallback: if reserve exceeds timeout threshold, spin up background job (F3 in-process pattern, Sana confirmed), write result to DB, return incomplete results ID for polling
- Implement incomplete results polling endpoint (`GET /incomplete_results/{id}`) as part of this story

---

## 7. ConfirmBooking

**Owner**: Soso
**Prerequisite**: CreateBooking (#6)

**Acceptance Criteria:**

- Call `POST /confirm/{bookingId}`
- Same timeout → async fallback pattern as CreateBooking (reuse background job infrastructure from #6)
- No local persistence — 12go is source of truth

---

## 8. Post-Booking Operations

**Owner**: Soso
**Prerequisite**: Booking ID format (decided: 12go native)

Group of 3 lower-complexity endpoints.

**Acceptance Criteria:**

- **GetBookingDetails** — `GET /booking/{bid}` from 12go at runtime. No local persistence. Transform to TC response format.
- **GetTicket** — extract ticket URL from booking details. Return 12go's URL directly. If URL stability is a concern (see discovery), fallback: download and re-upload to S3.
- **CancelBooking** — two-step: `GET /booking/{bid}/refund-options` then `POST /booking/{bid}/refund`. Use 12go's `refund_amount` directly (aligns with Vlad's revenue changes).
- Verify 12go ticket URL stability and expiration (does URL persist long enough for clients?)

---

## 9. SeatLock

**Owner**: Soso
**Lowest priority — after complete booking funnel.**

**Acceptance Criteria:**

- Implement `POST /lock_seats` using 12go's seat lock endpoint
- 12go deploying native lock (David implementing TC→12go connection). By the time Soso reaches this, should be available.
- Eliran cautioned: "Just to make sure we're not doing some temporary solution for a solution that will be solved anyway." Validate before implementing.

---

## 10. Notifications (Deferrable)

**Owner**: TBD (Soso or offload to another developer)
**Can be deferred** — Shauly: "Clients usually don't understand until deeply invested in production that they want this feature."

**Acceptance Criteria:**

- Architecture decision (Approach A/B/C — see Spike #1)
- Booking ID → client mapping for webhook routing (12go doesn't send client ID in notifications)
- Transform 12go notification format → TC client contract format
- Webhook delivery to client URLs
- Investigate: does 12go support HMAC webhook signing? Currently unauthenticated. Source: `current-state/cross-cutting/authentication.md`.

---

## Dependencies on Other Teams

### 11. Search: Define Recheck/206 Behavior

**Owner**: Search team + Product (Avikhai, Eyal)
**Blocks**: Search production readiness (indirectly)

Product decision on how B2B search should handle data freshness. Eyal: automatic rechecks could hit 12go rate limits and affect B2C. Syncer may be more natural for B2B. Eliran/Avikhai agreed: "search needs to handle this."

### 12. Define 206/Recheck Best Practice for B2B Clients

**Owner**: Avikhai

BookAway rechecks after 100ms and only once — "does nothing basically." FerryScanner also has issues. Need documented guidance for B2B clients on correct 206/recheck usage.

### 13. DNS/URL Routing Investigation

**Owner**: Tal (DevOps)

How to route tc-api domain to 12go infrastructure during migration. Options: DNS remapping, v2 path prefix, per-client routing. Also: confirm whether app-level feature flag or AWS API Gateway is the routing mechanism for per-client migration. Gateway can't natively route by path parameter value.

### 14. Kafka Event Investigation

**Owner**: Data team (TBD)

Determine: (a) what events 12go already emits for booking funnel, (b) what TC events data team actually consumes, (c) target schema for unified events. Eliran pushed for unified approach — one set of events serving both TC and 12go. Audit which teams/services consume our Kafka topics (`ReservationConfirmationSucceeded`, `ReservationChanged` may have external consumers). Source: `current-state/cross-cutting/messaging.md`.



### 15. Monitoring & Metrics Gap Analysis

**Owner**: Shauly (discovery) + Soso (implementation)

Compare TC Grafana dashboards vs 12go Datadog. Inventory which Grafana dashboards and alerting rules are critical for operations. Determine what metrics to preserve, what to drop, and how to bridge `clientId` correlation across systems. Source: `current-state/cross-cutting/monitoring.md`.

---

## Discovery

### 16. Cancellation Policy (Placeholder)

**Owner**: Soso

Unknown scope — may require enrichment as we learn more during implementation. Basic `full_refund_until` handling for Q2. Structured cancellation policy format TBD. Coordinate with TC system (both must serve until migration complete).

---

## Migration Support (Q2 preparation, Q3 execution)

### 17. Draft Existing Client Migration Plan

**Owner**: Soso

Shauly: "We need to have a plan... even just as a draft." Covers: station/operator ID mapping, old booking ID handling, API key transition, DNS routing, notification re-registration. Documentation, not code.

### 19. Client Migration Checklist

**Owner**: Soso / Product

Step-by-step per-client cutover process. What changes: API key? URL? Booking ID format? Station IDs? In what order? No process exists today. Source: `current-state/migration-issues/client-migration-process.md`.

### 20. Pre-Cutover Client Credential Validation Script

**Owner**: Soso

Test each client_id/key mapping against 12go staging before cutover. Prevents data leakage from wrong key assignment. Source: `current-state/migration-issues/api-key-transition.md`.

---

## Testing

### 21. API Contract Validation Suite (Record/Replay)

**Owner**: Soso / QA

Record production responses from old TC system, replay through new B2B endpoints, diff outputs. Critical for contract fidelity before cutover. Source: `current-state/cross-cutting/transition-complexity.md`.

### 22. Extend TC End-to-End Tests for B2B

**Owner**: TBD (QA position vacant)

Shauly: same API, different IDs. QA automation engineer was let go — who picks this up?

### 23. Add B2B Tests to 12go Deployment Pipeline

**Owner**: TBD

Eliran: "Their deploys can also break us." Need tests that run on 12go deploys to verify B2B endpoints still work.

---

## Deferred (tracked for visibility)


| #   | Title                                               | Phase             | Notes                                                       |
| --- | --------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| D1  | Webhook notifications implementation                | Q2 late / Q3      | Deferrable. Story #10 captures it.                          |
| D2  | Existing client migration execution                 | Q3+               | Plan (#17) drafted in Q2.                                   |
| D3  | gRPC search integration                             | Q3+               | One client only.                                            |
| D4  | Formal performance testing                          | Post-Q2           | Shauly: F3 search refactoring may happen first.             |
| D5  | Client API key rotation (existing clients)          | Q3                | Eliran: "Good for security to rotate." ~20-30 clients.      |
| D6  | Export Fuji DynamoDB ID mappings                    | Pre-.NET shutdown | Station/operator/POI mapping. Only source.                  |
| D7  | Export API key inventory from TC                    | Pre-.NET shutdown | AppConfig + Postgres.                                       |
| D8  | Export client identity records                      | Pre-.NET shutdown | From David's service.                                       |
| D9  | Retire redundant Kafka producers (~50+ event types) | Pre-.NET shutdown | Only client notifications remain relevant.                  |
| D10 | Plan BookingCache elimination                       | Pre-.NET shutdown | DynamoDB cache no longer needed if 12go is source of truth. |


---

## Summary


| Category                | Stories | Notes                                                                                                   |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| Spike (decisions)       | 1       | 7 subtask checklist items                                                                               |
| Foundation              | 1       | DB schema + client identity + middleware                                                                |
| Endpoint implementation | 8       | Static data, search, GetItinerary, CreateBooking, ConfirmBooking, post-booking, SeatLock, notifications |
| Dependencies on others  | 4       | Search team, Avikhai, Tal, data team                                                                    |
| Discovery               | 2       | Monitoring, cancellation policy                                                                         |
| Migration support       | 4       | Migration plan, booking ID decoder, checklist, validation script                                        |
| Testing                 | 3       | Contract validation, E2E extension, 12go pipeline                                                       |
| Deferred                | 10      | Tracked for visibility                                                                                  |
| **Total active**        | **~23** | Down from 69                                                                                            |


### Sources:

- 3 meeting transcripts (Mar 25 pre-meeting, Part 1, Part 2/Mar 30)
- Presentation document (`presentation-minified-v2.md`)
- Previous meeting outcomes (Feb 25, Mar 12, Mar 17, Mar 18, Mar 23)
- `current-state/` folder (authentication, data-storage, monitoring, messaging, transition-complexity)
- `design/` folder (decision-map, recommendation, red-team, team-first-developer)

