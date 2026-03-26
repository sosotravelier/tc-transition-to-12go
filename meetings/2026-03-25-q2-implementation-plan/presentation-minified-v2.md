# Q2 Implementation Plan: B2B API in F3

**Mar 25, 2026** | Soso | ~1 hour
**Audience**: Eliran, Shauly, Sana, Eyal

---

## 1. Q2 Scope

In Q2, we commit to 10 endpoints (7 booking + 3 master data) for **new clients only** using 12go native IDs. gRPC is not in scope.


| Committed (Q2)                           | Deferred                                  | Parallel Discovery                |
| ---------------------------------------- | ----------------------------------------- | --------------------------------- |
| 10 endpoints (7 booking + 3 master data) | Webhook notifications (delegate or defer) | Monitoring & metrics unification  |
| New clients only, native 12go IDs        | Existing client migration (Q3+)           | Kafka event inventory & structure |
| Incomplete results (async polling)       | gRPC search integration                   |                                   |
| SeatLock (lowest priority)               | Performance testing                       |                                   |


---

## 2. Parallel Discovery Workstreams

- **Monitoring & Metrics** -- discover what exists on both sides, decide what to keep
- **Kafka Events** -- determine which events to preserve and their structure

---

## 3. Search POC Learnings

### Local Environment

- F3 setup took over a week -- 16+ migration issues, ~2 more days after Yehor stepped in with fixes
- Root cause: one failed migration in 2024 silently broke all subsequent runs
- Now working and documented
- **B2B idea**: separate DB migration schema (like `finance_rw`, `trip_pool`) -- Sana confirmed feasible

### Code & CI/CD

- AI-assisted coding worked well for the simple search case
- Complex endpoints (booking schema parser) will need PHP buddy validation
- F3 pipeline has AI code reviewer + coverage gates -- good safety net
- Deployment path understood: merge -> Canary -> verify -> production

### PHP Buddy

- Schedule: 2x/week (2 weeks) -> 1x/week (1 month) -> as-needed

---

## 4. Endpoint Overview

> All approaches are *presumptive* -- may pivot during implementation.

### 4.1 Static Data


| Endpoint      | Key Challenge                 | Difficulty |
| ------------- | ----------------------------- | ---------- |
| **Stations**  | Response shape + localization | Low        |
| **Operators** | Multi-transport splitting     | Low        |
| **POIs**      | POI-to-station mapping        | Low        |


All direct DB reads inside F3. Q2 = new clients only, native 12go IDs.

---

### 4.2 Search


| Endpoint               | Key Challenge                            | Difficulty |
| ---------------------- | ---------------------------------------- | ---------- |
| **Search Itineraries** | Recheck mechanism not implemented in POC | High       |


**Recheck** -- POC detects recheck URLs but never invokes them. Without it: stale prices, infinite 206 loops. Options: sync recheck (correct but slow) or fire-and-forget (fast but stale first time).

**Itinerary ID** -- composite KLV-encoded struct with optional Caesar cipher. Q2: use 12go native ID, no cipher. Internal-prefix branching logic must be preserved.

---

### 4.3 Booking Funnel


| Endpoint               | Key Challenge                                | Difficulty |
| ---------------------- | -------------------------------------------- | ---------- |
| **GetItinerary**       | Booking schema parser (~1,180 lines)         | High       |
| **CreateBooking**      | Reserve request assembly (reverse of parser) | High       |
| **ConfirmBooking**     | Timeout handling, no-persistence design      | Medium     |
| **Incomplete Results** | Async fallback for slow Create/Confirm       | High       |
| **SeatLock**           | Race condition until 12go ships native lock  | Low        |


**Biggest risk: Booking Schema Parser**

- ~1,180 lines parsing dynamic bracket-notation form fields
- Keys embed trip-specific cart IDs that change per booking
- Must parse, normalize, store in Redis, then reconstruct for `/reserve`
- **Approach**: fixture-driven port from C# to PHP using 4 test fixtures
- If not code-complete by week 6 (May 9) -> reassess timeline

**Booking ID**: open question -- raw `bid` (simple, leaks volume) vs obfuscated? Needs decision before implementation.

**Incomplete Results**: F3 supports in-process background jobs (Sana confirmed Mar 23). Implement using this pattern.

**Cancellation Policy**: new structured format needed in both B2B module and TC. Use 12go's `refund_amount` directly.

---

### 4.4 Post-Booking


| Endpoint              | Key Challenge                       | Difficulty |
| --------------------- | ----------------------------------- | ---------- |
| **GetBookingDetails** | Runtime API call replaces DB read   | Low        |
| **GetTicket**         | Ticket URL stability unknown        | Medium     |
| **CancelBooking**     | Use 12go's `refund_amount` directly | Low        |


---

### 4.5 Notifications


| Endpoint          | Key Challenge                          | Difficulty |
| ----------------- | -------------------------------------- | ---------- |
| **Notifications** | Architecture undecided, needs analysis | High       |


Three approaches under consideration (extend webhook table / in-process F3 / reuse existing path). **Defer or offload to another developer.** Clients can poll GetBookingDetails as fallback.

---

## 5. Client Identity & Authentication *(new section -- draft)*

**Problem**: Clients currently send their own `client_id` in every URL path (`/v1/{client_id}/...`). This is redundant -- we should determine the client from the API key.

**Not a blocker** -- this is an improvement. Either way we need client_id-to-API-key correspondence in the DB.

**Proposal**:

1. Remove `client_id` from all B2B endpoint URLs
2. Derive client identity from the API key (F3 already resolves `apikey` -> `usr_id`)
3. Assign a human-readable alias (e.g., "bookaway") during onboarding for metrics/logs

**Draft**: `b2b_clients` table in B2B migration schema:


| Field                 | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `client_id` (PK)      | Human-readable alias                                           |
| `api_key_usr_id` (FK) | Links to F3 user/apikey                                        |
| `webhook_url`?        | Notification delivery *(depends on notification architecture)* |


---

## 6. Existing Client Migration (Q3+) *(new section -- draft)*

> Assuming Q2 is complete -- 10 endpoints work for new clients. How do we move existing clients?

### What Changes for Each Client


| Change                   | Client Action                       | Our Action                                |
| ------------------------ | ----------------------------------- | ----------------------------------------- |
| **New base URL**         | Update config                       | Provide URL + docs                        |
| **New API key**          | Adopt 12go API key                  | Provision key                             |
| **Station/Operator IDs** | Re-fetch master data or use mapping | Build mapping table from Fuji DynamoDB    |
| **Existing bookings**    | Nothing                             | Keep old system for post-booking ops only |
| **Notifications**        | Confirm webhook URL                 | Re-register                               |


**Key message**: For most clients, migration = new URL + new API key + re-fetch station list. Rollout: internal/test -> low-volume -> high-volume.

### The Three Hard Problems

**1. Station/Operator/POI IDs** -- Fuji CMS IDs (8-char) vs 12go integers. No translation in 12go. **Hybrid approach**: build mapping table (safety net from Fuji DynamoDB export), encourage clients to adopt native IDs on their timeline.

**2. Existing Bookings** -- Pre-cutover bookings have TC booking IDs the new system doesn't understand. **Solution: don't migrate them.** Keep old .NET system running for post-booking operations only (cancel, get ticket, get details). No new bookings go through it. Old bookings expire naturally; old system traffic drops to zero.

**3. API Key Transition** -- ~20-30 active clients. Two approaches: (a) clients adopt 12go API keys directly when they migrate (Shauly's preferred -- simple but requires client cooperation), or (b) mapping table in F3 that translates old TC API keys to 12go keys transparently (no client changes, but adds maintenance).

### Data to Export Before .NET Shutdown

Not yet scheduled -- no rush. But before shutting down each piece:

- Station/Operator/POI ID mappings (Fuji DynamoDB)
- API key inventory (AppConfig + Postgres)
- Client identity records (David's service)

