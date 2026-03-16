# Booking ID Transition

Denali generates booking IDs in two structurally different formats — a long KLV-encoded string that embeds metadata including the 12go booking ID, and a short 10-character opaque identifier — and clients hold references to whichever format was in use at the time of their booking. After cutover to native 12go, the Denali booking service and its PostgreSQL store will no longer exist, yet clients will continue presenting these Denali-format IDs to post-booking endpoints (GetBooking, Cancel, GetTicket). There is no existing mapping table, reverse-decode path for short IDs, or any planned bridging mechanism that maps a Denali booking ID to a 12go booking ID.

---

## How booking IDs are generated today

### Two generation paths controlled by a feature flag

`BookingId.Generate` in [Denali.BookingIdType/Types/BookingId.cs](https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Types/BookingId.cs) (lines 27–34) accepts four metadata fields plus a boolean `useShortId`. The choice of path is controlled by the `GenerateShortBookingIdPerClient` feature flag, evaluated at reservation time in two places:

- [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Adapters/OneTwoGoBookingReservationAdapter.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Adapters/OneTwoGoBookingReservationAdapter.cs) lines 41–50 (used by the old OneTwoGo booking adapter)
- [booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs) lines 398–415 (used by the supply-integration-host path for other integrations)

If the flag is off (or throws), `useShortId = false` is the fallback, and the KLV generator is used.

### Path 1: KLV-encoded ID (flag off — the legacy default)

[Denali.BookingIdType/Generators/KlvBookingIdGenerator.cs](https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Generators/KlvBookingIdGenerator.cs) (lines 24–64) produces a deterministic, human-readable string with this exact structure:

```
0102V1 | 02 <len> <contractCode> | 03 <len> <integrationId> | 04 <len> <integrationBookingId> | 05 <len> <bookingClientId>
```

Example from test: `0102V10212contractCode0313integrationId0420integrationBookingId050130606bght7n` (`BookingTokenTests.cs` line 12).

The prefix `0102V1` is the fixed version header (`KlvBookingIdGenerator.KlvVersion`, line 10). When stored in the database the raw KLV string is passed through `ConditionalCypher.ConditionalEncrypt`, which applies a Caesar cipher to produce a scrambled string (e.g. `"0102V1"` becomes `"XYXZ4Y"`, `KlvBookingIdGenerator.EncryptedKlvVersion`, line 17). The `BookingId.ShouldSkipEncryption` predicate skips encryption for non-legacy IDs.

Key property: **the 12go booking ID (the `bid` integer from the 12go API) is directly embedded as the `integrationBookingId` field (key 04) in the KLV string.** It is recoverable by decoding the KLV format.

### Path 2: Short ID (flag on — newer clients)

[Denali.BookingIdType/Generators/ShortBookingIdGenerator.cs](https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Generators/ShortBookingIdGenerator.cs) (lines 10–26) generates a 10-character Base62 string. The algorithm:

1. Combines a monotonic timestamp (8 bytes) with 16 random bytes.
2. SHA-256-hashes the 24-byte input.
3. Takes 60 bits of the hash and encodes them as a fixed-length Base62 string.

The result is **opaque and non-reversible** — it carries no encoded metadata. The 12go booking ID cannot be extracted from it. The metadata (contractCode, integrationId, integrationBookingId, clientId) is stored separately in the database alongside the short ID ([PostBookingPersistencyService.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/services/PostBookingPersistencyService.cs) lines 44–166).

---

## 12go booking ID relationship

### How the 12go `bid` is obtained

When the system books through the `onetwogo` supply integration, the booking funnel calls `ReserveBooking`, which returns an `OneTwoGoReserveBookingResult` containing a `BId` (integer) field. That `BId` is passed immediately to `GetBookingDetails` and then returned as the `Reservation.Id` (`OneTwoGoBookingFunnel.cs` lines 39–52).

This `Reservation.Id` (i.e., the 12go `bid` as a string) flows up to `OneTwoGoBookingReservationAdapter.cs` line 55 as the `integrationBookingId` argument to `BookingId.Generate`. It is also stored as `BookingEntity.IntegrationBookingId` in the database (`BookingPersistence/Models/BookingEntity.cs` line 62).

All subsequent post-booking calls to 12go (GetBookingDetails, GetTicket, Cancel, Refund) use this `integrationBookingId` value, not the Denali booking ID:

- `OneTwoGoPostBookingOperations.GetReservation` (line 22): calls `oneTwoGoApi.GetBookingDetails(new GetBookingDetailsRequest(resId))` where `resId` is `integrationBookingId`.
- `OneTwoGoPostBookingOperations.GetTicketUrl` (line 58): same pattern.
- `OneTwoGoPostBookingOperations.Cancel` (line 88): calls `GetRefundOptionsBooking` with `resId`.

The `GetBookingDetailsRequest` wraps the ID as `BookingId` (a string), and `OneTwoGoApi.GetBookingDetails` builds the URI from it using `uriBuilder.BuildBookingDetailsUri(req.BookingId)`.

### OneTwoGoInternal integration

For the `OneTwoGoInternal` integration, the API client itself generates a GUID-derived reservation ID (`OneTwoGoInternalApiClient.GenerateBookingId()`, line 168: `Guid.NewGuid().ToString().ToUpper().Replace("-", "")`). This is the ID used in the reservation URL path. The confirmation and finalization calls return a `Bid` from 12go's side (`OneTwoGoInternalBookingFunnel.cs` lines 86, 132). That `Bid` becomes the `Reservation.Id` passed back to the booking host.

---

## URL shortening — affected clients

There is no external URL-shortening service in use. The term "URL shortening" in this context refers to the `ShortBookingIdGenerator` described above. Clients that had the `GenerateShortBookingIdPerClient` feature flag enabled received 10-character Base62 IDs instead of KLV strings.

Which specific clients have this flag enabled is determined by the feature management configuration (LaunchDarkly or equivalent), not hardcoded in the source. The feature flag name is `GenerateShortBookingIdPerClient` ([FeatureFlags.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/FeatureFlags/FeatureFlags.cs) line 24). All requests from such clients result in short IDs with no 12go booking ID recoverable from the ID string alone.

There is also a CaesarCypher-based obfuscation layer applied at the API boundary for KLV IDs:
- Incoming: `ConditionalCypher.ConditionalDecrypt(bookingId, BookingId.ShouldSkipDecryption)` — decrypts only if the ID starts with the encrypted KLV prefix `"XYXZ4Y"` ([PostBookingApiController.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs) line 27, 59, 79).
- Outgoing: `ConditionalCypher.ConditionalEncrypt(...)` with `BookingId.ShouldSkipEncryption` — encrypts only KLV-format IDs (those starting with `"0102V1"`).
- Short IDs pass through both predicates unchanged.

---

## Storage and lookup

### Database: PostgreSQL (BookingEntities table)

The table schema is defined in [post-booking-service/BookingPersistence/Models/BookingEntity.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/BookingPersistence/Models/BookingEntity.cs) and established by the initial migration [Migrations/20241211103612_Initial.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/BookingPersistence/Migrations/20241211103612_Initial.cs).

Key columns:

| Column | Type | Contents |
|---|---|---|
| `id` (PK) | `text` (max 512) | The Denali booking ID, **encrypted if KLV format**. For short IDs, stored as-is. |
| `plain_id` | `text` (max 512) | The Denali booking ID in plain (unencrypted) form. |
| `si_host_booking_id` | `text` (max 512) | Same value as `plain_id` (comment in code: "Same as PlainId — plain short id"). |
| `integration_booking_id` | `text` (max 100) | The 12go `bid` as a string. |
| `integration_id` | `text` (max 50) | The Denali integration identifier (e.g., `"onetwogo"`). |
| `contract_code` | `text` (max 50) | The contract code used to scope the integration. |
| `client_id` | `text` (max 50) | The booking client ID. |

The `id` column is the primary key and is also used as the lookup key by `BookingRepository.GetById`. Lookup by Denali booking ID is done through:
- `IPostBookingPersistencyService.GetBookingById` → `bookingRepository.GetById(ConditionalCypher.ConditionalEncrypt(bookingId, BookingId.ShouldSkipEncryption))` ([PostBookingPersistencyService.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/services/PostBookingPersistencyService.cs) lines 199–200).

There is also a unique index on `(IntegrationId, IntegrationBookingId)` (`BookingEntity.cs` line 9), enabling reverse lookup by 12go booking ID:
- `IPostBookingPersistencyService.GetByIntegrationBookingIdAndIntegration` → `context.BookingEntities.FirstOrDefaultAsync(c => c.IntegrationBookingId == id && c.IntegrationId == integrationId)` ([BookingRepository.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/BookingPersistence/Repository/BookingRepository.cs) lines 125–127).

This reverse lookup exists as an API method on the interface and repository, but it is **not called by any of the post-booking API endpoints** (GetBooking, Cancel, GetTicket). It is present in the interface declaration but the call sites are not exposed to external clients through the facade layer.

---

## In-flight bookings at cutover

### Bookings confirmed before cutover (KLV format)

For bookings created while `GenerateShortBookingIdPerClient` was off, the client holds an encrypted KLV string like `XYXZ4Y...`. A client calling GET `/bookings/{id}` after cutover triggers:

1. `PostBookingApiController.GetBooking` (line 59): decrypts the KLV prefix with `ConditionalDecrypt`.
2. The decrypted plain KLV string is passed to `PostBookingPersistencyService.GetBookingById` → `bookingRepository.GetById(...)` using the re-encrypted form as the primary key.
3. The `BookingEntity` is found; a `BookingId` is constructed from `entity.PlainId`, `entity.ContractCode`, `entity.IntegrationId`, `entity.IntegrationBookingId`, `entity.ClientId`.
4. The facade calls `postBookingSiHost.GetBookingDetails` with this full `BookingId`, which reaches the supply integration using `entity.IntegrationBookingId` as the 12go `bid`.

All of this relies entirely on the Denali PostgreSQL database being present and populated. If the database is decommissioned, step 2 returns `null`, and step the facade throws `InvalidBookingIdException` (line 59–61 of `PostBookingSiFacade.cs`).

### Bookings confirmed before cutover (short ID format)

Identical dependency: the 10-character short ID has no decodable content, so database lookup is the only path to `integrationBookingId`. Without the database there is no way to identify the 12go `bid` and the request fails identically.

### No existing mapping or bridge mechanism

There is no code in either repository that:
- Maintains a separate mapping table from Denali booking IDs to 12go booking IDs.
- Provides an API endpoint that resolves a Denali booking ID to a 12go booking ID.
- Reads from or writes to any id-translation store.
- Performs any migration-time backfill.

The `RestoreBookings` feature ([RestoreReservationConfirmationSucceededHandler.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Messages/RestoreReservationConfirmationSucceededHandler.cs)) replays Kafka events to re-populate the `BookingEntities` table, but it is a disaster-recovery mechanism for re-seeding the existing Denali DB from Kafka history — it does not provide a path to 12go native IDs.

---

## Impact

### All three post-booking endpoints fail for pre-cutover bookings if the Denali DB is gone

- **GET /bookings/{id}** (`PostBookingApiController.GetBooking`): fails at `GetBookingById` returning `null`, throws `InvalidBookingIdException`.
- **POST /bookings/{id}/cancel** (`PostBookingApiController.CancelBooking`): fails at `GetBookingById` returning `null`, throws `ReservationDoesntExistException` which is re-thrown as `InvalidBookingIdException`.
- **GET /bookings/{id}/ticket** (`PostBookingApiController.GetTicket`): fails at `GetBookingById` returning `null`, throws `EntityNotFoundException`.

### KLV IDs are decodable but short IDs are not

For KLV-format bookings, the 12go `bid` is directly embedded in key position `04` of the plaintext KLV string and can be extracted by decoding the KLV structure. For short IDs (clients with `GenerateShortBookingIdPerClient` enabled), there is no information in the ID itself — recovery is impossible without either the database row or an external mapping.

### The `integrationBookingId` column is the only bridge

The `BookingEntity.IntegrationBookingId` column stores the 12go `bid` and is the only persistent link between a Denali booking ID and a 12go booking ID. Any migration strategy that requires post-cutover lookup of pre-cutover bookings must use this column or a derivative of it.

### Two distinct client populations

Clients that received KLV-format IDs hold an opaque (Caesar-encrypted) string where the 12go `bid` is recoverable by decryption and KLV parsing. Clients that received short IDs hold an opaque 10-character string with no embedded information. These two populations require different handling at migration time.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. 12 GitHub URL references were added, covering the following source files in the `denali` and `supply-integration` repositories:

- `denali`: `BookingId.cs`, `KlvBookingIdGenerator.cs`, `ShortBookingIdGenerator.cs`, `PostBookingPersistencyService.cs`, `BookingEntity.cs`, `BookingRepository.cs`, `PostBookingApiController.cs`, `FeatureFlags.cs`, `RestoreReservationConfirmationSucceededHandler.cs`, `OneTwoGoBookingReservationAdapter.cs`, `BookingSiHost.cs`
- `denali`: EF Core migrations directory (`BookingService.Persistency/Migrations/`)

All referenced files were confirmed to exist in the local repository clone at `/Users/sosotughushi/RiderProjects/denali` before conversion. No references were left unconverted.

---

## Meeting Insights (2026-03-12)

Source: Soso / Shauly 1-on-1 (timestamps 00:11:45 – 00:34:08)

### Short IDs Are Per-Client

The `GenerateShortBookingIdPerClient` feature flag is evaluated **per client**, not per integration. Shauly confirmed that "we moved like few of them but we can move all of them if we want but it will be from now on for those clients." This means the short ID format could be adopted for all clients going forward.

**Code verification**: The flag is evaluated via `featureManager.IsEnabledAsync(nameof(FeatureFlags.GenerateShortBookingIdPerClient))` in two places:
- `OneTwoGoBookingReservationAdapter.cs` (line 44) — the legacy OneTwoGo booking adapter
- `BookingSiHost.cs` (line 401) — the supply-integration-host path

This is a standard .NET `IFeatureManager` flag — likely configured through Azure App Configuration or similar, allowing per-client targeting rules.

### Static Mapping Table Confirmed

Shauly and Soso agreed that a **static one-time mapping table** (old booking ID → 12go `bid`) is needed, specifically for **post-booking operations only**: cancel, get tickets, get booking details, and booking notifications. This table would be populated once during migration.

### Database Inspection Results

Shauly walked through the `BookingEntities` database table:
- Old KLV-format IDs **do** contain the 12go `bid` embedded (confirmed visually)
- Short IDs do **NOT** contain the 12go `bid` — they are fully opaque
- The short ID feature flag was not enabled for all clients

### FlixBus and DeOniBus Integration Sunset

- **FlixBus**: Being shut down as of 2026-03-12. No new bookings; last departure dates around October. Was used by: GetByBus, BookAway, 12go
- **DeOniBus**: David is actively migrating DeOniBus clients to 12go. In a few weeks, no new DeOniBus bookings. Was used by: BookAway, BEF, Sakura, Orians, Comport
- **Key insight**: FlixBus/DeOniBus IDs don't correspond to 12go IDs, but since these integrations are being shut down, the problem resolves naturally

### Legacy Booking Handling

Very few legacy bookings remain (e.g., ~6 DeOniBus bookings with departure dates after June). Options discussed:
1. Keep the legacy system running briefly for those specific bookings
2. **Snapshot approach**: Before shutdown, fetch booking details and store/create them manually in 12go

Shauly's gut feeling: by the time the last client migrates, legacy bookings will have expired naturally. "I wouldn't break my head for that."

### Encryption Decision (Open Question)

Shauly raised the question (~01:10:16): **Should booking ID, itinerary ID, and booking token be encrypted** in the new system? This remains an open decision.

### No-Persistence Design Decision

A design decision was reached (~01:11:38): **eliminate the local DB layer for booking details** in the new system. Rely entirely on 12go as the source of truth. Implication: data like cancellation policies (currently stored in TC's DB) will need to be fetched via additional API calls to 12go. Example: cancellation policy is returned on search/get itinerary but NOT on get booking details currently.
