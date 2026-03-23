# Booking Funnel Endpoint Group — Research

---

## Endpoint: GetItinerary (Checkout Initiation)

### One-line description

When a user selects a trip from search results, GetItinerary fetches full itinerary details, pricing with markup, seat layout, booking schema (which passenger fields to collect), and generates an encrypted `BookingToken` needed for subsequent booking steps.

### 12go API calls (sequential)

| Order | Method | Path | Purpose |
|-------|--------|------|---------|
| 1 | `GET` | `/trip-details?trip_id={tripId}&date={departureDate}&pax={numberOfSeats}` | Fetch full trip details, validate availability, get travel options and seat classes |
| 2 | `POST` | `/add-to-cart` | Reserve a cart slot for this trip. Body includes `tripId`, `numberOfSeats`, `travelOptionId`. Returns `cartId` which becomes the product identifier for all subsequent calls |
| 3 | `GET` | `/checkout/{cartId}?people={pax}` | Get checkout form definition: required passenger fields, seat layout, baggage options, pickup/dropoff points. Returns the dynamic bracket-notation form fields that the Booking Schema Parser must parse |

**Internal itinerary variant** (for itinerary IDs starting with `SharedConstants.IdPrefix`): Uses a different sequence: `POST /add-to-cart` (different body format) then `GET /cart-details` then `GET /trip-details`, then maps itinerary.

### F3 internal services (Team-First Developer design)

| PHP Class | Responsibility |
|-----------|---------------|
| `BookingController.php` | Handles GetItinerary HTTP endpoint within the booking funnel controller |
| `TwelveGoClient.php` | Makes all three 12go HTTP calls (GetTripDetails, AddToCart, GetBookingSchema/checkout) |
| `BookingSchemaMapper.php` | The complex mapper (~1,180 lines equivalent) that parses dynamic bracket-notation form fields from `/checkout/{cartId}` into a normalized JSON Schema. This is explicitly called out as "the most critical test file" in the design |
| `ClientKeyResolver.php` | Resolves `client_id` to 12go API key for outbound calls |
| `B2bRequestSubscriber.php` | Correlation ID propagation, client context extraction |

The Team-First Developer design places this under `frontend3/src/B2bApi/Controller/BookingController.php` with the mapper in `frontend3/src/B2bApi/Service/BookingSchemaMapper.php`.

### Known challenges

| Challenge | Severity | Detail |
|-----------|----------|--------|
| **Booking Schema Parser port** | **Blocking** | ~1,180 lines of parsing logic across two parallel codebases (supply-integration + denali) that handles dynamic bracket-notation field names with embedded cart IDs. Must parse 4 categories of dynamic keys, build normalized booking schema, store field name mappings, and later reconstruct original bracket-notation keys for the reserve request. This is the single largest technical risk in the entire booking funnel |
| **BookingToken generation and management** | **Manageable** | Current system uses KLV-encoded token with Caesar cipher encryption. The token carries `contractCode`, `integrationId`, `integrationBookingToken` (cartId), `seatCount`, `uniqueId`. New system can simplify to signed JWT or simpler token since the multi-layer abstraction is removed |
| **Dual caching elimination** | **Manageable** | Current system double-caches: Redis at SI level (price, operatorId, field name mappings) AND DynamoDB at Denali level (itinerary, booking schema). New system uses Redis only (per recommendation D6). PHP-FPM per-request model requires external cache |
| **Markup and exchange rate calculation** | **Manageable** | Core business logic that must be preserved. Integration points simplify without multi-layer architecture. F3 likely has existing markup infrastructure to leverage |
| **ID transformation simplification** | **Low risk** | Current flow juggles: `SearchItineraryId` -> `ItineraryId` -> `integrationProductId` -> `cartId` -> `NextFlowItineraryId` -> `BookingToken`. New system can use a simpler ID scheme since there is no SI framework abstraction layer |
| **Caesar cipher encryption decision** | **Low risk** | Open question whether IDs/tokens need encryption in the new system. The `PlainItineraryIdPerClient` feature flag suggests movement toward plain IDs. Decision deferred to implementation time |

### Proposed approach (all presumptive)

- **Presumptive**: Port the Booking Schema Parser first (weeks 1-2 per recommendation timeline). Use existing C# test fixtures (3 real checkout payloads + 1 comprehensive synthetic fixture) as input for PHP test cases. AI-assisted translation from C# parsing logic to PHP. If not code-complete with passing tests by week 3, reassess timeline.
- **Presumptive**: Replace BookingToken with a simpler signed token or structured ID that carries `cartId` + `seatCount` + `clientId`. Eliminate Caesar cipher.
- **Presumptive**: Use Redis (F3's existing Redis) as the single cache layer for itinerary data and booking schema between funnel steps. APCu for static mapping data (station IDs, operator IDs).
- **Presumptive**: Call 12go's three APIs directly from `TwelveGoClient.php` with no SI framework, no Etna SI Host HTTP hop, no SupplierAdapterFactory, no SiObjectMapper transformations.
- **Presumptive**: Emit structured log events for `checkout.requested`, `checkout.responded`, `checkout.failed` (replacing Kafka events) per the Data Flow Architect overlay.

### Open questions

1. **Can we eliminate itinerary caching entirely?** If the BookingToken carries enough context (cartId, pricing snapshot), could we re-fetch from 12go during CreateBooking instead of caching? Trade-off: extra API calls vs cache complexity.
2. **What analytics depend on the Kafka checkout events?** (CheckoutRequested, CheckoutResponded, CheckoutFailed, BookingSchemaRequested/Responded/Failed). Which downstream consumers exist and do they need equivalent structured log events?
3. **Is the internal itinerary variant (`SharedConstants.IdPrefix`) still used?** If not, this entire branch can be dropped.
4. **ExperimentId / FlowId in SearchItineraryId** -- Are A/B experiments still active? If not, these fields can be removed from the ID scheme entirely.
5. **ItineraryCache TTL (7200 minutes = 5 days)** -- Is this TTL appropriate? What happens if a user returns to checkout after cache expires?
6. **Contract and Integration resolution** -- `IntegrationResolverService.ResolveIntegration()` and `ContractService.ResolveContract()` -- are these simple config lookups or external service calls? In the new system, `ClientKeyResolver.php` replaces them with a simple table lookup.
7. **Field name translation (`NameToSupplierNameFields`)** -- In a direct 12go integration, is this translation still needed or can we use 12go field names directly? (Answer from analysis: YES, still needed -- the dynamic bracket-notation keys embed cart-specific IDs that change per booking, so the mapping must be stored per session.)

---

## Endpoint: CreateBooking (Reserve)

### One-line description

After the user fills the checkout form, CreateBooking submits passenger data and seat selections to 12go to reserve a booking, validates the submitted data against the cached booking schema, checks credit line, calculates pricing with markup, and returns a `Booking` object with status `reserved`.

### 12go API calls (sequential)

| Order | Method | Path | Purpose |
|-------|--------|------|---------|
| 1 | `POST` | `/reserve/{bookingId}` | Submit passenger data to create the reservation. `bookingId` = cartId from the GetItinerary step. Request body is a flat bracket-notation JSON (e.g., `passenger[0][first_name]`, `contact[mobile]`). Returns `OneTwoGoReserveBookingResult` with `BId` (the 12go booking ID) |
| 2 | `GET` | `/booking/{BId}` | Fetch booking details after reservation to get the seller price (`SellerPrice.NetPrice` + `SellerPrice.FxCode`). This is an additional round-trip -- the reserve response itself does not include pricing |

### F3 internal services (Team-First Developer design)

| PHP Class | Responsibility |
|-----------|---------------|
| `BookingController.php` | Handles CreateBooking HTTP endpoint |
| `TwelveGoClient.php` | Calls `POST /reserve/{bookingId}` and `GET /booking/{BId}` |
| `ReserveRequestBuilder.php` | Builds the flat bracket-notation JSON body for the reserve call. Must reconstruct dynamic field names from the stored `NameToSupplierName` mapping. This is the reverse of the schema parser -- it takes normalized TC booking data and produces the supplier-specific bracket-notation format |
| `BookingSchemaMapper.php` | Validates submitted booking_data against the cached JSON Schema |
| `BookingDetailsMapper.php` | Maps 12go reservation response to TC `Booking` response format |
| `ClientKeyResolver.php` | Resolves 12go API key |

### Known challenges

| Challenge | Severity | Detail |
|-----------|----------|--------|
| **Reserve request assembly** | **Blocking** | Must reconstruct the exact bracket-notation field names (e.g., `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`) from the stored field name mapping. The `ReserveDataRequest` serialization is ~162 lines of custom JSON writing. Each passenger's baggage key includes the cart-specific ID and must be reconstructed with the correct passenger index via `AddPassengerIndex()` logic |
| **Schema validation** | **Manageable** | Must validate the submitted `booking_data` against the JSON Schema built during GetItinerary. In PHP, this requires a JSON Schema validation library (e.g., `justinrainbow/json-schema`). The schema is dynamic per booking |
| **Two-phase price calculation** | **Manageable** | Current system calculates estimated price before calling supplier, then recalculates with supplier's actual cost. New system can simplify by trusting supplier's price directly, but must still apply markup |
| **Credit line check** | **Manageable** | Credit line check happens after supplier reservation succeeds. If credit check fails, the supplier reservation is potentially orphaned. This is an existing issue, not a new one |
| **Enum translation** | **Low risk** | `SchemaTranslator.TranslateEnums()` translates between Denali's schema definitions and supplier-specific values. In a direct integration, this simplifies to a straightforward mapping using the `BookingSchemaDictionary` stored during GetItinerary |

### Proposed approach (all presumptive)

- **Presumptive**: Port `ReserveRequestBuilder.php` using the same test-fixture-driven approach as the schema parser. Existing C# `FromRequestDataToReserveDataConverter` (152 lines) and `ReserveDataRequest.SerializeAsString()` (162 lines) are the reference implementations. The output format is well-defined (flat bracket-notation JSON).
- **Presumptive**: Use a PHP JSON Schema validation library to validate booking_data against the cached schema. This replaces the C# `IReserveDataValidator`.
- **Presumptive**: Simplify pricing: call 12go's reserve, get the price from `GetBookingDetails`, apply markup once. Eliminate the two-phase estimate-then-recalculate pattern.
- **Presumptive**: Store booking state in Redis between reserve and confirm steps. Key = booking ID (12go `BId` or new ID), value = pricing + station info + passenger count. Replaces DynamoDB `BookingCacheModel`.
- **Presumptive**: Emit `booking.created` structured log event (replacing Kafka `BookRequested` + `BookSucceeded` / `BookFailed`).

### Open questions

1. **Credit line check timing** -- The credit check happens AFTER the supplier reservation succeeds. What happens if credit fails? Is the supplier reservation orphaned? How is cleanup handled?
2. **Price mismatch tolerance** -- What is the acceptable threshold between estimated and supplier-returned prices? Is there a tolerance logic?
3. **Extra GetBookingDetails call** -- After reserve, the system calls `GET /booking/{BId}` to get pricing. Could the reserve response itself be extended to include pricing, eliminating this round-trip?
4. **Async flow (202 Accepted)** -- The `EnableAsyncFlow` feature flag wraps the call for slow suppliers. Does 12go actually trigger this? If not, the async/polling pattern can be dropped.
5. **BookingEntity event consumers** -- Which downstream systems depend on the `BookingEntity` Kafka event (behind `PublishReserveBookingEvents` flag)?
6. **Locked seats override** -- If seats were locked via SeatLock, the `seat_selection` in the request is silently overridden with cached locked seats. Is this behavior documented for clients?

---

## Endpoint: ConfirmBooking

### One-line description

After a successful reservation, ConfirmBooking finalizes the booking with the supplier, retrieves final pricing and ticket URL, updates booking status to `Approved` or `Pending`, persists the confirmed booking to PostgreSQL, and returns the updated `Booking` object with voucher URL.

### 12go API calls (sequential)

| Order | Method | Path | Purpose |
|-------|--------|------|---------|
| 1 | `POST` | `/confirm/{bookingId}` | Confirm the reservation with 12go. `bookingId` = the `BId` returned from the reserve step |
| 2 | `GET` | `/booking/{bookingId}` | Fetch booking details post-confirmation to get final price, status, ticket URL, and operator tracking ID |

### F3 internal services (Team-First Developer design)

| PHP Class | Responsibility |
|-----------|---------------|
| `BookingController.php` | Handles ConfirmBooking HTTP endpoint |
| `TwelveGoClient.php` | Calls `POST /confirm/{bookingId}` and `GET /booking/{bookingId}` |
| `BookingDetailsMapper.php` | Maps 12go booking details response to TC `Booking` response format. Extracts: `SellerPrice.NetPrice` -> `Cost.Amount`, `SellerPrice.FxCode` -> `Cost.Currency`, `Status` -> mapped `BookingStatus`, `TicketUrl` -> `VoucherUrl`, `Tracker` -> `OperatorBookingId` |
| `ClientKeyResolver.php` | Resolves 12go API key |

### Known challenges

| Challenge | Severity | Detail |
|-----------|----------|--------|
| **Timeout handling** | **Manageable** | Current system has a 20s primary timeout + 300s additional timeout (320s total). This seems designed for slow suppliers. Need to determine 12go's actual confirm latency. If 12go is fast, a single reasonable timeout (e.g., 30s) suffices |
| **Dual DB writes** | **Manageable** | Currently writes to both DynamoDB (BookingCacheService.UpdateBookingFunnelStatus) AND PostgreSQL (PostBookingService). Per the no-persistence design decision (Mar 12 meeting), the new system eliminates local DB storage and relies on 12go as source of truth. This means no local persistence at all for confirms |
| **ConfirmationProcessingIncomplete handling** | **Low risk** | Special handling for suppliers that return incomplete confirmations (status=Pending). Need to verify if 12go ever exhibits this behavior. If not, the entire `SaveConfirmationInProcess` branch is dead code for 12go |
| **Price recalculation at confirm time** | **Low risk** | `CalculateConfirmPrice` recalculates pricing from multiple cache sources. If reserve-time pricing is trusted, this simplifies to: get price from `GetBookingDetails`, apply markup |
| **Feature flag cleanup** | **Low risk** | At least 6 feature flags control the current confirm flow: `ConfirmSwitch`, `CreditLineSwitch`, `UseOldFlowPerClient`, `EnableAsyncFlow`, `PublishConfirmBookingEvents`, `KafkaPublishSwitch`. None needed in the new system |

### Proposed approach (all presumptive)

- **Presumptive**: Single timeout of 30s for the confirm call (investigate 12go's actual latency first).
- **Presumptive**: No local persistence on confirm. 12go is the source of truth per the no-persistence design decision. Drop DynamoDB writes and PostgreSQL writes entirely.
- **Presumptive**: Price calculation: get price from `GET /booking/{bookingId}` response, apply markup once. No two-phase estimate/recalculate.
- **Presumptive**: Emit `booking.confirmed` structured log event.
- **Presumptive**: Drop the `ConfirmationProcessingIncomplete` branch unless 12go is verified to produce this state.

### Open questions

1. **Is the 320s total timeout actually needed for 12go?** What is 12go's typical confirm latency?
2. **Can DynamoDB booking cache be fully eliminated?** Per no-persistence decision, yes -- but what reads depend on `BookingCacheModel` after confirmation? Are there any post-confirm flows that read from this cache?
3. **What consumes `ReservationConfirmationSucceeded` Kafka event?** Is it only for post-booking persistence, or do other services depend on it?
4. **What happens when `PostBookingClient.Send()` fails?** Currently the exception is caught and logged but NOT rethrown -- confirm returns success to client even if persistence fails. In the new system (no persistence), this is irrelevant.
5. **Credit line check happens twice** -- once at reserve and again at confirm. Is the confirm-time check necessary?
6. **Cancellation policies** -- Currently fetched from ItineraryCache at confirm time. Per the no-persistence decision, these would need to be fetched from 12go. But cancellation policy is returned on search/get itinerary, NOT on get booking details. Where does the new system get cancellation policies for confirmed bookings?

---

## Endpoint: SeatLock (LockSeats)

### One-line description

An optional step between GetItinerary and CreateBooking that allows clients to pre-select specific seats; since 12go does not support native seat locking, this endpoint validates seat availability against the live checkout schema and stores the selection in cache, which is later used to override seat selection during CreateBooking.

### 12go API calls

| Order | Method | Path | Purpose |
|-------|--------|------|---------|
| 1 | `GET` | `/checkout/{cartId}` (via GetBookingSchema) | Re-fetch current seat availability from 12go to validate that the requested seats are still available. This is the ONLY 12go call -- there is no actual lock API |

**12go native seat lock is in active development** -- confirmed by management. Once 12go ships native seat lock, the endpoint can pass through directly instead of using the fallback validation path.

### F3 internal services (Team-First Developer design)

| PHP Class | Responsibility |
|-----------|---------------|
| `BookingController.php` | Handles SeatLock HTTP endpoint |
| `TwelveGoClient.php` | Calls `GET /checkout/{cartId}` to re-fetch seat availability |
| `BookingSchemaMapper.php` | Parses the refreshed checkout response to extract available seats from the `seat_selection` field's `AnyOf` values |
| `ClientKeyResolver.php` | Resolves 12go API key |

### Known challenges

| Challenge | Severity | Detail |
|-----------|----------|--------|
| **Race condition** | **Manageable** | Between SeatLock (validates + caches) and CreateBooking (uses cached seats), another user could book those seats. The validation gives a point-in-time check, not a reservation. This is an inherent limitation until 12go ships native seat lock |
| **Dual validation path** | **Low risk** | Current system has `IsSeatLockSupported()` branching for suppliers that support native lock vs fallback. Since 12go always takes the fallback path, this branching is unnecessary in the new system. Single path: validate against live schema, cache selection |
| **Schema re-fetch overhead** | **Low risk** | The fallback path calls `GET /checkout/{cartId}` again (same call made during GetItinerary). This is an extra round-trip to validate seats. Could potentially use the cached schema if it's recent enough, but the live check is safer |
| **Price returned at lock time** | **Low risk** | Current system calculates and returns a `total_price` in the lock response. This price is recalculated during CreateBooking anyway. Could simplify by omitting price from lock response (but this changes the API contract) |

### Proposed approach (all presumptive)

- **Presumptive**: Single validation path only (no `IsSeatLockSupported()` branching). Re-fetch checkout schema from 12go, extract `seat_selection` field, validate requested seats are in the available set.
- **Presumptive**: Store locked seats in Redis under the booking session key. Retrieved during CreateBooking to override seat selection.
- **Presumptive**: Keep the price calculation for API contract compatibility but simplify to a single calculation pass.
- **Presumptive**: When 12go ships native seat lock, update `TwelveGoClient.php` to call the new API directly instead of the validation-only fallback.
- **Presumptive**: Consider making this endpoint a stub that only validates + caches (weeks 6-7 per timeline), since it is an optional step and the race condition exists regardless.

### Open questions

1. **Is the seat lock step actually used by clients for 12go?** Since it does not actually lock anything on the supplier side, is this step mandatory or optional in client flows?
2. **Can the lock step be eliminated entirely?** Seat validation could be done at reserve time instead, removing the separate endpoint call.
3. **When will 12go's native seat lock ship?** This determines whether the fallback path is temporary or permanent.
4. **Should the schema re-fetch be skipped if the cached schema is < N minutes old?** Saves a round-trip but risks stale availability data.

---

## Booking Schema Parser (Detailed Technical Analysis)

This is the **single biggest technical risk** in the booking funnel. The parser handles approximately 1,180 lines of logic across two parallel codebases (supply-integration + denali), plus ~394 lines in the denali `OneTwoGoBookingDefinitionBuilder` and ~130 lines in `ReserveDataTranslator`.

### What it does

The 12go `/checkout/{cartId}` endpoint returns a flat JSON object where every top-level key is a bracket-notation form field name (e.g., `passenger[0][first_name]`, `selected_seats_TH013r013800Cb00603SPY6d`). Several keys embed a **dynamic, trip-specific cart identifier** that changes for every booking. The parser must:

1. Scan response keys with pattern matching to identify field categories
2. Build a normalized `BookingSchema` / `BookingDefinitions` data structure
3. Record a `NameToSupplierName` mapping from internal field names to the exact supplier-generated key names
4. Persist that mapping across an HTTP request boundary (Redis cache in new system)
5. Later (during reserve), reconstruct the original bracket-notation keys from the mapping when assembling the `/reserve` POST body

### Dynamic field categories

There are **4 categories** of dynamic keys (keys with embedded cart IDs):

#### 1. Seat selection: `selected_seats_{cartId}`

- Key pattern: `selected_seats_{cartId}` (no `_allow_auto` suffix)
- Real example: `selected_seats_TH013r013800Cb00603SPY6d`
- Contains: full seatmap, layout data, per-seat availability and pricing
- The seatmap layout field is typed as raw `JsonElement` and can be any of 4 structural variants:
  - Array of arrays (`[[...], [...]]`)
  - Object keyed by row number where values are arrays (`{ "1": [...], "2": [...] }`)
  - Nested object keyed by row with inner objects keyed by column, each containing arrays
  - Simple dictionary of row -> column -> seatId strings
- `BuildSections()` (381 lines in `OneTwoGoBookingSchemaExtraBuilder.cs`) dispatches between these 4 variants at runtime
- Legacy `LegacyDeonibusLayoutConverter` (271 lines) handles an older per-operator format, activated by checking against `legacyOperatorIds` config. Post-migration this can be dropped.

#### 2. Seat auto-allow: `selected_seats_{cartId}_allow_auto`

- Key pattern: `selected_seats_{cartId}_allow_auto`
- Real example: `selected_seats_TH013r013800Cb00603SPY6d_allow_auto`
- Lightweight: contains only a `name` property
- Deserialized into `AutoAllowFormField` type

#### 3. Baggage: `passenger[0][baggage_{cartId}]`

- Key pattern: `passenger[0][baggage_{cartId}]`
- Real example: `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`
- Value is a `select` field with price-bearing options (e.g., carry-on vs 10 kg prepaid at 450 PHP)
- During reserve, the baggage key must be reconstructed per passenger: `passenger[{i}][baggage_{cartId}]` using `AddPassengerIndex()` logic that splits the stored template on `[`, `][`, `]` separators

#### 4. Points / delivery fields (pickup, dropoff, flight info)

Key patterns (all prefixed with `points` or `delivery`, brackets contain the cart ID):

- `points[{cartId}][pickup]`
- `points[{cartId}][dropoff]`
- `points[{cartId}][pickup_text]`
- `points[{cartId}][dropoff_text]`
- `points[{cartId}][current_city]`
- `points[{cartId}][flight_arr_time]`
- `points[{cartId}][flight_dep_time]`
- `points[{cartId}][flight_no]`
- `points[{cartId}][airline]`
- `points[{cartId}][number_luggage]`
- `points[{cartId}][address]`
- `points[{cartId}][additional_information]` or `points[{cartId}][additional_info]`
- `points[{cartId}][drop_off_point]`
- `points[{cartId}][point]` (pickup point)
- `delivery[{cartId}]` or similar prefix
- `delivery[{cartId}][address]`
- `delivery[{cartId}][hotel_checkin_date]`

Real example: `points[JP0zJM0rPO46Yb0R402TFAOi][pickup]`

The builder calls `NormalizeName()` which strips the bracket-encoded cart ID from the key and lowercases remaining segments joined with `_` (e.g., `points[JP0zJM0rPO46Yb0R402TFAOi][pickup]` -> `points_pickup`). If two fields normalize to the same name, a `"1"` suffix is appended (deduplication).

### Fixed fields (always present, deterministic keys)

20 properties declared with explicit `[JsonPropertyName]` decorators:

- `contact[mobile]`, `contact[email]`
- `passenger[0][first_name]`, `passenger[0][last_name]`, `passenger[0][middle_name]`
- `passenger[0][id_no]`, `passenger[0][id_type]`, `passenger[0][id_exp_date]`, `passenger[0][id_issue_date]`
- `passenger[0][country_id]`, `passenger[0][gender]`, `passenger[0][is_child]`
- `passenger[0][dob]`, `passenger[0][id_scan]`
- `passenger[0][seattype_code]`, `passenger[0][title]`
- `passenger[0][visa_type]`, `passenger[0][visa_reason]`
- `seats`

Dynamic fields land in a `[JsonExtensionData] Dictionary<string, JsonElement>` catch-all and are extracted by computed properties using `StartsWith`, `EndsWith`, and `Contains` predicates.

### Multi-passenger handling

- Regex patterns: `passenger[1-20][...]` fields are matched by `AdditionalPassengers = @"^passenger\[([1-9]|1[0-9]|20)\].*$"` and `FromFirstPassenger = @"^passenger\[([0-9]|1[0-9]|20)\].*$"`
- During schema parsing: passenger[1+] fields are **silently skipped** (only passenger[0] schema is used as the template)
- During reserve request assembly: the template from passenger[0] is replicated for each passenger with the index substituted

### Each field's value structure (`FormField`)

```json
{
  "type": "input" | "select" | "checkbox" | "date" | "file",
  "name": "<bracket-notation field name>",
  "title": "<human-readable label>",
  "required": true | false,
  "regexp": ["<PHP-style validation regex>"],
  "options": [{ "value": "...", "text": "...", "data": { "price": { "value": ..., "fxcode": "..." } } }],
  "data": { "seatmap": { ... } }
}
```

The `options` field may contain nested `values` arrays (used for nationality/country): `{ "value": null, "text": "Popular", "values": [{ "value": "AR", "text": "Argentina" }, ...] }`

### Regex normalization

The checkout response embeds PHP-style regexes (e.g., `\/^[\s\pCA-Za-z\x{0E00}-\x{0E7F}]{2,30}$\/u`). `RegexNormalizer.Normalize()` (43 lines) converts these to .NET-compatible patterns by stripping PCRE delimiters and translating `\x{HHHH}` escapes. On failure (`RegexParseException`), it returns `null`, silently dropping the validation constraint.

**PHP advantage**: In the new PHP system, the PHP-style regexes from 12go can potentially be used directly without conversion, since PHP natively supports PCRE. This eliminates the `RegexNormalizer` entirely.

### Seat pricing differential

For `SelectedSeats`, the builder applies a price differential: `seat.Price.Value - basePrice` so seat upgrade costs are shown as incremental amounts rather than absolute prices (supply-integration `OneTwoGoSchemaBuilder.BuildBookingSchema()` lines 57-70).

### Two parallel implementations (duplication)

| Codebase | Entry point | Parser | Reserve assembler |
|----------|-------------|--------|-------------------|
| **supply-integration** (new path) | `OneTwoGoBookingSchema.GetBookingSchema()` | `OneTwoGoSchemaBuilder.BuildBookingSchema()` (285 lines) + `OneTwoGoBookingSchemaExtraBuilder` (381 lines) | `OneTwoGoBookingSchema.GetBookingRequest()` + `FromRequestDataToReserveDataConverter` (152 lines) |
| **denali** (legacy path) | `OneTwoGoCheckoutService.CheckoutWithParsedResponse()` | `OneTwoGoBookingDefinitionBuilder` (394 lines, large switch statement) | `ReserveDataTranslator.ClientDataToReserveData()` (~130 lines) |

The supply-integration path uses `System.Text.Json` (`JsonExtensionData`); the denali path uses `Newtonsoft.Json` (`JObject.Properties()`). Both produce the same output structures.

### Storage between requests

| System | Storage mechanism | TTL | Issue |
|--------|------------------|-----|-------|
| supply-integration | In-memory hybrid cache (`Microsoft.Extensions.Caching.Hybrid`) | Write: 3 hours, Read fallback: 3 days | **TTL mismatch** -- write sets 3h but read fallback sets 3d. Not shared across instances. Lost on pod restart |
| denali | DynamoDB `PreBookingCache` table | `ExpirationTimeInMinutes` (default 7200 = 5 days) | Uses gzip compression for schema and field mappings. DynamoDB client instantiated directly (not via DI) |

### Data structures produced

Two parallel structures per field:
- `NameToSupplierNameFields` (`Dictionary<string, string>`): maps internal name -> actual supplier key (e.g., `"seat_selection"` -> `"selected_seats_TH013r..."`)
- `BookingSchemaDictionary` (`Dictionary<string, Dictionary<string, string>>`): maps internal name -> code-to-value lookup for enum fields (nationality, gender, IdType, etc.)

### Test fixtures available

Real checkout payloads committed as test fixtures in the existing codebase:
1. `BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/69096911.json`
2. `BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/67846834.json`
3. `BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/PH01Bd09kt44Ia00l037Y7c5.json`
4. Comprehensive synthetic fixture: `OneTwoGoBookingService.Tests/UnitTests/TestData/checkout-data-received-from-12go-all-values.json`

### Existing test coverage

| Test file | Tests | Coverage |
|-----------|-------|----------|
| `OneTwoGoSchemaBuilderTests.cs` (SI) | 27 test facts, 1,252 lines | Baggage, seat selection, passenger fields, points/delivery, legacy layout |
| `OneTwoGoBookingSchemaTests.cs` (SI) | 2 test facts | Multi-passenger serialization, visa fields |
| `OneTwoGoBookingDefinitionBuilderTests.cs` (denali) | 9 test facts, 363 lines | Null/empty, unmapped fields, full fixture, duplicates, seats, visa |
| `ReserveDataTranslatorTests.cs` (denali) | 2 test facts, 131 lines | Reservation data translation |

### Notable test gaps (both codebases)

- No test for `NormalizeName()` deduplication (`"1"` suffix) for colliding points/delivery keys
- No test for the silent skip of `passenger[1+][...]` fields during schema parsing
- No test for `RegexNormalizer` failure path (returning `null` silently)
- No test for cache TTL mismatch (3-hour write vs 3-day read) in supply-integration
- No test for what happens when `BuildCheckoutUri` is called twice in denali (two round-trips to 12go per GetBookingSchema call)

### Proposed porting strategy (presumptive)

1. **Port the supply-integration path only** (newer, uses System.Text.Json which maps closer to PHP's `json_decode`). Drop the denali/Newtonsoft path entirely.
2. **Use PHP's native `json_decode()`** to parse the flat JSON into an associative array. Use `array_filter` + string matching (`str_starts_with`, `str_ends_with`, `str_contains`) to categorize keys -- direct equivalent of the C# `StartsWith`/`EndsWith`/`Contains` predicates on `ExtensionData`.
3. **Use PHP-native PCRE regex directly** from the 12go response. No `RegexNormalizer` needed since PHP speaks the same regex dialect as 12go's PHP backend.
4. **Copy all 4 test fixtures** from the C# test suite into `tests/B2bApi/Fixtures/`. Write `BookingSchemaMapperTest.php` with each fixture as a test case. AI-assisted translation of the 27 C# test assertions to PHP.
5. **Store `NameToSupplierName` mapping in Redis** with 3-hour TTL (keyed by cartId). This replaces both the in-memory hybrid cache (SI) and DynamoDB PreBookingCache (denali). Fixes the TTL mismatch and cross-instance sharing issues.
6. **Port `ReserveRequestBuilder.php` separately** from the mapper. Use the 2 existing `OneTwoGoBookingSchemaTests` as the reference for multi-passenger serialization. The builder reads the `NameToSupplierName` mapping from Redis and reconstructs bracket-notation keys.

### Meeting insight (2026-03-12, Soso/Shauly 1-on-1)

The booking schema parser was discussed and assessed as **not a major migration concern**. The existing functionality is established and works. Shauly confirmed the parser already detects DeOniBus bookings and performs necessary transformations. Post-migration, when only 12go format remains, the parser logic simplifies significantly (no DeOniBus detection branches needed).

---

## Booking ID Transition (Detailed Technical Analysis)

### The problem

Denali generates booking IDs in two structurally different formats. After cutover to native 12go, the Denali booking service and its PostgreSQL store will no longer exist, but clients will continue presenting Denali-format IDs to post-booking endpoints (GetBooking, Cancel, GetTicket). There is **no existing mapping table**, reverse-decode path for short IDs, or any planned bridging mechanism.

### Two ID formats

#### Format 1: KLV-encoded ID (legacy default, `GenerateShortBookingIdPerClient` flag OFF)

Structure: `0102V1 | 02 <len> <contractCode> | 03 <len> <integrationId> | 04 <len> <integrationBookingId> | 05 <len> <bookingClientId>`

- Deterministic, human-readable
- **The 12go `bid` is directly embedded as key 04 (`integrationBookingId`)** -- recoverable by decoding the KLV format
- Stored encrypted in the database with Caesar cipher (prefix `0102V1` becomes `XYXZ4Y`)
- Example from test: `0102V10212contractCode0313integrationId0420integrationBookingId050130606bght7n`

#### Format 2: Short ID (newer clients, `GenerateShortBookingIdPerClient` flag ON)

- 10-character Base62 string
- Generated from SHA-256 of (monotonic timestamp + 16 random bytes), taking 60 bits
- **Opaque and non-reversible** -- no encoded metadata, the 12go `bid` CANNOT be extracted
- Metadata stored separately in the PostgreSQL `BookingEntities` table alongside the short ID

### Database: PostgreSQL `BookingEntities` table

Key columns:

| Column | Contents |
|--------|----------|
| `id` (PK, text max 512) | Denali booking ID, **encrypted if KLV format**, as-is for short IDs |
| `plain_id` (text max 512) | Denali booking ID in plain (unencrypted) form |
| `integration_booking_id` (text max 100) | **The 12go `bid` as a string** -- the only bridge between Denali and 12go IDs |
| `integration_id` (text max 50) | Denali integration identifier (e.g., `"onetwogo"`) |
| `contract_code` (text max 50) | Contract code |
| `client_id` (text max 50) | Booking client ID |

Unique index on `(IntegrationId, IntegrationBookingId)` enables reverse lookup by 12go bid, but this reverse lookup is **not exposed through any post-booking API endpoint**.

### Impact if Denali DB is decommissioned without mitigation

All three post-booking endpoints fail for pre-cutover bookings:
- `GET /bookings/{id}` -- fails at `GetBookingById` returning null, throws `InvalidBookingIdException`
- `POST /bookings/{id}/cancel` -- fails at `GetBookingById` returning null, throws `ReservationDoesntExistException`
- `GET /bookings/{id}/ticket` -- fails at `GetBookingById` returning null, throws `EntityNotFoundException`

### Two distinct client populations

1. **KLV-format clients**: Hold an opaque Caesar-encrypted string. The 12go `bid` IS recoverable by decryption + KLV parsing.
2. **Short-ID clients**: Hold a 10-character opaque string. Recovery is **impossible** without the database row.

### Agreed solution (2026-03-12 meeting)

A **static one-time mapping table** (old booking ID -> 12go `bid`) is needed for post-booking operations only (cancel, get tickets, get booking details, booking notifications). This table is populated once during migration from an export of Denali's PostgreSQL `BookingEntities` table.

In the Team-First Developer design:
- Mapping table stored in MariaDB (F3's existing database)
- `BookingDetailsMapper.php` checks the booking ID format: if it matches a legacy format, looks up the 12go `bid` from the mapping table; if it is a new format, uses the `bid` directly
- For KLV-format IDs, the 12go `bid` can also be extracted by decoding the KLV structure (no DB lookup needed)
- For short IDs, the database export is the only source

Per recommendation D7: Static data loaded per-worker via **APCu** (PHP per-worker persistent cache), sourced from MariaDB table. Avoids per-request Redis lookups.

### New bookings after cutover

Decision still open: use raw 12go `bid` vs obfuscated IDs for new clients.

Arguments for raw `bid`:
- Simplest possible implementation
- No encoding/decoding logic
- 12go is the source of truth anyway (per no-persistence decision)

Arguments for obfuscated IDs:
- Clients may have built logic assuming opaque string IDs
- Raw integer `bid` leaks booking volume information
- API contract change for clients

The encryption decision remains open (Shauly raised this at ~01:10:16 in the Mar 12 meeting).

### FlixBus and DeOniBus context

- **FlixBus**: Being shut down as of 2026-03-12. No new bookings. Last departures ~October 2026.
- **DeOniBus**: Actively being migrated to 12go by David. In a few weeks, no new DeOniBus bookings.
- FlixBus/DeOniBus IDs do not correspond to 12go IDs, but since these integrations are sunsetting, the problem resolves naturally.
- Very few legacy bookings remain (~6 DeOniBus bookings with departure dates after June). Shauly's assessment: "I wouldn't break my head for that."

### `RestoreBookings` feature

`RestoreReservationConfirmationSucceededHandler.cs` replays Kafka events to re-populate the `BookingEntities` table. This is a disaster-recovery mechanism for re-seeding the existing Denali DB from Kafka history. It does NOT provide a path to 12go native IDs and is not useful for the migration.

### Open questions for Booking ID Transition

1. **Should new bookings use raw 12go `bid` or obfuscated IDs?** This is an API contract decision that affects all clients.
2. **How many active short-ID bookings exist?** This determines the size of the required mapping table and whether the one-time export is feasible.
3. **What is the retention period for post-booking operations?** How long do clients need to be able to call GetBooking/Cancel/GetTicket on old bookings? This determines how long the mapping table must be maintained.
4. **Can KLV-format IDs be decoded at request time instead of using the mapping table?** Since the 12go `bid` is embedded in key 04, the new system could decode it directly for KLV IDs, only needing the mapping table for short IDs.
5. **Should the mapping table be populated from a PostgreSQL export or from Kafka replay?** PostgreSQL export is simpler; Kafka replay is more comprehensive but requires the `RestoreBookings` infrastructure.
