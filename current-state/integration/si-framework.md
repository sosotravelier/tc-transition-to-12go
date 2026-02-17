---
status: draft
last_updated: 2026-02-17
---

# Supply-Integration Framework Analysis

## Overview

The Supply-Integration (SI) framework is a multi-supplier abstraction layer that allows multiple transport integrations (OneTwoGo, Distribusion, FlixBus, Bookaway, DeOniBus, Plataforma10, SeatOS, Sisorg, Songserm, Phantip, TcTour, OneTwoGo Internal) to be consumed through a single set of interfaces. It sits between two host services:

- **Etna** (Search Service) — consumes `ISearchSupplier` for search operations
- **Denali** (Booking Service) — consumes `IBookingFunnel`, `IBookingSchema`, and `IPostBookingOperations` for booking operations

The framework provides DI scoping (via Autofac), HTTP connectivity with auth/retry, caching, persistence, metrics, and configuration management — all on a per-integration, per-contract basis.

---

## Core Abstractions

### 1. `ISearchSupplier` — Search Interface

Located in: `abstractions/SupplyIntegration/Abstractions/Search/ISearchSupplier.cs`

```csharp
[SupplierSpecific]
public interface ISearchSupplier
{
    bool SupportsRequestedSeats => false;

    // Batch search across routes
    IAsyncEnumerable<Itinerary> Search(
        IEnumerable<SearchRoute> routes, DateOnly departureDate,
        uint numberOfSeats, SiSearchContext context = null!,
        CancellationToken cancellationToken = default);

    // Get single itinerary by ID
    Task<Result<Itinerary, MissingItineraryReason>> GetItinerary(
        string itineraryId, uint numberOfSeats,
        CancellationToken cancellationToken = default);
}
```

**Key types:**
- `SearchRoute(Station From, Station To)` — route with station details including `AdditionalProperties`
- `SearchRequest(FromId, ToId, RouteType, DepartureDate, NumberOfSeats)` — legacy flat request (obsolete)
- `SiSearchContext` — carries `IsSearchIncomplete` flag
- `MissingItineraryReason` — enum: `AlreadyDeparted`, `NotEnoughSeatsAvailable`, `FullyBooked`, `NotFound`

### 2. `IBookingFunnel` — Reserve & Confirm

Located in: `abstractions/SupplyIntegration/Abstractions/Booking/IBookingFunnel.cs`

```csharp
[SupplierSpecific]
public interface IBookingFunnel
{
    Task<Reservation> Reserve(string productId, Cost cost,
        IBookingRequest bookingDetails,
        CancellationToken cancellationToken = default);

    Task<Reservation> Book(string resId, Cost cost,
        CancellationToken cancellationToken = default);

    Task<Reservation> LockSeats(string productId,
        IBookingRequest bookingDetails,
        CancellationToken cancellationToken = default)
        => throw new NotImplementedException();

    bool IsSeatLockSupported() => false;
}
```

**Booking flow documented in the interface:**
1. `GetItinerary` (from `ISearchSupplier`) with product ID from search
2. `GetBookingSchema` (from `IBookingSchema`) with search product ID and itinerary product ID
3. `GetBookingRequest` (from `IBookingSchema`) to transform TConnect request to supplier format
4. `Reserve` — stage 1 of two-phase booking
5. `Book` — stage 2, confirm the reservation

### 3. `IBookingSchema` — Form Schema & Request Transform

Located in: `abstractions/SupplyIntegration/Abstractions/Booking/IBookingSchema.cs`

```csharp
[SupplierSpecific]
public interface IBookingSchema
{
    Task<BookingSchema> GetBookingSchema(
        string currentProductId, string nextProductId,
        CancellationToken cancellationToken = default);

    Task<IBookingRequest> GetBookingRequest(
        string productId, BookingRequest bookingRequest,
        CancellationToken cancellationToken = default);

    string GetDOBInSupplierFormat(string dob)
        => throw new NotImplementedException();
}
```

The `BookingSchema` class is a rich model with:
- Core fields: `PhoneNumber`, `Email`, `PassengerFirstName`, `PassengerLastName`
- Optional passenger fields: gender, title, nationality, residency, ID type, DOB, ID scan, etc.
- Pickup/dropoff/delivery points (many variants)
- Seat selection, baggage, upgrades/extras

### 4. `IPostBookingOperations` — Cancel, Get Reservation, Get Ticket

Located in: `abstractions/SupplyIntegration/Abstractions/Post-Booking/IPostBookingOperations.cs`

```csharp
[SupplierSpecific]
public interface IPostBookingOperations
{
    Task<Result<CancelationResponse, CancellationError>> Cancel(
        string resId, CancellationToken cancellationToken = default);

    Task<ReservationDetails> GetReservation(
        string resId, CancellationToken cancellationToken = default);

    Task<Result<Uri, TicketCreationError>> GetTicketUrl(
        string resId, CancellationToken cancellationToken = default);
}
```

### 5. Core Domain Models

**`Itinerary`** — search result

| Field | Type | Description |
|---|---|---|
| `Id` | `string` | Flow ID for next funnel step (not stable) |
| `DepartureSegments` | `Segment[]` | Outbound legs |
| `ReturnSegments` | `Segment[]?` | Return legs (if round-trip) |
| `PriceList` | `PriceList` | Pricing info |
| `ConfirmationType` | `ConfirmationType` | `Instant` or `Pending` |
| `ClxPolicies` | `ClxPolicy[]` | Cancellation policies |
| `ConnectionGuarantee` | `bool?` | Connection guaranteed |
| `AvailableSeats` | `ushort` | Available seats |
| `TicketType` | `TicketType` | `PaperTicket`, `ShowOnScreen`, `PickUp` |
| `Cutoff` | `TimeSpan?` | Sell cutoff before departure |
| `RequestedSeats` | `ushort?` | Requested seats (if supported) |

**`Segment`** — a single leg

| Field | Type | Description |
|---|---|---|
| `FromStationId` | `string` | Departure station |
| `ToStationId` | `string` | Arrival station |
| `DepartureDateTime` | `DateTimeOffset` | Departure time |
| `Duration` | `TimeSpan` | Leg duration |
| `OperatorDesignatedId` | `string?` | Operator's class ID |
| `OperatorId` | `string?` | Operator ID (aggregator only) |
| `TransportationTypes` | `TransportationType[]` | Bus/Ferry/Van/Train/Airplane |
| `ClassId` | `string` | Class ID |

**`Reservation`** — booking result

| Field | Type | Description |
|---|---|---|
| `Id` | `string` | Stable reservation ID |
| `Cost` | `Cost?` | `(Price, Currency)` |
| `Status` | `ReservationStatus` | See enum below |
| `VoucherUrl` | `string?` | Voucher URL |
| `OperatorBookingId` | `string?` | Operator's booking reference |
| `TaxesAndFees` | `decimal?` | Taxes and fees |
| `Gross` | `Gross?` | Gross pricing |

**`ReservationStatus`** — enum: `PendingClientConfirmation`, `Confirmed`, `PendingSupplierConfirmation`, `Canceled`

**`ReservationDetails`** — post-booking details

| Field | Type |
|---|---|
| `ReservationId` | `string` |
| `Status` | `ReservationStatus` |
| `FromStationId` | `string` |
| `ToStationId` | `string` |
| `DepartureDateTime` | `DateTimeOffset` |
| `OperatorId` | `string?` |
| `CreatedAt` | `DateTimeOffset` |
| `NumberOfSeats` | `uint` |
| `VoucherUrl` | `string?` |
| `OperatorBookingId` | `string?` |

**`Cost`** — `record Cost(decimal Price, Currency Currency)`

**`PriceList`** — `record struct PriceList(Currency SupplierCurrency, GrossPriceType? GrossPriceType, PricePerAgeSegment[] Prices, decimal? TaxesAndFees)`

---

## Integration Registration

### Pattern

Each integration registers itself per-host using a builder pattern:

```csharp
services.AddSiServices(configuration, builder =>
{
    builder.AddIntegration("OneTwoGo", supplierServices =>
    {
        supplierServices.AddOneTwoGoSearch();       // Etna (search)
        // or
        supplierServices.AddOneTwoGoBookingFunnel(); // Denali (booking)
        supplierServices.AddOneTwoGoBookingSchema(); // Denali (booking)
    });
});
```

### Etna (Search Host) Registration

From `Etna.Search.SupplierIntegration/RegisterSiServices.cs`:

| Integration | Registration Method |
|---|---|
| Songserm | `AddSongsermServices(config)` |
| Phantip | `AddPhantipServices(config)` |
| SeatOS | `AddSeatOsSearch(config)` |
| DeOniBus | `AddDeOniBusSearch(config)` |
| Distribusion | `AddDistribusionServices(config)` |
| Plataforma10 | `AddPlataforma10Search(config)` |
| FlixBus | `AddFlixBusSearch()` |
| **OneTwoGo** | `AddOneTwoGoSearch()` |
| Sisorg | `AddSisorgSearch(config)` |
| Bookaway | `AddBookawaySearch()` |
| OneTwoGo Internal | `AddOneTwoGoInternalSearch(config)` |
| TcTour | `AddTcTourSearch()` |

Also configures `HybridCache` with compression enabled.

### Denali (Booking Host) Registration

From `BookingService.SupplierIntegrationHost/ConfigureServices.cs`:

| Integration | Registration Methods |
|---|---|
| SeatOS | `AddSeatOsBookingFunnel()`, `AddSeatOsBookingSchema()` |
| DeOniBus | `AddDeOniBusBookingSchema(config)`, `AddDeOniBusBookingFunnel(config)` |
| Distribusion | `AddDistribusionBookingSchema(config)`, `AddDistribusionBookingFunnel(config)` |
| Plataforma10 | `AddPlataforma10BookingSchema(config)`, `AddPlataforma10BookingFunnel(config)` |
| **OneTwoGo** | `AddOneTwoGoBookingFunnel()`, `AddOneTwoGoBookingSchema()` |
| OneTwoGo Internal | `AddOneTwoGoInternalBookingFunnel(config)`, `AddOneTwoGoInternalBookingSchema(config)` |
| FlixBus | `AddFlixBusBookingSchema()`, `AddFlixBusBookingFunnel()` |
| Bookaway | `AddBookawayBookingSchema()`, `AddBookawayBookingFunnel()` |
| Sisorg | `AddSisorgBookingSchema(config)`, `AddSisorgBookingFunnel(config)` |
| TcTour | `AddTcTourBookingFunnel(config)`, `AddTcTourBookingSchema()` |

Note: Songserm and Phantip are search-only (no booking registered in Denali).

---

## Service Scope Lifecycle

### The Scoping Problem the Framework Solves

Each API call to a supplier must carry:
- The correct **base URL** for that integration
- The correct **API credentials** (key, username/password) for the specific contract
- Integration-specific **HTTP middleware** (authentication injection, response validation)
- Scoped **caching** (namespaced by integration)
- Scoped **metrics** (tagged with integration + contract)
- Scoped **persistence** (namespaced S3 paths)

### How It Works

```
ISiServiceProvider.CreateScope(integrationId, contractCode, clientId?)
       │
       ▼
AutofacSiServiceProvider.CreateServiceScope()
       │
       ├── Looks up contract configuration from ISiConfigurationSource
       ├── Finds SubIntegration and SiContract
       └── Creates Autofac LifetimeScope tagged with integrationId
              │
              ├── SiMemoryCache (scoped IMemoryCache)
              ├── SiHybridCache (scoped HybridCache)
              ├── SiContractConfiguration (supplier-specific config)
              ├── SiMetricsPublisher (tagged with integration + contract)
              ├── IHttpConnector (HttpClientConnector with correct base URL, auth, timeout, retry)
              ├── IPersistenceProvider (S3PersistenceProvider namespaced by integration)
              ├── IPersistenceMetricsPublisher
              └── SiContext (integrationId, contractCode, clientId)
```

### `ISiServiceProvider` Interface

```csharp
public interface ISiServiceProvider
{
    Task<ISiServiceScope> CreateScope(
        string integrationId, string contractCode, string? clientId = null);
}
```

### `ISiServiceScope` Interface

```csharp
public interface ISiServiceScope : IAsyncDisposable
{
    T GetService<T>() where T : notnull;
}
```

Resolution uses Autofac **keyed services** — `scope.ResolveKeyed<T>(integrationId)`.

### Per-Scope Services Registered

| Service | Implementation | Purpose |
|---|---|---|
| `IMemoryCache` | `SiMemoryCache` | In-memory cache scoped by integration ID |
| `HybridCache` | `SiHybridCache` | Distributed cache scoped by integration ID |
| `SiContractConfiguration` | from `ISiContractConfigurationSource` | Supplier-specific configuration |
| `ISiMetricsPublisher` | `SiMetricsPublisher` | Metrics tagged with integration + contract |
| `IHttpConnector` | `HttpClientConnector` | HTTP client with correct base URL, auth params, timeout, retry, proxy |
| `IPersistenceProvider` | `S3PersistenceProvider` | S3 storage namespaced by integration |
| `IPersistenceMetricsPublisher` | `PersistenceMetricsPublisher` | Persistence metrics |
| `SiContext` | value object | Holds integrationId, contractCode, clientId |

---

## What the Framework Provides

### 1. HTTP Connectivity (`IHttpConnector` / `HttpClientConnector`)

- **Base URL resolution**: Configured per SubIntegration
- **Authentication injection**: Via `IntegrationHttpMiddleware` → `IIntegrationHttpConnector.Authenticate()`
- **Response validation**: Via `IntegrationHttpMiddleware` → `IIntegrationHttpConnector.ValidateResponse()`
- **Retry policy**: Polly exponential backoff for transient errors (`2^attempt` seconds)
- **Timeout**: Configurable per SubIntegration (`RequestTimeoutInSec`)
- **Proxy support**: Optional proxy URL per SubIntegration
- **Compression**: Adds `Accept-Encoding: gzip, deflate, br` to all requests

### 2. Configuration Management

- **`ISiConfigurationSource`** — provides `SiConfigurations` (integrations, sub-integrations, contracts)
- **`ISiContractConfigurationSource`** — provides `SiContractConfiguration` per contract
- **Composite pattern** — `CompositeSiConfigurationSource` switches between legacy (AppConfig) and PostgreSQL sources via feature flag
- **Credential resolution** — per-contract credentials with optional per-client override

### 3. Caching

- **`SiMemoryCache`** — wraps `IMemoryCache`, scopes keys by integration ID, reports cache metrics
- **`SiHybridCache`** — wraps `HybridCache`, scopes keys by integration ID, with optional DynamoDB distributed cache backend

### 4. Persistence

- **`S3PersistenceProvider`** — stores/retrieves data in S3, namespaced by integration ID
- Used for storing booking artifacts, tickets, etc.

### 5. Metrics

- **`ISiMetricsPublisher`** — publishes metrics tagged with integration ID and contract code
- **`IPersistenceMetricsPublisher`** — persistence-specific metrics

### 6. DI Container (Autofac)

- **`SupplierIntegrationBuilder`** — builder pattern for registering integrations during startup
- **`AddIntegration(id, configure)`** — registers integration services keyed by integration ID
- **Autofac LifetimeScope** — creates child scopes per request with scoped services
- **Keyed resolution** — `ResolveKeyed<T>(integrationId)` for supplier-specific implementations

### 7. ID Generation

- **`IIdGeneratorService`** — ID generation for persistence and booking references

---

## What Can Be Discarded

These components exist solely to support the multi-integration abstraction and add complexity without value in a 12go-only world:

| Component | Reason to Discard |
|---|---|
| **`ISiServiceProvider` / `AutofacSiServiceProvider`** | Scoping per-integration is unnecessary when there's only one integration |
| **`ISiServiceScope` / `AutofacSiServiceScope`** | No need for keyed Autofac resolution |
| **`SupplierIntegrationBuilder`** | Builder pattern for multi-integration registration |
| **`IntegrationHttpMiddleware`** | DelegatingHandler that routes to per-integration connectors — unnecessary with a single integration |
| **`IIntegrationHttpConnector`** / per-integration connector abstraction | Can be replaced with direct auth injection |
| **`ConnectorFactory`** | Factory for creating per-integration HTTP connectors |
| **`SiMemoryCache` / `SiHybridCache`** scoping by integration | Can use plain caching without integration ID prefixing |
| **`SiMetricsPublisher`** scoping by integration | Metrics can directly tag with known values |
| **`S3PersistenceProvider`** namespacing by integration | Can use fixed S3 paths |
| **`SiContext` value object** | Carries integration/contract/client for scope — unnecessary |
| **`CompositeSiConfigurationSource`** | Legacy/Postgres switching — can pick one |
| **`[SupplierSpecific]` attribute** | Marks interfaces that have per-supplier implementations |
| **All non-12go integration projects** | Songserm, Phantip, SeatOS, DeOniBus, Distribusion, Plataforma10, FlixBus, Bookaway, Sisorg, TcTour, OneTwoGo Internal |
| **Multi-integration host registration** | `RegisterSiServices.cs` / `ConfigureServices.cs` in Etna/Denali |

---

## What Must Be Preserved

These components carry essential business logic or provide valuable infrastructure:

| Component | Reason to Preserve |
|---|---|
| **`OneTwoGoApi` class** | All 12go HTTP call logic — endpoint construction, serialization, error handling |
| **`OneTwoGoUriBuilder`** | URL construction for all 12go endpoints |
| **All 12go request/response models** | `OneTwoGoSearchResponse`, `GetTripDetailsResponse`, `GetBookingDetailsResponse`, `OneTwoGoBookingSchemaResponse`, `ReserveDataRequest`, refund models, etc. |
| **`OneTwoGoHttpConnector`** | Auth injection logic (API key as query param) and response validation (error → exception mapping) |
| **Domain model contracts** | `Itinerary`, `Segment`, `Reservation`, `ReservationDetails`, `Cost`, `PriceList`, `BookingSchema` — if downstream consumers depend on them |
| **HTTP retry/timeout logic** | Polly retry with exponential backoff, configurable timeout |
| **Error/exception types** | `RequestFailedException`, `AuthenticationException`, `ProductNotFoundException`, `RequestArgumentException`, etc. |
| **Caching infrastructure** (simplified) | HybridCache with DynamoDB backend — valuable for search performance |
| **S3 persistence** (simplified) | Ticket storage and booking artifacts |
| **Metrics collection** (simplified) | Performance monitoring, error tracking |
| **`OneTwoGoBookingSchemaResponse`** mapping logic | Complex dynamic field extraction from checkout schema |
| **`ReserveDataRequest.SerializeAsString()`** | Custom flat-key serialization for the reserve API |
| **Date/time format handling** | `SharedConstants` date formats, `OneTwoGoDateTimeFormatConverter` |
| **`ErrorResponse` parsing** | Error structure from 12go API including reasons, fields, messages |

---

## Transition Considerations

### What Changes in a Direct Integration

| Current (SI Framework) | Future (Direct) |
|---|---|
| `ISiServiceProvider.CreateScope("OneTwoGo", contract)` | Direct DI registration, no scoping |
| `scope.GetService<ISearchSupplier>()` | Inject `OneTwoGoSearchService` directly |
| `IntegrationHttpMiddleware` → `OneTwoGoHttpConnector.Authenticate()` | Configure `HttpClient` with API key in startup |
| Autofac keyed resolution | Standard .NET DI |
| `SiMemoryCache` with integration ID prefix | Standard `IMemoryCache` / `HybridCache` |
| Configuration from `ISiConfigurationSource` | Configuration from appsettings / env vars |
| `SiContractConfiguration` | Direct configuration class |

### Interfaces to Consider Keeping (Simplified)

Even in a 12go-only world, these interface shapes may be useful:

- **`ISearchSupplier`-like** — search abstraction boundary for testing
- **`IBookingFunnel`-like** — booking flow abstraction for testing
- **`IPostBookingOperations`-like** — post-booking abstraction for testing

These can be simplified from the generic `[SupplierSpecific]` pattern to concrete implementations with direct injection.

---

## Open Questions

1. **HybridCache dependency**: Is the DynamoDB-backed distributed cache critical for search performance, or can we switch to Redis/in-memory only?
2. **S3 persistence**: What data is stored in S3? Is it only tickets, or also booking state? Can we migrate to a different storage?
3. **Configuration source**: The framework supports legacy (AWS AppConfig) and PostgreSQL configuration sources — which will the new system use?
4. **Contract vs SubIntegration**: In the current model, one integration has SubIntegrations which have Contracts. For 12go-only, how many contracts do we actually have? Is there a client-ID-per-contract dimension?
5. **Metrics continuity**: What metrics dashboards/alerts depend on the current `ISiMetricsPublisher` tags? Need to preserve tag schema.
6. **`IBookingRequest` interface**: This is the bridge between TConnect booking format and supplier format. What does the TConnect side look like? Is this transform still needed?
7. **OneTwoGo Internal**: There's a separate "onetwogo_internal" integration — what is it and does it need to be preserved?
8. **Seat lock support**: `IBookingFunnel.LockSeats()` / `IsSeatLockSupported()` — is this used by 12go?
9. **Feature flags**: The `CompositeSiConfigurationSource` uses `IFeatureManager` to toggle between legacy and Postgres config — which is the "winner" post-transition?
