# Data Flow Architect Design

## Event Audit: What Currently Exists

The current .NET architecture produces a substantial event landscape across four Kafka-producing services. This audit categorizes every known event by source, destination, criticality for the transition, and whether it must be preserved.

### Booking Lifecycle Events (Denali booking-service)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `CheckoutRequested` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- data team performance dashboard | Yes -- re-emitted as structured event |
| `CheckoutResponded` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- performance dashboard (itinerary counts, pricing, latency) | Yes -- re-emitted as structured event |
| `CheckoutFailed` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- failure rate tracking | Yes -- re-emitted as structured event |
| `BookingSchemaRequested` | booking-service (SiFacade) | Kafka (analytics consumers) | MEDIUM -- funnel tracking | Yes |
| `BookingSchemaResponded` | booking-service (SiFacade) | Kafka (analytics consumers) | MEDIUM -- funnel tracking | Yes |
| `BookingSchemaFailed` | booking-service (SiFacade) | Kafka (analytics consumers) | MEDIUM -- failure diagnosis | Yes |
| `BookRequested` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- booking funnel metrics | Yes |
| `BookSucceeded` | booking-service (SiFacade) | Kafka (analytics consumers) | **CRITICAL** -- revenue tracking, booking confirmation | Yes |
| `BookFailed` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- failure rate, lost revenue | Yes |
| `BookingEntityToPersist` | booking-service (SiFacade) | Kafka -> post-booking-service | LOW -- internal persistence, eliminated with no-local-DB design | No -- dropped |
| `ReservationConfirmationRequested` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- confirmation funnel | Yes |
| `ReservationConfirmationSucceeded` | booking-service (SiFacade) | Kafka (analytics + possibly 12go) | **CRITICAL** -- booking reconciliation, revenue | Yes |
| `ReservationConfirmationFailed` | booking-service (SiFacade) | Kafka (analytics consumers) | **HIGH** -- failure diagnosis | Yes |
| `SoldOutItinerariesIdentified` | booking-service (SiFacade) | Kafka (analytics consumers) | LOW -- trip lake downstream no longer exists | No -- dropped |

### Post-Booking Events (Denali post-booking-service)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `ReservationChanged` | post-booking-service | Kafka (possibly 12go, possibly Carmel notification service) | **HIGH** -- booking status tracking, client notifications | Yes -- re-emitted |
| `CancelRequested` | post-booking-service | Kafka (analytics) | **HIGH** -- cancellation tracking | Yes |
| `CancelFailed` | post-booking-service | Kafka (analytics) | MEDIUM -- failure diagnosis | Yes |
| `ReservationConfirmationSucceeded` (background worker) | post-booking-service | Kafka (persistence restore path) | LOW -- internal, eliminated with no-local-DB | No -- dropped |
| `ReservationConfirmationFailed` (background worker) | post-booking-service | Kafka (persistence path) | LOW -- internal | No -- dropped |

### Notification Events (Denali booking-notification-service)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `SupplierReservationChanged` | booking-notification-service | Kafka -> post-booking-service | **HIGH** -- webhook-to-internal event bridge | Replaced -- webhook handler directly processes and forwards |

### Search Telemetry Events (Etna)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `SearchRequested` | Etna Search (ApiReporting) | Kafka (analytics) | **HIGH** -- data team performance dashboard (per-client searches) | Yes -- re-emitted |
| `SearchItineraryResponded` | Etna Search (ApiReporting) | Kafka (analytics) | **HIGH** -- performance dashboard (per-client itineraries) | Yes -- re-emitted |
| `SearchItinerariesBlocked` | Etna Search (ApiReporting) | Kafka (analytics) | LOW -- MediatR pipeline specific, no equivalent in proxy | No -- dropped |
| `SearchItineraryBlocked` | Etna Search (ApiReporting) | Kafka (analytics) | LOW -- same | No -- dropped |
| `SearchOperatorHealthBlocked` | Etna Search (ApiReporting) | Kafka (analytics) | LOW -- operator health pipeline specific | No -- dropped |
| `SearchOnlineScoringRequested` | Etna Search (ApiReporting) | Kafka (analytics) | LOW -- scoring pipeline specific | No -- dropped |
| `PotentialMissingRoute` | Etna Search (ApiReporting) | Kafka (analytics) | LOW -- route discovery specific | No -- dropped |
| `IntegrationIncompleteResultsReturned` | Etna Search (ApiReporting) | Kafka (analytics) | MEDIUM -- could be useful but specific to multi-supplier | No -- dropped |

### Supplier Integration Events (Etna SI)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `SupplierItineraryFetched` | Etna SI (KafkaBackgroundPublisher) | Kafka -> data writers (DynamoDB) | LOW -- no trip lake exists | No -- dropped |
| `ItinerariesRequestedFromIntegration` | Etna SI | Kafka | LOW -- multi-supplier specific | No -- dropped |
| `NoResultsFoundWithSupplier` | Etna SI | Kafka | LOW | No -- dropped |
| `RequestFailed` | Etna SI | Kafka | LOW -- multi-supplier specific | No -- dropped |
| `SupplierQuotaExceeded` | Etna SI | Kafka | LOW | No -- dropped |
| `RouteNotMappedToIntegration` | Etna SI | Kafka | LOW | No -- dropped |
| `RouteNotMappedToTConnect` | Etna SI | Kafka | LOW | No -- dropped |

### Content Management Events (Fuji)

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `StationReceived` | Fuji SI | Kafka -> Lambda functions | OUT OF SCOPE -- Fuji pipeline separate | N/A |
| `OperatingCarrierReceived` | Fuji SI | Kafka -> Lambda functions | OUT OF SCOPE | N/A |
| `POIReceived` | Fuji SI | Kafka -> Lambda functions | OUT OF SCOPE | N/A |
| `SeatClass` | Fuji SI | Kafka -> Lambda functions | OUT OF SCOPE | N/A |
| `SynchronizeRequested` | Fuji Synchronizer | Kafka -> Lambda functions | OUT OF SCOPE | N/A |

### Integration Settings Events

| Event | Source | Destination | Criticality | Preserved in new design? |
|---|---|---|---|---|
| `IntegrationCreated` | SI Settings API | Kafka -> booking-notification-service | LOW -- internal config sync, eliminated | No -- dropped |

### Summary

- **Total events identified**: 35+ distinct event types
- **Must preserve (HIGH/CRITICAL)**: 14 events covering the booking funnel, search telemetry, and cancellation tracking
- **Can drop**: 21+ events related to internal persistence, multi-supplier abstraction, trip lake, and content management
- **Out of scope**: 5 Fuji content pipeline events

### Unknown / Requires Investigation

1. **Does 12go consume `ReservationConfirmationSucceeded` or `ReservationChanged` from our Kafka cluster?** The messaging doc marks this as "needs verification." If yes, the new system must continue producing to these topics during transition, or 12go must be redirected.
2. **Does the "Carmel" notification service consume `ReservationChanged`?** A `Carmel.Booking.Notification.Messages.ReservationChanged` event class exists in external packages but no consuming service was found in the explored repos.
3. **What exactly does the data team T-Rex project ingest?** May already have direct 12go data feeds. Call with data team is pending.
4. **Which Grafana dashboards depend on which Kafka event data?** Dashboard JSON is not in any repo; managed directly in Grafana.

---

## What Gets Lost in a Naive Proxy Replacement

If we replace the .NET services with a simple HTTP proxy (request in, transform, forward to 12go, transform response, return), **every single event in the table above stops being emitted.** This is the central data risk of the transition.

### Specific losses

1. **Performance dashboards go dark.** The data team performance dashboard (per-client searches, itineraries, checkouts, percentages, historical graphs) is populated from `SearchRequested`, `SearchItineraryResponded`, `CheckoutRequested`, `CheckoutResponded`, `BookRequested`, `BookSucceeded`, and `ReservationConfirmationSucceeded` events. All of these disappear.

2. **Booking funnel visibility vanishes.** Today the team can trace: checkout requested -> checkout succeeded/failed -> booking schema requested -> reserve requested -> reserve succeeded/failed -> confirm requested -> confirm succeeded/failed. A proxy emits none of this by default.

3. **Cancellation tracking disappears.** `CancelRequested`, `CancelFailed`, `ReservationChanged` events that track booking status changes and cancellation outcomes would no longer exist.

4. **Client-level metrics cease.** The .NET services tag every metric and event with `client_id`, `integration_id`, and `contract_code`. 12go's DogStatsD metrics have none of these dimensions. Per-client visibility is completely lost.

5. **Correlation ID chain breaks.** The .NET services propagate `x-correlation-id` through OpenTelemetry traces. 12go does not propagate W3C TraceContext headers. Cross-boundary trace correlation dies.

6. **Custom metrics for operational alerts stop.** All `connect.*` Grafana metrics (booking.confirmation.requested/completed/failed, reservation.requested/completed/failed, ticket.creation.*, cancel.booking.*, etc.) stop being emitted. Any Grafana alerts built on these fire continuously.

### What 12go already emits (partial coverage)

12go's platform emits:
- DogStatsD metrics prefixed `f3.` (timer for controller execution, counters for legacy F2 requests and integration API calls) -- but with no `client_id`, `booking_id`, or `contract_code` dimensions
- Datadog APM traces with `agent_id`, `agent_name`, `integration` labels -- partial overlap but different format
- MongoDB API logs with `cust_id`, `bid`, `trip_id` -- useful for audit but not streaming analytics
- Monolog structured logs to GELF/Graylog

**12go does NOT emit** booking funnel events (checkout, reserve, confirm, cancel) as discrete Kafka events with the dimensions the data team expects. The gap is real and large.

---

## Event Design for the New System

### Per-Endpoint Event Specification

Every client-facing endpoint emits at least one structured event. Events follow a standard envelope (see Event Schema Standard below) and carry the full context needed for analytics and debugging.

#### 1. Search (`GET /v1/{client_id}/itineraries`)

**Event**: `b2b.search.completed`

```json
{
  "event_type": "b2b.search.completed",
  "timestamp": "2026-04-15T10:23:45.123Z",
  "correlation_id": "abc-123-def",
  "client_id": "bookaway",
  "api_key_hash": "sha256:first8chars",
  "endpoint": "search",
  "request": {
    "from_station": "12345p",
    "to_station": "67890p",
    "date": "2026-05-01",
    "seats": 2
  },
  "response": {
    "status_code": 200,
    "result_count": 15,
    "trip_ids": ["t1", "t2", "t3"],
    "operators": ["op1", "op2"],
    "has_recheck": true,
    "recheck_count": 3
  },
  "timing": {
    "total_ms": 342,
    "upstream_ms": 310,
    "transform_ms": 32
  },
  "error": null
}
```

**On failure**: Same envelope with `error` populated (`error_code`, `error_message`, `upstream_status_code`), `response.result_count` = 0.

#### 2. GetItinerary (`GET /{client_id}/itineraries/{id}`)

**Event**: `b2b.checkout.completed` (maps to the existing `CheckoutRequested`/`CheckoutResponded` pair)

```json
{
  "event_type": "b2b.checkout.completed",
  "correlation_id": "...",
  "client_id": "...",
  "itinerary_id": "trip-123-2026-05-01-08-00-00",
  "seat_count": 2,
  "response": {
    "status_code": 200,
    "from_station_id": 12345,
    "to_station_id": 67890,
    "departure": "2026-05-01T08:00:00",
    "gross_price": "45.00",
    "net_price": "40.00",
    "currency": "THB",
    "booking_token": "cart-abc123",
    "operator_id": 42,
    "has_seat_map": true,
    "schema_field_count": 12
  },
  "timing": {
    "total_ms": 890,
    "trip_details_ms": 200,
    "add_to_cart_ms": 350,
    "checkout_schema_ms": 340
  }
}
```

#### 3. CreateBooking (`POST /{client_id}/bookings`)

**Event**: `b2b.booking.reserved`

```json
{
  "event_type": "b2b.booking.reserved",
  "correlation_id": "...",
  "client_id": "bookaway",
  "booking_id": "12345678",
  "twelvego_bid": 12345678,
  "itinerary_id": "trip-123-2026-05-01-08-00-00",
  "request": {
    "seat_count": 2,
    "passenger_count": 2,
    "has_selected_seats": true,
    "has_baggage": false
  },
  "response": {
    "status_code": 200,
    "booking_status": "PendingClientConfirmation",
    "from_station_id": 12345,
    "to_station_id": 67890,
    "departure": "2026-05-01T08:00:00",
    "gross_price": "45.00",
    "net_price": "40.00",
    "currency": "THB"
  },
  "timing": {
    "total_ms": 1200,
    "reserve_ms": 800,
    "get_details_ms": 400
  }
}
```

**On failure**: `b2b.booking.reserve_failed` with `error.code` (e.g., `"trip_unavailable"`, `"validation_error"`, `"upstream_500"`).

#### 4. ConfirmBooking (`POST /{client_id}/bookings/{id}/confirm`)

**Event**: `b2b.booking.confirmed`

```json
{
  "event_type": "b2b.booking.confirmed",
  "correlation_id": "...",
  "client_id": "bookaway",
  "booking_id": "12345678",
  "twelvego_bid": 12345678,
  "response": {
    "status_code": 200,
    "booking_status": "Confirmed",
    "confirmation_type": "Instant",
    "ticket_url": "https://...",
    "gross_price": "45.00",
    "net_price": "40.00",
    "currency": "THB"
  },
  "timing": {
    "total_ms": 950,
    "confirm_ms": 600,
    "get_details_ms": 350
  }
}
```

#### 5. SeatLock (`POST /{client_id}/bookings/lock_seats`)

**Event**: `b2b.seat_lock.completed` -- emitted once 12go endpoint is available.

#### 6. GetBookingDetails (`GET /{client_id}/bookings/{id}`)

**Event**: `b2b.booking.details_fetched` -- lightweight event (client_id, booking_id, status_code, latency).

#### 7. GetTicket (`GET /{client_id}/bookings/{id}/ticket`)

**Event**: `b2b.ticket.fetched` -- (client_id, booking_id, ticket_type, status_code, latency).

#### 8. CancelBooking (`POST /{client_id}/bookings/{id}/cancel`)

**Event**: `b2b.booking.cancelled`

```json
{
  "event_type": "b2b.booking.cancelled",
  "correlation_id": "...",
  "client_id": "bookaway",
  "booking_id": "12345678",
  "twelvego_bid": 12345678,
  "response": {
    "status_code": 200,
    "refund_amount": "40.00",
    "refund_currency": "THB",
    "refund_success": true,
    "delay_minutes": 0
  },
  "timing": {
    "total_ms": 800,
    "refund_options_ms": 300,
    "refund_ms": 500
  }
}
```

#### 9. IncompleteResults (`GET /{client_id}/incomplete_results/{id}`)

**Event**: `b2b.incomplete_results.polled` -- lightweight.

#### 10-12. Stations/Operators/POIs

**Event**: `b2b.static_data.served` -- (client_id, data_type, status_code, latency). Low priority; these are S3 URL redirects.

#### 13. Booking Notifications (webhook from 12go)

**Event**: `b2b.notification.received` and `b2b.notification.forwarded`

```json
{
  "event_type": "b2b.notification.received",
  "correlation_id": "auto-generated",
  "source_ip": "1.2.3.4",
  "twelvego_bid": 12345678,
  "notification_type": "booking_updated",
  "client_id": "bookaway",
  "authenticated": false,
  "ip_allowlisted": true
}
```

```json
{
  "event_type": "b2b.notification.forwarded",
  "correlation_id": "...",
  "twelvego_bid": 12345678,
  "client_id": "bookaway",
  "target_url": "https://client-webhook.example.com/...",
  "delivery_status_code": 200,
  "delivery_latency_ms": 150,
  "transform_applied": true
}
```

### Event Schema Standard

All events follow a common envelope:

```json
{
  "event_type": "b2b.<domain>.<action>",
  "event_version": "1.0",
  "timestamp": "ISO 8601 with milliseconds",
  "correlation_id": "from x-correlation-id header or auto-generated UUID",
  "trace_id": "OpenTelemetry trace ID if available",
  "client_id": "extracted from URL path",
  "environment": "prod|preprod|staging",
  "service": "b2b-proxy",
  "service_version": "1.2.3",

  "request": { },
  "response": { },
  "timing": { },
  "error": null | { "code": "...", "message": "...", "upstream_status": 500 }
}
```

Conventions:
- All monetary values are strings (consistent with the existing API contract)
- All IDs are strings
- Timestamps are ISO 8601 UTC
- `timing` always includes `total_ms` and per-upstream-call breakdowns
- `error` is null on success, populated on failure

---

## Correlation ID Strategy (end-to-end)

### The Chain

```
Client -> [x-correlation-id header] -> B2B Proxy -> [?correlation_id=...] -> 12go -> ClickHouse
                                          |
                                          v
                                    Structured Event
                                    (correlation_id field)
                                          |
                                          v
                                    ClickHouse / Datadog
```

### Implementation

1. **Client sends `x-correlation-id`**: Already part of the API contract. The proxy reads this header on every request.

2. **Proxy generates if missing**: If no `x-correlation-id` is provided, the proxy generates a UUID v4 and uses it for the request lifecycle.

3. **Propagation to 12go**: 12go does NOT support W3C TraceContext headers. The proxy cannot inject a `traceparent` header and expect 12go to propagate it through its internal systems. Two mitigation strategies:

   **Strategy A (recommended)**: Append `correlation_id` as a custom query parameter or header to 12go API calls. Even if 12go ignores it, it will appear in 12go's access logs and MongoDB `apilog` (which logs full request URLs and headers). This enables post-hoc correlation: search ClickHouse for `correlation_id=X`, then search 12go's logs for the same string in the URL.

   **Strategy B (requires 12go cooperation)**: Ask 12go to read and propagate a custom header (e.g., `X-B2B-Correlation-Id`) through their Datadog APM spans. This is the ideal but requires engineering effort from the 12go team.

4. **All structured events carry the correlation ID**: Every event emitted by the proxy includes `correlation_id`. ClickHouse queries can filter by this field.

5. **Datadog traces**: If the proxy uses Datadog APM (which it should, since it will run on 12go infrastructure), the `correlation_id` is added as a span tag. Datadog's trace search can then find all spans for a given correlation ID.

6. **ClickHouse traceability**: Events in ClickHouse are queryable by `correlation_id`, `client_id`, `booking_id`, and `twelvego_bid`. A single query can reconstruct the full funnel: search -> checkout -> reserve -> confirm -> cancel.

### Limitation

The correlation chain is broken inside 12go. We can correlate client request -> proxy event -> 12go API call (by URL pattern matching in logs), but we cannot trace through 12go's internal processing (MariaDB queries, Redis lookups, integration calls). This is acceptable for B2B analytics purposes but means debugging 12go-internal issues still requires 12go team involvement.

---

## Event Emission Architecture

### Option A: Kafka Producer

**How it works**: The proxy service has a Kafka producer client. After handling each HTTP request, it asynchronously publishes a structured event to a Kafka topic (e.g., `b2b.events`).

**Pros**:
- Durable event delivery -- events survive proxy restarts
- Kafka is already part of 12go's infrastructure (used for business events)
- ClickHouse can consume directly from Kafka using the Kafka table engine
- Decouples event production from consumption -- data team can add new consumers
- Supports exactly-once semantics if needed (Kafka transactions)

**Cons**:
- Requires Kafka client library in the proxy service
- Adds Kafka cluster as a runtime dependency -- if Kafka is down, what happens? (fire-and-forget means events could be lost)
- For a solo developer, configuring and debugging Kafka producer issues adds operational burden
- PHP's Kafka support (`php-rdkafka`) works but is less ergonomic than Go's `confluent-kafka-go` or .NET's `Confluent.Kafka`
- Must not block the HTTP response path -- requires async/background emission

**Kafka topic design**:
- Single topic `b2b.events` with `event_type` as a message header for routing
- Partitioned by `client_id` for per-client ordering
- JSON serialization (consistent with existing Denali events)

### Option B: Structured Logs Pipeline

**How it works**: The proxy emits structured JSON log lines to stdout/stderr. Datadog Agent (already running on 12go infrastructure) collects these logs, indexes them, and can forward them to ClickHouse via a log-to-metrics pipeline or Datadog's log forwarding feature.

**Pros**:
- Zero additional infrastructure -- Datadog Agent is already there
- Simplest implementation: `logger.info(json_encode($event))`
- No new runtime dependency beyond the logger
- Works in every language equally well
- Events are immediately searchable in Datadog Log Explorer
- Solo developer can implement this in hours, not days

**Cons**:
- Not durable in the Kafka sense -- if the log pipeline drops events, they are gone
- Datadog -> ClickHouse pipeline has latency (minutes, not seconds)
- Log volume affects Datadog ingestion costs
- Structured logs are not "events" in the Kafka consumer sense -- no replay, no consumer groups, no exactly-once
- Data team cannot attach arbitrary consumers to a log stream the way they can to a Kafka topic

### Option C: Direct ClickHouse Write

**How it works**: The proxy uses a ClickHouse client library to INSERT events directly into a ClickHouse table after each request.

**Pros**:
- Lowest latency to analytics -- events appear in ClickHouse immediately
- No intermediate systems
- ClickHouse is already on 12go infrastructure

**Cons**:
- Tight coupling to ClickHouse schema and availability
- If ClickHouse is down or slow, it affects the HTTP response path (unless writes are buffered/async)
- Solo developer must manage ClickHouse schema migrations
- No event replay capability
- Other consumers (Datadog, alerting) cannot access the events without reading ClickHouse
- PHP's ClickHouse client libraries exist but are less mature than Kafka or logging libraries

### Recommendation: Option B (Structured Logs) as primary, with Kafka as a future upgrade path

**Rationale for a solo developer building under Q2 deadline**:

1. **Structured logs are the fastest to implement correctly.** Every framework has logging. Datadog Agent is already deployed on 12go's infrastructure. The implementation is a `log()` call with a JSON payload -- no new infrastructure, no new dependencies, no new failure modes.

2. **Datadog provides immediate visibility.** Events are searchable in Datadog Log Explorer within seconds. The team can build dashboards, set alerts, and investigate issues using a tool they already have access to.

3. **ClickHouse ingestion from Datadog is a configuration task, not a development task.** Datadog's log forwarding to external destinations (including ClickHouse via HTTP or Kafka) can be configured by the DevOps team without code changes.

4. **Kafka can be added later without changing the event schema.** If the data team needs Kafka-based event consumption, the same structured event JSON can be published to Kafka in addition to logging. The event schema is the same either way. This is an additive change, not a rewrite.

5. **The critical constraint is solo developer velocity.** Kafka producer configuration, error handling, monitoring, and debugging is real operational work. For a proxy service that must ship in Q2, the simplest event emission path that provides adequate coverage wins.

**Implementation pattern**:

```
HTTP Request -> Process -> Emit HTTP Response
                    |
                    +---> [async/non-blocking] -> logger.info(structured_event_json)
                                                       |
                                                       v
                                               Datadog Agent (already deployed)
                                                       |
                                               +-------+-------+
                                               |               |
                                        Datadog Logs     ClickHouse
                                        (search/alert)   (analytics, via
                                                          log forwarding)
```

**Upgrade path to Kafka**: If the data team later requires Kafka-based consumption:
1. Add a Kafka producer to the proxy service
2. Publish the same JSON event to a `b2b.events` topic
3. Keep the structured log emission as a backup/debug channel
4. ClickHouse switches from Datadog log forwarding to Kafka table engine

This is a 1-2 day change, not an architectural rewrite.

---

## Language and Framework (evaluated for event emission)

The language choice is constrained by three factors: solo developer, Q2 deadline, and 12go infrastructure alignment. I evaluate each candidate through the lens of event emission and observability.

### PHP 8.3 (Symfony)

**Kafka**: `php-rdkafka` extension wraps librdkafka. Functional but requires PECL extension installation. Not pure PHP -- adds build complexity. KafkaFlow-equivalent does not exist; must manage producer lifecycle manually.

**Structured logging**: Monolog is excellent. JSON formatter, multiple handlers, channel-based routing. Datadog integration via existing Monolog -> GELF pipeline. Adding a structured event log channel is trivial.

**Async event emission**: PHP's request lifecycle is synchronous by default. Options: (a) emit after response via `kernel.terminate` Symfony event (does not block response), (b) use `register_shutdown_function`, (c) fire-and-forget via a message queue. Option (a) is clean and well-supported in Symfony.

**Datadog APM**: `datadog/dd-trace` already deployed on 12go infrastructure. Automatic instrumentation for HTTP, database, and Redis. Adding custom span tags (`client_id`, `booking_id`) is a single `addLabel()` call.

**Verdict**: Adequate for structured logs approach. Monolog + `kernel.terminate` provides non-blocking event emission with zero new infrastructure. Kafka is possible but adds build complexity.

### Go

**Kafka**: `confluent-kafka-go` is the gold standard Kafka client. Async producer with delivery reports, zero external dependency beyond librdkafka (statically linked). Best-in-class for Kafka-based event emission.

**Structured logging**: `slog` (stdlib since 1.21) or `zerolog`/`zap`. JSON output to stdout, picked up by Datadog Agent. Excellent structured logging support.

**Async event emission**: Goroutines make fire-and-forget trivial. `go emitEvent(ctx, event)` does not block the HTTP response. Buffered channels provide backpressure if needed.

**Datadog APM**: `dd-trace-go` provides auto-instrumentation for HTTP handlers, gRPC, SQL, Redis. Mature.

**Verdict**: Best technical choice for event emission. But Go is not the team's language, 12go infrastructure is PHP-native, and solo developer ramp-up is a cost.

### .NET 8

**Kafka**: `Confluent.Kafka` is mature and well-supported. The team already uses it extensively via `Connect.Framework.Kafka`. KafkaFlow provides higher-level abstractions.

**Structured logging**: `Microsoft.Extensions.Logging` with `LoggerMessage` source generators. OTLP export via `Connect.Infra.Observability`. Excellent.

**Async event emission**: `Task.Run` fire-and-forget (used today in Denali's `SiFacade.PublishMessage`). Background channels with `BackgroundService` consumers. Well-understood pattern.

**Datadog APM**: OpenTelemetry SDK + Datadog exporter. Or Datadog's .NET tracer (`dd-trace-dotnet`). Both work.

**Verdict**: Best fit for the developer's expertise. But runs counter to "one system" vision and 12go infrastructure alignment.

### Assessment for this design

The structured logs approach works equally well in all three languages. The language choice should be driven by team and organizational constraints (see system-context.md), not event emission capabilities. If PHP is chosen (monolith path), Monolog + `kernel.terminate` is the right pattern. If .NET (microservice path), `ILogger` + `BackgroundService` channel. If Go, `slog` + goroutine.

---

## Architecture Diagram (data flow, not just HTTP flow)

```
                                    ┌─────────────────────────────────────┐
                                    │         B2B Proxy Service           │
                                    │                                     │
  Client ──[HTTP]──> API Gateway ──>│  1. Authenticate (clientId + key)   │
           x-correlation-id         │  2. Transform request               │
           x-api-key                │  3. Call 12go API(s)                │
           Travelier-Version        │  4. Transform response              │
                                    │  5. Return HTTP response            │
                                    │                                     │
                                    │  [async, non-blocking]              │
                                    │  6. Emit structured event (log)     │
                                    │  7. Increment Datadog metric        │
                                    └──────┬──────────┬──────────┬────────┘
                                           │          │          │
                                    ┌──────┘     ┌────┘     ┌────┘
                                    │            │          │
                                    v            v          v
                              ┌──────────┐ ┌─────────┐ ┌──────────────┐
                              │ 12go API │ │ Datadog │ │ Datadog Agent│
                              │ (HTTP)   │ │   APM   │ │ (log collect)│
                              └────┬─────┘ └────┬────┘ └──────┬───────┘
                                   │            │             │
                                   v            v             v
                              ┌──────────┐ ┌─────────┐ ┌──────────────┐
                              │ MariaDB  │ │ Datadog │ │ Datadog Logs │
                              │ Redis    │ │ Traces  │ │              │
                              │ 12go     │ │ Metrics │ │  -> Forward  │
                              │ internal │ │         │ │  to ClickHse │
                              └──────────┘ └─────────┘ └──────┬───────┘
                                                              │
                                                              v
                                                        ┌──────────────┐
                                                        │  ClickHouse  │
                                                        │  (analytics) │
                                                        └──────────────┘


  12go ──[webhook]──> B2B Proxy ──> Transform ──> Forward to client
                         │
                         v
                   Structured event:
                   b2b.notification.received
                   b2b.notification.forwarded
```

### Data flow paths

1. **Client request path**: Client -> API Gateway -> B2B Proxy -> 12go API -> response transformation -> Client. Synchronous, latency-sensitive.

2. **Event emission path**: After HTTP response is sent (or via `kernel.terminate`/background task), structured JSON event is logged. Datadog Agent picks it up from stdout/log file. Asynchronous, not latency-sensitive.

3. **Metrics path**: Datadog APM auto-instrumentation captures HTTP timing. Custom metrics (`DogStatsD::increment`) track business dimensions. These flow to Datadog metrics backend.

4. **Analytics path**: Structured log events are forwarded from Datadog Logs to ClickHouse. Data team queries ClickHouse for dashboards and analysis.

5. **Webhook path**: 12go sends webhook -> B2B Proxy receives -> validates (IP allowlist) -> transforms format -> forwards to client URL -> emits notification events.

---

## Migration Strategy

### Client Transition Approach

**Recommended: Transparent switch with per-client rollout.**

Clients continue calling the same API Gateway endpoints. The gateway is reconfigured (by DevOps) to route traffic to the new B2B Proxy instead of the .NET services. From the client's perspective, nothing changes -- same URL, same headers, same response format.

**Event continuity implication**: During per-client rollout, some clients hit the old .NET services (which emit old Kafka events) and some hit the new proxy (which emits structured log events). The data team must be prepared to ingest from both sources during the transition window. The structured log events should carry the same semantic meaning as the Kafka events they replace, even though the format and transport differ.

**Dual-write window**: During migration, both old events (from .NET services for unmigrated clients) and new events (from proxy for migrated clients) flow into the analytics pipeline. ClickHouse queries must union both sources. A `source` field in the new events (`source: "b2b-proxy"` vs the implicit old `.NET` source) enables disambiguation.

### Authentication Bridge

The proxy maintains a `client_id -> 12go_api_key` mapping table (loaded from database or config at startup, consistent with 12go's existing `ApiAgent` SDK pattern). When a request arrives:

1. API Gateway validates `x-api-key` (existing behavior)
2. Proxy extracts `client_id` from URL path
3. Proxy looks up the corresponding 12go API key
4. Proxy appends `?k=<12go_api_key>` to upstream 12go API calls

**Event implication**: Every event carries both `client_id` (from the URL) and can be joined with the 12go `agent_id` in 12go's internal logs. The auth mapping table itself should emit a `b2b.auth.key_resolved` event at debug level for troubleshooting authentication issues during migration.

### Per-Client Rollout Mechanism

**Recommended approach**: Lambda authorizer or gateway-level routing configuration that can be toggled per `client_id`.

Two options for per-client routing:

1. **Lambda authorizer approach**: A Lambda function at the API Gateway inspects the `client_id` path parameter and routes to the new proxy or old .NET service based on a configuration map (DynamoDB table or environment variable). This is the most flexible but requires DevOps to implement the Lambda.

2. **Duplicate gateway stage approach**: Create a second API Gateway stage pointing to the new proxy. Migrate clients by updating their base URL. Simpler but requires client-side changes.

**Event continuity during per-client migration**: The proxy should emit events from day one for every client it handles. There should be no gap between "old service stops emitting events for client X" and "new proxy starts emitting events for client X." If using the Lambda authorizer approach, the switch is instantaneous: the Lambda routes client X's next request to the new proxy, which immediately emits structured events.

**Avoiding duplicate events**: During the switch moment, a client's in-flight request might be processed by the old service while the next request goes to the new proxy. This is acceptable -- a few duplicate events at the boundary are tolerable for analytics. The `correlation_id` deduplication in ClickHouse queries can handle this.

### In-Flight Booking Safety

**Scenario**: Client has called `CreateBooking` on the old system (getting a Denali-format booking ID) but has not yet called `ConfirmBooking`. During this window, the system is switched to the new proxy.

**Handling**: The new proxy receives a `ConfirmBooking` request with a Denali-format booking ID. It must:

1. Detect the ID format (KLV-encoded with `0102V1` prefix, or short 10-character Base62)
2. For KLV IDs: decode to extract the embedded 12go `bid` (field key 04)
3. For short IDs: look up the static mapping table (old booking ID -> 12go `bid`)
4. Call 12go's `/confirm/{bid}` endpoint with the extracted 12go booking ID

**Event implication**: The event for this confirm operation carries both the original Denali booking ID (as `legacy_booking_id`) and the resolved 12go `bid` (as `twelvego_bid`). This dual-ID event enables the data team to correlate old and new booking ID formats in their analytics.

### Webhook/Notification Transition

**Current flow**: 12go webhook -> booking-notification-service -> Kafka `SupplierReservationChanged` -> post-booking-service -> DB update -> Kafka `ReservationChanged` -> (unknown downstream consumer, possibly Carmel).

**New flow**: 12go webhook -> B2B Proxy notification endpoint -> transform format -> forward to client URL (embedded in webhook config as `?client_id=X`).

**Transition approach**:
1. Register the new proxy's webhook URL in 12go's webhook subscriber table
2. For each client being migrated, update the webhook URL to point to the new proxy
3. The new proxy handles format transformation (12go `bid` -> client-expected `booking_id`)
4. For old bookings: translate `bid` back to Denali booking ID format using the static mapping table
5. For new bookings: use `bid` directly as the booking ID

**Preventing duplicate notifications**: During the transition, only one webhook URL should be registered per booking in 12go's system. When a client is migrated to the new proxy, the webhook URL is updated in 12go's subscriber table. There is no dual-delivery because 12go sends each notification to exactly one URL.

**Event implication**: Both `b2b.notification.received` and `b2b.notification.forwarded` events are emitted, creating an audit trail of every webhook received and every client delivery attempted.

### Validation Plan

**Phase 1: Search validation (shadow traffic)**
- Deploy proxy alongside old services
- Mirror search traffic to both old and new services
- Compare responses field-by-field (automated diff)
- Compare events: old Kafka `SearchRequested`/`SearchItineraryResponded` vs new `b2b.search.completed`
- Validate that the new event carries all fields the data team needs

**Phase 2: Booking funnel validation (contract tests)**
- Write contract tests that call the proxy with known inputs and verify output format
- Verify that events emitted for `CreateBooking`, `ConfirmBooking`, `CancelBooking` contain the required fields
- Test with both KLV and short booking IDs to validate the legacy ID resolution path

**Phase 3: Notification validation (canary)**
- Register the proxy's webhook endpoint for a test client in 12go
- Trigger a booking status change
- Verify the notification is received, transformed, and forwarded correctly
- Verify `b2b.notification.received` and `b2b.notification.forwarded` events appear in Datadog

**Phase 4: Per-client canary rollout**
- Migrate the lowest-traffic client first
- Monitor structured events in Datadog for 24-48 hours
- Compare per-client metrics (search count, booking count, error rate) against historical baseline from old Kafka events
- If metrics match within acceptable tolerance, migrate next client
- Continue until all clients are on the new proxy

**Event validation at each stage**: At every phase, the data team should confirm that their ClickHouse queries and dashboards produce equivalent results from the new event stream as from the old Kafka events.

---

## Security (required)

### Webhook Authentication (Key Finding #10)

The current system has **zero authentication** on the 12go webhook endpoint. The `NotificationAuthenticator` for OneTwoGo is a no-op (`ValueTask.CompletedTask`). Any caller that can reach `POST /v1/notifications/OneTwoGo` can trigger a booking status refresh for any `bid`.

From a data integrity perspective, this is an injection point for false events. An attacker could:
- Send fake `bid` values, causing the system to emit `b2b.notification.received` events for nonexistent bookings
- Flood the endpoint, generating noise in the event pipeline
- Trigger unnecessary 12go API calls (the current system fetches booking details from 12go on every webhook)

**Minimum viable security (recommended: IP allowlist + request validation)**:

**Layer 1: IP allowlist** (low effort, high impact)
- Configure the proxy or API Gateway to only accept webhook requests from known 12go IP ranges
- 12go's infrastructure is managed by DevOps; their outbound IP ranges are knowable
- This blocks the most obvious attack vector: arbitrary internet callers
- Trade-off: IP ranges may change; requires DevOps coordination to update

**Layer 2: Request validation** (medium effort, medium impact)
- Validate that the `bid` in the webhook payload corresponds to a booking that was actually made through the B2B system
- After receiving the webhook, call 12go's `GET /booking/{bid}` to verify the booking exists and belongs to a known client
- If the booking does not exist or belongs to an unknown client, drop the event and log a security warning
- Trade-off: adds an API call per webhook, but webhooks are low-volume compared to searches

**Layer 3: HMAC signature verification** (ideal but requires 12go cooperation)
- 12go signs the webhook payload with a shared secret using HMAC-SHA256
- Proxy verifies the signature before processing
- This is the industry standard (Stripe, GitHub, Shopify all use this pattern)
- Trade-off: requires 12go to implement HMAC signing in their webhook dispatch code. This is not under our control and has no timeline

**Recommendation**: Implement Layer 1 (IP allowlist) immediately and Layer 2 (request validation) as part of the proxy implementation. Request Layer 3 (HMAC) from 12go as a longer-term improvement.

**Event pipeline protection**: Even with authentication, the proxy should emit `b2b.notification.received` events with an `authenticated` boolean field. This enables the data team to filter out any unvalidated notifications from analytics if the IP allowlist is breached.

---

## Data Team Requirements (what needs to be defined before implementation)

The following must be resolved in the pending call with the data team before implementation begins:

1. **Event field requirements**: Which fields does each dashboard/report require? The event schemas proposed above are based on what the current Kafka events carry, but the data team may need more or fewer fields.

2. **ClickHouse table schema**: Does the data team want to define the ClickHouse table schema, or should the proxy team define it and the data team adapt?

3. **Ingestion method preference**: Is Datadog log forwarding to ClickHouse acceptable, or does the data team require direct Kafka consumption? This determines whether Option B (structured logs) or Option A (Kafka) is needed.

4. **Historical data continuity**: How will the data team handle the transition period where old events come from Kafka (Denali .NET services) and new events come from structured logs (proxy)? Do they need a unified view, or can they accept two data sources?

5. **T-Rex project overlap**: Does the T-Rex project (which consolidates data from all subsidiaries) already ingest 12go data directly? If so, which events are already covered and which are genuinely missing?

6. **Latency requirements**: Is minutes-scale latency (structured logs -> Datadog -> ClickHouse) acceptable, or do they need seconds-scale latency (Kafka -> ClickHouse Kafka engine)?

7. **Retention requirements**: How long must events be retained in ClickHouse? This affects table design and storage planning.

8. **Required monitoring dimensions**: The Team Lead specified: client, operator, action, outcome, bookingId, itineraryId, traceId. Are there additional dimensions the data team requires?

9. **Cross-boundary topics verification**: Does 12go consume any of our current Kafka topics (`ReservationConfirmationSucceeded`, `ReservationChanged`)? If yes, must the new proxy continue producing to these topics?

---

## Unconventional Idea (optional)

### Considered: ClickHouse Materialized Views as the Event Bus

Instead of Kafka or structured logs, use ClickHouse itself as the event storage and processing layer:
- Proxy writes raw events to a ClickHouse "raw_events" table (append-only, MergeTree engine)
- ClickHouse Materialized Views automatically aggregate events into summary tables (per-client daily searches, booking conversion rates, etc.)
- Dashboards query the materialized views, not the raw events
- No Kafka, no Datadog log forwarding, no intermediate systems

**Why I rejected it**: ClickHouse is an analytics database, not an event bus. It has no consumer group concept, no replay, no push-based notification. If anyone besides the data team needs to react to events (alerts, real-time dashboards, external consumers), ClickHouse cannot serve that need. It also creates tight coupling between the proxy and ClickHouse's availability. For a solo developer, having the proxy depend on ClickHouse's uptime for event emission is an unacceptable operational risk.

The structured logs approach provides the same analytical capability (events reach ClickHouse) while also serving operational needs (events are searchable in Datadog, alertable, and independent of ClickHouse's availability).

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for

- **Solo developer velocity**: Structured logs are the fastest event emission mechanism to implement correctly. No new infrastructure, no new dependencies.
- **Event coverage completeness**: Every endpoint emits a structured event. No silent operations.
- **Gradual migration safety**: Per-client rollout with event continuity at every stage.
- **Data team continuity**: The 14 critical events from the current system are preserved in semantically equivalent form, even if the transport changes from Kafka to structured logs.
- **Operational visibility from day one**: Events are searchable in Datadog immediately. No waiting for Kafka consumers or ClickHouse pipelines to be built.
- **Future upgrade path**: The event schema is transport-agnostic. Adding Kafka later requires adding a producer, not redesigning events.

### Sacrifices

- **Kafka-native event consumption**: If the data team has existing Kafka consumers that process booking events, they cannot reuse those consumers against structured logs. They must either (a) wait for the Kafka upgrade path, or (b) switch to ClickHouse/Datadog-based analytics.
- **Exactly-once event delivery**: Structured logs provide at-most-once delivery (if the log line is written, Datadog will eventually ingest it; if the process crashes before logging, the event is lost). Kafka with transactions provides exactly-once. For analytics events, at-most-once is acceptable.
- **Real-time streaming**: Structured logs have minutes-scale latency to ClickHouse. Kafka -> ClickHouse Kafka engine provides seconds-scale. For dashboards refreshed hourly or daily, this does not matter. For real-time alerting, Datadog's native log-based alerting fills the gap.
- **12go-internal trace correlation**: Without 12go adopting W3C TraceContext or a custom correlation header, we cannot trace requests through 12go's internal systems. We accept this limitation and mitigate it by appending correlation IDs to upstream URLs for post-hoc log matching.
- **Cross-boundary Kafka topic production**: If 12go or Carmel currently consumes `ReservationConfirmationSucceeded` or `ReservationChanged` from our Kafka cluster, the new proxy does not produce to those topics. This must be verified and, if confirmed, a Kafka producer must be added for those specific topics during the transition period.
