# CancelBooking

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- CreateBooking (#6) — a booking must exist
- ConfirmBooking (#7) — booking must be confirmed (status = approved) to be cancellable

**Blocks**: Nothing directly

---

## Description

Implement the CancelBooking endpoint that cancels a confirmed booking using 12go's two-step refund flow (get refund options, then execute refund), both via in-process F3 service calls. The refund amount returned to the client comes directly from 12go's refund options — no local refund calculation.

### Internal F3 Service Calls (Not HTTP)

Since B2B lives inside the F3 monolith, both steps of the cancellation flow use **in-process calls to internal F3 services** — not HTTP calls to 12go's external API. The `TwelveGoClientInterface` wraps calls to internal F3 services.

The external endpoints (`GET /booking/{bid}/refund-options` and `POST /booking/{bid}/refund`) are documented in our endpoint specs as reference for *what the operations do*, but we call the underlying PHP services directly, not the HTTP layer.

### What's Different from TC

TC today performs cancellation as a complex multi-service operation:
1. Looks up booking from local PostgreSQL
2. Validates cancellation policies exist locally
3. Calls 12go via SI Framework for the two-step refund
4. Calculates its own refund using `RefundCalculator` with locally stored `CancellationPolicies`, departure time, and timezone
5. Compares its calculated refund with 12go's and logs a warning if they differ
6. Updates PostgreSQL with cancellation data and multiple refund amounts (SI, supplier, client)
7. Publishes 5 Kafka events

F3 approach: Call the internal refund services directly, use 12go's `refund_amount` as the client-facing refund (Vlad's revenue changes align), and emit a single structured log event. No local state, no refund recalculation, no Kafka events.

---

## Acceptance Criteria

### Input & Routing

- [ ] Accept `POST /v{version}/{client_id}/bookings/{booking_id}/cancel` matching TC contract (no request body)
- [ ] Use 12go native booking ID as `booking_id` (per Mar 25 decision — no encryption/decryption)
- [ ] Validate `client_id` against authenticated client

### Pre-Cancellation Validation

- [ ] Call F3's internal booking details service to retrieve current booking status — in-process PHP call, not HTTP
- [ ] Verify booking exists — return **404** if not found
- [ ] Verify booking status is cancellable (maps to `approved`) — return **422 Unprocessable Entity** if not

### Cancellation — Step 1: Get Refund Options (In-Process F3 Service Call)

- [ ] Call F3's internal refund options service (via `TwelveGoClientInterface`) — in-process PHP call, not HTTP
- [ ] If `available == true` and options exist, proceed to step 2
- [ ] If `available == false` or no options, return **422 Unprocessable Entity** (booking is non-cancellable)
- [ ] Select the option with the **maximum** `refund_amount` (matches TC's current behavior)

### Cancellation — Step 2: Execute Refund (In-Process F3 Service Call)

- [ ] Call F3's internal refund execution service (via `TwelveGoClientInterface`) with `hash`, `refund_fxcode`, and `refund_amount` from the selected option — in-process PHP call, not HTTP
- [ ] If `success == true`, proceed to build response
- [ ] If refund fails, return **500** with meaningful error message

### Response

- [ ] Return `200 OK` with cancellation result:
  ```
  {
    booking_id: 12go booking ID (native),
    booking_status: "cancelled",
    refund: {
      amount: "150.00" (string, from 12go's refund_amount),
      currency: "THB" (from 12go's refund_fxcode)
    }
  }
  ```
- [ ] Use 12go's `refund_amount` directly as the client-facing refund (no local RefundCalculator)

### Status Mapping

- [ ] After successful cancellation, return `booking_status: "cancelled"`

### Error Handling

- [ ] **400** — Malformed request (invalid booking_id format)
- [ ] **401** — Client authentication failure
- [ ] **404** — Booking not found
- [ ] **422** — Booking is non-cancellable (wrong status, no refund options available, cancellation policies prevent it)
- [ ] **500** — Unexpected errors from internal service (log full context, return meaningful message)
- [ ] Map 12go-specific error cases: booking ID not found → 404, unprocessable entity → 422, status not cancellable → 422

---

## Technical Notes

### Architecture (3-Layer)

```
Handler (Controller)
  ├─ Validate request parameters
  ├─ Extract booking_id
  └─ Build response

Mapper (CancelBookingMapper)
  ├─ Map 12go refund response → TC contract
  └─ Format refund amount (string with 2 decimal places)

12go Client (TwelveGoClientInterface — in-process, NOT HTTP)
  ├─ getBookingDetails(bookingId) → status check
  ├─ getRefundOptions(bookingId) → available options
  └─ executeRefund(bookingId, hash, fxcode, amount) → success/failure
```

### Two-Step Cancellation Flow

```
B2B Handler                  TwelveGoClientInterface (in-process)
    │                              │
    │── getBookingDetails() ─────>│  (status check)
    │<── { status: confirmed } ───│
    │                              │
    │── getRefundOptions() ──────>│  (calls internal refund options service)
    │<── { available: true,        │
    │     options: [{ amount,      │
    │       fxcode, hash }] } ────│
    │                              │
    │  Select max refund_amount    │
    │                              │
    │── executeRefund(hash,...) ──>│  (calls internal refund service)
    │<── { success: true } ───────│
    │                              │
    │── Return 200 { cancelled,    │
    │     refund: {amount,currency}}│
```

### What's Eliminated vs TC

| TC Component | F3 | Notes |
|---|---|---|
| PostgreSQL booking lookup + update | Eliminated | No local booking state |
| CancellationPolicies local storage | Eliminated | Don't store policies at booking time |
| RefundCalculator | Eliminated | Use 12go's refund_amount directly |
| Timezone calculations for refund | Eliminated | Part of RefundCalculator |
| IStationIdMapper (timezone lookup) | Eliminated | Part of RefundCalculator |
| SI refund vs calculated refund comparison | Eliminated | Single source of truth (12go) |
| CancellationBookingProcessService | Eliminated | No DB update, no local refund calc |
| 5 Kafka events | 1 structured log | `booking.cancelled` for Datadog pipeline |
| DisableCancel feature flag | Review | May still be needed as business rule |
| ConditionalCypher encrypt/decrypt | Eliminated | Use 12go native booking ID |
| PostgreSQL status update | Eliminated | No local state to update |
| BookingEntity lookup | Eliminated | No local entity |

---

## Open Questions (For Grooming)

1. **Use 12go's `refund_amount` as client-facing refund?** TC overrides with its own calculation from CancellationPolicies. Business needs to confirm that 12go's refund amount is acceptable as the client-facing value. Vlad's revenue changes suggest alignment, but explicit confirmation needed.
2. **Is the two-step flow (refund-options → refund) always required?** Or can some bookings be cancelled in a single call? The current flow always picks the max refund option — is that always the correct business rule?
3. **Always pick max refund option?** TC selects `options.MaxBy(o => o.RefundAmount)`. Are there cases where a different option should be selected (e.g., partial refund, different currency)?
4. **DisableCancel feature flag** — Is per-integration cancel disabling still needed? If so, how should it be configured in F3 (config file, database, feature flag service)?
5. **Partial refund scenarios** — Does 12go's refund-options already account for time-based penalties (closer to departure = lower refund)? Or is refund_amount always the full price?
6. **Idempotency** — If a client calls cancel twice for the same booking, what happens? Should the second call return the same result, or an error?

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Emit structured JSON event (`booking.cancelled`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
