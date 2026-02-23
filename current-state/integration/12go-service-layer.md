---
status: draft
last_updated: 2026-02-23
---

# 12go Service Layer (frontend3 Internals)

This document captures the internal Symfony service classes, managers, repositories, and controllers of the 12go `frontend3` PHP/Symfony monolith that are relevant to designing the B2B API layer. All paths are relative to `frontend3/src/`.

---

## Source Structure

```
src/
├── ApplicationGlobals.php        # Request-scoped globals (language, whitelabel, base URL)
├── Booking/                      # Booking domain (cart, reserve, confirm, post-booking)
│   ├── Component/Cart/           # Cart object (session-based, Redis-backed, 8-char hash)
│   ├── DTO/                      # Booking DTOs (Booking, BookingCreated, Passenger, etc.)
│   ├── Event/                    # Symfony events for booking lifecycle
│   ├── Exception/                # Booking exceptions
│   ├── Form/                     # Booking form processing
│   ├── Manager/                  # ~25 managers wrapping MariaDB operations
│   ├── Repository/               # MariaDB repositories for booking tables
│   └── Service/                  # Orchestration services (BookingProcessor, CartHandler, etc.)
├── Core/                         # Cross-cutting concerns
│   ├── Manager/                  # Master data managers (Station, Operator, Class, etc.)
│   ├── Repository/               # ~70+ MariaDB repositories
│   └── Service/                  # Infrastructure services (ApiAgent, Currency, JwtAuth, etc.)
├── TripSearch/                   # Search domain
│   ├── Component/                # Search pipeline components
│   ├── DTO/ApiV1/ ApiV2/         # Search DTOs for internal API versions
│   ├── Factory/                  # TripResultFactory, SearchResultsFactory
│   ├── Manager/                  # TripPoolManager, AutopackManager, etc.
│   ├── Repository/               # TripPoolRepository (primary MariaDB search table)
│   └── Service/                  # SearchService, Rechecker, IntegrationService
├── Integration/                  # Supplier integration layer
├── Controller/
│   ├── ApiV1/                    # HTTP controllers for the 12go v1 API
│   └── ApiV2/                    # HTTP controllers for the 12go v2 API
└── VersionedApiBundle/           # Custom Symfony bundle for X-Api-Version header versioning
```

---

## Key Service Classes

### `App\TripSearch\Service\SearchService`

**Purpose**: Factory for `Search` objects. Composes all the collectors, managers, and repositories needed for a search.

**Key method**: `newSearch(): Search` — creates a fully wired `Search` instance.

**Data access**: `Search` reads from `TripPoolRepository` (MariaDB `trip_pool` table). Live availability rechecks go through `Rechecker` which makes HTTP calls to integration APIs (can take up to 1 minute).

**Used by**: `Controller\ApiV1\SearchController::searchAction()` via `$searchService->newSearch()`.

**Relevant DI dependencies**: `TripPoolRepository`, `Rechecker`, `IntegrationService`, `OperatorManager`, `StationManager`, `PricingFeatureManager`, `ImageManager`, `ABTest`.

---

### `App\TripSearch\Component\Search`

**Purpose**: Executes the actual search query against `TripPoolRepository`, then applies collectors (operators, stations, classes, reasons), pricing, availability, and after-filters.

**Key methods**:
- `searchWithRecheckUrls(SearchFilter $filter): SearchResultsFull` — primary search path; includes URLs for live rechecking
- `searchWithoutRecheckUrls(SearchFilter $filter): SearchResultsFull` — used after rechecking; returns clean results

**Data model**: Reads from MariaDB `trip_pool` table (which 12go keeps updated from supplier integrations). Province IDs (`1p`, `2s`) are used, not station IDs directly.

---

### `App\TripSearch\SearchFilterBuilder`

**Purpose**: Translates URL parameters (`fromPlaceId`, `toPlaceId`, `date`, `seats`, `direct`) into a `SearchFilter` object.

**Key method**: `buildBySearchRequest(string $fromPlaceId, string $toPlaceId, DateTimeImmutable $date, array $params): ?SearchFilter`

**Relevance**: Must understand that `fromPlaceId` uses the `{id}p` province ID format. B2B controllers need to translate Fuji station IDs → 12go province IDs before calling this.

---

### `App\TripSearch\Service\Rechecker`

**Purpose**: Makes live availability checks against supplier integration APIs for specific trip keys.

**Key method**: `recheckBySearch(SearchResultsFull $results): void` — triggers HTTP calls to integration APIs for trips in the recheck list.

**Relevance**: Rechecking adds up to 1 minute latency. B2B search typically doesn't need to trigger rechecks immediately.

---

### `App\Booking\Service\BookingProcessor`

**Purpose**: The primary orchestration service for the booking funnel (create, reserve, confirm).

**Key methods**:
- `createBookingsAndSetIds(array $bookingFormHandlingResults, User $user): BookingCreated[]` — creates booking records in MariaDB
- `reserveBooking(BookingBase $booking, bool $useSellerFallback = true): ?BookingReservationResult` — calls the supplier reservation API
- `reserveBookings(array $bookings): void` — reserves multiple bookings
- `confirmBooking(Booking $booking, ?array $cartBookings = null): ConfirmationStatus` — acquires a Redis lock and confirms
- `confirmBookings(array $bookings, ?array $cartBookings = null): ConfirmationStatus[]` — confirms multiple bookings sorted by departure time
- `processBookingAuth(User $bookingUser): BookingAuthorization` — resolves/creates user for booking
- `setRefundOptions(BookingBase $booking, ProductPlainInterface $productPlain): self` — pre-populates cancellation policy data

**DI dependencies**: ~25 managers including `BookingManager`, `BookingReservationManager`, `BookingConfirmationManager`, `BookingFinanceManager`, `PassengerManager`, `BookingProductManager`, `ProductManager`, `TripManager`, `CancellationManager`, `ABTest`, `PromoCodeManager`.

**Relevance for B2B**: B2B CreateBooking calls `createBookingsAndSetIds` + `reserveBookings`. B2B ConfirmBooking calls `confirmBookings`.

**Important constraint**: `BookingProcessor` requires a `User` object (customer email/phone). B2B bookings need a system/agent user per client, or the `ApiAgent` mechanism must be used.

---

### `App\Booking\Service\CartHandler`

**Purpose**: Handles adding trips to cart and booking form handling.

**Key method**: `handleAddTrip(Cart $cart, SeatCode $seatCode, string $tripKey, DateTimeImmutable $dateAndTime, ...)`: adds a trip to the cart after checking availability.

**Relevance**: B2B GetItinerary needs to call `CartHandler::handleAddTrip()` to create a cart, which returns a `cartHash` used as the BookingToken.

---

### `App\Booking\Manager\BookingManager`

**Purpose**: CRUD operations on the `booking` MariaDB table.

**Key methods**:
- `getById(int $bid): ?Booking`
- `createAndSetId(BookingBase $booking): ?int`
- `setTracker(int $bid, ?string $tracker): bool`
- `countSuccessfulBookings(int $userId): int`

---

### `App\Booking\Manager\BookingDetailsManager`

**Purpose**: Provides enriched booking details (used in the `/booking/{bid}/booking-details` endpoint).

**Key methods**:
- `getBookingDetails(Booking $booking): ?BookingDetails`
- `isBookingDetailsSupported(Booking $booking): bool`

---

### `App\Booking\Manager\BookingFormManager`

**Purpose**: Manages the dynamic booking form — generating form fields, validating submissions, handling checkout schema.

**Relevance**: The dynamic checkout form (20+ wildcard field patterns we saw in the .NET side) is managed here. This is the PHP equivalent of `OneTwoGoBookingSchemaResponse`. The B2B booking schema mapper should call this manager.

---

### `App\Booking\Manager\BookingReservationManager`

**Purpose**: Manages reservation records and delegates to supplier reservation APIs.

**Key methods**:
- `reserve(int $bid, ?int $sellerId = null): ?BookingReservationResult`
- `cancelReservation(int $bid): void`
- `handleReservationFailure(int $bid): void`
- `moveReservation(int $oldBid, int $newBid): bool`

---

### `App\Booking\Manager\BookingConfirmationManager`

**Purpose**: Performs the actual confirmation step with the supplier integration.

**Key method**: `performConfirmation(Booking $booking, array $cartBookings): ConfirmationStatus`

---

### `App\Booking\Service\ReservationHandler`

**Purpose**: Low-level handler for reserve/confirm calls to supplier APIs.

**Constants**: `METHOD_RESERVE`, `METHOD_CONFIRM` — method types used in reservation records.

---

### `App\Core\Service\ApiAgent`

**Purpose**: Represents the currently authenticated API agent (partner/B2B client). Acts as request-scoped identity for the agent making the API call.

**Key methods**:
- `isLogged(): bool`
- `isPartner(): bool`
- `getId(): ?int`

**Relevance for B2B**: This is the mechanism frontend3 already uses for API partner authentication. B2B clients should be modeled as API agents. The `b2b_client` authentication bridge should resolve incoming `clientId`+`x-api-key` to an `ApiAgent`.

---

### `App\Core\Repository\StationRepository`

**Purpose**: MariaDB repository for the `station` table. Contains all station data including province IDs.

**Key methods** (from repository pattern): `findById(int $id): ?Station`, `findByProvinceId(int $provinceId): array`, etc.

---

### `App\Core\Repository\OperatorRepository`

**Purpose**: MariaDB repository for the `operator` table.

---

### `App\Core\Manager\StationManager`

**Purpose**: Caching wrapper over `StationRepository`. Provides methods like `getById(int $id): ?Station`, `getTimezoneByStationId(int $id): DateTimeZone`.

---

### `App\Core\Manager\OperatorManager`

**Purpose**: Caching wrapper over `OperatorRepository`.

---

### `App\Booking\Component\Cart\Cart`

**Purpose**: Session-backed cart object stored in Redis, identified by an 8-character hash. Holds `CartItem` objects (one per trip or pass).

**Key methods**: `fromHash(string $hash): bool`, `getHash(): ?string`, `getItems(): array`, `add(CartItem $item): void`.

**Relevance**: The cart hash is the `cartId` used in our current 12go `/cart/{cartId}` calls. In the monolith design, this becomes a native in-process object.

---

## Key Controllers

### `App\Controller\ApiV1\SearchController`

**Routes**:
- `GET /search/{fromPlaceId}/{toPlaceId}/{date}` — search by province ID (format `{id}p` or `{id}s`)
- `GET /search/{fromStationsId}/{toStationsId}/{date}` — search by station IDs

**Flow**: Calls `SearchService::newSearch()`, builds a `SearchFilter` via `SearchFilterBuilder`, calls `Search::searchWithRecheckUrls()`.

**Relevance**: B2B Search controller can replicate this flow directly, bypassing this controller.

---

### `App\Controller\ApiV1\CartController`

**Routes**:
- `POST /cart/{tripKey}/{dateAndTime}` — add trip to cart
- `GET /cart/{hash}` — get cart contents
- `POST /cart` (body params) — add trip to cart by operator/class/route params

**Relevance**: B2B GetItinerary calls `CartHandler::handleAddTrip()` directly instead of going through this controller.

---

### `App\Controller\ApiV1\BookingProcessController`

**Purpose**: The main booking controller. Handles form submission, creates bookings, reserves, confirms, and processes payment.

**Flow**: Builds `BookingFormHandlingResult` from form data → calls `BookingProcessor::createBookingsAndSetIds()` → `reserveBookings()` → payment → `confirmBookings()`.

**Relevance**: B2B CreateBooking and ConfirmBooking will replicate parts of this flow but without the payment step (B2B is pre-paid via credit line).

---

### `App\Controller\ApiV1\BookingDetailsController`

**Route**: `GET /booking/{bid}/booking-details`

**Flow**: Calls `BookingManager::getById()` then `BookingDetailsManager::getBookingDetails()`.

---

### `App\Controller\ApiV1\RefundController`

**Routes**:
- `GET /booking/{bid}/refund-options`
- `POST /booking/{bid}/refund`

**Current implementation**: Makes **HTTP self-calls** via Guzzle to `{baseUrl}/{lang}/api/v1/secure/refund-options/{bid}`. This is because the refund logic lives in an internal "secure" API endpoint.

**Relevance**: This is a known pattern in frontend3 for inter-layer calls. B2B CancelBooking should try to inject the underlying refund service directly, but may need to replicate this HTTP self-call pattern if the secure API is the canonical path.

---

### `App\Controller\ApiV1\WebhookController`

**Route**: `POST /webhook`

**Current behavior**: Accepts the webhook payload (validates fields `bid`, `stamp`, `type`, `previous_data`, `new_data`), and returns 200 with **no further processing**. The payload is not forwarded or stored.

**Relevance**: This is a critical gap. The B2B notification transformer must be wired into this webhook handler to actually process and forward booking status changes to B2B clients.

---

## Versioning Infrastructure

### `App\VersionedApiBundle\VersionedApiBundle`

A custom Symfony bundle already present in frontend3 that provides method-level versioning based on an HTTP header.

| Aspect | Detail |
|---|---|
| **Header** | `X-Api-Version` (configurable) |
| **Version format** | Semver (e.g., `2.0.1`) |
| **Fallback** | Routes to nearest lower version if exact match not found |
| **Resolution** | Compile-time map in `var/cache/*/version_map.php` |
| **Annotation** | `#[ApiVersion('2.0.1')]` on method, `#[DefaultApiVersion('2.0.0')]` on class |
| **Config** | `config/packages/versioned_api.yaml` |

**Relevance for B2B**: The `Travelier-Version` header (YYYY-MM-DD date format) used by our B2B clients is different from `X-Api-Version` (semver). Options: (A) reconfigure `VersionedApiBundle` to use `Travelier-Version` header with date-based version matching, or (B) implement a separate version resolution layer in the B2B bundle.

---

## Data Access Patterns

### MariaDB Access

Frontend3 uses a custom repository pattern with `ConnectionManager` wrapping PDO. No Doctrine ORM — all queries are written in raw SQL inside repository classes.

| Repository | Table | Key Notes |
|---|---|---|
| `TripPoolRepository` | `trip_pool` | Primary search table; updated by integration rechecks |
| `StationRepository` | `station` | Station master data |
| `OperatorRepository` | `operator` | Operator master data |
| `BookingRepository` | `booking` | Core booking table |
| `PassengerRepository` | `passenger` | Passenger records |
| `BookingReservationRepository` | `booking_reservation` | Reservation records with tracker |
| `CartRepository` | `cart` | Cart hash → booking mapping |
| `ApiKeyRepository` | `api_key` | API key authentication for agents |

### Redis Access

Used for: cart state (hash → items), session data, rate limiting, search caching.

Cart objects are stored with the 8-character hash as key. The `Cart::fromHash()` method loads cart state from Redis.

---

## Open Questions from Internals Discovery

1. **ApiAgent authentication mechanism**: How are API agents registered in the `api_key` table? What fields does an agent record have? This is the mechanism we'll use for B2B client authentication.
2. **Refund secure API endpoint**: What does `/api/v1/secure/refund-options/{bid}` do internally that can't be accessed via direct service injection?
3. **WebhookController gap**: The current webhook handler does nothing after validating the payload. Is there a downstream process (Kafka consumer, cron job) that reads from the webhook table? Or is this endpoint simply dead code?
4. **Cart persistence**: Does the Cart survive server restarts? What is the Redis TTL for cart entries?
5. **`ApiKeyRateLimitRepository`**: Is there rate limiting on the existing API key endpoints? This affects B2B throughput planning.
6. **B2B booking without payment**: `BookingProcessController` ties reservation to payment (Paygate). How is the B2B flow (reserve now, credit line payment later) handled today, if at all? Does the `ApiAgent::isPartner()` flag bypass payment?
