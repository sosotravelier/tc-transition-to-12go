# Data Flow Architect Design

## Event Audit: What Currently Exists

The current .NET architecture emits events through three channels: Kafka topics, structured logs (via OpenTelemetry to Coralogix), and custom metrics (via OTLP to Grafana). The event landscape is extensive -- at least 25 distinct Kafka event types across four producing services, plus 40+ custom metric instruments and structured log streams.

### Kafka Events

| Event | Source | Topic | Destination | Criticality | Preserved? |
|---|---|---|---|---|---|
| CheckoutRequested | Denali booking-service | `Denali.Booking.Messages.CheckoutRequested` | Analytics / ClickHouse (via data team) | HIGH -- feeds performance dashboard | YES |
| CheckoutResponded | Denali booking-service | `Denali.Booking.Messages.CheckoutResponded` | Analytics / ClickHouse | HIGH -- pricing, conversion tracking | YES |
| CheckoutFailed | Denali booking-service | `Denali.Booking.Messages.CheckoutFailed` | Analytics / ClickHouse | HIGH -- failure analysis | YES |
| BookingSchemaRequested | Denali booking-service | `Denali.Booking.Messages.BookingSchemaRequested` | Analytics | MEDIUM | YES (merged into booking funnel event) |
| BookingSchemaResponded | Denali booking-service | `Denali.Booking.Messages.BookingSchemaResponded` | Analytics | MEDIUM | YES (merged) |
| BookingSchemaFailed | Denali booking-service | `Denali.Booking.Messages.BookingSchemaFailed` | Analytics | MEDIUM | YES (merged) |
| BookRequested | Denali booking-service | `Denali.Booking.Messages.BookRequested` | Analytics / ClickHouse | HIGH -- booking funnel | YES |
| BookSucceeded | Denali booking-service | `Denali.Booking.Messages.BookSucceeded` | Analytics / ClickHouse | HIGH -- revenue tracking | YES |
| BookFailed | Denali booking-service | `Denali.Booking.Messages.BookFailed` | Analytics / ClickHouse | HIGH -- failure analysis | YES |
| BookingEntityToPersist | Denali booking-service | `Denali.Booking.Messages.BookingEntityToPersist` | Denali post-booking-service (DB persist) | DROP -- no local DB | NO |
| ReservationConfirmationRequested | Denali booking-service | `Denali.Booking.Messages.ReservationConfirmationRequested` | Analytics | HIGH | YES |
| ReservationConfirmationSucceeded | Denali booking-service / post-booking-service | `Denali.Booking.Messages.ReservationConfirmationSucceeded` | Analytics / possibly 12go reconciliation | HIGH | YES |
| ReservationConfirmationFailed | Denali booking-service / post-booking-service | `Denali.Booking.Messages.ReservationConfirmationFailed` | Analytics | HIGH | YES |
| SoldOutItinerariesIdentified | Denali booking-service / Etna SI | `Etna.Messages.supply.SoldOutItinerariesIdentified` | Availability tracking | LOW -- no trip lake | NO |
| ReservationChanged | Denali post-booking-service | `Denali.Booking.Messages.ReservationChanged` | Analytics / possibly 12go | HIGH -- status tracking | YES |
| CancelRequested | Denali post-booking-service | `Denali.Booking.Messages.CancelRequested` | Analytics | HIGH | YES |
| CancelFailed | Denali post-booking-service | `Denali.Booking.Messages.CancelFailed` | Analytics | HIGH | YES |
| SupplierReservationChanged | Denali booking-notification-service | `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged` | Denali post-booking-service | DROP -- internal plumbing only | NO (replaced by direct handling) |
| SearchRequested | Etna Search | `Etna.Messages.SearchRequested` | Analytics / ClickHouse | HIGH -- search volume tracking | YES |
| SearchItineraryResponded | Etna Search | `Etna.Messages.SearchItineraryResponded` | Analytics | MEDIUM | YES (merged into search event) |
| SearchItinerariesBlocked | Etna Search | `Etna.Messages.SearchItinerariesBlocked` | Analytics | LOW -- no distribution rules | NO |
| SearchOperatorHealthBlocked | Etna Search | `Etna.Messages.SearchOperatorHealthBlocked` | Analytics | LOW -- no operator health | NO |
| SupplierItineraryFetched | Etna SI | `Etna.Messages.supply.SupplierItineraryFetched` | Availability/routes writers | DROP -- no trip lake | NO |
| Other Etna SI events (7 types) | Etna SI | Various | Data writers | DROP -- no trip lake | NO |
| StationReceived / OperatorReceived / POIReceived | Fuji | Various | Entity mapping Lambdas | OUT OF SCOPE | N/A |
| IntegrationCreated | SI Settings | `Si.Integrations.Settings.Messages.IntegrationCreated` | Notification service cache | DROP -- no SI framework | NO |

### Structured Logs (to Coralogix via OTLP)

| Log Category | Source | Destination | Criticality |
|---|---|---|---|
| Booking funnel structured logs | All Denali services | Coralogix | HIGH -- operational debugging |
| HTTP client request/response logs | Denali (HttpResponseLoggerMiddleware) | Coralogix | MEDIUM -- debugging 12go API issues |
| Search pipeline logs | Etna | Coralogix | LOW -- pipeline being eliminated |

### Custom Metrics (to Grafana via OTLP)

| Meter | Service | Key Metrics | Criticality |
|---|---|---|---|
| `connect.denali.booking.si.host` | Denali booking | reservation/confirmation/schema counters by client_id, integration_id | HIGH |
| `connect.denali.booking.si.facade` | Denali booking | price mismatch, incomplete confirmation | MEDIUM |
| `connect.denali.post.booking.si.host` | Denali post-booking | ticket/cancel/get-details counters by client_id | HIGH |
| `connect.Denali.BookingNotificationService` | Notification service | Dynamic notification counters | MEDIUM |
| `connect.etna.api.observability` | Etna search API | search.returned.empty by client_id | HIGH |
| `connect.etna.searchengine.Observability` | Etna search engine | Route reduction, cache metrics | LOW -- engine being eliminated |
| `connect.etna.search.supplier-integration` | Etna SI | HTTP durations, itinerary success/failure | LOW -- SI being eliminated |
| `connect.supplier-integration` | SI abstractions | itineraries processed | LOW -- SI being eliminated |

### Performance Dashboard (data team)

Per Mar 12 meeting, a performance dashboard exists showing per-client: searches, itineraries, checkouts, percentages, historical graphs. This dashboard is populated from search and checkout Kafka events and must be preserved.

### Unknown / Needs Investigation

1. **Which Kafka topics does 12go consume from our services?** The messaging doc flags `ReservationConfirmationSucceeded` and `ReservationChanged` as possibly consumed by 12go for reconciliation. This must be verified before any events are dropped.
2. **What events does 12go already emit to ClickHouse?** 12go uses Kafka internally (MySQL binlog CDC). Some TC event requirements may already be covered. The data team call (action item from Feb 25 meeting assigned to RnD) has not yet happened.
3. **What Grafana dashboards and alerts depend on current metric names?** Dashboards live outside the application repos (in Grafana directly). No inventory exists.
4. **Does the T-Rex project already ingest 12go data?** If so, some analytics continuity may already exist without B2B-specific events.

---

## What Gets Lost in a Naive Proxy Replacement

If we replace the .NET services with a simple HTTP proxy that forwards requests to 12go and transforms responses, the following disappear with zero replacement:

### Critical Losses

1. **Booking funnel analytics** -- The entire checkout-to-confirmation event pipeline (13 event types from Denali booking-service) stops. The performance dashboard loses all data. The data team loses visibility into conversion rates, failure modes, and pricing trends.

2. **Search telemetry** -- `SearchRequested` and `SearchItineraryResponded` events stop. Per-client search volume tracking disappears. The `search.returned.empty` metric (by client_id) vanishes.

3. **Per-client attribution** -- Every metric and event currently carries `client_id`, `integration_id`, and `contract_code` as dimensions. 12go's internal events do not carry TC's `client_id`. Even if 12go emits equivalent business events, they cannot be correlated to TC clients without explicit instrumentation.

4. **Distributed trace continuity** -- The .NET services propagate W3C TraceContext through OpenTelemetry. 12go does not use OpenTelemetry. Traces will terminate at the proxy boundary unless the proxy explicitly creates and maintains spans.

5. **Notification event chain** -- `SupplierReservationChanged` -> `ReservationChanged` event chain stops. While this is internal plumbing, `ReservationChanged` may be consumed by 12go for reconciliation (unverified).

### Acceptable Losses

1. **Trip lake events** -- `SupplierItineraryFetched`, availability/routes writers. Confirmed redundant (no trip lake).
2. **Multi-supplier events** -- All SI framework events for non-12go integrations. Being sunset.
3. **DynamoDB persistence events** -- `BookingEntityToPersist`, restore handlers. No local DB.
4. **Fuji content pipeline** -- Out of scope for this transition.
5. **Search engine internals** -- Route reduction, cache metrics, plan overrides. Pipeline being eliminated.

### The Feb 25 Finding

The meeting explicitly flagged: "Sunsetting SI Host would lose the ability to correlate supply-side and client-side events." This is precisely the risk. SI Host is where client requests get mapped to supplier calls, and the correlation between "client X searched for route A" and "12go returned N results in T milliseconds" currently lives in the event pipeline. A proxy that does not emit events loses this correlation entirely.

---

## Event Design for the New System

### Per-Endpoint Event Specification

Every client-facing endpoint must emit a structured event. Events are emitted asynchronously after the HTTP response is sent (or concurrently with response building) to avoid blocking the response path.

#### 1. Search (`GET /v1/{client_id}/itineraries`)

**Event: `b2b.search.completed`**

```json
{
  "event_type": "b2b.search.completed",
  "timestamp": "2026-04-15T10:23:45.123Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "from_station_id": 1234,
  "to_station_id": 5678,
  "departure_date": "2026-05-01",
  "seat_count": 2,
  "result_count": 15,
  "bookable_count": 12,
  "recheck_count": 3,
  "trip_ids": ["trip_001", "trip_002"],
  "operators": [101, 205],
  "latency_ms": 342,
  "twelvego_latency_ms": 298,
  "http_status": 200,
  "error_code": null,
  "api_version": "2025-01-15"
}
```

#### 2. GetItinerary (`GET /{client_id}/itineraries/{id}`)

**Event: `b2b.checkout.completed`** (replaces CheckoutRequested + CheckoutResponded/Failed)

```json
{
  "event_type": "b2b.checkout.completed",
  "timestamp": "2026-04-15T10:24:12.456Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "itinerary_id": "KLV-12go-trip123",
  "seat_count": 2,
  "from_station": "Bangkok Morchit",
  "to_station": "Chiang Mai Arcade",
  "departure": "2026-05-01T08:00:00",
  "gross_price": "14.60",
  "net_price": "12.50",
  "currency": "USD",
  "booking_token": "encrypted_token",
  "latency_ms": 1240,
  "twelvego_calls": [
    {"endpoint": "trip_details", "latency_ms": 320, "status": 200},
    {"endpoint": "add_to_cart", "latency_ms": 410, "status": 200},
    {"endpoint": "checkout_schema", "latency_ms": 510, "status": 200}
  ],
  "http_status": 200,
  "error_code": null,
  "success": true
}
```

#### 3. CreateBooking (`POST /{client_id}/bookings`)

**Event: `b2b.booking.reserved`**

```json
{
  "event_type": "b2b.booking.reserved",
  "timestamp": "2026-04-15T10:25:33.789Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "booking_id": "B-12345",
  "twelvego_bid": 98765,
  "itinerary_id": "KLV-12go-trip123",
  "from_station_id": 1234,
  "to_station_id": 5678,
  "departure": "2026-05-01T08:00:00",
  "seat_count": 2,
  "gross_price": "29.20",
  "net_price": "25.00",
  "currency": "USD",
  "status": "PendingClientConfirmation",
  "latency_ms": 890,
  "success": true,
  "error_code": null
}
```

#### 4. ConfirmBooking (`POST /{client_id}/bookings/{id}/confirm`)

**Event: `b2b.booking.confirmed`**

```json
{
  "event_type": "b2b.booking.confirmed",
  "timestamp": "2026-04-15T10:26:01.012Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "booking_id": "B-12345",
  "twelvego_bid": 98765,
  "from_station_id": 1234,
  "to_station_id": 5678,
  "departure": "2026-05-01T08:00:00",
  "seat_count": 2,
  "status": "Confirmed",
  "confirmation_type": "Instant",
  "gross_price": "29.20",
  "net_price": "25.00",
  "currency": "USD",
  "operator_ids": [101],
  "latency_ms": 650,
  "success": true
}
```

#### 5. SeatLock (`POST /{client_id}/bookings/lock_seats`)

**Event: `b2b.seatlock.requested`** -- minimal until 12go endpoint is available.

#### 6. GetBookingDetails (`GET /{client_id}/bookings/{id}`)

**Event: `b2b.booking_details.fetched`**

```json
{
  "event_type": "b2b.booking_details.fetched",
  "timestamp": "2026-04-15T10:27:00.000Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "booking_id": "B-12345",
  "twelvego_bid": 98765,
  "status": "Confirmed",
  "latency_ms": 120,
  "success": true
}
```

#### 7. GetTicket (`GET /{client_id}/bookings/{id}/ticket`)

**Event: `b2b.ticket.fetched`** -- fields: correlation_id, client_id, booking_id, twelvego_bid, ticket_type, latency_ms, success.

#### 8. CancelBooking (`POST /{client_id}/bookings/{id}/cancel`)

**Event: `b2b.booking.cancelled`**

```json
{
  "event_type": "b2b.booking.cancelled",
  "timestamp": "2026-04-15T10:28:00.000Z",
  "correlation_id": "abc-123-def",
  "client_id": "comport_acme",
  "booking_id": "B-12345",
  "twelvego_bid": 98765,
  "refund_amount": "25.00",
  "refund_currency": "USD",
  "refund_hash": "abc123",
  "latency_ms": 890,
  "success": true,
  "error_code": null
}
```

#### 9. IncompleteResults (`GET /{client_id}/incomplete_results/{id}`)

**Event: `b2b.incomplete_results.polled`** -- fields: correlation_id, client_id, request_id, status, latency_ms.

#### 10-12. Stations / Operators / POIs

**Event: `b2b.static_data.fetched`** -- fields: correlation_id, client_id, data_type (stations/operators/pois), latency_ms. Low-criticality events; mainly for access pattern monitoring.

#### 13. Booking Notifications (webhook from 12go)

**Event: `b2b.notification.received`**

```json
{
  "event_type": "b2b.notification.received",
  "timestamp": "2026-04-15T10:30:00.000Z",
  "correlation_id": "auto-generated-uuid",
  "twelvego_bid": 98765,
  "client_id": "comport_acme",
  "source_ip": "203.0.113.42",
  "authenticated": true,
  "forwarded_to_client": true,
  "client_webhook_status": 200,
  "latency_ms": 340
}
```

**Event: `b2b.notification.forwarded`** -- emitted after the notification is transformed and sent to the client's webhook endpoint. Fields: correlation_id, client_id, twelvego_bid, client_webhook_url, response_status, latency_ms, retry_count.

### Event Schema Standard

All events share a common envelope:

```json
{
  "event_type": "b2b.<domain>.<action>",
  "event_version": "1.0",
  "timestamp": "ISO-8601 with milliseconds",
  "correlation_id": "UUID from x-correlation-id header or auto-generated",
  "client_id": "string -- TC client identifier",
  "service": "b2b-proxy",
  "environment": "prod|preprod|staging",

  "...domain-specific fields..."
}
```

Naming convention: `b2b.{domain}.{past_tense_verb}` -- events describe something that happened, not something being requested.

All monetary amounts are strings to match the API contract convention and avoid floating-point issues.

---

## Correlation ID Strategy (end-to-end)

### Current State

The .NET services use OpenTelemetry's W3C TraceContext for distributed tracing. `x-correlation-id` and `x-request-id` headers are read and propagated. `Activity.Current.TraceId` becomes the `Flow` identifier used across services.

### The 12go Gap

12go does not use OpenTelemetry. They use Datadog APM (`dd-trace`) which uses its own trace ID format. There is no evidence that 12go propagates W3C `traceparent`/`tracestate` headers or respects `x-correlation-id`.

### Strategy

The correlation ID flows through four boundaries:

```
Client -> [x-correlation-id header] -> B2B Proxy -> [?] -> 12go API -> [internal] -> ClickHouse
```

**Boundary 1: Client to B2B Proxy**
- Accept `x-correlation-id` from client request headers (existing contract).
- If absent, generate a UUID v4.
- This becomes the primary correlation ID for all logs, events, and metrics for this request.

**Boundary 2: B2B Proxy to 12go API**
- 12go does not support arbitrary header forwarding for correlation. The API key is a query parameter; there is no documented header-based correlation mechanism.
- **Approach**: Pass correlation ID as a custom header (`X-B2B-Correlation-Id`) on all outbound requests to 12go. Even if 12go ignores it, Datadog APM may capture it as a request header tag. This costs nothing and may become useful if 12go later adds support.
- **Fallback**: Log the 12go request/response pair with the correlation ID on our side. If a 12go trace is needed, use the timestamp + booking ID to locate it in Datadog.
- **For bookings specifically**: The 12go `bid` (booking ID) serves as a natural cross-system correlation key. All B2B events include `twelvego_bid` alongside `correlation_id`. ClickHouse queries can join on `twelvego_bid` to correlate with any 12go-side events.

**Boundary 3: B2B Proxy to Event Pipeline**
- Every emitted event carries `correlation_id`.
- Every log line carries `correlation_id` as a structured field.
- Every Datadog APM span carries `correlation_id` as a tag.

**Boundary 4: Event Pipeline to ClickHouse**
- `correlation_id` is a column in every ClickHouse event table.
- `twelvego_bid` is an indexed column for cross-system joins.
- `client_id` is a partition key for per-client analytics.

### Practical Trace Lookup

To trace a client request end-to-end:
1. Client provides `x-correlation-id: abc-123`
2. Search Datadog/logs for `correlation_id=abc-123` to find all B2B proxy activity
3. From the event, extract `twelvego_bid` or the 12go API request timestamp
4. Search 12go's Datadog for the corresponding booking/request by `bid` or timestamp
5. This is manual, not automatic -- true end-to-end trace correlation requires 12go to propagate trace context, which they do not currently do

---

## Event Emission Architecture

### Option A: Kafka Producer

**How it works**: The B2B proxy service includes a Kafka producer client. After processing each request, it asynchronously publishes a structured event to a Kafka topic.

**Pros**:
- Durable delivery -- events survive service restarts
- Existing Kafka infrastructure on 12go's platform (shared cluster)
- ClickHouse has mature Kafka engine for direct ingestion
- Decouples event production from consumption -- data team can add consumers without proxy changes
- Compatible with existing event consumers if topic names are preserved

**Cons**:
- Requires Kafka client library and configuration in the proxy service
- Adds a runtime dependency -- if Kafka is down, events are lost unless buffered locally
- For a solo developer, Kafka producer configuration (acks, retries, batching, error handling) adds complexity
- PHP's Kafka libraries (php-rdkafka, confluent-kafka-php) are C extensions requiring compilation -- adds deployment friction

**Implementation detail**: Fire-and-forget pattern (same as current Denali). `Task.Run` (or equivalent async dispatch) publishes after response. Producer configured with `acks=1` (leader acknowledgment) for balance between durability and latency.

### Option B: Structured Logs Pipeline

**How it works**: The proxy emits structured JSON log lines for every significant operation. These are shipped by the Datadog agent (already running on 12go infrastructure) to Datadog Logs. From Datadog, logs can be forwarded to ClickHouse via Datadog's log pipeline or a lightweight forwarder.

**Pros**:
- Zero additional infrastructure -- Datadog agent already exists
- Simplest implementation -- just log statements with structured fields
- No additional runtime dependencies beyond logging
- Datadog provides immediate operational visibility (search, dashboards, alerts)
- Solo developer can implement this in hours, not days
- PHP/Symfony has excellent Monolog support with Datadog integration

**Cons**:
- Log pipeline has latency (seconds to minutes, not milliseconds)
- Log volume can be expensive in Datadog pricing
- Datadog-to-ClickHouse pipeline needs to be set up (not free)
- Less durable than Kafka -- if the log agent falls behind, events may be delayed or lost
- Harder for data team to add new consumers (they consume from Datadog, not a topic)

**Implementation detail**: Monolog with a dedicated `b2b_events` channel. JSON formatter with all event fields. Datadog agent picks up from file or stdout. Datadog log pipeline parses and forwards to ClickHouse via a Datadog-to-ClickHouse integration or a custom forwarder Lambda.

### Option C: Direct ClickHouse Write

**How it works**: The proxy writes events directly to ClickHouse tables using the ClickHouse HTTP interface or a native client.

**Pros**:
- Lowest latency for analytics availability
- No intermediate systems
- ClickHouse's columnar storage is ideal for analytics queries

**Cons**:
- Tight coupling -- proxy depends on ClickHouse availability
- ClickHouse write failures would need retry logic in the proxy
- Blocks the HTTP response path unless carefully made async
- Single consumer -- if another system needs the events, you need to add another write path
- Operational risk: a ClickHouse schema change breaks the proxy

### Recommendation

**Option B (Structured Logs Pipeline) for initial deployment, with a migration path to Option A (Kafka) when the data team defines their requirements.**

Rationale:

1. **Solo developer constraint is dominant.** Soso is the only developer. Structured logging is a standard capability that requires no additional infrastructure setup, no Kafka configuration debugging, and no additional deployment dependencies. It can be implemented as part of normal request handling code.

2. **The data team call has not happened yet.** The Feb 25 action item (RnD to send event requirements for ClickHouse) is still outstanding. Designing a Kafka event schema for consumers whose requirements are undefined is speculative. Structured logs capture all the same fields and can be replayed into Kafka topics later.

3. **12go already runs Datadog.** The agent infrastructure exists. Logs flow to Datadog automatically. This is zero-marginal-cost event emission.

4. **Transition path is clean.** Start with structured logs. When the data team defines requirements, add a Kafka producer that emits the same event schema. The log-based events continue in parallel for operational visibility. The Kafka events feed ClickHouse via Kafka engine.

5. **ClickHouse ingestion from Datadog is a solved problem.** Datadog Log Archives can export to S3, which ClickHouse can read. Alternatively, a lightweight Datadog-to-ClickHouse forwarder can be built as a separate concern -- not blocking the proxy development.

**The structured log events MUST use the exact same JSON schema as the future Kafka events.** This is not optional -- it ensures zero migration cost when adding Kafka.

### Hybrid Approach (recommended refinement)

For the three highest-criticality event types -- `b2b.search.completed`, `b2b.booking.reserved`, `b2b.booking.confirmed` -- emit both a structured log AND a Kafka message from day one. This ensures the performance dashboard (the data team's most important artifact) continues to receive data without depending on the Datadog-to-ClickHouse pipeline.

For all other events, structured logs only in v1.

---

## Language and Framework (evaluated for event emission)

### PHP 8.3 / Symfony 6.4

**Kafka**: `php-rdkafka` (C extension wrapping librdkafka). Mature, but requires compilation. PHP's single-threaded request model means Kafka publishing must happen synchronously or via a queue. Symfony Messenger with a Kafka transport is an option but adds complexity.

**Structured logging**: Monolog (already used in F3) with JSON formatter. First-class Datadog support. Trivial to add a `b2b_events` channel with structured fields.

**Async event emission**: PHP does not have native async. Options: (a) `register_shutdown_function` to emit after response is sent, (b) `fastcgi_finish_request()` to flush response then continue processing, (c) Symfony Messenger with async transport. Option (b) is simplest and works with Nginx/PHP-FPM.

**Verdict**: Excellent for structured logs. Adequate for Kafka with `fastcgi_finish_request()`. The F3 monolith already has Monolog and Datadog configured.

### Go

**Kafka**: `confluent-kafka-go` (wraps librdkafka) or `segmentio/kafka-go` (pure Go). Both production-grade. Go's goroutines make async fire-and-forget trivial.

**Structured logging**: `slog` (stdlib since Go 1.21) or `zerolog`/`zap`. All support JSON output. Datadog agent ingests from stdout.

**Async event emission**: Goroutines. Fire-and-forget is a one-liner: `go emitEvent(ctx, event)`. Channel-based buffering is idiomatic.

**Verdict**: Best language for both Kafka and async event emission. Goroutines make non-blocking event dispatch trivial.

### .NET 8

**Kafka**: `Confluent.Kafka` (the same library currently in use). KafkaFlow for higher-level abstractions. The team already has production experience.

**Structured logging**: `Microsoft.Extensions.Logging` with OTLP export. Existing `Connect.Infra.Observability` library handles everything.

**Async event emission**: `Task.Run` (current pattern in Denali). Mature, well-understood.

**Verdict**: Highest team familiarity. Existing patterns can be reused verbatim. But organizational constraint pushes toward PHP.

### Recommendation for Event Emission

If the service is built as a **PHP monolith (inside F3)**: Use Monolog for structured log events. Use `fastcgi_finish_request()` + synchronous Kafka publish for the three critical event types. This is pragmatic and works within PHP's execution model.

If the service is built as a **standalone microservice (any language)**: Use Go with `slog` for structured logs and `confluent-kafka-go` for Kafka events. Goroutines make the event emission pattern trivially non-blocking.

If the service is built in **.NET**: Reuse the existing `Confluent.Kafka` + `Connect.Infra.Observability` patterns. This is the lowest-risk option from an event emission perspective but conflicts with organizational direction.

---

## Architecture Diagram (data flow, not just HTTP flow)

```
                                          OBSERVABILITY PLANE
                                    +---------------------------+
                                    |                           |
                     +----------->  |  Datadog (Logs + APM)     |
                     |              |  - Structured log events   |
                     |              |  - APM traces with spans   |
                     |              |  - Custom metrics          |
                     |              +---------------------------+
                     |                          |
                     |                          | Log Archive / Forwarder
                     |                          v
                     |              +---------------------------+
                     |              |                           |
                     |              |  ClickHouse (Analytics)   |
                     |              |  - b2b_search_events      |
                     |              |  - b2b_booking_events     |
                     |              |  - b2b_notification_events|
                     |              +---------------------------+
                     |                          ^
                     |                          |
                     |              Kafka Engine (for critical events)
                     |                          |
                     |              +---------------------------+
                     |              |                           |
                     |              |  Kafka (shared cluster)   |
                     |              |  - b2b.search.completed   |
                     |              |  - b2b.booking.reserved   |
                     |              |  - b2b.booking.confirmed  |
                     |              +---------------------------+
                     |                          ^
                     |                          |
  +---------+    +---+------+    +---------+    |
  |         |    |          |--->|         |----+
  | Clients |--->| B2B      |    | 12go    |
  |         |<---| Proxy    |<---|  API    |
  |         |    | Service  |    | (F3)    |
  +---------+    +----------+    +---------+
                     |
                     | For each request:
                     | 1. Accept client request
                     | 2. Map client identity
                     | 3. Forward to 12go API
                     | 4. Transform response
                     | 5. Emit structured log event (ALL endpoints)
                     | 6. Emit Kafka event (search, reserve, confirm only)
                     | 7. Return response to client
                     |
                     | For webhook notifications:
                     | 1. Receive 12go webhook
                     | 2. Validate (IP allowlist + HMAC)
                     | 3. Emit b2b.notification.received event
                     | 4. Transform to client format
                     | 5. Forward to client webhook
                     | 6. Emit b2b.notification.forwarded event
```

### Data Flow for a Search Request

```
Client                B2B Proxy               12go API        Kafka        Datadog       ClickHouse
  |                      |                       |              |             |              |
  |--GET /itineraries--->|                       |              |             |              |
  |                      |--GET /search--------->|              |             |              |
  |                      |<--search results------|              |             |              |
  |                      |                       |              |             |              |
  |                      |--[transform response]-|              |             |              |
  |<--200 itineraries----|                       |              |             |              |
  |                      |                       |              |             |              |
  |                      |--[after response]---->|              |             |              |
  |                      |  emit log event       |              |    log      |              |
  |                      |-------------------------------------+--event----->|              |
  |                      |  emit kafka event     |              |             |              |
  |                      |-----------------------------event--->|             |              |
  |                      |                       |              |--ingest---->|              |
  |                      |                       |              |             |--archive---->|
```

---

## Security (required)

### Key Finding #10: Unauthenticated Webhook Endpoint

The current webhook endpoint (`/v1/notifications/OneTwoGo`) has zero authentication. The `INotificationAuthenticator` for OneTwoGo is a no-op (`ValueTask.CompletedTask`). The payload is a simple `{ "bid": <long> }` JSON body. Any attacker who knows the URL pattern can inject fake booking status change notifications, which would:

1. Trigger false `ReservationChanged` events into the analytics pipeline
2. Potentially cause incorrect booking status updates if the downstream handler trusts the notification
3. Pollute ClickHouse analytics data with fabricated events

From a data integrity perspective, this is an injection point for false events into the event pipeline.

### Minimum Viable Security

**Recommendation: IP allowlist as primary defense, with HMAC signature verification as a roadmap item.**

**IP Allowlist (implement immediately)**:
- Configure a list of known 12go IP ranges (their EC2 infrastructure)
- Reject webhook requests from any other source IP at the network/middleware level
- Low implementation cost: a single middleware check or AWS security group rule
- Trade-off: Fragile if 12go's IP ranges change. Requires coordination with 12go DevOps to maintain the list.

**HMAC Signature Verification (implement when 12go supports it)**:
- 12go includes an `X-Webhook-Signature` header containing `HMAC-SHA256(shared_secret, request_body)`
- The B2B proxy verifies the signature before processing
- This is the standard approach (Stripe, GitHub, Shopify all use it)
- Trade-off: Requires 12go to modify their webhook sender. This is a dependency on their engineering team.
- **Current state**: There is no evidence that 12go supports webhook signatures. This would need to be requested.

**Rate limiting (implement immediately)**:
- Limit webhook requests to a reasonable rate (e.g., 100/minute per source IP)
- Prevents flood attacks even if an attacker guesses the URL
- Trivial to implement in any framework

**Payload validation (implement immediately)**:
- Verify that `bid` corresponds to a known booking (call 12go's `/booking/{bid}` API to confirm existence before emitting any event)
- Reject payloads with invalid `bid` values
- Trade-off: Adds latency (one extra API call per notification). But this is the notification path, not the booking path -- latency is acceptable.

### Event Pipeline Protection

The event emitted from webhook processing (`b2b.notification.received`) MUST include the `authenticated` field and the `source_ip` field. Downstream consumers (ClickHouse, dashboards) can filter by authentication status. This ensures that even if a false event slips through, it is tagged and can be identified after the fact.

---

## Data Team Requirements (what needs to be defined before implementation)

The following must be resolved before event schema finalization. These are not optional -- they determine what goes into ClickHouse.

1. **Performance dashboard field requirements**: The existing performance dashboard shows per-client searches, itineraries, checkouts, percentages, historical graphs. What specific fields does it query? The proposed event schema includes all obvious candidates (`client_id`, `result_count`, `latency_ms`, `success`), but the actual ClickHouse queries must be audited.

2. **ClickHouse table schema**: What tables exist today? What columns? The new events need to map to existing or new tables. If the data team is consuming events via Kafka engine, we need the exact topic-to-table mapping.

3. **Event granularity**: The current system emits separate events for `CheckoutRequested` and `CheckoutResponded` (two events per GetItinerary call). The proposed design emits one event (`b2b.checkout.completed`) with success/failure flag. Is this acceptable, or does the data team need separate request/response events?

4. **Historical backfill**: When we switch over, there will be a gap in event data. Does the data team need a backfill mechanism, or is a clean cutover acceptable?

5. **12go event overlap**: Does 12go already emit booking/search events to ClickHouse? If so, the B2B proxy events may be supplementary (adding client_id attribution) rather than the sole source of analytics data.

6. **Cross-system join keys**: The proposed schema uses `twelvego_bid` as the cross-system join key. Does the data team need additional join keys (e.g., trip_id, cart_id)?

7. **Retention requirements**: How long must events be retained in ClickHouse? This affects table partitioning and storage costs.

**Action item (still outstanding from Feb 25)**: RnD was assigned to send event requirements from data side. This has not happened as of Mar 17. This is a blocking dependency for event schema finalization.

---

## Unconventional Idea (optional)

### Considered: ClickHouse Materialized Views as the Event Bus

Rather than Kafka or logs, write raw request/response metadata to a single append-only ClickHouse table (`b2b_request_log`) with every field flattened into columns. Then use ClickHouse materialized views to create derived "event" tables -- one materialized view per event type, with filtering and aggregation built into the view definition.

**Why it was considered**: ClickHouse materialized views are evaluated at insert time and stored physically. This means one write produces multiple "event" tables automatically. It eliminates the need for Kafka topics and separate consumers. The data team can define new "events" by adding materialized views, without any proxy code changes.

**Why it was rejected**:
- Tight coupling: the proxy writes directly to ClickHouse, making it a runtime dependency
- Schema evolution is harder in ClickHouse than in Kafka (no schema registry equivalent)
- The data team has not defined their requirements, so pre-building materialized views is premature
- Solo developer constraint: debugging ClickHouse materialized view issues is a different skill set from building an HTTP proxy

However, this approach could be revisited once the data team defines their requirements. It has the advantage of being entirely within ClickHouse's domain -- the proxy just writes raw logs, and the data team owns all the derived analytics.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

1. **Zero event data loss during transition**: Every client-facing operation emits a structured event from day one. The performance dashboard continues to receive data.

2. **Solo developer velocity**: Structured logs are the primary event channel. No Kafka configuration needed for 10 of 13 endpoints. No new infrastructure to provision.

3. **Schema stability**: Events use a common envelope with domain-specific fields. The schema is designed once and used for both logs and future Kafka messages.

4. **Incremental migration**: Start with logs, add Kafka for critical paths, add direct ClickHouse if needed. Each step is additive, not a rewrite.

5. **Cross-system traceability**: `correlation_id` and `twelvego_bid` provide two independent correlation keys. Even without 12go supporting trace context, bookings can be traced across systems.

### Sacrifices

1. **Real-time analytics**: Structured log pipeline has seconds-to-minutes latency. If the data team needs sub-second event availability, Kafka is required from day one for all event types, not just three.

2. **Backward-compatible topic names**: The current Kafka topics use .NET type names (`Denali.Booking.Messages.CheckoutRequested`). The proposed events use a new naming convention (`b2b.search.completed`). Any consumer expecting the old topic names will break. This is intentional -- the old consumers (trip lake, availability writers) are being retired. But if any unknown consumer exists, this is a risk.

3. **Event granularity**: The proposed design collapses request/response event pairs into single events. This loses the ability to measure time-between-events (e.g., time from `CheckoutRequested` to `CheckoutResponded` is currently two separate events; in the new design, it is one event with a `latency_ms` field). This is arguably better (same data, one event), but it changes the query patterns.

4. **Kafka exactly-once semantics**: The recommended approach (fire-and-forget for structured logs, acks=1 for Kafka) does not guarantee exactly-once delivery. In practice, for analytics events, at-least-once is sufficient and the deduplication cost of exactly-once is not justified.

5. **12go trace integration**: The design accepts that traces terminate at the proxy boundary. True end-to-end distributed tracing would require 12go to adopt OpenTelemetry or at least propagate `traceparent` headers. This is not in scope for the transition.
