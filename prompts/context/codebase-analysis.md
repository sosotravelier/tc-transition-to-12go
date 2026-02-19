# Codebase Analysis: What to Keep vs Discard

> Inject this into design agent prompts for understanding what exists and what matters.

## Repository Overview

| Repo | Projects | Key Technology | LOC Estimate |
|------|----------|---------------|-------------|
| etna | ~72 .csproj | MediatR pipeline, gRPC, HybridCache, OpenTelemetry | 50-100K |
| denali | ~46 .csproj | DynamoDB, PostgreSQL/EF Core, Kafka, OpenAPI-first | 50-100K |
| fuji | ~108 .csproj | DynamoDB, S3, AWS Lambda, Kafka | 50-100K |
| supply-integration | ~116 .csproj | Autofac, Polly, HybridCache, multi-supplier abstraction | 50-100K |

**Total: ~342 projects, estimated 200-400K lines of C# code** -- replacing a system that fundamentally just proxies HTTP calls to 12go.

## KEEP (Port to New Solution)

### 1. OneTwoGoApi HTTP Client
- **Location**: `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/OneTwoGoApi.cs`
- **What it does**: All 11 12go HTTP endpoints -- search, trip details, cart, checkout, reserve, confirm, booking details, refund
- **Why keep**: This is the core business logic. URL construction, request serialization, response deserialization, error handling
- **Size**: ~500 lines of HTTP call logic + ~2000 lines of request/response models

### 2. Request/Response Models
- **Location**: `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/`
- **What**: `OneTwoGoSearchResponse`, `Trip`, `TravelOptions`, `Price`, `Station`, `Operator`, `GetBookingDetailsResponse`, `OneTwoGoBookingSchemaResponse`, `ReserveDataRequest`, refund models
- **Why keep**: These map exactly to 12go's API contract. The booking schema response has complex dynamic field extraction (20+ patterns)

### 3. Error Handling Patterns
- HTTP status code to exception mapping (400 -> RequestArgumentException, 401 -> AuthenticationException, 404 -> ProductNotFoundException, 500+ -> RequestFailedException)
- `Result<T, Error>` discriminated union pattern for operations that can fail gracefully
- `ErrorResponse` parsing with fields/messages/reasons structure

### 4. Retry/Timeout Infrastructure
- Polly exponential backoff (2^attempt seconds) for transient HTTP errors
- Configurable timeout per integration
- Transient vs non-transient error classification

### 5. API Contract Format
- `Travelier-Version` header versioning
- Money as strings format
- Correlation ID propagation
- Net/gross/taxes pricing structure
- All documented in `transition-design/client-onboarding-docs/`

### 6. Custom Serialization
- `ReserveDataRequest` flat key-value serialization (bracket notation for passenger data)
- Date/time format handling: `yyyy-MM-dd`, `yyyy-MM-dd-HH:mm`, `yyyy-MM-dd-HH-mm-ss`
- Dynamic field extraction from booking schema (20+ wildcard patterns)

## DISCARD

### 1. Etna MediatR Pipeline (Entire Thing)
- 10+ pipeline behaviors: SearchEvents, DistributionRules, SourceAvailability, Markup, ExecutionPlanBuilder, CacheDirectSupport, ManualProduct, ContractResolution, OperatorHealth, RoutesDiscovery
- Only the direct 12go call path survives
- Cache/index search adapter (trip lake) -- goes away
- Experiment decorator pattern -- no A/B testing needed
- gRPC communication between Etna services -- unnecessary

### 2. SI Multi-Supplier Abstraction
- `ISiServiceProvider` / `AutofacSiServiceProvider` -- scoping per-integration unnecessary with only 12go
- `ISiServiceScope` / Autofac keyed resolution -- overkill
- `IntegrationHttpMiddleware` -- per-integration HTTP routing
- `ConnectorFactory` -- multi-connector factory
- `SupplierIntegrationBuilder` -- multi-integration registration
- All 11 non-12go integrations: Bookaway, Distribusion, DeOniBus, FlixBus, Plataforma10, SeatOS, Sisorg, Songserm, Phantip, TcTour, OneTwoGoInternal

### 3. DynamoDB Tables (All of Them)
- ItineraryCache -- re-fetch from 12go
- PreBookingCache -- re-fetch from 12go
- BookingCache -- 12go stores bookings in MariaDB
- IncompleteResults -- eliminate if flow becomes synchronous

### 4. PostgreSQL BookingEntities
- Post-booking reads from local DB, but 12go MariaDB is authoritative
- BookingEntityHistory audit trail -- evaluate if 12go has equivalent
- ConfirmationInProcess tracking -- eliminate if confirm is synchronous

### 5. Fuji Entity Mapping (Out of Scope)
- 108 projects of Lambda functions, DynamoDB tables, sync services
- Station/Operator/POI mapping between supplier IDs and canonical IDs
- Out of scope for this transition but must be accounted for in design

### 6. Infrastructure Overhead
- HybridCache triple-caching (HybridCache + DynamoDB + MemoryCache)
- Kafka event producers (no trip lake, no data team)
- Ushba pricing module (being sunset)
- S3 pre-mapping CSVs
- OpenAPI code generation for inter-service communication
- AWS Application Config integration

## EVALUATE (Per Design Decision)

### Local Booking Storage
- **Question**: Do we need any local database for bookings?
- **Current**: DynamoDB caches + PostgreSQL persistent store
- **Option A**: Fully stateless -- proxy everything to 12go
- **Option B**: Minimal cache (Redis) for in-flight bookings during funnel
- **Option C**: Keep lightweight PostgreSQL for booking history/audit
- **Consideration**: GetBookingDetails currently reads from local DB. If we proxy to 12go, it adds latency but eliminates storage.

### Caching Strategy
- **Question**: What caching do we need?
- **Current**: Triple-cache in SI + DynamoDB caches in Denali
- **Option A**: Use 12go's Redis (if accessible)
- **Option B**: Own Redis instance for search result caching
- **Option C**: In-memory cache only (simpler, but lost on restart)
- **Option D**: No caching -- 12go already caches in Redis
- **Consideration**: Search performance is critical. 12go search hits MariaDB which has its own caching.

### Notification Transformer
- **Question**: How to handle booking notifications?
- **Current**: Denali booking-notification-service receives 12go webhooks
- **Requirement**: Transform 12go notification shape to client-expected shape
- **Consideration**: Need webhook URL onboarding per client, delivery tracking, retry on failure

### Markup/Pricing
- **Question**: Do we still need markup/pricing logic?
- **Current**: Etna has MarkupBehavior, Denali has PriceService/MarkupService
- **Answer**: Ushba goes away, use 12go prices directly. But per-client markup might still be needed.

### Credit Line
- **Question**: Does credit line checking survive?
- **Current**: Denali checks credit balance before booking
- **Consideration**: If 12go manages billing, this might be unnecessary

## Key Domain Models to Preserve (Conceptually)

These shapes need to exist in whatever language/framework we choose:

1. **Search Response** -- trips with segments, pricing, operators, stations
2. **Booking Schema** -- dynamic form fields with validation, seat maps, pickup/dropoff points
3. **Reservation** -- booking state machine (PendingClientConfirmation -> Confirmed/Canceled)
4. **Cancellation** -- refund options with hashes, amounts, expiry
5. **Notification** -- booking status change events transformed to client format

## Complexity Hotspots

1. **Booking Schema Mapping** (~500 lines) -- 12go returns a dynamic checkout form with 20+ wildcard field patterns. This is the most complex transformation.
2. **Reserve Request Serialization** -- custom flat key-value format with bracket notation for nested passenger data
3. **Search Response Mapping** -- trips -> itineraries with segment construction, pricing normalization
4. **Refund Flow** -- two-step: get options (with hash/expiry) then execute with selected option
5. **Seat Lock** -- currently faked locally, 12go developing native support
