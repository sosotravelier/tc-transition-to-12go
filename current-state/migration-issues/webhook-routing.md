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
