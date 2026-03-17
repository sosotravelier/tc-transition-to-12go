# Team-First Developer Design

## The Human Constraint

This section must be read before anything else in this document, because every subsequent recommendation flows from it.

**The "team" is one person.** Soso is the sole developer allocated to the B2B transition. The original expectation was 4 .NET developers. The reality, confirmed in the March 17 meeting with Team Lead, is one senior .NET developer with 12 years of experience, working under a Q2 2026 deadline, using AI-assisted development (Claude Code, multi-agent workflows) to compensate for the missing headcount.

What we know about this developer that shapes the decision:

1. **12 years of .NET experience.** This is not a generalist -- this is someone whose entire mental model of software construction is built on C#, .NET conventions, NuGet ecosystems, and Visual Studio/Rider tooling.
2. **Heavy AI tool user.** Soso uses Claude Code with multi-agent workflows daily. This is not aspirational -- it is current practice.
3. **High stress, low morale.** Being told you are the sole developer on a transition originally scoped for four people, with a Q2 deadline, is demoralizing. Every technology decision either compounds or alleviates this stress.
4. **F3 local development is already painful.** The Search POC revealed friction with the PHP/Symfony local environment. This is not a theoretical concern -- it is a documented experience.
5. **The developer will also need to make changes to F3 in parallel.** Cancellation policies and similar capabilities must be exposed through F3 during the transition. This means F3 PHP work happens regardless of architecture choice.
6. **Plans to resign after completion.** This is a fact that the design must account for from a maintainability perspective. Whoever inherits this system will not have the builder available.

The question is not "what is the best technology?" The question is: **what technology choice gives one stressed developer the highest probability of shipping a working system by Q2 2026 while maintaining their sanity?**

---

## Language Assessment (DX Lens)

### .NET: Team Experience

**Zero-to-productive time:** Immediate. Soso writes .NET in his sleep. A .NET 8 Minimal API project with Refit for 12go HTTP client takes less than a day to scaffold.

**AI code generation quality:** Claude and Cursor generate excellent .NET 8 code for HTTP proxy patterns. Minimal API is well-represented in training data. Refit typed HTTP clients are a common AI generation target. The risk is not bad AI output -- it is that experienced .NET developers instinctively add abstractions. Soso knows MediatR, DI pipeline behaviors, Autofac scoping, and OpenAPI code generation intimately. The current system has 342 projects precisely because experienced .NET developers followed their instincts. The old codebase proves the failure mode.

**Inner loop speed:** Excellent. `dotnet watch run` gives sub-second hot reload. Unit tests run in milliseconds. Integration tests with `WebApplicationFactory` start in 1-2 seconds. This is the fastest inner loop of any option.

**Debugging experience:** Outstanding. Rider/VS debugger, step-through with async support, exception break, trace viewer. Soso has 12 years of muscle memory here.

**Risk: "Rebuilding complexity."** This is the serious risk. A .NET microservice built by an experienced .NET developer will gravitationally attract the patterns from the old system: pipeline behaviors, layered abstractions, service/repository/facade patterns. The 342-project codebase was not built by bad developers -- it was built by good developers following .NET conventions. The discipline required to keep a .NET project simple when you know how to make it complex is harder than it sounds.

**Risk: "Two codebases, one developer."** If the B2B layer is a .NET microservice and F3 feature work is in PHP, Soso maintains two codebases in two languages with two local dev environments simultaneously. For a solo developer, this is a significant cognitive load multiplier.

**Risk: Organizational friction.** Management stated the long-term goal is "one system." A .NET microservice works against this direction. Even if the technical argument is sound, organizational pressure will generate friction that consumes developer energy.

**Verdict:** The safest choice from a pure DX perspective, but carries organizational risk and the two-codebase burden.

### TypeScript: Transition Path

**Zero-to-productive time:** 1-2 weeks to write confident TypeScript for a developer with deep C# experience. The type system maps almost 1:1: generics, interfaces, async/await, union types (TypeScript is actually better here). NestJS mirrors .NET's DI/decorator/controller patterns closely enough that the mental model transfers.

**AI code generation quality:** Highest of any language. TypeScript has the largest representation in AI training data. For HTTP proxy patterns, data transformation, and API client code, Claude and Cursor generate correct TypeScript on the first attempt more often than any other language. This is not opinion -- it is consistent with published evaluations and direct experience across thousands of AI-generated code completions.

**Inner loop speed:** Excellent. `tsx watch` or `nodemon` gives sub-second reload. Jest tests run fast. The TypeScript compiler catches type errors instantly.

**Debugging experience:** Good but not great. VS Code debugger is solid. Source maps work. But the Node.js async debugging experience is less mature than .NET's -- stack traces can be confusing with promise chains.

**Learning curve reality for .NET developers:** The syntax is unfamiliar for the first 3-5 days. After that, the concepts click fast because C# and TypeScript share so much DNA (both have Anders Hejlsberg's fingerprints). The real friction points:
- `null` vs `undefined` (C# has only `null`)
- No method overloading (must use union types or optional params)
- Package management (npm) feels chaotic compared to NuGet
- Runtime type erasure means types do not protect you at the API boundary the way C# does

**Risk: Runtime surprises.** TypeScript's type safety is compile-time only. A malformed 12go API response that would throw a deserialization exception in C# will silently produce `undefined` values in TypeScript unless you add runtime validation (Zod, io-ts, or similar). For a proxy service where the upstream API shape matters enormously, this is a real risk.

**Risk: Organizational misalignment.** Neither the .NET team nor the PHP/12go team uses TypeScript. After Soso leaves, who maintains it? The same organizational friction as .NET, but with no in-house expertise at all.

**Verdict:** The best DX for AI-augmented development, but creates a maintainability orphan after the developer departs.

### PHP: Learning Curve Analysis

**Zero-to-productive time:** 2-4 weeks for a .NET developer to write production-quality Symfony code. PHP's syntax is different enough from C# that every line requires conscious thought for the first week. Symfony's DI container, routing, and service conventions are conceptually similar to .NET's but syntactically different in ways that create friction.

**AI code generation quality:** Good, not great. Claude generates correct Symfony code for standard patterns. For HTTP client work (Symfony HttpClient or Guzzle), AI output is reliable. For data transformation, PHP's type system is weaker than C#'s, and AI-generated code sometimes produces loosely typed arrays where typed DTOs are needed. PHP 8.3 has improved significantly with enums, readonly properties, and typed properties, but AI training data still reflects older PHP patterns.

**Inner loop speed:** Adequate. Symfony's development server with file watching provides near-instant reload. PHPUnit tests run fast. But the local dev environment for F3 specifically has documented friction -- migration issues, setup problems.

**Debugging experience:** Xdebug is functional but slower than .NET's debugger. Step-through debugging works. The bigger issue is that PHP errors are less informative than C# exceptions -- stack traces are shorter, type errors can be cryptic, and null reference behavior differs.

**Learning curve reality:** The hardest parts for a .NET developer:
- `$this->` everywhere (feels verbose coming from C#)
- Array-based configuration patterns vs. fluent builder patterns
- Composer vs. NuGet (different ecosystem conventions)
- No equivalent of LINQ -- must use `array_map`, `array_filter` with callbacks
- Doctrine ORM patterns differ from EF Core (but not needed here -- no persistence)
- PHP's `mixed` type and array shapes feel untyped compared to C# generics

**The monolith advantage:** If the code lives inside F3, there is no second codebase. One local environment, one deployment pipeline, one set of infrastructure. For a solo developer, this eliminates the cognitive overhead of maintaining two systems. Cancellation policy work and B2B endpoint work happen in the same codebase. When F3 is eventually refactored, B2B code moves with it.

**The monolith risk:** F3 is a large Symfony monolith. Understanding its conventions, its service layer, its configuration patterns takes time. The Search POC revealed setup friction. Code inside F3 is subject to F3's deployment cadence, testing requirements, and code review process. Soso does not control the deployment pipeline.

**Organizational alignment:** This is the only option where the long-term maintainers (12go's PHP developers) can actually read and modify the code. When Soso departs, the 12go team inherits code in their own language and framework.

**Verdict:** Highest organizational alignment, steepest short-term learning curve, best long-term maintainability story given team reality.

### Go: Mental Model Shifts

**Zero-to-productive time:** 2-3 weeks. Go's simplicity means there is less to learn, but the patterns are fundamentally different from C#:
- Explicit error handling (`if err != nil`) replaces exceptions entirely
- No generics until recently, and Go's generics are limited compared to C#'s
- No inheritance -- composition via embedding
- Goroutines and channels are unfamiliar concurrency primitives
- No DI framework by convention -- manual wiring

**AI code generation quality:** Good for HTTP handlers and data transformation. Go's simplicity means AI-generated code is more likely to be correct because there are fewer ways to write things. But Go's error handling verbosity means AI generates a lot of `if err != nil { return nil, err }` boilerplate that a developer must still read and verify.

**Inner loop speed:** Excellent. `go run` compiles in seconds. `go test` is fast. Air or similar tools provide hot reload.

**Debugging experience:** Delve is functional but less mature than .NET's debugger. The debugging story is adequate, not excellent.

**Organizational alignment:** 12go is considering Go for future development, but nothing is decided. Choosing Go now would be a bet on an undecided future. The current 12go team does not write Go. The .NET team does not write Go.

**Verdict:** The best language for a simple proxy service from a pure engineering perspective, but no one currently on any team writes it. An orphan in both directions.

---

## AI-Augmented Development Assessment

### Code Generation Quality by Language/Framework

For the specific task at hand -- HTTP proxy with data transformation between two API contracts -- the ranking of AI code generation reliability is:

1. **TypeScript** -- highest training data volume, strongest first-attempt accuracy for HTTP client code, data mapping, and API route handlers
2. **Go** -- limited patterns mean less room for error; AI generates correct HTTP handlers reliably
3. **.NET 8 Minimal API** -- good generation quality, but AI sometimes defaults to older MVC patterns or adds unnecessary abstractions
4. **PHP/Symfony** -- adequate but occasionally generates pre-PHP 8 patterns; Symfony-specific conventions (service tags, YAML config) are less reliably generated

For the booking schema parser (the hardest piece of code in this system -- ~1,180 lines of dynamic field pattern matching), AI generation quality matters most. This is a data transformation problem with 20+ wildcard patterns, bracket-notation serialization, and stateful field mapping. AI tools handle this kind of work well in TypeScript (strong type inference helps) and .NET (pattern matching is well-supported). In PHP, the same logic is more verbose and AI sometimes produces arrays where typed objects are needed.

### Which Design Patterns AI Handles Best

AI coding tools generate the most reliable, correct code when:

1. **Each file has a single responsibility.** A file named `SearchEndpoint.ts` that handles one route is perfectly scoped for AI understanding. A file named `SiFacade.cs` that handles 15 operations across 1,100 lines defeats AI context windows.

2. **Types are named and explicit.** `TwelveGoSearchResponse` is a better type name than `SearchResult` because it tells AI exactly which API this came from. `ClientSearchResponse` is better than `ApiResponse<T>` because it names the domain concept.

3. **Dependencies are injected, not resolved.** AI understands constructor injection. AI does not understand service locator patterns, keyed DI resolution, or Autofac scoping -- which is exactly what the old system uses.

4. **Error handling is explicit.** `Result<T, ApiError>` is better for AI than exception hierarchies, because the error path is visible in the type signature.

5. **Tests mirror the production code structure.** A test file named `SearchEndpoint.test.ts` next to `SearchEndpoint.ts` is trivially navigable. A test in `BookingService.Tests/UnitTests/IntegrationTests/Stubs/` is not.

### Recommended Codebase Structure for AI Effectiveness

Regardless of language choice, the codebase should follow this structure to maximize AI tool effectiveness:

```
src/
  endpoints/           # One file per client-facing endpoint
    search.{ext}
    get-itinerary.{ext}
    create-booking.{ext}
    confirm-booking.{ext}
    seat-lock.{ext}
    get-booking-details.{ext}
    get-ticket.{ext}
    cancel-booking.{ext}
    incomplete-results.{ext}
    stations.{ext}
    operators.{ext}
    pois.{ext}
    webhook-receiver.{ext}
  twelve-go/           # 12go API client -- typed HTTP calls
    client.{ext}       # All 11 endpoint methods
    types.{ext}        # Request/response models for 12go API
    errors.{ext}       # Error response parsing
  mappers/             # TC format <-> 12go format transformations
    search-mapper.{ext}
    booking-schema-mapper.{ext}
    reserve-request-builder.{ext}
    booking-details-mapper.{ext}
    notification-mapper.{ext}
  auth/                # Authentication bridge
    client-key-resolver.{ext}  # clientId + apiKey -> 12go apiKey
  config/              # Configuration and environment
    client-config.{ext}
  middleware/           # Cross-cutting (logging, correlation, versioning)
    correlation.{ext}
    versioning.{ext}
tests/
  endpoints/           # Mirror production structure
  twelve-go/
  mappers/
```

Key principles:
- **Maximum 200-300 lines per file.** Larger files degrade AI effectiveness.
- **No shared base classes.** AI tools struggle with inheritance hierarchies. Use composition.
- **Explicit imports.** Every dependency visible at the top of the file.
- **No "utils" or "helpers" folders.** Name files for what they do, not how they are used.

---

## Recommendation

**PHP/Symfony inside F3 (monolith path).**

This is not the recommendation that optimizes for developer happiness in the first two weeks. It is the recommendation that optimizes for shipping a working system by Q2 2026 with one developer, and for that system being maintainable after the developer departs.

The rationale, grounded in team reality:

1. **One codebase, one developer.** A microservice in any language means Soso maintains two codebases (B2B service + F3 for feature work) with two local dev environments. For a solo developer under deadline pressure, this is the most dangerous overhead. The monolith eliminates it.

2. **Organizational alignment.** Management stated "one system." Team Lead explicitly favors monolith. The 12go team writes PHP. When Soso leaves, 12go's developers inherit code in their own language. A .NET or TypeScript service becomes an orphan.

3. **AI compensates for PHP unfamiliarity.** PHP/Symfony is the weakest language choice from a pure DX lens. But AI tools compensate significantly. Soso will write prompts describing the transformation logic in terms he understands (C# patterns), and AI will generate the PHP equivalent. For HTTP proxy code and data transformation, this works well. The booking schema parser (~1,180 lines in C#) is the hardest piece -- but it is well-documented in the migration issues files, has clear test fixtures, and is a pure data transformation problem that AI handles competently in any language.

4. **F3 capabilities included.** Cancellation policies, new API features, and other F3 changes happen in the same codebase. No coordination overhead.

5. **No second migration.** When F3 is eventually refactored (Q2+ planning), B2B code moves with it. A separate .NET microservice would require a separate migration.

6. **12go veterans available.** PHP experts are available for advice and code review. This support does not exist for .NET or TypeScript.

**What this recommendation sacrifices:**
- The first 2-4 weeks will be slow and uncomfortable as Soso learns PHP/Symfony conventions
- The inner loop is slower than .NET during that ramp-up period
- Debugging PHP is less pleasant than debugging C#
- AI code generation is less reliable for PHP than for TypeScript or .NET

**What makes this survivable:**
- The Search POC already exists -- Soso has already written PHP code inside F3
- F3 has built-in versioning (`VersionedApiBundle`), API agent identity (`ApiAgent`), and Datadog tracing
- The total code to write is small (~2,500-3,500 lines for all 13 endpoints plus mappers)
- AI tools generate working PHP for HTTP proxy patterns
- 12go veterans provide a safety net

---

## Codebase Design for DX

### Project Structure

Within F3's Symfony monolith, the B2B module should be isolated:

```
frontend3/src/
  B2bApi/
    Controller/
      SearchController.php
      BookingController.php        # GetItinerary, CreateBooking, ConfirmBooking, SeatLock
      PostBookingController.php    # GetBookingDetails, GetTicket, CancelBooking
      MasterDataController.php     # Stations, Operators, POIs
      WebhookController.php        # Booking notifications receiver
    Service/
      TwelveGoClient.php           # Typed HTTP client for 12go internal API
      SearchMapper.php             # 12go search response -> TC search response
      BookingSchemaMapper.php      # Checkout schema parsing (the complex one)
      ReserveRequestBuilder.php    # TC booking request -> 12go reserve request
      BookingDetailsMapper.php     # 12go booking -> TC booking details
      NotificationMapper.php       # 12go webhook -> TC notification format
      ClientKeyResolver.php        # clientId -> 12go apiKey resolution
    DTO/
      Request/                     # TC-format inbound request objects
        SearchRequest.php
        CreateBookingRequest.php
        ConfirmBookingRequest.php
        LockSeatsRequest.php
        CancelBookingRequest.php
      Response/                    # TC-format outbound response objects
        SearchResponse.php
        ItineraryResponse.php
        BookingResponse.php
        BookingDetailsResponse.php
        TicketResponse.php
        CancellationResponse.php
      TwelveGo/                    # 12go API response types
        TwelveGoSearchResponse.php
        TwelveGoBookingSchemaResponse.php
        TwelveGoBookingDetailsResponse.php
        TwelveGoRefundOptionsResponse.php
    Config/
      ClientConfig.php             # Per-client configuration (API keys, feature flags)
    Security/
      WebhookAuthenticator.php     # HMAC verification for inbound webhooks
    EventSubscriber/
      B2bRequestSubscriber.php     # Correlation ID, versioning, client context
```

### Naming Conventions

- **Controllers:** Named by domain, not by HTTP verb. `BookingController` handles the booking funnel.
- **Services:** Named by what they do. `SearchMapper` maps search responses. `TwelveGoClient` calls 12go.
- **DTOs:** Namespace separates TC-format (`Request/`, `Response/`) from 12go-format (`TwelveGo/`). Names include the direction: `SearchRequest` is what TC clients send, `TwelveGoSearchResponse` is what 12go returns.
- **No abbreviations.** `BookingDetailsMapper` not `BkgDtlsMapper`. AI tools work better with full words.
- **No generic names.** `ClientKeyResolver` not `AuthService`. `ReserveRequestBuilder` not `RequestFactory`.

### Type Usage Strategy

PHP 8.3 with strict types enabled (`declare(strict_types=1)` in every file):

- **DTOs use readonly classes with typed properties.** This is the closest PHP gets to C# records.
- **Constructor promotion** for all DTOs: `public function __construct(public readonly string $tripId, ...)`
- **Enums** for fixed sets: `BookingStatus`, `TicketType`, `ConfirmationType`
- **No untyped arrays.** Use `@param array<string, TwelveGoStation>` PHPDoc annotations for array shapes. This helps AI tools understand the expected structure.
- **Return types on all methods.** No implicit returns.
- **Nullable types explicit.** `?string` not `string|null`. Consistent.

### Test Strategy

```
frontend3/tests/
  B2bApi/
    Controller/
      SearchControllerTest.php     # HTTP-level tests with Symfony test client
      BookingControllerTest.php
      PostBookingControllerTest.php
      WebhookControllerTest.php
    Service/
      SearchMapperTest.php         # Unit tests with real fixture data
      BookingSchemaMapperTest.php  # The most critical test file -- covers all 20+ patterns
      ReserveRequestBuilderTest.php
      NotificationMapperTest.php
    Fixtures/
      twelve-go-search-response.json
      twelve-go-checkout-response.json     # Copy from existing test fixtures
      twelve-go-booking-details-response.json
      twelve-go-refund-options-response.json
      tc-search-response.json              # Expected TC-format output
      tc-booking-response.json
```

Test principles:
- **Fixture-driven.** Real 12go API responses (already available in the existing test fixtures) are the test input. Expected TC-format output is the assertion.
- **Mappers are the critical test target.** Every mapper must have tests with real fixtures. These are pure functions that take 12go format in and produce TC format out.
- **Controller tests are integration tests.** They test the full HTTP contract: correct status codes, correct headers, correct response shape.
- **AI can generate mapper tests from fixtures.** Given a real 12go response JSON and the expected TC response JSON, AI can generate a comprehensive test. This is one area where AI test generation genuinely works well.

---

## AGENTS.md Specification for the New Service

The B2B module within F3 should include an `AGENTS.md` (or equivalent context file) at `frontend3/src/B2bApi/AGENTS.md`:

```markdown
# B2B API Module — AI Agent Context

## What This Module Does
Translates between the TC B2B API contract and 12go's internal API.
Clients call TC-format endpoints; this module proxies to 12go and transforms responses.

## Project Structure
- `Controller/` — HTTP endpoints (13 total). One controller per domain area.
- `Service/` — Business logic. Mappers and the 12go HTTP client.
- `DTO/Request/` — Inbound TC-format request objects.
- `DTO/Response/` — Outbound TC-format response objects.
- `DTO/TwelveGo/` — 12go API response types.
- `Config/` — Per-client configuration.
- `Security/` — Webhook authentication.

## Key Files to Read First
1. `Service/TwelveGoClient.php` — All 12go API calls
2. `DTO/TwelveGo/` — 12go response shapes
3. `Service/SearchMapper.php` — Simplest mapper, good starting point
4. `Service/BookingSchemaMapper.php` — Most complex mapper (dynamic field patterns)

## Patterns to Follow
- Strict types in every file: `declare(strict_types=1);`
- Readonly DTO classes with constructor promotion
- One public method per service class when possible
- Explicit error handling — catch 12go HTTP errors and map to TC error responses
- Return typed responses, never raw arrays from public methods

## Patterns to Avoid
- Do NOT add abstraction layers (no "provider" pattern, no "facade" pattern)
- Do NOT use Doctrine ORM — this module has no persistence
- Do NOT use Symfony Messenger for synchronous flows — direct HTTP calls only
- Do NOT add caching unless explicitly required — 12go handles caching
- Do NOT create base controller classes — each controller is self-contained

## 12go API Authentication
All 12go calls use `?k=<apiKey>` query parameter. The key is resolved from
ClientConfig based on the client_id from the URL path.

## How to Run Tests
```bash
# From frontend3 root
./vendor/bin/phpunit tests/B2bApi/

# Single test file
./vendor/bin/phpunit tests/B2bApi/Service/SearchMapperTest.php

# With coverage
./vendor/bin/phpunit tests/B2bApi/ --coverage-html coverage/
```

## Naming Conventions
- Controllers: `{Domain}Controller.php`
- Services: `{WhatItDoes}.php` (e.g., SearchMapper, TwelveGoClient)
- DTOs: `{Domain}{Direction}.php` (e.g., SearchRequest, SearchResponse)
- Tests: `{ClassName}Test.php` mirroring the source structure

## TC API Contract Conventions (Must Preserve)
- Versioning: `Travelier-Version` header (YYYY-MM-DD)
- Correlation: `x-correlation-id` header propagation
- Money: amounts as strings ("14.60")
- 206 Partial Content: when recheck URLs are present
- Confirmation types: Instant vs Pending
```

---

## Development Workflow

### Local Development

F3 already has a Docker-based local development environment. The B2B module runs within it:

```bash
# From frontend3 docker-local-env
docker-compose up -d

# F3 is accessible at localhost:8080 (or configured port)
# B2B endpoints at: http://localhost:8080/b2b/v1/{clientId}/itineraries
```

No additional containers needed for the B2B module itself. The module uses F3's existing Symfony HTTP client to call 12go's own search/booking services internally (within the same application or via HTTP to the same instance).

For external 12go API calls that go through the HTTP layer:
- **Local:** F3 calls itself (internal service calls within the monolith)
- **Staging/Prod:** Same internal calls, no external HTTP round-trip for most operations

### Inner Loop

1. **Edit PHP file** in IDE (PhpStorm or VS Code with Intelephense)
2. **Refresh browser/Postman** -- Symfony dev server picks up changes immediately (no compile step)
3. **Run targeted test** -- `./vendor/bin/phpunit tests/B2bApi/Service/SearchMapperTest.php` runs in < 1 second
4. **Full test suite** -- `./vendor/bin/phpunit tests/B2bApi/` runs in < 5 seconds (pure unit tests, no database)

Hot reload is effectively instant in PHP -- there is no compilation step. This partially compensates for the debugging friction compared to .NET.

### Debugging

- **Xdebug** with PhpStorm: step-through debugging, breakpoints, variable inspection. Configure in `docker-compose.override.yml` with `XDEBUG_MODE=debug`.
- **Symfony Profiler**: Available at `/_profiler` in dev mode. Shows request details, database queries, service call timings.
- **Datadog APM**: Already configured in F3. Traces for B2B endpoints appear automatically.
- **Monolog**: Structured logging to GELF. Add B2B-specific log context (client_id, booking_id) via the `B2bRequestSubscriber`.
- **`dump()` and `dd()`**: Symfony's dump functions for quick inspection during development. (Do not ship to production.)

---

## Migration Strategy

### Client Transition Approach

**Transparent switch via API Gateway routing.** Clients do not change their URLs or API keys initially. The API Gateway routes traffic to the new B2B endpoints inside F3. The TC-format API contract is preserved exactly.

From the developer's perspective, this is the simplest approach: implement the 13 endpoints, make them pass the same contract tests as the current endpoints, and switch the gateway routing. No client coordination required for the initial switchover.

### Authentication Bridge

**Config table inside F3's database.** A simple MySQL/MariaDB table maps `(client_id, tc_api_key_hash)` to `12go_api_key`. The `ClientKeyResolver` service loads this at startup (or caches it). When a request arrives with `client_id` in the URL and `x-api-key` in the header:

1. Gateway validates `x-api-key` (as it does today)
2. F3's `B2bRequestSubscriber` extracts `client_id`
3. `ClientKeyResolver` looks up the 12go API key for this client
4. All subsequent 12go internal calls use the resolved key

This is the approach with the lowest cognitive overhead. One table, one lookup, one cache. AI tools generate this pattern trivially. The mapping table is populated once during the migration setup phase.

Post-migration (Approach B from Shauly): clients switch to 12go API keys directly, and the mapping table is retired. But this is a client-facing change that can happen after the system is running.

### Per-Client Rollout Mechanism

**Feature flag in F3's configuration.** F3 already has per-client configuration via the `ApiAgent` system. A flag per client controls whether their requests go through the new B2B controllers or are proxied to the legacy .NET stack.

For the developer, this means:
- Start with one test client (internal or cooperative)
- Verify all 13 endpoints work correctly
- Enable client by client
- Roll back by flipping the flag

This is more debuggable than a Lambda authorizer (which adds infrastructure complexity) and less risky than all-at-once.

### In-Flight Booking Safety

Active booking funnels during cutover are handled by the booking ID mapping table:

1. **New bookings after cutover:** Use 12go `bid` directly (or a thin encoding). New clients get 12go IDs.
2. **Existing bookings before cutover:** The static mapping table (old TC booking ID -> 12go bid) is loaded from a one-time export of Denali's PostgreSQL `BookingEntities` table. For KLV-format IDs, the 12go bid can be extracted by decoding the KLV structure. For short IDs, the database export is the only source.
3. **Post-booking operations on old bookings:** The `BookingDetailsMapper` checks the booking ID format. If it matches a legacy format, it looks up the 12go bid from the mapping table. If it is a new format, it uses the bid directly.

The mapping table is small (number of active bookings with post-booking operations remaining) and static (populated once, read-only forever).

### Webhook/Notification Transition

**URL-based routing in 12go's webhook table.** 12go already knows which booking belongs to which client. The webhook URL is updated per client to point to the new B2B `WebhookController`:

```
https://api.travelier.com/b2b/v1/notifications/booking?client_id={clientId}
```

The `WebhookController`:
1. Receives the 12go-format webhook (`{ bid: int, type: string, ... }`)
2. Authenticates (see Security section)
3. Looks up the TC booking ID if needed (for old bookings, from the mapping table)
4. Transforms to TC notification format
5. Forwards to the client's webhook URL

During the transition period, both old and new webhook receivers run. The URL in 12go's table is updated per client as they migrate.

### Validation Plan

**Endpoint-by-endpoint comparison testing:**

1. **Search:** Shadow traffic. Send the same search request to both old and new endpoints. Compare response shapes (not exact values, since availability changes). Automated diff script. DX: one curl command per comparison.

2. **Booking funnel:** Contract tests with real 12go staging environment. Create a booking through the new system, verify each step matches the expected TC contract shape. DX: a PHPUnit test that exercises the full funnel.

3. **Post-booking:** Test with known booking IDs from the mapping table. Verify GetBookingDetails, GetTicket, Cancel return correct shapes.

4. **Canary rollout:** Enable one internal client first, monitor for 24-48 hours, then enable cooperative external clients one by one.

The "conveyor belt" approach Soso proposed (new endpoint every ~2 days) works well here. Each endpoint is independently testable. The test fixtures from the existing C# test suites can be reused as expected-output references.

---

## Security (required)

### Webhook Authentication: The Zero-Auth Vulnerability

Key Finding #10 is unambiguous: 12go webhooks arrive with zero authentication. The `NotificationAuthenticator` for OneTwoGo is `ValueTask.CompletedTask` -- it does nothing. Anyone who can reach the webhook endpoint can trigger a booking status refresh for any `bid`.

**Recommended approach: HMAC-SHA256 signature verification.**

From a DX perspective, HMAC verification is the approach most likely to be implemented correctly on the first try because:

1. **It is stateless.** No token refresh, no certificate management, no OAuth flows. One shared secret, one hash computation, one comparison.
2. **AI generates it correctly.** HMAC signature verification is one of the most common AI-generated security patterns. Claude generates correct implementations in all four languages.
3. **It is testable.** A unit test computes the expected HMAC for a known payload and verifies the middleware accepts it.

**PHP/Symfony implementation (recommended):**

```php
// Security/WebhookAuthenticator.php
class WebhookAuthenticator
{
    public function __construct(
        private readonly string $webhookSecret,
    ) {}

    public function verify(Request $request): bool
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

This is 15 lines. AI generates it correctly. A developer reviews it in 30 seconds. The `hash_equals` function is PHP's timing-safe comparison (prevents timing attacks). The secret is stored in environment configuration (`.env` or database).

**Coordination required with 12go:** 12go must be configured to include the `X-Webhook-Signature` header on outbound webhook POST requests. This is a configuration change on 12go's side -- the signing mechanism needs to be implemented or enabled in their webhook dispatcher. This should be raised as a requirement early.

**Language comparison for webhook security DX:**

| Language | HMAC Library | Timing-Safe Compare | AI Generation Quality |
|----------|-------------|--------------------|-----------------------|
| PHP | `hash_hmac()` (built-in) | `hash_equals()` (built-in) | Excellent |
| .NET | `HMACSHA256` class | `CryptographicOperations.FixedTimeEquals()` | Excellent |
| TypeScript | `crypto.createHmac()` (Node built-in) | `crypto.timingSafeEqual()` | Excellent |
| Go | `crypto/hmac` package | `hmac.Equal()` | Excellent |

All four languages have built-in HMAC support and timing-safe comparison. There is no meaningful DX difference here. The choice of language does not affect webhook security implementation difficulty.

**Fallback if 12go cannot add signing:** IP allowlisting at the API Gateway level. Less secure (IP addresses can change) but requires zero code changes. This is a DevOps configuration, not a developer task.

---

## Retention and Morale Assessment

This section is written with full knowledge of the team reality, including that Soso is the sole developer and intends to leave after completion.

### .NET Microservice

**Short-term morale: Highest.** Soso writes .NET daily. No learning curve. Fast progress in week 1. The immediate dopamine of shipping working code quickly.

**Medium-term morale: Declining.** By week 3-4, the organizational friction sets in. "Why are you building a separate .NET service when we said one system?" Management pressure to justify the choice. Two codebases to maintain. Deployment coordination. The stress of defending a technical decision against organizational direction consumes energy that should go to coding.

**Post-departure impact: Poor.** No one on the remaining team writes .NET for the B2B domain. The service becomes a black box. When it breaks, the 12go team cannot fix it.

### TypeScript

**Short-term morale: Moderate.** The type system feels familiar. AI generates great code. But unfamiliar tooling (npm, Node.js runtime) creates friction.

**Medium-term morale: Neutral.** No organizational alignment. Neither the .NET team nor the 12go team uses TypeScript. Soso is alone in both the technology and the team.

**Post-departure impact: Worst.** Nobody in the organization writes TypeScript. Complete orphan.

### PHP/Symfony (Monolith)

**Short-term morale: Lowest.** The first two weeks are uncomfortable. PHP syntax feels foreign. The F3 local environment has documented friction. Soso is learning while building under deadline pressure.

**Medium-term morale: Improving.** By week 3-4, PHP syntax becomes automatic. The monolith advantage kicks in: one codebase, no deployment coordination, no microservice overhead. Organizational alignment removes friction -- no one is questioning the technology choice. 12go veterans can review code and answer questions.

**Post-departure impact: Best.** The 12go team inherits code in their own language and framework. They can read it, modify it, refactor it. When F3 is eventually decomposed, the B2B code moves with it.

### Go

**Morale trajectory: Similar to TypeScript.** Unfamiliar language, no organizational alignment, orphan after departure.

### The honest assessment

**No option makes a solo developer happy.** Being the sole developer on a transition originally scoped for four people is demoralizing regardless of language choice. The best the technology decision can do is remove sources of friction that are within its control: organizational pushback, second-codebase overhead, post-departure maintainability anxiety.

PHP/Symfony inside F3 removes all three. The trade-off is two to four weeks of syntactic discomfort, which AI tools substantially mitigate.

---

## Unconventional Idea (optional)

### Considered and partially recommended: Develop the mappers in a language-agnostic, test-fixture-driven way

The hardest part of this transition is not the HTTP plumbing. It is the data transformation layer -- the booking schema parser (20+ dynamic field patterns), the search response mapper, the reserve request builder, and the notification transformer. These are pure functions: input data in 12go format, output data in TC format.

**The idea:** Write the transformation logic first as a set of input/output test fixtures (JSON in, JSON out), validate them against the existing C# implementation, and then implement the transformations in whatever target language. The fixtures become the specification.

This is partially recommended because:
- The existing C# test suites already contain real 12go API responses as JSON fixtures
- These fixtures can be extracted and used as the contract specification for the new implementation
- AI tools can generate mapper implementations from "here is the input JSON and here is the expected output JSON" prompts with high accuracy
- The fixtures are language-agnostic -- they work for PHP, TypeScript, Go, or .NET

**What makes this unconventional:** Instead of porting code line-by-line from C# to PHP, you port the behavior by porting the test fixtures. The implementation is generated fresh, guided by AI, validated by the fixtures. This avoids the trap of translating C# idioms into awkward PHP equivalents.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for:
- **Solo developer shipping by Q2 2026.** One codebase, one local environment, no deployment coordination.
- **Post-departure maintainability.** Code in the same language as the team that will maintain it.
- **Organizational alignment.** No friction with management direction ("one system").
- **AI-augmented development.** Codebase structure designed for AI navigation and generation.
- **Incremental progress.** Endpoint-by-endpoint implementation and testing. No big-bang integration.
- **Migration simplicity.** Per-client feature flag rollout. Transparent auth bridge. Booking ID mapping table.

### Sacrifices:
- **Developer comfort in weeks 1-3.** PHP learning curve is real. Soso will be slower than in .NET.
- **Inner loop quality during ramp-up.** PHP debugging is less pleasant than .NET debugging.
- **Maximum AI code generation quality.** TypeScript would produce more reliable AI output. PHP is adequate but not optimal.
- **Technical purity.** A .NET microservice or a TypeScript service would be a cleaner technical architecture. But clean architecture that no one can maintain is worse than adequate architecture that the team owns.
- **The developer's preference.** Soso would almost certainly prefer to write .NET or TypeScript. This recommendation asks him to work in a language he did not choose, for organizational reasons. That is a real cost.
