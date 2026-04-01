# Q2 Implementation Plan: B2B API in F3

**Date** | Mar 25, 2026
**Presenter** | Soso
**Duration** | ~1 hour
**Audience** | Eliran, Shauly, Sana, Eyal

---

## 1. Q2 Scope: What We're Committing To

In Q2, we commit to delivering 10 endpoints (7 booking + 3 master data) with the ability to onboard **new clients only** using 12go native IDs. gRPC is not in scope.


| Committed (Q2)                           | Deferred / Not in Scope                   | Parallel Discovery                |
| ---------------------------------------- | ----------------------------------------- | --------------------------------- |
| 10 endpoints (7 booking + 3 master data) | Webhook notifications (delegate or defer) | Monitoring & metrics unification  |
| New clients only, native 12go IDs        | Existing client migration (Q3+)           | Kafka event inventory & structure |
| Incomplete results (async polling)       | gRPC search integration                   |                                   |
| SeatLock (lowest priority, after funnel) | Performance testing                       |                                   |


---

## 2. Parallel Discovery Workstreams

These two topics run **in parallel** with endpoint development. They don't block Q2 delivery, but need resolution before production hardening.

### Monitoring & Metrics

- The current .NET stack uses Coralogix + Grafana + OpenTelemetry. 12go uses Datadog DogStatsD + GELF + MongoDB API logs (to be verified).
- Required dimensions for B2B: client, operator, action, outcome, bookingId, itineraryId, traceId.
- **Key gap**: there is no `clientId` correlation across systems today. The .NET middleware propagates `client_id` via `IConnectContextAccessor` into all traces and metrics. 12go has `agent_id` / `agent_name` from the API key, but no equivalent concept.
- **Output**: a decision on which metrics to preserve and how to implement them in F3's Datadog stack.

### Kafka Events

- We need to determine exactly which events must be preserved and what their structure should look like.
- This requires involvement from the data team or Eyal -- limited information available right now.
- Discovery runs in parallel with development.

---

## 3. What We Learned from the Search POC

### Local Development Environment

- Setting up F3 locally took over a week -- 16+ distinct migration issues. To be fair, some of these problems could have been caused by mistakes on my side -- I'm new to this codebase and the PHP ecosystem.
- I'm not the only one who struggled: Chai told me he also spent a lot of time meddling in the database manually, though he eventually resolved it with `12go make db` and `12go import-dump`.
- In my case, Sana tried to help but couldn't resolve the issues. Then Yehor stepped in -- he also hit the same problems. He ended up creating a custom branch with a fix in the import-dump script (I'm assuming this was a temporary fix) and gave me updated instructions. After ~2 more days of debugging with Yehor's fixes, the trips table was generated. However, I still needed to manually insert price data into the DB to make search return results.
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
- **Not yet merged** -- deployment pipeline is now understood: merge to master -> auto-deploy to Canary (`recheck10.canary.12go.com`) -> verify -> ask Sana to deploy to production. No AWS API Gateway changes needed for new B2B endpoints.

### PHP Buddy Sessions

- Based on the above experience, I proposed having a dedicated PHP developer for regular pairing sessions.
- Schedule: 2x/week for the first 2 weeks -> 1x/week for a month -> as-needed after that.

---

## 4. Per-Endpoint Challenges and Approach

> Approaches below are *presumptive* -- they reflect our current understanding and may pivot as implementation reveals new constraints.

### 4.1 Static Data (Stations, Operators, POIs)


| Endpoint      | What It Does                                                      | 12go Calls                          | Key Challenge                                | Difficulty |
| ------------- | ----------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- | ---------- |
| **Stations**  | Returns all stations with names, coordinates, transport type      | Direct DB read (F3 is the monolith) | Response shape transformation + localization | Low        |
| **Operators** | Returns all carriers with logos, vehicle classes, transport types | Direct DB read                      | Multi-transport operator splitting           | Low        |
| **POIs**      | Returns provinces/regions with associated station lists           | Direct DB read + join               | POI-to-station mapping computation           | Low        |


All three endpoints read from 12go's own database -- no external HTTP calls needed.

**Challenge: Station IDs** (Difficulty: Low for Q2)

Two completely separate ID namespaces exist: Fuji CMS IDs (8-char alphanumeric like `ILTLVTLV`) used by all existing clients, and 12go native integer IDs. 12go has zero knowledge of Fuji CMS IDs.

**Presumptive approach**: Q2 scope = new clients only. New clients use 12go native IDs directly -- no mapping table needed. For future existing client migration: two options (a) maintain a Fuji-to-12go mapping table on our side, populated from Fuji DynamoDB export, or (b) tell clients to change their IDs. The mapping table approach should be designed during Q2 even if implementation is deferred, because Fuji DynamoDB tables may become unavailable when .NET services are decommissioned.

---

### 4.2 Search


| Endpoint               | What It Does                                          | 12go Calls                         | Key Challenge                            | Difficulty |
| ---------------------- | ----------------------------------------------------- | ---------------------------------- | ---------------------------------------- | ---------- |
| **Search Itineraries** | Finds available trips between two locations on a date | `GET /search/{from}p/{to}p/{date}` | Recheck mechanism not implemented in POC | High       |


**Challenge: Recheck Mechanism** (Difficulty: High)

The POC search controller detects recheck URLs and sets 206 status but never invokes the recheck URLs. Without calling them: trip_pool stays stale, prices remain approximate, 206 loops infinitely, and new routes are never populated. This is a known gap in the current TC system as well -- Shauly confirmed: "I think that it's not good enough."

**Presumptive approach**: Implement recheck invocation in the B2B search controller. Two options: (a) synchronous inline recheck using F3's existing `Rechecker::recheckByUrls()` with Guzzle parallel promises (correct but adds latency), or (b) fire-and-forget after response (fast but stale on first search). Note: recheck may also require a background job approach similar to incomplete results (see below).

**Challenge: ID Mappings for Search** (Difficulty: Low for Q2)

Search requests and responses carry station IDs, operator IDs, seat class IDs, and vehicle IDs -- all needing translation between Fuji CMS and 12go namespaces. With Q2 scoped to new clients only, all IDs pass through as 12go native integers. The POI-to-province resolution, seat class mapping, and operator ID mapping all simplify to direct pass-through.

**Presumptive approach**: No mapping layer for Q2. For future existing-client support, the recommendation calls for APCu (per-worker persistent cache) + MariaDB fallback for the search hot path.

**Challenge: Itinerary ID Format** (Difficulty: Medium)

Search returns a `SearchItineraryId` for each result -- the client passes this back to GetItinerary to start the booking funnel. This is not a simple integer: it's a composite struct (`ContractCode`, `IntegrationId`, `IntegrationProductId`, `Seats`, `SearchTime`, `TraceId`) serialized using KLV (Key-Length-Value) encoding, then optionally obfuscated with a Caesar cipher (shift 547) and URL-encoded. The current system applies the Caesar cipher by default; only specific clients configured as "plain" skip it and receive the raw KLV string. Additionally, itinerary IDs starting with a specific prefix trigger a completely different API call sequence in the booking funnel.

**Open question**: Shauly raised (Mar 12) whether the itinerary ID should carry the same Caesar cipher obfuscation in the new system, alongside the booking token. Decision deferred -- needs validation with Sana.

**Presumptive approach**: For Q2 (new clients only), we need to decide: (a) pass through 12go's native trip identifier directly (simplest, but changes the contract shape), or (b) construct our own composite itinerary ID with KLV encoding (preserves the current contract shape for future client migration). Either way, no Caesar cipher for Q2. The internal-prefix branching logic needs to be understood and preserved in the PHP implementation.

---

### 4.3 Booking Funnel (GetItinerary -> CreateBooking -> ConfirmBooking)


| Endpoint               | What It Does                                                           | 12go Calls                                                             | Key Challenge                                       | Difficulty |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------- |
| **GetItinerary**       | Fetches trip details, pricing, seat layout, booking schema             | `GET /trip-details` -> `POST /add-to-cart` -> `GET /checkout/{cartId}` | Booking schema parser (~1,180 lines)                | High       |
| **CreateBooking**      | Submits passenger data to reserve a booking                            | `POST /reserve/{bookingId}` -> `GET /booking/{BId}`                    | Reserve request assembly (reverse of schema parser) | High       |
| **ConfirmBooking**     | Finalizes the reservation with the supplier                            | `POST /confirm/{bookingId}` -> `GET /booking/{bookingId}`              | Timeout handling, no-persistence design             | Medium     |
| **Incomplete Results** | Async polling for slow CreateBooking/ConfirmBooking responses          | Background job writes to DB; client polls                              | Background jobs in PHP are unexplored territory     | Medium     |
| **SeatLock**           | Optional pre-selection of specific seats (no actual lock on 12go side) | `GET /checkout/{cartId}`                                               | Race condition until 12go ships native lock         | Low        |


**Challenge: Itinerary ID Determines Code Path** (Difficulty: Medium)

The itinerary ID received from Search is not just a lookup key -- its format determines which API call sequence GetItinerary follows. IDs starting with a specific internal prefix trigger a different flow (`POST /add-to-cart` with different body -> `GET /cart-details` -> `GET /trip-details`) compared to the standard path. Both paths must be implemented. See the Itinerary ID Format challenge in Search (section 4.2) for the broader format and encryption discussion.

**Challenge: Booking Schema Parser** (Difficulty: High)

~1,180 lines of parsing logic for dynamic bracket-notation form fields from 12go's `/checkout/{cartId}` endpoint. Keys embed trip-specific cart IDs that change per booking (e.g., `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`). Four categories of dynamic keys must be parsed, a normalized schema must be built, field name mappings must be stored in Redis across HTTP request boundaries, and later the original bracket-notation keys must be reconstructed for the `/reserve` POST body. Single biggest technical risk in the entire migration.

**Presumptive approach**: Port using fixture-driven approach -- extract 4 existing C# test fixtures (3 real checkout payloads + 1 synthetic), use them as the spec for the PHP implementation. AI-assisted translation from C# to PHP. PHP has a natural advantage: 12go's PHP-style regexes can be used directly (no `RegexNormalizer` needed). This is where the PHP buddy is most critical. If not code-complete with passing tests by week 3, reassess timeline.

**Challenge: Booking ID Decision** (Difficulty: Medium)

**For new clients (Q2):** Open question -- should new bookings use the raw 12go `bid` (integer) or an encrypted/obfuscated ID? Raw `bid` is simplest but leaks booking volume. Needs decision from Sana + Shauly before booking endpoint implementation begins.

**For existing clients (post-Q2):** When we start migrating existing clients, we need to handle their old booking IDs for post-booking operations (GetBookingDetails, GetTicket, CancelBooking, Notifications). Two ID formats exist: KLV-format IDs contain the 12go `bid` embedded and can be decoded. Short IDs (10-char Base62) are fully opaque -- they require a static mapping table exported from Denali's PostgreSQL `BookingEntities` table. Both populations need handling. However, Shauly assessed (Mar 12 meeting) that by the time the last client migrates, most legacy bookings will have expired naturally. FlixBus is shutting down, DeOniBus is being migrated to 12go -- non-12go booking IDs sunset on their own.

**Presumptive approach**: For Q2, use whatever ID format is decided for new clients. For post-Q2, prepare the Denali export before .NET services are decommissioned. The mapping table is a one-time operation.

**Challenge: Incomplete Results / Background Processing** (Difficulty: Medium)

Currently, incomplete results use an async background job that writes results to the database, with the client continuously polling until processing is complete. This applies to CreateBooking and ConfirmBooking when supplier responses are slow. Sana confirmed (Mar 23) that F3 supports in-process background jobs -- code executes after the HTTP response is sent, in the same PHP-FPM worker thread. This avoids RabbitMQ but ties up the worker, so it's suitable for short tasks only.

**Presumptive approach**: Implement using F3's in-process async pattern (documented in F3 README). For heavy workloads, may need queue-based approach.

**Challenge: Cancellation Policy** (Difficulty: Medium)

There is an upcoming task to expose the full structured cancellation policy in a structured way during GetItinerary -- this will be part of Q2. This change needs to happen in two places: the new B2B module AND within TC (the existing system), since both systems need to serve it until all clients are migrated. The current system only has a simple `full_refund_until` field.

**Presumptive approach**: Coordinate on the structured cancellation policy exposure. Implement it in the new B2B module as part of GetItinerary. For actual refund calculations at cancel time, use 12go's own `refund_amount` from the refund-options API -- no double calculation like Denali does.

---

### 4.4 Post-Booking (GetBookingDetails, GetTicket, CancelBooking)


| Endpoint              | What It Does                                                           | 12go Calls                                                          | Key Challenge                                              | Difficulty |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| **GetBookingDetails** | Returns booking status, stations, price, voucher URL                   | `GET /booking/{bid}`                                                | No local persistence -- runtime API call replaces DB read  | Low        |
| **GetTicket**         | Returns a URL to the ticket PDF                                        | `GET /booking/{bid}` (same endpoint, extract `ticket_url`)          | Determine if 12go's ticket URL is stable and long-lived    | Medium     |
| **CancelBooking**     | Two-step cancel: fetch refund options (with hash), then execute refund | `GET /booking/{bid}/refund-options` -> `POST /booking/{bid}/refund` | Use 12go's `refund_amount` directly, no double calculation | Low        |


Note: all three endpoints are affected by the Booking ID transition problem described in 4.3 -- for existing clients (post-Q2), old booking IDs must be resolved to 12go `bid` values.

---

### 4.5 Notifications


| Endpoint          | What It Does                                                    | 12go Calls                      | Key Challenge                                              | Difficulty |
| ----------------- | --------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- | ---------- |
| **Notifications** | Receives booking status webhooks from 12go, forwards to clients | Inbound webhook (12go calls us) | Multiple possible architectures; requires further analysis | High       |


**How it works today:**

12go sends a webhook (`POST /v1/notifications/OneTwo Go`) with `{ "bid": <long> }` to BookingNotificationService. That service publishes a Kafka event (`SupplierReservationChanged`). PostBookingService consumes the Kafka event, looks up the booking in PostgreSQL to find the `client_id`, re-fetches the current booking status from 12go's API (`GET /booking/{bid}`), updates the local DB, and publishes a downstream `ReservationChanged` Kafka event. A separate downstream service (likely Carmel) subscribes and handles outbound delivery to clients.

The current system also discards everything from the webhook payload except the `bid` -- it re-fetches the full booking state from the 12go API instead of trusting the webhook data.

**Key problem: booking ID -> client association.** When a webhook arrives with just a `bid`, the system must determine which B2B client this booking belongs to. Currently this is done via DB lookup in `BookingEntities` table. In the new no-persistence design, we need an alternative -- either pass `client_id` in the webhook URL, or maintain a lightweight booking->client mapping.

**Challenge: Architecture Decision** (Difficulty: High)

This feature requires more analysis. Three approaches are being considered:

**Approach A -- Extend existing webhook subscriber table.** *(recommended)* Register new B2B clients in 12go's existing webhook subscriber table (the one Shauly showed on Mar 12 -- URL, user ID, API key per subscriber). 12go already knows which booking belongs to which client, so the `bid -> client_id` association comes for free. Configure the webhook URL per client to point to our B2B module (e.g., `?client_id=bookaway`), which transforms the payload to TC format and forwards to the client's registered webhook URL. Lightweight: no Kafka, no DB lookup, no re-fetching from 12go API -- just receive, transform, forward.

**Approach B -- In-process subscription in F3.** Subscribe to the booking event within F3 (via in-memory event bus or whatever mechanism F3 uses internally). Maintain a separate B2B webhook configuration table. Handle transformation and outbound delivery within the F3 process.

**Approach C -- Sustain the existing .NET notification pipeline.** Keep the current BookingNotificationService + PostBookingService + Kafka + PostgreSQL chain running. The existing path already transforms 12go's `{ "bid" }` into a client-facing notification: 12go sends webhook -> BookingNotificationService publishes Kafka event -> PostBookingService consumes it, looks up booking in PostgreSQL to find `client_id`, re-fetches from 12go API, updates local DB, publishes downstream `ReservationChanged` Kafka event -> a downstream service (likely Carmel, not in our repos) delivers to the client. B2B clients would be plugged into this existing chain.

Problems with Approach C:

- Contradicts the no-persistence design -- the pipeline depends on the `BookingEntities` PostgreSQL table for `bid -> client_id` lookup, which we're eliminating
- Does far more than needed -- two Kafka hops, a DB lookup, a re-fetch from 12go API, and a DB update, when all we need is receive-transform-forward
- Ties us to keeping the full .NET stack running (BookingNotificationService, PostBookingService, Kafka, PostgreSQL) just for notifications
- Carmel (the outbound delivery service) is a black box -- no code in our repos, unknown how it resolves client webhook URLs
- Adds maintenance burden on infrastructure we're trying to decommission

Each approach has different implications for: where client webhook URLs are stored, how booking->client association is resolved, whether we need new Kafka consumers, and how much new code is required.

**Presumptive approach**: Approach A is the simplest path -- it leverages 12go's existing per-client webhook routing with minimal new code. Needs further validation with Sana on how to hook into 12go's webhook subscriber table. Potentially offloadable to another developer -- Shauly is open to it depending on estimation. Core post-booking operations (GetBookingDetails, GetTicket, CancelBooking) work without notifications -- clients can poll GetBookingDetails as a fallback.

---

## 5. Client Identity & Authentication

### Current State: TC vs F3

**TC system**: `client_id` is a human-readable string (e.g., "bookaway") sent by the client in every URL path (`/v1/{client_id}/bookings`). It's used for routing, metrics/logging, per-client configuration, and Kafka event correlation. The API key (`x-api-key` header) is validated separately at the AWS API Gateway level.

**12go F3**: Clients are users in the `usr` table (`usr_id` integer) with role `partner` or `partner_light`. API keys live in the `apikey` table linked by `usr_id`. The `ApiAgent` service resolves API key -> user, exposing `getId()`, `getName()`, `getRole()`. There is no equivalent of TC's `client_id` anywhere in F3 -- only the numeric `usr_id` and `usr_name` (agent name, not suitable for this purpose). We will need to store a human-readable client identifier somewhere: either add a field to the existing `usr` table, or maintain a separate B2B lookup table that associates `usr_id` with a `client_id`.

### The Problem

The `client_id` in the URL is redundant -- we should be able to determine the client's identity from their API key. Requiring clients to self-identify adds no security (if the API key is compromised, the `client_id` is too) and adds friction to the API surface. But F3 has no client alias concept today, so we need to introduce one for metrics, logs, and tracing.

### Proposal: Drop `client_id` from URL, Derive from API Key

**This is not a blocker** -- it's an improvement to the API surface. Either way, we need a client_id-to-API-key correspondence stored in the database, and we resolve the client identity on every request. The only question is whether the client also sends it in the URL.

When a client authenticates via `x-api-key` header (or `?k=` query param), F3 already resolves this to a `usr_id` via the `apikey` table. We propose:

1. **Remove `client_id` from all B2B endpoint URLs.** Endpoints become `/v1/itineraries`, `/v1/bookings`, etc.
2. **Derive client identity from the API key.** On authentication, look up the client record associated with this API key.
3. **Assign a human-readable alias** (e.g., "bookaway") to each client during onboarding. This alias is used in metrics, logs, and tracing -- replacing the current `client_id` path parameter for observability purposes. This is needed because F3's numeric `usr_id` or agent name alone isn't sufficient for meaningful metrics.

### Draft: `b2b_clients` Table

> This is a draft -- the final shape depends on decisions around notifications and other features.

Create a `b2b_clients` table in the B2B migration schema (following the same separate-schema pattern proposed for other B2B tables):


| Field            | Type        | Purpose                                                                                      |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `client_id`      | string (PK) | Human-readable alias, e.g., "bookaway"                                                       |
| `name`           | string      | Full company name                                                                            |
| `enabled`        | bool        | Active flag                                                                                  |
| `api_key_usr_id` | FK to `usr` | Links to F3's API key / user                                                                 |
| `webhook_url`    | string?     | Notification delivery URL *(may not be needed here -- depends on notification architecture)* |
| `created_at`     | timestamp   |                                                                                              |


**Cross-cutting impact**: This decision affects metrics/logging, Kafka events, notifications (booking->client association), and the URL structure of every endpoint.

---

## 6. Existing Client Migration (Q3+)

> Assumption: Q2 is complete -- 10 endpoints work for new clients using 12go native IDs. This section covers what it takes to move existing B2B clients onto the new system.

### 6.1 What Changes for Each Client


| Change                       | Client Action                                                   | Our Action                                                   |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| **New base URL**             | Update endpoint config                                          | Provide URL + docs                                           |
| **New API key**              | Adopt 12go API key (Shauly's preferred approach)                | Provision key in 12go                                        |
| **Station/Operator/POI IDs** | Either re-fetch master data (new IDs) or use mapping we provide | Build mapping table in F3 from Fuji DynamoDB export          |
| **Existing bookings**        | Nothing -- old system stays up for post-booking ops             | Keep old system running (post-booking only, no new bookings) |
| **Notifications**            | Confirm webhook URL                                             | Re-register in new system                                    |


**Key message**: For most clients, migration = new URL + new API key + re-fetch station list. That's it. Rollout is per-client (not big-bang): internal/test first, then low-volume cooperative clients, then high-volume last.

### 6.2 The Three Hard Problems

**Problem 1: Station/Operator/POI IDs**

Two completely separate ID namespaces: Fuji CMS IDs (8-char like `ILTLVTLV`) vs 12go integer IDs. 12go has zero knowledge of Fuji IDs.


|               | Option A: We provide mapping                          | Option B: Clients re-fetch master data  |
| ------------- | ----------------------------------------------------- | --------------------------------------- |
| Client effort | Zero -- transparent translation                       | Medium -- update IDs in their system    |
| Our effort    | Build + cache mapping table from Fuji DynamoDB export | Minimal -- just expose new station list |
| Risk          | Mapping may have gaps; adds per-request latency       | Some clients may take weeks/months      |


**Recommendation (hybrid):** Build the mapping table regardless -- it's a safety net, and the data must be exported from Fuji DynamoDB before .NET decommission anyway. Encourage clients to adopt 12go native IDs on their own timeline. Fast movers switch directly; slow movers use the mapping layer temporarily.

**Problem 2: Existing Bookings (Post-Booking Operations)**

Bookings created before cutover have TC booking IDs (KLV-encoded or short Base62 format) that the new system doesn't understand.

Two approaches:

- **Option A: Keep old .NET system running** for post-booking operations only (GetBookingDetails, GetTicket, CancelBooking, Notifications). No new bookings go through it. As existing bookings expire naturally, traffic to the old system drops to zero and it can be decommissioned. Avoids building mapping tables or decoding IDs. Mitigating factors: most legacy bookings expire within weeks; FlixBus is shutting down; DeOniBus is migrating to 12go -- non-12go booking IDs sunset on their own.
- **Option B: Export a booking ID mapping table** from TC's Denali PostgreSQL (`BookingEntities` table: TC booking ID -> 12go `bid`). Add translation logic to post-booking endpoints and notifications in the new system. Allows full .NET shutdown sooner, but adds implementation work. Note: KLV-format IDs are decodable (12go `bid` is embedded in key position 04), but short Base62 IDs are fully opaque and require the DB export -- no other recovery path exists.

**Problem 3: API Key Transition**

~20-30 active client IDs. Per-client 12go API keys already exist (scattered across 3 config stores). Two approaches:

- **Option A: Clients do the transition.** Each client gets a new 12go API key provisioned during onboarding and updates their integration to use it. Shauly's preferred approach -- simple, clean, but requires client cooperation.
- **Option B: Mapping table in F3.** Maintain a table that maps old TC API keys to new 12go API keys. Clients keep using their existing keys; the B2B module translates on every request. No client changes needed, but adds a translation layer we need to maintain.

### 6.3 Data to Export Before .NET Shutdown

.NET decommission is not yet scheduled -- no rush. But before eventually shutting down each piece, we will need to export:

- **Station/Operator/POI ID mappings** from Fuji DynamoDB -- only source of Fuji CMS <-> 12go integer ID relationships
- **API key inventory** from AppConfig (x2) + Postgres -- to know which 12go key each client uses
- **Client identity records** from David's `client-identity` Postgres -- to preserve client metadata

> Full migration strategy analysis available in `design/archive/migration-strategy-2026-02-20/` for reference.

---

## 7. Help Needed


| What                            | Impact If Missing                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| PHP buddy sessions              | Timeline extends; higher risk of delivering features slower without PHP expertise backing |
| QA resource                     | Bugs caught later, integration testing falls on me alone                                  |
| Webhook notifications offload   | Clients can't receive push updates                                                        |
| Kafka event spec (which events) | No visibility into clients onboarded on the new system until spec is delivered            |
| Monitoring/metrics discovery    | We fly blind on what to preserve; production alerts may break silently                    |


---

## 8. Open Items from Part 1 (Mar 25, Sections 1--4.2)

> These came up during the first half of the presentation. Captured here for tracking -- some may need decisions before implementation proceeds.

### 8.1 Stations & Static Data -- Ownership & Implementation

Eyal suggested stations/operators should be the catalog team's responsibility: "this is something which I think it's more suitable for the catalog." Eliran agreed: "the responsibility or the ownership should be on teams because it's like something that is very catalog oriented."

- **Unresolved**: Does the catalog team take this into their Q2 plan? If we want to onboard new clients by end of Q2, this needs to be in someone's sprint. Soso has the design ready (knows which tables, how to map to TC contracts), but if catalog has a bigger vision, they'd redo it.
- **Sub-question**: Do we keep the S3 dump mechanism or switch to paginated HTTP / streaming? Eyal said "it's not a major issue" either way -- product decision.

### 8.2 Rechecks in Search -- Ownership & Approach

This was the longest discussion. Key tension: the current TC recheck behavior (fire-and-forget call to 12go on 206) may not scale for all B2B clients -- Eyal warned it could hit 12go's rate limits and affect B2C. Eyal's view: the syncer is a more natural component to handle B2B freshness, rather than every B2B search triggering a recheck to integrations. Avihai agreed: "we need to discuss how we improve it on the 12go side" -- this is "deep in the kishka of search." Eliran concluded: "it's probably search needs to handle this."

- **Unresolved**: (a) Product decision on how we want B2B search to behave re: freshness, (b) whether search team implements the recheck/syncer optimization or Soso replicates current TC behavior as a stopgap.

### 8.3 BI Events -- Unified Solution for 12go & TC

Eliran raised whether we can send one set of booking events that serves both TC and 12go, rather than building TC-specific events that get replaced later. Eyal confirmed TC events describe the full funnel (search -> confirm), not just transactions. 12go uses different tooling (not BigQuery). Shauly: "maybe it's already being [done on 12go side]. I don't know." Eliran's suggestion: investigate what 12go already has before building anything -- "the BI/data track needs further investigation."

- **Unresolved**: Who investigates what 12go already emits? What's the target schema? This is the "parallel discovery" workstream -- no owner assigned yet.

### 8.4 Other Items Touched On

- **Incomplete Results** -- Avihai confirmed we must keep this (clients depend on it). Timeout values (15s? 20s?) are configuration, but the mechanism must exist.
- **Itinerary ID format** -- Taken offline ("let's take it off now" -- Avihai). Still needs a decision.
- **Contract changes for static data** -- Do we keep TC format or adopt 12go format? Avihai leaned toward "do as much as we can to not change things on the client side." Not decided.

---

## Appendix: Full Endpoint-Challenge Matrix


| Endpoint               | Group          | 12go Calls                                                             | Key Challenge                                                                          | Proposed Approach                                                                                  | Difficulty |
| ---------------------- | -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| **Stations**           | Static Data    | Direct DB read (inside F3)                                             | Response shape transformation + S3 export pattern                                      | Expose 12go native data in TC format, cache aggressively                                           | Low        |
| **Operators**          | Static Data    | Direct DB read (inside F3)                                             | Multi-transport operator splitting                                                     | Same pattern as stations                                                                           | Low        |
| **POIs**               | Static Data    | Direct DB read + join                                                  | POI-to-station mapping computation                                                     | Query stations by province; need to verify DB schema for best join strategy                        | Low        |
| **Search Itineraries** | Search         | `GET /search/{from}p/{to}p/{date}`                                     | Recheck mechanism not implemented; itinerary ID format decision pending                | Implement recheck invocation (sync or fire-and-forget); use 12go native itinerary ID format for Q2 | High       |
| **Incomplete Results** | Booking Funnel | In-process event bus (F3 background job pattern)                       | Async fallback for slow CreateBooking/ConfirmBooking                                   | F3 in-process async (no RabbitMQ)                                                                  | Medium     |
| **GetItinerary**       | Booking Funnel | `GET /trip-details` -> `POST /add-to-cart` -> `GET /checkout/{cartId}` | Booking schema parser (~1,180 lines); itinerary ID prefix determines API call sequence | Fixture-driven port from C# to PHP; handle both internal and standard itinerary paths              | High       |
| **CreateBooking**      | Booking Funnel | `POST /reserve/{bookingId}` -> `GET /booking/{BId}`                    | Reserve request assembly (bracket-notation reconstruction)                             | Port using same test fixtures as schema parser                                                     | High       |
| **ConfirmBooking**     | Booking Funnel | `POST /confirm/{bookingId}` -> `GET /booking/{bookingId}`              | Timeout handling; async 202 fallback uses incomplete results pattern                   | 12go as source of truth; incomplete results if confirm slow                                        | Medium     |
| **SeatLock**           | Booking Funnel | `GET /checkout/{cartId}`                                               | Race condition until native lock is shipped                                            | Expected to be developed on 12go side by implementation time                                       | Low        |
| **GetBookingDetails**  | Post-Booking   | `GET /booking/{bid}`                                                   | Runtime API call replaces local DB read; booking ID resolution                         | Call 12go at runtime, map response to TC format                                                    | Medium     |
| **GetTicket**          | Post-Booking   | `GET /booking/{bid}`                                                   | Ticket URL stability unknown; booking ID resolution                                    | Use 12go's `ticket_url` directly if stable; else re-host                                           | Medium     |
| **CancelBooking**      | Post-Booking   | `GET /refund-options` -> `POST /refund`                                | Use 12go's `refund_amount` directly, no double calculation                             | Relay refund amount from 12go; structured cancellation policy covers the rest                      | Medium     |
| **Notifications**      | Notifications  | Inbound webhook from 12go                                              | Push topology, no outbound delivery exists, 12go must add HMAC signing                 | Defer or offload to another developer                                                              | High       |


