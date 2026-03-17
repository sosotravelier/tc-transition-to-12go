---
status: draft
last_updated: 2026-03-17
agent: ai-friendliness
---

# AI Friendliness Analysis

## Evaluation Framework

"AI-friendly" in this context means: **does this specific combination of language, framework, architecture patterns, and project structure produce reliable, correct AI-generated code for Soso's actual workload -- HTTP proxy endpoints, data transformation between two API contracts, API client methods, middleware, and tests?**

AI is not a generic capability. It varies dramatically by:

1. **Code Generation Quality** -- Does Claude/Cursor generate correct, production-ready code on the first or second attempt for the specific patterns in this design? The key tasks are HTTP handlers, 12go API client methods, data transformation functions (search response mapping, booking schema parsing), and middleware (correlation IDs, versioning).

2. **Test Generation Quality** -- Can AI generate meaningful unit tests for transformation logic? Can it generate integration test stubs? Are mocking patterns well-understood by AI tools in this language/framework?

3. **Codebase Navigation** -- When an AI agent is given a task like "add rate limiting to the search endpoint," can it understand the codebase structure without reading every file? Does the architecture make it obvious where new code goes?

4. **Debugging Assistance** -- When a bug occurs, can AI help diagnose it from logs, stack traces, or code context? Is the error handling explicit enough for AI to trace failure paths?

5. **Maintenance and Modification** -- 6 months later, can AI (or a new developer using AI) understand and modify the codebase? Does the architecture stay AI-readable as it grows?

The critical insight: **training data density matters more than language quality.** A PHP service using standard Symfony conventions generates better AI code than a PHP service with custom abstractions, even if the custom abstractions are architecturally superior. Well-known patterns produce correct code. Obscure patterns produce plausible-looking code that fails in subtle ways.

### Complexity Hotspot Assessment

The booking schema parser (~500-1200 lines depending on implementation) and reserve request serializer are the hardest AI generation targets. These involve:
- Dynamic JSON key pattern matching (20+ wildcard patterns)
- Bracket-notation serialization for nested passenger data
- Cross-request state (field name mappings must survive between GetItinerary and CreateBooking)
- Edge cases that only surface with specific 12go response shapes

AI tools handle these differently by language. TypeScript and PHP are most natural for dynamic JSON manipulation. Go requires more manual `map[string]interface{}` traversal. .NET's `System.Text.Json` is fast but rigid for dynamic keys. All four languages can do it, but the error rate on first-pass AI generation varies.

## Language/Framework Baselines

| Language/Framework | Code Gen Quality | Training Data Density | Test Gen Quality | Notes |
|---|---|---|---|---|
| **.NET 8 Minimal API** | 4/5 | High | 4/5 | Excellent for HTTP handlers and typed clients. AI sometimes defaults to older MVC patterns or adds unnecessary DI abstractions. Minimal API is well-represented but newer than MVC, so AI occasionally generates controller-based code when minimal API is intended. Test generation with xUnit/NSubstitute is reliable. |
| **TypeScript / NestJS or Express** | 5/5 | Highest | 4.5/5 | Highest training data volume of any language. JSON manipulation is native. AI generates correct HTTP proxy code on first attempt more often than any other option. Risk: runtime type erasure means AI-generated code may not validate API boundaries. Jest test generation is excellent. |
| **PHP 8.3 / Symfony** | 3.5/5 | Medium-High | 3.5/5 | Symfony conventions are well-known. AI handles standard controllers, services, and Guzzle/HttpClient calls well. Weakness: AI sometimes generates pre-PHP 8 patterns (arrays instead of typed DTOs, missing strict_types). PHP 8.3 features (readonly, enums, constructor promotion) are less densely represented in training data than older PHP patterns. PHPUnit test generation is adequate but less polished than xUnit or Jest. |
| **Go / Chi (stdlib)** | 4/5 | High | 4/5 | Go's simplicity means fewer ways to write things wrong. AI generates correct `net/http` handlers reliably. `encoding/json` struct tag patterns are well-represented. Weakness: dynamic JSON handling (booking schema parser) is awkward -- AI generates verbose `map[string]interface{}` code that requires careful review. Table-driven tests are idiomatic and AI generates them well. |

**Key observation**: For this specific workload (HTTP proxy + JSON transformation), TypeScript has the highest raw AI quality, but the organizational constraints (no TypeScript expertise anywhere in the org) make it a risky orphan. The practical question is whether PHP's lower AI baseline is compensated by organizational alignment, or whether .NET's higher baseline plus Soso's expertise creates a faster path.

## Per-Design Analysis

### Pragmatic Minimalist

**Language/Framework**: PHP 8.3 / Symfony, bundle inside F3
**Architecture**: Single thin translation service, flat structure, no abstractions

#### What AI Handles Well

- **HTTP endpoint handlers**: Symfony controller generation is well-represented in AI training data. Standard route annotations, request parameter extraction, JsonResponse serialization -- AI generates these correctly on first attempt.
- **12go API client**: Guzzle/Symfony HttpClient calls with query parameter authentication (`?k=apiKey`) are a common AI generation target. Error handling (status code mapping) is straightforward.
- **Simple transformations**: Money format conversion, correlation header propagation, station ID lookup -- these are trivially AI-generatable in any language.
- **Migration/rollback logic**: The per-client routing table concept is simple enough that AI can generate the config lookup code without confusion.

#### Where AI Struggles (and Why)

- **Booking schema parser in PHP**: The dynamic key extraction (20+ patterns like `selected_seats_{cartId}`, `passenger[0][baggage_{cartId}]`) is the hardest piece. AI can generate the pattern-matching logic, but PHP's looser type system means errors are harder to catch. AI-generated PHP for this will likely produce working code for the common patterns but miss edge cases. Without strong types, these bugs are runtime-only.
- **F3 integration conventions**: Being inside F3 means following F3's existing conventions (service registration, bundle configuration, existing middleware). AI has no training data for F3's specific patterns. Soso will need to manually understand F3's conventions and guide AI accordingly. This is a significant AI productivity reduction compared to a greenfield project.
- **PHP 8.3 modern features**: AI training data skews toward older PHP. When asked to generate a readonly DTO class with constructor promotion, AI sometimes generates the older `private $property` pattern instead. This requires manual correction during review.
- **Reserve request serialization**: The bracket-notation flat key-value format (`passenger[0][first_name]`) is unusual. AI will generate something, but the exact format matching 12go's expectations requires careful testing. PHP handles this reasonably well with `http_build_query`, but the nested structure with dynamic keys from the schema parser adds complexity.

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- Flat structure (no deep abstraction layers) means AI can see the full call path in 2-3 files
- "No DDD, no CQRS" explicitly prevents the complexity creep that degrades AI effectiveness
- Direct HTTP calls (no message queue, no event sourcing) keep the code linear and AI-navigable
- Honest self-critique section identifies exactly where AI will struggle (booking schema parser), which helps Soso allocate review effort

**Hurts:**
- Being inside F3 means the AI must understand F3's existing codebase to generate correct code. This is a large context window burden. AI tools working in a 500+ file Symfony monolith are less effective than in a 35-file standalone project.
- No explicit project structure defined. The design describes what to build but not where files go, making it harder for AI to infer code location.
- PHP's weaker type system means AI-generated transformation code has a higher uncaught error rate than .NET or Go equivalents.

#### C3: AI-Friendliness (x3): 3/5
PHP/Symfony is adequate but not excellent for AI generation. The F3 monolith context significantly reduces AI effectiveness compared to a greenfield project. The booking schema parser will require significant manual effort. The flat architecture helps, but the environment hurts.

#### C7: Testing Ease (x2): 3/5
PHPUnit test generation is functional. AI can generate fixture-driven mapper tests from JSON input/output pairs. However, testing inside F3 adds complexity -- Symfony kernel boot for integration tests, F3's existing test infrastructure that Soso must learn. Mocking with PHPUnit is less ergonomic than with NSubstitute (.NET) or Jest (TS).

#### C10: Elegance (x1, partial): 3/5
The "boring HTTP translation layer" philosophy is AI-friendly -- no clever patterns to confuse AI tools. But the lack of explicit project structure and the F3 embedding reduce navigability. An AI agent asked to find "where search response mapping happens" would need to search rather than infer.

---

### Clean Slate Designer

**Language/Framework**: Go / Chi (stdlib + router)
**Architecture**: Single standalone service, three layers (handler/logic/client), ~35 files

#### What AI Handles Well

- **HTTP handlers with Chi**: Go's `net/http` patterns are extremely well-represented in AI training data. Chi router is a thin layer that AI understands well. Route definition, request parsing, response writing -- all generate correctly on first attempt.
- **12go HTTP client**: Go's `net/http.Client` with `json.Decoder`/`json.Encoder` is one of the most common AI generation patterns. Error handling with `if err != nil` is explicit and AI generates it reliably.
- **Pure transformation functions**: The `transform/` package with pure functions (12go types in, TC types out) is ideal for AI. Each function has clear inputs and outputs, no side effects, no hidden dependencies.
- **Table-driven tests**: Go's table-driven test pattern is well-known to AI. Given a transformation function, AI can generate comprehensive test tables with edge cases.
- **Project structure**: The explicit 35-file structure with clear naming (`handler/search.go`, `transform/search.go`, `twelvego/search.go`) is the single most AI-friendly structure of any design. An AI agent can infer where any feature goes without reading the whole codebase.

#### Where AI Struggles (and Why)

- **Dynamic JSON in Go**: The booking schema parser requires iterating over `map[string]interface{}` or `json.RawMessage`. AI generates this, but the code is verbose and error-prone. Type assertions (`value.(map[string]interface{})`) are a common source of AI errors -- AI sometimes omits the ok-check, producing panics on unexpected types.
- **Go error handling verbosity**: AI generates correct `if err != nil` blocks, but Soso must review each one. For a 35-file project, this is manageable. The risk is not that AI generates wrong error handling, but that the volume of boilerplate makes review tedious and errors slip through.
- **Go generics (limited)**: If generic helper functions are needed for transformation logic, Go's generics are less well-represented in AI training data than C# or TypeScript generics. AI sometimes generates pre-generics patterns.

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- **Explicit project structure with file-per-concern**: This is the gold standard for AI navigation. `handler/search.go` handles the search endpoint. `transform/search.go` transforms the response. `twelvego/search.go` calls 12go. An AI agent can navigate this without any documentation.
- **Three-layer architecture**: Handler -> Logic -> Client is universally understood by AI tools. No framework magic, no DI container, no service locator.
- **In-memory state**: No database, no Redis (for initial deployment). AI does not need to generate ORM code, migration scripts, or cache invalidation logic.
- **Static mapping files**: Loading JSON files at startup is trivially AI-generatable.
- **Pure transformation functions**: The `transform/` package is the ideal AI generation target. Input type, output type, no side effects. AI can generate and test these in isolation.

**Hurts:**
- **Go is unfamiliar to Soso**: AI generates correct Go, but Soso must review it. A .NET developer reviewing Go code may not catch subtle issues (goroutine leaks, deferred resource cleanup, channel deadlocks). AI-generated Go that looks correct to a Go novice may have subtle concurrency bugs.
- **No organizational Go expertise**: When AI generates something questionable, there is no one to ask. In PHP, 12go veterans can review. In .NET, Soso knows the answer. In Go, AI is both the generator and the sole reviewer.

#### C3: AI-Friendliness (x3): 4/5
Go + Chi + the explicit project structure is highly AI-friendly for code generation. The three-layer architecture and pure transformation functions are ideal AI targets. Deducted one point for the dynamic JSON handling in the booking schema parser (the single hardest piece of code in the system) and for Soso's inability to review AI-generated Go for subtle issues.

#### C7: Testing Ease (x2): 4/5
Go's table-driven tests are excellent for transformation logic. AI generates comprehensive test tables. The `testing` package is simple, no framework required. Mocking with interfaces is idiomatic. Integration testing with `httptest` is straightforward. The only weakness: testing the booking schema parser requires extensive fixture data, and Go's JSON handling makes fixtures slightly more verbose to set up than in TypeScript or PHP.

#### C10: Elegance (x1, partial): 5/5
From the AI navigability lens, this is the best design. The project structure is self-documenting. File names tell AI exactly what each file does. The three-layer architecture is universally understood. No clever patterns, no framework magic, no hidden conventions. An AI agent dropped into this codebase can be productive immediately.

---

### Platform Engineer

**Language/Framework**: PHP 8.3 / Symfony, standalone service (not inside F3)
**Architecture**: Standalone Symfony service with full operational specification

#### What AI Handles Well

- **Symfony service scaffolding**: A standalone Symfony project is a well-represented AI generation target. AI can scaffold controllers, services, DI configuration, and Doctrine-less services correctly.
- **Guzzle/HttpClient calls**: The 12go API client pattern (query param auth, JSON responses) is standard HTTP client work. AI generates this reliably in Symfony.
- **Datadog integration code**: The `dd-trace-php` patterns shown in the design (span enrichment, DogStatsD metrics) are documented in Datadog's own docs, which are well-represented in AI training data.
- **Docker/deployment configuration**: AI generates Dockerfiles, docker-compose configs, and PHP-FPM configurations well. The design's infrastructure specifications are AI-reproducible.
- **Monolog structured logging**: JSON logging configuration in Symfony is a common AI target.

#### Where AI Struggles (and Why)

- **Same PHP weaknesses as Pragmatic Minimalist**: Booking schema parser dynamic key handling, PHP 8.3 modern patterns, reserve request serialization.
- **Observability boilerplate**: The design specifies detailed Datadog metrics, alerting rules, and structured logging. AI can generate the individual pieces, but wiring them together correctly (metric names, tag dimensions, alert thresholds) requires domain knowledge that AI does not have.
- **PHP-FPM tuning**: The design specifies resource limits and worker pool sizes. AI cannot generate correct values for these -- they require production observation. The design acknowledges this ("adjust after first week").

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- **Standalone project** (not inside F3): The AI works with a small, focused codebase rather than a 500+ file monolith. This is a significant AI productivity improvement over the Pragmatic Minimalist.
- **Explicit operational specification**: The detailed Dockerfile, docker-compose, CI/CD pipeline, and on-call runbook give AI concrete reference material for generating deployment and operational code.
- **Clear separation of concerns**: Controllers, services, DTOs, config -- standard Symfony structure that AI navigates well.

**Hurts:**
- **No explicit project file structure for application code**: The design focuses heavily on infrastructure but does not define where the 13 endpoint handlers and their transformations live. AI would need to infer this from Symfony conventions.
- **PHP per-request memory model**: The design mentions this as a concern for ID mapping tables but does not specify the solution (Redis? OPcache? Shared memory?). AI generating code for "load mapping tables" in PHP would default to per-request loading, which is wrong for performance.

#### C3: AI-Friendliness (x3): 3.5/5
Standalone Symfony is better than F3-embedded for AI effectiveness. The operational specification is thorough and AI-reproducible. The PHP baseline limitations remain. The lack of application code structure definition is a gap.

#### C7: Testing Ease (x2): 3.5/5
Same PHPUnit baseline as Pragmatic Minimalist, but the standalone project makes test isolation easier. No F3 kernel to boot. Symfony's `WebTestCase` works well for integration tests. AI can generate Symfony functional tests from route definitions.

#### C10: Elegance (x1, partial): 3.5/5
The operational specification adds clarity that AI tools benefit from (deployment patterns, health checks, metrics). The infrastructure-first perspective produces code that is well-structured for ops but less explicit about application architecture patterns.

---

### Data Flow Architect

**Language/Framework**: Language-agnostic (evaluated PHP, Go, .NET for event emission); primary focus is event/observability architecture
**Architecture**: HTTP proxy with structured event emission layer

#### What AI Handles Well

- **Structured event emission**: The event schema specification (JSON format, standard envelope, per-endpoint events) is an ideal AI generation target. Given the event spec, AI can generate the emission code in any language.
- **Datadog metric instrumentation**: `DogStatsD::increment` with tag dimensions is a well-known AI pattern.
- **Event schema definitions**: The detailed per-endpoint event specifications serve as excellent AI prompts. "Generate a function that emits this JSON event after processing a search request" produces correct code.

#### Where AI Struggles (and Why)

- **Event correctness in edge cases**: AI can generate the event emission code, but populating events correctly during error paths (partial failures, timeouts, 206 responses) requires understanding the business logic. AI may emit events with incorrect or missing fields on error paths.
- **Dual-write consistency**: During migration, both old Kafka events and new structured log events flow. AI cannot reason about which events the data team expects from which source during a partial migration.
- **ClickHouse forwarding configuration**: Datadog Logs -> ClickHouse forwarding is infrastructure configuration, not application code. AI cannot generate this.

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- **Explicit event specifications with JSON examples**: These serve as direct AI prompts for code generation. The per-endpoint event specs are essentially AI-ready templates.
- **Structured logs approach**: Using `kernel.terminate` or goroutines for async event emission is a well-known pattern. AI generates this correctly.

**Hurts:**
- **Cross-cutting event emission adds complexity to every handler**: Every endpoint handler must emit events in addition to processing the request. This increases the code per handler and the surface area for AI errors.
- **Language-agnostic design means no concrete code structure**: AI needs concrete file paths and function signatures, not abstract specifications. The design provides event schemas but not code structure.

#### C3: AI-Friendliness (x3): 3/5
The event architecture is well-specified and AI-generatable, but it adds complexity to every endpoint handler. The design does not provide a concrete code structure. The language-agnostic approach means AI has no specific framework conventions to follow. This is more of an overlay than a standalone design -- its AI score depends heavily on which base design it is combined with.

#### C7: Testing Ease (x2): 3/5
Testing event emission requires verifying JSON event structure and content. AI can generate these tests from the event specifications. However, testing the full flow (HTTP request -> response + event emission) requires more complex test setup. The async emission pattern means tests must either be synchronous-only or use test doubles for the event emitter.

#### C10: Elegance (x1, partial): 3/5
The event specifications are clear and well-structured, but the design is an overlay that must be combined with another design's code structure. On its own, an AI agent cannot navigate this design because there is no concrete codebase to navigate.

---

### Team-First Developer

**Language/Framework**: PHP 8.3 / Symfony, inside F3 (monolith)
**Architecture**: B2B module within F3 with explicit AI-optimized project structure

#### What AI Handles Well

- **Everything the Pragmatic Minimalist handles**, plus:
- **Explicit B2B module structure**: The detailed file tree (`B2bApi/Controller/`, `B2bApi/Service/`, `B2bApi/DTO/`) gives AI a concrete navigation map. File names are descriptive (`SearchMapper.php`, `BookingSchemaMapper.php`, `ReserveRequestBuilder.php`).
- **AGENTS.md specification**: The proposed AGENTS.md file for the B2B module is **the single most AI-friendly artifact in any design**. It tells AI tools exactly what the module does, where to find key files, which patterns to follow, and which patterns to avoid. This is a force multiplier for Claude Code specifically.
- **Naming conventions**: "No abbreviations", "No generic names", explicit naming rules (`ClientKeyResolver` not `AuthService`) directly improve AI navigation.
- **DTO separation by direction**: `DTO/Request/`, `DTO/Response/`, `DTO/TwelveGo/` tells AI exactly which types belong to which API boundary. This prevents the common AI error of using 12go types in client-facing responses.
- **Fixture-driven test strategy**: Real JSON fixtures as test inputs, with expected TC-format outputs as assertions. AI excels at generating tests from fixture pairs.

#### Where AI Struggles (and Why)

- **Same F3 embedding challenges as Pragmatic Minimalist**: Large monolith context, F3 conventions, PHP learning curve.
- **PHP type system weakness for complex transformations**: Despite `strict_types=1` and readonly properties, PHP's type system cannot prevent the booking schema parser from silently producing wrong output. AI-generated transformation code in PHP has a higher uncaught error rate than equivalent .NET code.
- **Controller grouping**: Grouping multiple endpoints into one controller (`BookingController` handles GetItinerary, CreateBooking, ConfirmBooking, SeatLock) means larger files that are harder for AI to work with. The Team-First design explicitly notes "maximum 200-300 lines per file" as a principle, but then groups 4 endpoints into one controller.

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- **AGENTS.md for the B2B module**: This is a game-changer for Claude Code. It provides the context that AI needs to be productive without reading every file. Patterns to follow, patterns to avoid, key files to read first.
- **Fixture-driven testing approach**: AI-generated tests from JSON pairs are reliable and maintainable.
- **"No shared base classes"**: Eliminates inheritance hierarchies that confuse AI tools.
- **"Maximum 200-300 lines per file"**: Keeps files within AI context window limits.
- **"Develop mappers test-fixture-driven" unconventional idea**: Port test fixtures from C# first, then generate implementations. This is the optimal AI workflow for this specific problem.
- **Explicit type usage strategy**: `declare(strict_types=1)`, readonly classes, constructor promotion, enum usage -- these modern PHP conventions improve AI generation quality.

**Hurts:**
- **Inside F3**: Same large-codebase navigation problem.
- **PHP baseline limitations**: Same as other PHP designs.

#### C3: AI-Friendliness (x3): 3.5/5
The AGENTS.md, explicit structure, naming conventions, and fixture-driven approach significantly improve AI effectiveness compared to the bare PHP designs. The F3 embedding and PHP baseline limitations prevent a higher score. This design is the most AI-aware of all six -- it was clearly written with AI tooling in mind.

#### C7: Testing Ease (x2): 4/5
The fixture-driven testing strategy is excellent. AI generates mapper tests from JSON pairs reliably. The explicit test structure (`tests/B2bApi/` mirroring `src/B2bApi/`) is AI-navigable. Controller integration tests with Symfony's test client work well. The key insight -- port test fixtures from C# first, then generate implementations -- is the highest-leverage testing recommendation in any design.

#### C10: Elegance (x1, partial): 4/5
From the AI navigability lens, this is the best PHP design. The explicit structure, naming conventions, AGENTS.md, and "patterns to avoid" list make the codebase self-documenting for AI tools. The grouping of multiple endpoints per controller is a minor deduction.

---

### Disposable Architecture

**Language/Framework**: Language-agnostic (evaluated PHP in F3, .NET microservice, Go); focus is on adapter boundary pattern
**Architecture**: Ports and adapters with permanent boundary (client contract) and disposable boundary (12go adapter)

#### What AI Handles Well

- **Interface-based adapter pattern**: AI tools understand ports-and-adapters well, especially in .NET and Go. Generating an interface (`ITravelProvider`) and an implementation (`TwelveGoTravelProvider`) is a common AI target.
- **Contract test fixtures**: The YAML-based contract test specification is language-agnostic and AI-generatable. AI can produce test harness code from these specs.
- **Domain model types**: Defining types like `SearchResult`, `Itinerary`, `Segment` that are independent of 12go's API is straightforward for AI in any language.
- **Clear separation**: The permanent vs. disposable boundary labels tell AI (and developers) exactly which code matters long-term.

#### Where AI Struggles (and Why)

- **Interface indirection increases navigation complexity**: AI tools must resolve interface -> implementation to understand the actual code path. In a 35-file project this is trivial; in a larger codebase with multiple adapter implementations it can confuse AI navigation.
- **Domain model duplication**: The design defines domain types (`SearchResult`) separate from both 12go types and client response types. This means three type hierarchies for the same data (12go, domain, client). AI must understand which type to use where. In practice, AI often generates code that uses the wrong type at the wrong layer.
- **The "outbound port interface" pattern is less well-represented in training data than direct HTTP calls**: AI generates direct `httpClient.Get("/search/...")` more reliably than `travelProvider.Search(searchRequest)` because the latter requires understanding the abstraction layer.
- **Language-agnostic design lacks concrete code structure**: Like the Data Flow Architect, this is a pattern overlay. AI needs specific file paths and function signatures.

#### Design Choices That Help/Hurt AI Effectiveness

**Helps:**
- **Explicit survivability analysis**: The table showing which artifacts survive F3 decomposition helps AI understand what to treat as stable vs. temporary.
- **Contract test fixtures**: Language-agnostic test specs that can guide AI in any implementation.
- **Clear labeling of permanent vs. disposable code**: AI agents can be instructed to "only modify disposable boundary code" for 12go-specific changes.

**Hurts:**
- **Three type hierarchies**: 12go types, domain types, client types. AI must map between all three correctly. This triples the surface area for mapping errors.
- **Interface indirection**: Adds a layer that AI must resolve for every code path. In practice, AI tools sometimes generate code that calls the interface method with the wrong argument types because they lose context across the indirection.
- **Upfront abstraction cost**: Building domain types and outbound interfaces before writing any 12go integration code means AI cannot generate end-to-end working code early. The design requires sequential phases, which reduces AI's ability to validate generated code through execution.
- **Over-engineering risk for a solo developer**: The adapter pattern is architecturally sound but adds complexity that reduces AI generation reliability. For a solo developer, every layer of indirection is a layer that must be reviewed.

#### C3: AI-Friendliness (x3): 2.5/5
The adapter pattern adds meaningful complexity that reduces AI code generation reliability. Three type hierarchies, interface indirection, and the inability to generate end-to-end working code early are significant costs. The survivability analysis is valuable for long-term maintenance, but AI is most productive in the short term with direct, concrete patterns. This design optimizes for replaceability at the cost of initial AI productivity.

#### C7: Testing Ease (x2): 3.5/5
Contract test fixtures are excellent and AI-generatable. Interface mocking is straightforward. The three-layer testing strategy (ACL tests, adapter tests, contract tests) is clear. However, the separation of permanent and disposable tests adds test maintenance overhead. A solo developer maintaining two test categories is more work than maintaining one flat test suite.

#### C10: Elegance (x1, partial): 3/5
The ports-and-adapters pattern is well-known and AI-navigable in principle. In practice, the three type hierarchies and interface indirection make navigation harder than a flat structure. The pattern is architecturally elegant but not AI-navigation-elegant. An AI agent asked "where does search response mapping happen" must trace through handler -> domain type -> outbound interface -> adapter implementation -> response mapper, which is 5 files instead of 2.

---

## Comparative Scoring Matrix

| Design | C3 AI-Friendly (x3) | C7 Testing (x2) | C10 Elegance/partial (x1) | Weighted Total |
|---|---|---|---|---|
| **Pragmatic Minimalist** (PHP/F3 bundle) | 3 | 3 | 3 | 9 + 6 + 3 = **18** |
| **Clean Slate Designer** (Go/Chi standalone) | 4 | 4 | 5 | 12 + 8 + 5 = **25** |
| **Platform Engineer** (PHP/Symfony standalone) | 3.5 | 3.5 | 3.5 | 10.5 + 7 + 3.5 = **21** |
| **Data Flow Architect** (language-agnostic overlay) | 3 | 3 | 3 | 9 + 6 + 3 = **18** |
| **Team-First Developer** (PHP/F3 monolith) | 3.5 | 4 | 4 | 10.5 + 8 + 4 = **22.5** |
| **Disposable Architecture** (language-agnostic adapter) | 2.5 | 3.5 | 3 | 7.5 + 7 + 3 = **17.5** |

### Score Justification Summary

**Clean Slate Designer leads** because its explicit project structure, pure transformation functions, three-layer architecture, and Go/Chi simplicity produce the most AI-friendly codebase. The only significant weakness is dynamic JSON handling in Go for the booking schema parser.

**Team-First Developer is the best PHP option** because its AGENTS.md, naming conventions, fixture-driven testing, and explicit structure significantly improve AI effectiveness within the PHP constraint. It is the most AI-aware design.

**Disposable Architecture ranks lowest** because its adapter pattern, three type hierarchies, and interface indirection reduce AI code generation reliability. The pattern is architecturally sound but AI-expensive.

## Recommendations for Maximizing AI Effectiveness

These recommendations apply regardless of which design is chosen:

1. **Write an AGENTS.md (or CLAUDE.md) for the new codebase.** The Team-First Developer's AGENTS.md concept is the single highest-leverage AI investment. It costs 30 minutes to write and saves hours of AI context-building on every task. Include: module purpose, project structure, key files, patterns to follow, patterns to avoid, how to run tests.

2. **Port test fixtures from C# first, then generate implementations.** Extract JSON fixtures from the existing .NET test suites (12go search responses, checkout schemas, reserve requests). Use these as the contract specification. Prompt AI with "given this input JSON, generate a function that produces this output JSON." This fixture-driven approach produces the most reliable AI output for transformation logic.

3. **One file per endpoint handler.** The Clean Slate Designer's approach (handler/search.go, handler/get_itinerary.go) is more AI-navigable than grouping endpoints into controllers. Even in Symfony, one controller per endpoint (or at most per domain area) keeps files small and AI-focused.

4. **Name types by origin, not by abstraction.** `TwelveGoSearchResponse` is better than `UpstreamResponse`. `ClientSearchRequest` is better than `SearchRequest`. AI tools use type names to infer which API boundary a type belongs to.

5. **Keep files under 300 lines.** AI code generation quality degrades with file size. The booking schema parser (~500-1200 lines in the current system) should be split into multiple focused functions in separate files if possible: `schema_field_extractor`, `schema_name_normalizer`, `reserve_request_builder`.

6. **Avoid interface indirection unless you need it.** For a solo developer building an HTTP proxy, direct function calls (handler -> transformation function -> HTTP client) are more AI-productive than interface-mediated calls. Add interfaces only where you need test mocking or future swappability, and only at the outermost boundary.

7. **Use explicit error types, not exception hierarchies.** AI tools generate correct error handling more reliably when the error is visible in the return type (`Result<T, Error>` or Go's `(T, error)`) than when it is thrown as an exception. This is especially true for the 12go error mapping (400 -> validation error, 404 -> not found, 500+ -> upstream error).

8. **Generate tests before or alongside implementation, not after.** AI generates the most accurate tests when it has both the input fixture and the implementation. The workflow should be: write fixture -> generate implementation -> generate test (verify fixture matches). Not: write implementation -> write test after the fact.

9. **Do not assume AI catches its own errors.** For the booking schema parser specifically, manually review every AI-generated transformation path. Use the existing C# test suite as a cross-reference. AI will generate plausible-looking code that handles 18 of 20 patterns correctly and silently fails on the remaining 2.

10. **For PHP specifically: always include `declare(strict_types=1)` in prompts and file templates.** AI defaults to loose PHP without this. Set up a file template that every new PHP file starts from. This single convention eliminates a significant class of AI generation errors.
