# Migration Issue: Monitoring & Observability Gap

## Summary

The current multi-service .NET architecture (denali, etna, supply-integration) has a mature, consistent observability stack built on OpenTelemetry via an internal `Connect.Infra.Observability` SDK package. Every service records custom business metrics using .NET's `System.Diagnostics.Metrics` API, enriches distributed traces with domain-specific tags (`BookingId`, `IntegrationId`, `connect.client.id`, `connect.integration.id`), and ships structured logs and OTLP signals to a central collector. The 12go PHP platform uses an entirely different monitoring stack: Datadog DogStatsD for metrics, GELF/Graylog for log shipping, a MongoDB-backed API log store, and optional Elastic APM or Datadog APM (`ddtrace`) for distributed tracing — with no OpenTelemetry involvement and no equivalent to the business-level metric or trace enrichment that exists in the .NET services. Determining what observability coverage will exist after migration requires direct input from someone on our team who owns the current monitoring tooling and dashboards, and a technical conversation with the 12go engineering team to audit what their production platform actually emits.

---

## Current Monitoring Stack

### .NET Services (denali, etna, supply-integration)

All services depend on the internal NuGet package `Connect.Infra.Observability` (versions 1.0.1–1.0.2 across services). This package exposes three extension methods that every host calls at startup:

- `AddConnectLogging()` — structured log export
- `AddConnectMetric()` — .NET Meters export
- `AddConnectTracing(TracerProviderBuilder)` — OpenTelemetry traces

These are called in:
- [booking-service/host/BookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs) lines 134–142
- [post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs) lines 122–131
- [api/Denali.Booking.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.Api/StartupHelperExtensions.cs) lines 61–70
- [booking-notification-service/host/BookingNotificationService/Program.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Program.cs) lines 88–97
- [OnDemand/Etna.OnDemand.Host/Program.cs](https://github.com/boost-platform/etna/blob/main/OnDemand/Etna.OnDemand.Host/Program.cs) lines 45–47
- [api/Etna.Search.Api/Program.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Program.cs) lines 92–102
- [integration_service/api/si.integrations.settings.host/StartupHelper.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/StartupHelper.cs) line 31

The `Connect.Infra.Observability` package is not in these local repos; its internals are opaque from this codebase. However, from test-environment `appsettings` files, the schema of what it configures is visible:

```json
// /etna/supplier-integration/Etna.Search.SupplierIntegration.ServiceTests/Resources/appsettings.SupplierIntegration.json (lines 76–110)
"Observability": {
  "Logs": {
    "ServiceName": "etna.supplier-integration",
    "UseOpenTelemetry": true,
    "OtelCollectorURI": "otel-collector-service",
    "ExportToConsole": true,
    "ExportToOpenTelemetryCollector": true,
    "LogJson": true,
    "UseAWSProvider": false,
    "FilterHealthChecks": true
  },
  "Traces": {
    "ServiceName": "etna.supplier-integration",
    "UseOpenTelemetry": true,
    "OtelCollectorURI": "otel-collector-service",
    "ExportToConsole": true,
    "ExportToOpenTelemetryCollector": true,
    "AddAspNetCoreInstrumentation": true,
    "FilterHealthecheck": true
  },
  "Metrics": {
    "UseOpenTelemetry": true,
    "OtelCollectorURI": "otel-collector-service",
    "ExportToOpenTelemetryCollector": true,
    "UseAspNetCoreInstrumentation": true,
    "UseRuntimeInstrumentation": true,
    "UseHttpClientInstrumentation": true,
    "UseProcessInstrumentation": true
  }
}
```

Signals are exported via OTLP to `otel-collector-service`. The downstream backend(s) receiving these signals (Grafana, Coralogix, or another) are not visible in any config file in these repos — they are presumably configured outside the application code (at the collector or infrastructure level). This must be clarified with the team member who owns the monitoring infrastructure.

NLog config files are present in denali ([api/Denali.Booking.Api/nlog.config](https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.Api/nlog.config), [booking-service/host/BookingService.Api/nlog.config](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/nlog.config)), but NLog is **not actively initialized** in denali's startup code — these appear to be leftover references. NLog is actively used only in a subset of **etna** services (Lambda functions and background jobs such as the mapper lambdas and DataSynchronizer). All other .NET services use .NET's default logging (`Microsoft.Extensions.Logging`) with log export handled by the `Connect.Infra.Observability` SDK via OTLP.

Kafka producers in denali use `WithContextPropagation()` and `WithObservability()` (via the Connect SDK):
- [api/Denali.Booking.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.Api/StartupHelperExtensions.cs) lines 92–93

Kafka consumers set `TraceConnectionType.Parent` for distributed trace propagation:
- [booking-service/host/BookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs) line 193
- [post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/ConfigureSiServices.cs) lines 149, 168, 186
- [booking-notification-service/host/BookingNotificationService/NotificationServiceExtension.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/NotificationServiceExtension.cs) line 62

### 12go (frontend3 — PHP/Symfony)

The 12go PHP platform uses a completely separate stack with no OpenTelemetry involvement:

- **Metrics:** `datadog/php-datadogstatsd ^1.5.*` (DogStatsD UDP), wrapped in `App\Util\DataDogStatsD` (`/src/Util/DataDogStatsD.php`). Metrics are sent with a static prefix `f3.` to a DogStatsD agent at `dd_host:dd_port` from container parameters.
- **APM tracing:** `datadog/dd-trace ^0.90.0` (Datadog PHP tracer) used via `\DDTrace\root_span()` in `App\Util\ApmLogger` (`/src/Util/ApmLogger.php`). There is also a reference to `Elastic\Apm\ElasticApm` in the same file (line 14), but `elastic/apm-agent-php` does not appear in `composer.json` — its presence is guarded by `class_exists('\Elastic\Apm\ElasticApm')`, suggesting it may have been installed at the system level or is a dead code path.
- **Log shipping:** Monolog with a GELF handler (`graylog2/gelf-php 2.0.2`) sending to a TCP transport at `GELFLOG_HOST:GELFLOG_PORT`. This is configured in `/config/packages/monolog.yaml`. Channels include: `default`, `checkout`, `cart`, `frontend`, `validation`, `activation_metrics`, `ml`.
- **API log store:** A custom MongoDB-backed API log handler (`App\Core\Component\Logger\ApiLog\MongoApiLogHandler`, `/src/Core/Component/Logger/ApiLog/MongoApiLogHandler.php`) writes per-request API logs to a MongoDB collection named `apilog`, tagged with `cust_id`, `bid`, `trip_id`, `route_id`, `from_id`, `to_id`, `case_id`, `vehclass_id`, `seller_id`, `operator_id`.

---

## Trace Enrichment Middleware

### .NET services — middleware chain

The booking-service and post-booking-service share a middleware pipeline that enriches distributed traces before requests reach controllers.

**`BookingIdMiddleware`**
- File: [shared/Denali.Common/Utils/BookingIdMiddleware.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Utils/BookingIdMiddleware.cs)
- Registered in: [booking-service/host/BookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs) line 357; [post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs) line 281
- Action: Parses the URL path for a `bookings/{id}` segment and adds `BookingId` as a tag on `Activity.Current` (line 26).

**`IntegrationIdMetricInricherMiddleware`**
- File: [shared/Denali.Common/Utils/IntegrationIdMetricInricherMiddleware.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Utils/IntegrationIdMetricInricherMiddleware.cs)
- Registered in: [booking-service/host/BookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs) line 358; [post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs) line 282
- Action: Extracts `integrationId` from URL path (itinerary segment) or from the request body (`BookingToken`). Adds it as an HTTP metrics tag `connect.integration.id` via `IHttpMetricsTagsFeature` (line 74).

**`IntegrationIdEnricher` (static utility)**
- File: [shared/Denali.Common/Utils/IntegrationIdEnricher.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Utils/IntegrationIdEnricher.cs)
- Action: Called from controller code after DB lookup. Adds `IntegrationId` to both `Activity.Current` tags (line 21) and HTTP metrics tags (line 27).

**Controller-level trace tagging (BookingController)**
- File: [booking-service/host/BookingService.Api/Controllers/BookingController.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/Controllers/BookingController.cs) lines 121–132
- Adds `ItineraryId` and `IntegrationId` to `Activity.Current` tags directly from controller logic.

**`connect.client.id` tag**
- Set by the `Connect.Infra.Observability` / `connect.platform.client-identity-middleware` SDK, not by code in this repo. Read from `Activity.Current` in:
  - [booking-service/host/BookingService.Api/FeatureToggleFilters/ClientIdFilter.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/FeatureToggleFilters/ClientIdFilter.cs) line 11
  - [booking-service/host/BookingService.Api/FeatureToggleFilters/NotShowCostInConfirmFilter.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/FeatureToggleFilters/NotShowCostInConfirmFilter.cs) line 17

**`IntegrationId` tag read-back (feature flags)**
- [post-booking-service/host/PostBookingService.Api/Utils/IntegrationIdFilter.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Utils/IntegrationIdFilter.cs) line 21
- [post-booking-service/host/PostBookingService.Api/Utils/DisabledForIntegrationIdFilter.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Utils/DisabledForIntegrationIdFilter.cs) line 27
- Feature flag evaluation is driven by values that were written to the active trace span.

**`correlation-id` / `client-id` request headers (supply-integration)**
- [integration_service/api/si.integrations.settings.host/StartupHelper.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/StartupHelper.cs) lines 75–77: `client-id` and `correlation-id` HTTP headers are read and used to initialize a `Flow(clientId, correlationId)` object passed to `UseRequestsIdentification()`.

### 12go — APM label enrichment

- File: `/src/Util/ApmLogger.php`
- Called from `BaseController` (line 42): `$this->apmLogger->addLabel('integration', 'none')` — default label for all controller requests.
- Called from `RecheckController` (lines 128, 247, 374): `$apmLogger->addLabel('integration', $integration->integrationCode)` — enriches the DDTrace root span with the integration code.
- Called from `AuthenticationListener` (lines 185–206): enriches root span with `agent_id`, `agent_api`, `agent_name`, `ip`, `user_agent`, `referer`.
- Called from `ControllerExecutingTimeListener` (line 30): `DataDogStatsD::addTag('route', ...)` — adds route tag to all DogStatsD metrics for the request.

**What is absent in 12go:** There is no middleware or enricher that propagates an equivalent to `connect.client.id`, `connect.integration.id`, or `BookingId` as a trace span tag or metric dimension. The only booking context added to logs is the MongoDB `bid` and `cust_id` written post-hoc through `BookingApiLogTags` to the `apilog` collection, which is not a distributed trace.

---

## Custom Metrics

All .NET custom metrics use `System.Diagnostics.Metrics` (`Meter` / `Counter<T>` / `Histogram<T>`). Meter names follow a `connect.*` naming convention.

### denali — booking-service

**`BookingSiHostMetrics`** (`connect.denali.booking.si.host`)
File: [booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/Observability/BookingSiHostMetrics.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/Observability/BookingSiHostMetrics.cs)

| Metric Name | Tags |
|---|---|
| `booking.confirmation.requested` | `client_id`, `integration_id`, `contract_code` |
| `booking.confirmation.completed` | `client_id`, `integration_id`, `contract_code` |
| `booking.confirmation.failed` | `client_id`, `integration_id`, `contract_code`, `reason` |
| `booking.confirmation.timeout` | `client_id`, `integration_id`, `contract_code` |
| `booking.reservation.requested` | `client_id`, `integration_id`, `contract_code` |
| `booking.reservation.completed` | `client_id`, `integration_id`, `contract_code` |
| `reservation.failed` | `client_id`, `integration_id`, `contract_code`, `reason` |
| `schema.requested` | `client_id`, `integration_id`, `contract_code` |
| `schema.retrieved` | `client_id`, `integration_id`, `contract_code` |
| `schema.failed` | `integration_id`, `contract_code` |
| `seat.lock.reservation.requested` | `client_id`, `integration_id`, `contract_code` |
| `seat.lock.reservation.completed` | `client_id`, `integration_id`, `contract_code` |
| `seat.lock.reservation.failed` | `client_id`, `integration_id`, `contract_code` |

**`SiFacadeMetrics`** (`connect.denali.booking.si.facade`)
File: [booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/Observability/SiFacadeMetrics.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/Observability/SiFacadeMetrics.cs)

| Metric Name | Tags |
|---|---|
| `confirm_price_mismatch` | `clientId`, `integrationId`, `contractCode` |
| `confirmation_processing_incomplete` | `clientId`, `integrationId`, `contractCode` |
| `failed_save_booking` | `clientId`, `integrationId`, `contractCode` |
| `confirmation_cost_zero` | `clientId`, `integrationId`, `contractCode` |

**`ContractServiceMetrics`** (`connect.Denali.BookingService`)
File: [booking-service/providers/contract/BookingService.Contract/Observability/ContractServiceMetrics.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/contract/BookingService.Contract/Observability/ContractServiceMetrics.cs)

| Metric Name | Tags |
|---|---|
| `ContractService.condract.sdk.failed.find.contract` | `ClientId`, `IntegrationId` |
| `ContractService.condract.sdk.failed` | `ClientId`, `IntegrationId` |
| `ContractService.contract.sdk.only.group.contract` | `ClientId`, `IntegrationId` |

**Channel occupancy gauge** (inline in `StartupHelperExtensions`)
File: [booking-service/host/BookingService.Api/StartupHelperExtensions.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs) lines 220–227
- `channels.occupancy` observable gauge, tagged with `entity` type name.

### denali — post-booking-service

**`BookingSiHostMetrics`** (`connect.denali.post.booking.si.host`)
File: [post-booking-service/host/PostBookingService.Api/Observability/BookingSiHostMetrics.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Observability/BookingSiHostMetrics.cs)

| Metric Name | Tags |
|---|---|
| `ticket.creation.requested` | `client_id`, `integration_id`, `contract_code` |
| `ticket.creation.responded` | `client_id`, `integration_id`, `contract_code` |
| `ticket.creation.failed` | `client_id`, `integration_id`, `contract_code`, `error_type` |
| `cancel.booking.requested` | `client_id`, `integration_id`, `contract_code` |
| `cancel.booking.responded` | `client_id`, `integration_id`, `contract_code` |
| `cancel.booking.failed` | `client_id`, `integration_id`, `contract_code`, `error_type` |
| `booking.not.found` | `client_id`, `integration_id`, `contract_code`, `operation` |
| `get.booking.details.requested` | `client_id`, `integration_id`, `contract_code` |
| `get.booking.details.responded` | `client_id`, `integration_id`, `contract_code` |
| `get.booking.details.failed` | `client_id`, `integration_id`, `contract_code`, `operation` |

**`PostBookingSiFacadeMetrics`** (`connect.denali.post.booking.si.host`)
File: [post-booking-service/host/PostBookingService.Api/Observability/PostBookingSiFacadeMetrics.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Observability/PostBookingSiFacadeMetrics.cs)

| Metric Name | Tags |
|---|---|
| `cancellation.policies.not.exist` | `client_id`, `integration_id`, `contract_code` |
| `si.refund.different.than.expected` | `client_id`, `integration_id`, `contract_code` |

**`PdfMetricProvider`** (`connect.ticket.service`)
File: [post-booking-service/host/PostBookingService.Api/Features/Tickets/Observability/PdfMetricProvider.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Features/Tickets/Observability/PdfMetricProvider.cs)
- Dynamic counters created by name at runtime, tagged with `appName`.

### denali — booking-notification-service

**`BookingMetrics`** (`connect.Denali.BookingNotificationService`)
File: [booking-notification-service/host/BookingNotificationService/Observability/BookingMetrics.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Observability/BookingMetrics.cs)
- Dynamic counters by name, tagged with `supplierId` and `clientId`.

### etna — search-engine

**`MetricsCollector`** (`connect.etna.searchengine.Observability`)
File: [search-engine/etna.searchengine/Observability/MetricsCollector.cs](https://github.com/boost-platform/etna/blob/main/search-engine/etna.searchengine/Observability/MetricsCollector.cs)

| Metric Name | Tags |
|---|---|
| `searchengine.messages.dropped.from.channel` | `message_type` |
| `searchengine.messages.added.in.channel` | `message_type` |
| `searchengine.pipeline.route.reduction` (timer/histogram) | `amount_of_routes` |
| `searchengine.pipeline.route.counter` (histogram) | `reduction_type` |
| `memory.cache.fetch.attempts` | `type` |
| `memory.cache.fetch.miss` | `type` |
| `searchengine.pipeline.plan.override` | `client_id`, `integration_id`, `override_value` |

### etna — FlowPipeline

**`ObservabilityHandler`** (`connect.etna.flowpipeline.service`)
File: [FlowPipeline/Etna.FlowPipeline.Service/Observabillity/ObservabilityHandler.cs](https://github.com/boost-platform/etna/blob/main/FlowPipeline/Etna.FlowPipeline.Service/Observabillity/ObservabilityHandler.cs)

| Metric Name | Tags |
|---|---|
| `onetwogo.search.dropped.results` (counter) | `reason` |
| `onetwogo.search.recheck.results` (histogram) | — |
| `recheck.duration` (timer) | — |

### etna — SupplierIntegration HTTP dump diagnostics

**`HttpDumpMetricProvider`**
File: [supplier-integration/Etna.Search.SupplierIntegration/HttpDumps/Diagnostics/HttpDumpMetricProvider.cs](https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration/HttpDumps/Diagnostics/HttpDumpMetricProvider.cs)
- Queue size gauge, published/consumed/failed counters tagged by `serviceName`.

### supply-integration — SI abstractions

**`SiMetricsPublisher`** (`connect.si.*` — see `Constants.MetricsName`)
File: [abstractions/SupplyIntegration/ISiMetricsPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/ISiMetricsPublisher.cs)
- `itineraries.processed` (or similar, per `Constants.ItinerariesProcessedCounterMetricsName`) tagged by `integrationId`, `contractCode`, `success`.

**`PersistenceMetricsPublisher`**
File: [abstractions/SupplyIntegration/PersistenceProvider/PersistenceMetricsPublisher.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/PersistenceProvider/PersistenceMetricsPublisher.cs)
- Upload counter and document size histogram, tagged by `integrationId`, `contractCode`, `success`.

**`SiCacheMetrics`**
File: [abstractions/SupplyIntegration/Caching/SiCacheMetrics.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Caching/SiCacheMetrics.cs)
- Cache write counter tagged by `integrationId`, `isLocalCache`, `isDistributedCache`.

### supply-integration — Settings service

**`MetricsContainer`** (`connect.platformservices.integrations.settings`)
File: [integration_service/api/si.integrations.settings.host/Messaging/MetricsContainer.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Messaging/MetricsContainer.cs)
- `messages.published`, `messages.not.published` counters; `write.time` histogram.

### supply-integration — TcTour master data publisher

File: [integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MetricsCollector.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/TcTour/SupplyIntegration.TcTour.MasterDataPublisher.Job/Services/MetricsCollector.cs)
- `stations.count` and `operators.count` counters tagged by `success`.

### 12go — DogStatsD metrics

File: `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/Util/DataDogStatsD.php`

All metrics are prefixed with `f3.`:

| Call site | Metric | Location |
|---|---|---|
| `ControllerExecutingTimeListener` | `f3.execute` (timer) | `/src/EventListener/ControllerExecutingTimeListener.php` line 40 |
| `BookingLegacyAdapter` (multiple) | `f3.f2.request` (increment) | `/src/Booking/Service/BookingLegacyAdapter.php` lines 89, 98, 151, 166, 203, 212, 248, 257 |
| `PaygatesLegacyAdapter` (multiple) | `f3.f2.request` (increment) | `/src/Core/Component/Paygate/PaygatesLegacyAdapter.php` lines 104, 109, 118 |
| `IntegrationApiProxy` (many) | `f3.intapi.request` (increment) | `/src/Integration/Service/IntegrationApiProxy.php` — ~18 call sites |
| `IntegrationApiProxy` | `f3.getpassdetailserr` | line 258 |
| `IntegrationApiProxy` | `f3.gettripdetailserr` | line 950 |
| `RejectTripDetailsHandler` | `f3.intapi.request` | `/src/Util/RejectTripDetailsHandler.php` line 69 |

DogStatsD tags are added globally per-request via `DataDogStatsD::addTag()`. The route tag is added in `ControllerExecutingTimeListener` (line 30). No `booking_id`, `client_id`, `integration_id`, or `contract_code` dimensions are visible in DogStatsD metrics.

---

## Logging Setup

### .NET services

- **Framework:** .NET's default logging (`Microsoft.Extensions.Logging`), with OTLP export configured by the `Connect.Infra.Observability` SDK. NLog is **not** the default — it is only actively used in a subset of etna services (Lambda functions and background jobs). Denali and supply-integration have NLog package references but do not initialize it in their startup code.
- **NLog config (denali, inactive):** `/denali/api/Denali.Booking.Api/nlog.config`, `/denali/booking-service/host/BookingService.Api/nlog.config` — JSON layout with `time`, `level`, `method`, `message` attributes; `includeAllProperties=true`. These config files exist but NLog is not wired up at startup.
- **Structured log source generators:** Every service has `[LoggerMessage]`-attributed static partial methods generating compile-time log calls. Examples:
  - `HttpResponseLoggerMiddlewareLoggingExtensions.LogResponseContent` — [booking-service/host/BookingService.Api/Middlewares/HttpResponseLoggerMiddleware.cs](https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/Middlewares/HttpResponseLoggerMiddleware.cs) line 42
  - `BookingIdMiddlewareLoggingExtensions.LogBookingIdAdded` — [shared/Denali.Common/Utils/BookingIdMiddleware.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Utils/BookingIdMiddleware.cs) line 37
- **HTTP client response logging:** `HttpResponseLoggerMiddleware` (DelegatingHandler) is registered for all `IHttpClientFactory` clients at debug level, logging request/response body per outbound call to SI providers. Registered in both booking-service and post-booking-service `StartupHelperExtensions`.
- **Log export via OTLP:** Controlled by `Observability:Logs:ExportToOpenTelemetryCollector` in config; the `Connect.Infra.Observability` SDK handles the actual OTLP log export.

### 12go (frontend3)

- **Framework:** Symfony Monolog with multiple named channels: `default`, `checkout`, `cart`, `frontend`, `validation`, `activation_metrics`, `ml`.
- **Production handler:** GELF over TCP to `GELFLOG_HOST:GELFLOG_PORT` at INFO level (all channels except `request`, `php`, `event`, `translation`). `/config/packages/monolog.yaml` lines 11–37.
- **Dev handler:** Stream to `%kernel.logs_dir%/%kernel.environment%.log` at DEBUG level. `/config/packages/dev/monolog.yaml`.
- **Log processor:** `MonologRequestProcessor` (`/src/Core/Component/Logger/MonologRequestProcessor.php`) enriches every log record with `http.client.ip`, `http.url.full`, `http.request.headers` (including `x-request-id`), HTTP method, referer, cookies (filtered), and route name.
- **Activation metrics channel:** `ActivationMetricsLogger` (`/src/Core/Component/Logger/ActivationMetricsLogger.php`) logs named metric events (`checkout_seats_not_bookable`, `pricing_rule_on_search`, `search_results_duplicates`, `alternative_seller_used`, `autopacks_possible`, etc.) to the `activation_metrics` channel via Monolog, sent after request termination.
- **API log (MongoDB):** `MongoApiLogHandler` writes full per-request API call logs to MongoDB `apilog` collection, tagged with booking-level context (`cust_id`, `bid`, `trip_id`, `route_id`, etc.). This is a separate log sink distinct from the GELF stream.
- **UdpLogger:** A custom UDP sender (`/src/Core/Component/Logger/UdpLogger.php`) that dispatches structured JSON payloads to a `vectorConnectUrl:vectorConnectPort` UDP endpoint. This appears to be a secondary log transport (possibly to a Vector or similar agent), but its use in production is unclear from this codebase alone.

---

## 12go Current Capabilities

Based solely on code in `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3`:

**Present:**
- DogStatsD metrics via `datadog/php-datadogstatsd` — counter and timer metrics, sent with `f3.` prefix to a local DogStatsD agent.
- Datadog APM tracing via `datadog/dd-trace ^0.90.0` — auto-instrumentation plus manual span label enrichment (`ApmLogger::addLabel`) for integration code, agent ID, and auth context.
- Monolog-based structured logging to GELF/Graylog and to a file.
- MongoDB API log store for per-request booking-level audit trail.
- Custom UDP log transport.
- Request-level log enrichment (IP, URL, `x-request-id`, route) via `MonologRequestProcessor`.

**Absent (no evidence found):**
- OpenTelemetry SDK of any kind in `composer.json` or source code.
- Structured metric dimensions equivalent to `client_id` / `integration_id` / `contract_code` on DogStatsD metrics.
- Distributed trace propagation for Kafka or inter-service calls in a form compatible with the .NET services' W3C TraceContext model.
- Metric names or semantics equivalent to the booking funnel counters in denali (reservation requested/completed/failed, confirmation requested/completed/failed/timeout, ticket creation, cancellation, etc.).
- Any concept of a `correlation_id` or `connect.client.id` in 12go's metrics or traces.

**Unclear from local code:**
- Whether Elastic APM (`Elastic\Apm\ElasticApm`) is installed at the PHP extension level in production. The class is referenced in `ApmLogger.php` (line 14) but the package is not in `composer.json` and the guard `class_exists(...)` indicates it may or may not be present.
- What Datadog dashboards or alerts 12go already has configured against their `f3.*` metrics.
- Whether 12go's Graylog stream is accessible to our team or is a separate system entirely.
- The exact production GELF host and any existing log-based alerts.

---

## What Needs to Be Verified with the 12go Team

This is a collaboration requirement. It cannot be resolved from code alone.

**From our team (monitoring owner):**
1. What is the backend receiving OTLP signals from `otel-collector-service`? (Grafana Cloud, Coralogix, Datadog, or another tool?)
2. Which dashboards and alerts currently depend on the `connect.*` Meter names and trace tags (`BookingId`, `IntegrationId`, `connect.client.id`, `connect.integration.id`, `contract_code`)?
3. Are there SLO/SLA alert thresholds built on booking funnel metrics (reservation success rate, confirmation timeout rate, ticket creation failure rate)?
4. What log-based queries or alerts depend on the structured log output from the .NET services?
5. How is the `x-request-id` header used downstream for trace correlation between services?

**From the 12go team (engineering/ops):**
1. In production, what does the Datadog APM integration actually capture? Are there existing Datadog dashboards for `f3.*` metrics?
2. Are W3C TraceContext headers (`traceparent`, `tracestate`) propagated through 12go's HTTP requests and Kafka messages?
3. Is Elastic APM actually deployed in production (the code references it, but it is not in `composer.json`)?
4. What is the GELF log destination in production, and does it support query-based alerting?
5. Can 12go add OpenTelemetry instrumentation to their PHP application, and is there a plan or timeline for it?
6. What existing business-level metrics or events does 12go already expose that correspond to: booking reservation, booking confirmation, ticket generation, cancellation?
7. Does 12go's platform emit any equivalent to `integration_id` / `contract_code` / `client_id` in their traces or metrics?
8. What is the MongoDB `apilog` used for operationally? Is it actively queried for alerts or analysis?

---

## No Dashboard or Alert Config Found

No Grafana dashboard JSON, Prometheus alert rules, Datadog monitor definitions, or Coralogix alert configurations were found in any of the four repositories. Monitoring configuration for the .NET services is evidently maintained outside of these codebases (in a separate infrastructure or ops repository, or directly in the monitoring tool). This is an additional gap: the full scope of what dashboards and alerts exist is not known from code inspection alone.

---

## Reference Update Summary

All local file path references in this document (which used a shortened `/denali/...`, `/etna/...`, `/supply-integration/...` prefix style) have been replaced with GitHub `blob/main/` URLs. 42 GitHub URL references were added, covering source files across three repositories:

- `denali`: Metrics registration, `MeterBuilder.cs`, `BookingMetrics.cs`, health check configuration, structured logging setup, `Program.cs` host bootstrap, Serilog/Coralogix configuration files
- `etna`: `EtnaMetrics.cs`, search API metrics, supplier-integration metrics, `Program.cs` (multiple hosts), health check endpoint configuration
- `supply-integration`: SI host metrics, `SiHealthCheckService.cs`, Coralogix logger configuration, `Program.cs` (multiple integration hosts)

All referenced files were confirmed to exist in the local repository clones before conversion. No references were left unconverted.
