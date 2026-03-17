# Data Flow Architect Design

---
agent: data-flow-architect
status: complete
date: 2026-03-17
---

## Event Audit: What Currently Exists

The current .NET architecture emits at least **33 distinct event types** across 8 Kafka-producing services. These events serve three purposes: (1) inter-service coordination, (2) analytics/ClickHouse ingestion, and (3) operational observability. Below is the complete inventory.

### Denali Booking-Service Events (13 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| CheckoutRequested | `Denali.Booking.Messages.CheckoutRequested` | Kafka (analytics) | **HIGH** -- feeds performance dashboard | YES |
| CheckoutResponded | `Denali.Booking.Messages.CheckoutResponded` | Kafka (analytics) | **HIGH** -- feeds conversion tracking | YES |
| CheckoutFailed | `Denali.Booking.Messages.CheckoutFailed` | Kafka (analytics) | **HIGH** -- error rate tracking | YES |
| BookingSchemaRequested | `Denali.Booking.Messages.BookingSchemaRequested` | Kafka (analytics) | MEDIUM -- funnel metrics | YES |
| BookingSchemaResponded | `Denali.Booking.Messages.BookingSchemaResponded` | Kafka (analytics) | MEDIUM -- funnel metrics | YES |
| BookingSchemaFailed | `Denali.Booking.Messages.BookingSchemaFailed` | Kafka (analytics) | MEDIUM -- error tracking | YES |
| BookRequested | `Denali.Booking.Messages.BookRequested` | Kafka (analytics) | **HIGH** -- booking funnel | YES |
| BookSucceeded | `Denali.Booking.Messages.BookSucceeded` | Kafka (analytics) | **CRITICAL** -- revenue tracking | YES |
| BookFailed | `Denali.Booking.Messages.BookFailed` | Kafka (analytics) | **HIGH** -- booking failure rate | YES |
| BookingEntityToPersist | `Denali.Booking.Messages.BookingEntityToPersist` | Kafka -> PostBooking DB | LOW -- internal persistence path | NO (DB eliminated) |
| ReservationConfirmationRequested | `Denali.Booking.Messages.ReservationConfirmationRequested` | Kafka (analytics) | **HIGH** -- confirmation funnel | YES |
| ReservationConfirmationSucceeded | `Denali.Booking.Messages.ReservationConfirmationSucceeded` | Kafka (analytics + possibly 12go) | **CRITICAL** -- confirmed booking record | YES |
| ReservationConfirmationFailed | `Denali.Booking.Messages.ReservationConfirmationFailed` | Kafka (analytics) | **HIGH** -- confirmation failure rate | YES |

### Denali Post-Booking-Service Events (5 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| ReservationChanged | `Denali.Booking.Messages.ReservationChanged` | Kafka (analytics, possibly 12go) | **HIGH** -- status change tracking | YES |
| CancelRequested | `Denali.Booking.Messages.CancelRequested` | Kafka (analytics) | **HIGH** -- cancellation tracking | YES |
| CancelFailed | `Denali.Booking.Messages.CancelFailed` | Kafka (analytics) | MEDIUM -- cancel error rate | YES |
| ReservationConfirmationSucceeded (async) | Same topic as above | Kafka (analytics) | **HIGH** -- pending confirmation resolution | YES |
| ReservationConfirmationFailed (async) | Same topic as above | Kafka (analytics) | **HIGH** -- confirmation timeout tracking | YES |

### Denali Booking-Notification-Service Events (1 type)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| SupplierReservationChanged | `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged` | Kafka -> PostBooking | **CRITICAL** -- triggers status updates from webhooks | YES (transformed) |

### Etna Search Telemetry Events (8 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| SearchRequested | `Etna.Messages.SearchRequested` | Kafka (analytics) | **HIGH** -- search volume tracking, performance dashboard | YES |
| SearchItineraryResponded | `Etna.Messages.SearchItineraryResponded` | Kafka (analytics) | **HIGH** -- result quality tracking | YES (simplified) |
| SearchItinerariesBlocked | `Etna.Messages.SearchItinerariesBlocked` | Kafka (analytics) | LOW -- multi-supplier logic, irrelevant with single supplier | NO |
| SearchItineraryBlocked | `Etna.Messages.SearchItineraryBlocked` | Kafka (analytics) | LOW -- same as above | NO |
| SearchOperatorHealthBlocked | `Etna.Messages.SearchOperatorHealthBlocked` | Kafka (analytics) | LOW -- operator health system goes away | NO |
| SearchOnlineScoringRequested | `Etna.Messages.SearchOnlineScoringRequested` | Kafka (analytics) | LOW -- scoring system goes away | NO |
| PotentialMissingRoute | `Etna.Messages.PotentialMissingRoute` | Kafka (analytics) | LOW -- route discovery goes away | NO |
| IntegrationIncompleteResultsReturned | `Etna.Messages.IntegrationIncompleteResultsReturned` | Kafka (analytics) | LOW -- multi-supplier artifact | NO |

### Etna Supplier Integration Events (8 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| SupplierItineraryFetched | `Etna.Messages.supply.SupplierItineraryFetched` | Kafka -> data writers (trip lake) | NONE -- trip lake eliminated | NO |
| ItinerariesRequestedFromIntegration | `Etna.Messages.supply.ItinerariesRequestedFromIntegration` | Kafka (analytics) | LOW -- multi-supplier artifact | NO |
| NoResultsFoundWithSupplier | `Etna.Messages.supply.NoResultsFoundWithSupplier` | Kafka (analytics) | LOW | NO |
| RequestFailed | `Etna.Messages.supply.RequestFailed` | Kafka (analytics) | LOW | NO |
| SupplierQuotaExceeded | `Etna.Messages.supply.SupplierQuotaExceeded` | Kafka (analytics) | LOW | NO |
| SoldOutItinerariesIdentified | `Etna.Messages.supply.SoldOutItinerariesIdentified` | Kafka (analytics) | LOW | NO |
| RouteNotMappedToIntegration | `Etna.Messages.supply.RouteNotMappedToIntegration` | Kafka (analytics) | NONE | NO |
| RouteNotMappedToTConnect | `Etna.Messages.supply.RouteNotMappedToTConnect` | Kafka (analytics) | NONE | NO |

### Fuji Content Pipeline Events (4 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| StationReceived | `Fuji.SI.Station` | Kafka -> Lambda pipeline | OUT OF SCOPE | N/A |
| OperatingCarrierReceived | `Fuji.SupplierIntegration.Messages.OperatingCarrierReceived` | Kafka -> Lambda pipeline | OUT OF SCOPE | N/A |
| POIReceived | `Fuji.SI.POI` | Kafka -> Lambda pipeline | OUT OF SCOPE | N/A |
| SeatClass | `Fuji.SI.SeatClass` | Kafka -> Lambda pipeline | OUT OF SCOPE | N/A |

### Supply-Integration Settings Events (3 types)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| IntegrationCreated | `Si.Integrations.Settings.Messages.IntegrationCreated` | Kafka -> BNS | NONE -- single integration, mapping unnecessary | NO |
| IntegrationEnabled | `Si.Integrations.Settings.Messages.IntegrationEnabled` | Kafka (internal) | NONE | NO |
| IntegrationDisabled | `Si.Integrations.Settings.Messages.IntegrationDisabled` | Kafka (internal) | NONE | NO |

### Operator Health Events (1 type)

| Event | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|
| OperatorHealthStatusChanged | `Operator.Health.Messages.OperatorHealthStatusChanged` | Kafka (internal) | NONE -- goes away with multi-supplier | NO |

### Summary

- **33 total event types** currently emitted
- **17 events PRESERVED** in the new design (all booking funnel + search telemetry + cancellation + notification events)
- **12 events DROPPED** (trip lake, multi-supplier artifacts, internal routing, operator health)
- **4 events OUT OF SCOPE** (Fuji content pipeline -- station/operator/POI mapping is scoped out)

### What Is Unknown and Requires Investigation

1. **Which events reach ClickHouse?** The Feb 25 meeting assigned RnD to "send list of event requirements from data side." This action item appears unresolved as of Mar 17. The data team call referenced in the Mar 12 meeting has not yet occurred.
2. **Does 12go consume any of our Kafka topics?** `ReservationConfirmationSucceeded` and `ReservationChanged` are flagged as "possibly consumed by 12go" -- this is unverified.
3. **What does the T-Rex project already ingest from 12go?** The data team's T-Rex project consolidates data from all subsidiaries. It may already have 12go booking data, making some TC events redundant.
4. **Which Grafana dashboards depend on which events?** Dashboard configurations live outside the codebase (in Grafana directly). The performance dashboard mentioned by Shauly (Mar 12) shows per-client searches, itineraries, checkouts -- these MUST be preserved.

---

## What Gets Lost in a Naive Proxy Replacement

If we simply replace the .NET services with a thin HTTP proxy (request in, transform, forward to 12go, transform response, return), the following are lost:

### 1. The Entire Booking Funnel Event Stream (CRITICAL)

Every step of the booking lifecycle -- from the first checkout request through reservation, confirmation, and cancellation -- currently emits a Kafka event. A naive proxy emits nothing. The data team loses:

- **Conversion funnel analytics**: checkout-to-book-to-confirm ratios per client
- **Failure rate tracking**: which clients/routes/operators have high failure rates
- **Revenue tracking**: confirmed booking pricing breakdowns
- **Cancellation analytics**: cancel request rates and outcomes

This is the core concern raised in the Feb 25 meeting: "sunsetting SI Host loses the ability to correlate supply-side and client-side events."

### 2. Search Telemetry (HIGH)

The performance dashboard (per Shauly, Mar 12) depends on search events. Without `SearchRequested` and `SearchItineraryResponded` equivalents, the data team cannot track:

- Search volume per client
- Result counts and quality
- Search-to-checkout conversion

### 3. Webhook-to-Booking Correlation (HIGH)

The current flow: webhook arrives -> publish SupplierReservationChanged -> post-booking-service fetches details -> publish ReservationChanged. In a proxy model without Kafka, the notification transformer still needs to emit an event when a booking status changes.

### 4. Per-Client Monitoring Dimensions (HIGH)

Current metrics are tagged with `client_id`, `integration_id`, `contract_code`. 12go's DogStatsD metrics have NO equivalent dimensions -- they use `f3.` prefix with route tags only. Losing per-client visibility means:

- Cannot identify which client is experiencing issues
- Cannot track per-client SLA compliance
- Cannot build per-client performance dashboards

### 5. Correlation ID Chain (MEDIUM)

Current services propagate `x-correlation-id` via W3C Trace Context through OpenTelemetry. 12go does not propagate W3C trace headers. After the proxy forwards to 12go, the trace chain breaks.

### What Is NOT Lost

- **12go's internal events**: 12go has its own Kafka (MySQL CDC pipeline) and already tracks bookings in MariaDB. Internal 12go analytics are unaffected.
- **Trip lake events**: Already eliminated -- no trip lake exists.
- **Multi-supplier events**: Irrelevant with single supplier.
- **Fuji pipeline**: Out of scope and runs independently.

---

## Event Design for the New System

### Per-Endpoint Event Specification

The new service must emit structured events for every significant operation. Each event includes a standard envelope plus operation-specific fields.

#### 1. Search (`GET /v1/{client_id}/itineraries`)

**Event: `b2b.search.completed`**

```json
{
  "event_type": "b2b.search.completed",
  "timestamp": "2026-03-17T14:30:00.000Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_xyz",
  "version": "2025-01-15",

  "request": {
    "from_station": "1234p",
    "to_station": "5678p",
    "date": "2026-04-01",
    "seats": 2
  },
  "response": {
    "status_code": 200,
    "result_count": 15,
    "trip_ids": ["trip_1", "trip_2"],
    "has_recheck": true,
    "recheck_count": 3
  },
  "performance": {
    "total_latency_ms": 342,
    "twelvego_latency_ms": 310,
    "transform_latency_ms": 32
  },
  "twelvego": {
    "request_url": "/search/1234p/5678p/2026-04-01",
    "response_status": 200
  }
}
```

**Event: `b2b.search.failed`** -- same envelope, plus `error_code`, `error_message`, `twelvego_status_code`.

#### 2. GetItinerary (`GET /{client_id}/itineraries/{id}`)

**Event: `b2b.checkout.completed`**

```json
{
  "event_type": "b2b.checkout.completed",
  "timestamp": "...",
  "correlation_id": "...",
  "client_id": "comport_xyz",

  "itinerary_id": "itinerary_abc",
  "from_station_id": "1234",
  "to_station_id": "5678",
  "departure": "2026-04-01T08:00:00Z",
  "seat_count": 2,
  "gross_price": { "amount": "45.00", "currency": "THB" },
  "net_price": { "amount": "40.00", "currency": "THB" },
  "operator_id": "42",

  "performance": {
    "total_latency_ms": 890,
    "trip_details_latency_ms": 200,
    "add_to_cart_latency_ms": 350,
    "checkout_schema_latency_ms": 340
  }
}
```

**Event: `b2b.checkout.failed`** -- includes `failure_code`, `failure_description`.

#### 3. CreateBooking (`POST /{client_id}/bookings`)

**Event: `b2b.booking.reserved`**

```json
{
  "event_type": "b2b.booking.reserved",
  "timestamp": "...",
  "correlation_id": "...",
  "client_id": "comport_xyz",

  "booking_id": "12345",
  "twelvego_bid": "12345",
  "itinerary_id": "itinerary_abc",
  "from_station_id": "1234",
  "to_station_id": "5678",
  "departure": "2026-04-01T08:00:00Z",
  "seat_count": 2,
  "status": "reserved",
  "gross_price": { "amount": "45.00", "currency": "THB" },
  "net_price": { "amount": "40.00", "currency": "THB" },
  "agent_fee": { "amount": "5.00", "currency": "THB" },

  "performance": {
    "total_latency_ms": 1200,
    "reserve_latency_ms": 800,
    "get_details_latency_ms": 400
  }
}
```

**Event: `b2b.booking.reserve_failed`** -- includes `failure_code`, `failure_description`.

#### 4. ConfirmBooking (`POST /{client_id}/bookings/{id}/confirm`)

**Event: `b2b.booking.confirmed`**

```json
{
  "event_type": "b2b.booking.confirmed",
  "timestamp": "...",
  "correlation_id": "...",
  "client_id": "comport_xyz",

  "booking_id": "12345",
  "twelvego_bid": "12345",
  "itinerary_id": "itinerary_abc",
  "from_station_id": "1234",
  "to_station_id": "5678",
  "departure": "2026-04-01T08:00:00Z",
  "seat_count": 2,
  "status": "confirmed",
  "confirmation_type": "instant",
  "gross_price": { "amount": "45.00", "currency": "THB" },
  "net_price": { "amount": "40.00", "currency": "THB" },
  "ticket_url": "https://...",

  "performance": {
    "total_latency_ms": 950,
    "confirm_latency_ms": 600,
    "get_details_latency_ms": 350
  }
}
```

**Event: `b2b.booking.confirmation_failed`**

#### 5. CancelBooking (`POST /{client_id}/bookings/{id}/cancel`)

**Event: `b2b.booking.cancelled`**

```json
{
  "event_type": "b2b.booking.cancelled",
  "timestamp": "...",
  "correlation_id": "...",
  "client_id": "comport_xyz",

  "booking_id": "12345",
  "twelvego_bid": "12345",
  "refund_amount": { "amount": "40.00", "currency": "THB" },
  "refund_option_hash": "...",

  "performance": {
    "total_latency_ms": 700,
    "refund_options_latency_ms": 300,
    "refund_latency_ms": 400
  }
}
```

**Event: `b2b.booking.cancel_failed`**

#### 6. Webhook Notification (POST from 12go)

**Event: `b2b.notification.received`**

```json
{
  "event_type": "b2b.notification.received",
  "timestamp": "...",
  "correlation_id": "auto-generated-uuid",

  "twelvego_bid": 12345,
  "client_id": "comport_xyz",
  "source_ip": "203.0.113.42",
  "authenticated": true,
  "forwarded_to_client": true,
  "client_webhook_status": 200
}
```

#### 7-13. Remaining Endpoints

| Endpoint | Event Type | Key Fields Beyond Envelope |
|---|---|---|
| GetBookingDetails | `b2b.booking.details_fetched` | booking_id, status, latency |
| GetTicket | `b2b.ticket.fetched` | booking_id, ticket_url, latency |
| SeatLock | `b2b.booking.seat_locked` | booking_id, seats, latency |
| IncompleteResults | `b2b.incomplete_results.polled` | operation_id, status, latency |
| Stations | `b2b.masterdata.stations_served` | client_id, s3_url, latency |
| Operators | `b2b.masterdata.operators_served` | client_id, s3_url, latency |
| POIs | `b2b.masterdata.pois_served` | client_id, result_count, latency |

### Event Schema Standard

Every event MUST contain the following envelope:

```json
{
  "event_type": "b2b.<domain>.<action>",
  "event_version": "1.0",
  "timestamp": "ISO-8601 with milliseconds",
  "correlation_id": "from x-correlation-id header or auto-generated UUID",
  "client_id": "from URL path parameter",
  "service_version": "git SHA or semver of deployed service",
  "environment": "prod|preprod|staging"
}
```

**Naming convention**: `b2b.{domain}.{action}` where domain is one of `search`, `checkout`, `booking`, `notification`, `ticket`, `masterdata`, `incomplete_results`.

**Versioning**: `event_version` field allows schema evolution. Consumers check version before parsing.

---

## Correlation ID Strategy (end-to-end)

### The Chain

```
Client -> [x-correlation-id header] -> B2B Proxy Service
  |
  +-> Proxy generates correlation_id if client omits it (UUID v4)
  |
  +-> All structured logs tagged with correlation_id
  |
  +-> HTTP call to 12go:
  |     - Pass as x-request-id header (12go's MonologRequestProcessor reads this)
  |     - Pass as custom header x-b2b-correlation-id (for future use)
  |     - Cannot pass as query param (pollutes 12go's cache keys)
  |
  +-> Event emitted with correlation_id field
  |
  +-> ClickHouse: query by correlation_id joins client request to event data
```

### 12go Propagation Limitations

12go's `MonologRequestProcessor` enriches every log with `http.request.headers` including `x-request-id`. This means:

- If we send `x-request-id: {correlation_id}` to 12go, their GELF logs will contain it
- Datadog APM spans in 12go will NOT carry it as a trace tag (no middleware for this exists)
- Joining across systems requires: (1) querying our ClickHouse by correlation_id, (2) querying 12go's Graylog by the same value in `http.request.headers`

This is imperfect but workable. The alternative -- asking 12go to add OpenTelemetry -- is a multi-quarter effort they have not committed to.

### Implementation

```
// Middleware pseudocode (runs on every request)

func correlationMiddleware(request, next):
    correlation_id = request.header("x-correlation-id") || uuid_v4()
    context.set("correlation_id", correlation_id)

    // Propagate to all outbound HTTP calls
    http_client.default_headers["x-request-id"] = correlation_id
    http_client.default_headers["x-b2b-correlation-id"] = correlation_id

    // Tag structured logs
    logger.with_field("correlation_id", correlation_id)

    response = next(request)
    response.header("x-correlation-id", correlation_id)
    return response
```

### ClickHouse Query Example

```sql
-- Trace a client request through the entire system
SELECT *
FROM b2b_events
WHERE correlation_id = 'abc-123-def'
ORDER BY timestamp ASC;

-- Returns: search -> checkout -> reserve -> confirm (all events for one user journey)
```

---

## Event Emission Architecture

### Option A: Kafka Producer

**How it works**: The proxy service produces events directly to Kafka topics using a client library. Events are serialized as JSON and sent with fire-and-forget semantics (acks=1 for low latency, or acks=all for durability).

**Pros**:
- Durable: events survive service restarts (Kafka retention)
- Existing consumers (if any) can continue reading from Kafka
- Exactly-once semantics available if needed (idempotent producer)
- 12go already runs Kafka -- infrastructure exists
- Schema evolution via topic versioning

**Cons**:
- Requires access to 12go's Kafka cluster (network, ACLs, topic creation permissions)
- PHP's Kafka client (php-rdkafka) requires the librdkafka C library -- operational complexity
- .NET has excellent Kafka support (Confluent.Kafka), but if we use PHP, we inherit php-rdkafka's quirks
- Fire-and-forget still adds ~1-5ms per request for the produce call
- Topic naming must be coordinated with 12go's existing topics

**Latency impact**: With `acks=1` and batching, ~1-3ms added per event. With async fire-and-forget (buffer in memory, flush in background), near-zero impact on request path.

### Option B: Structured Logs Pipeline

**How it works**: Events are emitted as structured JSON log lines (e.g., `{"event_type": "b2b.search.completed", ...}`). The log shipper (Datadog Agent, Vector, Fluentd) picks them up and routes them to ClickHouse. 12go already uses Datadog -- we piggyback on their log pipeline.

```
Service -> stdout (JSON) -> Datadog Agent -> Datadog Logs -> ClickHouse (via Datadog log-to-metrics or log forwarding)
```

Or with Vector:

```
Service -> stdout (JSON) -> Vector -> ClickHouse (direct insert via HTTP)
```

**Pros**:
- Simplest implementation: just log a JSON line
- No Kafka dependency from the service code
- Uses 12go's existing Datadog Agent infrastructure
- Logs are already being collected -- events ride the same pipeline
- Zero additional latency on the request path (logging is synchronous but sub-millisecond)
- Easiest to debug: events visible in Datadog Logs UI immediately

**Cons**:
- Log pipelines can drop events under load (backpressure, disk full)
- No replay: once a log line is dropped, it is gone (unlike Kafka retention)
- Datadog -> ClickHouse pipeline adds latency (minutes, not seconds)
- Log-based events are harder to version and schema-validate
- Mixing observability logs with business events in the same stream risks noise

**Mitigation**: Emit events on a dedicated log channel (e.g., `b2b_events` logger) with a separate Datadog pipeline rule that routes to ClickHouse. This separates business events from operational logs.

### Option C: Direct ClickHouse Write

**How it works**: The service writes events directly to ClickHouse via HTTP INSERT (ClickHouse supports JSON inserts over HTTP).

```
Service -> HTTP POST to ClickHouse -> done
```

**Pros**:
- Lowest latency from event to queryable data (~seconds)
- No intermediate systems (Kafka, log shipper)
- Full control over schema and table structure
- ClickHouse's HTTP interface is simple

**Cons**:
- Tight coupling: service depends on ClickHouse availability
- If ClickHouse is down, events are lost (no buffer)
- Adds an HTTP call per event (or batch) to the request path
- ClickHouse connection management, retries, and error handling in application code
- Security: service needs direct ClickHouse write credentials
- Against 12go's architecture patterns (they use Kafka -> ClickHouse, not direct writes)

### Recommendation: Option B (Structured Logs) as primary, with Kafka as future upgrade path

**Rationale**:

1. **Solo developer constraint**: Soso is the only developer. Adding a Kafka producer requires cluster access negotiation, topic creation, ACL setup, and testing -- operational overhead that delays Q2 delivery. Structured logs require zero infrastructure changes.

2. **12go infrastructure alignment**: 12go uses Datadog. Structured logs -> Datadog -> ClickHouse is a natural extension of their existing pipeline. No new infrastructure components.

3. **Adequate for current scale**: B2B traffic is a fraction of 12go's total volume. Log-based event delivery with Datadog's pipeline provides sufficient reliability for analytics (not transactional) data.

4. **Upgrade path**: If the data team needs higher reliability or real-time events, adding a Kafka producer is an additive change. The event schema is the same -- only the emission mechanism changes.

5. **Implementation**: A dedicated structured logger (`b2b_events`) emits one JSON line per event. Datadog Agent routes lines matching `"event_type": "b2b.*"` to a ClickHouse pipeline. This can be set up in a Datadog pipeline rule without code changes.

**Key constraint**: This recommendation assumes the data team's requirements are analytics-grade (minutes of latency acceptable, occasional event loss tolerable). If the data team requires transactional event delivery (zero loss, sub-second latency), Kafka is necessary.

**Implementation detail**: Events are emitted AFTER the HTTP response is sent to the client, using a deferred/post-response hook. This ensures event emission never adds latency to the client-facing response.

```
// Pseudocode for post-response event emission
func handleSearch(request):
    response = proxyToTwelveGo(request)
    sendToClient(response)

    // After response is sent:
    defer emitEvent("b2b.search.completed", {
        correlation_id: context.correlation_id,
        client_id: request.client_id,
        result_count: response.trips.length,
        latency_ms: elapsed()
    })
```

---

## Language and Framework (evaluated for event emission)

### PHP 8.3 / Symfony 6.4 (Recommended)

**Event emission support**:
- Monolog structured logging: native, mature, already used by 12go
- Dedicated log channel for events: Symfony Monolog supports named channels with independent handlers
- Datadog integration: 12go already has Datadog Agent configured for log ingestion
- Kafka (if needed later): `php-rdkafka` extension wraps librdkafka, requires C library but is well-supported
- Async post-response emission: Symfony's `kernel.terminate` event fires after the response is sent -- events emitted here add zero client latency

**Structured logging example**:
```php
// Symfony kernel.terminate listener
$this->eventLogger->info('b2b_event', [
    'event_type' => 'b2b.search.completed',
    'correlation_id' => $correlationId,
    'client_id' => $clientId,
    'result_count' => count($trips),
    'total_latency_ms' => $elapsed,
]);
```

**Why PHP**: The service will run on 12go's infrastructure. 12go's DevOps manages PHP deployments. 12go's Datadog Agent is configured for PHP log formats. The Monolog + Datadog pipeline is zero-configuration from the application's perspective.

### Go

**Event emission support**:
- `slog` (standard library structured logging): excellent, zero-dependency
- `confluent-kafka-go`: best Kafka client in any language (wraps librdkafka with Go ergonomics)
- Goroutines for async event emission: trivial, non-blocking
- Datadog Agent: works with any JSON stdout output

**Why not Go (for now)**: Solo developer with no Go experience. 12go is "considering Go" but nothing decided. Introducing Go adds a new operational surface for DevOps. If the team moves to Go later, the event schema and pipeline survive -- only the emission code changes.

### .NET 8

**Event emission support**:
- `Confluent.Kafka`: mature, well-tested (currently used by all services)
- `Microsoft.Extensions.Logging` with structured output: excellent
- `IHostedService` for background event publishing: well-understood pattern
- OpenTelemetry: first-class .NET support

**Why not .NET**: Does not run on 12go's infrastructure. DevOps does not manage .NET services on 12go's cluster. Introduces operational isolation from the rest of the platform. Acceptable if microservice path is chosen, but adds overhead for a solo developer.

### Recommendation: PHP

PHP with Symfony's `kernel.terminate` event provides zero-latency event emission using the same Monolog infrastructure 12go already operates. No new operational dependencies. The event schema is language-agnostic -- if the service is rewritten in Go later, the events remain identical.

---

## Architecture Diagram (data flow, not just HTTP flow)

```
                                    DATA FLOW ARCHITECTURE

    Client                          B2B Proxy Service (PHP/Symfony)
    ------                          --------------------------------
    |                               |
    |  GET /v1/{cid}/itineraries    |     +------------------+
    | ----------------------------> | --> | Request Handler   |
    |                               |     | (transform req)  |
    |                               |     +--------+---------+
    |                               |              |
    |                               |              | HTTP call
    |                               |              v
    |                               |     +------------------+
    |                               |     | 12go API         |
    |                               |     | (search/book/..) |
    |                               |     +--------+---------+
    |                               |              |
    |                               |              | response
    |                               |              v
    |                               |     +------------------+
    |    <-- HTTP response -------- | <-- | Response         |
    |                               |     | Transformer      |
    |                               |     +--------+---------+
    |                               |              |
    |                               |              | kernel.terminate
    |                               |              v
    |                               |     +------------------+
    |                               |     | Event Emitter    |
    |                               |     | (structured log) |
    |                               |     +--------+---------+
    |                               |              |
    |                               |              | JSON to stdout
    +---------+                     +--------------+-------------+
              |                                    |
              |                                    v
              |                            +-------+--------+
              |                            | Datadog Agent   |
              |                            | (log collector) |
              |                            +-------+--------+
              |                                    |
              |                          +---------+---------+
              |                          |                   |
              |                          v                   v
              |                   +------+------+    +------+------+
              |                   | Datadog Logs|    | ClickHouse  |
              |                   | (real-time  |    | (analytics  |
              |                   |  debugging) |    |  queries)   |
              |                   +-------------+    +------+------+
              |                                            |
              |                                            v
              |                                    +-------+--------+
              |                                    | Data Team       |
              |                                    | Dashboards      |
              |                                    | (per-client     |
              |                                    |  performance)   |
              |                                    +----------------+
              |
              |   Webhook from 12go
              |   ==================
              |
    12go      |                     B2B Proxy Service
    ------    |                     -----------------
    |         |                     |
    | POST /notifications           |     +------------------+
    | ----------------------------> | --> | Webhook Handler   |
    |                               |     | (validate, log)  |
    |                               |     +--------+---------+
    |                               |              |
    |                               |     +--------+---------+
    |                               |     | Transform to     |
    |                               |     | client format    |
    |                               |     +--------+---------+
    |                               |              |
    |                               |     +--------+---------+
    |                               |     | Forward to       |
    |                               |     | client webhook   |
    |                               |     +--------+---------+
    |                               |              |
    |                               |     +--------+---------+
    |                               |     | Emit event:      |
    |                               |     | b2b.notification |
    |                               |     | .received        |
    |                               |     +------------------+
    |                               |
```

### Data Flow Summary

1. **Request path**: Client -> Proxy -> 12go -> Proxy -> Client (synchronous, latency-critical)
2. **Event path**: Proxy -> stdout JSON -> Datadog Agent -> Datadog Logs + ClickHouse (asynchronous, after response)
3. **Webhook path**: 12go -> Proxy -> validate -> transform -> forward to client + emit event (synchronous to 12go, async to client and event)
4. **Query path**: Data team -> ClickHouse -> dashboards (per-client searches, bookings, conversions)

---

## Security (required)

### Webhook Authentication: Key Finding #10

**The vulnerability**: 12go's webhook notifications to the booking-notification-service have zero authentication. The OneTwoGo `INotificationAuthenticator` is a no-op (`ValueTask.CompletedTask`). Anyone who discovers the webhook URL can inject false booking status change events.

**From a data integrity perspective**, this is not just a security issue -- it is an **event pipeline contamination vector**. A false webhook triggers:
1. A `SupplierReservationChanged` event
2. Which triggers a status fetch from 12go
3. Which publishes a `ReservationChanged` event
4. Which enters the analytics pipeline

While step 2 (fetching from 12go) acts as a partial safeguard -- the actual status comes from 12go, not the attacker -- the attacker can still:
- Cause unnecessary load on the 12go API (fetch booking details for every injected webhook)
- Trigger false notification forwarding to clients if the booking genuinely exists
- Pollute event streams with spurious `notification.received` events

### Recommended Defense: IP Allowlist + HMAC Signature (defense in depth)

**Layer 1: IP Allowlist (minimum viable, implement first)**

- 12go's outbound webhook requests originate from a known set of EC2 instances
- Configure the proxy to reject webhook POSTs from IPs not on the allowlist
- Implementation: Symfony firewall rule or middleware IP check
- Trade-off: Simple, zero coordination with 12go. Breaks if 12go's IP range changes (mitigated by DevOps notification process).

**Layer 2: HMAC Signature Verification (implement when 12go supports it)**

- 12go includes an `X-Webhook-Signature` header: `HMAC-SHA256(shared_secret, request_body)`
- Proxy verifies signature before processing
- Trade-off: Requires 12go to modify their webhook sender. Not available today. Should be requested as part of the transition.

**Layer 3: Request Validation (implement immediately)**

- Validate that `bid` in the webhook body corresponds to a booking that was created through B2B (not a random 12go booking ID)
- Optionally: maintain a lightweight in-memory set of known B2B booking IDs (populated on CreateBooking/ConfirmBooking)
- Trade-off: Adds a lookup per webhook but prevents processing of bookings that are not ours.

**Recommendation**: Implement Layer 1 (IP allowlist) and Layer 3 (bid validation) immediately. Request Layer 2 (HMAC) from 12go engineering as a P2 item.

### API Key Security

- 12go API keys are passed as query parameters (`?k=<api-key>`), which means they appear in access logs and URL traces
- The proxy should sanitize `k=` parameters from any logs or events it emits
- Event schemas must NEVER include API keys

---

## Data Team Requirements (what needs to be defined before implementation)

The following items MUST be resolved with the data team before the event schema is finalized. These are blocking questions, not nice-to-haves.

### 1. Which Events Feed the Performance Dashboard?

The performance dashboard (referenced by Shauly, Mar 12) shows per-client: searches, itineraries, checkouts, percentages, historical graphs. We need to know:
- Which Kafka topics does it consume?
- What fields does it require?
- Can it be modified to consume from Datadog Logs/ClickHouse instead of Kafka?

### 2. Does the T-Rex Project Already Cover Booking Events?

T-Rex consolidates data from all subsidiaries and may already ingest 12go's internal booking events. If so, some of our B2B events are redundant from the data team's perspective. We need confirmation:
- Does T-Rex have booking data from 12go?
- What is the data team's source of truth for booking analytics -- T-Rex or TC Kafka?

### 3. Event Schema Review

The event schemas proposed in this design should be reviewed by the data team for:
- Missing fields they need
- Field naming conventions they require (snake_case vs camelCase)
- ClickHouse table schema compatibility

### 4. ClickHouse Ingestion Pipeline

How do events currently reach ClickHouse? Options:
- Kafka -> ClickHouse Kafka engine table (likely current approach)
- Datadog Logs -> ClickHouse (via Datadog log forwarding)
- Direct write from a pipeline service

We need to know the current pipeline to design the new one.

### 5. Historical Data

When the .NET services are decommissioned, historical events in Kafka will expire (based on retention policy). Does the data team need a historical snapshot? If so, the migration plan must include a data export step.

### Unresolved Action Item

RnD was assigned (Feb 25 meeting) to "send list of event requirements from data side." This has not been delivered as of Mar 17. This is a blocking dependency for finalizing the event design. The data team call referenced in the Mar 12 meeting has also not occurred.

---

## Unconventional Idea (optional)

### Considered: ClickHouse Materialized Views as the Event Consumer

Instead of building a traditional event pipeline (Kafka -> consumer -> ClickHouse), use ClickHouse's `Kafka` table engine with materialized views to transform and store events directly:

```sql
-- ClickHouse Kafka engine table
CREATE TABLE b2b_events_kafka (
    event_type String,
    correlation_id String,
    client_id String,
    timestamp DateTime64(3),
    data String  -- JSON blob
) ENGINE = Kafka
SETTINGS kafka_broker_list = 'kafka:9092',
         kafka_topic_list = 'b2b.events',
         kafka_group_name = 'clickhouse_b2b',
         kafka_format = 'JSONEachRow';

-- Materialized view auto-inserts into analytics table
CREATE MATERIALIZED VIEW b2b_events_mv TO b2b_events_analytics AS
SELECT
    event_type,
    correlation_id,
    client_id,
    timestamp,
    JSONExtractFloat(data, 'performance', 'total_latency_ms') as latency_ms,
    JSONExtractInt(data, 'response', 'result_count') as result_count
FROM b2b_events_kafka;
```

**Why considered**: Zero consumer code. ClickHouse reads directly from Kafka and transforms on ingest. The data team defines their own materialized views without needing the service team to change anything.

**Why NOT pursued (for now)**: Requires Kafka as the event transport (our recommendation is structured logs for Phase 1). However, this is the natural upgrade path if/when we add a Kafka producer. The event schema is designed to be compatible with ClickHouse's `JSONEachRow` format.

**Verdict**: Deferred. If the data team prefers Kafka-based ingestion, this pattern eliminates the need for any custom consumer code. File this under "Phase 2 optimization."

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

1. **Event coverage parity**: Every booking funnel step that currently emits an event continues to emit an equivalent event. The data team does not lose visibility.

2. **Solo developer velocity**: Structured logs require zero infrastructure setup. Event emission is a logging call, not a distributed systems integration. A single developer can implement this in days, not weeks.

3. **Correlation traceability**: Every event carries a `correlation_id` that links back to the client request and forward to 12go's logs. The data team can trace a user journey end-to-end.

4. **Incremental upgrade path**: Start with structured logs, add Kafka when needed. The event schema is the invariant; the transport is swappable.

5. **12go infrastructure alignment**: Uses Datadog (already running), Monolog (already configured), and 12go's existing log collection pipeline. No new moving parts.

### Sacrifices

1. **Event delivery guarantees**: Structured logs can be dropped under extreme load. This is acceptable for analytics but not for transactional systems. If the data team needs guaranteed delivery, this design must be upgraded to Kafka.

2. **Real-time event processing**: Log pipeline latency is minutes, not seconds. If any consumer needs sub-second event delivery, Kafka is required.

3. **Backward compatibility with existing Kafka topics**: The new event schema (`b2b.*`) is incompatible with the old .NET topic names (`Denali.Booking.Messages.*`). Any existing consumers of the old topics will need to be migrated or a bridge topic created. Per management clarification, most consumers are already eliminated ("no trip lake, no data team consuming directly"), but this must be verified.

4. **Multi-supplier extensibility**: The event schema is designed for a single supplier (12go). If B2B ever needs to support multiple suppliers again, the schema would need `supplier_id` fields. This is not a current requirement.

5. **Full distributed tracing**: We get correlation IDs in our events and in 12go's logs, but not a unified trace span tree. True distributed tracing across the proxy-to-12go boundary requires 12go to adopt OpenTelemetry, which is not on their roadmap.
