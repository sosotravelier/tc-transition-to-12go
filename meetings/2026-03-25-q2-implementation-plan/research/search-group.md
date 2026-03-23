# Search Endpoint Group — Research File

## Endpoints in This Group

1. **Search Itineraries** (`GET /v1/{client_id}/itineraries`)
2. **Incomplete Results / Recheck** (`GET /{client_id}/incomplete_results/{incomplete_results_id}`)

---

## 1. Search Itineraries

### One-line description

Searches for available travel itineraries between two locations on a given date, returning vehicles, segments, and itineraries with pricing, cancellation policies, and availability data.

### 12go API calls

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/search/{fromProvinceId}p/{toProvinceId}p/{date}?seats={n}&direct=True` | Called per-route via `OneTwoGoSearchSupplier.FetchIntegrationDataForRoute()`. Province IDs are resolved from `route.From.AdditionalProperties["provinceId"]` and `route.To.AdditionalProperties["provinceId"]`. `direct=True` is always set. Date formatted via `SharedConstants.DateFormat`. Source: `/Users/sosotughushi/RiderProjects/transition-design/current-state/endpoints/search.md`, lines 322-333. |

**Parameter mapping from TC to 12go:**

| TC Parameter | 12go Parameter | Mapping |
|---|---|---|
| `departures[]` / `departure_poi` | `{fromProvinceId}p` | Resolved to province ID via route's `AdditionalProperties["provinceId"]` |
| `arrivals[]` / `arrival_poi` | `{toProvinceId}p` | Resolved to province ID via route's `AdditionalProperties["provinceId"]` |
| `departure_date` | `{date}` | Date format conversion |
| `pax` | `seats` | Direct mapping |
| N/A | `direct=True` | Always hardcoded |

**Key behavioral differences (search.md lines 335-339):**
- TC supports POI-based searches (expanding POIs to multiple station pairs); 12go uses province IDs
- TC handles multiple departure/arrival pairs in one request; 12go is called per-route (`SingleRouteSearchSupplierBase`)
- TC applies markup, enrichment (seat classes, images), and caching on top of 12go raw data
- 12go returns `Trips` with `TravelOptions`; TC maps these to `Itinerary` -> `Segment` -> `Vehicle` structure

### F3 internal services to call

Based on the Team-First Developer design (`design/alternatives/team-first-developer/design.md`) and recommendation (`design/recommendation.md`):

| PHP Class/Service | Role | Source Reference |
|---|---|---|
| `B2bApi/Controller/SearchController.php` | HTTP endpoint handler for `GET /v1/{clientId}/itineraries` | TF design line 234 |
| `B2bApi/Service/SearchMapper.php` | Maps 12go search response to TC search response format | TF design line 241 |
| `B2bApi/Service/TwelveGoClient.php` | Typed HTTP client for calling 12go internal search API | TF design line 240 |
| `B2bApi/Service/ClientKeyResolver.php` | Resolves `clientId` to 12go `apiKey` for authentication | TF design line 246 |
| `B2bApi/DTO/Request/SearchRequest.php` | TC-format inbound search request object | TF design line 249 |
| `B2bApi/DTO/Response/SearchResponse.php` | TC-format outbound search response object | TF design line 255 |
| `B2bApi/DTO/TwelveGo/TwelveGoSearchResponse.php` | 12go API search response type | TF design line 262 |

**Existing F3 code (POC, known incomplete):**
- `frontend3/src/B2bApi/Controller/SearchController.php` — POC search controller already exists. Calls `searchWithRecheckUrls()` and reads recheck URL list but does NOT invoke the recheck URLs. Returns 206 when rechecks present. (recheck-mechanism.md lines 112, 140)
- `frontend3/src/B2bApi/Service/SearchMapper.php` — POC search mapper exists. Uses raw 12go integer station IDs (`$segment->from`, `$segment->to`) directly, no Fuji CMS ID translation. (station-id-mapping.md lines 280-282)
- `frontend3/src/B2bApi/DTO/Request/SearchRequest.php` — POC request DTO exists. `getFromPlaceId()` and `getToPlaceId()` append `s` for station, `p` for POI to raw numeric IDs. (station-id-mapping.md lines 72-73)
- `frontend3/src/TripSearch/Component/Search.php` — F3 internal search component. `searchWithRecheckUrls()` at line 145 executes `searchWithoutRecheckUrls()` (direct query against `trip_pool`) and returns current data. (recheck-mechanism.md line 16)
- `frontend3/src/TripSearch/Service/RecheckBuilder.php` — Scans returned trips for `priceIsValid = false` travel options and builds `RecheckCollection`. `build()` at line 97. (recheck-mechanism.md line 18)
- `frontend3/src/TripSearch/Service/Rechecker.php` — Generates recheck URLs (`getRecheckUrls()` at line 115) and can consume them synchronously (`recheckByUrls()` at line 328 using Guzzle parallel promises with 30s connect timeout, 60s timeout). (recheck-mechanism.md lines 22, 39-41)

### Known challenges

#### Blocking

1. **Station ID translation (Fuji CMS ID <-> 12go integer ID)**
   - **Severity: Blocking**
   - Clients send and expect Fuji CMS IDs (8-char uppercase, e.g., `ILTLVTLV`) in `departures[]`, `arrivals[]`, `departure_poi`, `arrival_poi` request parameters, and in response fields `from_station`, `to_station`, `operating_carrier_id`. (station-id-mapping.md lines 37-56)
   - 12go has zero knowledge of Fuji CMS IDs. Its `Station` entity uses only integer `$stationId` (MySQL auto-increment). A search of all PHP files for `fuji`, `cmsId`, `cms_id` returned zero results. (station-id-mapping.md lines 273-274)
   - The POC `SearchMapper` uses raw 12go integer station IDs with no translation. (station-id-mapping.md lines 280-282)
   - Without a translation layer, every integrated client would need to change all IDs they send and receive — a breaking change across all existing integrations. (station-id-mapping.md line 3)
   - **Proposed approach (presumptive):** Recommendation resolves this as D7: "APCu + MariaDB fallback. Static data loaded per-worker via APCu, sourced from MariaDB table. Avoids per-request Redis lookups on search hot path." (recommendation.md line 69) The mapping table must be populated from Fuji DynamoDB tables (which store `SourceStationId` <-> `CMSId` pairs) or from the Fuji Internal API (`GET /Internal/GetMappedStation/{sourceId}`). (station-id-mapping.md lines 162-177)

2. **Recheck mechanism not implemented**
   - **Severity: Blocking**
   - The POC B2B Search controller detects recheck URLs and sets 206 status but does NOT invoke the recheck URLs. The URLs are constructed and immediately discarded. (recheck-mechanism.md lines 140-141)
   - Without calling recheck URLs: trip_pool stays stale, `priceIsValid = false` trips remain with `"approximate": true`, 206 loops infinitely on retry, and new integrations are never populated for routes. (recheck-mechanism.md lines 106-121)
   - ST-2432 is the Jira ticket tracking this gap. (recheck-mechanism.md line 142)
   - Shauly confirmed this is a known gap not just in the PoC but in the **current TC system** as well: "I think that it's not good enough." (recheck-mechanism.md lines 162-163)
   - **Proposed approach (presumptive):** Must implement recheck URL invocation. Two options exist in F3:
     - **Async fire-and-forget** (mirrors current .NET `OneTwoGoRecheckManager`): Dispatch HTTP GET to each recheck URL without awaiting results. Current .NET implementation uses `Task.Run` with no error handling. (recheck-mechanism.md lines 56-70)
     - **Synchronous inline recheck** (F3's own pattern): Use `Rechecker::recheckByUrls()` which sends async POST requests to all recheck URLs in parallel using Guzzle promises (`GuzzleHttp\Promise\Utils::settle()`), collects returned trip keys. 30s connect timeout, 60s timeout. (recheck-mechanism.md lines 39-41)
     - The inline synchronous approach is closer to correct behavior but adds latency. The fire-and-forget approach is faster but results in stale data on first search.

#### Manageable

3. **POI-to-station resolution**
   - **Severity: Manageable**
   - TC supports `departure_poi` / `arrival_poi` parameters that expand POIs to multiple station pairs. Currently handled by `RoutesDiscoveryBehavior` via `IMapperService`. (search.md lines 237-238, 443-445)
   - 12go's B2B `SearchRequest` also supports POI (appends `p` suffix for province/POI). (station-id-mapping.md lines 284)
   - POI IDs also need Fuji CMS ID <-> 12go integer ID translation (same as station IDs).
   - **Proposed approach (presumptive):** Include POI mappings in the same APCu/MariaDB mapping table as station IDs. Fuji Internal API exposes `GET /Internal/GetMappedPOI/{sourceId}` for extracting POI mappings. (station-id-mapping.md line 169)

4. **Seat class ID mapping**
   - **Severity: Manageable**
   - 12go returns raw integer class IDs (`opt.Class.ToString()`). The current system maps these via `ClassIdMapper` -> `ISeatClassConverter` from Fuji's Master Data Mapping SDK. (station-id-mapping.md lines 339-355)
   - Known discrepancy: 12go returns class ID "5" with name "express" while DeOniBus returns "sleeper" for the same route — different ID spaces needing reconciliation. (station-id-mapping.md lines 333-335)
   - **Proposed approach (presumptive):** Include seat class mappings in the ID mapping infrastructure. Fuji's `ISeatClassConverter` calls `/MapClasses?integrationId={id}&operatorId={id}` and caches results in memory. Same pattern can be replicated in PHP with APCu cache.

5. **Operating carrier (operator) ID mapping**
   - **Severity: Manageable**
   - `operating_carrier_id` in search response segments carries Fuji CMS IDs. 12go uses integer operator IDs. (station-id-mapping.md lines 252-254)
   - Fuji Internal API exposes `GET /Internal/GetMappedOperator/{sourceId}` for extracting operator mappings. (station-id-mapping.md line 168)
   - **Proposed approach (presumptive):** Include operator mappings in the same APCu/MariaDB mapping table.

6. **Vehicle ID mapping**
   - **Severity: Manageable**
   - Vehicle ID is constructed from operator + vehicle type. Levan is creating vehicle objects. (station-id-mapping.md lines 362-363)
   - 12go's `SegmentItem` has `vehclasses` (string[]): "bus", "avia", "train", "ferry", "van", "charter". Known vehicle class IDs: `Bus`, `Train`, `Ferry`, `Van`, `Avia`, `Charter`. (station-id-mapping.md lines 367-371)
   - **Proposed approach (presumptive):** Map 12go vehicle class strings to TC `TransportationType` enum values (`Bus`, `Ferry`, `Van`, `Train`, `Airplane`). Note "avia" -> "Airplane" and "charter" has no TC equivalent.

7. **Markup/pricing pipeline**
   - **Severity: Manageable**
   - Current system applies markup via `MarkupBehavior` using Ushba Revenue SDK + Fuji Exchange Rates for currency conversion. This is business-critical and must stay. (search.md lines 361-362)
   - **Proposed approach (presumptive):** Recommendation does not detail how markup will be handled in the PHP implementation. This needs clarification — whether markup is applied by F3's existing pricing infrastructure or if a new markup mechanism is needed.

8. **Response structure transformation**
   - **Severity: Manageable**
   - 12go returns `Trips` with `TravelOptions`. TC returns denormalized `{vehicles[], segments[], itineraries[]}` with cross-references by ID. (search.md line 339)
   - `SearchMapper.php` handles this transformation. TF design identifies this as "the simplest mapper, good starting point." (TF design line 348)
   - **Proposed approach (presumptive):** Implement in `SearchMapper.php` with fixture-driven tests. Extract test fixtures from existing C# test suites. (TF design lines 318-321)

#### Low risk

9. **`SearchItineraryId` format preservation**
   - **Severity: Low risk**
   - The itinerary ID is a composite type with a custom URL encoder converter. Used for the subsequent get-itinerary (booking-intent) call. (search.md lines 85, 197-198)
   - Special client behavior: `PlainItinerarySupportedClients` get custom JSON serialization with `SearchItineraryIdUrlEncoderConverter`. (search.md lines 173-177)
   - **Proposed approach (presumptive):** Determine itinerary ID format from 12go's response and either preserve or re-encode for backwards compatibility.

10. **`206 Partial Content` status code**
    - **Severity: Low risk**
    - Already detected correctly in the POC: returns 206 when `getRecheckUrls()` is non-empty. (recheck-mechanism.md lines 64-67)
    - Feature-flagged in current system via `ReturnPartialResultsStatus`. (search.md line 69)
    - **Proposed approach (presumptive):** Keep 206 behavior. The detection logic is already in place; only the recheck invocation is missing.

11. **`cache_only` and `confidence_score` parameters becoming meaningless**
    - **Severity: Low risk**
    - With no cache pipeline and single supplier, these parameters have no purpose. (search.md lines 437, 459)
    - **Proposed approach (presumptive):** Accept parameters but ignore them. Do not remove from API contract to maintain backwards compatibility.

### Open questions

1. **Route discovery simplification:** With only 12go, do we still need the Routes Service for route filtering, or can we directly map station pairs to 12go province IDs? (search.md line 443)

2. **POI resolution location:** Where will POI->station mapping live? Currently in `RoutesDiscoveryBehavior` via `IMapperService`. Does this stay or move? (search.md line 445)

3. **Markup pipeline in PHP:** The `MarkupBehavior` uses Ushba Revenue SDK and Fuji exchange rates. Are these kept as-is, or does pricing logic change in the new system? How is markup applied in the PHP implementation? (search.md line 447)

4. **Complete Fuji CMS <-> 12go ID mapping extraction:** Is there a complete, authoritative mapping of Fuji CMS IDs to 12go integer station IDs anywhere? The mapping exists only in Fuji DynamoDB tables and Etna/Denali `StationV1` DynamoDB tables. Whether a mapping could be reconstructed by joining data via shared name or coordinates is unknown. (station-id-mapping.md lines 293-295)

5. **Round-trip search handling:** The request accepts `return_date` but 12go search is called with `departureDate` only. How are round-trip searches handled? (search.md line 465)

6. **`pax_ages` and `locale` parameters:** These are accepted in the request but not visibly used in the core search flow. Are they passed downstream or used in enrichment? (search.md line 463)

7. **Station metadata enrichment:** `IStationMetaDataHandler.FetchInMemory` is called during route discovery. What station metadata does the response depend on? (search.md line 453)

8. **Feature flags to resolve:** Several feature flags gate behavior (`UseNewSiHost`, `UseRevenueNewSdk`, `ReturnPartialResultsStatus`, `ReturnAvailableSeatsAsItComes`). Which can be resolved (always-on or always-off) in the new system? (search.md line 461)

9. **`PlainItinerarySupportedClients` behavior:** Some clients get special JSON serialization (URL-encoded itinerary IDs). Does this client-specific behavior carry forward? (search.md line 455)

10. **Seat class standardization ownership:** Who handles the seat class ID and vehicle ID reconciliation between systems? Meeting notes indicate Eyal and Datuna may own this. (station-id-mapping.md lines 374-375)

11. **gRPC search endpoint for Google Metasearch:** The gRPC interface (`EtnaSearchGrpcService`) must be preserved with the same proto contract for Google Metasearch. Recommendation scopes gRPC out of core Q2 deliverable ("gRPC is scoped out" — recommendation.md line 102). But it will eventually need to be addressed. Does it remain on etna temporarily, or must it be migrated? (grpc-search-integration.md lines 5, 50-54)

---

## 2. Incomplete Results / Recheck

### One-line description

Provides an async polling mechanism for booking/confirmation operations that exceed a timeout threshold, storing pending results in DynamoDB and allowing clients to poll for completion.

### 12go API calls

No direct 12go API calls for the polling endpoint itself. The incomplete results pattern wraps the underlying booking/confirmation calls:

| Method | Path | Notes |
|--------|------|-------|
| N/A | N/A | The polling endpoint (`GET /{client_id}/incomplete_results/{incomplete_results_id}`) reads from DynamoDB, not from 12go. The 12go API call (CreateBooking / ConfirmBooking) that may have triggered the async flow is the underlying operation being polled for. |

**Recheck URLs (related but distinct mechanism):**

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/searchr?...` (route `recheck`) | F3 internal recheck endpoint. Parameters include station IDs, date, seats, integration ID, agent, currency, visitor ID, origin search URL. Called to trigger live supplier availability checks that update `trip_pool`. (recheck-mechanism.md lines 22-23) |
| `GET` | `/searchpm?...` (route `recheck_pack_manual`) | For manual packs. (recheck-mechanism.md line 22) |
| `GET` | `/recheckpa?...` (route `recheck_pack_auto`) | For auto-packs. (recheck-mechanism.md line 22) |

The recheck URLs are generated by `Rechecker::getRecheckUrls()` and point to F3's own internal endpoints. The `recheckDomain` is configured separately from the current domain. (recheck-mechanism.md line 22)

### F3 internal services to call

**For the incomplete results polling pattern:**

The recommendation and TF design do not explicitly call out the incomplete results polling pattern as a separate endpoint to implement. The recommendation's scope list (recommendation.md line 102) includes 7 core endpoints: Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, GetTicket, CancelBooking. Incomplete Results is not in this list.

**Assessment:** The incomplete results pattern may be unnecessary in the new system if 12go's booking confirmation is fast enough (responds within HTTP timeout). The entire async polling infrastructure (DynamoDB, background process, channel) can be eliminated if `EnableAsyncFlow` remains `false`. (incomplete-results.md lines 186-192)

**For recheck invocation (which IS needed for search):**

| PHP Class/Service | Role | Source Reference |
|---|---|---|
| `frontend3/src/TripSearch/Service/Rechecker.php` | Generates recheck URLs and can invoke them synchronously or asynchronously | recheck-mechanism.md lines 22, 39 |
| `frontend3/src/TripSearch/Service/RecheckBuilder.php` | Scans trips for `priceIsValid = false` and builds `RecheckCollection` | recheck-mechanism.md line 18 |
| `frontend3/src/Controller/ApiV1/RecheckController.php` | Endpoint that receives recheck calls, invokes `IntegrationProxy::getTripsList()`, writes fresh data to `trip_pool` | recheck-mechanism.md lines 27-36 |
| `frontend3/src/TripSearch/Component/Search.php` | `searchWithRecheckUrls()` method orchestrates search + recheck URL generation | recheck-mechanism.md line 16 |

### Known challenges

#### Blocking

1. **Recheck invocation missing from POC**
   - **Severity: Blocking** (for search correctness, not for incomplete results specifically)
   - The POC `SearchController.php` calls `searchWithRecheckUrls()` (line 60) but the `SearchFilter` is built without setting `recheckAmount`, so inline recheck is skipped. Recheck URLs are detected for 206 status but never invoked. (recheck-mechanism.md lines 112-116, 140)
   - **Impact of not fixing:** `trip_pool` stays stale; `priceIsValid = false` trips show `"approximate": true`; 206 loops infinitely; new integrations never populated. (recheck-mechanism.md lines 106-121)
   - **Proposed approach (presumptive):** Implement recheck invocation in the B2B search controller. Two paths available:
     - **Option A: Set `recheckAmount` on `SearchFilter`** so that `Rechecker::recheckSearchResults()` is invoked inline (synchronous, adds latency but returns validated prices on first search)
     - **Option B: Fire-and-forget recheck after response** similar to current .NET approach (fast first response, stale data resolved on subsequent searches)
     - The choice depends on latency tolerance. F3's existing `recheckByUrls()` using Guzzle parallel promises (30s connect, 60s timeout) is the synchronous path. (recheck-mechanism.md lines 39-41)

#### Manageable

2. **Recheck URL domain configuration**
   - **Severity: Manageable**
   - Recheck URLs point to a separate `recheckDomain`. `initDomain()` and `deinitDomain()` temporarily swap the router context host. (recheck-mechanism.md line 22)
   - **Proposed approach (presumptive):** Ensure the B2B search controller generates recheck URLs with the correct domain, or invoke rechecks via internal service calls instead of HTTP round-trips.

3. **Deduplication and rate limiting of recheck calls**
   - **Severity: Manageable**
   - `Rechecker::recheckAndHandle()` uses a cache key (MD5 of integration+stations+date+seats) with a semaphore-like guard (`pool` cache item value = 1 while in-flight, = 2 when done) to deduplicate concurrent recheck calls. (recheck-mechanism.md lines 31)
   - The .NET side has `OneTwoGoRecheckCacheHandler` that caches HTTP responses for 15 seconds with a semaphore to prevent thundering herd. (recheck-mechanism.md lines 91)
   - **Proposed approach (presumptive):** Leverage F3's existing deduplication in `Rechecker::recheckAndHandle()` rather than reimplementing.

#### Low risk

4. **Incomplete results polling endpoint**
   - **Severity: Low risk** (likely not needed)
   - The entire async polling pattern may be unnecessary. If `EnableAsyncFlow` is currently disabled for 12go bookings, this subsystem is inactive. (incomplete-results.md line 204)
   - 12go's internal bookings are fast (internal database operations); the async pattern was introduced for external supplier latency. (incomplete-results.md lines 169-172)
   - **Proposed approach (presumptive):** Do not implement the incomplete results polling endpoint in the initial migration. Keep bookings synchronous. If 12go bookings are sometimes slow, implement a simpler async pattern later (e.g., Redis-based instead of DynamoDB).

### Open questions

1. **Is `EnableAsyncFlow` currently enabled for 12go / OneTwoGo bookings?** If not, the entire incomplete results subsystem is inactive and can be skipped. (incomplete-results.md line 204)

2. **How often do CreateBooking / ConfirmBooking calls to 12go exceed the 15-second timeout?** This determines whether async flow adds value. (incomplete-results.md line 205)

3. **Does the frontend currently implement polling for 202 responses?** If the frontend only handles synchronous 200 responses, the async flow may be dead code. (incomplete-results.md line 209)

4. **Which recheck invocation strategy to use?** Synchronous inline (slower first response, validated prices) vs. fire-and-forget (fast first response, stale data on first search)? This is a product decision.

5. **Trip pool investigation status:** Recent problems with trip pool behavior and how it gets populated. Levan has been investigating. The internals are not well understood by the TC team. (recheck-mechanism.md lines 166-167)

6. **Sana's recheck solution:** Hope that Sana will provide a good solution on the 12go side. Unknown who will implement. (recheck-mechanism.md lines 171-172)

---

## Cross-Cutting Challenges (Search Group)

### 1. Station ID Translation for Search Params and Response Mapping

**This is the single most impactful cross-cutting challenge for the search group.**

**The problem:** Two completely separate ID namespaces. Clients use Fuji CMS IDs (8-char uppercase alphanumeric, e.g., `ILTLVTLV`). 12go uses integer auto-increment IDs (e.g., `1234`). There is no overlap, no shared format, and no existing translation layer in the 12go codebase. (station-id-mapping.md lines 1-3, 273-274)

**Where it affects search specifically:**

| Location | Fuji CMS ID Usage | Source |
|---|---|---|
| Request: `departures[]` | Client sends Fuji station CMS IDs | station-id-mapping.md line 41 |
| Request: `arrivals[]` | Client sends Fuji station CMS IDs | station-id-mapping.md line 42 |
| Request: `departure_poi` | Client sends Fuji POI CMS ID | station-id-mapping.md line 43 |
| Request: `arrival_poi` | Client sends Fuji POI CMS ID | station-id-mapping.md line 44 |
| Response: `segment.from_station` | Must return Fuji station CMS ID | station-id-mapping.md lines 51-54 |
| Response: `segment.to_station` | Must return Fuji station CMS ID | station-id-mapping.md lines 51-54 |
| Response: `segment.operating_carrier_id` | Must return Fuji CMS operator ID | station-id-mapping.md lines 56 |
| Response: `segment.seat_class_id` | Must return mapped seat class ID | station-id-mapping.md lines 328-355 |
| Response: `itinerary.id` (SearchItineraryId) | Contains embedded station IDs | search.md line 85 |

**Translation required in both directions:**
- **Inbound (request):** Fuji CMS ID -> 12go integer ID (to query 12go search)
- **Outbound (response):** 12go integer ID -> Fuji CMS ID (to return to client)

**Resolved design decision (D7 from recommendation.md line 69):**
- Storage: APCu (per-worker persistent cache) for search hot path, sourced from MariaDB table
- Avoids per-request Redis lookups
- Static data loaded per PHP-FPM worker
- MariaDB as fallback/source of truth

**Data source for populating the mapping table:**
- Fuji DynamoDB tables store `(SourceStationId, CMSId)` pairs per supplier (station-id-mapping.md lines 104-108)
- Fuji Internal API: `GET /Internal/GetMappedStation/OneTwoGo` returns all `(SourceStationId, StationId=CmsId)` pairs (station-id-mapping.md lines 166-167)
- Fuji Internal API: `GET /Internal/GetMappedOperator/OneTwoGo` for operators (station-id-mapping.md line 168)
- Fuji Internal API: `GET /Internal/GetMappedPOI/OneTwoGo` for POIs (station-id-mapping.md line 169)
- Fuji Internal API: `GET /Internal/Mappings/StationsPaged/OneTwoGo` for paged extraction (station-id-mapping.md line 167)

**Risk from recommendation.md (line 84):** "PHP-FPM ID mapping latency" rated Medium severity / High likelihood. Mitigation: Use APCu (per-worker persistent cache). Test search latency in week 3.

### 2. Markup and Pricing Pipeline

**The problem:** The current system applies markup via `MarkupBehavior` using Ushba Revenue SDK (`IRevenueResolver`) and Fuji Exchange Rates (`IExchangeRateService`). These are identified as "Must stay" components. (search.md lines 361-362, 416-417)

**Impact on search:** Every itinerary in the search response includes `pricing` with `gross_price`, `net_price`, and `taxes_and_fees`. The gross price requires exchange rate conversion. (search.md lines 91, 99-103)

**Open question:** How markup is applied in the PHP implementation is not addressed in the TF design or recommendation. Options:
- F3 has its own pricing/markup infrastructure that can be leveraged
- The 12go internal API may return prices that already include markup for the B2B channel
- A new lightweight markup service in PHP may be needed

### 3. Response Enrichment (Vehicles, Seat Classes, Images)

**The problem:** The current system enriches search responses with vehicle details, seat class metadata, images, amenities, and descriptions. `FillVehiclesWithSeatClasses` is called during response building. (search.md lines 277, 425)

**Data sources for enrichment:**
- `IStationMetaDataRepository` for station names and metadata (search.md line 373)
- Seat class data from Etna DynamoDB (`SeatClassV2`) with Name, Amenities, Images, OperatorId (station-id-mapping.md lines 357-359)
- Vehicle data constructed from operator + vehicle type (station-id-mapping.md lines 362-363)

**Impact:** The search response includes `vehicles[]` with `seat_classes[]`, `images[]`, `description`, `keywords`, and `amenities`. If enrichment is not replicated, clients may receive degraded vehicle/seat class information.

### 4. gRPC Search Interface for Google Metasearch

**The problem:** Google Metasearch consumes search results via a gRPC endpoint (`EtnaSearchGrpcService`) with a specific proto contract. This interface must be preserved. (grpc-search-integration.md lines 5, 50-54)

**Current status:** Recommendation scopes gRPC out of core Q2 deliverable (recommendation.md line 102). The gRPC endpoint can remain on etna temporarily, pointing at the same underlying 12go data.

**Migration concerns:**
- Proto contract includes vehicles with seat classes, segments with transportation types, itineraries with pricing/policies — same structure as REST response (grpc-search-integration.md lines 28-37)
- Google Metasearch gRPC client uses HTTP/2 keep-alive (60s delay, 30s timeout), SSL verification disabled (grpc-search-integration.md lines 22-23)
- Auth: `[AllowAnonymous]` — relies on network isolation (grpc-search-integration.md line 17)
- Latency SLA for Google Metasearch search responses is unknown (grpc-search-integration.md line 92)

### 5. Components That Can Be Removed (Search Simplification)

The following current-system components are confirmed removable for the search endpoint, simplifying the implementation significantly (search.md lines 396-411):

| Component | Reason for Removal |
|---|---|
| Cache pipeline (entire `CacheAdapter` + sub-pipeline) | No trip lake / index cache needed for single live supplier |
| Online Scoring (gRPC ML scoring) | Only relevant for cached multi-supplier results |
| OperatorHealthBehaviour | Single supplier |
| ExperimentExecutor + shadow executions | A/B across suppliers not needed |
| SourceAvailabilityBehavior | Multi-source check not needed |
| DistributionRulesBehavior | Distribution across suppliers not needed |
| ManualProductBehavior | Manual/avia product splitting not needed |
| PlanOverrideBehaviour | Multi-supplier plan overrides not needed |
| CacheDirectSupportBehaviour | No cache pipeline |
| ContractResolutionBehavior | Only one contract (12go) |
| Legacy OneTwoGo FlowPipeline path | `UseNewSiHost` flag path via SI Host should be only path |
| Trip Lake / Itinerary readers | No cached data stores |
| In-process EventBus | Search events likely removable |

**Components that must stay:**
- MarkupBehavior (revenue/pricing)
- RoutesDiscoveryBehavior (POI->station resolution) or equivalent
- DirectAdapter (SI Host path only) for live search
- EtnaSearchProcessorService (simplified) for response building
- EnrichmentService for vehicle/seat class data
- Exchange Rate Service for currency conversion

### 6. Execution Timeline Impact

From recommendation.md (lines 95-96):
- **Weeks 2-3:** Search + GetItinerary + booking schema parser
- **Validation:** Search shadow traffic comparison, parser tests pass against C# fixtures

The search endpoint is the first major endpoint to be implemented (after environment setup in week 1). Station ID mapping data must be extracted and loaded in week 1 (recommendation.md line 94: "station ID mapping data extracted").

Red team risk (recommendation.md line 84): "PHP-FPM ID mapping latency" — test in week 3. If APCu-based mapping adds unacceptable latency to search, the architecture needs adjustment.
