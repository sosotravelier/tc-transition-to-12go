# Team-First Developer Design

## The Human Constraint

This is not a team of 2-3 senior .NET developers. As of March 17, 2026, the reality is: **one person will build this system**. Soso -- a senior .NET developer with 12 years of experience, 2 years at this company, who uses AI coding tools (Claude Code, multi-agent workflows) as a daily force multiplier.

The factors shaping this decision:

1. **Solo developer.** No pair programming, no code review from peers on this project, no one to bounce ideas off in real time. Every technology choice must be something one person can debug at 2am when production breaks.

2. **Q2 2026 deadline.** New clients must be able to onboard this quarter. This is weeks, not months. There is no time for a meaningful language ramp-up.

3. **Not throwaway.** Team Lead confirmed this design will live for a significant time. New clients onboard, old clients migrate gradually. This is not a quick hack that gets replaced in 3 months.

4. **F3 feature work runs in parallel.** The developer building the B2B layer will also be making changes to F3 (cancellation policies, etc.). This means PHP context-switching is mandatory regardless of the B2B language choice.

5. **F3 local development is painful.** The Search POC documented 16 separate infrastructure issues, including cascading migration failures, OOM crashes from legacy PHP bootstrap code, missing UDFs, and a migration runner that silently skips years of migrations after a single failure. This is the environment that will be part of daily work.

6. **AI-assisted development is the plan.** Soso will lean heavily on Claude Code and multi-agent workflows to compensate for being a solo developer. The codebase design must maximize AI tool effectiveness.

7. **The "one system" vision is an organizational constraint.** Management wants no permanent separation between 12go core and B2B. Long-term, everything converges.

The question I keep returning to: **what technology choice lets one developer, working alone under deadline pressure, ship a reliable HTTP proxy service while simultaneously making changes to a PHP monolith?**

---

## Language Assessment (DX Lens)

### .NET: Team Experience

**Zero-to-productive**: Immediate. Soso has 12 years of C# experience. No ramp-up time on the language itself.

**The real risk -- "rebuilding old patterns in new clothes"**: This is the single biggest danger with .NET. Soso comes from a codebase with ~342 projects, MediatR pipelines with 10+ behaviors, Autofac DI containers, multi-supplier abstractions, and triple-caching layers. The muscle memory of a senior .NET developer is to reach for abstractions: interfaces for everything, generic repositories, pipeline patterns, service layers wrapping service layers. The existing system is proof of this tendency -- it is essentially an HTTP proxy that grew to 200-400K lines of code.

.NET 8 Minimal API is genuinely simpler than the MVC/MediatR patterns the team knows. But it is still .NET, and the ecosystem pulls toward complexity. NuGet packages for "clean architecture" templates, MediatR, FluentValidation, AutoMapper -- every one of these is a click away and feels natural. The risk is not that Soso cannot use .NET 8 Minimal API; the risk is that after 2 weeks, the codebase looks like a smaller version of what it replaced.

**AI code generation quality**: Good but not great. Claude and Cursor generate solid .NET 8 Minimal API code. Refit client generation works well. Where AI struggles: complex DI registration patterns, middleware ordering, and the many .NET-specific gotchas around HttpClient lifecycle, IOptions patterns, and configuration binding. The more "framework-y" the .NET code gets, the more AI-generated code needs manual correction.

**Operational cost**: A separate .NET microservice means maintaining a second deployment pipeline, a second Docker image, a second set of infrastructure. With one developer who also needs to make F3 changes, this is two codebases and two deployment systems to manage.

**Verdict**: The safest choice for getting correct code quickly. The most dangerous choice for keeping the codebase simple over time. If someone can enforce extreme discipline against abstraction creep -- and that someone is the sole developer under deadline pressure with no code reviewer -- this works. That is a big "if."

### TypeScript: Transition Path

**Zero-to-productive**: 1-2 weeks for a senior C# developer to become productive in TypeScript. The type system maps closely: generics, interfaces, async/await, union types (which C# is only now getting). The biggest adjustment is not the language but the ecosystem: npm, the module system, the lack of a single "right way" to structure projects. NestJS mirrors .NET's patterns (DI, decorators, modules) but this is also its risk -- it can become just as over-engineered as the .NET codebase it replaces.

**For this specific task (HTTP proxy + data transformation)**: TypeScript excels. Fetch/Axios for HTTP calls, strong typing for request/response models, native JSON handling without serialization ceremony. The booking schema parser with its 20+ dynamic field patterns is actually easier to express in TypeScript than C# -- pattern matching on object keys is natural in JS/TS, whereas C# required `[JsonExtensionData]` and manual string matching.

**AI code generation quality**: The strongest of any language. TypeScript has the most training data in AI models. For HTTP proxy patterns and JSON transformation, Claude/Cursor generate correct TypeScript code on the first try more reliably than any other language. Type definitions for the 12go API surface would be generated with high accuracy. Test generation works well because of the straightforward test runner ecosystem (Vitest, Jest).

**Inner loop speed**: Excellent. `tsx --watch` for instant reload. Vitest runs unit tests in under a second. No compilation step. This matters enormously for a solo developer -- every second saved in the feedback loop compounds.

**The actual risk**: Soso has not shipped production TypeScript. Learning a new language under deadline pressure, alone, with no one to ask "is this idiomatic?" is stressful. Even with AI assistance, there will be moments of uncertainty: "Should I use a class or a plain object? Is this the right way to handle errors in Node.js? Why is my Promise not resolving?"

**Ecosystem maturity for this use case**: Mature. Express/Fastify for HTTP, Zod for validation, built-in fetch (Node 18+). No heavy framework needed. The simplicity ceiling is low -- it is genuinely hard to over-engineer a TypeScript HTTP proxy.

**Verdict**: The best language for AI-augmented development and for this specific task. The risk is that it introduces a new language to a solo developer under time pressure, and there is no team to absorb that learning cost.

### PHP: Learning Curve Analysis

**Zero-to-productive**: 2-4 weeks to write competent Symfony code. PHP's syntax is different enough from C# to cause constant friction in the first weeks: `$this->`, `->` vs `.`, `array()` vs `[]` (both work), `use` statements for closures, the lack of strong typing in older code, and Symfony's annotation/attribute-based routing.

**The F3 alignment argument**: This is the strongest argument for PHP, and it comes from the organizational direction, not from developer experience. If the B2B code lives inside F3, it gets F3's authentication, tracing, API versioning, and deployment pipeline for free. There is no second service to deploy. When F3 is refactored, the B2B code moves with it.

**The F3 local development counter-argument**: The Search POC documented 16 issues getting F3 running locally. The migration system is fragile -- a single failed migration in 2024 left the database broken for 2 years. The legacy PHP bootstrap has OOM bugs. Trip pool pricing requires manual synthetic data insertion. This is the daily development experience of working inside F3.

**AI code generation quality**: Good for modern PHP 8.3 with Symfony 6.4. Claude generates correct Symfony controllers, services, and Doctrine entities. Where it struggles: Symfony's event system, custom compiler passes, and the interaction between bundles. For the specific task of writing HTTP proxy code and data transformers, AI generation is adequate but not as reliable as TypeScript.

**The solo developer writing PHP for the first time**: This is the core DX concern. Soso has never shipped production PHP. Symfony has concepts that map to .NET (DI container, middleware, routing) but the syntax and conventions are foreign. Debugging PHP is different -- `var_dump()` culture, Xdebug configuration, Symfony's profiler. Error messages are less helpful than .NET's. The IDE experience in PhpStorm is good but not as refined as Rider for .NET.

**However**: Soso will be making F3 changes regardless (cancellation policies, new capabilities). This means PHP learning is not optional -- it is happening. The question is whether to learn PHP for small F3 changes while writing the main B2B layer in a known language, or to go all-in on PHP.

**Verdict**: The organizationally aligned choice. The most painful choice for developer experience in the short term. If the F3 monolith path is taken, this is the language by default -- and the pain is the price of organizational alignment.

### Go: Mental Model Shifts

**Zero-to-productive**: 2-3 weeks for the language basics, 4-6 weeks to write idiomatic Go. The mental model shift is significant: explicit error handling (no exceptions, `if err != nil` everywhere), no generics until recently (and the generics are limited), no inheritance, goroutines and channels for concurrency.

**For this specific task**: Go is excellent for HTTP proxy services. The standard library's `net/http` is production-grade. JSON marshaling/unmarshaling is straightforward. Go compiles to a single binary -- deployment is simple. But the booking schema parser with 20+ dynamic field patterns is awkward in Go. Go's type system does not handle dynamic JSON shapes elegantly -- you end up with `map[string]interface{}` and manual type assertions.

**AI code generation quality**: Good for standard patterns (HTTP handlers, JSON parsing, struct definitions). Weaker for complex data transformations, error handling chains, and the kind of dynamic JSON manipulation this system needs. Claude generates Go that compiles but often misses idiomatic patterns -- a Go expert would refactor it.

**The "considered by 12go" angle**: 12go is considering Go but nothing is decided. Building in Go today would mean building in a language that might align with 12go's future -- or might not. This is a bet, not a guarantee.

**Inner loop speed**: Fast compilation (under 2 seconds for small services). Good test runner. But no hot reload -- you restart the binary after each change. For a proxy service, this is fast enough.

**Verdict**: A strong technical choice for HTTP proxy services, but the wrong choice for a solo developer learning a new language under deadline pressure, especially given the dynamic JSON transformation requirements. Go's strengths (concurrency, performance, simplicity) are not the bottleneck for this system.

---

## AI-Augmented Development Assessment

### Code Generation Quality by Language/Framework

Ranked by first-try correctness for the specific tasks in this system (HTTP proxy, JSON transformation, data mapping):

1. **TypeScript** -- Highest AI training data volume. JSON is native. HTTP client code generation is near-perfect. Type definitions from API documentation are generated accurately. Test generation from types is reliable.

2. **C# / .NET 8 Minimal API** -- Good for straightforward HTTP handlers and Refit clients. Degrades when the code uses complex DI patterns, middleware chains, or framework-specific conventions. The simpler the .NET code, the better AI handles it.

3. **PHP / Symfony** -- Adequate for controllers and services. Struggles with Symfony-specific patterns (event subscribers, compiler passes, bundle configuration). AI-generated PHP tends to produce older-style code (pre-PHP 8.3) that works but is not idiomatic.

4. **Go** -- Good for struct definitions and HTTP handlers. Poor for dynamic JSON manipulation and complex data transformation. Error handling boilerplate is generated correctly but is verbose.

### Which Design Patterns AI Handles Best

Based on experience with Claude Code and Cursor across all four languages:

- **Request/Response type definitions**: AI excels at generating typed models from API documentation. All languages perform well here, TypeScript best.
- **HTTP client wrappers**: Simple HTTP call + deserialize patterns. AI generates these correctly in all languages. TypeScript and Go are cleanest.
- **Data transformation functions**: Pure functions that take input type and return output type. AI generates these well when the types are explicit and named (not `any` or `object`).
- **Error mapping**: Status code to error type mapping. AI generates this correctly when given a clear table of codes and behaviors.
- **Test generation**: AI generates good tests when production code uses explicit types and pure functions. Degrades when code has side effects or complex DI.

What AI handles poorly:
- **Framework wiring**: DI registration, middleware ordering, configuration binding. This is where AI-generated code most often needs manual correction.
- **Implicit conventions**: Framework-specific patterns that are not in the code but in documentation or convention. Symfony's and .NET's convention-over-configuration patterns confuse AI.
- **Dynamic JSON parsing**: The booking schema's 20+ wildcard patterns require domain knowledge that AI does not have. This will need careful human specification regardless of language.

### Recommended Codebase Structure for AI Effectiveness

These principles apply regardless of language choice:

1. **One file, one concept.** Each file should contain one type, one handler, or one transformation. AI tools work with file-level context. A 500-line file with multiple responsibilities confuses AI.

2. **Explicit types everywhere.** Named types for every request, response, and intermediate data shape. No `any`, no `dynamic`, no `Dictionary<string, object>`. AI generates correct code when it can see the input and output types.

3. **Flat project structure.** Maximum 2 levels of nesting. AI tools navigate flat structures better than deep hierarchies.

4. **Convention over cleverness.** `SearchHandler`, `SearchRequest`, `SearchResponse`, `SearchTransformer` -- not `ISearchQueryPipelineBehavior<TRequest, TResponse>`. AI generates code that follows naming conventions it has seen millions of times.

5. **Tests next to code.** `search-handler.ts` and `search-handler.test.ts` in the same directory. AI can see both files and generate tests that match the implementation, or implementation that matches the tests.

6. **Small, pure transformation functions.** The data mapping layer should be pure functions: `transformSearchResponse(twelveGoResponse: TwelveGoSearchResponse): ClientSearchResponse`. AI generates and tests these reliably.

---

## Recommendation

**PHP inside F3 (Symfony monolith) -- with strict structural discipline and AI-optimized codebase design.**

This is not the choice that maximizes developer happiness in the first two weeks. It is the choice that maximizes the probability of shipping on time, staying maintainable, and not requiring a second migration.

### Rationale grounded in team reality:

**1. Solo developer eliminates the "team language preference" argument.**
With a team of 4 .NET developers, choosing .NET would be obvious. With one developer who will also be making PHP changes to F3, the calculus changes. The question is not "which language does the team prefer?" -- it is "which approach lets one person ship?"

**2. One codebase, one deployment, one mental context.**
A .NET microservice means maintaining two codebases (.NET + F3 PHP changes), two Docker environments, two deployment pipelines, two sets of infrastructure concerns. For a solo developer, the cognitive overhead of context-switching between two systems is significant. With F3, it is one codebase, one deployment, one Docker environment (painful as it is), one set of logs to check.

**3. F3 gives you things for free.**
Authentication (API key validation via `AuthenticationListener`), Datadog tracing, API versioning (`VersionedApiBundle`), agent identity (`ApiAgent`), pricing UDFs. Building a microservice means reimplementing all of these. The Search POC proved these work -- the endpoint returned correct B2B contract responses once the environment was set up.

**4. The F3 local dev pain is a fixed cost, not a variable one.**
Whether you build inside F3 or as a microservice, you need F3 running locally for integration testing and for the parallel F3 feature work. The 16 issues from the POC are environment setup issues that are solved once. They do not recur daily. And the 12go team is actively fixing them (the `fix-import-dump` branch).

**5. AI tools can compensate for PHP unfamiliarity.**
Claude Code generates adequate Symfony controller and service code. The codebase structure recommended below is designed to maximize AI effectiveness. The types of code being written (HTTP client calls, JSON transformation, response mapping) are well within AI's capability in PHP.

**6. Organizational alignment eliminates future risk.**
The "one system" vision means a separate microservice will eventually need to be absorbed or migrated. Building inside F3 means when F3 is refactored, the B2B code moves with it. No second migration.

### What about TypeScript?

TypeScript is the technically strongest choice for this specific task and for AI-augmented development. If this were a team of 3+ developers with 6+ months of runway, I would recommend TypeScript. The reasons I do not recommend it here:

- One developer, alone, learning a new language AND its runtime (Node.js) AND its ecosystem (npm, build tools) while under Q2 deadline pressure is risky.
- A TypeScript microservice creates a third technology in the stack (PHP + .NET legacy + TypeScript). Maintainability after Soso's work is done becomes harder.
- It still requires F3 running locally for integration testing and feature work, so the "simpler local dev" argument is only partially valid.

If the deadline slipped by 4 weeks and the team expanded to 2 people, TypeScript would be my first recommendation.

---

## Codebase Design for DX

### Project Structure

All B2B code lives inside F3 but in a clearly isolated directory structure. This is critical for both human navigation and AI tool effectiveness.

```
src/
  B2B/
    Controller/
      SearchController.php
      GetItineraryController.php
      CreateBookingController.php
      ConfirmBookingController.php
      SeatLockController.php
      GetBookingDetailsController.php
      GetTicketController.php
      CancelBookingController.php
      IncompleteResultsController.php
      StationsController.php
      OperatorsController.php
      PoisController.php
      NotificationController.php
    Client/
      TwelveGoClient.php              # All 11 API calls to 12go
      TwelveGoClientInterface.php     # Interface for testing
    Request/
      SearchRequest.php
      CreateBookingRequest.php
      ConfirmBookingRequest.php
      CancelBookingRequest.php
      ReserveDataSerializer.php       # The bracket-notation serializer
    Response/
      SearchResponse.php
      ItineraryResponse.php
      BookingResponse.php
      BookingDetailsResponse.php
      TicketResponse.php
      CancelResponse.php
      NotificationResponse.php
    Transform/
      SearchTransformer.php           # 12go search -> client search
      ItineraryTransformer.php        # 12go trip details -> client itinerary
      BookingSchemaTransformer.php    # 12go checkout schema -> client schema (complex)
      BookingTransformer.php          # 12go booking -> client booking
      CancellationTransformer.php    # 12go refund options -> client cancellation
      NotificationTransformer.php    # 12go webhook -> client notification format
    Model/
      TwelveGo/                       # 12go API response models (input types)
        SearchResult.php
        Trip.php
        TravelOption.php
        BookingSchema.php
        BookingDetails.php
        RefundOption.php
        ... (one file per model)
      Client/                          # Client-facing response models (output types)
        Itinerary.php
        Segment.php
        Pricing.php
        BookingConfirmation.php
        ... (one file per model)
    Config/
      b2b_services.yaml               # DI wiring for B2B services
      b2b_routes.yaml                  # Route definitions
    Error/
      TwelveGoErrorHandler.php         # HTTP status code mapping
      B2BErrorResponse.php             # Client-facing error format
    Security/
      WebhookSignatureValidator.php    # Webhook authentication
    Tests/
      Unit/
        Transform/
          SearchTransformerTest.php
          ItineraryTransformerTest.php
          BookingSchemaTransformerTest.php
          ...
        Client/
          TwelveGoClientTest.php
      Integration/
        SearchEndpointTest.php
        BookingFlowTest.php
```

**Key design decisions:**

- **One controller per endpoint.** No god controllers. Each file is small enough for AI to hold in context.
- **Transformers are pure functions.** Input type in, output type out. No side effects. AI generates and tests these well.
- **12go models and client models are separate.** This is the anti-corruption layer. The 12go API surface can change without affecting client contracts.
- **Tests mirror the source structure.** AI can find the test for any source file by convention.
- **No abstract base classes, no generic repositories, no pipeline patterns.** The PHP code should be boring. Each controller calls the client, passes the result through a transformer, returns the response.

### Naming Conventions

- **Controllers**: `{Endpoint}Controller.php` -- `SearchController`, `CreateBookingController`
- **Transformers**: `{Domain}Transformer.php` -- `SearchTransformer`, `BookingSchemaTransformer`
- **12go models**: Named after 12go's API concepts -- `TwelveGoSearchResult`, `TwelveGoTrip`
- **Client models**: Named after client API concepts -- `Itinerary`, `Segment`, `Pricing`
- **Methods on TwelveGoClient**: Named after the API operation -- `search()`, `getTripDetails()`, `addToCart()`, `reserve()`, `confirm()`
- **Transformer methods**: `transform()` -- always a single public method per transformer
- **No abbreviations** except `B2B` and `ID`. Write `BookingDetails`, not `BkgDtls`.

### Type Usage Strategy

PHP 8.3 has strong enough typing for AI-effective code:

```php
// Every function has typed parameters and return type
public function transform(TwelveGoSearchResult $result): SearchResponse
{
    // ...
}

// All model properties are typed
class TwelveGoTrip
{
    public function __construct(
        public readonly string $id,
        public readonly string $chunkKey,
        public readonly string $routeName,
        public readonly TripParams $params,
        /** @var SegmentItem[] */
        public readonly array $segments,
        /** @var TravelOption[] */
        public readonly array $travelOptions,
    ) {}
}
```

Rules:
- Use constructor promotion for all models (readonly properties).
- Use PHP 8.1+ enums for finite sets (booking status, ticket type, confirmation type).
- Use `@var` annotations for typed arrays (PHP cannot express `array<TravelOption>` in the type system natively -- the annotation helps AI understand the type).
- No `mixed` type. No `array` without annotation. Every type must be explicit.

### Test Strategy

**Unit tests for transformers are the highest-value tests.** The transformation logic (12go response shape to client response shape) is where bugs will live. These tests are:

- Pure function tests: given this 12go response, assert this client response.
- Use real fixture data from the Search POC responses.
- AI can generate these from the type definitions and fixture data.

**Integration tests for the HTTP flow are second priority.** Test that a request to the controller returns the expected response shape. These use Symfony's WebTestCase.

**No tests for the TwelveGoClient HTTP calls.** These are thin wrappers around Symfony's HTTP client. Testing them requires mocking HTTP responses, which tests the mock, not the code. Instead, rely on the integration tests against staging.

Test execution speed target:
- Unit tests: under 5 seconds for the full suite.
- Integration tests: under 30 seconds (using Symfony test kernel, no real HTTP calls).

---

## AGENTS.md Specification for the New Service

The following document should live at `src/B2B/AGENTS.md` (or in the project root as a B2B section):

```markdown
# B2B API Layer - AI Agent Guide

## What This Is
An HTTP proxy layer inside F3 (Symfony 6.4 / PHP 8.3) that translates between
our client-facing API contract and 12go's internal API. It has 13 endpoints.

## Project Structure
All B2B code lives under `src/B2B/`. Read these files first:
1. `Client/TwelveGoClient.php` -- all 12go API calls (11 endpoints)
2. `Controller/SearchController.php` -- simplest endpoint, good reference
3. `Transform/SearchTransformer.php` -- how data mapping works
4. `Model/TwelveGo/` -- 12go API response shapes
5. `Model/Client/` -- client-facing response shapes

## How Endpoints Work
Every endpoint follows the same pattern:
1. Controller receives HTTP request
2. Controller calls TwelveGoClient method(s)
3. Controller passes result to a Transformer
4. Controller returns the transformed response

There are no pipelines, no mediators, no event handlers in the request path.

## Naming Rules
- Controllers: `{Endpoint}Controller`
- Transformers: `{Domain}Transformer` with a single `transform()` method
- 12go models: `TwelveGo{Concept}` (e.g., `TwelveGoSearchResult`)
- Client models: Just the domain name (e.g., `Itinerary`, `Segment`)

## Patterns to Follow
- Constructor promotion with readonly properties for all models
- Typed parameters and return types on every method
- One class per file
- Pure transformation functions (no side effects in Transformers)
- Explicit error mapping in TwelveGoClient (no catch-all exception handlers)

## Patterns to Avoid
- DO NOT add abstract base controllers
- DO NOT add a generic "pipeline" or "mediator" pattern
- DO NOT add a repository layer (there is no database)
- DO NOT add event dispatching in the request path
- DO NOT use `mixed` type or untyped arrays

## Running Tests
```bash
# Unit tests only (fast, <5s)
php bin/phpunit tests/B2B/Unit/

# Integration tests
php bin/phpunit tests/B2B/Integration/

# Single test file
php bin/phpunit tests/B2B/Unit/Transform/SearchTransformerTest.php
```

## Key Domain Knowledge
- Money amounts are strings in client responses ("14.60"), not floats
- Booking schema has 20+ dynamic field patterns (see BookingSchemaTransformer)
- The ReserveDataSerializer uses bracket notation for passenger data
- Client versioning is via `Travelier-Version` header (YYYY-MM-DD format)
- Webhook notifications from 12go have no authentication -- we add HMAC validation
```

---

## Development Workflow

### Local Development

The F3 Docker environment is the development environment. No separate service to run.

```bash
# Start the full 12go local environment
12go up

# Or with docker-compose directly
docker-compose up -d

# The B2B endpoints are available at:
# https://frontend3.12go.local:8443/b2b/v1/{client_id}/itineraries
```

The one-time setup pain (the 16 issues from the POC) is documented and will be scripted. After initial setup, the environment starts in under 2 minutes.

### Inner Loop

1. **Edit PHP file** in IDE (PhpStorm or VS Code with Intelephense).
2. **Save.** PHP has no compilation step. The Symfony dev server picks up changes immediately via opcache invalidation.
3. **Send HTTP request** via curl, HTTPie, or Postman. Response is immediate.
4. **Run affected test** via PHPUnit. Unit tests for a single transformer run in under 1 second.

The inner loop is: **edit -> save -> test/curl -> see result. No build step. No restart.**

This is one of PHP's genuine strengths for developer experience. There is no compilation, no hot reload daemon to break, no webpack/vite/esbuild to configure. Save the file, hit the endpoint.

### Debugging

**Xdebug** with PhpStorm:
- Configure Xdebug in the Docker container (already configured in F3's dev setup).
- PhpStorm listens for Xdebug connections.
- Set breakpoint, send HTTP request, step through code.

**Symfony Profiler** (dev environment):
- Every request in dev mode generates a profile.
- Shows request/response details, Doctrine queries, HTTP client calls, performance timing.
- Accessible at `/_profiler/` in the browser.

**Datadog traces** (staging/production):
- F3 already has Datadog APM configured.
- B2B endpoints inherit tracing automatically.
- No additional setup required.

**Log tailing**:
```bash
# Tail Symfony logs locally
docker-compose exec frontend3 tail -f var/log/dev.log

# Or in Datadog for staging/prod
# (already configured, no setup needed)
```

---

## Security

### Webhook Authentication (Key Finding #10)

**The problem**: 12go's webhook notifications have zero authentication. Anyone who discovers the webhook URL can send fake booking status change notifications to our clients.

**The DX question**: Which implementation is the developer most likely to get right on the first try?

**Recommendation: HMAC-SHA256 signature verification, implemented in PHP/Symfony.**

Why PHP is the right place for this:

1. **Symfony has built-in webhook support.** Symfony 6.3+ includes a Webhook component with signature verification. The pattern is well-documented and AI generates it correctly.

2. **It lives with the notification handler.** The webhook receiver and the signature validator are in the same codebase, same deployment, same test suite. No cross-service coordination needed.

3. **Single point of configuration.** The shared secret is in F3's `.env` file, loaded via Symfony's configuration system. No secret synchronization between services.

**Implementation approach:**

```php
// Security/WebhookSignatureValidator.php
class WebhookSignatureValidator
{
    public function __construct(
        private readonly string $webhookSecret,
    ) {}

    public function validate(Request $request): bool
    {
        $signature = $request->headers->get('X-Webhook-Signature');
        if ($signature === null) {
            return false;
        }

        $payload = $request->getContent();
        $expected = hash_hmac('sha256', $payload, $this->webhookSecret);

        return hash_equals($expected, $signature);
    }
}
```

**Coordination with 12go**: The 12go side needs to send the HMAC signature. Since this is within the same organization and the same monolith deployment pipeline, coordinating this is straightforward. If 12go cannot add HMAC signing immediately, an interim measure is IP allowlisting at the infrastructure level (DevOps-managed).

**AI code generation quality for webhook security by language:**

- **PHP/Symfony**: Excellent. `hash_hmac()` is a built-in function. Symfony's webhook component provides the pattern. Claude generates correct implementations.
- **TypeScript/Node.js**: Excellent. `crypto.createHmac()` is built-in. Express middleware pattern is well-known. AI generates this correctly.
- **.NET**: Good. `HMACSHA256` class exists but requires more boilerplate (byte array handling, encoding). AI sometimes gets the encoding wrong (UTF-8 vs ASCII).
- **Go**: Good. `crypto/hmac` package is clean. AI generates correct Go HMAC code.

All languages handle this well. The advantage of PHP is co-location with the webhook handler and zero deployment coordination.

---

## Retention and Morale Assessment

This section requires honesty about an uncomfortable situation.

**The context**: One developer, assigned to a project originally scoped for four people, asked to learn a new language (PHP), under a quarterly deadline, while also maintaining the system he is building. Team Lead is open to adding resources but leaning toward solo.

### PHP/Monolith impact on morale:

**Negative factors:**
- Learning PHP when you have 12 years of .NET experience feels like a step backward. PHP carries stigma in the .NET community, even though modern PHP 8.3 is a capable language.
- The F3 local development experience is genuinely painful. The 16-issue POC setup is demoralizing, especially alone.
- Writing code inside someone else's monolith means conforming to their conventions, their code review standards, their deployment process. Loss of autonomy.
- If F3 is refactored later, the PHP code may need to be rewritten -- which means the developer's work feels disposable.

**Positive factors:**
- No second codebase to maintain. One context to hold in your head.
- F3's existing infrastructure (auth, tracing, versioning) means less boilerplate to write.
- Shipping faster. The Q2 deadline is more achievable with one codebase.
- 12go veterans are available for PHP questions. There is a support network for the unfamiliar language.

### .NET microservice impact on morale:

**Positive factors:**
- Working in the language you know and love. This should not be underestimated.
- Full autonomy over the codebase. Your conventions, your architecture, your deployment.
- Faster initial velocity (no PHP learning curve).

**Negative factors:**
- Two codebases to maintain alone is exhausting. Context-switching between .NET and PHP (for F3 changes) multiplies cognitive load.
- The "one system" organizational direction means this microservice is working against the current. The developer may feel they are building something that will be dismantled.
- Deployment and infrastructure setup for a new service is work that does not ship endpoints.

### TypeScript microservice impact on morale:

Similar to .NET microservice, with the added uncertainty of a new language. Could be energizing (learning something new and modern) or demoralizing (another thing to learn under pressure), depending on the developer's disposition.

### The honest assessment:

No technology choice makes this situation great. The fundamental problem is resourcing, not technology. One developer doing a four-person job will feel the pressure regardless of the language. The best the technology choice can do is minimize the number of things that can go wrong.

PHP/monolith minimizes surface area: one codebase, one deployment, one environment. It trades short-term language discomfort for reduced operational complexity. For a solo developer under deadline, reducing operational complexity is the higher priority.

---

## Unconventional Idea

**Considered: "TypeScript sidecar" -- write transformers in TypeScript, call them from PHP.**

The idea: The most complex and testable part of this system is the data transformation layer (12go responses to client responses). TypeScript is the best language for AI-generated data transformation code. What if the transformers were written in TypeScript as a separate package, compiled to a format PHP can call?

Options explored:
- **PHP-FFI to a compiled TypeScript (via Bun compile)**: Too fragile. FFI in PHP is not production-ready for this use case.
- **HTTP sidecar**: A tiny TypeScript service that only does transformations. PHP controllers call it. This adds network latency and another service to deploy.
- **Shared JSON schemas**: Define the transformation contract as JSON Schema, generate types in both PHP and TypeScript, test transformers in TypeScript but implement in PHP. This is the most practical variant.

**Rejected.** The added complexity is not worth it for 13 endpoints. The transformers are complex but finite. Once written and tested, they rarely change. The effort to set up a cross-language pipeline exceeds the effort to just write the PHP transformers with AI assistance and good test coverage.

**But the insight is worth preserving**: If the system grows beyond 20+ endpoints or if the 12go API surface becomes unstable and transformers change frequently, a TypeScript transformation layer becomes more attractive. Keep the transformer interfaces clean enough that they could be extracted later.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for:

- **Shipping speed for a solo developer.** One codebase, one deployment, zero infrastructure setup for a new service. The fastest path to "new clients can onboard in Q2."
- **Organizational alignment.** The "one system" vision is satisfied. No second migration when F3 is refactored.
- **AI effectiveness.** The codebase structure (flat, explicit types, pure transformers, clear naming) is designed for Cursor/Claude to navigate and generate code reliably.
- **Maintainability after the builder leaves.** PHP code inside F3 can be maintained by the 12go team. A .NET microservice owned by no one is an orphan.
- **Reduced operational surface area.** One deployment pipeline, one monitoring system, one set of logs. For a solo developer, every eliminated operational concern is time saved.

### Sacrifices:

- **Short-term developer happiness.** Learning PHP under deadline pressure is not fun. The F3 local development experience is painful. There will be frustrating days.
- **Initial velocity.** The first 2 weeks will be slower than a .NET microservice. PHP syntax friction, Symfony conventions, F3 environment issues -- all real costs.
- **Architectural purity.** B2B code inside a large monolith is not as clean as a dedicated microservice. The boundaries are conventions and directory structure, not network boundaries.
- **Language preference.** A senior .NET developer is being asked to write PHP. This is a real sacrifice of personal preference and professional identity.
- **The possibility that .NET would have been faster.** If the deadline were met easily with either approach, choosing PHP over .NET would have been an unnecessary imposition. The risk is asymmetric: if PHP slows things down more than expected, the deadline is missed. If .NET would have been fast enough, the PHP pain was pointless.

The bet this design makes: the operational simplicity of one codebase, combined with organizational alignment and AI-assisted development, outweighs the short-term productivity hit of learning PHP. For a solo developer under deadline pressure, reducing the number of things that can go wrong is more valuable than maximizing typing speed in a familiar language.
