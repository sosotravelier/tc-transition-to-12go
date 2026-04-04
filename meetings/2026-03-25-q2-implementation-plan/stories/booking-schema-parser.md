# Booking Schema Parser

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisite**: GetItinerary without schema (ST-2484) — needs `cartId` from AddToCart step
**Blocks**: CreateBooking (#6) — reserve step requires the field name mapping produced by this parser

---

## Description

Implement the booking schema parser that transforms 12go's checkout form data (obtained via in-process call to F3's internal checkout service) into the TC client-facing `booking_schema` (JSON Schema format) and produces the `NameToSupplierName` field mapping needed by CreateBooking.

This is the most complex single piece of the transition. The 12go checkout API returns ~20-50 flat key-value fields using bracket-notation (`passenger[0][first_name]`, `selected_seats_TH013r...`), where 4 field categories embed a trip-specific `cartId` in their key names. The parser must:

1. Categorize each field (contact, passenger, seat, baggage, pickup/dropoff, delivery)
2. Detect dynamic keys by pattern matching (cartId-embedded keys for seats, baggage, points, delivery)
3. Build a `NameToSupplierName` mapping (`internal_name → actual_supplier_key`) that persists in Redis for use at reserve time
4. Build a `BookingSchemaDictionary` for enum translations (`gender: {Male → M}`, `id_type: {Passport → 0}`)
5. Produce a client-facing `booking_schema` in JSON Schema format describing required fields, types, validation, and options

**Context**: The current C# implementation is ~1,180 lines (schema) + ~394 (builder) + ~130 (translator). PHP has a natural advantage here: 12go's regex patterns are PHP-native PCRE (no normalization needed), and dynamic JSON handling is simpler with associative arrays. Estimated PHP effort: **400-600 lines**.

**Eyal's alternative (Mar 25)**: Before building the full parser, look inside the F3 service that builds the checkout response. The controller calls a service which assembles the flat bracket-notation JSON — but that service itself works with structured internal data (DB tables, models, business logic) before serializing. If we can tap into that underlying structure directly, we could build our booking schema from the source data rather than parsing the serialized output. This could eliminate the entire pattern-matching and name-mapping pipeline. Sana or Valeri can help navigate the service internals.

---

## Acceptance Criteria

- [ ] **Spike: Investigate F3 checkout service internals** — The checkout controller calls an internal service to build the flat bracket-notation JSON. Don't treat that service as a black box. Open it up and trace how it assembles the checkout fields — what data sources it reads, what internal models it uses before serializing into the flat format. The goal is to determine whether we can construct the booking schema directly from the underlying data (DB tables, internal DTOs, business logic) rather than consuming the serialized flat output and reverse-engineering it with pattern matching. Document findings: what the internal structure looks like, whether we can call deeper methods or query the same sources, and a recommendation on which approach is simpler. Consult Sana or Valeri for guidance on the service internals.

- [ ] **Parse 12go checkout data** — Obtain the checkout form field data for the given cartId and pax count. This should be an in-process call to the F3 internal service that builds checkout fields (the same logic behind `GET /checkout/{cartId}?people={pax}`), not an HTTP call. Deserialize the response into categorized fields:
  - Fixed fields: `contact[mobile]`, `contact[email]`, `seats`
  - Fixed passenger fields (20): `passenger[0][first_name]`, `passenger[0][last_name]`, etc.
  - Dynamic seat selection: keys matching `selected_seats_*` (not `*_allow_auto`)
  - Dynamic seat auto-allow: keys matching `selected_seats_*_allow_auto`
  - Dynamic baggage: keys containing `[baggage_`
  - Dynamic pickup/dropoff/delivery: keys starting with `points[` or `delivery[`
  - Additional passengers (`passenger[1-20][...]`): skip during schema build (template from passenger[0])

- [ ] **Build NameToSupplierName mapping** — Produce a dictionary mapping internal field names to actual 12go bracket-notation keys. Examples:
  - `seat_selection` → `selected_seats_TH013r013800Cb00603SPY6d`
  - `auto_allow` → `selected_seats_TH013r..._allow_auto`
  - `baggage` → `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`
  - `points_pickup` → `points[JP0zJM0rPO46Yb0R402TFAOi][pickup]`

- [ ] **Build BookingSchemaDictionary** — For `select` type fields with options, build enum translation maps. Examples:
  - `gender`: `{Male → M, Female → F}`
  - `id_type`: `{Passport → 0, ID Card → 1}`
  - `title`: `{Mr → Mr, Mrs → Mrs}`

- [ ] **Handle seat layout variants** — Parse the `seatmap.layouts` field which has 4 known formats:
  - Array of arrays: `[["1A","1B"], ["2A","2B"]]`
  - Object → array: `{"1": ["1A","1B"]}`
  - Object → object → array: `{"1": {"left": ["1A"], "right": ["1B"]}}`
  - Dictionary: `{"1": {"A": "1A", "B": "1B"}}`

- [ ] **Produce client-facing booking_schema** — Output a JSON Schema describing:
  - Field types (input, select, checkbox, date, file)
  - Required flags
  - Validation regex patterns (use PHP PCRE as-is from 12go response)
  - Options with nested groups (for select fields like country_id with "Popular" / "All")
  - Seat prices (differential from base price)
  - Extras (baggage options with pricing)

- [ ] **Persist to Redis** — Store the following under key `b2b:schema:{cartId}` with 3-hour TTL:
  - `name_to_supplier` mapping
  - `schema_dictionary` (enum translations)
  - `booking_schema` (for validation at reserve time)
  - Locked seats (initially empty, populated by SeatLock if called)

- [ ] **Handle unknown required fields** — If an unrecognized key has `required: true`, log a warning with the field details (don't throw — be resilient to new fields 12go adds)

- [ ] **Test with fixture data** — Use at least 4 test fixtures extracted from real 12go checkout responses covering:
  - Simple route (contact + passengers only)
  - Route with seat selection
  - Route with baggage options
  - Route with pickup/dropoff points

---

## Technical Notes

### 12go Checkout Data (In-Process Call)

The checkout form data is obtained by calling F3's internal checkout service (the logic behind `GET /checkout/{cartId}?people={pax}`) via in-process PHP call — not an HTTP call. The spike AC above investigates whether we can go even deeper and bypass the flat serialization entirely.

The data structure (as returned by the checkout service) is a flat JSON with bracket-notation keys. Every top-level key is a field name, every value is a `FormField` object:

```
FormField {
  type:     "input" | "select" | "checkbox" | "date" | "file"
  name:     string (bracket-notation key)
  title:    string (human-readable label)
  required: boolean
  regexp:   string[] (PHP PCRE patterns)
  options:  Option[] (for select/checkbox)
  data:     object (for seatmap)
}
```

### 47 Known Field Constants

- **Fixed passenger fields (20)**: first_name, last_name, middle_name, id_no, id_type, id_exp_date, id_issue_date, country_id, gender, is_child, dob, id_scan, seattype_code, title, visa_type, visa_reason, nationality, residency + contact[mobile], contact[email]
- **Dynamic fields (~27)**: selected_seats_*, baggage_*, plus ~20 points/delivery variants

### Architecture Fit

- Lives in the **Mapper Layer** of the 3-layer architecture (Handler → Mapper → 12go Client)
- Called from GetItinerary handler after the AddToCart step returns a cartId
- Output consumed by CreateBooking handler when translating TC booking_data back to 12go format

### PHP Advantage

| Aspect | C# (current) | PHP (proposed) |
|---|---|---|
| Regex patterns | Must normalize PHP PCRE → .NET | **Use as-is** |
| Dynamic JSON | `JsonExtensionData` + computed props | `json_decode()` → associative array |
| Bracket-notation serialization | Custom `Utf8JsonWriter` (152 lines) | String concat or `http_build_query` |

---

## Open Questions (For Grooming)

1. **F3 checkout service internals** — What does the service behind the checkout controller look like internally? What data sources and models does it use before serializing into the flat bracket-notation format? Can we build our schema from that underlying structure instead of parsing the serialized output? (Trace with Sana/Valeri)
2. **Schema format for new clients** — Must we use TC's JSON Schema format, or can new clients accept a simpler format? (Reduces parser complexity)
3. **Unknown field handling** — Should unknown required fields be a hard error or a warning? Current C# throws `ArgumentOutOfRangeException`.
4. **Redis TTL** — 3 hours matches the 12go cart TTL. Should we re-fetch from 12go if cache expires, or fail and ask client to re-call GetItinerary?

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Emit structured JSON event (`checkout.schema_parsed`) for Datadog → ClickHouse pipeline
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
