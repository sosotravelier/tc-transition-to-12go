# Static Data / Master Data Endpoint Group — Research

This file covers the three master data endpoints: **Stations**, **Operators (Operating Carriers)**, and **POIs (Points of Interest)**. These endpoints serve reference data that clients download periodically and use to populate their local caches for search and booking flows.

Per the recommended execution plan (recommendation.md), master data endpoints are scheduled for **Week 8** — after the core booking funnel is complete. They are outside the core Q2 deliverable (7 endpoints) and are part of the follow-on scope.

---

## Cross-Cutting Challenge: Station ID Mapping

**This is the most important issue affecting all three endpoints and the entire system.**

### The Problem

Two fundamentally different identifier spaces exist:

- **Fuji CMS IDs** — 8-character alphanumeric codes structured as `CountryCode(2)+CityCode(3)+StationCode(3)`, e.g. `ILTLVTLV`. These are what all existing clients use in search requests (`departures[]`, `arrivals[]`), booking references, and local caches.
- **12go native IDs** — integer `station_id` values from the 12go MySQL database auto-increment primary key. These are what 12go's B2B API (`/v1/{clientId}/itineraries`) expects and returns.

12go has **zero knowledge** of Fuji CMS IDs. A grep of the entire frontend3 PHP codebase for `fuji`, `cmsId`, `cms_id`, `mapperId`, `mapper_id` returned zero results. The 12go `Station` entity uses only integer `$stationId`.

The current mapping infrastructure lives entirely in the .NET services:
- **Fuji DynamoDB tables** — canonical mapping store with `(SourceId, SourceEntityId) -> CMSId` records
- **Etna StationV1 DynamoDB table** — bidirectional lookup for search-time translation (CMS->Supplier row and Supplier->CMS row per mapping)
- **Denali StationV1 DynamoDB table** — mirrors Etna pattern for booking-time lookup
- **Fuji Internal API** — `GET /Internal/GetMappedStation/{sourceId}` exposes the mapping tables to other services

### Q2 Scope Decision: New Clients Only — No Mapping Needed

For Q2, the scope is **new clients only**. New clients will be onboarded directly onto 12go native IDs. They will:
- Receive 12go integer station IDs from the master data endpoints
- Submit 12go integer station IDs in search requests
- See 12go integer station IDs in booking responses

This means **no Fuji-to-12go mapping table is needed for Q2**. The master data endpoints simply expose 12go's native data in the TC API response format.

### Future: Existing Client Migration (Two Approaches)

When existing clients migrate (post-Q2), the station ID problem must be solved. Two approaches exist:

**Approach (a) — Maintain a Fuji-to-12go mapping table on our side:**
- Extract the complete mapping from Fuji's DynamoDB tables (the `CMSId <-> SourceStationId` records where `SourceId = "OneTwoGo"`)
- Store it as a MariaDB table or equivalent accessible from within F3
- The B2B module translates inbound Fuji CMS IDs to 12go IDs before calling 12go services, and translates 12go IDs back to Fuji CMS IDs in responses
- Clients change nothing
- Risk: mapping table must be kept in sync if new stations are added. The current pipeline (SI Integration Job -> Kafka -> DynamoDB -> Kafka -> Etna/Denali mapper) would need a replacement mechanism
- Risk: no complete, authoritative mapping exists as a single exportable artifact today — it is spread across multiple DynamoDB tables

**Approach (b) — Tell clients to change their IDs:**
- Clients download the new master data feed (with 12go native IDs), update their local lookup tables, and start sending 12go IDs
- Requires coordination with every client. Some cooperate quickly, some do not (Shauly: "you have like 40 clients, they will need to do some changes, each one of them it will take time")
- Simpler on our side but creates external dependency and timeline risk
- Still needs a transition period where both ID spaces are accepted

**Where IDs appear** (all affected by the choice):
- Search request params: `departures[]`, `arrivals[]`, `departure_poi`, `arrival_poi`
- Search response fields: `from_station`, `to_station`, `operating_carrier_id` in Segment
- Booking request: itinerary ID with embedded station IDs (`internal_{from}-{to}-{goDate}-{duration}-{classId}-{officialId}`)
- Booking response: `from_station`, `to_station` in Segment
- Master data feeds: the `Id` field in every station/operator/POI object

### Additional Mapping Dimension: Seat Classes and Vehicle IDs

Station/operator/POI mapping is not the only ID translation needed. The 2026-03-12 meeting revealed:
- **Seat class IDs** — 12go returns integer class IDs that are mapped via `ISeatClassConverter` (Fuji SDK) through a chain: `ClassIdMapper` -> `SeatClassConverter` -> Fuji's `/MapClasses` endpoint. No client-facing seat class master data API exists.
- **Vehicle IDs** — constructed from operator + vehicle type. Being created by Levan in a pattern similar to station/operator mappers.

These are separate from the master data endpoints but follow the same ID reconciliation pattern.

---

## Cross-Cutting Challenge: API Key Transition

### The Problem

The current system authenticates clients via `client_id` (URL path segment) + `x-api-key` (HTTP header), validated at the AWS API Gateway. 12go authenticates via a single `?k=<apiKey>` query parameter validated against its MySQL `apikey` table. No direct mapping between the two systems exists as a single artifact.

The current bridge: per-client 12go API keys are stored in at least three separate configuration stores:
- `booking-service`: `BookingApi:12GoApiKey:<clientId>` in AWS AppConfig
- `etna`: `Connector:OneTwoGo:Clients:<CLIENT_ID_UPPERCASED>-<GUID>:ApiKey` in AWS AppConfig
- `supply-integration`: per-contract credentials in Postgres `SiContractClientCredentials` table

### Shauly's Preferred Approach (from Mar 12 meeting)

**Approach B — Clients adopt 12go API keys directly.** Shauly called this "the easy solution." For new clients (Q2 scope), this is straightforward: they are issued a 12go API key from the start.

For existing clients, an alternative exists: copy TC API keys into 12go's database directly (Shauly noted the format appears compatible and there is an admin UI for key management).

### Implication for Master Data Endpoints

The master data endpoints currently use `client_id` in the URL path (`/v1/{client_id}/stations`). In the Team-First Developer design, authentication is handled by a `ClientKeyResolver` service that maps incoming credentials to 12go API keys. The master data endpoints themselves do not need per-client data differentiation (the station/operator/POI data is the same for all clients), but the authentication layer must still validate the caller.

---

## Cross-Cutting Challenge: Client Migration Process

The overall client migration process (from Mar 12 meeting) involves:
1. API key change (new key or transparent mapping)
2. Base URL change (new endpoints)
3. Booking ID format change (12go integer `bid` instead of TC encrypted KLV)
4. Station/operator/POI ID changes (if existing clients)

For Q2 (new clients only), items 1-3 are handled by onboarding directly onto the new system. Item 4 does not apply. The full client migration process (for existing clients) is not yet defined.

---

## Endpoint 1: Stations

### One-line description

Returns a complete list of all stations (bus stops, train stations, ferry terminals, shuttle points) with names, addresses, coordinates, and transport type, used by clients to build local station lookup tables and submit station IDs in search/booking requests.

### Current data source (12go API calls / F3 internal)

**Source of truth:** 12go MySQL `station` table.

**Current pipeline (being replaced):**
1. `OneTwoGoDbWrapper` REST service: `GET /stations?fromStationId={id}&pageSize=100` — paginated cursor-based reads from 12go MySQL
2. `OneTwoGoIntegrationApi` — normalizes via `IDataNormalizer<StationDto>`
3. SI Integration Job — transforms to `StationReceived` Kafka messages
4. Entity Mapper / DynamoDB Writer — consumes Kafka, writes to DynamoDB
5. DataWriter Lambda — writes locale-specific station JSON snapshots to S3
6. Exposure API — generates pre-signed S3 URL for client download

**12go raw station data** is richer than what is exposed. Key fields: `StationId` (int), `StationName` (string), `StationNameTh/Ru/Cn/Zh/Jp/Ko/Vi/Ms/It/Nl/Sv/De/Fr/Es/In/Uk/Pt/Ar/Hr` (localized names per locale), `Lat/Lng` (coordinates), `CountryCode`, `StationCode`, `StationAddress`, `TimezoneName`, `ProvinceId/ProvinceName` (links to POIs), `Hub/Major` (importance flags), `MapStations` (integration supplier mappings), `TranslineId`.

**New approach (F3/B2B module):** The B2B module inside F3 can access the station data directly from 12go's MySQL database (or through 12go's internal services within the monolith). No external API call is needed — F3 is the 12go application. The 12go `StationRepository` queries the `station` table directly.

### F3 internal services to call (Team-First Developer design)

Per the Team-First Developer design:
- **`MasterDataController.php`** — handles the `/stations` endpoint (along with operators and POIs)
- **`TwelveGoClient.php`** — typed HTTP client for 12go internal API calls. However, since the B2B module lives inside F3, station data can be accessed via F3's existing `StationRepository` or internal service layer rather than making HTTP calls.
- The response must be transformed from 12go's internal station format to the TC API response format (Fuji `StationDto` shape).

The key insight: since the module lives inside the F3 monolith, it can call 12go's internal services directly (within the same application). No external HTTP round-trip needed for master data reads.

### Known challenges

| Challenge | Severity | Details |
|---|---|---|
| **Station ID format change** | **Blocking (for existing clients) / Low risk (for new clients)** | Existing clients expect Fuji CMS IDs (8-char alphanumeric like `ILTLVTLV`). 12go returns integer `station_id`. For Q2 (new clients only), this is not an issue — new clients receive 12go native IDs. For existing client migration, this is blocking without a mapping table or client-side changes. |
| **Response shape transformation** | **Manageable** | The current TC API returns a nested object with `id`, `name`, `name_alterations`, `transportation_type`, `address` (with nested `city`, `coordinate`), `keywords`, `description`, `images`. 12go's raw data has different field names and structure. A mapper is needed but straightforward. |
| **Localization** | **Manageable** | 12go stores localized station names as separate columns per locale (`StationNameTh`, `StationNameRu`, etc.). The current system serves locale-specific snapshots. The new endpoint must accept a `locale` parameter and return the correct localized names. |
| **Pre-signed S3 URL delivery pattern** | **Manageable** | The current contract returns a pre-signed S3 URL (string), not the station data directly. Clients download the JSON from S3. If the new endpoint returns data directly (as JSON array), this is a contract change. However, `GetList` already returns data directly as JSON, so clients may already support both patterns. |
| **Data volume / performance** | **Low risk** | The station list is large enough that the current system serves it via S3 pre-signed URLs. The `GetList` endpoint exists as an alternative that returns data directly. For Q2, returning data directly (or via a cached file) is acceptable. |
| **Sync frequency / staleness** | **Low risk** | The current pipeline runs daily. Since the B2B module reads directly from 12go's database, data is always fresh — no sync delay. |

### Proposed approach (presumptive)

1. **Week 8 implementation** (per execution plan): Create `MasterDataController.php` with a `GET /b2b/v1/{clientId}/stations` endpoint.
2. **Data access:** Query 12go's station data via F3's internal `StationRepository` or equivalent service. No external HTTP call needed.
3. **Response format:** Transform to TC API `StationDto` shape. Use 12go native integer IDs as the `id` field (since Q2 = new clients only).
4. **Localization:** Accept `locale` query parameter, select the appropriate localized name column.
5. **Delivery:** Return JSON array directly (matching the `GetList` pattern). Consider caching the full response in Redis/APCu with a TTL matching 12go's data update frequency. If pre-signed S3 URL pattern is required for contract compatibility, generate a cached file and return a URL to it.
6. **No Fuji CMS ID mapping** for Q2. Document the mapping table approach for future existing-client migration.

### Open questions

1. **Which delivery pattern must be preserved?** Pre-signed S3 URL (current default) or direct JSON (GetList)? Do new clients care which one they get?
2. **What is the exact station data volume?** How many stations exist in 12go's database? If it is tens of thousands, direct JSON response may need pagination or caching.
3. **Is the `GetList` endpoint with `top10K` parameter used by any client?** If so, must it be replicated?
4. **Which F3 internal service provides station data?** Need to identify the exact Symfony service/repository in F3 that reads from the station table.
5. **Stale station deletion:** The current system deletes stations not updated within N days (`MappingServices.DeleteStaleStations()`). Is this logic needed, or does 12go handle station lifecycle internally?
6. **`MapStations` data:** The raw 12go station includes integration supplier mappings. Is this needed by any B2B client, or is it internal-only?

---

## Endpoint 2: Operators (Operating Carriers)

### One-line description

Returns a complete list of all operating carriers (bus companies, ferry operators, train services) with names, logos, contact info, vehicle classes, and transport types, used by clients to display carrier details in search results and booking confirmations.

### Current data source (12go API calls / F3 internal)

**Source of truth:** 12go MySQL operator/tour-operator tables.

**Current pipeline (being replaced):**
1. `OneTwoGoDbWrapper` REST service: `GET /tourOperators?fromOperatorId={id}&pageSize=100` — paginated cursor-based reads
2. `OneTwoGoIntegrationApi` — normalizes via `IDataNormalizer<OperatorDto>`
3. `MultiTransportOperatorService` — validates (`CanMapOperator`), splits multi-transport operators, transforms to `OperatingCarrierReceived`
4. SI Integration Job publishes to Kafka
5. Entity Mapper / DynamoDB Writer — consumes Kafka, writes to DynamoDB
6. Exposure API — generates pre-signed S3 URL for download

**12go raw operator data** includes: `OperatorId` (int), `OperatorName`, `OperatorNameLocal`, `CountryCode`, `Url`, `Phone`, `Email`, `OperatorAddress`, `CompanyName`, `Lat/Lng`, `IntegrationType`, `Bookable`, `VehclassId`, `VehicleClasses[]`, `MapOperators[]`, `Topup/MinTopup/MaxTopup` (pricing), `Fxcode` (currency), `Handler` (PHP handler class), `PhpClassName` (legacy integration class).

**New approach (F3/B2B module):** Access operator data directly from 12go's internal services within the F3 monolith.

### F3 internal services to call (Team-First Developer design)

- **`MasterDataController.php`** — handles the `/operating_carriers` endpoint
- Data accessed via F3's internal operator service/repository (within the monolith)
- The `MultiTransportOperatorService` transformation (splitting a single operator into multiple transport types) may need to be replicated if the TC API contract expects the split format. Alternatively, the `TransportationTypes` array in the response can carry multiple types per operator.

### Known challenges

| Challenge | Severity | Details |
|---|---|---|
| **Operator ID format change** | **Manageable** | Less critical than stations. Operator IDs are primarily used for display (matching carrier details to search results). Clients reference `operating_carrier_id` in search response segments but do not submit operator IDs in requests. For new clients (Q2), 12go native integer IDs are fine. |
| **Multi-transport transformation** | **Manageable** | A single 12go operator can support multiple transport types (Bus, Ferry, Train, Shuttle). The current Fuji layer splits these into the `TransportationTypes` array. This logic must be replicated or the response shape adjusted. |
| **Vehicle class enrichment** | **Manageable** | The TC API response includes nested `VehicleDto[]` with amenities, images, and product classes. 12go stores vehicle classes separately, linked by operator ID. The enrichment must be replicated. |
| **`CanMapOperator` validation** | **Low risk** | The current pipeline filters out operators with invalid names or data. This validation may or may not be needed — 12go's own data quality may be sufficient. |
| **Response shape transformation** | **Manageable** | Different field names/structure between 12go raw data and TC API `OperatingCarrierDto`. A mapper is needed but straightforward. |

### Proposed approach (presumptive)

1. **Week 8 implementation** (same controller as stations): `GET /b2b/v1/{clientId}/operating_carriers` endpoint.
2. **Data access:** Query operator data via F3's internal service layer. No external HTTP call.
3. **Response format:** Transform to TC API `OperatingCarrierDto` shape. Use 12go native integer IDs.
4. **Multi-transport:** Replicate the `TransformForMultiTransportation` logic — populate `TransportationTypes` array per operator.
5. **Vehicle classes:** Include nested vehicle class data by joining operator and vehicle class tables.
6. **Caching:** Same pattern as stations — cache the full response with appropriate TTL.

### Open questions

1. **Is the `MainCarrierId` field used by clients?** The TC DTO includes `MainCarrierId` (parent carrier reference). How is this populated and is it needed?
2. **Vehicle class data source in F3:** Where does F3 store vehicle class information? Is there an existing service that provides enriched operator+vehicle data?
3. **Operator-station relationship:** The raw 12go operator data includes a `StationId` field. What is this used for?
4. **Pricing fields (Topup, MinTopup, MaxTopup):** Present in raw data but not in exposed DTO. Are they used elsewhere in the flow?
5. **How many operators are rejected by `CanMapOperator`?** If significant, the validation must be replicated; if minimal, it can be skipped.

---

## Endpoint 3: POIs (Points of Interest)

### One-line description

Returns a list of points of interest (which in the 12go context are Thai administrative provinces/regions), each associated with multiple stations, allowing clients to search broadly by region (e.g., "all routes to Chiang Mai province") instead of specifying exact station IDs.

### Current data source (12go API calls / F3 internal)

**Source of truth:** 12go MySQL `provinces` table.

**Current pipeline (being replaced):**
1. `OneTwoGoDbWrapper` REST service: `GET /provinces?fromProvinceId={id}&pageSize=2000` — paginated reads
2. `OneTwoGoIntegrationApi.GetProvinces()` — fetches from wrapper
3. `POIService.HandlePOI()` — transforms provinces to `POIReceived` Kafka messages
4. `MappingServices.MapPoisStation()` — **separately** computes the POI-to-station mapping:
   - Fetches all POIs and all stations from DynamoDB
   - For 12go POIs: matches by **province name** (`station.SourceAddress.Province == poi.POIName`) — exact string comparison
   - For other sources: matches by **Country + State + City**
   - Supports hierarchy: child POI stations bubble up to parent POIs (max 3 levels)
   - Sends mapping as `BatchPoiStation` Kafka messages (batches of 100)
5. Data Writer stores to DynamoDB, exports to S3
6. Exposure API serves pre-signed S3 URL

**12go raw province data:** `Id` (int), `ParentId` (int, nullable — hierarchical), `Name` (string), `Country` (string). Minimal fields.

**Critical complexity:** The POI-to-station mapping is **computed by Fuji** — it does not exist in 12go's raw data. 12go has provinces and stations as separate entities. The association is built by matching province name to station's province field at string level. This is the most complex part of the POI pipeline.

**New approach (F3/B2B module):** Access province data from 12go's internal database. The POI-to-station mapping logic must be replicated or replaced.

### F3 internal services to call (Team-First Developer design)

- **`MasterDataController.php`** — handles the `/pois` endpoint
- Province data accessed via F3's internal database queries
- **The POI-to-station mapping must be computed.** Options:
  - Query stations table joined with provinces table on province name/ID
  - If 12go's station table has a `ProvinceId` foreign key (the raw 12go `StationDto` includes `ProvinceId`), use that for direct joins instead of string matching
  - Cache the computed mapping

### Known challenges

| Challenge | Severity | Details |
|---|---|---|
| **POI-to-station mapping computation** | **Manageable (but most complex of the three endpoints)** | The current system builds the mapping via string comparison between POI name and station province field. If 12go's station table has a `ProvinceId` FK, a direct join is simpler and more reliable. If not, string matching must be replicated. |
| **OpenAPI spec does not include `/pois`** | **Low risk** | The endpoint exists only in code. The OpenAPI model defines `stations`, `coordinates`, `keywords`, `images` fields, but the actual `POIDto` in the Exposure API only has `Id` and `Name`. The station list is attached separately via the mapping pipeline. |
| **Exposed DTO is minimal** | **Low risk** | The current `POIDto` only exposes `Id` and `Name`. The richer fields defined in the OpenAPI model (`stations`, `coordinates`, `keywords`, `images`) are not populated in the actual DTO. This simplifies the implementation. |
| **Province hierarchy** | **Low risk** | POIs can have parent-child relationships (`ParentId`). Stations from child POIs bubble up to parent POIs. The code supports 3 levels max. Whether this hierarchy is actually used in practice is unclear. |
| **Is the POI concept needed at all?** | **Low risk (but worth validating)** | If clients can search by a list of station IDs, do they need the POI abstraction? Or is "search by province" a key UX feature? The answer determines whether this endpoint is truly needed or can be simplified. |

### Proposed approach (presumptive)

1. **Week 8 implementation** (same controller): `GET /b2b/v1/{clientId}/pois` endpoint.
2. **Data access:** Query 12go's `provinces` table via F3's internal service layer.
3. **POI-to-station mapping:** If 12go's station table has a `ProvinceId` FK (confirmed in raw data: `ProvinceId int?` exists), use a direct SQL join (`SELECT station_id FROM station WHERE province_id = ?`). This is simpler and more reliable than the current string-matching approach.
4. **Response format:** Return `Id` (12go province integer ID) and `Name`. Include `stations` array (list of station IDs in this province) if the TC API contract requires it.
5. **Hierarchy:** Support `ParentId` for parent-child province relationships. Aggregate child stations into parent POIs.
6. **Caching:** Cache the full POI list + station mappings with appropriate TTL. Province data changes infrequently.

### Open questions

1. **Does `ProvinceId` in the station table reliably link to the province?** If so, this is a simple join. If not (if the current string-matching approach exists because the FK is unreliable), the complexity increases.
2. **How many provinces exist?** Is the full dataset small enough to return in a single response?
3. **How many POIs have no stations?** The current pipeline logs "Could not find stations for poi" — is this common?
4. **Is the `stations` array expected in the POI response?** The OpenAPI model defines it, but the actual DTO only has `Id` and `Name`. Clients may or may not need the station list as part of the POI response (vs. only using it internally during search expansion).
5. **Multi-source POI matching:** The current code has separate matching logic for "OneTwoGo" vs other sources. Are there other POI sources besides 12go? If not, the simpler province-name or ProvinceId-based matching is sufficient.
6. **Who consumes `BatchPoiStation` Kafka messages?** The POI-station mapping is currently published to Kafka. Understanding the consumer helps determine whether this mapping must be accessible outside the B2B module.

---

## Summary: Implementation Priority and Effort

| Endpoint | Estimated Effort | Complexity Driver | Q2 Priority |
|---|---|---|---|
| **Stations** | 1-2 days | Response shape transformation, localization | Medium (follow-on after booking funnel) |
| **Operators** | 1-2 days | Multi-transport split, vehicle class enrichment | Medium (follow-on) |
| **POIs** | 2-3 days | POI-to-station mapping computation | Lower (depends on client need) |

**Total: ~5-7 days for all three endpoints** (Week 8 in the execution plan).

All three endpoints follow the same pattern:
1. Read from 12go's internal data via F3 services (no external HTTP calls needed)
2. Transform to TC API response shape
3. Return 12go native IDs (Q2 = new clients only)
4. Cache aggressively (master data changes infrequently)

The **station ID mapping** is the only blocking cross-cutting concern, and it is deferred for Q2 by scoping to new clients only. The mapping table approach (Approach a) should be designed during Q2 even if implementation is deferred, because the Fuji DynamoDB tables (the source of mapping data) may become unavailable as .NET services are decommissioned.
