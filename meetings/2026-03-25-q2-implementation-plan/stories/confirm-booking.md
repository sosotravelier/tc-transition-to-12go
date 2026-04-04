# ConfirmBooking

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- CreateBooking (#6) — produces the booking ID and Redis booking reference needed by this endpoint

**Blocks**: GetBookingDetails (#8) — same status mapping and response contract

---

## Description

Implement the ConfirmBooking endpoint that takes a booking ID from a prior CreateBooking (reserve) step, confirms the reservation via F3's internal services, retrieves the final booking details (price, status, ticket URL), and returns the confirmed booking to the client.

### Internal F3 Service Calls (Not HTTP)

Since B2B lives inside the F3 monolith, the confirmation flow uses **in-process calls to internal F3 services** — not HTTP calls to 12go's external API. The `TwelveGoClientInterface` wraps calls to internal F3 services (e.g., `BookingProcessor`, `BookingConfirmManager`, etc.). The exact services to call will be identified during implementation (consult Sana/Valeri), but the logical operations are:

1. **Confirm** — Call F3's internal confirmation service (the same logic that `POST /confirm/{bookingId}` ultimately executes). Returns a confirmation result.
2. **Get booking details** — Call F3's internal booking details service (the same logic behind `GET /booking/{BId}`). Returns final price, status, and ticket URL.

The external HTTP endpoints are documented in our endpoint specs as reference for *what the operations do*, but we call the underlying PHP services directly, not the HTTP layer.

### What's Simplified vs TC

TC today runs a complex flow: decrypt booking ID, fetch BookingCacheModel from DynamoDB, check not already confirmed, check credit line, call confirm through SI Framework + Etna HTTP hop, call get booking details, map status, calculate confirm price with two-phase repricing, update DynamoDB, persist full BookingEntity to PostgreSQL, and publish 4 Kafka events.

F3 simplifies this to: decode booking ID, fetch lightweight booking reference from Redis, call internal confirm service, call internal booking details service, map status, apply markup, emit one structured log event, and return.

---

## Acceptance Criteria

### Input & ID Handling

- [ ] Accept `POST /v{version}/{client_id}/bookings/{booking_id}/confirm` matching TC contract
- [ ] Decode `booking_id` (use 12go native booking ID, per Mar 25 decision — no Caesar cipher encryption/decryption)
- [ ] Fetch booking reference from Redis (`b2b:booking:{bookingId}`): cartId, status, price, clientId. Return **404** if not found (booking expired or never created)

### Confirm (In-Process F3 Service Call)

- [ ] Verify booking is not already confirmed (check status in Redis booking reference). Return **409** if already confirmed
- [ ] Call F3's internal confirmation service (via `TwelveGoClientInterface`) with the booking ID — this is an in-process PHP call, not an HTTP call
- [ ] On confirmation success, call F3's internal booking details service to get final price, booking status, and ticket URL
- [ ] Apply markup to the final price if per-client markup is configured
- [ ] **Implementation note**: Identify the exact F3 services to call (e.g., `BookingProcessor::confirmBooking()`, `BookingDetailsManager`) with Sana/Valeri during implementation

### Status Mapping

- [ ] Map 12go booking status to TC contract enum:

  | 12go status | TC status |
  |---|---|
  | `confirmed` | `approved` |
  | `pending` | `pending` |
  | `ConfirmationProcessingIncomplete` | `pending` |
  | Other/unknown | `pending` |

- [ ] Handle `ConfirmationProcessingIncomplete` gracefully — map to `pending` and update Redis with interim status (see Open Questions)

### Response

- [ ] Return `200 OK` with TC `Booking` contract:
  ```
  {
    id: 12go booking ID (native, per Mar 25 decision),
    status: mapped status (12go -> TC enum),
    from_station: string,
    to_station: string,
    departure_time: ISO 8601,
    passenger_count: integer,
    integration: string,
    integration_booking_id: string,
    operator_booking_id: tracker from booking details,
    voucher_url: ticket URL from booking details,
    total_price: { amount, currency },
    created_at: ISO 8601,
    updated_at: ISO 8601
  }
  ```
- [ ] `voucher_url` comes from the booking details response (`ticketUrl` field) — pass through 12go's URL directly (per Avikhai Mar 25: "This is what we get today. We don't do anything.")

### State Persistence

- [ ] Update Redis booking reference (`b2b:booking:{bookingId}`, TTL 24h) with: confirmed status, final price, voucher URL
- [ ] **No DynamoDB, no PostgreSQL** — 12go is source of truth (stateless architecture, per Mar 12 decision)

### Error Handling

- [ ] **400** — Malformed request (unparseable booking_id, missing required headers)
- [ ] **401** — Unauthorized (invalid or missing API key)
- [ ] **404** — Booking not found in Redis (expired or never created — client must re-reserve)
- [ ] **409** — Already confirmed (`AlreadyConfirmedException` equivalent — booking status is already `confirmed` in Redis)
- [ ] **422** — Unprocessable (cost mismatch, credit exceeded if credit line is implemented)
- [ ] **500** — Unexpected errors from F3 internal services (log full context, return meaningful message to client)
- [ ] Map F3 internal error responses to client-friendly format

---

## Technical Notes

### Architecture (3-Layer)

```
Handler (Controller)
  ├─ Decode booking_id
  ├─ Fetch booking reference from Redis
  ├─ Check not already confirmed
  └─ Build response

Mapper (BookingMapper service)
  ├─ Map 12go status → TC enum
  ├─ Apply markup to final price
  └─ Map booking details → TC Booking contract

12go Client (TwelveGoClientInterface — in-process, NOT HTTP)
  ├─ confirm(bookingId) → confirmation result  (calls internal F3 confirmation service)
  └─ getBookingDetails(bookingId) → price, status, ticketUrl  (calls internal F3 service)
```

### What's Eliminated vs TC

| TC Component | F3 | Notes |
|---|---|---|
| CaesarCipher decrypt | Native 12go booking ID | No encryption/decryption layer |
| DynamoDB BookingCacheModel read | Redis booking reference | Single lightweight lookup |
| DynamoDB ItineraryCache read | Not needed | Confirm doesn't need itinerary details |
| DynamoDB PreBookingCache read | Not needed | Only used for repricing in TC |
| Credit line check | TBD | Discuss if 12go manages billing for new clients |
| Two-phase price calculation | Single price from 12go + markup | Trust 12go's confirmed price |
| PostgreSQL BookingEntity persistence | Not needed | 12go is source of truth (Mar 12 decision) |
| 4 Kafka events | 1 structured log event | `booking.confirmed` for Datadog pipeline |
| SI Framework + Etna HTTP hop | In-process F3 service calls | The core win of building inside F3 |
| 320s total timeout (20s + 300s) | Standard timeout | See Open Questions |
| 6+ feature flags | None (or minimal) | No per-integration toggle complexity |
| Async flow (202 + polling) | Not needed | In-process calls within monolith |

---

## Open Questions (For Grooming)

1. **12go confirm latency** — What is 12go's typical confirm latency? TC has a 320s total timeout (20s + 300s) designed for slow suppliers. If 12go confirms in seconds, a standard PHP timeout is sufficient.
2. **Timeout value** — What should the PHP timeout be for the in-process confirm call? TC's 20s base + 300s additional is extreme. Need to agree on a sensible default.
3. **ConfirmationProcessingIncomplete** — Does 12go's internal confirmation service ever return this status? If not, the entire incomplete-handling branch is dead code for our use case. If yes, what is the expected client behavior — poll GetBookingDetails until status changes?

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Map `price_type` correctly (12go `price_restriction` integer → client enum `{Max, Min, Exact, Recommended}`)
- Emit structured JSON event (`booking.confirmed`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
