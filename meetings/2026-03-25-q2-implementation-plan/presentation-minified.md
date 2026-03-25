# Q2 Implementation Plan: B2B API in F3

**Mar 25, 2026** | Soso | ~1 hour
**Audience**: Eliran, Shauly, Sana, Eyal

---

## 1. Search POC Learnings

### Local Environment

- F3 setup took over a week -- 16+ migration issues, ~2 more days after Yehor stepped in with fixes
- Root cause: one failed migration in 2024 silently broke all subsequent runs
- Now working and documented
- **B2B idea**: separate DB migration schema (like `finance_rw`, `trip_pool`) -- Sana confirmed feasible

### Code & CI/CD

- AI-assisted coding worked well for the simple search case
- Complex endpoints (booking schema parser) will need PHP buddy validation
- F3 pipeline has AI code reviewer + coverage gates -- good safety net
- Deployment path understood: merge → Canary → verify → production

### PHP Buddy

- Schedule: 2x/week (2 weeks) → 1x/week (1 month) → as-needed

---

## 2. Endpoint Overview

> All approaches are *presumptive* -- may pivot during implementation.

### 2.1 Static Data

| Endpoint      | Key Challenge                  | Difficulty |
| ------------- | ------------------------------ | ---------- |
| **Stations**  | Response shape + localization  | Low        |
| **Operators** | Multi-transport splitting      | Low        |
| **POIs**      | POI-to-station mapping         | Low        |

All direct DB reads inside F3. Q2 = new clients only, native 12go IDs.

---

### 2.2 Search

| Endpoint               | Key Challenge                            | Difficulty |
| ---------------------- | ---------------------------------------- | ---------- |
| **Search Itineraries** | Recheck mechanism not implemented in POC | High       |

**Recheck** -- POC detects recheck URLs but never invokes them. Without it: stale prices, infinite 206 loops. Options: sync recheck (correct but slow) or fire-and-forget (fast but stale first time).

**Itinerary ID** -- composite KLV-encoded struct with optional Caesar cipher. Q2: use 12go native ID, no cipher. Internal-prefix branching logic must be preserved.

---

### 2.3 Booking Funnel

| Endpoint               | Key Challenge                                   | Difficulty |
| ---------------------- | ----------------------------------------------- | ---------- |
| **GetItinerary**       | Booking schema parser (~1,180 lines)            | High       |
| **CreateBooking**      | Reserve request assembly (reverse of parser)    | High       |
| **ConfirmBooking**     | Timeout handling, no-persistence design         | Medium     |
| **Incomplete Results** | Async fallback for slow Create/Confirm          | Medium     |
| **SeatLock**           | Race condition until 12go ships native lock     | Low        |

**Biggest risk: Booking Schema Parser**
- ~1,180 lines parsing dynamic bracket-notation form fields
- Keys embed trip-specific cart IDs that change per booking
- Must parse, normalize, store in Redis, then reconstruct for `/reserve`
- **Approach**: fixture-driven port from C# to PHP using 4 test fixtures
- If not code-complete by week 6 (May 9) → reassess timeline

**Booking ID**: open question -- raw `bid` (simple, leaks volume) vs obfuscated? Needs decision before implementation.

**Cancellation Policy**: new structured format needed in both B2B module and TC. Use 12go's `refund_amount` directly.

---

### 2.4 Post-Booking

| Endpoint              | Key Challenge                         | Difficulty |
| --------------------- | ------------------------------------- | ---------- |
| **GetBookingDetails** | Runtime API call replaces DB read     | Medium     |
| **GetTicket**         | Ticket URL stability unknown          | Medium     |
| **CancelBooking**     | Use 12go's `refund_amount` directly   | Medium     |

---

### 2.5 Notifications

| Endpoint          | Key Challenge                          | Difficulty |
| ----------------- | -------------------------------------- | ---------- |
| **Notifications** | Architecture undecided, needs analysis | High       |

Three approaches under consideration (extend webhook table / in-process F3 / reuse existing path). **Defer or offload to another developer.** Clients can poll GetBookingDetails as fallback.

---

## 3. Timeline

### 13 calendar weeks. 11 working weeks. 10 endpoints.

| Week  | Dates          | Deliverable                                               | Gate                                    |
| ----- | -------------- | --------------------------------------------------------- | --------------------------------------- |
| 1     | Mar 23-27      | F3 env, B2B scaffold, merge Search POC, recheck decision  | Search merged                           |
| 2-3   | Mar 30 - Apr 8 | Stations, Operators, POIs                                 | Station list correct                    |
| --    | **Apr 9-19**   | **Vacation**                                              | --                                      |
| 4-6   | Apr 21 - May 9 | **GetItinerary + parser + CreateBooking + ConfirmBooking** | E2E booking on staging                  |
| 7-8   | May 12-23      | GetBookingDetails + GetTicket + CancelBooking             | Post-booking tested                     |
| 9-10  | May 26 - Jun 6 | Shadow traffic, integration testing, bug fixing           | Search responses match current system   |
| 11-12 | Jun 9-20       | First client onboarding, monitoring, hardening            | Client completes full flow              |

**May 9 is the checkpoint.** Booking funnel done = on track. Not done = adjust before it's too late.

---

### Committed vs. Deferred

| Committed (Q2)                           | Deferred                                  |
| ---------------------------------------- | ----------------------------------------- |
| 10 endpoints (7 booking + 3 master data) | Webhook notifications (delegate or defer) |
| New clients only, native 12go IDs        | Existing client migration (Q3+)           |
| Kafka events (if spec by week 6)         | gRPC search integration                   |
| SeatLock (lowest priority)               | Incomplete results / polling              |
|                                          | Performance testing                       |

---

### Early Warning Signals

| Signal                | Threshold            | Action                            |
| --------------------- | -------------------- | --------------------------------- |
| F3 environment        | > 2 days in week 1   | Escalate for PHP support          |
| Booking schema parser | Not done by May 9    | Reassess timeline, scope cut      |
| GetItinerary overall  | > 5 working days     | Reassess PHP learning curve       |

---

## 4. Help Needed

| What                                 | Impact If Missing                                        |
| ------------------------------------ | -------------------------------------------------------- |
| PHP buddy sessions                   | Timeline extends, higher delivery risk                   |
| QA resource                          | Bugs caught later, integration testing falls on me alone |
| Webhook notifications offload        | Clients can't receive push updates                       |
| Kafka event spec                     | No visibility into new system adoption                   |
| Incomplete results scope decision    | Slow bookings may time out without async fallback        |
| Monitoring/metrics discovery         | Fly blind on production alerts                           |
