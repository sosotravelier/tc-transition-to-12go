# Webhook Routing & Authentication

The current system receives booking status change webhooks from 12go (OneTwoGo) at a single shared HTTP endpoint, bearing only a `{ "bid": <long> }` payload with no authentication token or signature. Once received, the service resolves which internal integration the booking belongs to — using the `bid` (booking ID in 12go's domain) plus the integration label in the URL — then publishes an internal Kafka event. A downstream service picks up that event, looks up the full booking record (which includes `client_id`) in a PostgreSQL database, calls the supplier API to fetch the current booking status, and publishes a second Kafka event (`ReservationChanged`) that carries client and routing context. Forwarding to the client's own webhook endpoint is not handled by any code observed in these repositories; no code stores or resolves a per-client notification URL, and no outbound HTTP delivery to client endpoints is present in either denali or supply-integration. The system therefore terminates at the internal Kafka event with no confirmed mechanism for pushing status updates to client systems.

---

## Current Webhook Flow

### Entry Point

The webhook endpoint is defined in the `Denali.Booking.Notification.Service` host:

- **File:** [booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs), lines 33–36
- **Route templates** (line 34–35):
  - `v{version:apiVersion}/notifications/{integration}`
  - `v{version:apiVersion}/notifications/{integration}/{*path}`
- Defined in [booking-notification-service/host/BookingNotificationService/Routing/RouteTemplate.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/host/BookingNotificationService/Routing/RouteTemplate.cs), lines 8–9.

The `{integration}` path segment is the key that selects the correct handler at runtime. For 12go, the value is `"OneTwoGo"` (see `ProviderConstants.OneTwoGo` in [shared/Denali.Common/Constants/ProviderConstants.cs](https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Constants/ProviderConstants.cs), line 5). The test confirms the full path: `/v1/notifications/OneTwoGo` (`WebhookControllerTests.cs`, line 12).

### Request Dispatch

The controller (`WebhookController.cs`, lines 42–50) resolves three keyed services by the `integration` string:
- `INotificationAuthenticator` — performs (or skips) authentication
- `IPostNotificationHandler` — parses the body and extracts the booking ID
- `INotificationResponseHandler` — shapes the HTTP response

All three are registered for the `"OneTwoGo"` key in [integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/BootstrapExtensions.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/BootstrapExtensions.cs), lines 13–17.

### Payload Parsed

The incoming body is deserialized against:

```csharp
// NotificationRequest.cs, line 13
[JsonPropertyName("bid")]
public long Bid { get; set; }
```

([integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/NotificationRequest.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/NotificationRequest.cs))

The handler returns `NotificationResponse.ProcessedSuccessfully` with `IntegrationBookingId = bid.ToString()` and `IntegrationId = null`, meaning no sub-integration disambiguation is done at this stage (`NotificationHandler.cs`, line 25).

### Internal Kafka Message Published

On success, `WebhookController.PublishMessage` (lines 89–108) publishes a `SupplierReservationChanged` Kafka record:

```csharp
// boostMessages/Denali.Booking.Messages/supplier-integration/SupplierReservationChanged.cs
public readonly record struct SupplierReservationChanged(
    string BookingId,
    string IntegrationId);
```

`BookingId` is set to the raw `bid` string; `IntegrationId` is resolved through `IntegrationsMapper` only when `success.IntegrationId` is non-null (which it is not for 12go). When `IntegrationId` is null, the value falls back to the route segment (`integration`), i.e., `"OneTwoGo"` (`WebhookController.cs`, lines 91–93).

---

## bid → client Resolution

### Stage 1 — booking-notification-service stops at Integration-level

The booking-notification-service does **not** resolve `bid → client_id`. It does not perform any database lookup on the `bid`. The only lookup it can perform is `IntegrationsMapper.MapIntegrationId` (`IntegrationsMapper.cs`, lines 22–33), which maps a `(tmsId, externalIntegrationId)` pair to an internal `IntegrationId`. For the 12go webhook this lookup is skipped because `NotificationHandler` returns `IntegrationId = null`.

The `IntegrationEntities` table (PostgreSQL) that backs this mapper stores:

| Column | Type | Notes |
|---|---|---|
| `Id` | int PK | Auto-generated |
| `IntegrationId` | varchar(50) | Internal integration ID |
| `Name` | text | |
| `TMSId` | varchar(50) | TMS identifier |
| `ExternalIntegrationId` | varchar(50) | 12go-side integration ID |

See [booking-notification-service/persistence/BookingNotificationServicePersistence/Models/IntegrationEntity.cs](https://github.com/boost-platform/denali/blob/main/booking-notification-service/persistence/BookingNotificationServicePersistence/Models/IntegrationEntity.cs) and the migration at `20250727224815_Initialize.cs`, lines 14–28. There is no `client_id`, `notification_url`, or booking-level data in this table.

### Stage 2 — post-booking-service resolves bid → booking record → client_id

`SupplierReservationChangedHandler` ([post-booking-service/host/PostBookingService.Api/Messages/SupplierReservationChangedHandler.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Messages/SupplierReservationChangedHandler.cs), lines 32–36) consumes the Kafka message and calls `ReservationUpdaterService.SendUpdatedReservation`.

`ReservationUpdaterService` (`ReservationUpdaterService.cs`, lines 39–41) performs a PostgreSQL lookup:

```csharp
var booking = await postBookingPersistencyService
    .GetByIntegrationBookingIdAndIntegration(
        reservationDetails.BookingId,    // = bid as string
        reservationDetails.IntegrationId // = "OneTwoGo"
    );
```

The `BookingEntities` table is indexed on `(integration_id, integration_booking_id)` (unique index, `BookingEntity.cs`, line 9). Once the row is found, `booking.ClientId` is available (`BookingEntity.cs`, line 26, column `client_id`).

The `BookingEntities` table (PostgreSQL, post-booking-service) includes:

| Column | Relevant to routing |
|---|---|
| `id` | Encrypted booking ID |
| `plain_id` | Short booking ID |
| `client_id` | The client who owns the booking |
| `integration_id` | e.g., "OneTwoGo" |
| `integration_booking_id` | The 12go `bid` as a string |
| `status` | Current booking status |
| `contract_code` | Contract identifying the distribution channel |

Full schema: [post-booking-service/BookingPersistence/Models/BookingEntity.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/BookingPersistence/Models/BookingEntity.cs).

If no row is found, processing silently returns (line 44). There is no dead-letter queue or alerting.

---

## Client Notification Delivery

After resolving the booking record, `ReservationUpdaterService` calls the supplier API (`postBookingSiHost.GetBookingDetails`) to fetch the current status, updates the DB row, and then publishes a `ReservationChanged` Kafka message:

```csharp
// boostMessages/Denali.Booking.Messages/v1/ReservationChanged.cs
public readonly record struct ReservationChanged(
    BookingId BookingId,
    string IntegrationId,
    string IntegrationBookingId,
    string ContractCode,
    ...
    string ReservationStatus,
    ...);
```

No code in denali or supply-integration was found that consumes `ReservationChanged` and forwards a notification to a per-client HTTP endpoint. The `BookingEntity` model does include `LastBookingNotificationReceivedAt` and `LastBookingNotificationSentToClient` timestamp columns (`BookingEntity.cs`, lines 121–125), indicating the schema was designed with the expectation that outbound client delivery would be tracked, but no service that writes or uses `LastBookingNotificationSentToClient` was found in the explored repos.

There is no per-client notification URL stored anywhere in the explored codebases. The `IntegrationEntity` in supply-integration ([integration_service/api/si.integration.settings.persistance/Models/IntegrationEntity.cs](https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integration.settings.persistance/Models/IntegrationEntity.cs)) and the `SiConfiguration` model (`SiConfiguration.cs`) contain no `notification_url` or client callback fields.

The `Carmel.Booking.Notification.Messages` package (`/Users/sosotughushi/RiderProjects/boostMessages/Carmel.Booking.Notification.Messages/ReservationChanged.cs`) defines a separate `ReservationChanged` event carrying only `BookingId`, suggesting an external notification service ("Carmel") may consume the Kafka stream downstream, but no such service code is present in the explored repositories.

---

## Payload Transformation

No payload transformation for client-facing notification delivery was found in either repository. The `NotificationHandler` for OneTwoGo extracts only the `bid` and discards all other fields that 12go sends in the webhook body (test data shows 12go sends `type`, `stamp`, `new_data`, `previous_data` in addition to `bid` — see `WebhookControllerTests.cs`, lines 32–52). None of those additional fields are parsed or stored.

The `ProcessedSuccessfully` return value carries `NumOfPassengers`, `ReservationStatus`, `CreatedDate`, and `UpdatedDate` all as `null` (`NotificationHandler.cs`, line 25), meaning the current handler intentionally discards any status or timing information in the 12go webhook payload and instead fetches fresh booking details from the 12go API in the subsequent stage.

The `ReservationDetailsMapper` exists in post-booking-service ([post-booking-service/host/PostBookingService.Api/Mappers/ReservationDetailsMapper.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Mappers/ReservationDetailsMapper.cs)) but it maps supplier booking detail responses into internal models, not into per-client outbound payloads.

---

## Authentication Gap

Authentication for the OneTwoGo webhook is explicitly a no-op:

```csharp
// NotificationAuthenticator.cs, line 8
public ValueTask Authenticate(string? relativePath, HttpRequest notification)
    => ValueTask.CompletedTask;
```

([integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/NotificationAuthenticator.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.PostBookingNotifications/NotificationAuthenticator.cs))

The `INotificationAuthenticator` interface ([abstractions/SupplyIntegration/Abstractions/PostBookingNotifications/INotificationAuthenticator.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Abstractions/PostBookingNotifications/INotificationAuthenticator.cs)) specifies that implementations should throw `AuthenticationException` on failure; the OneTwoGo implementation never throws. Any caller that can reach `POST /v1/notifications/OneTwoGo` can trigger a full booking status refresh cycle for any `bid` it supplies.

No API gateway-level authentication (e.g., IP allowlist, shared secret header) for this endpoint was found in the explored code. The `Program.cs` of the booking-notification-service (`Program.cs`, line 173) calls `app.UseAuthorization()` but no authorization policies are applied to the `WebhookController`.

The configuration profile loaded at startup includes a profile named `"SupplierIntegration"` / `"InboundAuth"` (`Program.cs`, lines 56–58):

```csharp
new() { ApplicationId = "SupplierIntegration", ConfigProfileId = "InboundAuth" }
```

This suggests an authentication configuration may be loaded from AWS AppConfig at runtime, but there is no code in the service that reads or enforces that configuration for the OneTwoGo webhook route.

Other integrations (e.g., Distribusion, FlixBus) may implement non-trivial authenticators as keyed services registered under their own integration key, but they are not exercised for the 12go webhook path.

---

## Open Questions

1. **Outbound client notification delivery:** No service in the explored repos makes an outbound HTTP call to a client-configured URL upon receiving a 12go webhook. It is unknown whether the `Carmel` namespace services (referenced by the `Carmel.Booking.Notification.Messages` Kafka event package) are responsible for this step, and if so, where they are deployed and how they discover the client's endpoint URL.

2. **Per-client notification URL storage:** The `client_id` is stored in `BookingEntity.client_id` and propagated in the `ReservationChanged` Kafka message, but no table or configuration that maps `client_id → notification_url` was found. It is unknown where this mapping lives.

3. **Single vs. per-client webhook URL in 12go:** 12go requires a webhook URL to be configured on their side. Whether a single URL is used for all clients or a per-client URL (e.g., with `?client_id=<id>` as a query parameter) is registered in 12go's system is not visible in any code in these repos. No evidence of a `client_id` query parameter approach was found in code, but this has apparently been discussed as an idea.

4. **Retry behavior on notification failures:** The `SupplierReservationChangedHandler` (lines 33–48 of `SupplierReservationChangedHandler.cs`) catches exceptions and logs them but does not retry. The Kafka consumer stores offsets after processing (`consumer.StoreOffset`, line 47), so a failed message is not automatically reprocessed. There is no dead-letter topic or compensating retry mechanism visible. The `PendingBookingsUpdaterScheduledWorker` provides a recovery path for bookings stuck in `Pending` status, but only polls bookings already in that state — it does not cover failed webhook deliveries.

5. **`bid` type mismatch:** The 12go `bid` is a `long` in the request model (`NotificationRequest.Bid`, line 13) but is converted to `string` before being used as a Kafka message field and as the lookup key in `GetByIntegrationBookingIdAndIntegration`. The `BookingEntity.IntegrationBookingId` column is `varchar(100)`. If 12go ever sends `bid` values that do not match the stored string representation exactly (e.g., due to leading zeros or locale-specific formatting), the lookup will silently return null with no notification of failure.

6. **`IntegrationId = null` in TMS case:** The `ProcessedSuccessfully` record returns `IntegrationId = null` for the OneTwoGo handler. The `WebhookController.PublishMessage` falls back to using the route segment `"OneTwoGo"` as the `IntegrationId`. Whether this matches the value stored in `BookingEntity.integration_id` for all OneTwoGo bookings is an assumption embedded in the code; if any booking record uses a different integration ID string (e.g., `"onetwogo"`, `"onetwogo_internal"`), the lookup in `ReservationUpdaterService` will fail silently.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. 12 GitHub URL references were added, covering source files in the `denali` and `supply-integration` repositories:

- `denali`: `WebhookController.cs`, `BookingNotificationService` handler files, `SupplierReservationChangedHandler.cs`, `ReservationUpdaterService.cs`, `NotificationRequest.cs`, `BookingEntity.cs`, `BookingRepository.cs`
- `supply-integration`: `OneTwoGoWebhookHandler.cs` and related integration-specific webhook handler files

All referenced files were confirmed to exist in the local repository clones before conversion. No references were left unconverted.

---

## Meeting Insights (2026-03-12)

Source: Soso / Shauly 1-on-1 (timestamps 00:55:26 – 01:10:16)

### 12go's Webhook Subscriber Table

Shauly showed 12go's webhook configuration. Each subscriber entry has:
- **URL**: The webhook callback URL
- **User ID**: 12go's client ID (their internal client/agent concept)
- **API key**: Used when sending notifications

This table already provides the booking → client association that the current TC system has to derive through database lookups.

### 12go Already Knows Booking → Client

A key insight: **12go already knows which booking belongs to which client**. When a booking change is detected, 12go knows the associated client/agent and can route the notification accordingly.

### Proposed Approach: URL-Based Routing

Instead of maintaining a booking-to-client lookup database on TC's side, the webhook URL in 12go's table could be modified to:
1. Point directly to the client's actual webhook URL, or
2. Point to a TC intermediary with **client_id as a query parameter** in the URL (e.g., `?client_id=bookaway`)

This eliminates the need for a booking-to-client database lookup entirely.

### Format Transformation Still Required

Even with URL-based routing, **format transformation is still needed**:
- 12go sends notifications in its format (with `bid`)
- Clients expect TC format (with `booking_id`)
- For **old bookings**: translate back to the encrypted TC booking ID format
- For **new bookings**: use the 12go booking ID directly (as per the decision to use 12go IDs going forward)

### Redundant Processing Eliminated

With the no-persistence design decision, much of the current webhook processing becomes redundant:
- No need to look up booking in PostgreSQL `BookingEntities` table
- No need to call `GetBookingDetails` to update local database
- No need to publish `ReservationChanged` Kafka event for DB update
- Just transform the notification format and forward to the client

### Booking ID Mapping for Notifications

For the transition period, the static booking ID mapping table (discussed in the Booking ID Transition topic) is also needed here: when 12go sends a notification for an old booking, the system must look up the old TC booking ID to include in the notification sent to the client.

### 12go Codebase Exploration (2026-03-12)

Exploration of the 12go/frontend3 PHP codebase revealed the following about the webhook system:

**Webhook event system (internal)**:
- `BookingStatusTrigger` fires `BookingWebhookEvent` on booking status changes (CREATED→PAID, PAID→CONFIRMED, etc.)
- `BookingHttpEventListener` receives the event and delegates to `SystemMessageHandler`
- `HttpTransport` sends HTTP POST to URL pattern: `{baseUrl}/{language}/secure/event/{eventName}`
- This is an **internal event dispatch** system, not external B2B client notification

**Webhook payload** (from OpenAPI schema):
```
{ bid: int, type: "booking_updated"|"booking_confirmed"|"booking_canceled",
  stamp: int, new_data: WebhookBooking, previous_data: WebhookBooking }
```
Where `WebhookBooking` includes: `bid`, `tracker`, `status`, `from_id`, `to_id`, `dep_date_time`, `seats`, `price`

**No webhook subscriber URL table found in codebase**: The table Shauly showed during the meeting (with URL, user ID, API key per subscriber) is likely:
1. In a different part of 12go's system (admin panel, separate service)
2. Stored in `usr_meta` table (key-value metadata per user) — plausible but not confirmed in code
3. Managed externally

**B2B client model in 12go**:
- Users table: `usr` (fields: `usr_id` int, `email`, `phone`, `role_id`, `usr_name`, `acct_fxcode`, `lang_id`)
- API keys table: `apikey` (fields: `usr_id`, `role_id`, `apikey`, `active`, `hash_salt`, `fxcode`)
- B2B clients are users with role `partner` or `partner_light`
- `ApiAgent` service: initialized by API key or user ID, exposes `getId()`, `getKey()`, `getRole()`, `getName()`
- Metadata: `usr_meta` table (key-value per user) — potential location for webhook URLs

**B2B API route**: `/b2b/v1/{clientId}/itineraries` — note: uses `clientId` as a URL path parameter, similar to TC's pattern.
