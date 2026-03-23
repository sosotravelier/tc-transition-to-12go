# Post-Booking Endpoint Group — Research

## Endpoints Covered

1. GetBookingDetails
2. GetTicket
3. CancelBooking
4. Notifications/Webhooks

---

## 1. GetBookingDetails

### One-line description

Returns booking status and details (status, stations, departure, price, voucher URL) for a given encrypted booking ID, reading primarily from local PostgreSQL and lazily fetching the ticket URL if missing.

### 12go API calls

| Method | Path | When called |
|---|---|---|
| `GET` | `/booking/{integrationBookingId}` | **Not called at runtime for GetBookingDetails.** The current Denali flow reads entirely from local PostgreSQL. The SI `GetReservation` call exists in code but is only used in other flows (booking creation). However, in the new system this becomes the primary data source since there is no local persistence. |

### F3 internal services to call (Team-First Developer design)

| Service | Role |
|---|---|
| `PostBookingController.php` | HTTP entry point for `GET /b2b/v1/{clientId}/bookings/{bookingId}` |
| `TwelveGoClient.php` | Calls 12go `GET /booking/{bid}` to fetch current booking state |
| `BookingDetailsMapper.php` | Maps 12go `GetBookingDetailsResponse` fields to TC `BookingDetailsResponse` format |
| `ClientKeyResolver.php` | Resolves `clientId` to 12go API key for the outbound call |

### Known challenges

| Challenge | Severity | Detail |
|---|---|---|
| **Booking ID resolution (old vs new)** | Manageable | Old bookings use encrypted Denali IDs (KLV-format or short IDs). The new system must look up the 12go `bid` from the static mapping table for old bookings, or use the `bid` directly for new bookings. The `BookingDetailsMapper` must check booking ID format and branch accordingly. |
| **Status mapping between 12go and TC** | Manageable | 12go statuses must be mapped to TC's `BookingStatus` enum (`reserved`, `pending`, `declined`, `approved`, `cancelled`, `failed`) via the equivalent of `OneTwoGoReservationStatusMapper`. All edge cases must be verified. |
| **Denali-specific fields not in 12go response** | Manageable | Fields like `cancellation_policies`, `net_price`/`cost_price` split, `contract_code`, `itinerary_instance_id`, and segments/vehicles data exist in Denali's DB but are not returned by 12go's `GET /booking/{bid}`. If these are needed by clients, an alternative source must be identified. |
| **Ticket URL behavior change** | Low risk | Currently Denali lazily fetches the ticket (via GetTicket flow) when `voucher_url` is null and `status == Approved`. In the new system, 12go's `ticket_url` from the booking details response could be used directly, eliminating the lazy-fetch pattern. Need to verify if 12go's URL is stable and long-lived. |
| **Encryption/decryption removal** | Low risk | The `ConditionalCypher` encrypt/decrypt layer on booking IDs goes away for direct 12go integration. New bookings use 12go `bid` directly. Old bookings use the static mapping table. |

### Proposed approach (presumptive)

Call 12go's `GET /booking/{bid}` at runtime instead of reading from local PostgreSQL. No local persistence for booking details. The `BookingDetailsMapper` transforms 12go's response into the TC contract. For old bookings, the booking ID mapping table (MariaDB, populated from a one-time Denali DB export) translates legacy TC IDs to 12go `bid` values. For new bookings, the `bid` is used directly. The lazy ticket fetch can be replaced by exposing 12go's `ticket_url` directly from the booking details response, pending verification that the URL is stable.

### Open questions

1. Can we use 12go's `ticket_url` from `GET /booking/{bid}` directly, or do clients depend on Denali's CloudFront-signed URL format?
2. What Denali-specific fields (cancellation_policies, net_price/cost_price, contract_code) are actually consumed by downstream clients? Are any of them hard requirements?
3. Who are all the clients of this endpoint? Is it only the 12go frontend, or are there other internal consumers depending on the current response schema?
4. How does the 12go status set map exhaustively to TC's `BookingStatus` enum? Are there edge-case statuses in 12go that do not have a clean mapping?
5. Is there latency concern from calling 12go API at runtime instead of reading from local DB? (The current flow is a single DB read; the new flow is an HTTP call.)

---

## 2. GetTicket

### One-line description

Returns a time-limited signed CloudFront URL to a ticket PDF for a confirmed booking, either generating a branded PDF via Denali's TicketPdfService (whitelisted integrations) or downloading and re-hosting the supplier's PDF from 12go to S3.

### 12go API calls

| Method | Path | When called |
|---|---|---|
| `GET` | `/booking/{integrationBookingId}` | Called by the SI layer (`OneTwoGoPostBookingOperations.GetTicketUrl`) to fetch booking details including `ticket_url` and `status`. This is the same endpoint as GetBookingDetails -- 12go does not have a separate ticket endpoint. |

### F3 internal services to call (Team-First Developer design)

| Service | Role |
|---|---|
| `PostBookingController.php` | HTTP entry point for `GET /b2b/v1/{clientId}/bookings/{bookingId}/ticket` |
| `TwelveGoClient.php` | Calls 12go `GET /booking/{bid}` to get `ticket_url` and verify `status == Confirmed` |
| `BookingDetailsMapper.php` | Reused to extract and validate the `ticket_url` field from the 12go response |
| `ClientKeyResolver.php` | Resolves `clientId` to 12go API key |

### Known challenges

| Challenge | Severity | Detail |
|---|---|---|
| **Denali PDF generation vs 12go's ticket_url** | Manageable | The current system has two paths: (1) Denali generates branded PDFs with QR codes, maps, logos for whitelisted integrations; (2) For non-whitelisted, it downloads 12go's PDF and re-hosts on S3 behind CloudFront signed URLs. The key question is whether OneTwoGo is whitelisted for Denali PDF generation. If yes, the branded PDF content (QR, maps, logos) is a business requirement that may need to be preserved. If no, we can potentially use 12go's `ticket_url` directly. |
| **CloudFront signed URL infrastructure** | Manageable | The entire S3 + CloudFront + URL signing pipeline exists solely for ticket delivery. If 12go's `ticket_url` is stable and long-lived, this infrastructure can be eliminated entirely. If not, the PDF re-hosting pattern must be replicated (S3 upload + signed URL generation) in the PHP layer, which is significant infrastructure work. |
| **Ticket availability timing** | Low risk | 12go may not immediately have a `ticket_url` available after booking confirmation. The current system handles this with a `202 Accepted` response and lazy retry. The new system must preserve this behavior. |
| **URL expiration and stability** | Manageable | 12go's `ticket_url` stability is unknown. Current Denali URLs are CloudFront-signed with ~90-day expiration (`departureTime + 90 days - now`). If 12go's URLs expire quickly or are unstable, a caching/re-hosting layer is needed. |

### Proposed approach (presumptive)

Call 12go's `GET /booking/{bid}` and extract the `ticket_url` field. If 12go's URL is stable and long-lived, return it directly to the client -- this eliminates the entire S3/CloudFront/PDF-generation pipeline. If 12go's URL is not stable, implement a lightweight caching mechanism: download the PDF, store it (using F3's existing file storage or a simple S3 bucket), and return a stable URL. The Denali-branded PDF generation (TicketPdfService) is not replicated unless explicitly required by business.

### Open questions

1. Is OneTwoGo whitelisted for Denali's `TicketPdfService` (branded PDF generation)? Or does it go through the SI path (download 12go's PDF and re-host)?
2. Is 12go's `ticket_url` stable? Does it expire? Is it publicly accessible or does it require authentication?
3. Is the branded PDF content (QR codes, maps, OTA/operator logos) a business requirement for the new system? Or is 12go's native ticket PDF acceptable?
4. What is the latency of 12go's `ticket_url` availability after booking confirmation? Is there a delay that the client must handle?
5. If PDF re-hosting is needed, can it use F3's existing file storage infrastructure, or does it require a separate S3 bucket?
6. The current system updates the `ticket_url` in PostgreSQL after generation (caching). Without local persistence, every GetTicket call hits 12go's API. Is this acceptable for latency and rate-limiting?

---

## 3. CancelBooking

### One-line description

Cancels a confirmed booking via a two-step flow against 12go (fetch refund options with hash, then execute refund), calculates Denali-specific client/supplier refund amounts from stored cancellation policies, updates the booking status, and publishes Kafka events.

### 12go API calls

| Method | Path | When called |
|---|---|---|
| `GET` | `/booking/{bid}/refund-options` | **Step 1.** Fetches available refund options for the booking. Returns `available`, `options[]` with `refund_amount`, `refund_fxcode`, `expires`, `hash`. The `hash` is required for Step 2. |
| `POST` | `/booking/{bid}/refund` | **Step 2.** Executes the refund. Request body: `{ hash, refund_fxcode, refund_amount }`. The `hash` comes from the selected refund option in Step 1. Returns `{ success, delay_minutes, message }`. |
| `GET` | `/booking/{bid}` | **Fallback only.** Called to check booking status if refund options are not available (to determine if the booking is in a cancellable state). |

### F3 internal services to call (Team-First Developer design)

| Service | Role |
|---|---|
| `PostBookingController.php` | HTTP entry point for `POST /b2b/v1/{clientId}/bookings/{bookingId}/cancel` |
| `TwelveGoClient.php` | Calls 12go's `GET /booking/{bid}/refund-options` and `POST /booking/{bid}/refund` |
| `BookingDetailsMapper.php` | Reused to map cancellation response to TC `CancellationResponse` format |
| `ClientKeyResolver.php` | Resolves `clientId` to 12go API key |

### Known challenges

| Challenge | Severity | Detail |
|---|---|---|
| **Two-step cancellation atomicity** | Blocking | The cancellation is a two-step process: `GET /refund-options` (which returns a hash) then `POST /refund` (which requires that hash). The hash has an expiration (`expires_after` field). If the process fails between steps, the booking is in an inconsistent state -- refund options were fetched but refund was not executed. Error handling and retry logic must be robust. The current system has Polly retry (3 attempts, 3s delay) on the SI host layer. |
| **Cancellation policy complexity / refund calculation divergence** | Blocking | Currently, Denali calculates its own refund amounts using locally stored `CancellationPolicies` (JSONB in PostgreSQL), `DepartureTime`, timezone, and `netPrice`/`costPrice`. This calculation produces `clientRefund` (for the API response) and `supplierRefund` (for internal records). 12go provides a separate `refund_amount` in the refund options. **These two amounts may differ**, and the current system logs warnings when they do. The critical decision: does the new system use 12go's `refund_amount` as the client-facing refund, or must it replicate Denali's `RefundCalculator` logic (which requires access to cancellation policies, departure time, and timezone data)? |
| **Cancellation policies data source** | Blocking | Denali stores `CancellationPolicies` at booking creation time in PostgreSQL. Without local persistence, there is no source for cancellation policies in the new system. Options: (a) use 12go's refund amount directly (business decision), (b) fetch cancellation policies from 12go at cancel time (need to verify if 12go exposes this), (c) store cancellation policies in F3's MariaDB at booking creation time (adds persistence to a "no-persistence" design). |
| **Feature flag for cancel disable** | Manageable | The `DisableCancel` feature flag blocks cancellation for specific integrations. In the new system with a single integration (12go), this simplifies to a simple config flag. |
| **Hash-based refund option selection** | Manageable | The current SI logic always selects the refund option with the **maximum** `refund_amount` (`options.MaxBy(o => o.RefundAmount)`). This business rule must be preserved in the new system. |
| **Pre-validation requirements** | Manageable | Current system validates: (1) booking status must be `Approved`, (2) cancellation policies must exist with non-null `PenaltyPercentage`. Without local persistence, validation (1) requires a prior call to `GET /booking/{bid}` to check status. Validation (2) depends on the cancellation policies data source decision. |

### Proposed approach (presumptive)

The `PostBookingController` receives the cancel request, resolves the booking ID (old ID -> mapping table -> 12go bid, or new ID used directly). The `TwelveGoClient` performs the two-step flow:

1. Call `GET /booking/{bid}` to verify booking status is cancellable.
2. Call `GET /booking/{bid}/refund-options` to get available options.
3. Select the option with maximum `refund_amount`.
4. Call `POST /booking/{bid}/refund` with the selected option's `hash`, `refund_fxcode`, `refund_amount`.
5. On success, return the refund amount to the client.

**Refund calculation**: Presumptively use 12go's `refund_amount` directly as the client-facing refund. This eliminates the need for local cancellation policy storage and the `RefundCalculator` entirely. This is a **business decision that must be confirmed** -- if the business requires Denali's independent refund calculation (which may differ from 12go's), cancellation policies must be persisted locally at booking creation time.

**Error handling**: Implement retry on the `POST /refund` step (not the `GET /refund-options` step, since fetching options is idempotent but the hash may expire). If `POST /refund` fails after options were fetched, re-fetch options and retry.

### Kafka events for data team

The current system publishes **5 distinct Kafka events** during cancellation:

| Event | Topic | When published | Key fields |
|---|---|---|---|
| `CancelRequested` | `Denali.Booking.Messages.CancelRequested` | Before validation/execution (fire-and-forget) | BookingId, ContractCode, IntegrationId, IntegrationBookingId, BookingClientId, ItineraryInstanceId |
| `SiHostBookingCancelResponse` | (published by SiHost) | After SI returns success | BookingId, Refund (supplier), BookingStatus |
| `CancelSucceeded` | `Denali.Booking.Messages.CancelSucceeded` | After DB update | BookingId, OperatorBookingId, NumberOfSeats, CancelledAt, SupplierRefund, ClientRefund, BookingStatus, ItineraryInstanceId |
| `CancelFailed` | `Denali.Booking.Messages.CancelFailed` | On any exception | BookingId, FailureCode="0", FailureDescription=null, ItineraryInstanceId |
| `ReservationChanged` | `Denali.Booking.Messages.ReservationChanged` | After successful cancel | All booking fields + all price fields (net, cost, reserve, estimate) |

**Minimum viable events for the new system** (from the recommendation): `booking.cancelled` is one of the 5 minimum viable structured log events. At minimum, emit a structured log/event equivalent to `CancelSucceeded` with booking ID, refund amounts, and timestamp. The `ReservationChanged` event is consumed downstream and must be confirmed with the data team before removal.

### Open questions

1. **Can the business accept 12go's `refund_amount` as the client-facing refund?** This is the single most impactful decision for cancel complexity. If yes, no local cancellation policy storage is needed. If no, cancellation policies must be persisted at booking creation time (adding persistence to the design).
2. **What consumes the 5 Kafka events?** `CancelRequested`, `CancelSucceeded`, `CancelFailed`, `ReservationChanged`, `SiHostBookingCancelResponse` -- all consumers must be identified. If consumers depend on the full `ReservationChanged` event shape (with pricing breakdown), the new system must emit an equivalent.
3. **Does 12go's refund-options response already account for time-based penalty percentages?** Denali's `RefundCalculator` applies penalty percentages based on time-to-departure. If 12go's refund amount already reflects these penalties, the calculation is redundant.
4. **What is the refund hash expiration window?** If the hash in refund options expires quickly, the two-step flow must complete within that window. Retry logic must account for hash expiration.
5. **Is the "always pick max refund" rule correct?** The current SI logic selects `options.MaxBy(o => o.RefundAmount)`. Is this the correct business rule for all clients, or do some clients/contracts have different refund selection criteria?
6. **The `CancelRequested` event is published BEFORE validation** in the current system. Should the new system preserve this pre-validation audit trail, or only emit events on success/failure?
7. **`CancelFailed` currently has `FailureCode=0` and `FailureDescription=null`.** Should the new system provide more descriptive failure information?

---

## 4. Notifications / Webhooks

### One-line description

Receives booking status change webhooks from 12go (a `POST` with `{ "bid": <long> }` and zero authentication), publishes an internal Kafka event, which triggers a downstream service to look up the booking, fetch fresh status from 12go, update the local DB, and publish a `ReservationChanged` event. **No outbound notification delivery to clients was found in the codebase.**

### 12go API calls

| Method | Path | When called |
|---|---|---|
| `GET` | `/booking/{bid}` | Called by the **downstream** `PostBookingService` (not the webhook receiver itself) after consuming the `SupplierReservationChanged` Kafka event. Used to fetch the current booking status from 12go. |

Note: The webhook receiver itself makes **no outbound API calls**. It only parses the `{ "bid": <long> }` payload and publishes a Kafka event.

### F3 internal services to call (Team-First Developer design)

| Service | Role |
|---|---|
| `WebhookController.php` | HTTP entry point for `POST /b2b/v1/notifications/booking?client_id={clientId}` |
| `NotificationMapper.php` | Transforms 12go webhook format (`{ bid, type, stamp, new_data, previous_data }`) to TC notification format |
| `Security/WebhookAuthenticator.php` | HMAC-SHA256 signature verification for inbound webhooks (addressing the zero-auth vulnerability) |
| `ClientKeyResolver.php` | Resolves `clientId` (from URL query parameter) to determine the target client's notification URL |

### Current architecture (push vs pull topology)

The notifications system has a **fundamentally different topology** from the other post-booking endpoints:

- **GetBookingDetails, GetTicket, CancelBooking** are **pull** (client calls us, we call 12go)
- **Notifications** are **push** (12go calls us, we must forward to the client)

The current Denali architecture is:

```
12go --> BookingNotificationService (webhook receiver)
             |
             v
         Kafka: SupplierReservationChanged
             |
             v
         PostBookingService (consumer)
             |
             +--> PostgreSQL lookup (bid -> booking record -> client_id)
             +--> 12go API call (GET /booking/{bid} to get fresh status)
             +--> PostgreSQL update (save new status)
             +--> Kafka: ReservationChanged
             |
             v
         ??? (no outbound client delivery found in codebase)
```

The chain terminates at the `ReservationChanged` Kafka event. No service in the explored codebase consumes this event and delivers a webhook to the client. A separate "Carmel" namespace service (`Carmel.Booking.Notification.Messages.ReservationChanged`) may handle the final delivery, but its code is not in the explored repositories.

### Proposed new architecture (Team-First Developer design)

The recommendation uses **URL-based routing** in 12go's webhook subscriber table:

```
12go --> F3 WebhookController (POST /b2b/v1/notifications/booking?client_id={clientId})
             |
             +--> HMAC-SHA256 authentication
             +--> Booking ID mapping (bid -> TC booking ID for old bookings)
             +--> Format transformation (12go webhook -> TC notification format)
             +--> Forward to client's webhook URL
```

Key architectural differences from current:
1. **No Kafka intermediary** -- direct HTTP-to-HTTP forwarding
2. **No PostgreSQL lookup** -- `client_id` is in the URL (12go already knows the client)
3. **No 12go API re-fetch** -- the webhook payload itself contains the status change data (12go sends `type`, `new_data`, `previous_data` fields that the current system discards)
4. **HMAC authentication added** -- addressing the zero-auth vulnerability

### Known challenges

| Challenge | Severity | Detail |
|---|---|---|
| **12go must implement HMAC signing** | Blocking | 12go currently sends webhooks with zero authentication. The new system requires 12go to add `X-Webhook-Signature` (HMAC-SHA256) headers to outbound webhook POST requests. This is a **cross-team coordination dependency** -- 12go must implement the signing mechanism on their side. Must be raised as a requirement early. |
| **No outbound client delivery mechanism exists** | Blocking | The current system has no code that delivers notifications to clients. The new system must implement outbound HTTP delivery (POST to client's webhook URL), including: retry logic (what if client endpoint is down?), timeout handling, dead-letter/failure logging. This is **new functionality**, not a migration. |
| **Per-client webhook URL storage** | Blocking | No per-client notification URL is stored anywhere in the current system. The `BookingEntity` has `LastBookingNotificationSentToClient` timestamp columns (suggesting the schema was designed for it), but no URL storage and no delivery code. The new system needs a `client_id -> notification_url` mapping somewhere (F3 MariaDB config table, or per-client config in `ClientConfig.php`). |
| **Webhook payload transformation** | Manageable | 12go sends `{ bid, type, stamp, new_data, previous_data }` where `new_data` and `previous_data` contain `WebhookBooking` objects (bid, tracker, status, from_id, to_id, dep_date_time, seats, price). The current system **discards all of this** and only extracts `bid`, then re-fetches booking details from 12go. The new system should use the webhook payload data directly, but must verify it contains all fields needed by the TC notification contract. |
| **Old booking ID translation** | Manageable | For notifications about old bookings (created before migration), the webhook arrives with 12go's `bid`. The system must translate this to the client's expected TC booking ID format using the static mapping table. For new bookings, the `bid` is used directly. |
| **12go webhook subscriber table configuration** | Manageable | 12go has a webhook subscriber table with URL, User ID, and API key per subscriber. The URL must be updated per client to include `client_id` as a query parameter. This is a one-time configuration change per client during rollout. |
| **Reliability and retry for outbound delivery** | Manageable | The outbound HTTP delivery to clients must handle: client endpoint downtime, timeouts, 5xx responses, network errors. The current system has no retry mechanism (the Kafka consumer logs errors and moves on). The new system should implement at least basic retry (exponential backoff, 3 attempts) and dead-letter logging. |
| **Possibility of offloading to another developer** | Low risk | The recommendation (from recommendation.md) suggests notifications can be offloaded: "Notifications and master data endpoints can follow" after core Q2 deliverables. The core Q2 scope is 7 endpoints (Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, GetTicket, CancelBooking). Notifications are explicitly listed as deferrable. This is a viable scope reduction lever. |
| **bid -> client_id resolution without DB** | Manageable | The current system resolves `bid -> client_id` via PostgreSQL lookup (`BookingEntities` table indexed on `(integration_id, integration_booking_id)`). The new system avoids this by having `client_id` in the webhook URL (12go already knows which client owns each booking). This is cleaner but requires 12go to configure per-client webhook URLs. |

### Kafka events for data team

**Events published in the current notification flow:**

| Event | Topic | Publisher | When |
|---|---|---|---|
| `SupplierReservationChanged` | `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged` | BookingNotificationService | When webhook received from supplier |
| `ReservationChanged` | `Denali.Booking.Messages.ReservationChanged` | PostBookingService (downstream consumer) | After booking status updated in DB |

In the new system, if the notification is handled as direct HTTP-to-HTTP forwarding (no Kafka intermediary), both events go away for the notification path. However:

- `ReservationChanged` is published in other contexts too (post-cancellation, booking detail refresh). Its consumers must be mapped.
- The `notification.received` structured log event is one of the 5 minimum viable events in the recommendation. At minimum, emit a structured log when a webhook is received and when a notification is forwarded to a client.

### Proposed approach (presumptive)

**Phase 1 (core Q2 -- may be deferred):** Implement a minimal webhook receiver in F3:

1. `WebhookController.php` receives `POST /b2b/v1/notifications/booking?client_id={clientId}` from 12go
2. `WebhookAuthenticator.php` verifies HMAC-SHA256 signature
3. Parse the full webhook payload (bid, type, new_data, previous_data) -- do NOT discard fields like the current system
4. `NotificationMapper.php` transforms 12go webhook format to TC notification format
5. Look up the client's outbound webhook URL from config
6. POST the transformed notification to the client's URL
7. Emit `notification.received` structured log event

**Transition period:** Both old (BookingNotificationService) and new (F3 WebhookController) run simultaneously. 12go's webhook subscriber table URL is updated per client as they migrate. Old clients continue to use the existing Kafka-based flow.

**Scope reduction option:** Defer notifications entirely to after Q2. Core post-booking operations (GetBookingDetails, GetTicket, CancelBooking) work without notifications. Notifications are a "nice to have" for real-time updates but clients can poll GetBookingDetails as a fallback.

### Open questions

1. **Will 12go implement HMAC-SHA256 webhook signing?** This is a hard dependency. If 12go cannot or will not add signing, the webhook remains unauthenticated (anyone who can reach the endpoint can trigger notifications). Alternative: IP allowlisting at the API gateway level.
2. **Where is the per-client notification URL stored?** The current system has no storage for this. Options: (a) config table in F3 MariaDB, (b) environment variables, (c) 12go's webhook table already routes to the right client. If 12go routes directly to the client (bypassing F3), the notification transformer is on the 12go side.
3. **Does 12go need to send webhooks to F3 at all, or can 12go send notifications directly to clients?** If 12go's webhook system can send directly to client endpoints (with format transformation done on the 12go side), the entire F3 notification service is unnecessary.
4. **What is the TC notification contract that clients expect?** The current outbound notification format is unknown (no delivery code found in the explored repositories). This must be documented before implementation.
5. **What `ReservationChanged` Kafka event consumers exist downstream?** If the Carmel service or other consumers depend on this event, the notification flow must continue to emit it (or an equivalent) even in the new architecture.
6. **Is the `SupplierReservationChanged` -> `PostBookingService` -> `ReservationChanged` chain the only way booking statuses propagate?** The `PendingBookingsUpdaterScheduledWorker` exists as a polling fallback for bookings stuck in `Pending` status. Is this worker still needed?
7. **Should notifications be deferred entirely from Q2 scope?** The recommendation explicitly lists notifications as deferrable. If deferred, clients can poll `GetBookingDetails` for status updates.
8. **Can this endpoint be offloaded to another developer?** The recommendation mentions scope reduction by dropping notifications. If another developer (from 12go PHP team or elsewhere) can own the notification transformer, it removes this from the critical path.

---

## Cross-Cutting: Data Team Events for Post-Booking Operations

The current .NET post-booking services publish the following events to Kafka that the data team depends on:

### Events that will stop when .NET services are removed

**Post-booking specific (3 event types):**
- `Denali.Booking.Messages.ReservationChanged` -- published on: booking detail refresh, post-cancellation status update, supplier webhook trigger. Lower-fidelity status-change event (no passenger or pricing breakdown). Signals consumers to re-fetch.
- `Denali.Booking.Messages.CancelRequested` -- published before cancel validation (audit trail)
- `Denali.Booking.Messages.CancelFailed` -- published on any cancel exception (currently with generic `FailureCode=0`, `FailureDescription=null`)

**Supplier webhook trigger:**
- `Denali.Booking.Messages.supplier_integration.SupplierReservationChanged` -- published when a supplier webhook is received by the BookingNotificationService

**Also relevant (from booking-service, not post-booking, but emitted during the booking flow that precedes post-booking):**
- `Denali.Booking.Messages.CancelSucceeded` -- defined in messages package v2.8.0, but no production call site publishing it was found in post-booking-service code. The cancellation flow publishes `ReservationChanged` instead.

### Minimum viable events for the new system

Per the recommendation (Data Flow Architect overlay): start with 5 minimum viable structured log events:
1. `search.completed`
2. `booking.created`
3. `booking.confirmed`
4. **`booking.cancelled`** -- replaces `CancelRequested` + `CancelSucceeded`/`CancelFailed` + `ReservationChanged` (post-cancel)
5. **`notification.received`** -- replaces `SupplierReservationChanged`

### Key structural facts

- **Topic names are .NET CLR type FullName strings** -- not configured externally. Consumers subscribe by these exact strings. If the new system must publish to the same topics, it must use the same topic name strings.
- **`ReservationChanged` is the most cross-cutting event** -- it is published by 3 different code paths (cancel, booking detail refresh, webhook trigger) and carries all booking fields + all price fields.
- **`ItineraryInstanceId` is the join key** between search telemetry and booking conversion data. Post-booking events carry it. The new system must preserve this correlation.
- **`BookingClientId` is in every booking-flow event** -- used for per-client analytics. The new system must continue to emit client identity in events.
- **All events are gated by `KafkaPublishSwitch` feature flag** -- if this flag is off in production, no events are being published today. The current flag state is unknown.

---

## Implementation Timeline (from recommendation)

Per the recommended execution plan:
- **Weeks 6-7**: GetTicket + CancelBooking + SeatLock (stub) -- post-booking operations tested
- **Weeks 4-5**: GetBookingDetails is grouped with CreateBooking + ConfirmBooking (booking funnel end-to-end test against 12go staging)
- **Week 11+**: Notification transformer (if not offloaded)

The post-booking group is scheduled for weeks 4-7 of implementation, with notifications deferred to week 11+.
