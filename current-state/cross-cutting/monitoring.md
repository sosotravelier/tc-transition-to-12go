---
status: updated
last_updated: 2026-02-18
---
# Monitoring, Logging, Tracing & Metrics

## Current State

All Connect services (Etna, Denali, Fuji) share a unified observability stack built on:

- **Logging** — Structured logging via `LoggerMessage` source-generated attributes, shipped to **Coralogix**
- **Tracing** — Distributed tracing via **OpenTelemetry** (`System.Diagnostics.Activity`), wired through the shared `Connect.Infra.Observability` library (`AddConnectTracing`)
- **Metrics** — `System.Diagnostics.Metrics` (Counters, Histograms, ObservableGauges), exported to **Grafana** via the OTLP pipeline configured by `AddConnectMetric`

The shared helper library `Connect.Infra.Observability` provides three extension methods used uniformly:

| Method | Purpose |
|---|---|
| `builder.AddConnectLogging()` | Configures structured logging + Coralogix export |
| `builder.AddConnectTracing(...)` | Configures OpenTelemetry tracing with optional `TracerProviderBuilder` customizations |
| `builder.AddConnectMetric()` | Configures OTLP metrics export for `System.Diagnostics.Metrics` |

Every service also registers `AddRequestsIdentification()` for request correlation (x-correlation-id, x-request-id headers) and builds a `Flow` object from `Activity.Current.TraceId`.

---

## Logging

### Stack (Coralogix)

- **Library**: `Microsoft.Extensions.Logging` with `LoggerMessage` source-generated attributes (compile-time logging)
- **Aggregator**: Coralogix (configured via `AddConnectLogging()`)
- **Pattern**: Structured logging with named parameters — e.g., `[LoggerMessage(Level = LogLevel.Debug, EventId = 10001, Message = "BookingId added to Activity: {BookingId}")]`
- **Correlation**: Logs automatically include the OpenTelemetry `TraceId` from `Activity.Current`, enabling trace-to-log correlation in Coralogix

### Per-Service Configuration

| Service | Setup Call | Notes |
|---|---|---|
| Etna Search API | `builder.AddConnectLogging()` | In `Program.cs` |
| Etna Supplier Integration | `services.AddConnectLogging(configuration)` | In `ConfigureServices.AddDiagnostics()` |
| Denali booking-service | `builder.AddConnectLogging()` | In `StartupHelperExtensions.ConfigureSharedServices()` |
| Denali post-booking-service | `builder.AddConnectLogging()` | In `StartupHelperExtensions.ConfigureSharedServices()` |
| Denali booking-notification-service | `builder.AddConnectLogging()` | In `Program.cs` |
| Fuji Si WebApi | `builder.AddConnectLogging()` | In `Program.cs` |
| Fuji Exposure API | `builder.AddConnectLogging()` | In `Program.cs` |

All Denali services extensively use `LoggerMessage` source-generated partial methods (20+ files across booking-service, post-booking-service, and shared libraries).

### Key Logging Enrichments

- **BookingIdMiddleware** (`Denali.Common.Utils`) — Extracts booking ID from the URL path and adds it as an `Activity` tag (`BookingId`), making it available in all downstream logs
- **HttpResponseLoggerMiddleware** — Logs HTTP client responses for outbound calls (registered in both booking-service and post-booking-service)

---

## Tracing

### OpenTelemetry Setup

- **Library**: OpenTelemetry for .NET via `Connect.Infra.Observability`
- **Propagation**: W3C Trace Context (default OpenTelemetry propagation)
- **Core**: `System.Diagnostics.Activity` and `System.Diagnostics.ActivitySource`
- **Correlation ID**: `Activity.Current.TraceId` used to build `Flow` objects for inter-service identification

### Per-Service Configuration

| Service | Tracing Sources | HTTP Client Instrumentation | Custom ActivitySource |
|---|---|---|---|
| Etna Search API | Default | Conditional (`EnableHttpClientTracing` config) | No |
| Etna Supplier Integration | `Connect.SDK.Kafka` | Always enabled | No |
| Denali booking-service | Default | Conditional (`EnableHttpClientTracing` config) | Yes — `Observability:Traces:ServiceName` (default `"BookingService"`) |
| Denali post-booking-service | `Connect.SDK.Kafka` | Conditional (`EnableHttpClientTracing` config) | Yes — `Observability:Traces:ServiceName` (default `"BookingService"`) |
| Denali booking-notification-service | `Connect.SDK.Kafka` | Conditional (`EnableHttpClientTracing` config) | No |
| Fuji Si WebApi | Default | No | No |
| Fuji Exposure API | Default | No | No |

### Trace Enrichment Middleware

1. **`BookingIdMiddleware`** (`Denali.Common.Utils`)
   - Extracts booking ID from URL path segment `/bookings/{id}`
   - Adds `BookingId` tag to `Activity.Current`
   - Used by both booking-service and post-booking-service

2. **`IntegrationIdMetricInricherMiddleware`** (`Denali.Common.Utils`)
   - Extracts `IntegrationId` from URL path (itinerary IDs, booking tokens)
   - Enriches `IHttpMetricsTagsFeature` with `connect.integration.id` tag
   - Uses `CaesarCypher.Decrypt` to decode encrypted IDs
   - Used by both booking-service and post-booking-service

3. **`IntegrationIdEnricher`** (`Denali.Common.Utils`)
   - Static helper called after DB lookup when IntegrationId becomes available
   - Enriches both `Activity.Current` tags (for tracing/logging) and `IHttpMetricsTagsFeature` (for HTTP metrics)
   - Tag name: `IntegrationId` on Activity, `connect.integration.id` on HTTP metrics

### gRPC Tracing (Etna)

Etna Search API also uses gRPC with trace propagation:
```csharp
builder.Services.AddGrpc(options =>
{
    options.Interceptors.AddGrpcConnectInterceptor(
        _ => new Flow(Activity.Current!.TraceId.ToString(), "etna_search_api"));
});
```

### Flow Object Pattern

All services create `Flow` objects from trace context for inter-service identification:
- **Etna**: `new Flow(Activity.Current!.TraceId.ToString(), "search")`
- **Denali booking-service**: `new Flow(Activity.Current?.TraceId.ToString() ?? string.Empty, GetRouteName(...))`
  - Route names: `"checkout"` (itineraries), `"confirm"`, `"reserve"` (bookings)
- **Denali booking-notification-service**: `new Flow(requestId, "booking-notification-update")`
- **Kafka consumers**: `TraceConnectionType.Parent` for trace propagation through Kafka

---

## Metrics

### System.Diagnostics.Metrics + Grafana

All custom metrics use `System.Diagnostics.Metrics` (Meter, Counter, Histogram, ObservableGauge) and are exported to Grafana via OTLP, configured by `AddConnectMetric()`.

### Meter Registry

| Meter Name | Service | Version |
|---|---|---|
| `connect.etna.searchengine.Observability` | Etna Search Engine | 1.0.0 |
| `connect.etna.api.observability` | Etna Search API | 1.0.0 |
| `connect.etna.search.supplier-integration` | Etna Supplier Integration | 1.0 |
| `connect.denali.booking.si.host` | Denali booking-service (SI Host) | 1.0.1 |
| `connect.denali.booking.si.facade` | Denali booking-service (SI Facade) | 1.0.1 |
| `connect.Denali.BookingService` | Denali booking-service (Contract) | 1.0.1 |
| `denali.incomplete.results` | Denali booking-service (Channels) | 2.0.0 |
| `connect.denali.post.booking.si.host` | Denali post-booking-service (SI Host + SI Facade) | 1.0.1 |
| `connect.denali.post.booking.persistency.service` | Denali post-booking-service (Persistency) | 1.0.1 |
| `connect.Denali.BookingNotificationService` | Denali booking-notification-service | 1.0.1 |
| `connect.supplier-integration` | Supply-Integration Abstractions | 1.0.0 |
| `connect.fuji.contentmanagement.exchangerates.sdk` | Fuji ExchangeRates SDK | 1.0.0 |

### Custom Metrics by Service

Details of every custom metric are listed below per service.

---

## Per-Service Details

### Etna Search

#### Etna Search API (`connect.etna.api.observability`)

| Metric | Type | Unit | Tags | Description |
|---|---|---|---|---|
| `search.returned.empty` | Counter\<long\> | itineraries | `connect_client_id` | Searches that returned empty results |

#### Etna Search Engine (`connect.etna.searchengine.Observability`)

| Metric | Type | Unit | Tags | Description |
|---|---|---|---|---|
| `searchengine.messages.dropped.from.channel` | Counter\<long\> | messages | `message_type` | Messages dropped from channel |
| `searchengine.messages.added.in.channel` | Counter\<long\> | messages | `message_type` | Messages added to channel |
| `searchengine.pipeline.route.reduction` | Timer | — | `amount_of_routes` (bucketed: <=10, <=100, <=1_000, <=10_000, <=100_000, >100_000) | Route reduction duration |
| `searchengine.pipeline.route.counter` | Histogram\<long\> | routes | `reduction_type` (Before.Reduction / After.Reduction) | Route counts before/after reduction |
| `memory.cache.fetch.attempts` | Counter\<long\> | attempt | `type` | Cache fetch attempts |
| `memory.cache.fetch.miss` | Counter\<long\> | miss | `type` | Cache misses |
| `searchengine.pipeline.plan.override` | Counter\<long\> | override | `client_id`, `integration_id`, `override_value` | Plan override events |

#### Etna Supplier Integration (`connect.etna.search.supplier-integration`)

Uses a dynamic `MetricsProvider` that creates metrics on demand:

| Metric Constant | Type | Description |
|---|---|---|
| `events.emitted` | Counter | Events emitted |
| `channel.occupancy` | ObservableGauge | Channel occupancy |
| `missing.mappings` | Counter | Missing mapping count |
| `station.fetch.duration` | Timer | Station fetch duration |
| `station.fetch.failures` | Counter | Station fetch failures |
| `station.fetched.count` | Counter | Stations fetched |
| `SearchSupplier.command.handle.duration` | Timer | Search supplier command handle duration |
| `SearchSupplier.command.iteration.duration` | Timer | Search supplier iteration duration |
| `unhandled.exception.counter` | Counter | Unhandled exception count |
| `http.request.duration` | Timer | HTTP request duration |
| `get.itinerary.success` | Counter | Successful itinerary fetches |
| `get.itinerary.failure` | Counter | Failed itinerary fetches |
| `available.itinerary.id.repository.duration` | Timer | Itinerary ID repository duration |
| `stations.without.searchkey` | Counter | Stations without search key |
| `manual.operator.filtered.itineraries` | Counter | Manual operator filtered itineraries |

---

### Denali booking-service

#### Observability Setup
- `AddConnectLogging()` + `AddConnectMetric()` + `AddConnectTracing()` in `StartupHelperExtensions`
- Custom `ActivitySource` with configurable name (`Observability:Traces:ServiceName`, default `"BookingService"`)
- Middleware pipeline: `BookingIdMiddleware` → `IntegrationIdMetricInricherMiddleware`

#### BookingSiHostMetrics (`connect.denali.booking.si.host`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `booking.confirmation.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Booking confirmation requests |
| `booking.confirmation.completed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Booking confirmation successes |
| `booking.confirmation.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `reason` | Booking confirmation failures |
| `booking.confirmation.timeout` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Booking confirmation timeouts |
| `booking.reservation.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Booking reservation requests |
| `booking.reservation.completed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Booking reservation successes |
| `reservation.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `reason` | Reservation failures |
| `seat.lock.reservation.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Seat lock requests |
| `seat.lock.reservation.completed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Seat lock successes |
| `seat.lock.reservation.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Seat lock failures |
| `schema.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Schema requests |
| `schema.retrieved` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Schema retrieval successes |
| `schema.failed` | Counter\<long\> | `integration_id`, `contract_code` | Schema retrieval failures |

#### SiFacadeMetrics (`connect.denali.booking.si.facade`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `confirm_price_mismatch` | Counter\<int\> | `clientId`, `integrationId`, `contractCode` | Price mismatch during confirmation |
| `confirmation_processing_incomplete` | Counter\<int\> | `clientId`, `integrationId`, `contractCode` | Incomplete confirmation processing |
| `failed_save_booking` | Counter\<int\> | `clientId`, `integrationId`, `contractCode` | Failed to save booking |
| `confirmation_cost_zero` | Counter\<int\> | `clientId`, `integrationId`, `contractCode` | Confirmation with zero cost |

#### ContractServiceMetrics (`connect.Denali.BookingService`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `ContractService.condract.sdk.failed.find.contract` | Counter\<long\> | `ClientId`, `IntegrationId` | Contract SDK failed to find contract |
| `ContractService.condract.sdk.failed` | Counter\<long\> | `ClientId`, `IntegrationId` | Contract SDK general failure |
| `ContractService.contract.sdk.only.group.contract` | Counter\<long\> | `ClientId`, `IntegrationId` | Only group contract found |

#### ChannelCapacityContainer (`denali.incomplete.results`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `channels.occupancy` | ObservableGauge\<int\> | `entitiy` | Channel occupancy for async booking processing |

---

### Denali post-booking-service

#### Observability Setup
- `AddConnectLogging()` + `AddConnectMetric()` + `AddConnectTracing()` in `StartupHelperExtensions`
- Adds `Connect.SDK.Kafka` as additional trace source
- Middleware pipeline: `BookingIdMiddleware` → `IntegrationIdMetricInricherMiddleware`

#### BookingSiHostMetrics (`connect.denali.post.booking.si.host`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `ticket.creation.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Ticket creation requests |
| `ticket.creation.responded` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Ticket creation successes |
| `ticket.creation.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `error_type` | Ticket creation failures |
| `cancel.booking.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Cancel booking requests |
| `cancel.booking.responded` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Cancel booking successes |
| `cancel.booking.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `error_type` | Cancel booking failures |
| `booking.not.found` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `operation` | Booking not found in DB |
| `get.booking.details.requested` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Get booking details requests |
| `get.booking.details.responded` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Get booking details successes |
| `get.booking.details.failed` | Counter\<long\> | `client_id`, `integration_id`, `contract_code`, `operation` | Get booking details failures |

#### PostBookingSiFacadeMetrics (`connect.denali.post.booking.si.host`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `cancellation.policies.not.exist` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | Cancellation policies not exist |
| `si.refund.different.than.expected` | Counter\<long\> | `client_id`, `integration_id`, `contract_code` | SI refund differs from expected |

#### PostBookingPersistencyServiceMetrics (`connect.denali.post.booking.persistency.service`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `failed_to_update_booking_persistent` | Counter\<int\> | `method_name` | Failed to update booking in persistence |

---

### Denali booking-notification-service

#### Observability Setup
- `AddConnectLogging()` + `AddConnectMetric()` + `AddConnectTracing()` directly in `Program.cs`
- Adds `Connect.SDK.Kafka` as trace source
- Uses `UseConnectMiddleware` for `Flow` injection
- Dynamic counter creation via `ConcurrentDictionary`

#### BookingMetrics (`connect.Denali.BookingNotificationService`)

| Metric | Type | Tags | Description |
|---|---|---|---|
| `{dynamic}` | Counter\<long\> | `supplierId`, `clientId` | Dynamically-named counters created on demand via `IncrementCounter(counterName, ...)` |

The notification service uses a dynamic counter pattern — counter names are passed as parameters at call sites, and counters are lazily created and cached in a `ConcurrentDictionary`.

---

### Fuji

#### Observability Setup

Fuji services (Si WebApi, Exposure API) use the standard `Connect.Infra.Observability` stack:
```
builder.AddConnectLogging().AddConnectMetric().AddConnectTracing();
```

No custom `ActivitySource` or additional trace sources are configured. HTTP client tracing is not enabled.

#### ExchangeRates SDK Metrics (`connect.fuji.contentmanagement.exchangerates.sdk`)

| Metric | Type | Unit | Description |
|---|---|---|---|
| `exchange.rates.load` | Counter\<long\> | load | Exchange rates version load events |

Fuji services are primarily content management and mapping services with lighter observability needs compared to Etna/Denali.

---

### Supply-Integration Abstractions

The `supply-integration` library provides shared metrics classes used by all supplier integration implementations.

**Meter**: `connect.supplier-integration` (v1.0.0)

#### SiMetricsPublisher

| Metric | Type | Tags | Description |
|---|---|---|---|
| `SearchSupplier.ItinerariesProcessed` | Counter\<long\> | `integrationId`, `contractCode`, `success` | Itineraries fetched vs returned (success/failure split) |

#### PersistenceMetricsPublisher

| Metric | Type | Tags | Description |
|---|---|---|---|
| `Persistence.Uploads` | Counter\<long\> | `integrationId`, `contractCode`, `success` | Document upload count |
| `Persistence.DocumentSizeBytes` | Histogram\<long\> | `integrationId`, `contractCode`, `success` | Document size in bytes |

#### SiCacheMetrics

| Metric | Type | Tags | Description |
|---|---|---|---|
| `SiCacheWrite` | Counter\<int\> | `integrationId`, `isDistributedCache`, `isLocalCache` | Cache write events |

---

## 12go Monitoring

12go uses **Datadog** for logs and has **basic CPU/memory metrics**. They do **not** use OpenTelemetry for tracing or metrics.

### 12go Capabilities (Datadog)

- **Logging**: Datadog for log aggregation and search
- **Metrics**: Basic CPU and memory metrics (host-level, not application-level business metrics)
- **Tracing**: No OpenTelemetry or distributed tracing

### Monitoring Unification Challenge

| Aspect | Connect Stack | 12go Stack | Compatible? |
|---|---|---|---|
| Log aggregator | Coralogix | Datadog | No — different platforms |
| Dashboards | Grafana | Datadog | No — different platforms |
| Trace propagation | W3C Trace Context (OpenTelemetry) | None | No |
| Metrics format | OTLP (System.Diagnostics.Metrics) | Basic host metrics (Datadog) | No — different scopes |
| Trace correlation | `Activity.TraceId` | N/A | No |

Unifying monitoring across Connect (Coralogix + Grafana) and 12go (Datadog) will require either cross-platform correlation (e.g., shared trace IDs in both systems) or migration of one stack to the other.

---

## Required Monitoring Dimensions

Per Shauly (manager), the following dimensions are required for monitoring:

| Dimension | Description |
|---|---|
| **client** | Which client made the request |
| **operator** | Which bus/transport operator |
| **action** | What operation: search, book, confirm, etc. |
| **outcome** | Success or failure |
| **bookingId** | Booking identifier |
| **itineraryId** | Itinerary identifier |
| **traceId** | Distributed trace identifier |
| **clientId + apiKey mapping** | Our API uses `clientId` + `apiKey`, but 12go only has `apiKey` — this creates a mapping gap for monitoring correlation |

---

## Transition Considerations

1. **Trace context propagation** — Connect uses OpenTelemetry with W3C Trace Context; 12go does not use OpenTelemetry. Cross-service traces will require explicit propagation and correlation if 12go services are integrated.

2. **IntegrationId as key dimension** — `IntegrationId` is the primary dimension for metrics tagging across all Denali services (via `IntegrationIdMetricInricherMiddleware`, `IntegrationIdEnricher`, and direct tags on custom metrics). Any new service must support this enrichment pattern.

3. **Meter naming conventions** — Connect services use `connect.{team}.{service}` naming (e.g., `connect.denali.booking.si.host`, `connect.etna.searchengine.Observability`). New services should follow this convention.

4. **Common tag dimensions** — Most Denali metrics use `client_id`, `integration_id`, `contract_code` as standard tags. Grafana dashboards likely filter on these dimensions.

5. **Log aggregation unification** — Connect uses Coralogix; 12go uses Datadog. Unification or cross-referencing via trace IDs will require coordination across both platforms.

6. **Dashboard and metrics platform** — Connect uses Grafana; 12go uses Datadog. Dashboard migration or cross-platform visibility will be needed for unified monitoring.

7. **Dynamic vs static metrics** — The booking-notification-service uses dynamic counter creation (`ConcurrentDictionary`-based), while other services use static metrics. This should be standardized.

8. **Tag key inconsistency** — Some services use `snake_case` tag keys (`client_id`, `integration_id`) while others use `camelCase` (`clientId`, `integrationId`). This inconsistency exists between `BookingSiHostMetrics` (snake_case) and `SiFacadeMetrics` (camelCase).

9. **HTTP metrics enrichment** — The `IHttpMetricsTagsFeature` pattern for adding `connect.integration.id` to ASP.NET Core's built-in HTTP metrics is specific to Denali and may need to be replicated in new services.

10. **Kafka trace propagation** — Denali post-booking and notification services add `Connect.SDK.Kafka` as a trace source for Kafka-based message processing. Any transition involving Kafka consumers/producers must maintain this.

---

## Open Questions

1. **Log correlation across Coralogix and Datadog** — How can logs be correlated or unified given Connect uses Coralogix and 12go uses Datadog?

2. **What Grafana dashboards exist today?** Which dashboards are critical for operations and would need to survive the transition?

3. **Are there alerting rules** configured on specific metric names in Grafana or Coralogix that would break if metrics are renamed?

4. **Should tag key naming be standardized** (`snake_case` vs `camelCase`) before or during the transition?

5. **What is the `Connect.Infra.Observability` library's export configuration?** (OTLP endpoint, batching, sampling rates) — this is configured externally via AWS AppConfig but affects compatibility.

6. **clientId + apiKey mapping** — Our API uses `clientId` + `apiKey` but 12go only has `apiKey`. How will we bridge this gap for monitoring correlation?

7. **What SLOs/SLIs are currently tracked** using these metrics? These must be preserved during transition.

8. **Is there a shared OpenTelemetry Collector** or do services export directly to backends? This affects how a new unified service would plug in.
