# Q2 Implementation Plan: B2B API in F3

**Date** | Mar 25, 2026
**Presenter** | Soso
**Duration** | ~1 hour
**Audience** | Eliran, Shauly, Sana, Eyal

---

## 1. What We Learned from the Search POC

### Local Development Environment

- Setting up F3 locally took ~2 days of debugging -- 16+ distinct migration issues. To be fair, some of these problems could have been caused by mistakes on my side -- I'm new to this codebase and the PHP ecosystem.
- I'm not the only one who struggled: Chai told me he also spent a lot of time meddling in the database manually, though he eventually resolved it with `12go make db` and `12go import-dump`.
- In my case, Sana tried to help but couldn't resolve the issues. Then Yehor stepped in -- he also hit the same problems. He ended up creating a custom branch with a fix in the import-dump script (I'm assuming this was a temporary fix) and gave me updated instructions. This time we got further -- the trips table was generated. However, I still needed to manually insert price data into the DB to make search return results.
- Root cause: a single migration failure (`SUPPLY-41` in 2024) silently left the DB partially migrated. The date cache (`.db_last_date`) then caused all future `make db` runs to skip the broken migrations. This accumulated 2 years of cascading damage.
- **Shauly's counterpoint**: Even if we had chosen a separate microservice, we would still need the F3 local environment for any feature that touches both B2B and core modules (like cancellation policies). The pain of setting it up is front-loaded but unavoidable.
- The local env is now working and documented -- future setup should be faster with the documented fixes.
- **Idea for B2B**: Use a separate DB migration schema for B2B-specific tables, following the same pattern as `finance_rw`, `trip_pool`, etc. Sana confirmed (Mar 23) this is feasible and common practice. The advantage: B2B migrations are isolated from years of F3 migration history -- new developers don't need the full migration chain to work on B2B tables. Cross-schema JOINs with existing F3 tables (stations, operators, etc.) are still fully possible since all "schemas" are organizational migration folders targeting the same `12go` database. That said, if we do JOIN core tables, we take on a dependency on those schemas -- so the less we rely on them, the cleaner the boundary. The data we're likely to store in B2B tables is fairly independent:
  - **Fuji-to-12go ID mapping** (stations, operators) -- for existing client migration (post-Q2)
  - **Client webhook configuration** -- URLs, HMAC keys, retry policies per B2B client
  - **Booking-to-client association** -- lightweight mapping for notification routing

### Code Writing Experience

- AI (Claude Code) understood the task well: which F3 services to call, how to map response models, how to structure the controller. I validated the code at a glance and it looked correct.
- **However**: this was the "easy case" -- a stateless search endpoint calling one internal service with simple model mapping. There was no new DB migration, no new SQL query, no background job processing, no reflection or metaprogramming.
- For more complex endpoints (especially the booking schema parser), I would not be able to validate AI-generated code by myself. This is where the PHP buddy becomes critical.
- Unit tests worked as expected.

### CI/CD Pipeline

- F3's pipeline includes an automatic AI code reviewer and quality gates that prevent unit test coverage from decreasing.
- These caught issues in my PR and forced me to refine it -- this is a good safety net.
- Sana approved the changes.
- **Not yet merged** -- deployment pipeline is now understood: merge to master → auto-deploy to Canary (`recheck10.canary.12go.com`) → verify → ask Sana to deploy to production. No AWS API Gateway changes needed for new B2B endpoints.

### PHP Buddy Sessions

- Based on the above experience, I proposed having a dedicated PHP developer for regular pairing sessions.
- **Approved by Shauly**: 2x/week for the first 2 weeks -> 1x/week for a month -> as-needed after that.
- Person not yet assigned.

---

## 2. Per-Endpoint Challenges and Approach

> Approaches below are *presumptive* -- they reflect our current understanding and may pivot as implementation reveals new constraints.

### 2.1 Static Data (Stations, Operators, POIs)


| Endpoint      | What It Does                                                      | 12go Calls                            | Key Challenge                                | Risk Level |
| ------------- | ----------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- | ---------- |
| **Stations**  | Returns all stations with names, coordinates, transport type      | Direct DB read (F3 is the monolith)   | Response shape transformation + localization | Low        |
| **Operators** | Returns all carriers with logos, vehicle classes, transport types | Direct DB read                        | Multi-transport operator splitting           | Low        |
| **POIs**      | Returns provinces/regions with associated station lists           | Direct DB read + join on `ProvinceId` | POI-to-station mapping computation           | Medium     |


All three endpoints read from 12go's own database -- no external HTTP calls needed.

**Challenge: Station IDs** (Risk: Low for Q2)

Two completely separate ID namespaces exist: Fuji CMS IDs (8-char alphanumeric like `ILTLVTLV`) used by all existing clients, and 12go native integer IDs. 12go has zero knowledge of Fuji CMS IDs.

**Presumptive approach**: Q2 scope = new clients only. New clients use 12go native IDs directly -- no mapping table needed. For future existing client migration: two options (a) maintain a Fuji-to-12go mapping table on our side, populated from Fuji DynamoDB export, or (b) tell clients to change their IDs. The mapping table approach should be designed during Q2 even if implementation is deferred, because Fuji DynamoDB tables may become unavailable when .NET services are decommissioned.



---

### 2.2 Search


| Endpoint               | What It Does                                          | 12go Calls                                | Key Challenge                                   | Risk Level |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ---------- |
| **Search Itineraries** | Finds available trips between two locations on a date | `GET /search/{from}p/{to}p/{date}`        | Recheck mechanism not implemented in POC        | High       |
| **Incomplete Results** | Async polling for slow supplier responses             | Background job writes to DB; client polls | Background jobs in PHP are unexplored territory | Medium     |


**Challenge: Recheck Mechanism** (Risk: High)

The POC search controller detects recheck URLs and sets 206 status but never invokes the recheck URLs. Without calling them: trip_pool stays stale, prices remain approximate, 206 loops infinitely, and new routes are never populated. This is a known gap in the current TC system as well -- Shauly confirmed: "I think that it's not good enough."

**Presumptive approach**: Implement recheck invocation in the B2B search controller. Two options: (a) synchronous inline recheck using F3's existing `Rechecker::recheckByUrls()` with Guzzle parallel promises (correct but adds latency), or (b) fire-and-forget after response (fast but stale on first search). Note: recheck may also require a background job approach similar to incomplete results (see below).



**Challenge: Incomplete Results / Background Processing** (Risk: Medium)

Currently, incomplete results use an async background job that writes results to the database, with the client continuously polling until processing is complete. Sana confirmed (Mar 23) that F3 supports in-process background jobs -- code executes after the HTTP response is sent, in the same PHP-FPM worker thread. This avoids RabbitMQ but ties up the worker, so it's suitable for short tasks only.

**Presumptive approach**: Skip this feature for Q2. If needed later, use F3's in-process async pattern (documented in F3 README). For heavy workloads, may need queue-based approach. Revisit if client feedback requires it.



**Challenge: ID Mappings for Search** (Risk: Low for Q2)

Search requests and responses carry station IDs, operator IDs, seat class IDs, and vehicle IDs -- all needing translation between Fuji CMS and 12go namespaces. With Q2 scoped to new clients only, all IDs pass through as 12go native integers. The POI-to-province resolution, seat class mapping, and operator ID mapping all simplify to direct pass-through.

**Presumptive approach**: No mapping layer for Q2. For future existing-client support, the recommendation calls for APCu (per-worker persistent cache) + MariaDB fallback for the search hot path.



**Challenge: Itinerary ID Format** (Risk: Medium)

Search returns a `SearchItineraryId` for each result -- the client passes this back to GetItinerary to start the booking funnel. This is not a simple integer: it's a composite struct (`ContractCode`, `IntegrationId`, `IntegrationProductId`, `Seats`, `SearchTime`, `TraceId`) serialized using KLV (Key-Length-Value) encoding, then optionally obfuscated with a Caesar cipher (shift 547) and URL-encoded. The current system applies the Caesar cipher by default; only specific clients configured as "plain" skip it and receive the raw KLV string. Additionally, itinerary IDs starting with a specific prefix trigger a completely different API call sequence in the booking funnel.

**Open question**: Shauly raised (Mar 12) whether the itinerary ID should carry the same Caesar cipher obfuscation in the new system, alongside the booking token. Decision deferred -- needs validation with Sana.

**Presumptive approach**: For Q2 (new clients only), we need to decide: (a) pass through 12go's native trip identifier directly (simplest, but changes the contract shape), or (b) construct our own composite itinerary ID with KLV encoding (preserves the current contract shape for future client migration). Either way, no Caesar cipher for Q2. The internal-prefix branching logic needs to be understood and preserved in the PHP implementation.



---

### 2.3 Booking Funnel (GetItinerary -> CreateBooking -> ConfirmBooking)


| Endpoint           | What It Does                                                           | 12go Calls                                                             | Key Challenge                                       | Risk Level |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------- |
| **GetItinerary**   | Fetches trip details, pricing, seat layout, booking schema             | `GET /trip-details` -> `POST /add-to-cart` -> `GET /checkout/{cartId}` | Booking schema parser (~1,180 lines)                | High       |
| **CreateBooking**  | Submits passenger data to reserve a booking                            | `POST /reserve/{bookingId}` -> `GET /booking/{BId}`                    | Reserve request assembly (reverse of schema parser) | High       |
| **ConfirmBooking** | Finalizes the reservation with the supplier                            | `POST /confirm/{bookingId}` -> `GET /booking/{bookingId}`              | Timeout handling, no-persistence design             | Medium     |
| **SeatLock**       | Optional pre-selection of specific seats (no actual lock on 12go side) | `GET /checkout/{cartId}`                                               | Race condition until 12go ships native lock         | Low        |


**Challenge: Itinerary ID Determines Code Path** (Risk: Medium)

The itinerary ID received from Search is not just a lookup key -- its format determines which API call sequence GetItinerary follows. IDs starting with a specific internal prefix trigger a different flow (`POST /add-to-cart` with different body -> `GET /cart-details` -> `GET /trip-details`) compared to the standard path. Both paths must be implemented. See the Itinerary ID Format challenge in Search (section 2.2) for the broader format and encryption discussion.



**Challenge: Booking Schema Parser** (Risk: High)

~1,180 lines of parsing logic for dynamic bracket-notation form fields from 12go's `/checkout/{cartId}` endpoint. Keys embed trip-specific cart IDs that change per booking (e.g., `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`). Four categories of dynamic keys must be parsed, a normalized schema must be built, field name mappings must be stored in Redis across HTTP request boundaries, and later the original bracket-notation keys must be reconstructed for the `/reserve` POST body. Single biggest technical risk in the entire migration.

**Presumptive approach**: Port using fixture-driven approach -- extract 4 existing C# test fixtures (3 real checkout payloads + 1 synthetic), use them as the spec for the PHP implementation. AI-assisted translation from C# to PHP. PHP has a natural advantage: 12go's PHP-style regexes can be used directly (no `RegexNormalizer` needed). This is where the PHP buddy is most critical. If not code-complete with passing tests by week 3, reassess timeline.



**Challenge: Booking ID Decision** (Risk: Medium)

**For new clients (Q2):** Open question -- should new bookings use the raw 12go `bid` (integer) or an encrypted/obfuscated ID? Raw `bid` is simplest but leaks booking volume. Needs decision from Sana + Shauly before booking endpoint implementation begins.

**For existing clients (post-Q2):** When we start migrating existing clients, we need to handle their old booking IDs for post-booking operations (GetBookingDetails, GetTicket, CancelBooking, Notifications). Two ID formats exist: KLV-format IDs contain the 12go `bid` embedded and can be decoded. Short IDs (10-char Base62) are fully opaque -- they require a static mapping table exported from Denali's PostgreSQL `BookingEntities` table. Both populations need handling. However, Shauly assessed (Mar 12 meeting) that by the time the last client migrates, most legacy bookings will have expired naturally. FlixBus is shutting down, DeOniBus is being migrated to 12go -- non-12go booking IDs sunset on their own.

**Presumptive approach**: For Q2, use whatever ID format is decided for new clients. For post-Q2, prepare the Denali export before .NET services are decommissioned. The mapping table is a one-time operation.



**Challenge: Cancellation Policy** (Risk: Medium)

There is an upcoming task to expose the full structured cancellation policy in a structured way during GetItinerary -- this will be part of Q2. This change needs to happen in two places: the new B2B module AND within TC (the existing system), since both systems need to serve it until all clients are migrated. The current system only has a simple `full_refund_until` field.

**Presumptive approach**: Coordinate with 12go on the structured cancellation policy exposure. Implement it in the new B2B module as part of GetItinerary. For actual refund calculations at cancel time, use 12go's own `refund_amount` from the refund-options API -- no double calculation like Denali does.



---

### 2.4 Post-Booking (GetBookingDetails, GetTicket, CancelBooking)


| Endpoint              | What It Does                                                           | 12go Calls                                                          | Key Challenge                                             | Risk Level |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| **GetBookingDetails** | Returns booking status, stations, price, voucher URL                   | `GET /booking/{bid}`                                                | No local persistence -- runtime API call replaces DB read | Medium     |
| **GetTicket**         | Returns a URL to the ticket PDF                                        | `GET /booking/{bid}` (same endpoint, extract `ticket_url`)          | Determine if 12go's ticket URL is stable and long-lived   | Medium     |
| **CancelBooking**     | Two-step cancel: fetch refund options (with hash), then execute refund | `GET /booking/{bid}/refund-options` -> `POST /booking/{bid}/refund` | Two-step atomicity, hash expiration between steps         | High       |


Note: all three endpoints are affected by the Booking ID transition problem described in 2.3 -- for existing clients (post-Q2), old booking IDs must be resolved to 12go `bid` values.

**Challenge: Cancellation Two-Step Flow** (Risk: High)

Cancellation requires fetching refund options (which return a time-limited hash), then executing the refund with that hash. If the process fails between steps, the booking is in an inconsistent state. Unlike Denali, we will NOT do double refund calculation -- we use 12go's `refund_amount` directly. Once the structured cancellation policy work is done on 12go's side (see 2.3), this should be straightforward: 12go handles the policy, we just relay the refund amount to the client.

**Presumptive approach**: Use 12go's `refund_amount` directly. Implement retry on the `POST /refund` step with hash re-fetch on expiration.



---

### 2.5 Notifications


| Endpoint          | What It Does                                                    | 12go Calls                      | Key Challenge                                              | Risk Level |
| ----------------- | --------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- | ---------- |
| **Notifications** | Receives booking status webhooks from 12go, forwards to clients | Inbound webhook (12go calls us) | Multiple possible architectures; requires further analysis | High       |


**How it works today:**

12go sends a webhook (`POST /v1/notifications/OneTwo Go`) with `{ "bid": <long> }` to BookingNotificationService. That service publishes a Kafka event (`SupplierReservationChanged`). PostBookingService consumes the Kafka event, looks up the booking in PostgreSQL to find the `client_id`, re-fetches the current booking status from 12go's API (`GET /booking/{bid}`), updates the local DB, and publishes a downstream `ReservationChanged` Kafka event. A separate downstream service (likely Carmel) subscribes and handles outbound delivery to clients.

The current system also discards everything from the webhook payload except the `bid` -- it re-fetches the full booking state from the 12go API instead of trusting the webhook data.

**Key problem: booking ID → client association.** When a webhook arrives with just a `bid`, the system must determine which B2B client this booking belongs to. Currently this is done via DB lookup in `BookingEntities` table. In the new no-persistence design, we need an alternative -- either pass `client_id` in the webhook URL, or maintain a lightweight booking→client mapping.

**Challenge: Architecture Decision** (Risk: High)

This feature requires more analysis. Three approaches are being considered:

**Approach A — Extend existing webhook subscriber table.** Register new B2B clients in 12go's existing webhook subscriber table. Distinguish B2B clients from regular ones. When a notification arrives, check if it's a B2B booking and transform the payload to TC format before forwarding to the client's registered webhook URL.

**Approach B — In-process subscription in F3.** Subscribe to the booking event within F3 (via in-memory event bus or whatever mechanism F3 uses internally). Maintain a separate B2B webhook configuration table. Handle transformation and outbound delivery within the F3 process.

**Approach C — Leverage the existing 12go→TC webhook path.** 12go already sends TC-format notifications via webhook, and we currently do the transformation on our side. Could we reuse or adapt this existing path for B2B clients? This would mean the transformation layer already exists -- we'd just need to route it correctly.

Each approach has different implications for: where client webhook URLs are stored, how booking→client association is resolved, whether we need new Kafka consumers, and how much new code is required.

**Presumptive approach**: This needs more digestion before committing to an architecture. Potentially offloadable to another developer -- Shauly is open to it depending on estimation. Core post-booking operations (GetBookingDetails, GetTicket, CancelBooking) work without notifications -- clients can poll GetBookingDetails as a fallback.



---

## 3. Timeline and Task Breakdown

### 13 calendar weeks. 11 working weeks. 10 endpoints.


| Week  | Dates          | Deliverable                                                                      | Gate                                                          |
| ----- | -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | Mar 23-27      | F3 env stable, B2B module scaffold, merge Search POC, decide on recheck approach | Search merged, recheck decision documented                    |
| 2-3   | Mar 30 - Apr 8 | Master data (Stations, Operators, POIs)                                          | Station list returns correct B2B format                       |
| —     | **Apr 9-19**   | **Vacation**                                                                     | —                                                             |
| 4-6   | Apr 21 - May 9 | **GetItinerary + booking schema parser + CreateBooking + ConfirmBooking**        | Parser tests pass against C# fixtures; E2E booking on staging |
| 7-8   | May 12-23      | GetBookingDetails + GetTicket + CancelBooking                                    | Post-booking ops tested                                       |
| 9-10  | May 26 - Jun 6 | Shadow traffic, integration testing, bug fixing                                  | Search responses match current system                         |
| 11-12 | Jun 9-20       | First client onboarding, monitoring, hardening                                   | Client completes full flow                                    |


### Committed vs. Deferred


| Committed (Q2)                           | Deferred / Not in Scope                   |
| ---------------------------------------- | ----------------------------------------- |
| 10 endpoints (7 booking + 3 master data) | Webhook notifications (delegate or defer) |
| New clients only, native 12go IDs        | Existing client migration (Q3+)           |
| Kafka events (if spec arrives by week 6) | gRPC search integration                   |
| SeatLock (lowest priority, after funnel) | Incomplete results / polling endpoint     |
|                                          | Performance testing                       |


### Early Warning Signals


| Signal                | Threshold                           | Action                             |
| --------------------- | ----------------------------------- | ---------------------------------- |
| F3 environment        | > 2 days friction in week 1         | Escalate for hands-on PHP support  |
| Booking schema parser | Not code-complete by week 6 (May 9) | Reassess timeline; scope reduction |
| GetItinerary overall  | > 5 working days                    | Reassess PHP learning curve        |


**May 9 is the checkpoint.** If the booking funnel (parser + CreateBooking + ConfirmBooking) is done by week 6, we're on track. If not, we adjust before it's too late — not after.

---

## 4. Dependencies and Help Needed


| What                                            | Impact If Not Resolved                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PHP buddy sessions                              | Timeline extends; higher risk of delivering features slower without PHP expertise backing                |
| QA resource                                     | Timeline extends; bugs caught later, integration testing falls on me alone                               |
| Webhook notifications — offload to someone      | Clients can't receive push updates                                                                       |
| Kafka event spec (which events, what data)      | No visibility into clients onboarded on the new system until spec is delivered                           |
| Incomplete results — scope + technical approach | If needed for Q2, requires background job pattern decision; if deferred, some searches return stale data |
| Monitoring/metrics discovery                    | We fly blind on what to preserve; production alerts may break silently                                   |


---

## Appendix: Full Endpoint-Challenge Matrix


| Endpoint               | Group          | 12go Calls                                                             | Key Challenge                                                                          | Proposed Approach                                                                                  | Risk   | Priority             |
| ---------------------- | -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| **Stations**           | Static Data    | Direct DB read (inside F3)                                             | Response shape transformation + S3 export pattern                                      | Expose 12go native data in TC format, cache aggressively                                           | Low    | Weeks 2-3            |
| **Operators**          | Static Data    | Direct DB read (inside F3)                                             | Multi-transport operator splitting                                                     | Same pattern as stations                                                                           | Low    | Weeks 2-3            |
| **POIs**               | Static Data    | Direct DB read + join                                                  | POI-to-station mapping computation                                                     | Join on `ProvinceId` FK instead of string matching                                                 | Medium | Weeks 2-3            |
| **Search Itineraries** | Search         | `GET /search/{from}p/{to}p/{date}`                                     | Recheck mechanism not implemented; itinerary ID format decision pending                | Implement recheck invocation (sync or fire-and-forget); use 12go native itinerary ID format for Q2 | High   | Week 1 (POC merge)   |
| **Incomplete Results** | Booking Funnel | In-process event bus (F3 background job pattern)                       | Async fallback for slow CreateBooking/ConfirmBooking; scope undecided                  | F3 in-process async (no RabbitMQ); scope decision needed                                           | Medium | Needs decision       |
| **GetItinerary**       | Booking Funnel | `GET /trip-details` -> `POST /add-to-cart` -> `GET /checkout/{cartId}` | Booking schema parser (~1,180 lines); itinerary ID prefix determines API call sequence | Fixture-driven port from C# to PHP; handle both internal and standard itinerary paths              | High   | Weeks 4-6            |
| **CreateBooking**      | Booking Funnel | `POST /reserve/{bookingId}` -> `GET /booking/{BId}`                    | Reserve request assembly (bracket-notation reconstruction)                             | Port using same test fixtures as schema parser                                                     | High   | Weeks 4-6            |
| **ConfirmBooking**     | Booking Funnel | `POST /confirm/{bookingId}` -> `GET /booking/{bookingId}`              | Timeout handling; async 202 fallback uses incomplete results pattern                   | 12go as source of truth; incomplete results if confirm slow                                        | Medium | Weeks 4-6            |
| **SeatLock**           | Booking Funnel | `GET /checkout/{cartId}`                                               | Race condition until native lock is shipped                                            | Expected to be developed on 12go side by implementation time                                       | Low    | After booking funnel |
| **GetBookingDetails**  | Post-Booking   | `GET /booking/{bid}`                                                   | Runtime API call replaces local DB read; booking ID resolution                         | Call 12go at runtime, map response to TC format                                                    | Medium | Weeks 7-8            |
| **GetTicket**          | Post-Booking   | `GET /booking/{bid}`                                                   | Ticket URL stability unknown; booking ID resolution                                    | Use 12go's `ticket_url` directly if stable; else re-host                                           | Medium | Weeks 7-8            |
| **CancelBooking**      | Post-Booking   | `GET /refund-options` -> `POST /refund`                                | Two-step atomicity, hash expiration                                                    | Use 12go's refund amount directly, retry with hash re-fetch                                        | High   | Weeks 7-8            |
| **Notifications**      | Notifications  | Inbound webhook from 12go                                              | Push topology, no outbound delivery exists, 12go must add HMAC signing                 | Defer or offload to another developer                                                              | High   | Offload / defer      |


