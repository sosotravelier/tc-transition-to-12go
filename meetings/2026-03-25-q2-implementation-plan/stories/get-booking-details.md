# GetBookingDetails

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- CreateBooking (#6) — a booking must exist to retrieve details
- ConfirmBooking (#7) — most useful after confirmation (status = approved)

**Blocks**: Nothing directly — this is a read-only endpoint

---

## Description

Implement the GetBookingDetails endpoint that retrieves booking status and details by calling F3's internal booking details service at runtime. Unlike TC (which reads from a local PostgreSQL copy), B2B calls 12go's booking logic in-process and returns the live state — 12go is the source of truth.

### Internal F3 Service Calls (Not HTTP)

Since B2B lives inside the F3 monolith, this endpoint uses **in-process calls to internal F3 services** — not HTTP calls to 12go's external API. The `TwelveGoClientInterface` wraps calls to internal F3 services like `BookingDetailsManager` etc.

The external endpoint `GET /booking/{BId}` is documented in our endpoint specs as reference for *what the operation does*, but we call the underlying PHP service directly, not the HTTP layer.

### What's Different from TC

TC today reads booking details from a **local PostgreSQL** table (`BookingEntities`) that was populated at booking creation time. It does NOT call 12go at runtime. This means TC's data can be stale if the booking state changes on 12go's side.

F3 approach: Call the internal booking details service at runtime on every request. This eliminates local persistence entirely and ensures the response always reflects 12go's current state.

### Voucher URL Handling

If `ticket_url` is present in 12go's response and booking status is confirmed, include it as `voucher_url`. If null and status is approved, leave `voucher_url` as null — the client can call GetTicket separately. No lazy ticket fetch (unlike TC's auto-fetch pattern).

---

## Acceptance Criteria

### Input & Routing

- [ ] Accept `GET /v{version}/{client_id}/bookings/{booking_id}` matching TC contract
- [ ] Use 12go native booking ID as `booking_id` (per Mar 25 decision — no encryption/decryption)
- [ ] Validate `client_id` against authenticated client

### Booking Retrieval (In-Process F3 Service Call)

- [ ] Call F3's internal booking details service (via `TwelveGoClientInterface`) — this is an in-process PHP call, not an HTTP call
- [ ] Retrieve booking data including: bid, tracker, status, from_id, to_id, dep_date_time, seats, ticket_url, created_on, seller_price
- [ ] **Implementation note**: Identify the exact F3 service to call (e.g., `BookingDetailsManager`) with Sana/Valeri during implementation

### Response Mapping

- [ ] Return `200 OK` with TC `Booking` contract:
  ```
  {
    id: 12go booking ID (native),
    status: mapped status (12go → TC enum),
    from_station: string (from_id converted),
    to_station: string (to_id converted),
    departure_time: ISO 8601 (parsed from dep_date_time),
    passenger_count: integer (seats),
    integration: "onetwogo",
    integration_booking_id: string,
    operator_booking_id: string (tracker),
    voucher_url: string|null (ticket_url from 12go, or null),
    total_price: { amount: string, currency: string },
    created_at: ISO 8601 (unix timestamp converted),
    updated_at: ISO 8601
  }
  ```
- [ ] Apply markup to `total_price` if per-client markup is configured

### Status Mapping

- [ ] Map 12go booking status to TC contract enum:

  | 12go status | TC status |
  |---|---|
  | `confirmed` | `approved` |
  | `cancelled` | `cancelled` |
  | `pending_client_confirmation` | `reserved` |
  | Other/unknown | `pending` |

### Voucher URL

- [ ] If 12go's response includes a non-empty `ticket_url` and status maps to `approved`, set `voucher_url` to that URL
- [ ] If `ticket_url` is null/empty, set `voucher_url` to null (client calls GetTicket separately if needed)
- [ ] Do NOT implement lazy ticket fetch (unlike TC's auto-fetch when voucher_url is null)

### Error Handling

- [ ] **400** — Malformed request (invalid booking_id format)
- [ ] **401** — Client authentication failure
- [ ] **404** — Booking not found (12go returns no result for the given ID)
- [ ] **500** — Unexpected errors from internal service (log full context, return meaningful message)

---

## Technical Notes

### Architecture (3-Layer)

```
Handler (Controller)
  ├─ Validate request parameters
  ├─ Extract booking_id
  └─ Build response

Mapper (BookingDetailsMapper)
  ├─ Map 12go fields → TC contract fields
  ├─ Convert types (unix→ISO 8601, int→string)
  ├─ Map status enum
  └─ Apply markup if configured

12go Client (TwelveGoClientInterface — in-process, NOT HTTP)
  └─ getBookingDetails(bookingId) → booking data  (calls internal F3 booking service)
```

### What's Eliminated vs TC

| TC Component | F3 | Notes |
|---|---|---|
| PostgreSQL BookingEntities lookup | Eliminated | Call 12go at runtime instead |
| BookingEntity local storage | Eliminated | No local copy of booking data |
| ConditionalCypher encrypt/decrypt | Eliminated | Use 12go native booking ID |
| BookingId composite value object | Eliminated | Simple ID, no ContractCode/IntegrationId composition |
| IntegrationIdEnricher | Eliminated | F3 has its own observability |
| Lazy ticket fetch (GetTicket auto-call) | Eliminated | Client calls GetTicket explicitly |
| PostBookingSiHost.GetBookingDetails | Eliminated | Was already unused in TC (read from DB) |

---

## Open Questions (For Grooming)

1. **Is 12go's `ticket_url` stable and long-lived?** If the URL expires or changes, clients that cached it from a previous GetBookingDetails call may get broken links. Need to verify URL lifetime.
2. **Price field — `seller_price` vs `price` vs `netprice`?** 12go returns multiple price fields. Which one maps to TC's `total_price`? TC used its own stored `net_price` from DB. Need to confirm which 12go field + markup logic to use.
3. **Updated_at semantics** — 12go provides `created_on` but does it provide an updated timestamp? If not, what do we return for `updated_at`?
4. **Station ID format** — 12go returns `from_id`/`to_id` as integers. TC returns them as strings. Confirm simple string conversion is sufficient (no station ID mapping needed).

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Map `price_type` correctly (12go `price_restriction` integer → client enum `{Max, Min, Exact, Recommended}`)
- Emit structured JSON event (`booking.details.retrieved`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
