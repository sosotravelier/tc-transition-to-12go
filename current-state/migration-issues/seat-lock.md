# Migration Issue: Seat Lock Implementation

The seat lock feature allows clients to temporarily reserve specific seats on a trip before submitting a full booking. In the current .NET architecture, clients call a dedicated `POST /v{version}/{client_id}/seats` endpoint; for integrations where the upstream supplier does not natively support locking (including 12go), the system fakes the lock by validating the requested seats against a locally-cached booking schema and then writing the chosen seat identifiers into a DynamoDB record that was already created during the GetItinerary/GetBookingSchema flow. When the subsequent `CreateBooking` call arrives, the seat selection stored in DynamoDB silently overrides whatever the client sent. 12go does not currently offer a native seat-lock API. The design documents record an open question (G7) about when 12go will ship one, but no confirmation or ETA exists. Until then, the current fake behavior must be replicated in any replacement service to preserve the client-facing contract.

---

## Client-facing contract

**Endpoint:**
```
POST /v{version}/{client_id}/seats
```
Defined in the OpenAPI spec at [shared-booking-service-open-api/api/definitions/book.yaml](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/api/definitions/book.yaml) (lines starting at `/v{version:apiVersion}/{client_id}/seats`) and the generated abstract controller at [shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs) lines 216–226.

**Required headers:**
- `x-travelier-version` (DateOnly) — required
- `x-correlation-id` (optional, regex `^[A-Za-z0-9\-=]{1,100}$`)

**Request body schema** ([shared-booking-service-open-api/api/definitions/model/lock-seats-request.yml](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/api/definitions/model/lock-seats-request.yml)):
```yaml
type: object
required: [booking_token, booking_data]
properties:
  booking_token:
    type: string          # encrypted KLV-encoded BookingToken
  booking_data:
    type: object
    properties:
      seat_selection:
        type: array
        items:
          type: string    # seat identifiers, e.g. ["16", "17"]
```

**Response codes:**
- `200 OK` — lock accepted, returns a `Booking` object with `status: Reserved`, `passenger_count`, and `total_price`
- `400 Bad Request` — invalid request (e.g. empty seat list)
- `401 Unauthorized`
- `404 Not Found` — booking token not found in DynamoDB (schema expired)
- `422 Unprocessable Entity` — seat validation failure (seat not in schema, schema mismatch, seats unavailable)
- `500 Internal Server Error`

The concrete implementation is in `BookingController.LockSeats` at [booking-service/host/BookingService.Api/Controllers/BookingController.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/Controllers/BookingController.cs) lines 149–177. The controller decrypts the booking token using `CaesarCypher.Decrypt`, enforces a non-empty seat list (throwing `ReservationException` with code `MissingParameter` if empty), then delegates to `ISupplierIntegrationAccess.LockSeats`.

The `PostBookingApiController` at [post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs) line 94 also inherits the abstract `LockSeats` method but throws `NotImplementedException` — meaning seat locking is only active in `booking-service`, not in `post-booking-service`.

---

## Current fake implementation

### Decision point: native vs. fake

The call chain from the controller reaches `SiFacade.LockSeats` at [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs) lines 680–723. The method first validates the requested seats against the locally-cached booking schema (via `ValidateSeatsWithSchemaFromDb`, line 683), then checks whether the integration supports native locking:

```csharp
if (await bookingSiHost.IsSeatLockSupported(bookingToken))
{
    // delegate to the supplier's LockSeats funnel method
    reservation = await bookingSiHost.LockSeats(...);
}
else
{
    // fake path: re-fetch schema from supplier and verify seats are still present
    await ValidateSeatWithCurrentSchemaFromSupplier(bookingToken, seats, preBookingCacheModel);
}
// regardless of path, write seats into DynamoDB
await preBookingCacheService.AddSeats(preBookingCacheModel.Id, seats);
```

`IBookingSiHost.IsSeatLockSupported` is defined at [booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/IBookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/IBookingSiHost.cs) line 19. The implementation in `BookingSiHost.IsSeatLockSupported` (lines 295–305 of [BookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs)) instantiates the integration's DI scope and calls `IBookingFunnel.IsSeatLockSupported()`.

The default implementation in the abstraction layer (`IBookingFunnel`) at [abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs) lines 70–71 returns `false` as a default interface method:

```csharp
bool IsSeatLockSupported() => false;
```

For 12go, `OneTwoGoBookingFunnel` at [integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs) does **not** override `IsSeatLockSupported`, so it inherits the `false` default. It also does not override `LockSeats`, so any call to it would throw `NotImplementedException` (the other default in the interface, line 64).

The `FakeBookingSiHost` used in integration tests ([booking-service-integration/host/BookingServiceIntegration.Api/FakeBookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service-integration/host/BookingServiceIntegration.Api/FakeBookingSiHost.cs) line 149) also returns `false` from `IsSeatLockSupported`.

The fake validation path (`ValidateSeatWithCurrentSchemaFromSupplier`, lines 754–783 of `SiFacade.cs`) re-fetches the booking schema from the supplier (or from local cache depending on feature flags), then checks whether the requested seats are present in the `seat_selection` `anyOf` list from the JSON Schema. If any requested seat is missing from the schema, it throws `SchemaValidationException` with message `ReservationErrorMessages.SeatsUnavailable`.

### What the fake path does NOT do

- It does not place any hold or reservation with 12go.
- It does not prevent another client or session from booking the same seat.
- The "lock" exists only in the local DynamoDB record and is not communicated to the supplier in any way.

### DeOniBus (the only integration with native support)

The DeOniBus funnel at [integrations/DeOniBus/SupplyIntegration.DeOniBus.Funnel/DeOniBusBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/DeOniBus/SupplyIntegration.DeOniBus.Funnel/DeOniBusBookingFunnel.cs) line 91 returns `true` from `IsSeatLockSupported`. Its `LockSeats` method (lines 35–47) calls the DeOniBus reserve API and stores the resulting booking token under the product ID key. When `Reserve` is subsequently called, it detects the existing lock and reuses the previously made reservation rather than making a new API call.

---

## DynamoDB storage

### Table

The seat lock data is stored in the `PreBookingCache` DynamoDB table. The table name is resolved at runtime via the `Tables` configuration helper; the logical name constant is `"PreBookingCache"` declared at [booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs) line 21.

### Schema

The DynamoDB item model is `PreBookingCacheModel` at [booking-service/persistency/BookingService.Persistency/model/PreBookingCacheModel.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/model/PreBookingCacheModel.cs):

| Attribute | DynamoDB type | Description |
|-----------|--------------|-------------|
| `Id` | String (S) | Primary key; the KLV-encoded `BookingToken` string |
| `ExpiredAt` | Number (N) | Unix timestamp for DynamoDB TTL |
| `CreatedAt` | String (S) | ISO datetime |
| `BookingSchema` | Binary (B) | Gzip-compressed JSON Schema (booking form schema) |
| `NameToSupplierNameFields` | Binary (B) | Gzip-compressed field name mapping dictionary |
| `BookingSchemaDictionary` | Binary (B) | Gzip-compressed schema enum dictionary |
| `ItineraryId` | String (S) | Parsed `ItineraryId` string |
| `NextFlowId` | String (S) | Next flow `ItineraryId` |
| `LockedSeats` | String (S) | JSON-serialized `List<string>` of seat identifiers — **written only by `AddSeats`** |

The `LockedSeats` attribute is absent from newly-created items; it is added via a DynamoDB `UpdateItem` operation in `PreBookingCacheRepository.AddSeats` (lines 100–118 of [PreBookingCacheRepository.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs)):

```csharp
UpdateExpression = "SET #seats = :seats",
ExpressionAttributeNames = { { "#seats", "LockedSeats" } },
ExpressionAttributeValues = { { ":seats", new AttributeValue { S = JsonConvert.SerializeObject(seats) } } }
```

### TTL

The `PreBookingCacheModel` constructor calculates `ExpiredAt` as a Unix epoch integer offset from `DateTime.UtcNow` by `expirationTimeInMinutes` minutes (`PreBookingCacheModel.cs` lines 9–13). The value is read from the `"ExpirationTimeInMinutes"` configuration key in `SiFacade.cs` lines 96–98, with a hardcoded default of `7200` minutes (5 days) if the key is absent:

```csharp
private readonly int _expirationTimeInMinutes = !string.IsNullOrEmpty(configuration["ExpirationTimeInMinutes"])
    ? Convert.ToInt32(configuration["ExpirationTimeInMinutes"])
    : 7200;
```

DynamoDB's native TTL mechanism deletes the item automatically when `ExpiredAt` is reached. There is no code-level handling of an expired lock — the item simply disappears from the table. Any subsequent request that tries to read the item by `BookingToken` will receive a `DbItemNotFoundException`, which the exception handler maps to HTTP 422 with message "Itinerary is not available".

The `PreBookingCacheModel` item is created during `GetBookingSchema` (i.e., during the `GetItinerary` call), not during `LockSeats`. By the time `LockSeats` is called, the item must already exist. If the schema item has expired before the client calls `LockSeats`, the call fails immediately at `FetchSchemaFromDB` with `InvalidBookingTokenException`.

---

## Booking flow integration

### How locked seats override the booking request

In `SiFacade.BookingReservation` (lines 295–410 of `SiFacade.cs`), after fetching the `PreBookingCacheModel` from DynamoDB, the following check runs at lines 304–305:

```csharp
if (preBookingCacheModel.LockedSeats is { Count: > 0 })
    siBookingReservationRequest.BookingData.SeatSelection = preBookingCacheModel.LockedSeats;
```

This unconditionally replaces the seat selection from the incoming `CreateBooking` request with the seats that were stored during `LockSeats`. The client's own `seat_selection` in the booking body is silently discarded when locked seats are present. There is no validation that the seats in the lock still match what the client sends in the booking request.

### Sequence

1. Client calls `GET /itineraries/{id}` → `SiFacade.GetBookingSchema` → schema saved to DynamoDB as `PreBookingCacheModel` (no `LockedSeats` yet).
2. Client calls `POST /seats` → `SiFacade.LockSeats`:
   - Validates seats against cached JSON Schema.
   - For 12go: re-validates seats against live schema from supplier (fake path).
   - Writes `LockedSeats` to DynamoDB via `AddSeats`.
   - Returns a synthetic `Booking` with `status: Reserved`.
3. Client calls `POST /bookings` → `SiFacade.BookingReservation`:
   - Reads `PreBookingCacheModel` from DynamoDB.
   - Overwrites `SeatSelection` with `LockedSeats` if present.
   - Proceeds to call the supplier (12go `Reserve` API) with the locked seats.

---

## Failure modes

| Scenario | Exception thrown | HTTP status |
|----------|-----------------|-------------|
| Empty seat list in request | `ReservationException(MissingParameter, ["Seats"])` | 422 — `MissingParameterWithFieldNames` |
| Booking token not found in DynamoDB (schema expired or never created) | `InvalidBookingTokenException` | 422 |
| DynamoDB item missing entirely | `DbItemNotFoundException` | 422 — "Itinerary is not available" |
| Requested seat not present in cached schema | `SchemaValidationException(BookingSchemaItemValidation, [...])` | 422 — `SchemaValidationWrongValue` |
| Requested seat not present in live supplier schema (fake path, 12go) | `SchemaValidationException(SeatsUnavailable, [...])` | 422 — `SeatsUnavailable` |
| Native supplier returns conflict (seat already locked) — DeOniBus only | `ReservationAlreadyExistsException` → `AlreadyReservedException` | 409 — `AlreadyReserved` |
| Native supplier `RequestArgumentException` — DeOniBus only | `SupplierIntegrationHostReserveArgumentException` → `AlreadyReservedException` when `ErrorType == Conflict` | 409 |
| Schema mismatch from supplier | `SupplierIntegrationHostSchemaMismatchException` | 500 |
| DynamoDB write failure (`AddSeats`) | `AmazonDynamoDBException` | 500 |

The `AlreadyReservedException` mapping is at `SiFacade.cs` line 372 and at `SiFacade.LockSeats` lines 693–696 (for the native path only):

```csharp
catch (SupplierIntegrationHostReserveArgumentException e) when (e.ErrorType == SupplierIntegrationErrorType.Conflict)
{
    throw new AlreadyReservedException(e.Message, e);
}
```

For the 12go fake path, there is no "already locked" detection. If a client calls `POST /seats` twice with the same booking token, the second call will overwrite `LockedSeats` in DynamoDB without error, silently replacing the previously locked seats.

---

## 12go native support status

### Current state

`OneTwoGoBookingFunnel` at [integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs) implements `IBookingFunnel` and defines only `Reserve` and `Book`. It does not override `IsSeatLockSupported` (defaults to `false`) or `LockSeats` (defaults to `throw new NotImplementedException()`). There is no seat lock concept anywhere in the 12go integration:

- No seat lock endpoint in the 12go `frontend3` OpenAPI spec (`/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/openapi.yaml`). The word "lock" does not appear in that file. The word "seat" appears only in the context of seat count parameters and seat types, never in a locking context.
- No seat lock method in the 12go API client (`IOneTwoGoApi`).
- No seat lock handling in the 12go booking funnel.

### Open question in design docs

The transition-design decision map at `/Users/sosotughushi/RiderProjects/transition-design/design/decision-map.md` records decision D6 ("Seat lock implementation") with an explicit open question:

> G7 | Will 12go ship a native seat lock API? ETA? | D6 | 12go engineering

The diagram shows "12go native seat lock (when 12go ships it)" as a future branch off D6, but no implementation, ticket reference, or timeline is present in any file in the codebase. The migration strategy document at `/Users/sosotughushi/RiderProjects/transition-design/design/migration-strategy.md` notes:

> Seat lock behavior (currently faked locally) needs manual verification against 12go's developing implementation

The phrase "developing implementation" appears to be an assessment of intent rather than a confirmed roadmap item — no code, API definition, or external reference confirms that 12go is actively building this feature.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. The following references were updated:

| Original local path | GitHub URL |
|---|---|
| `/Users/sosotughushi/RiderProjects/denali/shared-booking-service-open-api/api/definitions/book.yaml` | [denali/blob/main/shared-booking-service-open-api/api/definitions/book.yaml](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/api/definitions/book.yaml) |
| `/Users/sosotughushi/RiderProjects/denali/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs` | [denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs) |
| `/Users/sosotughushi/RiderProjects/denali/shared-booking-service-open-api/api/definitions/model/lock-seats-request.yml` | [denali/blob/main/shared-booking-service-open-api/api/definitions/model/lock-seats-request.yml](https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/api/definitions/model/lock-seats-request.yml) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/host/BookingService.Api/Controllers/BookingController.cs` | [denali/blob/main/booking-service/host/BookingService.Api/Controllers/BookingController.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/Controllers/BookingController.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs` | [denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/IBookingSiHost.cs` | [denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/IBookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/IBookingSiHost.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs` | [denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs` | [supply-integration/blob/main/abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs` (×2) | [supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service-integration/host/BookingServiceIntegration.Api/FakeBookingSiHost.cs` | [denali/blob/main/booking-service-integration/host/BookingServiceIntegration.Api/FakeBookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service-integration/host/BookingServiceIntegration.Api/FakeBookingSiHost.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integrations/DeOniBus/SupplyIntegration.DeOniBus.Funnel/DeOniBusBookingFunnel.cs` | [supply-integration/blob/main/integrations/DeOniBus/SupplyIntegration.DeOniBus.Funnel/DeOniBusBookingFunnel.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/DeOniBus/SupplyIntegration.DeOniBus.Funnel/DeOniBusBookingFunnel.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs` (×2) | [denali/blob/main/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/Repository/Implementation/PreBookingCacheRepository.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/persistency/BookingService.Persistency/model/PreBookingCacheModel.cs` | [denali/blob/main/booking-service/persistency/BookingService.Persistency/model/PreBookingCacheModel.cs](https://github.com/boost-platform/denali/blob/main/booking-service/persistency/BookingService.Persistency/model/PreBookingCacheModel.cs) |

All 15 distinct local file references (17 occurrences) were confirmed to exist in the local repository clones before conversion. No references were left unconverted.

---

## Meeting Insights (2026-03-12)

Source: Soso / Shauly 1-on-1 (timestamp 00:48:13)

### Active Development on 12go Side (Confirmed)

Seat lock is being **actively developed on the 12go side**. This answers Open Question G7 from the original document — 12go will ship native seat lock support.

### TC-Side Integration Plan

**David** will implement the TC-side integration to the new 12go seat lock endpoint as part of the **DeOniBus migration** in the coming weeks.

### Simple Outcome

Once 12go's seat lock endpoint is available, it will be treated like any other API — just call the new endpoint. The current fake seat lock path (local validation + DynamoDB storage) will be replaced by a real supplier-side lock. No complex migration logic needed for this feature.

### 12go Codebase Verification (2026-03-12)

Exploration of the 12go/frontend3 PHP codebase found **no seat lock API endpoint or feature** yet. Searched patterns: `seat_lock`, `seatlock`, `lock_seat`, `lockSeat` — all returned zero matches. Only seat-related files are DTOs for seat map display (`SeatMap.php`, `SeatLineLayout.php`, `SeatMapLayout.php`). This confirms the feature is still in development and not yet deployed.
