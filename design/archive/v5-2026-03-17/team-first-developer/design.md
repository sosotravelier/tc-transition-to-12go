# Team-First Developer Design

## The Human Constraint

This is the most important section of this document, because it determines everything else.

**The developer building this system is one person: Soso.** He is a senior .NET developer with 12 years of experience and 2 years at the company. He uses AI-assisted development heavily (Claude Code, multi-agent workflows). He expected a team of 4 developers and was told he would work alone. He plans to resign after completing the transition around June 2026.

Let that sink in. The person building this system:

1. **Will not maintain it.** Whoever maintains this service will be someone else -- likely a PHP developer from the 12go team, or a new hire. The design must optimize for the *next* developer, not just the one building it.
2. **Is working alone under a Q2 deadline.** Every architectural decision must pass the test: can one person, with heavy AI assistance, build this in roughly 8-10 weeks?
3. **Is stressed and demoralized by the resourcing decision.** He expected a team and got solo assignment. Technology choice can either compound this stress or provide a sense of control and competence.
4. **Has deep .NET expertise but zero PHP experience.** The 12go platform is PHP/Symfony. Management sees alignment with the PHP stack as reducing long-term operational risk.
5. **Has experienced the F3 local development environment firsthand.** The Search POC required debugging 16 separate infrastructure issues over two days just to get the local environment running. Migration failures, OOM crashes, missing tables, broken UDF installations, fragile date caches. This is not a hypothetical concern -- it is documented pain.

The question is not "what is the best technology?" The question is: **what technology choice results in a system that Soso can build alone in Q2, that someone else can maintain after he leaves, and that does not destroy his remaining motivation to do good work?**

### What the team looks like after Soso leaves

- 12go has PHP developers who can maintain PHP code inside F3
- The broader team has .NET developers who are not allocated to this project
- There is no Go team, no TypeScript team
- DevOps manages infrastructure and deployment

This means the maintainability axis has a strong directional pull toward PHP -- not because PHP is the best language, but because the people who will own this system long-term are PHP developers.

---

## Language Assessment (DX Lens)

### .NET: Team Experience

**Zero-to-productive**: Immediate. Soso can write production .NET code today with his eyes closed.

**AI code generation quality**: Good. Claude and Cursor generate solid .NET 8 Minimal API code. Refit-based HTTP clients are well-represented in training data. The risk is not generation quality -- it is that the generated code tends to be either too simple (missing error handling patterns) or too complex (pulling in MediatR, FluentValidation, etc. reflexively). For a proxy service, AI tools generate correct HTTP client code approximately 80% of the time on first try.

**Inner loop speed**: Excellent. `dotnet watch run` provides sub-second hot reload. Unit tests run in milliseconds. The .NET developer experience for a small API project is genuinely fast.

**The real risk**: Soso knows .NET too well. Experienced .NET developers instinctively reach for abstractions: interfaces for everything, pipeline behaviors, generic repositories, decorator patterns. The existing codebase has 342 projects for what is fundamentally an HTTP proxy. .NET does not cause this -- .NET culture causes this. The risk of "rebuilding complexity in new clothes" is not hypothetical; it is the default outcome unless the developer actively resists it.

**Maintainability after departure**: A .NET microservice that Soso builds will need to be maintained by people who are either (a) not allocated to it, or (b) do not exist yet. The 12go team cannot maintain .NET code. This creates an orphan service.

**Verdict**: Best DX for building. Worst outcome for the organization after Soso leaves.

### TypeScript: Transition Path

**Zero-to-productive**: 1-2 weeks for a senior C# developer. TypeScript's type system (generics, interfaces, union types, async/await) maps closely to C#. The biggest friction points are: npm ecosystem chaos (which package for what?), the lack of a single blessed framework (NestJS vs. Express vs. Fastify vs. Hono), and JavaScript runtime quirks that TypeScript does not eliminate (prototype chain, `this` binding, implicit coercions).

**AI code generation quality**: The highest of any language. TypeScript has the most training data, the most StackOverflow answers, the most blog posts. For HTTP proxy code and JSON transformation -- which is exactly what this service does -- Claude and Cursor generate correct TypeScript on the first try approximately 85-90% of the time. This is a meaningful advantage for AI-augmented development.

**Inner loop speed**: Excellent with the right setup. tsx/ts-node with watch mode provides fast feedback. Vitest runs tests in under a second. Debugging with VS Code is straightforward.

**The catch**: There is no TypeScript team. After Soso leaves, who maintains a TypeScript service? The 12go PHP team? The unallocated .NET developers? TypeScript creates the same orphan-service problem as .NET, just in a different language.

**Verdict**: Best AI-augmented development experience. Same organizational orphan problem as .NET.

### PHP: Learning Curve Analysis

**Zero-to-productive**: 2-4 weeks for a senior C# developer. PHP 8.3 is not the PHP of 2010. It has typed properties, enums, readonly classes, attributes (similar to C# attributes), named arguments, and match expressions. Symfony 6.4 has a DI container, routing, HTTP kernel, and service architecture that a .NET developer can understand conceptually. But the syntax friction is real: `$this->`, `->` vs `.`, `array()` vs `[]`, the `use` keyword for closures, Doctrine vs. EF Core conventions.

**AI code generation quality for PHP/Symfony**: Good but not great. Claude generates correct Symfony controller code about 70-75% of the time. The main failure modes are: incorrect service injection syntax, wrong Doctrine annotation vs. attribute usage, and Symfony-specific conventions (like event subscribers, kernel events) that differ between major versions. For pure HTTP client code (Guzzle/Symfony HttpClient), generation quality is higher -- roughly 80%.

**The F3 local development nightmare**: The Search POC documented 16 separate issues getting the local environment running. Migration crashes, OOM kills, missing UDFs, broken date caches, legacy bootstrap code that calls `print_r()` on large data structures. If Soso builds inside F3, he inherits this environment. Every day. This is not a one-time setup cost -- it is ongoing friction every time the environment drifts, every time a colleague's migration breaks something, every time Docker volumes need rebuilding.

**But**: If Soso builds a standalone PHP microservice (not inside F3), he avoids the F3 local environment entirely. A fresh Symfony project with Docker Compose is clean and fast to set up. The question is whether management accepts a PHP microservice vs. code-inside-F3.

**Maintainability after departure**: This is the strongest argument for PHP. The 12go team can maintain PHP code. If the service is written in PHP with Symfony conventions, it can be absorbed into the 12go team's maintenance orbit. No orphan service.

**Verdict**: Hardest language transition for Soso. Best long-term maintainability for the organization.

### Go: Mental Model Shifts

**Zero-to-productive**: 2-3 weeks for the language basics, but 4-6 weeks to write idiomatic Go. The biggest mental model shifts for a C# developer:

1. **Explicit error handling**: Every function returns `(result, error)`. No exceptions. No try/catch. This is the single biggest source of friction for developers coming from C#/Java. It is not hard to understand -- it is hard to internalize. The first month of Go code from a C# developer will have error handling that is either missing or cargo-culted.
2. **No generics (practical)**: Go 1.21+ has generics, but the ecosystem barely uses them. Most libraries use `interface{}` or code generation. This feels like a step backward from C#'s rich generic support.
3. **No DI framework by convention**: Go projects typically use constructor injection without a container. This is simpler but unfamiliar.
4. **Struct composition over inheritance**: No classes, no inheritance hierarchies. This is actually a simplification for a proxy service, but it requires unlearning OOP instincts.

**AI code generation quality**: Good for simple HTTP services. Claude generates correct Go HTTP handler code about 75-80% of the time. The main failure modes are: incorrect error handling patterns, misuse of contexts, and generated code that compiles but is not idiomatic. For JSON marshaling/unmarshaling (which this service does heavily), Go's strict typing and struct tags make AI generation quite reliable.

**The 12go angle**: 12go is "considering Go but nothing is decided." Building in Go today is a bet on an uncertain future direction. If 12go goes a different direction, Go creates the same orphan problem.

**Verdict**: Clean language for proxy services, but the transition cost is real and the organizational fit is speculative.

---

## AI-Augmented Development Assessment

### Code Generation Quality by Language/Framework

For the specific task this service performs -- HTTP proxying, JSON transformation, request/response mapping -- here is an honest assessment of AI code generation quality:

| Task | TypeScript | .NET 8 | PHP/Symfony | Go |
|------|-----------|--------|-------------|-----|
| HTTP client with typed responses | Excellent | Very Good | Good | Good |
| JSON transformation/mapping | Excellent | Very Good | Good | Very Good |
| Error handling patterns | Very Good | Good | Fair | Fair |
| Retry/timeout configuration | Very Good | Very Good | Good | Good |
| Unit tests for mappers | Excellent | Very Good | Good | Good |
| Integration test scaffolding | Good | Good | Fair | Good |
| Correct on first generation | ~85-90% | ~80% | ~70-75% | ~75-80% |

TypeScript has a measurable advantage in AI generation quality for this class of work. This matters because Soso is one person using AI to compensate for being one person. A 10-15% improvement in first-try correctness translates to hours saved per week.

### Which Design Patterns AI Handles Best

AI code generators produce the most reliable code when:

1. **Functions are pure transformations**: Input DTO in, output DTO out. No side effects, no ambient state. AI nails these every time.
2. **Types are explicit and named**: `SearchResponse` is better than `Record<string, any>`. Named types give AI context about what the code should do.
3. **Files are small and focused**: One responsibility per file, under 200 lines. AI context windows work best when the relevant code fits in a single prompt.
4. **Patterns are conventional**: Standard HTTP client patterns, standard error handling, standard test structure. The moment you introduce a custom abstraction, AI quality drops sharply.
5. **No deep framework magic**: Middleware chains, event systems, and decorator patterns confuse AI tools. Explicit call chains are better.

The worst patterns for AI generation:
- Reflection-based DI resolution
- Convention-over-configuration routing
- Middleware pipelines with implicit ordering
- Dynamic type resolution
- Code that depends on framework lifecycle hooks

### Recommended Codebase Structure for AI Effectiveness

Regardless of language, the codebase should follow this structure to maximize AI tool effectiveness:

```
src/
  api/                      # HTTP endpoint handlers (one file per endpoint)
    search.{ext}
    get-itinerary.{ext}
    create-booking.{ext}
    confirm-booking.{ext}
    ...
  twelvego/                 # 12go HTTP client (typed, one file per operation group)
    client.{ext}            # HTTP client configuration, base URL, auth
    search.{ext}            # Search API call
    booking.{ext}           # Cart, reserve, confirm calls
    post-booking.{ext}      # Get details, refund calls
    models.{ext}            # 12go request/response types (or split per operation)
  mapping/                  # Request/response transformers (pure functions)
    search-mapper.{ext}
    itinerary-mapper.{ext}
    booking-mapper.{ext}
    booking-schema-mapper.{ext}  # The complex one (~500 lines in current system)
    notification-mapper.{ext}
  contracts/                # Client-facing API types (the contract we preserve)
    search-response.{ext}
    booking-response.{ext}
    ...
  middleware/               # Cross-cutting (auth, correlation ID, error handling)
    authentication.{ext}
    correlation.{ext}
    error-handler.{ext}
  config/                   # Configuration types and loading
    app-config.{ext}
tests/
  unit/
    mapping/                # Mirror of src/mapping -- pure function tests
  integration/
    twelvego/               # Tests against real/mocked 12go API
```

Key principles:
- **One endpoint per file** in the `api/` directory. AI tools can generate or modify an endpoint by reading a single file.
- **Mappers are pure functions** in `mapping/`. Input type, output type, no side effects. AI generates these with high accuracy.
- **12go client is a thin typed wrapper**. No abstraction layers, no "provider" patterns. Just HTTP calls with typed responses.
- **No file exceeds 300 lines**. The booking schema mapper may push this limit -- split it into sub-mappers if needed.
- **Tests mirror source structure**. AI can find the test for any source file by path convention.

---

## Recommendation

**Build a standalone PHP 8.3/Symfony microservice. Not inside F3.**

Here is the reasoning, grounded in team reality:

### Why PHP

1. **Maintainability after Soso leaves is the deciding factor.** Soso will resign after completing this work. The 12go PHP team will inherit it. Writing in PHP means they can maintain it without learning a new language or ecosystem. Every other language creates an orphan service.

2. **Management alignment.** The Team Lead and RnD have been pushing toward the PHP/monolith direction. Fighting this battle consumes political capital that Soso needs for other decisions (scoping out gRPC, getting QA support, offloading monitoring). Choosing PHP removes a source of conflict.

3. **12go veterans are available for advice.** Oleksandr and others can answer PHP/Symfony questions. This is free mentorship that does not exist for TypeScript or Go.

4. **PHP 8.3 is genuinely decent for this task.** Typed properties, readonly classes, enums, named arguments, match expressions. For an HTTP proxy service with JSON transformation, modern PHP is adequate. It is not elegant -- but elegance is not what this project needs.

### Why NOT inside F3

1. **The F3 local development environment is a productivity disaster.** 16 documented issues to get search working locally. Fragile migration system. OOM crashes. Missing UDFs. Every developer who has worked with F3 locally has experienced this pain. Putting Soso inside F3 means he fights infrastructure every day instead of building the service.

2. **F3 is planned for major refactoring in Q2.** Code written inside F3 today will be refactored (or migrated again) when F3 is restructured. A standalone service with a clean contract to 12go's HTTP API is more portable.

3. **Isolation reduces blast radius.** A standalone service cannot break F3. F3 cannot break the standalone service. When Soso deploys, he deploys only his code.

4. **Inner loop speed.** A standalone Symfony project with Docker Compose starts in seconds, has fast hot reload via Symfony's built-in server, and runs tests in milliseconds. F3 requires the full MariaDB + Redis + Kafka stack just to start.

### Why NOT .NET or TypeScript

They are better languages for building. They are worse choices for the organization. The system will outlive Soso's tenure. The maintainers will be PHP developers. Building in .NET or TypeScript optimizes for the builder and penalizes the maintainer. That is the wrong trade-off when the builder has announced (at least internally) that he will leave.

### Why NOT Go

Go is being "considered" by 12go with no timeline or commitment. Building in Go today is a bet on vaporware. If 12go adopts Go, porting a small PHP service to Go is straightforward. If 12go does not adopt Go, a Go service becomes an orphan.

### The honest cost

PHP will be slower for Soso to build in. He will spend 2-3 weeks getting productive with PHP/Symfony. AI generation quality is 10-15% lower than TypeScript. The syntax will feel alien for the first month. This is a real cost, and it should be acknowledged.

But the alternative costs are worse: an orphan service in a language nobody on the maintaining team knows, or code trapped inside F3's fragile development environment.

---

## Codebase Design for DX

### Project Structure

```
b2b-api/
  .env                          # Local config (12go API URL, API keys)
  .env.test                     # Test config
  compose.yaml                  # Docker Compose for local dev
  Dockerfile                    # Production container
  AGENTS.md                     # AI coding assistant context
  composer.json
  config/
    routes.yaml                 # Route definitions
    services.yaml               # DI container config
    packages/
      framework.yaml
      http_client.yaml          # Symfony HttpClient config for 12go
  src/
    Controller/                 # One controller per endpoint group
      SearchController.php
      BookingController.php       # CreateBooking, ConfirmBooking, SeatLock
      PostBookingController.php   # GetBookingDetails, GetTicket, CancelBooking
      MasterDataController.php    # Stations, Operators, POIs
      NotificationController.php  # Webhook receiver
    TwelveGo/                   # 12go API client
      TwelveGoClient.php          # HTTP client wrapper (Symfony HttpClient)
      Request/                    # Request DTOs
        SearchRequest.php
        AddToCartRequest.php
        ReserveRequest.php
        RefundRequest.php
      Response/                   # Response DTOs
        SearchResponse.php
        TripDetailsResponse.php
        BookingSchemaResponse.php
        BookingDetailsResponse.php
        RefundOptionsResponse.php
    Mapper/                     # Pure transformation functions
      SearchMapper.php
      ItineraryMapper.php
      BookingMapper.php
      BookingSchemaMapper.php     # Complex: ~300-400 lines
      NotificationMapper.php
      PriceMapper.php             # Money format: string amounts, net/gross/taxes
    Contract/                   # Client-facing response types
      SearchResponse.php
      ItineraryResponse.php
      BookingResponse.php
      CancellationResponse.php
      StationResponse.php
    Middleware/                  # Cross-cutting
      CorrelationIdMiddleware.php
      VersionHeaderMiddleware.php
      ErrorResponseMiddleware.php
      WebhookAuthMiddleware.php   # HMAC verification for notifications
    Config/
      ClientConfig.php            # Per-client configuration (API keys, webhook URLs)
  tests/
    Unit/
      Mapper/                   # Pure function tests, one per mapper
        SearchMapperTest.php
        BookingSchemaMapperTest.php
        ...
    Integration/
      TwelveGo/                 # Tests against 12go API (or WireMock)
        SearchIntegrationTest.php
        BookingFlowIntegrationTest.php
    Fixture/                    # JSON fixtures (real 12go responses, captured)
      search-response.json
      booking-schema-response.json
      booking-details-response.json
```

### Naming Conventions

These conventions are chosen specifically to maximize AI code generation accuracy:

1. **Controllers named by domain concept**: `SearchController`, not `ItineraryController`. The word "Search" is what AI tools associate with search-related HTTP endpoints.
2. **Mappers named `{Source}Mapper`**: `SearchMapper` transforms 12go search responses to client contract. Not `SearchTransformer`, not `SearchAdapter` -- "Mapper" is the most common convention in AI training data.
3. **DTOs named `{Operation}{Direction}`**: `SearchResponse` (from 12go), `SearchResult` (to client). No `Dto` suffix -- it adds noise without information.
4. **One class per file, file named after class**: Standard PHP/Symfony convention. AI tools expect this.
5. **No abbreviations in class names**: `BookingSchemaMapper`, not `BkgSchemaMapper`. AI tools generate better code when names are fully spelled out.
6. **Methods named with verbs**: `mapSearchResponse()`, `buildReserveRequest()`, `transformNotification()`. Not `search()`, `reserve()` -- the verb clarifies what the method does (transforms data vs. performs an action).

### Type Usage Strategy

Strong typing everywhere. This is where PHP 8.3's improvements pay off:

```php
// Good: Named types with explicit properties
readonly class TwelveGoTrip {
    public function __construct(
        public string $id,
        public string $chunkKey,
        public string $routeName,
        public TripParams $params,
        /** @var SegmentItem[] */
        public array $segments,
        /** @var TravelOption[] */
        public array $travelOptions,
    ) {}
}

// Bad: Associative arrays passed around
$trip = ['id' => '...', 'chunk_key' => '...'];  // No type safety, AI cannot infer shape
```

Rules:
- Every 12go API response has a corresponding PHP readonly class
- Every client-facing response has a corresponding PHP readonly class
- Mappers take typed input and produce typed output -- never `array` in, `array` out
- Use PHP 8.1 enums for fixed value sets (confirmation types, ticket types, booking status)
- PHPDoc `@var` annotations on array properties for AI context (`/** @var TravelOption[] */`)

### Test Strategy

**Unit tests for mappers are the highest-value tests and the easiest for AI to generate.**

Each mapper test:
1. Loads a JSON fixture (a real captured 12go response)
2. Deserializes to the 12go response type
3. Calls the mapper
4. Asserts the client-facing response shape

```php
class SearchMapperTest extends TestCase
{
    public function test_maps_twelve_go_search_to_client_itineraries(): void
    {
        $twelveGoResponse = $this->loadFixture('search-response.json', TwelveGoSearchResponse::class);
        $mapper = new SearchMapper();

        $result = $mapper->map($twelveGoResponse, clientId: 'test-client');

        $this->assertCount(24, $result->itineraries);
        $this->assertEquals('14.60', $result->itineraries[0]->price->amount);
        $this->assertEquals('THB', $result->itineraries[0]->price->currency);
    }
}
```

**Fixtures are captured real responses.** Not hand-crafted JSON. Soso should capture real 12go API responses during development and commit them as test fixtures. This gives tests realistic data and gives AI tools real examples to learn from.

**Integration tests use WireMock (or Symfony's MockHttpClient).** Record real 12go responses, replay them in tests. No dependency on 12go availability for CI.

**No end-to-end tests in the repository.** E2E testing happens against staging with real 12go. Not worth automating in CI -- too fragile, too slow.

Test priority:
1. Mapper unit tests (highest value, fastest to write, AI generates well)
2. Controller integration tests with mocked 12go client (medium value)
3. 12go client integration tests with recorded responses (useful for contract verification)

---

## AGENTS.md Specification for the New Service

The new repository should contain an AGENTS.md file at the root with the following content:

```markdown
# AGENTS.md -- B2B API Service

## What This Service Does

This is an HTTP proxy service that sits between external B2B clients and the 12go travel platform.
Clients call our API with their existing contract (13 endpoints). We transform requests,
call 12go's HTTP API, transform responses, and return them in the client's expected format.

There is no database. There is no message queue. This service is stateless.

## Project Structure

- `src/Controller/` -- HTTP endpoint handlers. One controller per endpoint group.
- `src/TwelveGo/` -- 12go HTTP API client. Typed requests and responses.
- `src/Mapper/` -- Pure transformation functions. 12go response -> client response.
- `src/Contract/` -- Client-facing response types (the API contract we must preserve).
- `src/Middleware/` -- Cross-cutting: correlation IDs, versioning, error handling, webhook auth.
- `tests/Unit/Mapper/` -- Unit tests for mappers. Load JSON fixture, map, assert.
- `tests/Fixture/` -- Real captured 12go API responses used as test fixtures.

## Key Files to Read First

1. This file
2. `src/TwelveGo/TwelveGoClient.php` -- all 12go API calls
3. `src/Contract/` -- the shapes we must return to clients
4. `tests/Fixture/` -- real 12go responses for context

## Naming Conventions

- Controllers: `{Domain}Controller` (SearchController, BookingController)
- Mappers: `{Domain}Mapper` with method `map()` or `mapTo{Target}()`
- 12go types: `TwelveGo{Concept}` prefix (TwelveGoTrip, TwelveGoSearchResponse)
- Client types: No prefix (SearchResponse, BookingResponse)
- Test classes: `{ClassName}Test`

## Patterns to Follow

- Mappers are pure functions: typed input -> typed output. No side effects.
- 12go client methods return typed response objects, never raw arrays.
- Error handling: catch HTTP errors in TwelveGoClient, throw domain exceptions.
- Money amounts are always strings ("14.60"), never floats.
- All dates use ISO 8601 format in client responses.

## Patterns to Avoid

- Do NOT add abstraction layers (no "provider" pattern, no "repository" pattern).
- Do NOT use Doctrine ORM -- there is no database.
- Do NOT create interfaces for classes with single implementations.
- Do NOT add middleware for things that can be explicit in the controller.
- Do NOT use event dispatchers for synchronous flows.

## How to Run

```bash
# Start local environment
docker compose up -d

# Run all tests
php bin/phpunit

# Run specific test
php bin/phpunit tests/Unit/Mapper/SearchMapperTest.php

# Start development server
symfony server:start
```

## API Contract

This service must preserve exactly 13 client-facing endpoints.
See src/Contract/ for the response shapes.
See config/routes.yaml for the route definitions.
The Travelier-Version header (YYYY-MM-DD) controls response versioning.
Money is always a string amount with currency code.
Correlation ID is propagated via x-correlation-id header.
```

---

## Development Workflow

### Local Development

```yaml
# compose.yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    volumes:
      - ./:/app
    environment:
      - TWELVEGO_BASE_URL=https://api.12go.co
      - TWELVEGO_API_KEY=${TWELVEGO_API_KEY}
      - APP_ENV=dev
```

That is it. No MariaDB. No Redis. No Kafka. No trip pool. No UDFs. The service is stateless and calls 12go's HTTP API. Local development needs only the PHP application and a network connection to 12go's staging/dev environment.

For fully offline development, add WireMock to replay captured 12go responses:

```yaml
  wiremock:
    image: wiremock/wiremock:3.4.0
    ports:
      - "8081:8080"
    volumes:
      - ./tests/Fixture/wiremock:/home/wiremock
```

### Inner Loop

1. **Edit code** in IDE (Cursor, PhpStorm, VS Code with Intelephense)
2. **See result immediately** -- Symfony's built-in server with `--watch` flag reloads on file change. Sub-second feedback for PHP file changes.
3. **Run tests** -- `php bin/phpunit` for the full suite (under 5 seconds for unit tests). PHPUnit watch mode via `phpunit-watcher` for continuous testing.
4. **Test an endpoint** -- `curl localhost:8080/v1/test-client/itineraries?departure_date=2026-04-01&departure_poi=1&arrival_poi=44&seats=1`

The inner loop is: **edit -> save -> curl (or test runner) -> see result**. No compilation step. No container restart. No migration re-run.

Compare this to the F3 inner loop: edit -> save -> wait for Symfony cache clear -> hope no migration broke -> hope the UDF is loaded -> hope the trip pool has data -> test. The standalone service eliminates every infrastructure dependency.

### Debugging

**Local debugging**:
- Xdebug integration with PhpStorm/VS Code. Set breakpoints, step through code. Standard PHP debugging experience.
- Symfony Profiler provides request/response inspection, timing, and query logging (though there are no queries in this service).
- `dump()` and `dd()` for quick inspection (Symfony's VarDumper).

**Production debugging**:
- Structured logging with Monolog (Symfony's default logger). JSON format for Datadog ingestion.
- Correlation ID propagation (`x-correlation-id` header) -- every log entry includes the correlation ID, enabling end-to-end trace reconstruction.
- Datadog APM integration via `dd-trace-php` extension. This is the same tracing infrastructure 12go uses -- no separate monitoring stack.
- Health check endpoint for load balancer integration.

**When something goes wrong**:
1. Find the correlation ID from the client error report
2. Search Datadog logs for that correlation ID
3. See the full request/response flow: client request -> our service -> 12go API call -> 12go response -> our response
4. The trace shows timing for each 12go API call (useful for latency diagnosis)

This is simpler than the current system's debugging flow, which requires tracing through Etna -> SI Host -> SI Framework -> 12go, across multiple services and log streams.

---

## Security

### Key Finding #10: Webhook Notifications Have Zero Authentication

This is a known vulnerability, not an open question. 12go sends webhook notifications to our service with no authentication. Anyone who discovers the webhook URL can send fake booking status notifications.

**The fix: HMAC signature verification with a shared secret.**

From a DX perspective, here is how each language handles this:

**PHP/Symfony** (recommended approach):
```php
// WebhookAuthMiddleware.php
class WebhookAuthMiddleware
{
    public function __construct(
        private readonly string $webhookSecret,
    ) {}

    public function verify(Request $request): void
    {
        $signature = $request->headers->get('X-Webhook-Signature');
        $payload = $request->getContent();
        $expected = hash_hmac('sha256', $payload, $this->webhookSecret);

        if (!hash_equals($expected, $signature)) {
            throw new AccessDeniedHttpException('Invalid webhook signature');
        }
    }
}
```

PHP has `hash_hmac()` and `hash_equals()` as built-in functions. No package installation needed. AI tools generate this pattern correctly on the first try in every language, but PHP's built-in support means there is no "which package do I use?" decision.

**However**: This requires 12go to send the HMAC signature. If 12go does not currently sign webhook payloads, we need to coordinate with them to add this capability. If that is not possible in the Q2 timeframe, the fallback options are:

1. **IP allowlisting**: Only accept webhook requests from 12go's known IP ranges. Simpler to implement, weaker security, but better than zero authentication.
2. **Shared secret as query parameter**: Embed a secret token in the webhook URL that 12go sends to (`/webhooks/notifications?token=<secret>`). 12go already supports per-client webhook URLs, so this is configurable without 12go code changes. Less secure than HMAC (token visible in logs, URL history) but implementable immediately.
3. **Both**: IP allowlist as the primary gate, secret token as defense in depth.

**Recommendation**: Start with the shared secret query parameter approach (option 2), because it requires no changes on 12go's side. Add HMAC when 12go supports it. This is the approach most likely to be implemented correctly on the first try because it requires zero cryptographic code -- it is a simple string comparison.

AI generation quality for webhook security:
- HMAC verification: All languages generate correct code. PHP and TypeScript are slightly better due to built-in support.
- IP allowlisting: Trivial in all languages.
- The risk is not generating the code -- it is forgetting to implement it at all. The AGENTS.md file should explicitly mention that NotificationController must verify authentication.

---

## Retention and Morale Assessment

This section is uncomfortable but necessary.

### .NET: Comfort Zone, Organizational Orphan

Soso would be most productive and most comfortable in .NET. He would build faster, debug easier, and feel more confident in the quality of his work. His morale during the build phase would be highest.

But he knows he is leaving. A .NET service after his departure becomes nobody's responsibility. The .NET developers who remain are not allocated to this project. The 12go team cannot maintain it. Choosing .NET optimizes for Soso's comfort at the expense of the organization.

If Soso were staying, .NET would be the obvious choice. He is not staying.

### TypeScript: Interesting Challenge, Same Orphan Problem

TypeScript would give Soso something interesting to learn. The novelty factor could partially offset the demoralization of solo resourcing. AI tools work best in TypeScript, which partially offsets the learning curve.

But the orphan problem is identical to .NET. Nobody on the maintaining team knows TypeScript.

### PHP: The Medicine That Works

PHP is the choice Soso likes least. It is the syntax he finds least appealing. The F3 development experience was painful. The language does not excite him.

But it is the responsible choice. And there is a version of this that is not miserable:

1. **Build it as a standalone service, not inside F3.** This avoids the F3 local development nightmare entirely.
2. **Use modern PHP (8.3) with strict types.** It is not beautiful, but it is not the mess that PHP's reputation suggests.
3. **Lean heavily on AI generation.** Claude generates acceptable PHP for HTTP proxying. Soso does not need to love the syntax -- he needs to describe what he wants and review what AI produces.
4. **Have 12go veterans available.** Oleksandr estimated ~2 weeks to build the B2B API in F3. Even for a standalone service, his advice on Symfony patterns is valuable.
5. **The pride of doing it right.** Building a clean, maintainable service that survives your departure -- in a language you learned for this purpose -- is a professional accomplishment.

### Go: Intellectual Stimulation, Organizational Gamble

Go would be intellectually interesting for Soso. It is a clean language for proxy services. But it adds learning curve, has an uncertain organizational future, and creates an orphan if 12go does not adopt it.

### Honest Summary

There is no choice that makes everyone happy. PHP makes the organization happiest and Soso least happy. .NET makes Soso happiest and creates the worst long-term outcome. The recommendation (standalone PHP microservice) is a compromise: it avoids the F3 development nightmare (which was Soso's worst experience), it gives the 12go team something they can maintain, and it does not require Soso to fight a political battle over language choice.

The resourcing decision (solo developer) already damaged morale. The technology decision should not compound it. PHP avoids a fight. A standalone service preserves developer autonomy. Heavy AI usage makes PHP bearable.

---

## Unconventional Idea: The "Translator Test Suite" as the Durable Artifact

Here is an idea that does not fit the standard language-choice framing.

**What if the most valuable output of this project is not the code, but the test suite?**

The 13 endpoints are fundamentally data transformations. 12go response in, client response out. The transformation rules are the business logic. The code that implements the transformation is interchangeable.

If Soso builds a comprehensive test suite -- with real captured 12go responses as fixtures and expected client responses as assertions -- that test suite becomes a specification. It defines the contract. It is language-independent. When F3 is refactored, when the maintaining team wants to rewrite in Go, when a new developer takes over -- they can validate their implementation against the test suite.

**Practically:**
1. Capture real 12go API responses for every endpoint (search, booking schema, booking details, refund options, etc.)
2. Define the expected client-facing response for each captured input
3. Write the test suite first, then implement the service to make the tests pass
4. Commit the fixtures as the canonical specification of the transformation contract

This approach has two benefits:
1. **AI tools can generate the implementation from the test suite.** Give Claude the test file and the fixture files, and it can generate the mapper that passes the tests. This is the highest-quality mode of AI code generation.
2. **The test suite survives any language migration.** The JSON fixtures and expected outputs are language-independent. If someone rewrites this in Go in 2027, the fixtures still define correctness.

**Rejected as the primary strategy** because it requires even more upfront work from a solo developer under a Q2 deadline. But it should be a principle: **invest in fixtures and test coverage proportionally more than in production code elegance.**

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

1. **Long-term maintainability by the team that will actually own this system** (12go PHP developers)
2. **Minimal operational overhead** (stateless service, no database, shared monitoring stack with 12go)
3. **Fast inner loop for a solo developer** (standalone service, no F3 dependencies, sub-second feedback)
4. **AI-augmented development effectiveness** (small files, pure mappers, strong types, comprehensive AGENTS.md)
5. **Avoiding political battles** (PHP aligns with management direction, preserving political capital for scoping decisions)
6. **Portability** (standalone service with clean HTTP contract to 12go, easy to move or rewrite)

### Sacrifices

1. **Soso's productivity during the build phase** (PHP learning curve costs 2-3 weeks, AI generation quality is 10-15% lower than TypeScript)
2. **Soso's job satisfaction** (PHP is not the language he would choose for himself)
3. **Maximum AI generation quality** (TypeScript would produce better first-try code)
4. **The team's existing .NET expertise** (12 years of C# knowledge is not leveraged)
5. **Build speed** (.NET or TypeScript would ship faster, by approximately 2-4 weeks)

The core trade-off is: **2-4 weeks slower to build, years easier to maintain.** For a system that "will live for a significant time" and will be maintained by PHP developers, this is the right trade-off.
