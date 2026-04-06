# Booking Funnel — Technical Deep-Dive

**Prepared for** Apr 7 meeting with Shauly | **Author** Soso

This document covers the exact technical details for each booking funnel endpoint: data formats, sequence diagrams, validation logic, and the proposed F3 implementation approach.

---

## Table of Contents

1. [12go Booking Schema Format](#1-12go-booking-schema-format)
2. [GetItinerary Flow](#2-getitinerary-flow)
3. [Booking Schema Parser — How It Works Today](#3-booking-schema-parser--how-it-works-today)
4. [CreateBooking Flow](#4-createbooking-flow)
5. [ConfirmBooking Flow](#5-confirmbooking-flow)
6. [CancelBooking Flow](#6-cancelbooking-flow)
7. [GetBookingDetails & GetTicket](#7-getbookingdetails--getticket)
8. [State Management: What Needs to Persist Between Steps](#8-state-management)
9. [Validation — What TC Does Today](#9-validation--what-tc-does-today)
10. [F3 Implementation Approach](#10-f3-implementation-approach)
11. [Key Questions for Shauly](#11-key-questions-for-shauly)

---

## 1. 12go Booking Schema Format

The 12go checkout endpoint (`GET /checkout/{cartId}?people=N`) returns a **flat JSON object** where every top-level key is a bracket-notation form field name, and every value describes that field's type, validation, and options.

### Example Response Structure

```json
{
  "contact[mobile]": {
    "type": "input",
    "name": "contact[mobile]",
    "title": "Phone Number",
    "required": true,
    "regexp": ["^\\/^\\+[0-9]{7,15}$\\/"]
  },
  "contact[email]": {
    "type": "input",
    "name": "contact[email]",
    "title": "Email",
    "required": true,
    "regexp": ["^\\/^[\\w.+-]+@[\\w-]+\\.[\\w.]+$\\/"]
  },
  "passenger[0][first_name]": {
    "type": "input",
    "name": "passenger[0][first_name]",
    "title": "First Name",
    "required": true,
    "regexp": ["\\/^[\\s\\pCA-Za-z\\x{0E00}-\\x{0E7F}]{2,30}$\\/u"]
  },
  "passenger[0][country_id]": {
    "type": "select",
    "name": "passenger[0][country_id]",
    "title": "Nationality",
    "required": true,
    "options": [
      { "value": null, "text": "Popular", "values": [
        { "value": "TH", "text": "Thailand" },
        { "value": "US", "text": "United States" }
      ]},
      { "value": null, "text": "All", "values": [
        { "value": "AR", "text": "Argentina" },
        ...
      ]}
    ]
  },
  "selected_seats_TH013r013800Cb00603SPY6d": {
    "type": "select",
    "name": "selected_seats_TH013r013800Cb00603SPY6d",
    "title": "Seat Selection",
    "required": false,
    "data": {
      "seatmap": {
        "seats": {
          "1A": { "is_available": true, "price": { "value": 100, "fxcode": "THB" }, "seat_type": "window" },
          "1B": { "is_available": false, "price": { "value": 100, "fxcode": "THB" }, "seat_type": "aisle" }
        },
        "layouts": [ [...] ],
        "booked": { "1B": true }
      }
    }
  },
  "passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]": {
    "type": "select",
    "name": "passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]",
    "title": "Baggage",
    "required": false,
    "options": [
      { "value": "none", "text": "No baggage", "data": { "price": { "value": 0, "fxcode": "PHP" } } },
      { "value": "10kg", "text": "10 kg prepaid", "data": { "price": { "value": 450, "fxcode": "PHP" } } }
    ]
  },
  "points[JP0zJM0rPO46Yb0R402TFAOi][pickup]": {
    "type": "select",
    "name": "points[JP0zJM0rPO46Yb0R402TFAOi][pickup]",
    "title": "Pickup Point",
    "required": true,
    "options": [
      { "value": "hotel_abc", "text": "Hotel ABC" },
      { "value": "airport", "text": "Airport Terminal 1" }
    ]
  },
  "seats": {
    "type": "input",
    "name": "seats",
    "title": "Number of passengers",
    "required": true
  }
}
```

### Field Categories

| Category | Key Pattern | Example | Dynamic? |
|----------|-------------|---------|----------|
| **Contact** | `contact[mobile]`, `contact[email]` | Fixed keys | No |
| **Passenger (first)** | `passenger[0][field_name]` | `passenger[0][first_name]` | No |
| **Passenger (additional)** | `passenger[1-20][field_name]` | `passenger[1][first_name]` | No (but index varies) |
| **Seat selection** | `selected_seats_{cartId}` | `selected_seats_TH013r013800Cb00603SPY6d` | **Yes** — cartId embedded |
| **Seat auto-allow** | `selected_seats_{cartId}_allow_auto` | `selected_seats_TH013r...d_allow_auto` | **Yes** |
| **Baggage** | `passenger[N][baggage_{cartId}]` | `passenger[0][baggage_PH01Bd09kt...]` | **Yes** |
| **Pickup/dropoff** | `points[{cartId}][pickup\|dropoff\|...]` | `points[JP0zJM...][pickup]` | **Yes** |
| **Delivery** | `delivery[{cartId}]`, `delivery[{cartId}][address]` | | **Yes** |
| **Seats count** | `seats` | Fixed key | No |

### FormField Schema

Every value in the response follows this structure:

```
FormField {
  type:     "input" | "select" | "checkbox" | "date" | "file"
  name:     string (bracket-notation key)
  title:    string (human-readable label)
  required: boolean
  regexp:   string[] (PHP-style regex patterns for validation)
  options:  Option[] (for select/checkbox types)
  data:     object (for seatmap data)
}

Option {
  value:  string | null
  text:   string
  values: Option[] (nested groups, e.g. "Popular" / "All" for countries)
  data:   { price: { value: number, fxcode: string } }
}
```

### The Dynamic Key Problem

The key challenge is that **4 field categories embed a trip-specific cartId** in their key names. This cartId changes per booking. The system must:

1. **Parse**: Scan response keys using pattern matching (StartsWith, EndsWith, Contains) to identify dynamic fields
2. **Map**: Record `internal_name → actual_supplier_key` (e.g., `"seat_selection" → "selected_seats_TH013r013800Cb00603SPY6d"`)
3. **Persist**: Store the mapping between GetItinerary and CreateBooking requests
4. **Reconstruct**: When building the reserve POST body, use the stored mapping to emit the original bracket-notation keys

### Known Wildcard Patterns (47 constants in C#)

The full set is defined in `OneTwoGoFieldNames.cs`:

**Fixed passenger fields** (20): first_name, last_name, middle_name, id_no, id_type, id_exp_date, id_issue_date, country_id, gender, is_child, dob, id_scan, seattype_code, title, visa_type, visa_reason, nationality, residency + contact[mobile], contact[email]

**Dynamic fields** (~27): selected_seats_*, selected_seats_*_allow_auto, baggage_*, plus ~20 points/delivery variants (pickup, dropoff, pickup_text, dropoff_text, current_city, flight_arr_time, flight_dep_time, flight_no, airline, number_luggage, address, additional_information, drop_off_point, point, hotel_checkin_date, etc.)

---

## 2. GetItinerary Flow

### Current TC Flow (What Happens Today)

```
B2B Client              TC (Denali)              Supply Integration          12go API              DynamoDB
    │                       │                           │                       │                     │
    │── GET /itineraries ──>│                           │                       │                     │
    │                       │                           │                       │                     │
    │                       │  Decrypt itinerary_id     │                       │                     │
    │                       │  → SearchItineraryId      │                       │                     │
    │                       │  (contractCode,           │                       │                     │
    │                       │   integrationId,          │                       │                     │
    │                       │   productId, seats)       │                       │                     │
    │                       │                           │                       │                     │
    │                       │── GetItinerary() ────────>│                       │                     │
    │                       │                           │                       │                     │
    │                       │                           │  STEP 1: Validate     │                     │
    │                       │                           │── GET /trip-details ──>│                     │
    │                       │                           │<── trip + options ─────│                     │
    │                       │                           │                       │                     │
    │                       │                           │  STEP 2: Create cart   │                     │
    │                       │                           │── POST /add-to-cart ──>│                     │
    │                       │                           │<── cartId ─────────────│                     │
    │                       │                           │                       │                     │
    │                       │                           │  Cache price+operator  │                     │
    │                       │                           │  in Redis (by cartId)  │                     │
    │                       │                           │                       │                     │
    │                       │<── Itinerary (id=cartId) ─│                       │                     │
    │                       │                           │                       │                     │
    │                       │  Generate BookingToken    │                       │                     │
    │                       │  (contract, integration,  │                       │                     │
    │                       │   cartId, seats, uniqueId)│                       │                     │
    │                       │                           │                       │                     │
    │                       │── Cache itinerary ───────────────────────────────────────────────────────>│
    │                       │  Apply markup pricing     │                       │                     │
    │                       │  Exchange rate conversion  │                       │                     │
    │                       │                           │                       │                     │
    │                       │── GetBookingSchema() ────>│                       │                     │
    │                       │                           │── GET /checkout ──────>│                     │
    │                       │                           │   /{cartId}?people=N  │                     │
    │                       │                           │<── flat JSON fields ───│                     │
    │                       │                           │                       │                     │
    │                       │                           │  Parse dynamic fields  │                     │
    │                       │                           │  Build name mapping    │                     │
    │                       │                           │  Cache in Redis (3h)   │                     │
    │                       │                           │                       │                     │
    │                       │<── BookingSchema ─────────│                       │                     │
    │                       │                           │                       │                     │
    │                       │── Cache schema + mappings ──────────────────────────────────────────────>│
    │                       │                           │                       │                     │
    │                       │  Merge: itinerary +       │                       │                     │
    │                       │  schema + bookingToken    │                       │                     │
    │                       │  Encrypt with CaesarCipher│                       │                     │
    │                       │                           │                       │                     │
    │<── PreBookingSchema ──│                           │                       │                     │
    │  (itinerary +         │                           │                       │                     │
    │   booking_schema +    │                           │                       │                     │
    │   booking_token)      │                           │                       │                     │
```

### Proposed F3 Flow (Simplified)

```
B2B Client              F3 (PHP/Symfony)             12go Internal (in-process)  Redis
    │                       │                            │                        │
    │── GET /itineraries ──>│                            │                        │
    │                       │                            │                        │
    │                       │  Parse itinerary_id        │                        │
    │                       │                            │                        │
    │                       │~~ GetTripDetails() ~~~~~~>│                        │
    │                       │<~~ trip + options ~~~~~~~~~│                        │
    │                       │                            │                        │
    │                       │~~ AddToCart() ~~~~~~~~~~~>│                        │
    │                       │<~~ cartId ~~~~~~~~~~~~~~~~│                        │
    │                       │                            │                        │
    │                       │~~ GetCheckout(cartId) ~~>│                        │
    │                       │<~~ flat JSON fields ~~~~~~│                        │
    │                       │                            │                        │
    │                       │  Parse dynamic fields      │                        │
    │                       │  Build field name mapping  │                        │
    │                       │  Build booking_schema      │                        │
    │                       │                            │                        │
    │                       │── Store mapping + schema ─────────────────────────>│
    │                       │                            │                        │
    │                       │  Generate booking_token    │                        │
    │                       │  Apply markup if needed    │                        │
    │                       │                            │                        │
    │<── PreBookingSchema ──│                            │                        │
```

### What's Eliminated

| TC Component | F3 Equivalent | Notes |
|---|---|---|
| Caesar cipher encryption | Signed token or simple encoding | TBD — discuss with Shauly |
| DynamoDB ItineraryCacheModel | Redis or re-fetch | Cart lives in 12go's Redis |
| DynamoDB PreBookingCacheModel | Redis | Field mappings + schema |
| SI Framework abstraction | Direct PHP calls | No multi-supplier overhead |
| Etna SI Host HTTP hop | Eliminated | Direct calls within F3 |
| Double caching (Redis + DynamoDB) | Single Redis cache | One cache layer |
| SearchItineraryId parsing (6+ fields) | Simpler ID structure | For new clients only |

### Three 12go In-Process Calls (The Core)

| # | Call | Purpose | Input | Output |
|---|------|---------|-------|--------|
| 1 | `GET /trip-details?trip_id={}&date={}&pax={}` | Validate trip, get options | tripId, date, pax | Trip + TravelOptions + Classes |
| 2 | `POST /add-to-cart` | Reserve cart slot | tripId, pax, travelOptionId | **cartId** |
| 3 | `GET /checkout/{cartId}?people={pax}` | Get booking form definition | cartId | Flat JSON form fields |

---

## 3. Booking Schema Parser — How It Works Today

### The Parsing Pipeline

```
12go checkout response (flat JSON, ~20-50 keys)
    │
    ▼
┌─────────────────────────────────────────────┐
│  1. DESERIALIZE                              │
│  Fixed fields → typed properties             │
│  Dynamic fields → ExtensionData dictionary   │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  2. BUILD NAME MAPPING                       │
│  Scan ExtensionData keys with patterns:      │
│  - StartsWith("selected_seats_")             │
│  - NOT EndsWith("_allow_auto")               │
│  - Contains("[baggage_")                     │
│  - StartsWith("points[") / StartsWith("delivery[") │
│                                              │
│  Output: Dict<internalName, supplierKey>     │
│  e.g. "seat_selection" → "selected_seats_TH01..." │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  3. BUILD CLIENT-FACING SCHEMA               │
│  For each field, produce:                    │
│  - Type (input/select/checkbox/date/file)    │
│  - Required flag                             │
│  - Validation regex (PHP→.NET normalized)    │
│  - Options (merged from nested groups)       │
│  - Seat prices (differential from base)      │
│                                              │
│  Output: BookingSchema (JSON Schema format)  │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  4. PERSIST MAPPING                          │
│  Store NameToSupplierName dict for later use │
│  at reserve time (CreateBooking)             │
│  SI: Redis/HybridCache (3h TTL)             │
│  Denali: DynamoDB (compressed, 5-day TTL)    │
└─────────────────────────────────────────────┘
```

### Pattern Matching Logic (Pseudocode)

```php
foreach ($responseKeys as $key => $field) {
    if ($key === 'contact[mobile]')         → map to 'mobile'
    if ($key === 'contact[email]')          → map to 'email'
    if ($key === 'seats')                   → map to 'seats'

    // Fixed passenger fields (passenger[0][...])
    if ($key === 'passenger[0][first_name]') → map to 'first_name'
    if ($key === 'passenger[0][last_name]')  → map to 'last_name'
    // ... 16 more fixed passenger fields

    // Dynamic: seat selection
    if (str_starts_with($key, 'selected_seats_') && !str_ends_with($key, '_allow_auto'))
        → $nameMap['seat_selection'] = $key

    // Dynamic: seat auto-allow
    if (str_starts_with($key, 'selected_seats_') && str_ends_with($key, '_allow_auto'))
        → $nameMap['auto_allow'] = $key

    // Dynamic: baggage (per passenger)
    if (str_contains($key, '[baggage_'))
        → $nameMap['baggage'] = $key  // template: passenger[0][baggage_{cartId}]

    // Dynamic: points/delivery
    if (str_starts_with($key, 'points[') || str_starts_with($key, 'delivery['))
        → normalize: strip cartId from brackets, lowercase
        → e.g. points[JP0z...][pickup] → 'points_pickup'
        → $nameMap['points_pickup'] = $key

    // Additional passengers (1-20): skip during schema build
    if (preg_match('/^passenger\[([1-9]|1[0-9]|20)\]/', $key))
        → skip (schema only defined from passenger[0])

    // Unknown required field → error
    if ($field->required && !recognized($key))
        → throw ArgumentOutOfRangeException
}
```

### Seat Layout Format Variants

The seatmap `layouts` field is **not standardized** — four known formats:

| Format | Structure | Example |
|--------|-----------|---------|
| Array of arrays | `[["1A","1B"], ["2A","2B"]]` | Most common |
| Object → array | `{"1": ["1A","1B"], "2": ["2A","2B"]}` | Some operators |
| Object → object → array | `{"1": {"left": ["1A"], "right": ["1B"]}}` | Rare |
| Dictionary | `{"1": {"A": "1A", "B": "1B"}}` | Legacy DeOniBus |

The parser dispatches between these at runtime based on the JSON element type.

### Regex Normalization

12go returns PHP-style regexes (PCRE): `/^[\s\pCA-Za-z\x{0E00}-\x{0E7F}]{2,30}$/u`

Current C# normalizer strips delimiters and converts `\x{HHHH}` → Unicode escapes. On parse failure, silently returns null (drops the validation).

**For PHP**: This is a non-issue — PHP natively understands these PCRE patterns. **This is one area where PHP makes the schema parser simpler.**

---

## 4. CreateBooking Flow

### Current TC Flow

```
B2B Client              TC (Denali)              DynamoDB              Supply Integration          12go API
    │                       │                       │                       │                       │
    │── POST /bookings ────>│                       │                       │                       │
    │  {booking_token,      │                       │                       │                       │
    │   booking_data}       │                       │                       │                       │
    │                       │                       │                       │                       │
    │                       │  Decrypt booking_token│                       │                       │
    │                       │  → cartId, seatCount  │                       │                       │
    │                       │                       │                       │                       │
    │                       │── Fetch PreBooking ──>│                       │                       │
    │                       │<── schema + mappings ─│                       │                       │
    │                       │                       │                       │                       │
    │                       │── Fetch Itinerary ───>│                       │                       │
    │                       │<── stations, pricing ─│                       │                       │
    │                       │                       │                       │                       │
    │                       │  VALIDATE booking_data│                       │                       │
    │                       │  against BookingSchema│                       │                       │
    │                       │  (required fields,    │                       │                       │
    │                       │   regex, enums, pax)  │                       │                       │
    │                       │                       │                       │                       │
    │                       │  Calculate est. price │                       │                       │
    │                       │                       │                       │                       │
    │                       │── Reserve(cartId) ───────────────────────────>│                       │
    │                       │                       │                       │                       │
    │                       │                       │                       │  Translate field names │
    │                       │                       │                       │  (NameToSupplierName)  │
    │                       │                       │                       │  Translate enum values │
    │                       │                       │                       │  Build bracket-notation│
    │                       │                       │                       │                       │
    │                       │                       │                       │── POST /reserve ──────>│
    │                       │                       │                       │   /{cartId}            │
    │                       │                       │                       │<── { BId: "12345" } ───│
    │                       │                       │                       │                       │
    │                       │                       │                       │── GET /booking/{BId} ─>│
    │                       │                       │                       │<── price, status ──────│
    │                       │                       │                       │                       │
    │                       │<── Reservation (BId, cost, status) ──────────│                       │
    │                       │                       │                       │                       │
    │                       │  Generate BookingId   │                       │                       │
    │                       │  Check credit line    │                       │                       │
    │                       │── Store booking ─────>│                       │                       │
    │                       │                       │                       │                       │
    │<── { id, status:      │                       │                       │                       │
    │     "reserved",       │                       │                       │                       │
    │     total_price }     │                       │                       │                       │
```

### Proposed F3 Flow

```
B2B Client              F3 (PHP/Symfony)             Redis                12go Internal (in-process)
    │                       │                          │                       │
    │── POST /bookings ────>│                          │                       │
    │  {booking_token,      │                          │                       │
    │   booking_data}       │                          │                       │
    │                       │                          │                       │
    │                       │  Decode booking_token    │                       │
    │                       │  → cartId, seatCount     │                       │
    │                       │                          │                       │
    │                       │── Fetch mapping+schema ─>│                       │
    │                       │<── field mappings ───────│                       │
    │                       │                          │                       │
    │                       │  VALIDATE booking_data   │                       │
    │                       │  against schema          │                       │
    │                       │                          │                       │
    │                       │  Translate field names   │                       │
    │                       │  TC → 12go bracket fmt   │                       │
    │                       │                          │                       │
    │                       │~~ reserve(cartId, data) ~~~~~~~~~~~~~~~~~~~~~~~~>│
    │                       │<~~ { BId: "12345" } ~~~~~~~~~~~~~~~~~~~~~~~~~~~~│
    │                       │                          │                       │
    │                       │~~ getBooking(BId) ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~>│
    │                       │<~~ price, status ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~│
    │                       │                          │                       │
    │                       │  Apply markup if needed  │                       │
    │                       │── Store booking ref ────>│                       │
    │                       │                          │                       │
    │<── { id, status:      │                          │                       │
    │     "reserved",       │                          │                       │
    │     total_price }     │                          │                       │
```

### Reserve Call Payload — Exact Format

The `reserve(cartId)` call takes a flat associative array with bracket-notation keys:

```json
{
  "contact[mobile]": "+66812345678",
  "contact[email]": "user@example.com",
  "seats": 2,
  "selected_seats_TH013r013800Cb00603SPY6d": "1A,1B",
  "selected_seats_TH013r013800Cb00603SPY6d_allow_auto": true,
  "passenger[0][first_name]": "John",
  "passenger[0][last_name]": "Doe",
  "passenger[0][middle_name]": "",
  "passenger[0][title]": "Mr",
  "passenger[0][gender]": "M",
  "passenger[0][id_no]": "AB123456",
  "passenger[0][id_type]": "0",
  "passenger[0][country_id]": "TH",
  "passenger[0][dob]": "1990-01-01",
  "passenger[0][is_child]": false,
  "passenger[0][seattype_code]": "ST1",
  "passenger[0][id_exp_date]": "2030-01-01",
  "passenger[0][id_issue_date]": "2020-01-01",
  "passenger[0][id_scan]": "",
  "passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]": "10kg",
  "passenger[1][first_name]": "Jane",
  "passenger[1][last_name]": "Doe",
  "passenger[1][baggage_PH01Bd09kt44Ia00l037Y7c5]": "none",
  "points[JP0zJM0rPO46Yb0R402TFAOi][pickup]": "hotel_abc"
}
```

**Key insight**: The baggage key for passenger[1] is constructed by taking the template from passenger[0] (`passenger[0][baggage_PH01Bd...]`) and replacing the index. This is the `AddPassengerIndex()` logic.

### Field Name Translation (TC → 12go)

When the client submits `booking_data`, field names are in the TC format. The reserve request needs 12go's bracket-notation format:

| Client sends (TC format) | Maps to (12go format) | How |
|---|---|---|
| `passengers[0].first_name` | `passenger[0][first_name]` | Fixed mapping |
| `passengers[0].last_name` | `passenger[0][last_name]` | Fixed mapping |
| `seat_selection: ["1A", "1B"]` | `selected_seats_TH013r...: "1A,1B"` | NameToSupplierName lookup |
| `passengers[0].baggage_option: "10kg"` | `passenger[0][baggage_PH01B...]: "10kg"` | NameToSupplierName lookup + index replacement |
| `additional_fields.points_pickup: "hotel"` | `points[JP0z...][pickup]: "hotel"` | NameToSupplierName lookup |

### Enum Translation

For some fields, the client submits a standardized value that must be translated to 12go's internal code:

| Field | Client sends | 12go expects | Source |
|---|---|---|---|
| `gender` | `"male"` | `"M"` | BookingSchemaDictionary |
| `id_type` | `"passport"` | `"0"` | BookingSchemaDictionary |
| `title` | `"mr"` | `"Mr"` | BookingSchemaDictionary |
| `country_id` | `"TH"` | `"TH"` | Usually same (ISO2) |
| `nationality` | `"Thai"` | `"TH"` | BookingSchemaDictionary |

The `BookingSchemaDictionary` stores `field_name → { display_value → 12go_code }` mappings built during schema parsing.

---

## 5. ConfirmBooking Flow

### Current TC Flow

```
B2B Client              TC (Denali)                                      12go API
    │                       │                                                │
    │── POST /confirm ─────>│                                                │
    │                       │                                                │
    │                       │  Decrypt booking_id                            │
    │                       │  Fetch BookingCacheModel from DynamoDB         │
    │                       │  Check: not already confirmed                  │
    │                       │  Check credit line (if enabled)                │
    │                       │                                                │
    │                       │── POST /confirm/{bookingId} ──────────────────>│
    │                       │<── confirmation result ───────────────────────│
    │                       │                                                │
    │                       │── GET /booking/{bookingId} ──────────────────>│
    │                       │<── price, status, ticketUrl ─────────────────│
    │                       │                                                │
    │                       │  Map status                                    │
    │                       │  Calculate confirm price                       │
    │                       │  Update DynamoDB → Confirmed                   │
    │                       │  Persist to PostgreSQL                         │
    │                       │  Publish Kafka events                          │
    │                       │                                                │
    │<── { id, status:      │                                                │
    │     "approved",       │                                                │
    │     voucher_url,      │                                                │
    │     total_price }     │                                                │
```

### Proposed F3 Flow

```
B2B Client              F3 (PHP/Symfony)                                 12go Internal (in-process)
    │                       │                                                │
    │── POST /confirm ─────>│                                                │
    │                       │                                                │
    │                       │  Validate booking_id                           │
    │                       │  Check not already confirmed                   │
    │                       │                                                │
    │                       │~~ confirmBooking(bookingId) ~~~~~~~~~~~~~~~~~>│
    │                       │<~~ confirmation result ~~~~~~~~~~~~~~~~~~~~~~~│
    │                       │                                                │
    │                       │~~ getBooking(bookingId) ~~~~~~~~~~~~~~~~~~~~~>│
    │                       │<~~ price, status, ticketUrl ~~~~~~~~~~~~~~~~~│
    │                       │                                                │
    │                       │  Map status                                    │
    │                       │  Apply markup to final price                   │
    │                       │  Emit structured log event                     │
    │                       │                                                │
    │<── { id, status:      │                                                │
    │     "approved",       │                                                │
    │     voucher_url,      │                                                │
    │     total_price }     │                                                │
```

### Simplification: TC vs F3

| TC | F3 | Savings |
|---|---|---|
| DynamoDB BookingCache read | Redis or re-derive from booking_id | No DynamoDB |
| Credit line check (feature-flagged) | TBD — discuss if 12go manages billing | May eliminate |
| Two-phase price calculation (estimated + final) | Single price from 12go + markup | Simpler |
| PostgreSQL BookingEntity persistence | Not needed for new clients (12go is source of truth) | No local DB write |
| 4 Kafka events | 1 structured log event | Simpler observability |
| 320s total timeout (20s + 300s) | Standard timeout | Question: what's 12go's typical confirm latency? |

---

## 6. CancelBooking Flow

### 12go Two-Step Cancellation

```
B2B Client              F3 (PHP/Symfony)                                 12go Internal (in-process)
    │                       │                                                │
    │── POST /cancel ──────>│                                                │
    │                       │                                                │
    │                       │~~ getRefundOptions(bookingId) ~~~~~~~~~~~~~~>│
    │                       │<~~ { available: true,                          │
    │                       │     options: [{ refund_amount,                 │
    │                       │       refund_fxcode, hash }] } ~~~~~~~~~~~~~~│
    │                       │                                                │
    │                       │  Select option with max refund_amount          │
    │                       │                                                │
    │                       │~~ refundBooking(bookingId, option) ~~~~~~~~~>│
    │                       │   { hash, refund_fxcode, refund_amount }       │
    │                       │<~~ { success: true } ~~~~~~~~~~~~~~~~~~~~~~~~│
    │                       │                                                │
    │<── { booking_status:  │                                                │
    │     "cancelled",      │                                                │
    │     refund: {amount,  │                                                │
    │     currency} }       │                                                │
```

### Key Decision: Whose Refund Amount?

| Approach | Description | Trade-off |
|---|---|---|
| **Use 12go's refund_amount** | Return the `refund_amount` from refund-options directly | Simple, but 12go controls the amount |
| **Calculate own refund** (TC today) | Use stored cancellation policies + departure time + timezone to calculate | Complex, requires local state, but gives control |

**TC today**: Calculates its own refund using `RefundCalculator` based on `CancellationPolicies` stored at booking time. Logs a warning if it differs from 12go's amount.

**Recommendation for F3**: Use 12go's `refund_amount` directly (Vlad's revenue changes align with this). Eliminates need for local cancellation policy storage and timezone calculations.

---

## 7. GetBookingDetails & GetTicket

### GetBookingDetails

**TC today**: Reads from local PostgreSQL (NOT from 12go API at runtime).

**F3 approach**: Call `getBooking(bookingId)` in-process directly.

| 12go field | TC contract field | Notes |
|---|---|---|
| `bid` | `id` | Use 12go native ID |
| `tracker` | `operator_booking_id` | |
| `status` | `status` | Map: confirmed→approved, etc. |
| `from_id` | `from_station` | String conversion |
| `to_id` | `to_station` | String conversion |
| `dep_date_time` | `departure_time` | Parse to ISO 8601 |
| `seats` | `passenger_count` | |
| `ticket_url` | `voucher_url` | Direct URL or re-host? |
| `created_on` (unix) | `created_at` | Unix → ISO 8601 |
| `seller_price` | `total_price` | Apply markup if needed |

### GetTicket

**TC today**: Either generates its own branded PDF (for whitelisted integrations) or downloads 12go's PDF, re-uploads to S3, and returns a CloudFront signed URL.

**F3 approach options**:

| Option | Effort | Tradeoff |
|---|---|---|
| **A: Pass through 12go's `ticket_url`** | Minimal | No branding control, depends on 12go URL stability |
| **B: Download + re-host on S3** | Medium | Branding control, URL stability, but adds infra |
| **C: Generate own PDF** | High | Full branding, but significant effort (Razor templates, QR, maps) |

**Avikhai's input (Mar 25)**: "This is what we get today. We don't do anything." — suggesting Option A is acceptable.

---

## 8. State Management

### What Must Persist Between Steps

| From → To | Data Needed | Current (TC) | Proposed (F3) |
|---|---|---|---|
| GetItinerary → CreateBooking | Field name mapping (NameToSupplierName) | DynamoDB PreBookingCache + SI Redis | Redis (single cache) |
| GetItinerary → CreateBooking | BookingSchemaDictionary (enum translations) | DynamoDB PreBookingCache | Redis |
| GetItinerary → CreateBooking | Booking schema (for validation) | DynamoDB PreBookingCache | Redis |
| GetItinerary → CreateBooking | cartId | Encoded in BookingToken | Encoded in booking_token |
| GetItinerary → CreateBooking | seatCount | Encoded in BookingToken | Encoded in booking_token |
| GetItinerary → CreateBooking | Locked seats | DynamoDB PreBookingCache | Redis |
| CreateBooking → ConfirmBooking | bookingId (12go's BId) | DynamoDB BookingCache | In response to client (or Redis) |
| CreateBooking → ConfirmBooking | Price baseline | DynamoDB BookingCache | Redis or re-fetch |

### Booking Token Design

**TC today**: KLV-encoded, Caesar-cipher encrypted string containing contractCode, integrationId, cartId, seatCount, uniqueId.

**F3 options**:

| Option | Contents | Pro | Con |
|---|---|---|---|
| **Signed JWT** | cartId, seatCount, clientId, expiry | Standard, tamper-proof | Larger token |
| **Encrypted JSON** | Same | Compact, opaque | Need key management |
| **Redis key** | UUID → {cartId, seatCount, ...} in Redis | Minimal token size | Extra Redis lookup |
| **Plain cartId** | Just the cartId | Simplest | Leaks internal ID, no metadata |

### Redis Cache Structure (Proposed)

```
Key: b2b:schema:{cartId}
TTL: 3 hours
Value: {
  "name_to_supplier": { "seat_selection": "selected_seats_TH01...", "baggage": "passenger[0][baggage_PH01...]", ... },
  "schema_dictionary": { "gender": { "Male": "M", "Female": "F" }, "id_type": { "Passport": "0", ... } },
  "booking_schema": { ... JSON Schema ... },
  "price": { "amount": 1500, "currency": "THB" },
  "operator_id": "OP123"
}

Key: b2b:booking:{bookingId}
TTL: 24 hours
Value: {
  "cart_id": "...",
  "status": "reserved",
  "price": { ... }
}
```

---

## 9. Validation — What TC Does Today

### Schema-Driven Validation (CreateBooking)

TC validates the submitted `booking_data` against the JSON Schema stored in PreBookingCache:

1. **Required fields**: All fields marked `required: true` in the schema must be present
2. **Type checking**: Field values must match declared type (input→string, select→one of options, checkbox→boolean)
3. **Regex patterns**: If the schema includes `regexp`, the value must match at least one pattern
4. **Enum values**: For `select` fields, the value must be one of the declared `options[].value`
5. **Passenger count**: Number of passengers must match seatCount from BookingToken

### Validations TC Applies That 12go Also Applies

| Validation | TC (Denali) | 12go |
|---|---|---|
| Required fields | JSON Schema check | Also validates on reserve |
| Regex patterns | Normalized PHP→.NET regex | Original PHP regex |
| Enum values | From stored options | Also validates on reserve |
| Passenger count | Against seatCount | Against cart pax count |
| Price check | Estimated vs final comparison | Own price validation |

### Should F3 Validate?

**Shauly (Mar 25)**: "When we have good validations at the beginning we get better results."

**Recommendation**: Validate on the F3 side before sending to 12go. Benefits:
- Better error messages (translate 12go's generic errors to specific field-level errors)
- Fail fast without burning an API call
- Matches TC behavior (clients expect TC-style error responses)

**Advantage in PHP**: The regex patterns from 12go are PHP-native PCRE — no normalization needed.

---

## 10. F3 Implementation Approach

### Architecture: 3-Layer for Booking Funnel

```
┌─────────────────────────────────────────┐
│  Handler Layer (Symfony Controllers)     │
│  - Route: /v{ver}/{client}/itineraries  │
│  - Route: /v{ver}/{client}/bookings     │
│  - Request validation, response mapping │
│  - BookingToken encode/decode           │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Mapper Layer (Schema Parser)            │
│  - Parse 12go checkout → BookingSchema   │
│  - Build NameToSupplierName mapping      │
│  - Translate TC booking_data → 12go body │
│  - Enum translation                      │
│  - Seat layout normalization             │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  12go Client (TwelveGoClientInterface)   │
│  - GetTripDetails()                      │
│  - AddToCart()                           │
│  - GetCheckout()                         │
│  - Reserve()                             │
│  - Confirm()                             │
│  - GetBookingDetails()                   │
│  - GetRefundOptions() + Refund()         │
└─────────────────────────────────────────┘
```

### PHP Advantages for Schema Parser

| Aspect | C# (current) | PHP (proposed) |
|---|---|---|
| Regex patterns | Must normalize PHP PCRE → .NET regex | **Native PCRE** — use as-is |
| Dynamic JSON | `JsonExtensionData` + computed properties | `json_decode()` → associative array, natural dynamic access |
| Pattern matching | `StartsWith`, `EndsWith`, `Contains` on `ExtensionData` | `str_starts_with`, `str_ends_with`, `str_contains` — identical |
| Bracket-notation serialization | Custom `Utf8JsonWriter` / `JsonConverter` (152 lines) | String concatenation or `http_build_query` patterns |
| Lines of code estimate | ~1,180 (schema) + ~394 (builder) + ~130 (translator) | Estimated **400-600 lines** (no regex normalization, simpler JSON) |

### Implementation Sequence (Within Booking Funnel)

| Step | Task | Depends On | Estimated Effort |
|---|---|---|---|
| 1 | GetItinerary **without schema** | Search POC patterns | Medium (1 week) |
| 2 | Booking schema parser | Step 1 (need cartId) | **High (1-2 weeks)** |
| 3 | CreateBooking (reserve) | Steps 1+2 | High (1 week) |
| 4 | ConfirmBooking | Step 3 | Medium (2-3 days) |
| 5 | GetBookingDetails | Independent | Low (1-2 days) |
| 6 | GetTicket | Independent | Low (1 day) |
| 7 | CancelBooking | Independent | Low (2-3 days) |

### Can We Bypass the Schema Parser? (Eyal's Proposal)

**Eyal suggested (Mar 25)**: Call F3's internal business logic to get the object model directly, rather than going through the checkout API.

**Investigation needed**:
- Does F3 have an internal method that returns booking form fields in a structured format (not the flat bracket-notation JSON)?
- If so, can we call it directly from our B2B handler?
- Would this eliminate the need for pattern matching and name mapping?

**If yes**: Schema parser simplifies dramatically — just translate the structured internal model to TC contract format.

**If no**: Port the parser logic to PHP (~400-600 lines estimated).

---

## 11. Key Questions for Shauly

### Booking Schema

1. **Can we explore the internal F3 method for booking forms?** If there's a structured internal representation, we can skip the entire bracket-notation parsing. Who can we ask? Sana? Valeri?

2. **Is the booking schema sent to the client in TC's JSON Schema format, or can we use a simpler format for new clients?** The current JSON Schema format was designed for TC's existing clients. New clients could accept a different format.

### State Management

3. **Redis TTL for schema cache** — The cart in 12go has its own TTL. Should our schema cache match, or should we re-fetch from 12go if the cache expires?

4. **Booking token format** — Signed JWT vs encrypted JSON vs Redis-backed UUID? What level of security/tamper-proofing do we need?

### Validation

5. **Should F3 validate booking_data before calling 12go's reserve?** TC does this. 12go also validates. Do we need the double check? (Recommendation: yes, for better error messages.)

### Pricing

6. **Markup for new clients** — Is there per-client markup? Or do new clients get 12go's raw prices? If no markup, GetItinerary and CreateBooking simplify significantly.

7. **Which price does the client see?** 12go's net price + our markup? Or 12go's gross price? This affects what we store and return.

### Cancel

8. **Can we use 12go's refund_amount directly?** Instead of calculating our own refund from cancellation policies?

### GetTicket

9. **Is passing through 12go's ticket_url acceptable for new clients?** Or do we need to re-host on S3?

### General

10. **Integration test environment** — Can we test the full booking funnel end-to-end against 12go's staging/test environment? What test credentials do we have?
