# CreateBooking (Reserve)

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- GetItinerary without schema (ST-2484) — produces cartId and itinerary data
- Booking Schema Parser (#5b) — produces field mappings, enum dictionary, and booking_schema in Redis

**Blocks**: ConfirmBooking (#7) — needs the booking ID returned by reserve

---

## Description

Implement the CreateBooking endpoint that accepts a client's passenger/contact data, validates it against the cached booking schema, translates it to 12go's internal format, and calls F3's internal reservation service to create the reservation.

### How the Booking Schema Is Used

The booking schema (built by #5b, stored in Redis) is consumed here in three ways:

1. **Validation** — The cached `booking_schema` (JSON Schema) is used to validate the client's `booking_data` before calling 12go. This catches errors early with field-level detail, rather than getting generic errors back from 12go's reserve endpoint.

2. **Field name translation** — The `NameToSupplierName` mapping translates TC's normalized field names to 12go's bracket-notation keys with embedded cartIds. Example: `seat_selection` → `selected_seats_TH013r013800Cb00603SPY6d`.

3. **Enum translation** — The `BookingSchemaDictionary` maps client-submitted display values to 12go's internal codes. Example: `gender: "Male"` → `"M"`, `id_type: "Passport"` → `"0"`.

### Validation: Our Side vs 12go's

12go's internal reservation logic performs its own validation (required fields, regex, enums, passenger count). However, **we keep validation on our side** because:

- **Better error messages** — 12go's internal errors are generic (first field only). We return all field-level errors at once.
- **Fail-fast** — Catch invalid data before invoking the reservation service.
- **Client expectation** — Clients expect specific error contracts with field-level detail.
- **PHP advantage** — 12go's regex patterns are PHP-native PCRE, so validation with `preg_match()` requires zero regex normalization (unlike the C# implementation which needed PCRE→.NET conversion).

Shauly (Mar 25): "When we have good validations at the beginning we get better results."

**Note on "12go validation"**: Since we're calling F3 services in-process, "12go validates on its side" means the underlying service logic has its own validation. Our B2B validation layer runs first, catches issues with better error messages, and only then passes to the internal service.

### Internal F3 Service Calls (Not HTTP)

Since B2B lives inside the F3 monolith, the reserve flow uses **in-process calls to internal F3 services** — not HTTP calls to 12go's external API. This is the core reason for building inside F3: eliminating the HTTP hop that TC makes today.

The `TwelveGoClientInterface` (our DI adapter boundary) wraps calls to internal F3 services like `BookingProcessor`, `BookingFormManager`, etc. The exact services to call will be identified during implementation (consult Sana/Valeri), but the logical operations are:

1. **Reserve** — Call F3's internal booking/reservation service (the same logic that `POST /reserve/{cartId}` ultimately executes). Returns the 12go booking ID.
2. **Get booking details** — Call F3's internal booking details service (the same logic behind `GET /booking/{BId}`). Returns final price and status.

The external HTTP endpoints (`POST /reserve/{cartId}`, `GET /booking/{BId}`) are documented in our endpoint specs as reference for *what the operations do*, but we call the underlying PHP services directly, not the HTTP layer.

---

## Acceptance Criteria

### Input & Token Handling

- [ ] Accept `POST /v{version}/{client_id}/bookings` with body `{ booking_token, booking_data }` matching TC contract
- [ ] Decode `booking_token` to extract `cartId`, `seatCount`, `clientId`, and verify token has not expired
- [ ] Fetch cached schema data from Redis (`b2b:schema:{cartId}`): field name mapping, enum dictionary, booking schema. Return **404** if cache expired/missing (client must re-call GetItinerary)

### Validation (Before Calling 12go)

- [ ] **Required fields** — All fields marked `required: true` in the cached booking_schema must be present in `booking_data`
- [ ] **Type checking** — Field values match declared types (string for input, boolean for checkbox, one-of for select)
- [ ] **Regex patterns** — For fields with `regexp` in the schema, validate using `preg_match()` with 12go's native PCRE patterns (no normalization needed)
- [ ] **Enum values** — For `select` fields, submitted value must be one of the declared `options[].value`
- [ ] **Passenger count** — `count(booking_data.passengers)` must equal `seatCount` from the booking token
- [ ] **Contact fields** — `email` and `mobile_phone` validated against schema-provided regex if present
- [ ] Return **422 Unprocessable** with field-level error details listing ALL failing fields (not just the first one)

### Locked Seats Override

- [ ] If Redis cache has `locked_seats` (populated by SeatLock endpoint), override `booking_data.seat_selection` with the locked seats before validation and reserve

### Field Name Translation (TC → 12go bracket-notation)

- [ ] **Fixed fields**: Map TC names to bracket-notation (e.g., `email` → `contact[email]`, `passengers[0].first_name` → `passenger[0][first_name]`)
- [ ] **Dynamic fields**: Use `NameToSupplierName` mapping from Redis for cartId-embedded keys:
  - `seat_selection` → `selected_seats_{dynamicCartId}` (join array to comma-separated string)
  - `allow_automatic_seat_selection` → `selected_seats_{dynamicCartId}_allow_auto`
  - `passengers[N].baggage_option` → `passenger[N][baggage_{dynamicCartId}]`
  - `additional_fields.points_*` → `points[{dynamicCartId}][pickup|dropoff|...]`
- [ ] **Multi-passenger indexing**: For passengers 1-20, take the template from passenger[0] mapping and replace the index (e.g., `passenger[0][baggage_PH01...]` → `passenger[1][baggage_PH01...]`)

### Enum Translation

- [ ] Before building the 12go request, translate enum values using `BookingSchemaDictionary`:
  - `gender`: `"Male"` → `"M"`, `"Female"` → `"F"`
  - `id_type`: `"Passport"` → `"0"`, `"National ID"` → `"1"`, etc.
  - `title`: `"Mr"` → `"Mr"`, `"Mrs"` → `"Mrs"`, etc.
  - `nationality`: `"Thai"` → `"TH"`, etc.
  - Any other field with enum translations in the dictionary
- [ ] If a submitted value has no entry in the dictionary, pass it through as-is (don't fail — some fields like `country_id` are already in the expected format)

### Reserve (In-Process F3 Service Call)

- [ ] Call F3's internal reservation service (via `TwelveGoClientInterface`) with the translated booking data — this is an in-process PHP call, not an HTTP call
- [ ] On success, extract booking ID from the result
- [ ] Call F3's internal booking details service to get final price and booking status
- [ ] Apply markup to the final price if per-client markup is configured
- [ ] **Implementation note**: Identify the exact F3 services to call (e.g., `BookingProcessor::reserveBookings()`, `BookingDetailsManager`) with Sana/Valeri during implementation

### Response

- [ ] Return `200 OK` with TC `Booking` contract:
  ```
  {
    id: 12go booking ID (native, per Mar 25 decision),
    status: mapped status (12go → TC enum),
    from_station: string,
    to_station: string,
    departure_time: ISO 8601,
    passenger_count: integer,
    total_price: { amount, currency },
    created_at: ISO 8601,
    updated_at: ISO 8601
  }
  ```
- [ ] Use 12go native booking ID as `id` (decided Mar 25 — Shauly, Eyal, Eliran agreed)

### State Persistence

- [ ] Store booking reference in Redis (`b2b:booking:{bookingId}`, TTL 24h) with: cartId, status, price, clientId — needed by ConfirmBooking
- [ ] **No DynamoDB, no PostgreSQL** — 12go is source of truth (stateless architecture, per Mar 12 decision)

### Error Handling

- [ ] **400** — Malformed request (missing booking_token, unparseable body)
- [ ] **404** — Schema cache expired (client must re-call GetItinerary)
- [ ] **422** — Schema validation failure (return field-level errors), seat unavailable, product not available
- [ ] **500** — Unexpected 12go errors (log full context, return meaningful message to client)
- [ ] Map 12go error responses to client-friendly format. 12go returns generic errors (first field only in `ErrorResponse.Fields`); our response should enumerate all failing fields

### Status Mapping

- [ ] Map 12go booking status to TC contract enum:

  | 12go status | TC status |
  |---|---|
  | `pending_client_confirmation` | `reserved` |
  | `confirmed` | `approved` |
  | `cancelled` | `cancelled` |
  | Other/unknown | `pending` |

---

## Technical Notes

### Architecture (3-Layer)

```
Handler (Controller)
  ├─ Decode booking_token
  ├─ Validate request structure
  └─ Build response

Mapper (BookingMapper service)
  ├─ Load schema + mappings from Redis
  ├─ Validate booking_data against schema
  ├─ Translate field names (TC → bracket-notation)
  ├─ Translate enum values
  └─ Build flat JSON reserve body

12go Client (TwelveGoClientInterface — in-process, NOT HTTP)
  ├─ reserve(cartId, bookingData) → bookingId  (calls internal F3 booking service)
  └─ getBookingDetails(bookingId) → price, status  (calls internal F3 service)
```

### Translated Booking Data Format

The mapper layer translates TC's structured booking_data into the bracket-notation format that 12go's internal reservation logic expects. Whether this data is passed as a flat array to the internal service or restructured differently depends on the F3 service's internal API (to be identified during implementation).

Reference format (bracket-notation, as used by 12go internally):

```json
{
  "contact[mobile]": "+66812345678",
  "contact[email]": "user@example.com",
  "seats": 2,
  "selected_seats_TH013r013800Cb00603SPY6d": "1A,1B",
  "selected_seats_TH013r013800Cb00603SPY6d_allow_auto": true,
  "passenger[0][first_name]": "John",
  "passenger[0][last_name]": "Doe",
  "passenger[0][gender]": "M",
  "passenger[0][id_no]": "AB123456",
  "passenger[0][id_type]": "0",
  "passenger[0][country_id]": "TH",
  "passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]": "10kg",
  "passenger[1][first_name]": "Jane",
  "passenger[1][last_name]": "Doe",
  "passenger[1][baggage_PH01Bd09kt44Ia00l037Y7c5]": "none",
  "points[JP0zJM0rPO46Yb0R402TFAOi][pickup]": "hotel_abc"
}
```

**Note**: If the F3 internal service accepts a different structure (e.g., typed DTOs instead of flat bracket-notation), the mapper layer adapts accordingly. The bracket-notation format above is the reference for what the underlying logic needs — the adapter may pass it differently.

### Async Flow (202 / Incomplete Results)

**Not needed.** TC's async pattern exists because of HTTP hops through SI Framework and Etna. F3 makes in-process calls within the monolith — no network latency between services. If performance profiling later shows issues, implement 202 + polling as a follow-up.

### What's Eliminated vs TC

| TC Component | F3 | Notes |
|---|---|---|
| CaesarCipher encrypt/decrypt | Signed token or simpler encoding | TBD — booking token format decision |
| DynamoDB PreBookingCache | Redis | Already cached by schema parser |
| DynamoDB ItineraryCache | Redis or re-derive | Cart lives in 12go |
| DynamoDB BookingCache | Redis (24h TTL) | Lightweight reference only |
| Two-phase price calc (estimated + final) | Single price from 12go + markup | Trust 12go's reserve price |
| Credit line check | TBD | Discuss if 12go manages billing for new clients |
| 4 Kafka events | 1 structured log event | `booking.created` for Datadog pipeline |
| SI Framework + Etna HTTP hop | In-process F3 service calls | The core win of building inside F3 |
| HTTP calls to 12go external API | In-process PHP method calls | No network latency between B2B handler and booking logic |

---

## Open Questions (For Grooming)

1. **Schema staleness** — If client waits a long time between GetItinerary and CreateBooking, the Redis cache (3h TTL) may expire. Should we return 404 with a clear "re-call GetItinerary" message, or re-fetch the schema on demand?
2. **Price mismatch** — TC compares estimated vs actual price. Should we log a warning if the price returned after reserve differs significantly from what was quoted in GetItinerary? Or just trust the internal service's pricing?

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Map `price_type` correctly (12go `price_restriction` integer → client enum `{Max, Min, Exact, Recommended}`)
- Emit structured JSON event (`booking.created`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
