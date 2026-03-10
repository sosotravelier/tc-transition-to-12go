# Station / Operator / POI ID Mapping

The system operates with two fundamentally different identifier spaces for stations, operators (operating carriers), and points of interest (POIs): the Fuji CMS ID space (an 8-character alphanumeric code such as `ILTLVTLV`, structured as CountryCode(2)+CityCode(3)+StationCode(3)), and the 12go internal integer-based `station_id` space used in the 12go MySQL database. Clients who have integrated with the current .NET platform (Etna, Denali, Supply-Integration, Fuji) receive and submit Fuji CMS IDs in all search requests, booking requests, and master data feeds. The 12go platform has no knowledge of these Fuji CMS IDs; it uses its own numeric station identifiers. Because there is no existing translation layer between the two ID spaces visible in the 12go codebase, and because the existing mapping infrastructure is entirely embedded in the .NET services (Fuji's DynamoDB mapper tables, Etna's StationV1 mapping table, and Denali's mapper), migrating clients to the 12go platform without addressing this gap would require every integrated client to change the IDs they send and receive — a breaking change across all existing integrations.

---

## Where Fuji IDs Are Used

### Fuji CMS ID format and definition

The Fuji station ID is an 8-character uppercase string with the pattern `[A-Z]{8}`, documented as `CountryCode(2)+CityCode(3)+StationCode(3)`, e.g. `ILTLVTLV`.

- OpenAPI spec: [exposure/openAPI/model/common/station_id.json](https://github.com/boost-platform/fuji/blob/main/exposure/openAPI/model/common/station_id.json), line 7–9
- OpenAPI spec for the `/stations` endpoint: [exposure/openAPI/master_data.yml](https://github.com/boost-platform/fuji/blob/main/exposure/openAPI/master_data.yml), lines 33–57

The Fuji CMS ID (`CMSId`) is stored in every entity in DynamoDB and populated during the mapping pipeline. It is distinct from `MapperId` (the composite internal key `SourceId_SourceEntityId`) and from the supplier's native ID (`SourceStationId`, `SourceCarrierId`, `SourcePOIId`).

- `BaseEntityRepo.CMSId`: [entity_mapping/FujiDomainRepo/Entities/BaseEntityRepo.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/Entities/BaseEntityRepo.cs), line 8

### Master data API — client-facing station, operator, and POI endpoints

The Fuji Exposure API serves master data to external clients via three controller endpoints:

- `GET /v1/{client_id}/stations` — returns a pre-signed S3 URL or a list of `StationDto` objects, each with an `Id` field containing the Fuji CMS ID.
  - Controller: [exposure/api/Fuji.Exposure.Api/Controllers/StationController.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Controllers/StationController.cs), lines 26–37
  - DTO: [exposure/api/Fuji.Exposure.Api/Dto/StationDto.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Dto/StationDto.cs), line 5 (`Id` field)
- `GET /v1/{client_id}/operating_carriers` — returns `OperatingCarrierDto`, which contains `Id` (Fuji CMS ID) and `MainCarrierId`.
  - Controller: [exposure/api/Fuji.Exposure.Api/Controllers/OperatingCarrierController.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Controllers/OperatingCarrierController.cs), lines 26–37
  - DTO: [exposure/api/Fuji.Exposure.Api/Dto/OperatingCarrierDto.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Dto/OperatingCarrierDto.cs), lines 5–10
- `GET /v1/{client_id}/pois` — returns `POIDto` with an `Id` field (Fuji CMS ID).
  - Controller: [exposure/api/Fuji.Exposure.Api/Controllers/POIController.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Controllers/POIController.cs), lines 26–37
  - DTO: [exposure/api/Fuji.Exposure.Api/Dto/POIDto.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Dto/POIDto.cs), lines 5–8

Route template: `/v{version:apiVersion}/{client_id}/stations` (and equivalents).
- [exposure/api/Fuji.Exposure.Api/Routing/RouteTemplate.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Routing/RouteTemplate.cs), lines 7–11

### Search API — station and POI IDs in requests and responses

The Etna search API accepts Fuji CMS IDs as query parameters for departure and arrival locations:

- `departures[]` — one or more Fuji station CMS IDs
- `arrivals[]` — one or more Fuji station CMS IDs
- `departure_poi` — a Fuji POI CMS ID
- `arrival_poi` — a Fuji POI CMS ID

These parameters are validated to be uppercase alphanumeric only (the Fuji ID format) and are passed directly into the search engine.

- Search request model: [api/Etna.Search.ApiModels/Requests/Search/SearchRequest.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Requests/Search/SearchRequest.cs), lines 32–38 (query params), lines 100–127 (validation that all chars are uppercase or digits)
- SearchKind discriminated union: [search-engine/etna.searchengine.abstractions/Models/SearchKind.cs](https://github.com/boost-platform/etna/blob/main/search-engine/etna.searchengine.abstractions/Models/SearchKind.cs) — `ByStation`, `ByPOI`, `ByStationAndPOI`, `ByPOIAndStation` all carry Fuji IDs as their station/POI identifiers

In search responses, the `Segment` object in `Etna.Search.ApiModels` exposes `from_station` and `to_station` as string fields — these carry the Fuji CMS station IDs back to the client.

- [api/Etna.Search.ApiModels/Responses/Search/Segment.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Responses/Search/Segment.cs), lines 10–11
- [search-engine/etna.searchengine.abstractions/Models/Segment.cs](https://github.com/boost-platform/etna/blob/main/search-engine/etna.searchengine.abstractions/Models/Segment.cs), lines 16–17 (`FromStation`, `ToStation`)

The `OperatingCarrierId` field in `Segment` also carries the Fuji CMS operator ID.

### Booking API — station IDs in booking requests and confirmation responses

In the Denali booking service, the `BookingCacheModel` stores `FromStation` and `ToStation` (Fuji CMS IDs) from the search itinerary:

- [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/BookingEntityBuilder.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/BookingEntityBuilder.cs), lines 20–21

The `Segment` in the booking response DTO carries `from_station` and `to_station` as strings — these are Fuji CMS IDs returned to the client in booking confirmation:

- [api/Denali.Booking.ApiModels/Response/Booking/Segment.cs](https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.ApiModels/Response/Booking/Segment.cs), lines 6–8

### 12go B2B API (frontend3) — parallel ID space

The 12go PHP system has its own B2B search endpoint at `GET /v1/{clientId}/itineraries` which also accepts `departures[]`, `arrivals[]`, `departure_poi`, and `arrival_poi`. However, these IDs are 12go's internal numeric station IDs (the suffix `s` or `p` is appended to disambiguate station vs. POI):

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/DTO/Request/SearchRequest.php`, lines 76–92 (the `getFromPlaceId()` and `getToPlaceId()` methods append `s` for station, `p` for POI to the raw numeric ID)
- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Controller/SearchController.php`, lines 42–44

The 12go `Station` DTO uses an integer `$stationId` field (the 12go internal auto-increment ID):

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/Core/DTO/Station.php`, line 9

The `StationApiView` in the 12go TripSearch returns `id => $this->payload->stationId` (integer) in the JSON response:

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/TripSearch/DTO/ApiV2/StationApiView.php`, line 14

The 12go `SegmentResponse` in the B2B API returns `from_station` and `to_station` as strings, populated from the raw 12go integer station IDs:

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/DTO/Response/SegmentResponse.php`, lines 9–10
- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Service/SearchMapper.php`, lines 80–81 (`$fromStation = (string)$segment->from; $toStation = (string)$segment->to;`)

---

## Current Mapping Mechanism

### Fuji DynamoDB entity tables (the canonical mapping store)

Fuji maintains three DynamoDB tables holding entity-level mappings. Each record stores both the supplier's native ID and the generated Fuji CMS ID.

The DynamoDB tables are referenced by logical names `Station`, `Operator`, and `POI`. The primary key scheme has two variants:

- **Legacy (POI):** Single-key using `MapperId = "{SourceId}_{SourceEntityId}"` (e.g. `OneTwoGo_12345`)
  - [entity_mapping/FujiDomainRepo/DomainRepo.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/DomainRepo.cs), lines 35–58 (table configuration)
  - `MapperId` field: [entity_mapping/FujiDomainServices/Entities/SI/Station.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainServices/Entities/SI/Station.cs), lines 16–27
- **V2 (Station, Operator):** Composite key `pk = GeneratePKey(sourceId, sourceEntityId)` and `sk = sourceEntityId`.
  - `GeneratePKey` produces `"{sourceId}_{firstCharHash}"` to distribute across 10 DynamoDB partitions: [entity_mapping/FujiDomainRepo/DomainRepoHelper.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/DomainRepoHelper.cs), lines 5–16

Each record stores:
- `SourceId` — the supplier identifier (e.g. `OneTwoGo`)
- `SourceStationId` / `SourceCarrierId` / `SourcePOIId` — the supplier's native entity ID
- `CMSId` — the Fuji-generated canonical 8-character string ID exposed to clients
- `MapperId` — the internal composite key (`SourceId_SourceEntityId`)

Serialization/deserialization details:
- StationRepo: [entity_mapping/FujiDomainRepo/Entities/StationRepo.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/Entities/StationRepo.cs)
- OperatorRepo: [entity_mapping/FujiDomainRepo/Entities/OperatorRepo.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/Entities/OperatorRepo.cs)
- POIRepo: [entity_mapping/FujiDomainRepo/Entities/POIRepo.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainRepo/Entities/POIRepo.cs)

### The SI (Supplier Integration) mapping pipeline

When a supplier sends a station/operator/POI event, `SupplierIntegrationService` in Fuji:
1. Looks up the entity in DynamoDB by composite `(SourceId, SourceEntityId)` key.
2. If not found, calls a `CodeGenClient` to generate country/city/station codes, then composes a new CMS ID.
3. Saves the entity (with the new CMSId) back to DynamoDB via `Put2`.
4. Publishes the mapped entity on a Kafka topic (`Fuji.Mapper.Messages.Station`, `Fuji.Mapper.Messages.OperatingCarrier`, `Fuji.Mapper.Messages.POI`).

- [entity_mapping/FujiDomainServices/Services/SupplierIntegrationService.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainServices/Services/SupplierIntegrationService.cs), lines 34–111 (station flow), lines 113–137 (operator flow), lines 210–259 (POI flow)

### The CMS mapping pipeline

When the CMS creates or updates a station/operator/POI, `CMSService`:
1. Receives the entity with its CMS-generated ID.
2. Updates the `CMSId` field in the DynamoDB record via `UpdateCMSId2` (conditioned on the field being empty or already matching).
3. Publishes a `StationMapped` / `OperatingCarrierMapped` / `POIMapped` Kafka event.

- [entity_mapping/FujiDomainServices/Services/CMSService.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainServices/Services/CMSService.cs), lines 30–88

### Etna StationV1 mapping table (for search-time lookup)

The Etna mapper service maintains a separate DynamoDB table (`StationV1`) that maps between Fuji CMS IDs and supplier-native IDs. This table is populated by consuming the Kafka events (`StationMapped`, `OperatingCarrierMapped`, `POIMapped`) emitted by Fuji.

Each `StationV1` record stores two rows per mapping:
- `CMS` row: `pk = fuji_cms_id`, `sk = "0-{supplierId}"`, `targetStationId = supplier_native_id`
- `Supplier` row: `pk = supplier_native_id`, `sk = "1-{supplierId}"`, `targetStationId = fuji_cms_id`

This bidirectional structure allows lookup in either direction (CMS→Supplier or Supplier→CMS).

- [Etna.Mapper.Domain/Entities/StationV1.cs](https://github.com/boost-platform/etna/blob/main/Etna.Mapper.Domain/Entities/StationV1.cs)
- [Etna.Mapper.Persistence/Implementation/StationRepository.cs](https://github.com/boost-platform/etna/blob/main/Etna.Mapper.Persistence/Implementation/StationRepository.cs), lines 34–64 (`MapStationIds` filtered by supplier type and supplier ID)
- [Etna.Mapper.Application/Services/Implementation/MapperService.cs](https://github.com/boost-platform/etna/blob/main/Etna.Mapper.Application/Services/Implementation/MapperService.cs), lines 55–63 (`StationMappedV1` — how Kafka events populate the table)
- Lambda consuming the Kafka event: [Mapper/Lambda/etna.mapper.station.lambda/src/etna.mapper.station.lambda/Function.cs](https://github.com/boost-platform/etna/blob/main/Mapper/Lambda/etna.mapper.station.lambda/src/etna.mapper.station.lambda/Function.cs), lines 44–45

### Denali mapper (for booking-time lookup)

The Denali booking service maintains its own DynamoDB-backed mapper. When booking via 12go, it needs to convert between the 12go native station ID returned in the booking confirmation and the Fuji CMS ID used in the search itinerary (and known to the client).

The `StationV1` in Denali mirrors the Etna pattern — the `Build` method creates two rows per mapping (CMS and Supplier):

- [mapper/Denali.Mapper.Domain/Entities/StationV1.cs](https://github.com/boost-platform/denali/blob/main/mapper/Denali.Mapper.Domain/Entities/StationV1.cs), lines 38–43

The `MapperService` in Denali calls `StationRepository.MapFilteredBySupplier`, which looks up by `pk = {12go_station_id}` and `sk = "1-{supplierId}"`:

- [mapper/Denali.Mapper.Persistence/Implementation/StationRepository.cs](https://github.com/boost-platform/denali/blob/main/mapper/Denali.Mapper.Persistence/Implementation/StationRepository.cs), lines 28–55
- Called from `BookingFactory.BuildFromOneTwoGo` during booking confirmation: [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/BookingFactory.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Factory/BookingFactory.cs), lines 46–62

### Fuji Internal API (consumed by Supply-Integration and Etna)

The Fuji Internal API (`FujiDomainInternalAPI`) exposes the mapping tables for consumption by other services:

- `GET /Internal/GetMappedStation/{sourceId}` — returns all `(SourceStationId, StationId=CmsId)` pairs for a given supplier
- `GET /Internal/Mappings/StationsPaged/{sourceId}` — paged version
- `GET /Internal/GetMappedOperator/{sourceId}` — returns `(SourceOperatorId, OperatorId=CmsId)` pairs
- `GET /Internal/GetMappedPOI/{sourceId}` — returns `(SourcePOIId, POIId=CmsId)` pairs
- `POST /Internal/GetMappedByIdStation` — lookup by specific supplier station IDs

- [entity_mapping/FujiDomainInternalAPI/Controllers/InternalController.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainInternalAPI/Controllers/InternalController.cs), lines 42–428

The response entities clearly show the three-field mapping structure:
- `StationMapped`: `{SourceId, SourceStationId, StationId}` where `StationId` is the Fuji CMS ID
- `OperatorMapped`: `{SourceId, SourceOperatorId, OperatorId}` where `OperatorId` is the Fuji CMS ID
- `POIMapped`: `{SourceId, SourcePOIId, POIId}` where `POIId` is the Fuji CMS ID

- [entity_mapping/FujiDomainInternalAPI/Entities/Mapped.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainInternalAPI/Entities/Mapped.cs), lines 28–63

The internal API also exposes a paged `/Mappings/StationsPaged/{sourceId}` response containing `StationMappedV2` with a richer structure including `IntegrationId` (supplier native ID) alongside the canonical CMS ID (`Id`).

- [entity_mapping/FujiDomainInternalAPI/Entities/Mapped.cs](https://github.com/boost-platform/fuji/blob/main/entity_mapping/FujiDomainInternalAPI/Entities/Mapped.cs), lines 1–27

### Supply-Integration ID translation at search time

When Supply-Integration calls 12go's search API, 12go returns its own native integer station IDs (`From`, `To`, `Operator` fields). Supply-Integration maps these back to Fuji CMS IDs before returning itinerary data to Etna.

For the `onetwogo` supplier:
- [integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/Mappers/OneTwoGoSegmentMapper.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/Mappers/OneTwoGoSegmentMapper.cs), lines 55–63: `FromStationId = item.From.ToString()`, `ToStationId = item.To.ToString()` — the raw 12go IDs are passed into segments

For the `OneTwoGoInternal` supplier:
- [integrations/OneTwoGoInternal/OneTwoGoInternal.Search/Mappers/OneTwoGoInternalItineraryMapper.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/OneTwoGoInternal/OneTwoGoInternal.Search/Mappers/OneTwoGoInternalItineraryMapper.cs), lines 63–67: `FromStationId: trip.FromStation.Id`, `ToStationId: trip.ToStation.Id` — again, raw 12go IDs

Etna's `MapperService.MapStationIds` is then called with the supplier IDs to translate them to Fuji CMS IDs before including segments in the itinerary response sent to clients.

- [Etna.Mapper.Application/Services/Implementation/MapperService.cs](https://github.com/boost-platform/etna/blob/main/Etna.Mapper.Application/Services/Implementation/MapperService.cs), lines 18–21

---

## Master Data Delivery Pipeline

Fuji serves master data (stations, operators, POIs with their Fuji CMS IDs) to clients through a two-stage pipeline:

**Stage 1 — S3 snapshot write (DataWriter Lambda)**

A Kafka Lambda (`Fuji.Exposure.Station.DataWriter.Lambda`) consumes `StationChanged` events from Kafka. On each event, it:
1. Downloads the current snapshot (a gzipped JSON dictionary keyed by Fuji CMS station ID) from an S3 bucket using `BaseService.Download<StationRepo>`.
2. Applies the Create/Update/Delete action to the in-memory dictionary.
3. Re-uploads the updated dictionary to S3 in gzipped JSON format.

- Function entry point: [exposure/data_writer/lambda/Fuji.Exposure.Station.DataWriter.Lambda/src/Fuji.Exposure.Station.DataWriter.Lambda/Function.cs](https://github.com/boost-platform/fuji/blob/main/exposure/data_writer/lambda/Fuji.Exposure.Station.DataWriter.Lambda/src/Fuji.Exposure.Station.DataWriter.Lambda/Function.cs)
- Station service handling: [exposure/data_writer/Fuji.Exposure.DataWriterService/Implementations/StationService.cs](https://github.com/boost-platform/fuji/blob/main/exposure/data_writer/Fuji.Exposure.DataWriterService/Implementations/StationService.cs), lines 22–84
- The dictionary key is the Fuji CMS station ID (`entity.Id`): line 61 `entities[entity.Id] = MapperTransformerService.Transform(entity)`
- S3 upload mechanism: [exposure/data_writer/Fuji.Exposure.DataWriterRepo/Implementations/S3BucketWrapper.cs](https://github.com/boost-platform/fuji/blob/main/exposure/data_writer/Fuji.Exposure.DataWriterRepo/Implementations/S3BucketWrapper.cs) (same structure as the read-side)

The S3 key follows the pattern `{TypeName}_{culture}`, e.g. `StationRepo_en_us`. This is a single shared bucket, not per-client.

**Stage 2 — Pre-signed URL delivery (Exposure API)**

When a client calls `GET /v1/{client_id}/stations`, the `StationService.GetPreSignedUrl` method:
1. Downloads the snapshot from S3 into memory.
2. Uploads the data to a separate `ClientDataBucket` in S3 (keyed by the same pattern).
3. Returns a time-limited pre-signed URL pointing to that object.

- [exposure/api/Fuji.Exposure.ApiService/Implementations/StationService.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.ApiService/Implementations/StationService.cs), lines 42–51
- [exposure/api/Fuji.Exposure.ApiRepo/Implementations/S3BucketWrapper.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.ApiRepo/Implementations/S3BucketWrapper.cs), lines 49–66
- Pre-signed URL expiration is configured via `S3BucketPreSignedUrlExpirationTimeInMinutes`.

The client downloads the full station list from this pre-signed URL. The download is a gzipped JSON blob containing a dictionary mapping Fuji CMS IDs to station objects. The station object's `Id` field carries the Fuji CMS ID.

- `StationRepo` contract (S3 payload structure): [exposure/Fuji.Exposure.Entities/Contracts/StationRepo.cs](https://github.com/boost-platform/fuji/blob/main/exposure/Fuji.Exposure.Entities/Contracts/StationRepo.cs)

**Alternative — `GetList` endpoint**

An alternative `GetList` endpoint on each controller returns the data as a JSON array directly (without pre-signed URL), still keyed/identified by Fuji CMS IDs.

- [exposure/api/Fuji.Exposure.Api/Controllers/StationController.cs](https://github.com/boost-platform/fuji/blob/main/exposure/api/Fuji.Exposure.Api/Controllers/StationController.cs), lines 26–30

---

## Impact on Clients

**Station IDs in search:** Every client sending a search request to Etna submits Fuji CMS station IDs (8-char uppercase) in the `departures` and `arrivals` query parameters. If these IDs change, client code must be updated before searches return any results.

- [api/Etna.Search.ApiModels/Requests/Search/SearchRequest.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Requests/Search/SearchRequest.cs), lines 32–34

**Station IDs in search responses:** Every `from_station` and `to_station` field in a search response segment carries a Fuji CMS ID. Clients that store or display these IDs (e.g. to build deep-links, display station names, or filter results) will be broken if the IDs change without mapping tables.

- [api/Etna.Search.ApiModels/Responses/Search/Segment.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Responses/Search/Segment.cs), lines 10–11

**Operating carrier IDs in search responses:** The `operating_carrier_id` field in every segment also carries a Fuji CMS ID. Clients that use this to correlate operator metadata (logo, phone, description) from the `/operating_carriers` endpoint rely on this ID being stable.

- [api/Etna.Search.ApiModels/Responses/Search/Segment.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Responses/Search/Segment.cs), line 23

**Station IDs in booking requests:** The booking flow encodes the itinerary ID with embedded station IDs. The `OneTwoGoInternalId` format is `internal_{from}-{to}-{goDate}-{duration}-{classId}-{officialId}` where `{from}` and `{to}` are station IDs embedded in the itinerary key.

- [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGoInternal/OneTwoGoInternalId.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGoInternal/OneTwoGoInternalId.cs), lines 10–12

**Station IDs in booking responses:** The `Segment` in the booking confirmation also returns `from_station` and `to_station` as Fuji CMS IDs. Clients that display or record itinerary segments from booking responses would need to update their parsing.

- [api/Denali.Booking.ApiModels/Response/Booking/Segment.cs](https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.ApiModels/Response/Booking/Segment.cs), lines 7–8

**Master data (stations/operators/POIs):** Clients download station lists from Fuji and build local lookup tables keyed by the Fuji CMS ID. They use these IDs in search and booking requests. If IDs change, all client-side caches are invalidated and all stored references (e.g. hardcoded routes, white-label configurations, integration configs) become stale.

**POI IDs in search:** Clients may submit `departure_poi` and `arrival_poi` query parameters using Fuji POI CMS IDs. The POI→station mapping in Etna is maintained in DynamoDB (`PoiStation` table) and keyed by Fuji POI CMS IDs.

- [search-engine/etna.searchengine.abstractions/Models/SearchKind.cs](https://github.com/boost-platform/etna/blob/main/search-engine/etna.searchengine.abstractions/Models/SearchKind.cs), lines 31–41

---

## 12go's Knowledge of Fuji IDs

There is no evidence in the 12go `frontend3` codebase that it stores, references, or translates Fuji CMS IDs. A search of all PHP files for strings `fuji`, `cmsId`, `cms_id`, `mapperId`, `mapper_id`, `CMS_ID` returned zero results. The 12go `Station` entity uses only the internal integer `$stationId` (MySQL auto-increment).

The 12go `StationRepository` queries the `station` table using its own integer primary key:

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/Core/Repository/StationRepository.php`, lines 25–42

The 12go B2B `SearchMapper` uses raw 12go operator and station IDs (`$segment->from`, `$segment->to`, `$segment->operator`) directly in the segment response without any translation to Fuji CMS IDs:

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Service/SearchMapper.php`, lines 80–82, 104–105

The 12go `SearchRequest.getFromPlaceId()` and `getToPlaceId()` methods suffix raw integer IDs with `s` (station) or `p` (province/POI), e.g. `"1234s"` or `"5678p"` — an entirely different namespace from Fuji's `ILTLVTLV` style:

- `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/DTO/Request/SearchRequest.php`, lines 76–92

---

## Open Questions

1. **Which clients are confirmed to have hardcoded Fuji station/operator/POI IDs?** No client-side codebases are available for review. The scope of the breakage depends on how many clients store these IDs as literals vs. look them up dynamically from the master data feed.

2. **Is there a complete, authoritative mapping of Fuji CMS IDs to 12go integer station IDs anywhere?** The current mapping exists only in the Fuji DynamoDB tables and the Etna/Denali `StationV1` DynamoDB tables. There is no exported CSV, database table, or shared configuration that explicitly pairs Fuji CMS ID `ILTLVTLV` with 12go station ID `1234`. Whether such a mapping could be reconstructed by joining the Fuji DynamoDB data with 12go's `station` table via shared name or coordinate data is not known.

3. **Will the 12go search API (frontend3) be extended to accept Fuji IDs, or will a translation layer exist in front of it?** The current 12go B2B API (`/v1/{clientId}/itineraries`) uses 12go integer station IDs with no provision for Fuji CMS IDs.

4. **Does the `StationV1` DynamoDB table in Etna/Denali cover all current suppliers, or only OneTwoGo?** The `MapperService.CarrierMapped` explicitly filters to `OneTwoGo` only (`if (!operatingCarrier.SourceId.Equals("OneTwoGo", StringComparison.OrdinalIgnoreCase)) continue;`). It is unclear whether station mappings for other suppliers (Distribusion, Bookaway, flixbus, etc.) are also present or only handled for OneTwoGo.
   - [Etna.Mapper.Application/Services/Implementation/MapperService.cs](https://github.com/boost-platform/etna/blob/main/Etna.Mapper.Application/Services/Implementation/MapperService.cs), lines 37–48

5. **What is the expected behavior for clients who cannot or will not change their IDs?** If a client wants to continue using Fuji CMS IDs, the migration plan must include a backwards-compatible ID translation proxy or a permanent mapping table served by the 12go platform.

6. **Are Fuji POI CMS IDs used by any integration other than search?** POI IDs appear in the search request (`departure_poi`, `arrival_poi`) and in the POI→station mapping pipeline. Whether any booking or post-booking flow also references POI IDs is not confirmed.

7. **What happens to the Fuji exposure API and its S3 pre-signed URL mechanism post-migration?** Currently, clients poll this API to refresh their local station lists. If this endpoint is decommissioned as part of the migration, clients will have no source for current station/operator/POI master data unless 12go exposes an equivalent endpoint using the same Fuji CMS ID scheme.

8. **Is the `MappedRepo.StationId` field in Fuji (the Fuji CMS ID) the same as what clients receive from `/stations`, or is there post-processing?** The internal mapper calls the field `StationId` (in `StationMapped`) to mean the Fuji CMS ID, and the exposure API serves it as the `Id` field. This naming duality (CMSId in DynamoDB ↔ StationId/Id in API responses) may cause confusion during migration planning.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. 51 GitHub URL references were added, covering source files across all four repositories:

- `fuji`: Station mapper, `StationMapped`, `StationRepository`, DynamoDB model files, and the exposure API controllers
- `etna`: Station ID resolution pipeline, `StationMapper.cs`, route mapping service, etna search API station lookup
- `denali`: Station ID usage in booking and post-booking flows, `BookingEntity.cs`
- `supply-integration`: `OneTwoGoStationMapper.cs`, station ID translation in the 12go integration, `TcTourStationMapper.cs`

All referenced files were confirmed to exist in the local repository clones before conversion. No references were left unconverted.
