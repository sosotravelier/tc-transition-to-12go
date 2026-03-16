# Data Team Coordination — Booking Flow Events

The current .NET architecture publishes a large number of Kafka events across three services — `denali` (booking lifecycle), `etna` (search telemetry and supplier fetch data), and `supply-integration` (integration management) — that the data team depends on for booking analytics, search performance tracking, and supply catalogue data. When these .NET services are decommissioned in favour of the 12go platform, every event currently flowing into Kafka from those services will stop unless the new system is explicitly instrumented to replace them. The scope of this gap is substantial: at least 25 distinct event types across four Kafka-producing services, covering the complete booking funnel from checkout through confirmation and cancellation, search request and itinerary telemetry, supplier health signals, and integration lifecycle events.

---

## Events Currently Published

### 1. Booking-service (`BookingService.SupplierIntegration` / `SiFacade`)

**Source:** [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs)

All events in this service are gated by the `KafkaPublishSwitch` feature flag (lines 1125–1126 of SiFacade) and published via `PublishMessage<TData>()` (line 1122). They use `IProducer<string, object>` and the topic name is always the **fully-qualified .NET type name** of the message (`data.Value.GetType().FullName`).

| Event type | Topic name (= .NET FullName) | Trigger point in SiFacade |
|---|---|---|
| `CheckoutRequested` | `Denali.Booking.Messages.CheckoutRequested` | Checkout flow start (line 113) |
| `CheckoutResponded` | `Denali.Booking.Messages.CheckoutResponded` | Successful checkout (line 181) |
| `CheckoutFailed` | `Denali.Booking.Messages.CheckoutFailed` | Checkout failure (line 197) |
| `BookingSchemaRequested` | `Denali.Booking.Messages.BookingSchemaRequested` | Booking schema request (line 223) |
| `BookingSchemaResponded` | `Denali.Booking.Messages.BookingSchemaResponded` | Schema success (line 252) |
| `BookingSchemaFailed` | `Denali.Booking.Messages.BookingSchemaFailed` | Schema failure (lines 275, 281, 287) |
| `BookRequested` | `Denali.Booking.Messages.BookRequested` | Before SI reserve call (lines 309, 322) |
| `BookSucceeded` | `Denali.Booking.Messages.BookSucceeded` | Successful reserve (line 466) |
| `BookFailed` | `Denali.Booking.Messages.BookFailed` | Reserve failure (lines 311, 506) |
| `BookingEntityToPersist` | `Denali.Booking.Messages.BookingEntityToPersist` | Post-reserve (line 464, gated by `PublishReserveBookingEvents` flag) |
| `ReservationConfirmationRequested` | `Denali.Booking.Messages.ReservationConfirmationRequested` | Confirm flow start (line 576) |
| `ReservationConfirmationSucceeded` | `Denali.Booking.Messages.ReservationConfirmationSucceeded` | Successful confirmation (line 801) |
| `ReservationConfirmationFailed` | `Denali.Booking.Messages.ReservationConfirmationFailed` | Confirmation failure (line 654) |

`BookingEntityToPersist` is an alternative persistence path gated by `FeatureFlags.PublishReserveBookingEvents` (line 463 of SiFacade); when enabled it routes booking data through Kafka rather than a direct HTTP call to the post-booking service.

**Producer config section:** `Kafka:Clusters:OperationCluster:ClusterDefaults`
([booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs), lines 34–46)

---

### 2. Post-booking-service (`PostBookingService.Api`)

**Source files:**
- [post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs)
- [post-booking-service/host/PostBookingService.Api/Facade/PostBookingInternalFacade.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingInternalFacade.cs)
- [post-booking-service/host/PostBookingService.Api/services/ReservationUpdaterService.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/services/ReservationUpdaterService.cs)
- [post-booking-service/host/PostBookingService.Api/background-workers/ConfirmationInProcessScheduledWorker.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/background-workers/ConfirmationInProcessScheduledWorker.cs)

All events are published through the same `KafkaMessagePublisher` pattern (topic = FullName), gated by `FeatureFlags.KafkaPublishSwitch` in PostBookingSiFacade (line 367).

| Event type | Topic name | Source location |
|---|---|---|
| `CancelRequested` | `Denali.Booking.Messages.CancelRequested` | `PostBookingSiFacade.CancelBooking()`, line 175 |
| `CancelFailed` | `Denali.Booking.Messages.CancelFailed` | `PostBookingSiFacade.CancelBooking()` error path, line 200 |
| `ReservationChanged` | `Denali.Booking.Messages.ReservationChanged` | `PostBookingSiFacade.CancelBooking()` post-cancel, line 191; `PostBookingInternalFacade.GetBookingDetails()`, line 56; `ReservationUpdaterService.SendUpdatedReservation()`, line 77 |
| `ReservationConfirmationSucceeded` | `Denali.Booking.Messages.ReservationConfirmationSucceeded` | `ConfirmationInProcessScheduledWorker` (async poll loop), line 96 |
| `ReservationConfirmationFailed` | `Denali.Booking.Messages.ReservationConfirmationFailed` | `ConfirmationInProcessScheduledWorker` on timeout, line 168 |

`CancelSucceeded` is defined in the `Denali.Booking.Messages` package (v2.8.0) but no production call site publishing it was found in the post-booking-service code; the cancellation flow publishes `ReservationChanged` after the cancel response instead.

**Producer config section:** `Kafka:Clusters:OperationCluster:ClusterDefaults`
([post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs), line 131)

---

### 3. Booking-notification-service (`BookingNotificationService`)

**Source:** [booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs)

| Event type | Topic name | Source location |
|---|---|---|
| `SupplierReservationChanged` | `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged` | `WebhookController.PublishMessage()`, line 98; triggered when a supplier webhook is received |

This event is consumed by `PostBookingService.Api` (via `SupplierReservationChangedHandler`) to trigger a status refresh from the supplier.

**Producer:** same `KafkaMessagePublisher` pattern (topic = FullName).
([booking-notification-service/host/BookingNotificationService/MessagePublishing/KafkaMessagePublisher.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/MessagePublishing/KafkaMessagePublisher.cs))

---

### 4. Etna supplier-integration (`Etna.Search.SupplierIntegration`)

**Source files:**
- [supplier-integration/Etna.Search.SupplierIntegration/Kafka/SiEventsPublisher.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/SiEventsPublisher.cs)
- [supplier-integration/Etna.Search.SupplierIntegration/Kafka/KafkaBackgroundPublisher.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/KafkaBackgroundPublisher.cs)
- [supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs)

Topic name pattern: `typeof(T).FullName!` (line 29 of `KafkaBackgroundPublisher.cs`).

| Event type | Topic name | Trigger |
|---|---|---|
| `SupplierItineraryFetched` | `Etna.Messages.supply.SupplierItineraryFetched` | Each itinerary fetched from a supplier |
| `ItinerariesRequestedFromIntegration` | `Etna.Messages.supply.ItinerariesRequestedFromIntegration` | Each integration search call initiated |
| `NoResultsFoundWithSupplier` | `Etna.Messages.supply.NoResultsFoundWithSupplier` | Supplier returns empty results |
| `RequestFailed` | `Etna.Messages.supply.RequestFailed` | Supplier HTTP call fails |
| `SupplierQuotaExceeded` | `Etna.Messages.supply.SupplierQuotaExceeded` | Rate limit exceeded |
| `SoldOutItinerariesIdentified` | `Etna.Messages.supply.SoldOutItinerariesIdentified` | Sold-out detection |
| `RouteNotMappedToIntegration` | `Etna.Messages.supply.RouteNotMappedToIntegration` | Route missing in integration |
| `RouteNotMappedToTConnect` | `Etna.Messages.supply.RouteNotMappedToTConnect` | Route missing in TConnect |

**Producer config section:** `Kafka:Producer`
([supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs), line 13)

The `SupplierItineraryFetched` topic is also confirmed by the service test appsettings: `"SupplierItineraryFetchedTopicName": "Etna.Messages.supply.SupplierItineraryFetched"` ([supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json), line 16).

---

### 5. Etna search API reporting (`Etna.Search.ApiReporting`)

**Source:** [api/Etna.Search.ApiReporting/EventConsumer/SearchEngine/EventConsumer.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiReporting/EventConsumer/SearchEngine/EventConsumer.cs)

Topic name pattern: `$"{type.Namespace}.{type.Name}"` (line 94), which is equivalent to the FullName for non-nested types.

| Event type | Topic name |
|---|---|
| `SearchRequested` | `Etna.Messages.SearchRequested` |
| `SearchOnlineScoringRequested` | `Etna.Messages.SearchOnlineScoringRequested` |
| `SearchItineraryResponded` | `Etna.Messages.SearchItineraryResponded` |
| `SearchItinerariesBlocked` | `Etna.Messages.SearchItinerariesBlocked` |
| `SearchOperatorHealthBlocked` | (topic = FullName, type from `SearchOperatorHealthBlockedConsumer`) |
| `SearchItineraryBlocked` | `Etna.Messages.SearchItineraryBlocked` |
| `PotentialMissingRoute` | `Etna.Messages.PotentialMissingRoute` |
| `IntegrationIncompleteResultsReturned` | `Etna.Messages.IntegrationIncompleteResultsReturned` |

These events are consumed from an internal channel (`IEventBusReader`) and re-published to Kafka.

**Producer config section:** `ApiReporting:KafkaProducer`
([api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs), line 23)

---

### 6. Etna operator health (`etna.operator_health.job`)

**Source:** [operator_health/etna.operator_health.job/Observability/MessageReporter.cs](https://github.com/boost-platform/etna/blob/main/operator_health/etna.operator_health.job/Observability/MessageReporter.cs)

| Event type | Topic name |
|---|---|
| `OperatorHealthStatusChanged` | `Operator.Health.Messages.OperatorHealthStatusChanged` |

Topic is set in constructor: `typeof(OperatorHealthStatusChanged).FullName` (line 24).

---

### 7. Supply-integration (`si.integrations.settings.host`)

**Source files:**
- [integration_service/api/si.integrations.settings.host/Messaging/KafkaPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaPublisher.cs)
- [integration_service/api/si.integrations.settings.host/Services/IntegrationsService.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Services/IntegrationsService.cs)

Topics are **explicitly named** (not derived from type names), configured in `KafkaConfig`:

| Event type | Topic name (configurable) | Default in test config | Trigger |
|---|---|---|---|
| `IntegrationCreated` | `KafkaConfig:IntegrationCreatedTopicName` | `Si.Integrations.Settings.Messages.IntegrationCreated` | New integration added (`IntegrationsService.Add()`) |
| `IntegrationEnabled` | `KafkaConfig:IntegrationEnabledTopicName` | `Si.Integrations.Settings.Messages.IntegrationEnabled` | Integration toggled enabled (`IntegrationsService.Update()`) |
| `IntegrationDisabled` | `KafkaConfig:IntegrationDisabledTopicName` | `Si.Integrations.Settings.Messages.IntegrationDisabled` | Integration toggled disabled (`IntegrationsService.Update()`) |

Controlled by `KafkaConfig:EnabledIntegrationProducing` (bool flag).

The booking-notification-service consumes `IntegrationCreated` (topic subscription: `typeof(IntegrationCreated).FullName`) to register new integrations for webhook handling.

---

### 8. Supply-integration TcTour MasterDataPublisher

**Source:** [integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MasterDataPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MasterDataPublisher.cs)

Topic name pattern: `typeof(T).FullName!` (line 91).

| Event type | Topic name |
|---|---|
| `StationReceived` | `Fuji.SupplierIntegration.Messages.StationReceived` |
| `OperatingCarrierReceived` | `Fuji.SupplierIntegration.Messages.OperatingCarrierReceived` |

---

## Event Payload Structures

All types below come from the `Denali.Booking.Messages` NuGet package version 2.8.0 unless otherwise noted. Payload fields are derived by reflecting on the published DLLs.

### `CheckoutRequested`
```
ItineraryId   ItineraryId
UInt32        NumberOfSeats
ItineraryInstanceId   ItineraryInstanceId
```

### `CheckoutResponded`
```
ItineraryId        ItineraryId
String             FromStationId
String             ToStationId
DateTimeOffset     Departure
UInt32             NumberOfSeats
UInt32             MinutesAfterSearch
String             ClientCurrency
String             SupplierCurrency
Price?             GrossPrice
String             GrossPriceType
Price?             BaseNet
Price?             BaseCost
ItineraryInstanceId   ItineraryInstanceId
BookingToken       BookingToken
```

### `CheckoutFailed`
```
ItineraryId    ItineraryId
UInt32         MinutesAfterSearch
String         FailureCode
String         FailureDescription
ItineraryInstanceId   ItineraryInstanceId
```

### `BookRequested`
```
BookingToken       BookingToken
String             ReserveDetails        // JSON-serialized booking form data
ItineraryId        ItineraryId
String             ContractCode
String             IntegrationId
ItineraryInstanceId   ItineraryInstanceId
```

### `BookSucceeded`
```
BookingId          BookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
String             FromStationId
String             ToStationId
DateTimeOffset     Departure
UInt32             NumberOfSeats
ItineraryId        ItineraryId
String             ReservationStatus
BookingToken       BookingToken
String             ClientCurrency
String             SupplierCurrency
Price              BaseNet
Price              BaseCost
Price              AddonsNet
Price              AddonsCost
AddonDetails[]     AddonsDetails
Price              TotalNet
Price              TotalCost
Price              EstimatedNet
Price              EstimatedCost
ItineraryInstanceId   ItineraryInstanceId
Price?             TotalGross
String             ReservationGrossType
```

### `BookFailed`
```
BookingToken       BookingToken
String             ReserveDetails
ItineraryId        ItineraryId
String             FailureCode
String             FailureDescription
ItineraryInstanceId   ItineraryInstanceId
```

### `BookingEntityToPersist`
```
BookingId          BookingId
BookingId          InternalBookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
String             OperatorBookingId
String             Status
String             FromStationId
String             ToStationId
DateTimeOffset     Departure
DateTime           Arrival
String[]           OperatorId
Price              SupplierNetPrice
Price              ClientNetPrice
Price?             ReserveNet
Price?             ReserveCost
Price?             ReserveEstimatedCost
Price?             ReserveEstimatedNet
Int32              PassengerCount
Decimal?           CancellationPenalty
CancellationPolicy[]  CancellationPolicies
DateTimeOffset     CreatedAt
DateTimeOffset     UpdatedAt
ItineraryId        ItineraryId
String[]           OperatorList
String[]           TransportationTypes
BookingData        ReserveDetails
String             DepartureTimeZone
ItineraryInstanceId   ItineraryInstanceId
Price?             GrossPrice
Price?             ReserveGrossPrice
String             GrossPriceType
Decimal?           PointsPickup
Decimal?           PointsDropoff
Segment[]          Segments
Vehicle[]          Vehicles
```

### `ReservationConfirmationRequested`
```
BookingId          BookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
ItineraryInstanceId   ItineraryInstanceId
```

### `ReservationConfirmationSucceeded`
```
BookingId          BookingId
BookingId          InternalBookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
ItineraryId        ItineraryId
String             OperatorBookingId
String             FromStationId
String             ToStationId
DateTimeOffset     Departure
DateTime           Arrival
UInt32             NumberOfSeats
String             ReservationStatus
String[]           OperatorList
BookingData        ReserveDetails          // passenger names/contact info
CancellationPolicy[]  CancellationPolicy
String[]           TransportationTypes
DateTimeOffset     CreatedAt
DateTimeOffset     UpdatedAt
String             ClientCurrency
String             SupplierCurrency
Price              BaseNet
Price              BaseCost
Price              AddonsNet
Price              AddonsCost
AddonDetails[]     AddonsDetails
Price              TotalNet
Price              TotalCost
Price              ReservationEstimatedNet
Price              ReservationEstimatedCost
Price              ReservationNet
Price              ReservationCost
ItineraryInstanceId   ItineraryInstanceId
Price?             TotalGross
Price?             ReservationGross
String             ReservationGrossType
Decimal?           PointsPickup
Decimal?           PointsDropoff
```

### `ReservationConfirmationFailed`
```
BookingId          BookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
ItineraryId        ItineraryId
String             FailureCode
String             FailureDescription
ItineraryInstanceId   ItineraryInstanceId
```

### `ReservationChanged`
```
BookingId          BookingId
String             IntegrationId
String             IntegrationBookingId
String             ContractCode
String             BookingClientId
String             FromStationId
String             ToStationId
DateTimeOffset     Departure
UInt32             NumberOfSeats
String             ReservationStatus
DateTimeOffset     CreatedAt
DateTimeOffset     UpdatedAt
Price              TotalNet
Price              TotalCost
Price              ReservationEstimatedNet
Price              ReservationEstimatedCost
Price              ReservationNet
Price              ReservationCost
ItineraryInstanceId   ItineraryInstanceId
```
Published on: booking detail refresh, post-cancellation status update, supplier webhook trigger.

### `CancelRequested`
```
BookingId          BookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
ItineraryInstanceId   ItineraryInstanceId
```

### `CancelFailed`
```
BookingId          BookingId
String             ContractCode
String             IntegrationId
String             IntegrationBookingId
String             BookingClientId
String             FailureCode
String             FailureDescription
ItineraryInstanceId   ItineraryInstanceId
```

### `SupplierReservationChanged` (booking-notification-service)
```
String   BookingId          // supplier-side booking ID
String   IntegrationId
```

### `SupplierItineraryFetched` (etna, `Etna.Messages` v3.6.0)
```
ItineraryId        ItineraryId
String             IntegrationEntity
String             Initiator
Segment[]          DepartureSegments
Segment[]          ReturnSegments
String             ConfirmationType
PriceList          PriceList
CutOff?            CutOff
ClxPolicy[]        ClxPolicies
UInt16             AvailableSeats
Boolean?           ConnectionGuarantee
String             TicketType
UInt32?            RequestedSeats
DateTimeOffset     CallTimeStamp
```

### `SearchRequested` (etna, `Etna.Messages` v3.6.0)
```
String[]   FromStations
String[]   ToStations
String     FromPoi
String     ToPoi
DateOnly   DepartureDate
Int32      Pax
```

### `SearchItineraryResponded` (etna)
```
String             ScoreInstanceId
ItineraryInstanceId   ItineraryInstanceId
ItineraryId        ItineraryId
UInt16             AvailableSeats
PriceList          PriceList
ClxPolicy[]        ClxPolicies
CutOff?            CutOff
String             ModelId
String             ModelScoreId
Decimal?           AvailabilityScore
```

### `IntegrationCreated` (supply-integration, `Si.Integrations.Settings.Messages` v1.0.0)
```
String          Id            // integration ID
DateTimeOffset  CreatedAt
```

### `IntegrationEnabled` / `IntegrationDisabled`
```
// IntegrationEnabled:
String   Id

// IntegrationDisabled:
String   Id
String   Reason
String   ReasonCode
```

### `StationReceived` (TcTour MasterDataPublisher, `Fuji.SupplierIntegration.Messages` v1.0.4)
```
String             SourceId
String             Culture
String             StationId
String             Name
Address            Address           // Country, State, Region, Province, City, StreetAndNumber, ZipCode, TimeZone
Coordinates?       Coordinates
String             TransportationType
String             Description
MapStationReceived[]  MapStations
Dictionary<String,String>  AdditionalInfo
```

### `OperatingCarrierReceived` (TcTour MasterDataPublisher)
```
String             SourceId
String             Culture
String             CarrierId
String             Name
Address?           Address
String             TransportationType
String             Description
Vehicle[]          Vehicles
String             logoURL
String             Email
String             PhoneNumber
String[]           TransportationTypes
MapOperatorReceived[]  MapOperators
```

---

## Kafka Configuration

### Topic naming convention

The dominant pattern across all three repos is that the Kafka topic name equals the **fully-qualified .NET type name** of the event class. This is derived at runtime in each `KafkaMessagePublisher` and `KafkaBackgroundPublisher` via `data.Value.GetType().FullName` or `typeof(T).FullName`. There are no topic name constants or centrally managed topic registries; topics are implicit in the type system.

The sole exception is the supply-integration service, which uses **explicitly configured topic names** via `KafkaConfig:IntegrationCreatedTopicName`, `KafkaConfig:IntegrationEnabledTopicName`, and `KafkaConfig:IntegrationDisabledTopicName` — which in the test environment happen to equal the type FullName, but are independently configurable.

### Kafka producer configuration locations

| Service | Config section | Source file |
|---|---|---|
| `BookingService.SupplierIntegration` | `Kafka:Clusters:OperationCluster:ClusterDefaults` (ProducerConfig) | [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs), line 34 |
| `PostBookingService.Api` | `Kafka:Clusters:OperationCluster:ClusterDefaults` (ProducerConfig) | [post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs), line 131 |
| `BookingNotificationService` | `KafkaConfig:Producer` (ProducerOptions) | [booking-notification-service/host/BookingNotificationService/Models/KafkaConfiguration.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Models/KafkaConfiguration.cs), line 8 |
| `Etna.Search.SupplierIntegration` | `Kafka:Producer` (ProducerOptions) | [supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs), line 13 |
| `Etna.Search.ApiReporting` | `ApiReporting:KafkaProducer` (ProducerConfig) | [api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs), line 23 |
| `si.integrations.settings.host` | `KafkaConfig:Producer` (ProducerOptions) | [integration_service/api/si.integrations.settings.host/Messaging/KafkaConfig.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaConfig.cs), line 8 |

The actual broker addresses (bootstrap servers) are not in the committed appsettings files in any of these repos — all source-committed `appsettings.json` files are empty (`{}`). The broker configuration is environment-injected. The test/service-test environment uses `kafka:9092` (Etna) and `localhost:9093` (supply-integration).

### Feature flag gating

Several events in `denali` are conditionally published based on Azure App Configuration feature flags:

- `KafkaPublishSwitch` — master gate for all booking flow events in `BookingService.SupplierIntegration.SiFacade` and `PostBookingSiFacade`
  ([shared/Denali.Common/FeatureFlags/FeatureFlags.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/FeatureFlags/FeatureFlags.cs), line 6)
- `PublishReserveBookingEvents` — additional gate specifically for `BookingEntityToPersist` (SiFacade line 463)
- `PublishConfirmBookingEvents` — gates whether `BookingEntityToPersist` is published after confirmation (`BookingPersistenceService.cs`, line 30)

If `KafkaPublishSwitch` is off, no booking lifecycle events are published at all. The current state of this flag in production is not visible in the codebase.

### Consumer config that hints at topic subscriptions

`PostBookingService.Api` subscribes to the following topics (section `Kafka:Clusters:Consumers`):

```
Denali.Booking.Messages.supplier_integration.SupplierReservationChanged
Denali.Booking.Messages.ReservationConfirmationSucceeded
Denali.Booking.Messages.BookingEntityToPersist
```
([post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs), lines 141–192)

`BookingNotificationService` subscribes to `Si.Integrations.Settings.Messages.IntegrationCreated`
([booking-notification-service/host/BookingNotificationService/MessageConsuming/IntegrationCreatedMessageHandler.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/MessageConsuming/IntegrationCreatedMessageHandler.cs), line 23: `consumer.Subscribe(typeof(IntegrationCreated).FullName)`)

---

## Per-Client Correlation

Every booking-flow Kafka event in `denali` carries a `BookingClientId` field (a string identifying the B2B client that initiated the booking). This field is sourced from the `BookingId` record type:

```csharp
// https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Types/BookingId.cs
public record BookingId(
    string ShortId,
    string ContractCode,
    string IntegrationId,
    string IntegrationBookingId,
    string BookingClientId)
```

`BookingClientId` is populated from `bookingFromDb.ClientId` (the client ID stored on the booking entity at reserve time) and propagated into every downstream event. It appears in all the high-value events: `BookSucceeded`, `ReservationConfirmationSucceeded`, `ReservationChanged`, `CancelRequested`, `CancelFailed`, `CancelSucceeded`, etc.

`ContractCode` is a second correlation dimension that identifies the commercial contract under which the booking was made — it is also present in every booking-lifecycle event.

In the Etna search telemetry events, per-client tracking is not carried in the event payloads themselves. The `ConnectContext` (from `Connect.Infra.Context`) is propagated as Kafka message headers (including trace context and correlation IDs) in `Etna.Search.ApiReporting.EventConsumer` (lines 79–91 of `EventConsumer.cs`). The search events do not carry a `ClientId` field in their body; client attribution for search events must be derived from the `Connect.Infra.Context` trace headers or from the `PotentialMissingRoute` event which has a `ClientId` field.

`ItineraryInstanceId` is a correlation field added across both booking and search events that links a specific search result instance to the booking that ultimately used it.

---

## What the Data Team Needs to Know

### Complete list of event types that will stop when .NET services are removed

**Booking funnel (from denali — 13 distinct event types):**
- `Denali.Booking.Messages.CheckoutRequested`
- `Denali.Booking.Messages.CheckoutResponded`
- `Denali.Booking.Messages.CheckoutFailed`
- `Denali.Booking.Messages.BookingSchemaRequested`
- `Denali.Booking.Messages.BookingSchemaResponded`
- `Denali.Booking.Messages.BookingSchemaFailed`
- `Denali.Booking.Messages.BookRequested`
- `Denali.Booking.Messages.BookSucceeded`
- `Denali.Booking.Messages.BookFailed`
- `Denali.Booking.Messages.BookingEntityToPersist` (conditional on feature flag)
- `Denali.Booking.Messages.ReservationConfirmationRequested`
- `Denali.Booking.Messages.ReservationConfirmationSucceeded`
- `Denali.Booking.Messages.ReservationConfirmationFailed`

**Post-booking (from denali — 3 additional event types):**
- `Denali.Booking.Messages.ReservationChanged`
- `Denali.Booking.Messages.CancelRequested`
- `Denali.Booking.Messages.CancelFailed`

**Supplier webhook trigger (from denali booking-notification-service):**
- `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged`

**Search telemetry (from etna — 8 event types):**
- `Etna.Messages.supply.SupplierItineraryFetched`
- `Etna.Messages.supply.ItinerariesRequestedFromIntegration`
- `Etna.Messages.supply.NoResultsFoundWithSupplier`
- `Etna.Messages.supply.RequestFailed`
- `Etna.Messages.supply.SupplierQuotaExceeded`
- `Etna.Messages.supply.SoldOutItinerariesIdentified`
- `Etna.Messages.supply.RouteNotMappedToIntegration`
- `Etna.Messages.supply.RouteNotMappedToTConnect`
- `Etna.Messages.SearchRequested`
- `Etna.Messages.SearchItineraryResponded`
- `Etna.Messages.SearchItinerariesBlocked`
- `Etna.Messages.SearchItineraryBlocked`
- `Etna.Messages.SearchOnlineScoringRequested`
- `Etna.Messages.PotentialMissingRoute`
- `Etna.Messages.IntegrationIncompleteResultsReturned`
- `Operator.Health.Messages.OperatorHealthStatusChanged`

**Integration lifecycle (from supply-integration — 3 event types):**
- `Si.Integrations.Settings.Messages.IntegrationCreated`
- `Si.Integrations.Settings.Messages.IntegrationEnabled`
- `Si.Integrations.Settings.Messages.IntegrationDisabled`

**Master data (from supply-integration TcTour job — 2 event types):**
- `Fuji.SupplierIntegration.Messages.StationReceived`
- `Fuji.SupplierIntegration.Messages.OperatingCarrierReceived`

### Key structural facts for consumers

1. **Topic names are not explicitly configured anywhere in the .NET code** (except supply-integration). They are the CLR type's `FullName`. Any consumer currently subscribing to these topics by that string literal will need to be updated or the new system must produce to the same topic names.

2. **The most data-critical event for booking revenue analytics is `ReservationConfirmationSucceeded`** — it is the only event that contains the full confirmed booking: passenger details, pricing breakdown (net/cost/gross), cancellation policies, operator booking ID, transportation types, and both client and supplier currencies.

3. **`BookingEntityToPersist` is the same data as `ReservationConfirmationSucceeded` but emitted at the reserve step** (before the supplier confirms the booking). It is gated by `PublishReserveBookingEvents` and `PublishConfirmBookingEvents` feature flags and may not be active in all environments.

4. **`ReservationChanged` is a lower-fidelity status-change event** published on cancel, on booking detail refresh, and when a supplier webhook fires. It does not include passenger or pricing breakdown details — it is a signal that prompts consumers to re-fetch.

5. **The `KafkaPublishSwitch` feature flag in denali** is the master gate for the entire booking event stream. If it is currently off in any environment, that environment produces no booking Kafka events today. The current flag state is not stored in the codebase.

6. **`ItineraryInstanceId` links search to booking**: it is set on `SearchItineraryResponded` (search side) and carried through `BookSucceeded`, `ReservationConfirmationSucceeded`, and all post-booking events. This is the primary join key between search telemetry and booking conversion data.

7. **Client identity in search events** is not in the event body; it is only available via the `ConnectContext` trace headers propagated in Kafka message headers (`Version`, `IsShadow`, `FeatureFlags`, `experiment`). The data team's consumers must be able to extract client context from those headers, not from a body field.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. The following references were updated:

| Original local path | GitHub URL |
|---|---|
| `/Users/sosotughushi/RiderProjects/denali/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs` | [denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs` | [denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/ConfigureServices.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/Facade/PostBookingInternalFacade.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingInternalFacade.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingInternalFacade.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/services/ReservationUpdaterService.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/services/ReservationUpdaterService.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/services/ReservationUpdaterService.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/background-workers/ConfirmationInProcessScheduledWorker.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/background-workers/ConfirmationInProcessScheduledWorker.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/background-workers/ConfirmationInProcessScheduledWorker.cs) |
| `/Users/sosotughushi/RiderProjects/denali/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs` | [denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs` | [denali/blob/main/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-notification-service/host/BookingNotificationService/MessagePublishing/KafkaMessagePublisher.cs` | [denali/blob/main/booking-notification-service/host/BookingNotificationService/MessagePublishing/KafkaMessagePublisher.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/MessagePublishing/KafkaMessagePublisher.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-notification-service/host/BookingNotificationService/Models/KafkaConfiguration.cs` | [denali/blob/main/booking-notification-service/host/BookingNotificationService/Models/KafkaConfiguration.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Models/KafkaConfiguration.cs) |
| `/Users/sosotughushi/RiderProjects/denali/booking-notification-service/host/BookingNotificationService/MessageConsuming/IntegrationCreatedMessageHandler.cs` | [denali/blob/main/booking-notification-service/host/BookingNotificationService/MessageConsuming/IntegrationCreatedMessageHandler.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/MessageConsuming/IntegrationCreatedMessageHandler.cs) |
| `/Users/sosotughushi/RiderProjects/denali/shared/Denali.Common/FeatureFlags/FeatureFlags.cs` | [denali/blob/main/shared/Denali.Common/FeatureFlags/FeatureFlags.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/FeatureFlags/FeatureFlags.cs) |
| `/Users/sosotughushi/RiderProjects/denali/Denali.BookingIdType/Types/BookingId.cs` | [denali/blob/main/Denali.BookingIdType/Types/BookingId.cs](https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Types/BookingId.cs) |
| `/Users/sosotughushi/RiderProjects/etna/supplier-integration/Etna.Search.SupplierIntegration/Kafka/SiEventsPublisher.cs` | [etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/SiEventsPublisher.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/SiEventsPublisher.cs) |
| `/Users/sosotughushi/RiderProjects/etna/supplier-integration/Etna.Search.SupplierIntegration/Kafka/KafkaBackgroundPublisher.cs` | [etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/KafkaBackgroundPublisher.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/KafkaBackgroundPublisher.cs) |
| `/Users/sosotughushi/RiderProjects/etna/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs` | [etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/Kafka/ConfigureServices.cs) |
| `/Users/sosotughushi/RiderProjects/etna/supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json` | [etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json) |
| `/Users/sosotughushi/RiderProjects/etna/api/Etna.Search.ApiReporting/EventConsumer/SearchEngine/EventConsumer.cs` | [etna/blob/main/api/Etna.Search.ApiReporting/EventConsumer/SearchEngine/EventConsumer.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiReporting/EventConsumer/SearchEngine/EventConsumer.cs) |
| `/Users/sosotughushi/RiderProjects/etna/api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs` | [etna/blob/main/api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiReporting/ApiReportingServiceExtensions.cs) |
| `/Users/sosotughushi/RiderProjects/etna/operator_health/etna.operator_health.job/Observability/MessageReporter.cs` | [etna/blob/main/operator_health/etna.operator_health.job/Observability/MessageReporter.cs](https://github.com/boost-platform/etna/blob/main/operator_health/etna.operator_health.job/Observability/MessageReporter.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integration_service/api/si.integrations.settings.host/Messaging/KafkaPublisher.cs` | [supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaPublisher.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integration_service/api/si.integrations.settings.host/Services/IntegrationsService.cs` | [supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Services/IntegrationsService.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Services/IntegrationsService.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integration_service/api/si.integrations.settings.host/Messaging/KafkaConfig.cs` | [supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaConfig.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/KafkaConfig.cs) |
| `/Users/sosotughushi/RiderProjects/supply-integration/integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MasterDataPublisher.cs` | [supply-integration/blob/main/integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MasterDataPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MasterDataPublisher.cs) |
| `/Users/sosotughushi/RiderProjects/denali/Denali.BookingIdType/Types/BookingId.cs` (in code block) | Replaced with `// https://github.com/boost-platform/denali/blob/main/Denali.BookingIdType/Types/BookingId.cs` |

All 24 local references were confirmed to exist in the local repository clones before conversion. No references were left unconverted.

---

## Meeting Insights (2026-03-12)

Source: Soso / Shauly 1-on-1 (timestamps 00:34:08 – 00:40:01)

### Data Team Is Active and Large

Contrary to initial impression, the data team is large and still active. They handle data consolidation from **all subsidiaries**, not just TC. Several people are still working there.

### T-Rex Project

Shauly mentioned the **T-Rex project** — a data consolidation initiative that aggregates data from all subsidiaries. It may already ingest 12go data directly. If so, some TC events might be redundant since the data team already has a pipeline from 12go.

### Performance Dashboard (B2B)

Shauly showed a B2B performance dashboard that displays per-client metrics:
- Number of searches
- Number of itineraries
- Checkouts
- Conversion percentages
- Historical graphs

This dashboard is populated from **search/checkout events** (likely `SearchRequested`, `CheckoutRequested` and similar events from etna/denali). Shauly believes this dashboard **should be preserved**.

### Action Items

1. Check if 12go's existing events already cover some of the TC event requirements
2. Identify which TC events need to be preserved
3. Call with data team to clarify (to be done later)
