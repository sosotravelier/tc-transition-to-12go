---
status: draft
last_updated: 2026-02-17
---
# Data Storage

## Current State

The system uses four distinct storage technologies across its services:

| Technology | Service | Purpose |
|---|---|---|
| **DynamoDB** | Denali booking-service | Booking funnel caches (ItineraryCache, PreBookingCache, BookingCache, IncompleteResults) |
| **DynamoDB** | Fuji entity_mapping | Entity mapping master data (Station, Operator, POI, SupplierAlias, MapTransportationType) |
| **PostgreSQL** | Denali post-booking-service | Confirmed bookings persistent store (BookingEntities, BookingEntityHistory, ConfirmationInProcess) |
| **S3** | Supply-Integration (SI) | Ticket file storage (PDFs, images) |
| **S3** | Fuji entity_mapping | Pre-mapping CSV files for bulk station/operator/POI mapping |

## DynamoDB Tables

### Denali booking-service

All tables use DynamoDB TTL via an `ExpiredAt` epoch-seconds attribute. Default TTL is configured via `ExpirationTimeInMinutes` (default: **7200 min = 5 days**). Confirmation deadline defaults to `ConfirmationDeadLineInMinutes` (**1440 min = 24 hours**).

Data is serialized manually using the low-level `PutItemRequest`/`GetItemRequest` API (not DynamoDB Document Model or Object Persistence Model). Large payloads (Itinerary, Segments, BookingSchema, BookingData) are **GZip-compressed** before storage using `Compressor.Zip()`.

#### Table: ItineraryCache

**Purpose:** Caches itinerary search results from SI during the booking funnel. Written when a user views search results, read when proceeding to pre-booking.

| Attribute | DynamoDB Type | Description |
|---|---|---|
| `Id` (PK) | S (string) | Itinerary ID |
| `ExpiredAt` | N (number) | TTL epoch seconds (default 7200 min from creation) |
| `CreatedAt` | S (string) | ISO date string |
| `Itinerary` | B (binary) | GZip-compressed JSON of Itinerary object |
| `Segments` | B (binary) | GZip-compressed JSON of List\<Segment\> |
| `Vehicles` | B (binary) | GZip-compressed JSON of List\<Vehicle\> (optional) |
| `ExperimentId` | S (string) | Optional A/B test experiment ID |
| `ItineraryInstanceId` | S (string) | Optional tracing ID |

**Read pattern:** `GetById(string id)` — single-item get by partition key.
**Write pattern:** `Upsert(ItineraryCacheModel)` — PutItem (full replace).
**Writer:** booking-service (SiFacade during search).
**Reader:** booking-service (SiFacade during pre-booking/booking).

#### Table: PreBookingCache

**Purpose:** Caches the booking schema (form fields) returned by SI during pre-booking. Needed to validate and transform booking form submission.

| Attribute | DynamoDB Type | Description |
|---|---|---|
| `Id` (PK) | S (string) | BookingToken (string representation) |
| `ExpiredAt` | N (number) | TTL epoch seconds (default 7200 min) |
| `CreatedAt` | S (string) | DateTime string |
| `BookingSchema` | B (binary) | GZip-compressed JSchema JSON |
| `NameToSupplierNameFields` | B (binary) | GZip-compressed Dictionary\<string, string\> |
| `BookingSchemaDictionary` | B (binary) | GZip-compressed Dictionary\<string, Dictionary\<string, string\>\> |
| `ItineraryId` | S (string) | Reference to itinerary |
| `NextFlowId` | S (string) | Next flow reference |
| `LockedSeats` | S (string) | JSON-serialized List\<string\> of locked seat IDs (added via UpdateItem) |

**Read pattern:** `GetById(string id)` — single-item get by PK.
**Write pattern:** `Add(PreBookingCacheModel)` — PutItem. `AddSeats(BookingToken, List<string>)` — UpdateItem (partial update for seat locking).
**Writer:** booking-service (SiFacade during pre-booking and seat selection).
**Reader:** booking-service (SiFacade during booking submission).

#### Table: BookingCache

**Purpose:** Caches the full booking state during the booking funnel — from reservation through confirmation. This is the **critical cross-service table**: booking-service writes it, and post-booking-service reads from it.

| Attribute | DynamoDB Type | Description |
|---|---|---|
| `BookingId` (PK) | S (string) | Composite booking ID |
| `BookingToken` | S (string) | Token reference |
| `ItineraryId` | S (string) | Itinerary reference |
| `FromStation` | S (string) | Departure station |
| `ToStation` | S (string) | Arrival station |
| `DepartureTime` | S (string) | DateTime as invariant string |
| `DepartureTimeZone` | S (string) | Optional timezone |
| `PassengerCount` | S (string) | Number of passengers (stored as string) |
| `ExpiredAt` | N (number) | TTL epoch seconds (default 7200 min) |
| `CreatedAt` | S (string) | DateTime as invariant string |
| `ConfirmationDeadLine` | N (number) | Epoch seconds deadline (default 1440 min) |
| `BookingFunnelStatus` | S (string) | Enum: Reserved, Confirmed, Cancelled, None |
| `CreditStatus` | S (string) | Enum: None, Reserved, Confirmed, Failed |
| `CreditRequestId` | S (string) | Optional credit reference |
| `Cost` | S (string) | JSON-serialized Price |
| `Net` | S (string) | JSON-serialized Price |
| `EstimatedCost` | S (string) | JSON-serialized Price |
| `EstimatedNet` | S (string) | JSON-serialized Price |
| `Gross` | S (string) | JSON-serialized Price |
| `GrossPriceType` | S (string) | Optional price type |
| `BookingData` | B (binary) | GZip-compressed booking form data |
| `ExperimentId` | S (string) | Optional experiment ID |
| `ItineraryInstanceId` | S (string) | Optional tracing ID |
| `OperatorBookingId` | S (string) | Operator's booking reference |
| `ContractCode` | S (string) | Contract code |
| `IntegrationId` | S (string) | Integration identifier |
| `IntegrationBookingId` | S (string) | SI booking identifier |
| `BookingClientId` | S (string) | Client identifier |

**Read pattern:** `GetById(string id)` — single-item get by PK.
**Write pattern:** `Add(BookingCacheModel)` — PutItem. `UpdateAttributesAsync(bookingId, dict)` — UpdateItem for partial updates (e.g., status changes).
**Writer:** booking-service (SiFacade during reserve/confirm).
**Reader:** booking-service (for status checks), **post-booking-service** (reads BookingCache to construct the persistent BookingEntity).
**Critical dependency:** Post-booking-service reads from this DynamoDB table that booking-service writes to.

#### Table: IncompleteResults

**Purpose:** Stores async booking operation results. Used for polling-based async confirm/cancel flows where the supplier doesn't respond synchronously.

| Attribute | DynamoDB Type | Description |
|---|---|---|
| `Id` (PK) | S (string) | Operation ID |
| `CorrelationId` | S (string) | Optional correlation ID |
| `CreatedAt` | S (string) | ISO date string |
| `UpdatedAt` | S (string) | ISO date string (on update) |
| `ExpiredAt` | N (number) | TTL epoch seconds (default 15 hours from `AsyncProcess:IncompleteResultsTTLInHours`) |
| `StatusCode` | N (number) | HTTP-like status: 202 (pending), 200 (complete), etc. |
| `Results` | B (binary) | GZip-compressed JSON of result object |

**Read pattern:** `GetById(string id)` — single-item get.
**Write pattern:** `Add(id, correlationId)` — PutItem with initial 202 status. `UpdateById(model)` — UpdateItem with results.
**Writer:** booking-service.
**Reader:** booking-service (polling for async results).

### Denali post-booking-service

Post-booking uses **PostgreSQL** (see below), not DynamoDB. It does *read* from the DynamoDB BookingCache table (see above).

### Fuji

Fuji entity_mapping uses DynamoDB for master data entity mapping. These are **not caches** — they are the authoritative mapping store.

#### Table: Station

**Key schema:** `pk` (partition key, format: `{sourceId}_{shard}`), `sk` (sort key, station ID). Alternatively `MapperId` as single partition key for legacy access.
**GSI:** None documented, but uses both key patterns.

| Attribute | Type | Description |
|---|---|---|
| `pk` | S | Composite: `{sourceId}_{shardIndex}` (0-9 shards) |
| `sk` | S | Source station ID |
| `MapperId` | S | Legacy single-key access |
| `CMSId` | S | 12go CMS station ID (the mapping target) |
| `SourceId` | S | Integration/supplier source ID |
| `SourceStationId` | S | Original station ID from supplier |
| `Name` | S | Station name |
| `Address` | M (map) | Structured address |
| `Coordinates` | M (map) | Lat/lng |
| `TransportationType` | S | Transport type |
| `UpdateTimeUTC` | S | Last update timestamp |
| `AdditionalInfo` | M (map) | Arbitrary key-value metadata |

**Read patterns:** GetById (single key), BatchGetItem (multiple keys), Query by pk + sk, Scan with filter (for bulk export).
**Write patterns:** PutItem, UpdateItem (CMSId update with conditional check).

#### Table: Operator

**Key schema:** Same as Station — `MapperId` or `pk`/`sk`.
**GSI:** `CMSId-index` on `CMSId` attribute.
**Fields:** `CMSId`, `SourceId`, `SourceCarrierId`, `TransportationTypes`, etc.

#### Table: POI

**Key schema:** `MapperId` as partition key.
**Fields:** `CMSId`, `SourceId`, `SourcePOIId`, `Name`, `MapperParentId`, `Country`, `State`.

#### Table: SupplierAlias

**Key schema:** `pk` (format: `{sourceId}_{supplier}`).
**Fields:** `Alias` — supplier alias string.

#### Table: MapTransportationType

**Key schema:** `pk` (original name), `sk` (source).
**Fields:** Transportation type mapping data.

## Other Storage

### PostgreSQL

**Service:** Denali post-booking-service
**Connection:** Configured via `ConnectionStrings:postgres` in app configuration.
**ORM:** Entity Framework Core with Npgsql provider.
**Migrations:** Applied on startup via `db.Database.Migrate()`.

#### Table: BookingEntities

The authoritative store for confirmed bookings. Written by post-booking-service after reading from DynamoDB BookingCache.

| Column | Type | Description |
|---|---|---|
| `id` (PK) | varchar(512) | Composite booking ID |
| `plain_id` | varchar(512) | Plain text booking ID |
| `si_host_booking_id` | varchar(512) | SI host reference |
| `client_id` | varchar(50) | Client identifier |
| `status` | varchar(50) | Booking status (Pending, Confirmed, Cancelled, etc.) |
| `from_station` | varchar(50) | Departure station |
| `to_station` | varchar(50) | Arrival station |
| `departure_time` | timestamp without time zone | Departure time |
| `arrival_time` | timestamp without time zone | Arrival time |
| `passenger_count` | integer | Number of passengers |
| `integration_id` | varchar(50) | Integration identifier |
| `contract_code` | varchar(50) | Contract code |
| `integration_booking_id` | varchar(100) | SI booking reference |
| `net_price` | decimal | Net price |
| `net_currency` | varchar(3) | Net currency |
| `cost_price` | decimal | Cost price |
| `cost_currency` | varchar(3) | Cost currency |
| `reserve_estimate_cost_price` | decimal | Estimated cost at reserve |
| `reserve_estimate_cost_currency` | varchar(3) | |
| `reserve_estimate_net_price` | decimal | Estimated net at reserve |
| `reserve_estimate_net_currency` | varchar(3) | |
| `reserve_cost_price` | decimal | Actual reserve cost |
| `reserve_cost_currency` | varchar(3) | |
| `reserve_net_price` | decimal | Actual reserve net |
| `reserve_net_currency` | varchar(3) | |
| `gross_price` | decimal | Gross (retail) price |
| `gross_price_currency` | varchar(3) | |
| `gross_price_type` | varchar(50) | |
| `reserve_gross_price` | decimal | Reserve gross price |
| `reserve_gross_price_currency` | varchar(3) | |
| `refund` | decimal | Client refund amount |
| `refund_currency` | varchar(3) | |
| `supplier_refund` | decimal | Supplier refund |
| `supplier_refund_currency` | varchar(3) | |
| `si_refund_response` | decimal | SI refund response |
| `si_refund_currency_response` | varchar(3) | |
| `ticket_url` | varchar(512) | URL to ticket (S3) |
| `operator_booking_id` | varchar(512) | Operator's reference |
| `cancellation_policies` | jsonb | JSON array of cancellation policies |
| `reserve_details` | jsonb | Booking form data |
| `points_pickup` | jsonb | Pickup point data |
| `points_dropoff` | jsonb | Dropoff point data |
| `segments` | jsonb | Multi-segment trip data |
| `vehicles` | jsonb | Vehicle information |
| `itinerary_id` | text | Itinerary reference |
| `itinerary_instance_id` | text | Tracing ID |
| `departure_time_zone` | varchar(50) | Timezone |
| `transportation_types` | text[] | Array of transport types |
| `operator_list` | text[] | Array of operator IDs |
| `last_booking_notification_received_at` | timestamp | Last SI notification |
| `last_booking_notification_sent_to_client` | timestamp | Last client notification |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

**Unique index:** `(integration_id, integration_booking_id)` — ensures one booking per integration booking ID.

**Read patterns:**
- `GetById(id)` — primary lookup
- `GetByIntegrationBookingIdAndIntegration(id, integrationId)` — lookup by SI reference
- `GetPendingBookings(daysOffset)` — scan for pending bookings within departure date range

**Write patterns:**
- `Upsert(BookingEntity)` — insert or full update by ID
- `UpdateStatusById` — status change
- `UpdateTicketUrlById` — ticket URL update
- `UpdateCancelledById` — cancellation with refund data
- `UpdatePostConfirmationCompleted` — finalize confirmation

#### Table: BookingEntityHistory

Audit trail table, automatically populated via PostgreSQL triggers.
**Composite PK:** `(booking_id, changed_at)`.
Schema mirrors BookingEntities for historical tracking.

#### Table: ConfirmationInProcess

Tracks async confirmation operations in progress.

| Column | Type | Description |
|---|---|---|
| `id` (PK) | text | Booking ID |
| `expiry_date` | timestamp | When this confirmation times out |
| `status` | text | Processing, Completed, TimedOut |
| `integration_id` | varchar(50) | Integration identifier |
| `contract_code` | varchar(50) | Contract code |
| `si_booking_id` | varchar(250) | SI booking reference |
| `client_id` | varchar(50) | Client identifier |
| `processing` | boolean | Whether currently being processed (prevents double-processing) |

### S3

#### Supply-Integration Ticket Storage

**Implementation:** `S3PersistenceProvider` in `SupplyIntegration.PersistenceProvider`
**Bucket:** Configured via `SiS3Settings.Bucket`
**Object key pattern:** `tickets/{integrationId}/{generatedId}.{extension}`
**Purpose:** Stores ticket PDFs and images uploaded from supplier APIs. Returns public S3 URL stored in `BookingEntity.TicketUrl`.
**Tags:** `date` tag with expiration date for lifecycle policy.
**Interface:** `IPersistenceProvider.Save(id, content, contentType, expirationDate)`

#### Fuji Pre-Mapping CSVs

**Implementation:** `CodePreMappedProvider` in `FujiDomainServices.CodeProvisioning`
**Bucket:** Configured via `PremapOptions.S3BucketName`
**Object key patterns:**
- `{sourceId}/station_mapping.csv`
- `{sourceId}/operators_mapping.csv`
- `{sourceId}/poi_mapping.csv`

**Purpose:** Bulk pre-mapped CSV files containing `(Id, CMSId)` pairs for initial entity mapping. Read-only from code (manually uploaded).

## Per-Table Analysis

### Can Each Table Be Eliminated?

| Table | Service | Eliminable? | Rationale |
|---|---|---|---|
| **ItineraryCache** | booking-service | **Yes** | Pure cache of SI search results. If Denali calls SI in real-time or proxies through 12go, this is unnecessary. |
| **PreBookingCache** | booking-service | **Yes** | Caches booking schema from SI. Could be re-fetched from SI or 12go on demand. |
| **BookingCache** | booking-service | **Partially** | Stores in-progress booking state. 12go has this in MySQL, but the funnel state machine (credit reservation, async confirmation) adds complexity. This is the hardest to eliminate. |
| **IncompleteResults** | booking-service | **Yes** | Async polling store. If booking flow becomes synchronous through 12go, this is unnecessary. |
| **BookingEntities** | post-booking | **Yes, if** 12go MySQL is authoritative. Currently needed because post-booking queries booking data independently of 12go. |
| **BookingEntityHistory** | post-booking | **Yes, if** audit trail moves to 12go or is no longer needed. |
| **ConfirmationInProcess** | post-booking | **Yes** | Async confirmation tracking. Eliminable if confirm becomes synchronous. |
| **Station/Operator/POI** | Fuji | **No (short term)** | Master entity mapping data. Unless 12go provides equivalent mapping API, Fuji tables remain. Could be migrated to 12go's MySQL long-term. |
| **SupplierAlias** | Fuji | **No (short term)** | Supplier alias lookup. Same as above. |
| **MapTransportationType** | Fuji | **No (short term)** | Transportation type mapping. Same as above. |

## 12go Storage

12go (the parent platform) maintains its own storage that overlaps significantly with Denali's:

### MySQL (12go)
- **Bookings:** Complete booking records including status, passenger data, pricing, cancellation policies, ticket URLs. This is the **authoritative source** for all confirmed bookings.
- **Operators/Routes:** Master operator and route catalog.
- **Users/Clients:** Client and authentication data.

### Redis (12go)
- **Search result caching:** Cached trip/itinerary data from suppliers.
- **Session data:** User session and funnel state.
- **Rate limiting and counters.**

### Key Overlap
The DynamoDB booking funnel caches (ItineraryCache, PreBookingCache, BookingCache) largely duplicate data that 12go stores in MySQL + Redis. The primary reason they exist is that Denali was designed to operate **independently** of 12go's internal systems, communicating only through SI APIs.

## Transition Considerations

1. **BookingCache is the critical coupling point.** Post-booking-service reads from DynamoDB BookingCache that booking-service writes. In transition, this cross-service dependency must be resolved first — either by:
   - Having post-booking read from 12go MySQL instead
   - Using events/messages instead of shared DynamoDB
   - Eliminating post-booking as a separate service

2. **Funnel state machine complexity.** The BookingCache table tracks `BookingFunnelStatus` and `CreditStatus` through a state machine (None → Reserved → Confirmed/Cancelled). This state management needs to either move to 12go or be preserved locally.

3. **Compressed binary data.** Itinerary, Segments, BookingSchema, and BookingData are GZip-compressed binary blobs in DynamoDB. Any migration must handle decompression.

4. **Fuji entity mapping is independent.** The Station/Operator/POI mapping tables serve the entire ecosystem, not just Denali. They should be migrated separately (or kept) regardless of booking flow changes.

5. **S3 ticket storage is integration-scoped.** Each integration stores tickets under its own prefix. This is relatively independent and could continue as-is or be replaced with 12go's ticket storage.

6. **PostgreSQL is the newest store.** BookingEntities was added as a durable persistence layer on top of DynamoDB caches. If 12go MySQL becomes authoritative, this PostgreSQL store becomes redundant.

## Open Questions

1. **Can the booking funnel be fully stateless?** If 12go APIs support reserve/confirm with enough context passed in each request, do we need any local state at all?
2. **What is the confirmation deadline mechanism in 12go?** The 1440-minute `ConfirmationDeadLine` in BookingCache controls when unconfirmed bookings expire. Does 12go handle this natively?
3. **How does 12go handle async confirmations?** The `IncompleteResults` and `ConfirmationInProcess` tables support async confirm flows. Is this needed in 12go's architecture?
4. **Can post-booking-service be eliminated entirely?** If 12go handles booking lifecycle (status updates, notifications, cancellations), is there still a need for a separate post-booking service?
5. **What is the data retention requirement for BookingEntityHistory?** The audit table captures every change. Does 12go have equivalent audit logging?
6. **What happens to Fuji entity mapping tables long-term?** Can 12go's CMS/station database replace Fuji's DynamoDB mapping tables?
7. **Is the GZip compression layer a tech debt?** The manual DynamoDB serialization with compression adds complexity. Any replacement should use a more standard approach.
