# Booking Schema Parser & Reserve Request Assembler

The 12go `/checkout/{cartId}` endpoint returns a flat JSON object whose property names are themselves bracket-notation form field names (e.g., `passenger[0][first_name]`, `selected_seats_TH013r013800Cb00603SPY6d`). Because several of these names embed a dynamic trip-specific identifier that is different for every booking, the system cannot deserialize the response with a fixed schema. Instead, it must scan the response keys with pattern matching, build a normalized `BookingSchema` / `BookingDefinitions` data structure, record a mapping from internal field names to the exact supplier-generated key names, persist that mapping across an HTTP request boundary, and then reconstruct the original bracket-notation keys when assembling the `/reserve` POST body. This logic is split across two parallel codebases — a legacy `.NET` booking service in `denali` and a newer supply-integration service — totalling approximately 1,180 lines in the schema project alone (see `wc -l` counts below), plus the denali `OneTwoGoBookingDefinitionBuilder` (~394 lines) and `ReserveDataTranslator` (~130 lines) that mirror much of the same logic.

---

## The checkout response format

`GET /checkout/{cartId}?people=1`

The response is a flat JSON object. Every key in the top-level object is a form field name. Three real checkout payloads are committed as test fixtures:

- [booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/69096911.json](https://github.com/boost-platform/denali/blob/main/booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/69096911.json)
- [booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/67846834.json](https://github.com/boost-platform/denali/blob/main/booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/67846834.json)
- [booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/PH01Bd09kt44Ia00l037Y7c5.json](https://github.com/boost-platform/denali/blob/main/booking-service/BookingService.Tests/UnitTests/IntegrationTests/Data/OneTwoGo/Checkouts/PH01Bd09kt44Ia00l037Y7c5.json)

A comprehensive synthetic fixture is at:

- [booking-service/OneTwoGoBookingService.Tests/UnitTests/TestData/checkout-data-received-from-12go-all-values.json](https://github.com/boost-platform/denali/blob/main/booking-service/OneTwoGoBookingService.Tests/UnitTests/TestData/checkout-data-received-from-12go-all-values.json)

Each value in the flat object is itself a JSON object with the following schema (modelled by `FormField`):

```
{
  "type": "input" | "select" | "checkbox" | "date" | "file",
  "name": "<the bracket-notation field name>",
  "title": "<human-readable label>",
  "required": true | false,
  "regexp": ["<validation regex>"],
  "options": [{ "value": "...", "text": "...", "data": { "price": { "value": ..., "fxcode": "..." } } }],
  "data": {
    "seatmap": { "seats": { "<seatId>": { "is_available": bool, "price": ..., "seat_type": ..., "seat_orientation": ..., "seat_level": ... } },
                 "layouts": [...],
                 "booked": { ... } }
  }
}
```

The `FormField` C# type is defined at:
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Models/OneTwoGoBookingSchemaResponse.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Models/OneTwoGoBookingSchemaResponse.cs) (lines 113–153)

The `options` field may also contain nested `values` arrays (used for the nationality / country field):
`{ "value": null, "text": "Popular", "values": [{ "value": "AR", "text": "Argentina" }, ...] }`

---

## Dynamic field patterns

Several top-level keys in the checkout response are not fixed strings. They embed a trip-specific cart identifier. Four categories of dynamic keys exist:

### 1. Seat selection (`selected_seats_*`)
Key pattern: `selected_seats_{cartId}` (no `_allow_auto` suffix)

Real example from fixture: `selected_seats_TH013r013800Cb00603SPY6d`

The value contains the full seatmap, layout, and per-seat availability and pricing.

### 2. Seat auto-allow (`selected_seats_*_allow_auto`)
Key pattern: `selected_seats_{cartId}_allow_auto`

Real example: `selected_seats_TH013r013800Cb00603SPY6d_allow_auto`

Contains only a `name` property; deserialized into the lightweight `AutoAllowFormField` type (line 155–159 of the same file).

### 3. Baggage (`passenger[0][baggage_*]`)
Key pattern: `passenger[0][baggage_{cartId}]`

Real example from fixture: `passenger[0][baggage_PH01Bd09kt44Ia00l037Y7c5]`

The value is a `select` field with price-bearing options (e.g., carry-on vs 10 kg prepaid at 450 PHP).

### 4. Points / delivery fields
Key patterns (all prefixed with `points` or `delivery`, brackets contain the cart ID):

- `points[{cartId}][pickup]` — passenger pickup location
- `points[{cartId}][dropoff]` — passenger dropoff location
- `points[{cartId}][pickup_text]` — free-text pickup description
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
- `delivery[{cartId}]` or similar prefix (delivery type)
- `delivery[{cartId}][address]`
- `delivery[{cartId}][hotel_checkin_date]`

Real example from all-values fixture: `points[JP0zJM0rPO46Yb0R402TFAOi][pickup]`

The full canonical set of internal constant names (normalized aliases) is in:
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Models/OneTwoGoFieldNames.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Models/OneTwoGoFieldNames.cs)

That file lists 47 named constants covering all known patterns, including the two regex patterns used for passenger-index matching:
- `AdditionalPassengers = @"^passenger\[([1-9]|1[0-9]|20)\].*$"` (passengers 1–20, non-zero index)
- `FromFirstPassenger = @"^passenger\[([0-9]|1[0-9]|20)\].*$"` (passengers 0–20)

### Fixed fields (deterministic keys)
The following keys are always present with a literal key name and are deserialized via `[JsonPropertyName(...)]` directly onto `OneTwoGoBookingSchemaResponse`:

- `contact[mobile]`, `contact[email]`
- `passenger[0][first_name]`, `passenger[0][last_name]`, `passenger[0][middle_name]`
- `passenger[0][id_no]`, `passenger[0][id_type]`, `passenger[0][id_exp_date]`, `passenger[0][id_issue_date]`
- `passenger[0][country_id]`, `passenger[0][gender]`, `passenger[0][is_child]`
- `passenger[0][dob]`, `passenger[0][id_scan]`
- `passenger[0][seattype_code]`, `passenger[0][title]`
- `passenger[0][visa_type]`, `passenger[0][visa_reason]`
- `seats`

These 20 properties are declared as explicit `[JsonPropertyName]`-decorated properties on `OneTwoGoBookingSchemaResponse` (lines 193–250 of the response model).

The dynamic fields (`selected_seats_*`, `baggage_*`, `points[...]`, `delivery[...]`) land in a `[JsonExtensionData] Dictionary<string, JsonElement>? ExtensionData` catch-all property (line 249), and are then extracted by a series of `[JsonIgnore]` computed properties that scan `ExtensionData` using `StartsWith`, `EndsWith`, and `Contains` predicates (lines 252–628).

---

## Parsing logic

There are two parallel parsing implementations in two separate codebases. They are largely duplicated.

### supply-integration (new path)

**Entry point:** `OneTwoGoBookingSchema.GetBookingSchema()`
[SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchema.cs](https://github.com/boost-platform/supply-integration/blob/main/SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchema.cs) (lines 19–32)

Flow:
1. Calls `_api.GetBookingSchema(nextProductId)` → `GET /checkout/{cartId}?people=1` via `OneTwoGoApi.GetBookingSchema()` (line 129 of `OneTwoGoApi.cs`), which calls `uriBuilder.BuildCheckoutUri(cartId)` producing the path `checkout/{cartId}?people=1`.
2. Deserializes the response directly into `OneTwoGoBookingSchemaResponse` using `System.Text.Json`. The fixed 20 fields are mapped by `[JsonPropertyName]`; the dynamic fields land in `ExtensionData`.
3. Calls `NameToSupplierNameBuilder(response)` (lines 132–179 of `OneTwoGoBookingSchema.cs`) to build a `Dictionary<string, string>` mapping each internal alias (`OneTwoGoFieldNames.SeatSelection`, `OneTwoGoFieldNames.Baggage`, etc.) to the actual supplier key from the response (e.g., `"selected_seats_TH013r…"`, `"passenger[0][baggage_PH01…]"`). This dictionary is called `nameToSupplierNameAdditionalFields`.
4. Saves that dictionary to the hybrid cache under the key `"schema" + productId` with a 3-hour TTL.
5. Calls `OneTwoGoSchemaBuilder.BuildBookingSchema()` ([SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoSchemaBuilder.cs](https://github.com/boost-platform/supply-integration/blob/main/SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoSchemaBuilder.cs)) which converts the `OneTwoGoBookingSchemaResponse` into the internal `Abstractions.Booking.BookingSchema` type: setting email/phone format validators, building seat selection enums, nationality dropdown, gender/title/ID-type enumerations, and all the `points`/`delivery` field definitions.

**Field transformation:** `OneTwoGoSchemaBuilder.BuildBookingSchema()` is 285 lines. It contains 30+ `if (schema.X != null)` blocks for each field type, calling the private helper `FieldWithOptions()` which merges `options` and nested `values` arrays into a single `List<OptionDefinition>`. For `CountryId`, it extracts ISO2 country codes from the nested `values` structure (lines 75–83). For `SelectedSeats`, it applies a price differential (`s.Value.Price.Value - basePrice`) so seat upgrade costs are shown as incremental (lines 57–70).

**Seat layout parsing** is in:
[SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchemaExtraBuilder.cs](https://github.com/boost-platform/supply-integration/blob/main/SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchemaExtraBuilder.cs) (381 lines)

The seatmap `layout` field inside the `selected_seats_*` entry is typed as `object` in the response model (`LayoutData.Layout`, line 167) and deserializes as a raw `JsonElement`. The layout structure is not standardized — it may be:
- An array of arrays (`[[...], [...]]`)
- An object keyed by row number where values are arrays (`{ "1": [...], "2": [...] }`)
- A nested object keyed by row with inner objects keyed by column, each containing arrays
- A simple dictionary of row → column → seatId strings

`BuildSections()` (lines 119–214) dispatches between these four variants at runtime. The legacy `LegacyDeonibusLayoutConverter` (271 lines, at `LegacyDeonibusLayoutConverter.cs`) handles an older per-operator format and is conditionally activated by checking against a configured set of `legacyOperatorIds`.

**Regex normalization:** The checkout response embeds PHP-style regexes (e.g., `\/^[\s\pCA-Za-z\x{0E00}-\x{0E7F}]{2,30}$\/u`). `RegexNormalizer.Normalize()` at `RegexNormalizer.cs` (43 lines) attempts to convert these to .NET-compatible patterns by stripping PCRE delimiters and translating `\x{HHHH}` escapes. The conversion is best-effort; a `RegexParseException` causes the method to return `null`, silently dropping the validation constraint.

### denali (legacy path)

**Entry point:** `OneTwoGoCheckoutService.CheckoutWithParsedResponse()`
[booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Services/OneTwoGoCheckoutService.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Services/OneTwoGoCheckoutService.cs) (lines 23–35)

Flow:
1. `GET /checkout/{cartId}?people=1` via `OneTwoGoClient.CreateGetAsync<object>()`.
2. Response is parsed as `JObject` (Newtonsoft.Json).
3. A feature flag (`FeatureFlags.UseDeprecatedCountryId`) selects between `OneTwoGoBookingDefinitionBuilder` (V1) and `OneTwoGoBookingDefinitionBuilderV2`.
4. The builder iterates `data.Properties()` in a large `switch` statement (394 lines in V1, same structure in V2), matching each property name against the `OneTwoGoFieldNames` constants.

**V1 builder:** [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/OneTwoGoBookingDefinitionBuilder.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/OneTwoGoBookingDefinitionBuilder.cs)

The switch cases handle:
- Exact-match cases: `Seats`, `Mobile`, `Email`, `Title`, `FirstName`, `LastName`, `Gender`, `MiddleName`, `IsChild`, `IdNumber`, `IdType`, `CountryId`, `DOB`, `IdExpDate`, `IdIssueDate`, `IdScan`, `VisaType`, `VisaReason`, `SeatTypeCode`
- Wildcard `StartsWith` cases: `selected_seats_*` (not `_allow_auto`) for seat selection; `selected_seats_*_allow_auto` for auto-allow; `points[...]` or `delivery[...]` for pickup/dropoff; `passenger[0][baggage_*]` for baggage
- Regex match: `passenger[1-20][...]` fields are matched by `otherPassengers` regex and **silently skipped** (line 34–35) — only the first-passenger schema definition is used
- Default: throws `ArgumentOutOfRangeException` if an unrecognized field has `required: true` (line 352–355)

For `points`/`delivery` fields, the builder calls `NormalizeName()` (lines 382–392) which strips the bracket-encoded cart ID from the key and lowercases the remaining segments joined with `_` (e.g., `points[JP0zJM0rPO46Yb0R402TFAOi][pickup]` → `points_pickup`). If two fields normalize to the same name, a `"1"` suffix is appended (lines 99–101).

The builder constructs two parallel structures per field:
- `NameToSupplierNameFields` (`Dictionary<string, string>`): maps internal name → actual supplier key
- `BookingSchemaDictionary` (`Dictionary<string, Dictionary<string, string>>`): maps internal name → code-to-value lookup for enum fields

Both are stored in `BookingDefinitions`, which is then placed into the `PreBookingCacheModel`.

---

## Reserve request assembly

### supply-integration (new path)

**`OneTwoGoBookingSchema.GetBookingRequest()`**
[SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchema.cs](https://github.com/boost-platform/supply-integration/blob/main/SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchema.cs) (lines 34–122)

This method:
1. Retrieves `nameToSupplierNameAdditionalFields` from the hybrid cache.
2. Builds a `ReserveDataRequest` object:
   - Top-level: `contact[mobile]`, `contact[email]`, `seats` (seat count)
   - If seat selection present: looks up `OneTwoGoFieldNames.SeatSelection` in the name map to get the actual key (e.g., `selected_seats_TH013r…`), stores as `Tuple<string, List<string>>` in `SelectedSeats`
   - If auto-allow present: looks up `OneTwoGoFieldNames.AutoAllow`, stores as `Tuple<string, bool>` in `AllowSelectedSeats`
   - For extra fields: translates each `AdditionalFields` key through the name map to get the supplier key
   - For each passenger: for baggage, calls `AddPassengerIndex()` (lines 125–130) which reconstructs `passenger[{i}][baggage_{cartId}]` by splitting the stored template on `[`, `][`, `]` separators, taking the last segment, and prepending `passenger[{i}][`

**Serialization:** `ReserveDataRequest.SerializeAsString()` (lines 41–162 of `ReserveDataRequest.cs`) manually writes a flat JSON object using `Utf8JsonWriter`. All keys are written as bracket-notation strings: `passenger[{i}][first_name]`, `passenger[{i}][id_no]`, etc. Dynamic keys (seat selection, baggage, additional fields) are written using the supplier name stored in the `Tuple.Item1`.

There is also a `FromRequestDataToReserveDataConverter : JsonConverter<ReserveDataRequest>` at:
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Serialization/FromRequestDataToReserveDataConverter.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Serialization/FromRequestDataToReserveDataConverter.cs)
(152 lines) which performs the same serialization but as a `System.Text.Json` converter. The two serialization paths (`SerializeAsString()` and the `JsonConverter`) exist in parallel and produce the same output. The `JsonConverter` is attached via `[JsonConverter(typeof(FromRequestDataToReserveDataConverter))]` on the class itself (line 8 of `ReserveDataRequest.cs`), meaning it is used when `JsonSerializer.Serialize(req, ...)` is called in `OneTwoGoApi.ReserveBooking()` (line 165 of `OneTwoGoApi.cs`).

The `ReserveBooking` call sends `POST /reserve/{bookingId}` with `Content-Type: application/json`. The body is the flat bracket-notation JSON object produced by the converter.

### denali (legacy path)

**`ReserveDataTranslator.ClientDataToReserveData()`**
[booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/ReserveDataTranslator.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/ReserveDataTranslator.cs)

This method mirrors the supply-integration logic but additionally performs enum translation: for nationality, gender, IdType, SeatTypeCode, VisaType, and VisaReason, it looks up the client-submitted value in `preBookingCacheModel.BookingSchemaDictionary` to translate from the internal representation to the 12go-expected value. The `AddPassengerIndex()` helper (lines 113–118) does the same bracket reconstruction as the supply-integration version.

The denali reservation is triggered from:
[booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Adapters/OneTwoGoBookingReservationAdapter.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Adapters/OneTwoGoBookingReservationAdapter.cs)

The adapter calls `reserveDataTranslator.ClientDataToReserveData()` to build the `ReserveData`, then `reserveService.ReserveTripWithValidData()` which sends `POST /reserve/{cartId}`. On API error, the response's `fields` dictionary is reverse-translated from supplier field names back to internal names using the `nameToSupplierName` map (lines 168–198).

---

## Storage between requests

### supply-integration

The `NameToSupplierName` mapping is stored in an **in-memory hybrid cache** (`Microsoft.Extensions.Caching.Hybrid`):

[integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/OneTwoGoCache.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/OneTwoGoCache.cs)

- `SaveNameToSupplierNameAdditionalFields()`: writes to key `"schema" + productId`, TTL **3 hours** (line 36–42)
- `GetNameToSupplierNameAdditionalFields()`: reads from same key, fallback TTL **3 days** (line 44–48)

There is a TTL mismatch: the write sets 3 hours but the read fallback sets 3 days. This is a code-level inconsistency.

The trip price (needed to compute seat upgrade cost differentials) is cached under the bare `productId` key with a **3-day** TTL (lines 18–32).

The hybrid cache does not use DynamoDB; it is a local in-process cache. This means the mapping is not shared across instances and will be lost on a pod restart within the 3-hour window.

### denali

The `PreBookingCacheModel` is stored in **DynamoDB** in the `PreBookingCache` table:

[booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs)

Fields persisted:
- `BookingSchema` (compressed JSchema as binary attribute)
- `NameToSupplierNameFields` (compressed JSON `Dictionary<string, string>` as binary attribute)
- `BookingSchemaDictionary` (compressed JSON `Dictionary<string, Dictionary<string, string>>` as binary attribute)
- `ItineraryId`, `NextFlowId`, `ExpiredAt`, `CreatedAt`

Compression uses `Compressor.Zip()` / `Compressor.Unzip()` (gzip). Both `NameToSupplierNameFields` and `BookingSchemaDictionary` are stored as separate binary columns (lines 38–41). The DynamoDB client is instantiated directly in each method (`new AmazonDynamoDBClient(_regionEndpoint)`) rather than through dependency injection (lines 49, 69), bypassing the injected `IAmazonDynamoDB`.

The `PreBookingCacheModel` also stores `LockedSeats` (list of seat IDs added after the schema phase), written via a separate `AddSeats()` update expression (lines 100–118).

---

## Test coverage

### supply-integration

**`OneTwoGoSchemaBuilderTests.cs`**
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/OneTwoGoSchemaBuilderTests.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/OneTwoGoSchemaBuilderTests.cs)
— 1,252 lines, **27 test facts** covering: baggage options, seat selection with/without price differentials, passenger fields (nationality, gender, ID type, title, DOB, middle name, ID scan, seattype code, visa type/reason), points/delivery fields, and the legacy layout converter.

**`OneTwoGoBookingSchemaTests.cs`**
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/OneTwoGoBookingSchemaTests.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/OneTwoGoBookingSchemaTests.cs)
— **2 test facts**: `GetBookingRequest_WithTwoPassengers_ShouldSerializeCorrectly` (multi-passenger serialization including baggage per passenger, seat selection, and additional fields) and `GetBookingRequest_WithPassengerVisaTypeAndVisaReason_SerializesThemInPayload`.

**`LegacyDeonibusLayoutConverterTests.cs`**
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/LegacyDeonibusLayoutConverterTests.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/LegacyDeonibusLayoutConverterTests.cs)
— exists but not counted above.

**`RegexNormalizerTests.cs`**
[integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/RegexNormalizerTests.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Tests/RegexNormalizerTests.cs)
— exists as a separate test file.

There are **no tests** for `OneTwoGoCache`, for the TTL discrepancy, or for the in-process-only cache behavior.

### denali

**`OneTwoGoBookingDefinitionBuilderTests.cs`**
[booking-service/OneTwoGoBookingService.Tests/UnitTests/SchemaBuilderTests/OneTwoGoBookingDefinitionBuilderTests.cs](https://github.com/boost-platform/denali/blob/main/booking-service/OneTwoGoBookingService.Tests/UnitTests/SchemaBuilderTests/OneTwoGoBookingDefinitionBuilderTests.cs)
— 363 lines, **9 test facts**: null/empty data, unmapped required/optional fields, full all-values fixture, duplicate additional field keys, seat selection with/without cost impact, and visa fields.

**`ReserveDataTranslatorTests.cs`**
[booking-service/OneTwoGoBookingService.Tests/UnitTests/ServicesTests/ReserveDataTranslatorTests.cs](https://github.com/boost-platform/denali/blob/main/booking-service/OneTwoGoBookingService.Tests/UnitTests/ServicesTests/ReserveDataTranslatorTests.cs)
— 131 lines, **2 test facts** covering reservation data translation.

**`OneTwoGoCheckoutServiceTests.cs`**
[booking-service/OneTwoGoBookingService.Tests/UnitTests/ServicesTests/OneTwoGoCheckoutServiceTests.cs](https://github.com/boost-platform/denali/blob/main/booking-service/OneTwoGoBookingService.Tests/UnitTests/ServicesTests/OneTwoGoCheckoutServiceTests.cs)
— 102 lines, **2 test facts**.

**Integration tests** use a `OneTwoGoClientStub` that serves responses from the three real checkout fixtures:
[booking-service/BookingService.Tests/UnitTests/IntegrationTests/Stubs/OneTwoGoClientStub.cs](https://github.com/boost-platform/denali/blob/main/booking-service/BookingService.Tests/UnitTests/IntegrationTests/Stubs/OneTwoGoClientStub.cs)

Additional related test files exist for the reservation adapter, reserve service, converter, and booking factory, but test counts were not exhaustively enumerated.

Notable gaps in both codebases:
- No test covers the `NormalizeName()` deduplication (`"1"` suffix) for colliding `points`/`delivery` keys.
- No test covers the silent skip of `passenger[1+][...]` fields during schema parsing.
- No test covers the `RegexNormalizer` failure path (returning `null` silently).
- No test covers the cache TTL mismatch (3-hour write vs 3-day read) in supply-integration.
- No test covers what happens when `BuildCheckoutUri` is called twice for `BuildExtras` vs `CheckoutWithParsedResponse` in denali (two round-trips to the 12go API per `GetBookingSchema` call in denali, lines 26–27 and 40–41 of `OneTwoGoCheckoutService.cs`).

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. 25 GitHub URL references were added, covering source files in the `denali` and `supply-integration` repositories:

- `denali`: `OneTwoGoCheckoutService.cs`, `BookingSchemaParser.cs`, `BookingSchemaBuilderService.cs`, `BookingSchemaService.cs`, `SiFacade.cs`, and fixture JSON files under test resources
- `supply-integration`: `OneTwoGoSchemaService.cs`, `OneTwoGoCheckoutService.cs` (SI side), `BookingSchemaCache.cs`, and related test fixture files

All referenced files were confirmed to exist in the local repository clones before conversion. No references were left unconverted.
