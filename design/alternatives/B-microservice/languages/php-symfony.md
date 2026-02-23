---
status: draft
last_updated: 2026-02-23
---

# PHP/Symfony Language Exploration

## Part 1: Monolith Path (A-monolith Deepened)

### Bundle Structure

**Recommendation: Directory-based structure within `src/B2bApi/`, not a separate Symfony bundle.**

Symfony 4.0+ best practices discourage bundles for application code organization. Instead, organize the B2B API as a feature module within `frontend3/src/B2bApi/` following Symfony's standard directory structure:

```
frontend3/src/B2bApi/
├── Controller/              # HTTP controllers
├── Service/                 # Business logic services
├── Repository/             # Data access (if needed beyond existing 12go repos)
├── DTO/                    # Request/Response DTOs
│   ├── Request/
│   └── Response/
├── EventListener/           # Symfony event listeners (auth, correlation IDs)
├── Exception/              # Custom exceptions
└── DependencyInjection/    # Service configuration (services.yaml)
```

**Namespace**: `App\B2bApi\`

**Rationale**:
- Keeps B2b code isolated but within the monolith's namespace conventions
- No bundle registration overhead (bundles are for reusable packages)
- Matches existing `frontend3` patterns (`App\Booking\`, `App\TripSearch\`)
- Easier to navigate and maintain than a separate bundle

**Configuration**: Register routes via `config/routes/b2b.yaml` using attribute routing (Symfony 6.4+ standard). Services are auto-wired via `services.yaml` in `config/packages/b2b_api.yaml`.

### Service Integration (which f3 services to call, how)

Based on `12go-service-layer.md`, the following existing Symfony services can be called **directly in-process**:

| B2B Endpoint | 12go Service Class | Call Pattern |
|---|---|---|
| **Search** | `SearchService::newSearch()` → `Search::searchWithRecheckUrls()` | In-process call; no HTTP |
| **GetItinerary** | `CartHandler::handleAddTrip()` → `BookingFormManager::getBookingForm()` | In-process; cart stored in Redis |
| **CreateBooking** | `BookingProcessor::createBookingsAndSetIds()` → `reserveBookings()` | In-process; injects `ApiAgent` |
| **ConfirmBooking** | `BookingProcessor::confirmBookings()` | In-process; acquires Redis lock |
| **GetBookingDetails** | `BookingManager::getById()` → `BookingDetailsManager::getBookingDetails()` | Direct MariaDB read |
| **GetTicket** | `BookingManager::getById()` → extract `ticket_url` column | Single SQL query |
| **Stations/Operators** | `StationRepository` / `OperatorRepository` | Direct MariaDB read for snapshot generation |
| **POIs** | Confirm table name with 12go team; likely `POIRepository` | Direct MariaDB read |

**Critical Gap: Refund Flow**

`RefundController` currently makes HTTP self-calls to `/api/v1/secure/refund-options/{bid}`. Until the underlying refund service classes are identified, B2B `CancelBooking` should replicate this pattern using Guzzle to `localhost` rather than bypassing business logic.

**Critical Gap: Webhook Processing**

`WebhookController` currently validates payloads but does nothing. B2B must extend this controller to dispatch a Symfony event (`BookingStatusChangedEvent`), which `NotificationTransformer` subscribes to for client forwarding.

**Service Injection Pattern**:

```php
// In B2B controller
class BookingController extends B2bBaseController
{
    public function __construct(
        private BookingProcessor $bookingProcessor,
        private BookingManager $bookingManager,
        private ApiAgent $apiAgent,  // Request-scoped service
        // ...
    ) {}
    
    public function createBookingAction(Request $request): Response
    {
        // ApiAgent is already populated by B2bAuthEventListener
        $this->bookingProcessor->createBookingsAndSetIds(...);
        // ...
    }
}
```

**Dependency Resolution**: All 12go services are already registered in Symfony's DI container. B2B services simply inject them via constructor. No HTTP calls needed except for the refund flow.

### Controller Strategy

**Recommendation: Raw Symfony controllers with attribute routing, not API Platform.**

**Rationale**:
1. **API Platform is overkill**: API Platform (`#[ApiResource]`) is designed for entity-centric CRUD APIs. Our B2B API is a translation layer with complex business logic, not CRUD.
2. **Existing patterns**: `frontend3` uses raw controllers (`Controller\ApiV1\SearchController`, `BookingProcessController`). Consistency matters.
3. **Custom serialization**: B2B responses require precise control over money formatting, versioning, and field mapping. API Platform's serialization groups add complexity without benefit.
4. **Performance**: Raw controllers have zero framework overhead. API Platform adds serialization layers and metadata processing.

**Alternative Considered: FrameworkExtraBundle**

FrameworkExtraBundle provides `#[Route]`, `#[ParamConverter]`, `#[IsGranted]` attributes. These are useful but not required. Symfony 6.4's native attribute routing (`#[Route]`) is sufficient.

**Controller Structure**:

```php
#[Route('/v1/{client_id}', name: 'b2b_')]
class SearchController extends B2bBaseController
{
    #[Route('/itineraries', name: 'search', methods: ['GET'])]
    public function searchAction(
        Request $request,
        StationIdTranslator $translator,
        SearchService $searchService,
        SearchMapper $mapper
    ): Response {
        // Station ID translation
        // Build SearchFilter
        // Call SearchService
        // Map response
        // Return JSON
    }
}
```

**Base Controller**: `B2bBaseController` provides:
- Error handling (try/catch → standardized error responses)
- Correlation ID propagation
- Money formatting enforcement
- Version header processing

### Data Access Strategy (per-endpoint)

| Endpoint Group | Access Method | Justification |
|---|---|---|
| **Search** | In-process via `SearchService` → `TripPoolRepository` (MariaDB) | Eliminates HTTP hop; search is DB-backed |
| **GetItinerary** | In-process via `CartHandler` + `BookingFormManager` (MariaDB + Redis) | Cart is Redis-backed; form is DB-backed |
| **CreateBooking / ConfirmBooking** | In-process via `BookingProcessor` (MariaDB + Redis + supplier integration) | BookingProcessor orchestrates everything |
| **SeatLock** | Local in-process validation + Redis storage | 12go native seat lock not yet available |
| **GetBookingDetails** | In-process via `BookingManager` + `BookingDetailsManager` (MariaDB) | Direct DB read; eliminates PostgreSQL dependency |
| **GetTicket** | In-process via `BookingManager::getById()` (MariaDB) | `ticket_url` is a column |
| **CancelBooking** | HTTP self-call to `/api/v1/secure/refund-options/{bid}` (risk — see Open Questions) | RefundController pattern; underlying service TBD |
| **IncompleteResults** | In-process via `BookingManager` status polling | No DynamoDB async store needed |
| **Stations / Operators** | Hybrid: periodic in-process snapshot job + S3 artifact response | Preserves contract (pre-signed S3 URL) |
| **POIs** | In-process via appropriate MariaDB repository | Confirm table name with 12go team |
| **Notifications** | Event-driven: extend `WebhookController` → Symfony event → `NotificationTransformer` subscriber | Cleanest monolith pattern |

**Coupling Assessment**:

- **High coupling** (Search, Booking): Tied to 12go internals. Changes to `SearchService` or `BookingProcessor` may require B2B updates. Mitigation: B2B code is in the same codebase; changes are visible and coordinated.
- **Medium coupling** (Stations snapshot): Tied to MariaDB schema + artifact contract. Schema changes require coordinated updates.
- **Loose coupling** (Cancel): HTTP self-call isolates refund logic. Performance cost (~50ms vs ~10ms) is acceptable for isolation.

### Booking Schema Implementation

**Problem**: 12go's checkout schema (`BookingFormManager::getBookingForm()`) returns a dynamic form with 20+ wildcard field patterns. The .NET code uses `[JsonExtensionData]` to capture these.

**PHP Solution**: `BookingFormManager` already handles this natively. B2B layer calls it directly:

```php
// In GetItinerary flow
$cart = $cartHandler->handleAddTrip($tripKey, $datetime, ...);
$cartHash = $cart->getHash();

$formFields = $bookingFormManager->getBookingForm($cartHash);
// $formFields is an array of FormField objects

// Map to B2B PreBookingSchema format
$b2bSchema = $bookingSchemaMapper->mapToB2b($formFields);
```

**Field Pattern Matching**: `BookingFormManager` already parses patterns like `selected_seats_*`, `points*[pickup]`, `delivery*address`. B2B `BookingSchemaMapper` translates `FormField` objects to the client-expected `PreBookingSchema` shape.

**Passenger Data Mapping** (CreateBooking):

```php
// Client sends B2B format
{
  "passengers": [
    {"first_name": "John", "last_name": "Doe", "id_no": "12345"}
  ]
}

// BookingSchemaMapper reverse-maps to flat format BookingFormManager expects
$formData = [
    "contact[mobile]" => "+66812345678",
    "contact[email]" => "traveler@example.com",
    "passenger[0][first_name]" => "John",
    "passenger[0][last_name]" => "Doe",
    "passenger[0][id_no]" => "12345",
    // ... dynamic fields from schema
];

// BookingFormManager processes this
$result = $bookingFormManager->handleForm($formData, $cartHash);
// Returns BookingFormHandlingResult[] used by BookingProcessor
```

**Complexity**: This mapper is the most complex piece (~500 lines, matching .NET `FromRequestDataToReserveDataConverter`). High testing priority.

### Station Snapshot Pipeline

**Architecture**: Periodic Symfony console command (scheduled via cron or Symfony Scheduler) that:
1. Reads station/operator data from MariaDB via `StationRepository` / `OperatorRepository`
2. Translates internal station IDs → Fuji IDs via `StationIdTranslator`
3. Generates locale-specific JSON artifacts
4. Uploads to S3 with versioned keys
5. Stores metadata in `b2b_station_snapshot` table (latest artifact key per locale)

**Implementation**:

```php
// src/B2bApi/Command/StationSnapshotCommand.php
#[AsCommand(name: 'b2b:station-snapshot')]
class StationSnapshotCommand extends Command
{
    public function __construct(
        private StationRepository $stationRepo,
        private OperatorRepository $operatorRepo,
        private StationIdTranslator $translator,
        private StationSnapshotBuilder $builder,
        private S3Client $s3Client,
        // ...
    ) {}
    
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $stations = $this->stationRepo->findAll();
        $operators = $this->operatorRepository->findAll();
        
        foreach ($locales as $locale) {
            $snapshot = $this->builder->build($stations, $operators, $locale);
            $artifactKey = "stations/{$locale}/{$timestamp}.json";
            $this->s3Client->putObject([
                'Bucket' => $bucket,
                'Key' => $artifactKey,
                'Body' => json_encode($snapshot),
            ]);
            
            // Update metadata table
            $this->snapshotRepo->updateLatest($locale, $artifactKey);
        }
        
        return Command::SUCCESS;
    }
}
```

**Scheduling**: Configure in `config/packages/messenger.yaml` or via system cron. Recommended frequency: daily (stations change infrequently).

**Request Path**: `MasterDataController::stationsAction()` reads latest artifact key from DB, generates pre-signed S3 URL, returns to client. No DB scan at request time.

## Part 2: Microservice Path (B-microservice in PHP)

### Framework Choice (with justification)

**Recommendation: Symfony 6.4 (matching frontend3), not Symfony 7.x or Laravel.**

**Rationale**:

1. **Version alignment**: `frontend3` uses Symfony 6.4. Using the same version enables:
   - Code sharing (DTOs, utilities) if needed
   - Consistent dependency versions
   - Easier team knowledge transfer from 12go veterans

2. **Symfony 7.x evaluation**: Symfony 7.0 was released in November 2024. While it offers performance improvements and new features, the team's .NET expertise means learning Symfony 6.4 is already a significant ramp-up. Symfony 7.x adds:
   - PHP 8.2+ requirement (fine)
   - New attribute-based route defaults
   - Improved error handling
   - **But**: No compelling reason to diverge from 12go's version

3. **Laravel evaluation**: Laravel is PHP's most popular framework, but:
   - 12go uses Symfony; team support/advice is Symfony-focused
   - Laravel's conventions differ significantly (Eloquent ORM vs Doctrine, different DI patterns)
   - No code sharing benefit with `frontend3`
   - Laravel's "magic" (facades, dynamic properties) can confuse .NET developers expecting explicit dependencies

**Conclusion**: Symfony 6.4 is the pragmatic choice. Upgrade to 7.x can be considered post-migration when the team is comfortable with Symfony.

### Architecture Pattern

**Recommendation: Vertical slices (feature-based), not service-layer pattern.**

**Structure**:

```
src/
├── Search/                    # Search endpoint slice
│   ├── Controller/
│   ├── Service/
│   ├── Mapper/
│   └── DTO/
├── Booking/                   # Booking funnel slice
│   ├── Controller/
│   ├── Service/
│   ├── Mapper/
│   └── DTO/
├── MasterData/                # Stations/Operators/POIs slice
│   ├── Controller/
│   ├── Service/
│   └── SnapshotJob/
├── Shared/                    # Cross-cutting
│   ├── HttpClient/           # 12go HTTP client
│   ├── Auth/                 # Auth mapping resolver
│   ├── StationIdTranslator/
│   └── Exception/
└── Kernel.php
```

**Rationale**:
- **Minimal and focused**: Each slice is self-contained. Easy to understand "where does Search code live?"
- **No over-engineering**: Service-layer pattern (separate Application/Domain/Infrastructure layers) is overkill for a stateless proxy. Vertical slices keep it simple.
- **Testability**: Each slice can be tested independently. Mock the `Shared\HttpClient\TwelveGoClient` interface.

**Shared Components**:
- `TwelveGoClient`: Single HTTP client for all 12go API calls (Guzzle wrapper with retry/circuit breaker)
- `AuthMappingResolver`: Resolves `client_id` → `12goApiKey` from config store
- `StationIdTranslator`: Fuji ↔ 12go ID translation
- `ErrorHandler`: Global exception handler → standardized error responses

### Project Structure

```
b2b-booking-service/          # Or b2b-search-service
├── config/
│   ├── packages/
│   │   ├── framework.yaml
│   │   ├── monolog.yaml
│   │   └── datadog.yaml
│   ├── routes.yaml
│   └── services.yaml
├── public/
│   └── index.php
├── src/
│   ├── Kernel.php
│   ├── Search/               # Vertical slice
│   ├── Booking/             # Vertical slice
│   └── Shared/              # Shared components
├── tests/
│   ├── Search/
│   └── Booking/
├── docker/
│   └── Dockerfile
├── .env
├── composer.json
└── README.md
```

**Dependencies** (`composer.json`):

```json
{
    "require": {
        "php": "^8.3",
        "symfony/framework-bundle": "^6.4",
        "symfony/routing": "^6.4",
        "symfony/console": "^6.4",
        "symfony/http-client": "^6.4",
        "guzzlehttp/guzzle": "^7.5",
        "monolog/monolog": "^3.0",
        "datadog/dd-trace": "^0.90",
        "aws/aws-sdk-php": "^3.0",
        "doctrine/dbal": "^3.6"
    },
    "require-dev": {
        "phpunit/phpunit": "^10.0",
        "symfony/test-pack": "^1.1"
    }
}
```

### HTTP Client Design

**Recommendation: Symfony HttpClient as primary, Guzzle as fallback for advanced features.**

**Rationale**:
- **Symfony HttpClient** is native to Symfony 6.4, well-integrated with Symfony's HTTP kernel, and supports async requests
- **Guzzle** is more feature-rich (middleware, connection pooling) but adds a dependency
- **Hybrid approach**: Use Symfony HttpClient for standard calls. Use Guzzle only if needed for complex retry logic or connection pooling

**Implementation**:

```php
// src/Shared/HttpClient/TwelveGoClient.php
class TwelveGoClient
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private AuthMappingResolver $authResolver,
        private LoggerInterface $logger,
    ) {}
    
    public function search(string $clientId, SearchRequest $request): SearchResponse
    {
        $apiKey = $this->authResolver->resolveApiKey($clientId);
        
        $request = $this->httpClient->request('GET', '/search/...', [
            'query' => ['k' => $apiKey, ...],
            'timeout' => 10,
        ]);
        
        // Error handling, mapping...
        return $this->mapResponse($request);
    }
}
```

**Retry Strategy**: Implement via Symfony HttpClient's `RetryableHttpClient` decorator or custom middleware. Circuit breaker via a simple in-memory state machine (open/closed/half-open).

**Timeout Configuration**: Per-endpoint timeouts via `services.yaml`:

```yaml
services:
    TwelveGoClient:
        arguments:
            $defaultTimeout: 10
            $searchTimeout: 10
            $bookingTimeout: 15
```

### Libraries and Dependencies

**Core**:
- **Symfony Framework Bundle 6.4**: Core framework
- **Symfony HTTP Client**: HTTP calls to 12go
- **Monolog**: Logging (integrated with Datadog)

**Observability**:
- **datadog/dd-trace**: APM tracing (`dd-trace-php`). Install via Composer, enable via `DD_TRACE_ENABLED=true` env var.
- **Monolog Datadog handler**: Structured logging to Datadog (configure in `monolog.yaml`)

**AWS**:
- **aws/aws-sdk-php**: S3 operations (pre-signed URLs, artifact uploads)

**Testing**:
- **PHPUnit 10**: Test framework
- **Symfony Test Pack**: HTTP client testing, kernel testing

**Optional**:
- **Doctrine DBAL**: If direct MariaDB access is needed (unlikely for stateless proxy)
- **Symfony Scheduler**: For periodic snapshot jobs (Symfony 6.4+)

### Deployment (Docker/PHP-FPM)

**Dockerfile**:

```dockerfile
FROM php:8.3-fpm-alpine

# Install extensions
RUN apk add --no-cache \
    curl \
    git \
    unzip \
    && docker-php-ext-install opcache

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Copy application
WORKDIR /var/www/html
COPY . .

# Install dependencies
RUN composer install --no-dev --optimize-autoloader

# PHP-FPM configuration
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/www.conf
COPY docker/php.ini /usr/local/etc/php/php.ini

# Datadog tracer
RUN curl -L https://github.com/DataDog/dd-trace-php/releases/latest/download/datadog-setup.php -o /tmp/datadog-setup.php \
    && php /tmp/datadog-setup.php --php-bin=php-fpm

EXPOSE 9000

CMD ["php-fpm"]
```

**PHP-FPM Configuration** (`docker/php-fpm.conf`):

```ini
[www]
user = www-data
group = www-data
listen = 0.0.0.0:9000
pm = dynamic
pm.max_children = 50
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 20
```

**Nginx Configuration** (reverse proxy):

```nginx
server {
    listen 80;
    server_name b2b-booking-service;

    root /var/www/html/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php$is_args$args;
    }

    location ~ \.php$ {
        fastcgi_pass b2b-booking-service:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}
```

**Process Management**: PHP-FPM handles process pooling. No need for Supervisor or systemd. For container orchestration (ECS/Kubernetes), configure health checks:

```yaml
# Health check endpoint
GET /health/live  # Returns 200 if process running
GET /health/ready # Returns 200 if auth config loaded + 12go reachable
```

**Deployment Target**: EC2 instances managed by DevOps. Containers run via Docker Compose or ECS (confirm with DevOps). Base image: `php:8.3-fpm-alpine` for minimal size.

## Part 3: Cross-Cutting

### Team Ramp-Up Assessment

**Timeline: 4-6 weeks to productive PHP/Symfony development for .NET experts.**

**Week 1-2: Fundamentals**
- PHP syntax (types, arrays, closures, namespaces)
- Composer (dependency management)
- Symfony basics (routing, controllers, services, DI)

**Week 3-4: Symfony Deep Dive**
- Service container and dependency injection
- Event system (kernel events, custom events)
- Doctrine DBAL (if direct DB access needed)
- Testing (PHPUnit, Symfony test client)

**Week 5-6: Production Patterns**
- Error handling and exception hierarchy
- Logging (Monolog, structured logging)
- HTTP client patterns (Symfony HttpClient, retry logic)
- Deployment and debugging

**Biggest Mental Model Shifts**:

1. **Dependency Injection**: .NET uses constructor injection with interfaces. Symfony uses constructor injection but services are auto-wired by type-hinting (no interface required). This feels "magical" to .NET developers.

2. **Arrays vs Collections**: PHP arrays are hash maps, not typed collections. `.NET` developers expect `List<T>`, `Dictionary<K,V>`. PHP arrays are flexible but less type-safe.

3. **Null Safety**: PHP 8.0+ has nullable types (`?string`), but null handling is more permissive than C#'s nullable reference types. Need discipline to check nulls.

4. **Error Handling**: PHP exceptions are similar to .NET, but PHP has errors (deprecated) and exceptions. Symfony converts errors to exceptions, but the distinction can confuse.

5. **No Compile-Time Checks**: PHP is interpreted. Type errors surface at runtime. IDE (PhpStorm) helps, but it's not the same as C# compiler errors.

**Common Mistakes .NET Developers Make in PHP**:

1. **Forgetting `$` for variables**: `$variable` not `variable`
2. **Array vs object access**: `$array['key']` vs `$object->property`
3. **String concatenation**: `.` not `+`
4. **Type coercion**: PHP coerces types implicitly (`"123" + 1 = 124`). Use strict comparisons (`===`).
5. **Namespace imports**: `use App\Service\MyService;` then `new MyService()` (not `new App\Service\MyService()`)
6. **Return types**: PHP 7.0+ supports return types (`: string`), but they're optional. .NET developers should always add them for type safety.

**Mitigation Strategies**:

- **AI-assisted development**: Cursor/Claude can generate Symfony code matching conventions. Use project rules (`.cursor/rules/`) to encode team patterns.
- **Pair programming**: Pair .NET developers with 12go PHP veterans for first 2-3 weeks.
- **Code reviews**: PHP veterans review all B2B code initially to catch patterns.
- **Gradual ramp-up**: Start with simple endpoints (Stations, POIs) before complex ones (Booking schema mapping).

### AI Development Effectiveness

**Assessment: Very effective for PHP/Symfony with proper setup.**

**Cursor/Claude Strengths**:

1. **Symfony conventions are well-represented**: Symfony is one of PHP's most documented frameworks. AI training data includes extensive Symfony examples (controllers, services, events, routing).

2. **Attribute-based routing**: Symfony 6.4's `#[Route]` attributes are similar to .NET's `[Route]`. AI generates correct patterns.

3. **Service injection**: AI understands Symfony's constructor injection pattern and generates correct type-hints.

4. **DTO mapping**: AI can generate mapper classes that transform between 12go responses and B2B contracts.

**Limitations**:

1. **Custom business logic**: AI struggles with domain-specific logic (e.g., booking schema field pattern matching). Requires human guidance.

2. **12go-specific patterns**: AI doesn't know `frontend3` internals (`BookingProcessor`, `SearchService`). Provide context via @file references in Cursor.

3. **Error handling**: AI may generate generic exception handling. Team must enforce consistent error response formats.

**Best Practices for AI-Assisted PHP Development**:

1. **Project Rules**: Create `.cursor/rules/symfony.md` encoding:
   - Controller structure (extend `B2bBaseController`)
   - Service naming (`*Service`, `*Mapper`, `*Repository`)
   - Error handling patterns
   - Logging conventions (structured logging with context)

2. **Context Management**: Use Cursor's @file references to provide context:
   - `@12go-service-layer.md` for available services
   - `@OneTwoGoApi.cs` for 12go API contract understanding
   - `@current-state/endpoints/search.md` for endpoint requirements

3. **Incremental Generation**: Don't ask AI to generate entire endpoints. Generate:
   - Controller skeleton → add business logic
   - Mapper class → refine field mappings
   - Service class → add error handling

4. **Validation**: Always review AI-generated code for:
   - Type safety (return types, parameter types)
   - Error handling completeness
   - Logging (structured context)
   - Performance (N+1 queries, unnecessary loops)

**Effectiveness Rating**: 8/10 for Symfony boilerplate, 6/10 for complex business logic. With project rules and context, AI can generate 70-80% of code correctly. Human review and refinement required for production quality.

### Testing Strategy

**Framework: PHPUnit 10.x**

**Test Structure**:

```
tests/
├── Search/
│   ├── SearchControllerTest.php
│   ├── SearchMapperTest.php
│   └── StationIdTranslatorTest.php
├── Booking/
│   ├── BookingControllerTest.php
│   ├── BookingSchemaMapperTest.php
│   └── TwelveGoClientTest.php
└── Shared/
    └── AuthMappingResolverTest.php
```

**Unit Tests**:

```php
class SearchMapperTest extends TestCase
{
    public function testMapsTripToItinerary(): void
    {
        $trip = new Trip(/* ... */);
        $mapper = new SearchMapper();
        
        $itinerary = $mapper->mapTrip($trip, 'client-123');
        
        $this->assertInstanceOf(ItineraryResponse::class, $itinerary);
        $this->assertEquals('14.60', $itinerary->price); // Money as string
    }
}
```

**Integration Tests** (Symfony Test Client):

```php
class SearchControllerTest extends WebTestCase
{
    public function testSearchEndpoint(): void
    {
        $client = static::createClient();
        
        $client->request('GET', '/v1/client-123/itineraries', [
            'departures' => 'S42',
            'arrivals' => 'S17',
            'date' => '2026-03-01',
        ], [], [
            'HTTP_x-api-key' => 'test-key',
        ]);
        
        $this->assertResponseStatusCodeSame(200);
        $response = json_decode($client->getResponse()->getContent(), true);
        $this->assertArrayHasKey('itineraries', $response);
    }
}
```

**Mocking**: Use PHPUnit's `createMock()` or Mockery for HTTP client mocking:

```php
$twelveGoClient = $this->createMock(TwelveGoClient::class);
$twelveGoClient->expects($this->once())
    ->method('search')
    ->willReturn(new SearchResponse(/* ... */));
```

**Contract Tests**: Compare B2B responses to documented OpenAPI contracts. Use PHPUnit data providers to test multiple scenarios:

```php
/**
 * @dataProvider moneyFormatProvider
 */
public function testMoneyFormat(string $input, string $expected): void
{
    $formatter = new MoneyFormatter();
    $this->assertEquals($expected, $formatter->format($input));
}

public function moneyFormatProvider(): array
{
    return [
        ['14.6', '14.60'],
        ['100', '100.00'],
        ['0.5', '0.50'],
    ];
}
```

**Testing Experience Comparison**:

| Aspect | .NET (xUnit) | PHP (PHPUnit) |
|---|---|---|
| **Test Discovery** | Automatic via attributes | Automatic via `*Test.php` naming |
| **Assertions** | `Assert.Equal()`, `Assert.NotNull()` | `$this->assertEquals()`, `$this->assertNotNull()` |
| **Mocking** | Moq (`mock.Setup()`) | PHPUnit (`createMock()`) or Mockery |
| **Fixtures** | Constructor/`IDisposable` | `setUp()` / `tearDown()` |
| **Async Testing** | `async/await` | PHPUnit supports async via promises (limited) |

**Verdict**: PHPUnit is comparable to xUnit. .NET developers will feel at home. Main difference: PHPUnit uses methods (`assertEquals`) vs .NET's static class (`Assert.Equal`). Minor adjustment.

### Cross-Cutting Concerns Implementation

**API Versioning (`Travelier-Version` header)**:

```php
// Event listener
class TravelierVersionEventListener implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::CONTROLLER => ['onKernelController', 8],
        ];
    }
    
    public function onKernelController(ControllerEvent $event): void
    {
        $request = $event->getRequest();
        $versionHeader = $request->headers->get('Travelier-Version');
        
        if ($versionHeader) {
            // Map date to API version behavior
            $apiVersion = $this->mapDateToVersion($versionHeader);
            $request->attributes->set('api_version', $apiVersion);
        }
    }
}

// In mapper
class SearchMapper
{
    public function map(SearchResultsFull $results, string $apiVersion): array
    {
        $itineraries = [];
        foreach ($results->getTrips() as $trip) {
            $itinerary = $this->mapTrip($trip);
            
            // Version-specific shaping
            if (version_compare($apiVersion, '2024.1.15', '>=')) {
                $itinerary['new_field'] = $trip->getNewField();
            }
            
            $itineraries[] = $itinerary;
        }
        return $itineraries;
    }
}
```

**Correlation IDs**:

```php
class CorrelationIdEventListener implements EventSubscriberInterface
{
    public function onKernelRequest(RequestEvent $event): void
    {
        $request = $event->getRequest();
        $correlationId = $request->headers->get('x-correlation-id') 
            ?? Uuid::v4()->toString();
        
        $request->attributes->set('correlation_id', $correlationId);
        
        // Set in Monolog context
        $this->logger->pushProcessor(function ($record) use ($correlationId) {
            $record['context']['correlation_id'] = $correlationId;
            return $record;
        });
    }
    
    public function onKernelResponse(ResponseEvent $event): void
    {
        $response = $event->getResponse();
        $correlationId = $event->getRequest()->attributes->get('correlation_id');
        $response->headers->set('x-correlation-id', $correlationId);
    }
}
```

**Money Format (String)**:

```php
class MoneyFormatter
{
    public function format(float $amount, string $currency = 'USD'): string
    {
        return number_format($amount, 2, '.', '');
    }
}

// In mapper
class BookingMapper
{
    public function __construct(private MoneyFormatter $moneyFormatter) {}
    
    public function map(Booking $booking): BookingResponse
    {
        return new BookingResponse(
            price: $this->moneyFormatter->format($booking->getPrice()),
            netPrice: $this->moneyFormatter->format($booking->getNetPrice()),
            // ...
        );
    }
}
```

**Error Handling**:

```php
class B2bExceptionListener implements EventSubscriberInterface
{
    public function onKernelException(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();
        $request = $event->getRequest();
        
        $statusCode = match (true) {
            $exception instanceof B2bUnauthorizedException => 401,
            $exception instanceof B2bClientNotFoundException => 404,
            $exception instanceof B2bValidationException => 422,
            default => 500,
        };
        
        $response = new JsonResponse([
            'code' => $this->getErrorCode($exception),
            'message' => $exception->getMessage(),
            'correlation_id' => $request->attributes->get('correlation_id'),
        ], $statusCode);
        
        $event->setResponse($response);
    }
}
```

**Structured Logging for Datadog**:

```php
// In controller
$this->logger->info('search.request', [
    'client_id' => $clientId,
    'correlation_id' => $correlationId,
    'departures' => $departures,
    'arrivals' => $arrivals,
    'duration_ms' => $duration,
]);

// Monolog configuration (config/packages/monolog.yaml)
monolog:
    handlers:
        datadog:
            type: socket
            connection_string: "udp://localhost:8125"
            formatter: monolog.formatter.json
            level: info
```

**Datadog Metrics**:

```php
// Via dd-trace-php (automatic) or manual
\DDTrace\Metrics::increment('b2b.search.request', 1, [
    'client_id' => $clientId,
    'status' => 'success',
]);

\DDTrace\Metrics::histogram('b2b.search.duration', $duration, [
    'client_id' => $clientId,
]);
```

## Key Differences: Monolith vs Microservice in PHP

| Aspect | Monolith (A) | Microservice (B) |
|---|---|---|
| **Code Location** | `frontend3/src/B2bApi/` | Separate repository |
| **Service Calls** | In-process (direct PHP calls) | HTTP (Symfony HttpClient) |
| **Performance** | ~5-10ms latency (no HTTP) | ~50-150ms latency (HTTP round-trip) |
| **Coupling** | High (tied to 12go internals) | Loose (HTTP contract) |
| **Deployment** | Same as 12go (coordinated) | Independent (separate pipeline) |
| **Database Access** | Direct MariaDB (via repositories) | None (stateless proxy) |
| **State** | Can use 12go's Redis/MariaDB | Only transient (seat lock in-process) |
| **Testing** | Mock 12go services | Mock HTTP client |
| **Debugging** | Single codebase, single process | Cross-service tracing needed |
| **Team Ramp-Up** | Same (PHP/Symfony) | Same (PHP/Symfony) |
| **AI Effectiveness** | Same (Symfony conventions) | Same (Symfony conventions) |
| **Maintenance** | Must coordinate with 12go team | Isolated changes |
| **Infrastructure** | Zero new infrastructure | New containers/services |

**Summary**: Both paths use PHP/Symfony, so the language learning curve is identical. The architectural difference (in-process vs HTTP) affects performance, coupling, and deployment independence, but not the PHP implementation details.
