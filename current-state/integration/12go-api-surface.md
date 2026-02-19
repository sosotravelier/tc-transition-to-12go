---
status: draft
last_updated: 2026-02-18
---

# 12go API Surface (Current Usage)

## Overview

This document captures every 12go API endpoint currently called by our system through the `OneTwoGoApi` class in `SupplyIntegration.OneTwoGo.Common`. The API is a RESTful HTTP service. All calls are made via `IHttpConnector`, which prepends the configured `baseUrl` and handles retry/timeout/proxy concerns. Authentication is via an API key passed as a query parameter (`k=<api-key>`).

The API follows a cart-based booking flow:

```
Search → GetTripDetails → AddToCart → GetCartDetails → GetBookingSchema (checkout) → Reserve → Confirm
```

Post-booking operations include `GetBookingDetails`, `GetRefundOptions`, and `Refund`.

---

## Infrastructure

Infrastructure is managed by DevOps. We do not need to worry about scaling details or deployment topology. Configuration changes go through release requests.

---

## Authentication

| Aspect | Detail |
|---|---|
| **Mechanism** | API key appended to query string |
| **Header used** | N/A for auth itself; key injected via `AuthLocation.Query` |
| **Query param** | `k=<api-key>` |
| **Implementation** | `OneTwoGoHttpConnector.Authenticate()` reads `connectivityParams["Key"]` and adds it as `x-api-key` alias to query via `AuthUtility.AddAuth(AuthLocation.Query, ...)` |
| **Key source** | Stored in SI configuration under contract credentials (`SiApiCredentials.Key`) |

The `IntegrationHttpMiddleware` (a `DelegatingHandler`) intercepts every outgoing HTTP call:
1. Creates an `ISiServiceScope` for the integration
2. Resolves `IIntegrationHttpConnector` (→ `OneTwoGoHttpConnector`)
3. Calls `Authenticate()` to inject the API key
4. After receiving the response, calls `ValidateResponse()` to map HTTP errors to SI exceptions

---

## Error Handling

### HTTP Status Code Mapping (in `OneTwoGoApi.CallApi<T>`)

| Status Code | Behavior |
|---|---|
| **200–299** | Success — deserialize body to `TResult` |
| **400** | Deserialize to `ErrorResponse`; throw `RequestArgumentException` with first field key and first message |
| **401** | Throw `AuthenticationException("Unauthorized")` |
| **404** | Throw `ProductNotFoundException` |
| **405–499** | Deserialize to `ErrorResponse`; invoke `onError` callback (endpoint-specific handling); return `default` |
| **500+** | Throw `RequestFailedException(statusCode, reasonPhrase)` |

### HTTP Status Code Mapping (in `OneTwoGoHttpConnector.ValidateResponse`)

This second layer runs in the `IntegrationHttpMiddleware` pipeline:

| Status Code | Behavior |
|---|---|
| **401** | Throw `AuthenticationException` |
| **400, 422** | Parse `ErrorResponse`; if message contains "Trip is no longer available" → `ProductNotFoundException`; otherwise → `RequestArgumentException` |
| **404–499** | Throw `ProductNotFoundException` |
| **500+** | Throw `RequestFailedException` |

### ErrorResponse Model

```csharp
class ErrorResponse {
    Dictionary<string, string>? Fields   // "fields" — field-level validation errors
    List<string>? Messages               // "messages" — error messages
    OneTwoGoErrorData? Data              // "data" — structured error data
}

class OneTwoGoErrorData {
    List<OneTwoGoErrorReason>? Reasons   // "reasons"
}

class OneTwoGoErrorReason {
    string? ReasonCode      // "reason_code" (e.g. "bad_trip_details")
    string? ReasonMessage   // "reason_message"
    string? RouteName       // "route_name"
    OneTwoGoErrorProduct? Product  // "product"
    OneTwoGoErrorProduct? Trip     // "trip"
}

class OneTwoGoErrorProduct {
    string? ProductType     // "product_type"
    string? TripKey         // "trip_key"
    string? GoDate          // "godate"
    int? FromStationId      // "from_station_id"
    int? ToStationId        // "to_station_id"
    int? OperatorId         // "operator_id"
    int? SellerId           // "seller_id"
    string? VehClassId      // "vehclass_id"
    int? ClassId            // "class_id"
    int? AvailableSeats     // "available_seats"
}
```

### OneTwoGoApiError Enum

Used as the failure type in `Result<T, OneTwoGoApiError>` returns:

| Value | Meaning |
|---|---|
| `BookingIdNotFound` | Booking/cart ID does not exist |
| `UnprocessableEntity` | Validation errors on specific fields |
| `Unknown` | Unclassified error |

---

## Endpoints We Call

### 1. Search

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/search/{fromProvinceId}p/{toProvinceId}p/{yyyy-MM-dd}?seats={n}&direct=true` |
| **C# Method** | `OneTwoGoApi.Search(SearchRoute route, DateOnly departureDate, uint numberOfSeats)` |
| **Notes** | Province IDs come from `route.From.AdditionalProperties["provinceId"]` / `route.To.AdditionalProperties["provinceId"]`, suffixed with `p`. The `direct=true` flag is always set. |

**Backend:** Search is backed by MariaDB (MySQL-compatible). Rechecks — when you validate availability before booking — go to actual supplier integrations and can take up to 1 minute.

#### Request Parameters

| Parameter | Location | Type | Description |
|---|---|---|---|
| `fromProvinceId` | path | string | Departure province ID + "p" suffix |
| `toProvinceId` | path | string | Arrival province ID + "p" suffix |
| `date` | path | string | Departure date in `yyyy-MM-dd` format |
| `seats` | query | uint | Number of seats requested |
| `direct` | query | bool | Always `true` |

#### Response: `OneTwoGoSearchResponse`

| JSON Field | C# Type | Description |
|---|---|---|
| `trips` | `Trip[]` | Array of trip results |
| `operators` | `Dictionary<string, Operator>` | Operator lookup (key = operator ID) |
| `stations` | `Dictionary<string, Station>` | Station lookup (key = station ID) |
| `classes` | `Dictionary<string, Class>` | Class lookup (key = class ID) |
| `recheck` | `string[]` | IDs that need rechecking |

**Trip**

| JSON Field | C# Type | Description |
|---|---|---|
| `id` | `string` | Trip ID |
| `chunk_key` | `string` | Chunk key |
| `route_name` | `string` | Route name |
| `params` | `Params` | Trip parameters (see below) |
| `segments` | `SegmentItem[]` | Leg segments |
| `travel_options` | `TravelOptions[]` | Pricing options per class |

**Params**

| JSON Field | C# Type | Description |
|---|---|---|
| `vehclasses` | `string[]` | Vehicle classes |
| `bookable` | `int` | Available seats |
| `operators` | `int[]` | Operator IDs |
| `duration` | `int` | Total duration (minutes) |
| `arr_time` | `DateTime` | Arrival time (custom format) |
| `dep_time` | `DateTime` | Departure time (custom format) |
| `min_price` | `Price` | Minimum price |
| `from` | `int` | From station ID |
| `to` | `int` | To station ID |
| `stops` | `int` | Number of stops |
| `min_rating` | `double?` | Minimum operator rating |
| `rating_count` | `int` | Rating count |
| `hide` | `bool?` | Whether trip should be hidden |
| `date` | `string` | Date string |

**SegmentItem**

| JSON Field | C# Type | Description |
|---|---|---|
| `type` | `string` | `"route"` or `"wait"` |
| `trip_id` | `string` | Segment trip ID |
| `official_id` | `string` | Official/operator ID |
| `vehclasses` | `string[]` | Vehicle classes |
| `connection_guaranteed` | `bool` | Connection guarantee flag |
| `from` | `int` | From station ID |
| `to` | `int` | To station ID |
| `duration` | `int` | Duration in minutes |
| `dep_time` | `DateTime` | Departure time |
| `arr_time` | `DateTime` | Arrival time |
| `class` | `int` | Class ID |
| `operator` | `int` | Operator ID |
| `rating` | `int?` | Rating |
| `search_results_marker` | `string` | Search marker |
| `show_map` | `bool` | Show map flag |
| `price` | `decimal?` | Price for segment |

**TravelOptions**

| JSON Field | C# Type | Description |
|---|---|---|
| `id` | `string` | Option ID |
| `bookable` | `int` | Available seats |
| `price` | `Price` | Gross price |
| `netprice` | `Price` | Net price |
| `agfee` | `Price` | Agent fee |
| `sysfee` | `Price` | System fee |
| `buy` | `Buy[]` | Buy options |
| `class` | `int` | Class ID |
| `amenities` | `string[]` | Amenity list |
| `ticket_type` | `string` | Ticket type |
| `confirmation_time` | `int` | Confirmation time (mins) |
| `confirmation_message` | `string` | Confirmation message |
| `cancellation` | `int` | Cancellation policy code |
| `cancellation_message` | `string` | Cancellation message |
| `baggage` | `Baggage` | Baggage info |
| `rating` | `double?` | Rating |
| `is_bookable` | `int` | Bookable flag |
| `reason` | `string` | Non-bookable reason |
| `booking_uri` | `string` | Booking URI |
| `price_restriction` | `int` | Price restriction type |
| `full_refund_until` | `DateTime?` | Full refund deadline |
| `dep_datetime` | `DateTime?` | Departure date/time |
| `arr_datetime` | `DateTime?` | Arrival date/time |

**Shared Models**

| Model | Fields |
|---|---|
| `Price` | `value` (decimal?), `fxcode` (string) |
| `Baggage` | `value` (int), `icon` (string), `message` (string) |
| `Station` | `station_id` (int), `province_id` (int), `station_name` (string), `station_name_full` (string), `station_code` (string), `station_slug` (string), `station_lat` (double), `station_lng` (double), `weight` (int) |
| `Operator` | `id` (int), `name` (string), `slug` (string), `logo` (dynamic[]) |
| `Class` | `id` (int), `name` (string), `is_multi_pax` (bool) |
| `SellerPrice` | `fxcode` (string), `netprice` (decimal?), `sysfee` (decimal?), `partnerfee` (decimal?) |

---

### 2. GetTripDetails

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/trip/{tripId}/{yyyy-MM-dd-HH-mm-ss}?seats={n}` |
| **C# Method** | `OneTwoGoApi.GetTripDetails(GetTripDetailsRequest req)` |
| **Notes** | Used to get updated/detailed trip info before adding to cart |

#### Request: `GetTripDetailsRequest`

| Field | Type | Description |
|---|---|---|
| `TripId` | `string` | Trip ID from search results |
| `DepartureDate` | `DateTime` | Departure date/time |
| `NumberOfSeats` | `uint` | Number of seats |

#### Response: `GetTripDetailsResponse`

Same structure as `OneTwoGoSearchResponse`:

| JSON Field | C# Type |
|---|---|
| `trips` | `Trip[]` |
| `operators` | `Dictionary<string, Operator>` |
| `stations` | `Dictionary<string, Station>` |
| `classes` | `Dictionary<string, Class>` |
| `recheck` | `string[]` |

---

### 3. AddToCart (with Trip ID)

| Aspect | Detail |
|---|---|
| **Method** | `POST` |
| **Path** | `/cart/{tripId}/{yyyy-MM-dd-HH-mm-ss}?seats={n}` |
| **C# Method** | `OneTwoGoApi.AddToCartWithTripId(AddToCartWithTripIdRequest req)` |
| **Returns** | `string` — the cart ID |

#### Request: `AddToCartWithTripIdRequest`

| Field | Type | Description |
|---|---|---|
| `TripId` | `string` | Trip ID |
| `DepartureDate` | `DateTime` | Departure date/time |
| `NumberOfSeats` | `uint` | Number of seats |

---

### 4. AddToCart (with body)

| Aspect | Detail |
|---|---|
| **Method** | `POST` |
| **Path** | `/cart?seats={n}&lang=en` |
| **Body** | JSON `OneTwoGoAddToCartRequest` |
| **C# Method** | `OneTwoGoApi.AddToCart(uint numberOfSeats, OneTwoGoAddToCartRequest request)` |
| **Returns** | `string` — the cart ID |
| **Notes** | Used for "internal" itineraries (without trip ID) |

#### Request Body: `OneTwoGoAddToCartRequest`

| JSON Field | C# Type | Description |
|---|---|---|
| `from_id` | `long` | From station ID |
| `to_id` | `long` | To station ID |
| `operator_id` | `long` | Operator ID |
| `class_id` | `long` | Class ID |
| `official_id` | `string?` | Official ID (nullable) |
| `godate` | `string` | Departure date |
| `duration` | `int` | Duration |

---

### 5. GetCartDetails

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/cart/{cartId}` |
| **C# Method** | `OneTwoGoApi.GetCartDetails(string cartId)` |

#### Response: `GetCartDetailsResponse`

| JSON Field | C# Type | Description |
|---|---|---|
| `cart` | `List<OneTwoGoCartParams>` | Cart items |

**OneTwoGoCartParams**

| JSON Field | C# Type | Description |
|---|---|---|
| `trip_key` | `string` | Trip ID in the cart |
| `godate` | `DateTime?` | Departure date |

---

### 6. GetBookingSchema (Checkout)

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/checkout/{cartId}?people=1` |
| **C# Method** | `OneTwoGoApi.GetBookingSchema(string cartId)` |
| **Returns** | `Result<OneTwoGoBookingSchemaResponse, OneTwoGoApiError>` |
| **Notes** | The `people=1` parameter is always hardcoded. Returns form fields required for reservation. |

#### Error Handling (specific)

- If response has reason code `"bad_trip_details"` → `OneTwoGoApiError.BookingIdNotFound`
- If `fields` has meaningful values → `OneTwoGoApiError.UnprocessableEntity`
- Otherwise → `OneTwoGoApiError.BookingIdNotFound`

#### Response: `OneTwoGoBookingSchemaResponse`

A flat object where each property is a `FormField` representing a required/optional booking form field. The response is highly dynamic — uses `[JsonExtensionData]` to capture fields with variable names.

**Fixed Fields:**

| JSON Key | C# Property | Type |
|---|---|---|
| `contact[mobile]` | `ContactMobile` | `FormField` |
| `contact[email]` | `ContactEmail` | `FormField` |
| `passenger[0][first_name]` | `PassengerFirstName` | `FormField` |
| `passenger[0][last_name]` | `PassengerLastName` | `FormField` |
| `passenger[0][id_no]` | `PassengerIdNo` | `FormField?` |
| `passenger[0][seattype_code]` | `PassengerSeatTypeCode` | `FormField?` |
| `passenger[0][title]` | `PassengerTitle` | `FormField?` |
| `passenger[0][middle_name]` | `PassengerMiddleName` | `FormField?` |
| `passenger[0][id_type]` | `PassengerIdType` | `FormField?` |
| `passenger[0][id_exp_date]` | `PassengerIdExpDate` | `FormField?` |
| `passenger[0][id_issue_date]` | `PassengerIdIssueDate` | `FormField?` |
| `passenger[0][dob]` | `PassengerDOB` | `FormField?` |
| `passenger[0][country_id]` | `PassengerCountryId` | `FormField?` |
| `passenger[0][gender]` | `PassengerGender` | `FormField?` |
| `passenger[0][is_child]` | `PassengerIsChild` | `ChildFormField?` |
| `passenger[0][id_scan]` | `PassengerIdScan` | `FormField?` |

**Dynamic Fields (extracted from `ExtensionData`):**

| C# Property | Pattern Matched | Description |
|---|---|---|
| `SelectedSeats` | `selected_seats_*` (not `_allow_auto`) | Seat selection field |
| `AllowSelectedSeats` | `selected_seats_*_allow_auto` | Auto-assignment toggle |
| `Baggage` | `passenger[0][baggage_*` | Baggage option |
| `PointsPickup` | `points*[pickup]` | Pickup point selection |
| `PointsDropoff` | `points*[dropoff]` | Dropoff point selection |
| `Points` | `points*` (generic) | Generic points field |
| `PointsPickupText` | `points*pickup*text` | Pickup text |
| `PointsDropoffText` | `points*dropoff*text` | Dropoff text |
| `PointsCurrentCity` | `points*current*city` | Current city |
| `PointsFlightArrTime` | `points*flight*arr*time` | Flight arrival time |
| `PointsFlightDepTime` | `points*flight*dep*time` | Flight departure time |
| `PointsFlightNo` | `points*flight*no` | Flight number |
| `PointsAirline` | `points*airline` | Airline |
| `PointsDropOffPoint` | `points*drop*off*point` | Drop-off point |
| `PointsPickupPoint` | `points*[point]` | Pickup point |
| `PointsNumberLuggage` | `points*number*luggage` | Number of luggage |
| `PointsAdditionalInformation` | `points*additional*info*` | Additional information |
| `PointsAddress` | `points*address` | Address |
| `PointsCarNumber` | `points*car*number` | Car number |
| `DeliveryAddress` | `delivery*address` | Delivery address |
| `DeliveryHotelCheckinDate` | `delivery*hotel*checkin` | Hotel check-in date |
| `Delivery` | `delivery*` (generic) | Delivery option |

**FormField Model:**

| JSON Field | C# Type | Description |
|---|---|---|
| `type` | `string` | Field type |
| `name` | `string` | Field name |
| `title` | `string` | Display title |
| `description` | `string` | Description |
| `disabled` | `bool?` | Whether disabled |
| `is_visible` | `bool?` | Whether visible |
| `items` | `List<object>?` | Sub-items |
| `data` | `FieldData?` | Extra data (seat map, country codes, etc.) |
| `analytics_name` | `string?` | Analytics name |
| `regexp` | `List<string>?` | Validation patterns |
| `value` | `object?` | Default value |
| `options` | `List<Option>?` | Dropdown options |
| `required` | `bool?` | Is required |

**FieldData Model:**

| JSON Field | C# Type | Description |
|---|---|---|
| `min_seats` | `int?` | Minimum seats |
| `novalidate` | `bool?` | Skip validation |
| `country_codes` | `List<CountryCode>` | Country code list |
| `seatmap` | `SeatMap` | Seat layout and availability |

**SeatMap Model:**

| JSON Field | C# Type | Description |
|---|---|---|
| `booked` | `Dictionary<string, object>?` | Already booked seats |
| `seats` | `Dictionary<string, SeatInfo>?` | Available seats with details |
| `layouts` | `List<LayoutData>` | Visual seat layout |

**SeatInfo Model:**

| JSON Field | C# Type | Description |
|---|---|---|
| `is_available` | `bool?` | Availability |
| `occupant` | `object` | Occupant info |
| `price` | `Price` | Seat price |
| `price_diff` | `Price?` | Price difference |
| `reason` | `string` | Reason if unavailable |
| `seat_level` | `int?` | Seat level (deck) |
| `seat_orientation` | `string` | Orientation |
| `seat_type` | `string` | Type |

---

### 7. Reserve Booking

| Aspect | Detail |
|---|---|
| **Method** | `POST` |
| **Path** | `/reserve/{bookingId}` |
| **Body** | JSON — custom serialized `ReserveDataRequest` |
| **C# Method** | `OneTwoGoApi.ReserveBooking(string bookingId, ReserveDataRequest req)` |
| **Returns** | `Result<OneTwoGoReserveBookingResult, OneTwoGoApiError>` |

#### Request Body: `ReserveDataRequest`

Uses a custom `JsonConverter` (`FromRequestDataToReserveDataConverter`) that serializes to flat key-value pairs with bracket notation:

| Serialized Key | Source Field | Type |
|---|---|---|
| `contact[mobile]` | `Mobile` | `string?` |
| `contact[email]` | `Email` | `string?` |
| `seats` | `Passengers.Count` | `int` |
| `selected_seats_*_allow_auto` | `AllowSelectedSeats` | `Tuple<string, bool>?` — Item1 = field name, Item2 = value |
| `selected_seats_*` | `SelectedSeats` | `Tuple<string, List<string>>?` — Item1 = field name, Item2 = comma-joined seat IDs |
| `{key}` / `{value}` | `AdditionalFields` | `Dictionary<string, string>?` |
| `passenger[{i}][id_no]` | `Passengers[i].IdNo` | `string?` |
| `passenger[{i}][id_type]` | `Passengers[i].IdType` | `string?` (default "0") |
| `passenger[{i}][country_id]` | `Passengers[i].Nationality ?? CountryId` | `string?` |
| `passenger[{i}][first_name]` | `Passengers[i].FirstName` | `string?` |
| `passenger[{i}][last_name]` | `Passengers[i].LastName` | `string?` |
| `passenger[{i}][middle_name]` | `Passengers[i].MiddleName` | `string?` |
| `passenger[{i}][title]` | `Passengers[i].Title` | `string?` |
| `passenger[{i}][gender]` | `Passengers[i].Gender` | `string?` |
| `passenger[{i}][seattype_code]` | `Passengers[i].SeatType` | `string?` (conditional) |
| `passenger[{i}][dob]` | `Passengers[i].DOB` | `string?` |
| `passenger[{i}][is_child]` | `Passengers[i].IsChild` | `bool` (default false) |
| `passenger[{i}][id_exp_date]` | `Passengers[i].IdExpiryDate` | `string?` (conditional) |
| `passenger[{i}][id_issue_date]` | `Passengers[i].IdIssueDate` | `string?` (conditional) |
| `passenger[{i}][id_scan]` | `Passengers[i].IdScan` | `string?` (conditional) |
| `{baggage_field_name}` | `Passengers[i].Baggage` | `Tuple<string, string>?` (conditional) |

#### Response: `OneTwoGoReserveBookingResult`

| JSON Field | C# Type | Description |
|---|---|---|
| `bid` | `string` | Booking ID |

---

### 8. Confirm Booking

| Aspect | Detail |
|---|---|
| **Method** | `POST` |
| **Path** | `/confirm/{bookingId}` |
| **Body** | Empty |
| **C# Method** | `OneTwoGoApi.ConfirmBooking(string bookingId)` |
| **Returns** | `Result<OneTwoGoConfirmBookingResult, OneTwoGoApiError>` |

#### Response: `OneTwoGoConfirmBookingResult`

| JSON Field | C# Type | Description |
|---|---|---|
| `bid` | `long` | Booking ID |

---

### 9. GetBookingDetails

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/booking/{bookingId}` |
| **C# Method** | `OneTwoGoApi.GetBookingDetails(GetBookingDetailsRequest req)` |

#### Response: `GetBookingDetailsResponse`

| JSON Field | C# Type | Description |
|---|---|---|
| `bid` | `int` | Booking ID |
| `tracker` | `string` | Tracker reference |
| `status` | `string` | Booking status |
| `from_id` | `long` | From station ID |
| `to_id` | `long` | To station ID |
| `dep_date_time` | `string` | Departure date/time |
| `seats` | `int` | Number of seats |
| `ticket_url` | `string` | Ticket download URL |
| `created_on` | `int` | Creation timestamp |
| `stamp` | `int` | Timestamp |
| `price` | `Price` | Total price |
| `netprice` | `Price` | Net price |
| `agfee` | `Price` | Agent fee |
| `sysfee` | `Price` | System fee |
| `seller_price` | `SellerPrice` | Seller pricing breakdown |

---

### 10. GetRefundOptions

| Aspect | Detail |
|---|---|
| **Method** | `GET` |
| **Path** | `/booking/{bookingId}/refund-options` |
| **C# Method** | `OneTwoGoApi.GetRefundOptionsBooking(OneTwoGoRefundOptionsRequest req)` |
| **Returns** | `Result<OneTwoGoRefundOptionsResponse, OneTwoGoApiError>` |

#### Response: `OneTwoGoRefundOptionsResponse`

| JSON Field | C# Type | Description |
|---|---|---|
| `available` | `bool` | Whether refund is available |
| `options` | `List<RefundOption>` | Refund options |

**RefundOption:**

| JSON Field | C# Type | Description |
|---|---|---|
| `refund_amount` | `decimal` | Amount to refund |
| `refund_fxcode` | `string` | Currency code |
| `expires` | `bool` | Whether option expires |
| `expires_after` | `string` | Expiration time |
| `available` | `bool` | Whether currently available |
| `available_since` | `string` | When it became available |
| `hash` | `string` | Hash for executing refund |

---

### 11. Refund

| Aspect | Detail |
|---|---|
| **Method** | `POST` |
| **Path** | `/booking/{bookingId}/refund` |
| **Body** | JSON `OneTwoGoRefundRequest` |
| **C# Method** | `OneTwoGoApi.Refund(OneTwoGoRefundRequest req)` |
| **Returns** | `Result<OneTwoGoRefundResponse, OneTwoGoApiError>` |

#### Request Body: `OneTwoGoRefundRequest`

| JSON Field | C# Type | Description |
|---|---|---|
| `hash` | `string` | Hash from refund options |
| `refund_fxcode` | `string` | Currency code |
| `refund_amount` | `decimal` | Amount to refund |

Note: `BookingId` is in the URL path, not the body (marked `[JsonIgnore]`).

#### Response: `OneTwoGoRefundResponse`

| JSON Field | C# Type | Description |
|---|---|---|
| `success` | `bool` | Whether refund succeeded |
| `delay_minutes` | `int` | Processing delay |
| `message` | `string` | Status message |

---

## Data Flow Mapping

| Our Operation | SI Interface Method | 12go API Endpoint | HTTP Method |
|---|---|---|---|
| Search for trips | `ISearchSupplier.Search(routes, date, seats)` | `GET /search/{from}p/{to}p/{date}?seats={n}&direct=true` | GET |
| Get itinerary details | `ISearchSupplier.GetItinerary(id, seats)` | `GET /trip/{tripId}/{datetime}?seats={n}` | GET |
| Add to cart (trip ID) | Internal booking funnel step | `POST /cart/{tripId}/{datetime}?seats={n}` | POST |
| Add to cart (body) | Internal booking funnel step | `POST /cart?seats={n}&lang=en` | POST |
| Get cart details | Internal booking funnel step | `GET /cart/{cartId}` | GET |
| Get booking form schema | `IBookingSchema.GetBookingSchema(currentId, nextId)` | `GET /checkout/{cartId}?people=1` | GET |
| Transform booking request | `IBookingSchema.GetBookingRequest(id, request)` | _(local transform only)_ | — |
| Reserve | `IBookingFunnel.Reserve(productId, cost, details)` | `POST /reserve/{bookingId}` | POST |
| Confirm | `IBookingFunnel.Book(resId, cost)` | `POST /confirm/{bookingId}` | POST |
| Get booking details | `IPostBookingOperations.GetReservation(resId)` | `GET /booking/{bookingId}` | GET |
| Get refund options | Internal to `Cancel` | `GET /booking/{bookingId}/refund-options` | GET |
| Execute refund | `IPostBookingOperations.Cancel(resId)` | `POST /booking/{bookingId}/refund` | POST |
| Get ticket URL | `IPostBookingOperations.GetTicketUrl(resId)` | Uses `ticket_url` from `GetBookingDetails` | — |

---

## Date/Time Formats

| Constant | Format | Used By |
|---|---|---|
| `DateFormat` | `yyyy-MM-dd` | Search |
| `DateTimeFormat` | `yyyy-MM-dd-HH:mm` | Itinerary ID encoding |
| `DateTimeFormat_TripDetails` | `yyyy-MM-dd-HH-mm-ss` | GetTripDetails, AddToCartWithTripId |

---

## Open Questions

1. **Rate Limiting**: Does the 12go API have rate limits? How do we handle them today?
2. **Pagination**: The search endpoint doesn't appear to support pagination — is the result set always bounded?
3. **`people=1` hardcoded**: The checkout/booking schema endpoint always passes `people=1` — what happens with multi-passenger bookings? (Handled via multi-passenger array in reserve, but schema only asks for `passenger[0]`.)
4. **Cart lifetime**: How long does a cart ID remain valid?
5. **Webhook/callback**: Does 12go send any callbacks or webhooks for booking status changes?
6. **`recheck` field**: What is the expected behavior when trip IDs appear in the `recheck` array?
7. **Two AddToCart variants**: When is the body-based AddToCart (with `OneTwoGoAddToCartRequest`) used versus the trip-ID-based variant? (Appears to be "internal" vs "external" itinerary flow.)
8. **Response deserialization**: The `OneTwoGoBookingSchemaResponse` has 20+ `[JsonIgnore]` properties that parse `ExtensionData` by pattern matching on keys — are all these patterns actually used in production?
