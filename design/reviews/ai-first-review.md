---
status: draft
last_updated: 2026-02-17
agent: V2-ai-first-architect
---

# AI-First Architecture Review: Options A, B, and C

## 1. Executive Summary

**Option C (Thin Gateway) is the best architecture for a team shipping features with AI tools.** It scores highest on every AI-friendliness criterion except documentation-as-code (tied with Option A). Its simplicity — one service, one Redis, one pattern per endpoint — means an AI agent can understand the entire system in minutes, not hours.

**Option A (Trimmed .NET) is a strong second.** It trades some simplicity for proven code reuse and slightly richer business logic support. For a team that already has .NET expertise and wants the lowest migration risk, it's a pragmatic choice that is still very AI-friendly.

**Option B (PHP Native) is the weakest option for AI-assisted development.** Not because PHP is bad, but because embedding a bundle inside frontend3's ~968-file legacy codebase creates an environment where AI tools struggle: implicit service dependencies, unversioned internal APIs, framework magic, and a massive context window requirement to make safe changes.

The scoring gap between C and B (39 vs 20 out of 40) is not subtle. For a team that leans heavily on Cursor, Claude, and Copilot, the architecture choice matters more than the language choice.

---

## 2. Per-Option Review

### 2.1 Option A: Trimmed .NET

#### AI-Friendliness Strengths

- **Strong type system**: C# with nullable reference types, Mapperly source-generated mappers, and strongly-typed request/response models mean AI tools can infer intent from types alone. When Cursor autocompletes a method call, it knows exactly what types flow in and out.
- **Clean project structure**: The proposed `TravelApi/` layout with `Controllers/`, `Services/`, `TwelveGoClient/`, and `Contracts/` is exactly the kind of predictable structure AI agents navigate well. ~100-120 source files is small enough to reason about holistically.
- **Existing AI-first culture**: The `supply-integration` repo already has `AGENTS.md`, `.cursorrules`, and module-specific documentation. This culture would carry forward.
- **Battle-tested patterns**: ASP.NET controller → service → infrastructure is the most common .NET pattern in AI training data. Copilot and Cursor produce high-quality suggestions for this architecture.
- **Excellent test infrastructure**: xUnit + Moq + AutoFixture + Pact contract tests. AI can generate tests confidently because the patterns are well-represented in training data.

#### AI-Friendliness Weaknesses

- **Three separate project layers**: `TravelApi`, `TravelApi.Services`, `TravelApi.TwelveGoClient`, `TravelApi.Contracts` — four projects for ~100 files introduces navigation overhead. An AI agent adding a new endpoint must touch files in at least 3 projects.
- **NuGet dependency complexity**: 14+ packages including internal SDKs (`Ushba.Revenue.Search.Sdk`, `Connect.Infra.Cyphering`, `FujiContentManagement.ExchangeRates.SDK`). AI tools have no training data for proprietary packages and must rely entirely on in-context documentation or source code.
- **DI registration ceremony**: ASP.NET's `IServiceCollection` registrations in `Program.cs` create implicit behavior that AI must trace. A new developer asking Cursor "where does `IPricingService` come from?" gets a non-obvious answer.
- **Kafka adds conceptual weight**: 5 Kafka topics with event schemas, publisher configuration, and consumer semantics are infrastructure an AI must understand even for simple changes.

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Navigability | 4/5 | Clean folder structure, ~120 files. Slightly penalized for 4 project split. |
| Type Safety | 5/5 | Best-in-class. C# nullable refs, Mapperly, strongly-typed everything. |
| Convention Consistency | 4/5 | Standard ASP.NET patterns. Minor inconsistency risk with internal SDK conventions. |
| Test Coverage Patterns | 4/5 | xUnit/Moq/AutoFixture is well-known. Pact contract tests add safety. |
| Refactoring Safety | 4/5 | Strong types + tests + clear boundaries. Internal SDKs are the risk. |
| Documentation-as-Code | 4/5 | AGENTS.md culture exists. Can be applied to new service. |
| Modification Speed | 4/5 | 3 layers + 4 projects means ~4 files to touch for a new endpoint. |
| Language/Framework AI Support | 5/5 | C#/.NET is top-tier for AI tool support. Massive training corpus. |
| **Total** | **34/40** | |

#### Suggestions to Improve AI-Friendliness

1. **Collapse to 2 projects** instead of 4: `TravelApi` (host + controllers + services) and `TravelApi.TwelveGoClient` (12go HTTP client + contracts). The service layer doesn't need its own project at this scale.
2. **Add an `AGENTS.md`** to the root of the new solution documenting the endpoint-to-file mapping, the 3-step flow pattern, and how to add a new endpoint.
3. **Create a `.cursorrules`** file with the coding conventions: "every endpoint follows Controller → Service → TwelveGoClient → Mapper", "no MediatR", "no DDD", "pricing always goes through PricingService".
4. **Document internal SDK APIs** inline with XML doc comments or a `docs/internal-sdks.md` file. AI cannot read NuGet package source code without explicit context.
5. **Consider replacing Kafka** with simple OTel-exported events for analytics. 5 Kafka topics in a ~100-file service is disproportionate infrastructure.

---

### 2.2 Option B: PHP Native (Frontend3 Internal Bundle)

#### AI-Friendliness Strengths

- **Maximum code reuse**: 90%+ of business logic already exists in frontend3. For a human developer who knows the codebase, this is efficient. AI also benefits from not needing to write booking/search logic from scratch.
- **Well-structured bundle**: The `src/PartnerApiBundle/` layout with `Controller/`, `Service/`, `Contract/`, `Security/`, and `EventListener/` directories follows Symfony conventions that AI understands.
- **In-process calls eliminate inter-service debugging**: No HTTP serialization between our code and frontend3's services means simpler traces and fewer failure modes for AI to reason about.
- **Symfony ecosystem**: Decent AI training data for Symfony patterns. Cursor understands Symfony controllers, services, and event listeners.

#### AI-Friendliness Weaknesses

- **Massive context requirement**: The bundle lives inside frontend3, a ~968-file PHP codebase. To understand what `SearchService::newSearch()` does, AI must navigate frontend3's internal architecture, including `TripPoolRepository` with binary-packed prices, `CartHandler` with Redis-serialized cart state, and `BookingProcessor` with a complex state machine. This is the opposite of small, focused, navigable code.
- **Implicit coupling to unversioned internal APIs**: `BookingProcessor::createBookingsAndSetIds()`, `RefundFactory`, `IntegrationApiProxy::getTicketRawResponse()` — these are internal methods that can change without notice. AI has no way to know which methods are stable and which are volatile.
- **Weak type safety**: PHP 8.3 has type hints, but the codebase uses `PriceBinaryParser` (binary data), Cart serialization (Redis blobs), and dynamic form fields (`BookingFormManager`). These are deeply implicit patterns that AI cannot safely reason about from type signatures alone.
- **Framework magic**: Symfony's autowiring, event system, and Doctrine DBAL mean behavior is configured in YAML and resolved at runtime. When AI asks "what happens when this controller is called?", the answer requires understanding `routes.yaml`, `services.yaml`, event listener priorities, and Nginx routing — none of which is visible in the PHP source file.
- **Testing in a shared codebase is fragile**: `KernelTestCase` boots the entire Symfony kernel including frontend3's services. Test isolation is hard. A change in frontend3's `BookingProcessor` can break our tests without any change in our code.
- **AI-hostile binary data**: `TripPoolRepository` uses binary-packed price data. AI tools cannot reason about binary formats. This is a critical path (search results) that depends on implicit binary parsing logic.
- **No documentation-as-code path**: Adding `AGENTS.md` to frontend3 requires 12go team buy-in. `.cursorrules` must coexist with frontend3's conventions. This is a governance problem, not just a technical one.

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Navigability | 2/5 | Bundle is 30 files, but lives inside a 968-file app. AI must understand both. |
| Type Safety | 3/5 | PHP 8.3 type hints help, but binary data, dynamic forms, and YAML config undermine safety. |
| Convention Consistency | 3/5 | Symfony conventions are consistent within the bundle, but frontend3 may follow different patterns. |
| Test Coverage Patterns | 3/5 | PHPUnit is fine, but KernelTestCase couples tests to frontend3. Golden file tests for pricing are good. |
| Refactoring Safety | 2/5 | Unversioned internal APIs + weak types + shared codebase = high risk for AI-driven changes. |
| Documentation-as-Code | 2/5 | Hard to establish in a shared codebase owned by another team. |
| Modification Speed | 2/5 | Adding an endpoint requires understanding frontend3 service internals. High context overhead. |
| Language/Framework AI Support | 3/5 | PHP/Symfony has decent but not top-tier AI support. Less training data than C#/Python/JS. |
| **Total** | **20/40** | |

#### Suggestions to Improve AI-Friendliness

1. **If choosing Option B, prefer the "(a) PHP Thin Proxy" sub-variant** over the internal bundle. A standalone Symfony app calling frontend3 over HTTP has clear boundaries, its own codebase, and isolated testing. The AI-friendliness score would improve by 8-10 points.
2. **Create adapter interfaces** for every frontend3 service used: `SearchServiceInterface`, `BookingProcessorInterface`, etc. These become the documented contract that AI can rely on, even if the implementation changes.
3. **Write extensive integration test fixtures** that document expected inputs/outputs for each frontend3 service call. These serve as both tests and documentation for AI.
4. **Add PHPStan level 8+** to the bundle to maximize static analysis. AI tools produce better PHP code when PHPStan catches errors.
5. **Avoid using frontend3's binary data paths** directly. If `TripPoolRepository` returns binary-packed prices, create a typed adapter that returns `PricedTrip` objects. Never expose binary parsing to the bundle layer.
6. **Create a standalone `AGENTS.md`** within the `src/PartnerApiBundle/` directory, even within frontend3. Document which frontend3 services are called, their stability guarantees, and the endpoint-to-service mapping.

---

### 2.3 Option C: Thin Gateway

#### AI-Friendliness Strengths

- **Simplest architecture for AI to comprehend**: One service, one Redis, one pattern. An AI agent can read the entire codebase in a single context window. There are no inter-service calls to trace, no Kafka consumers to find, no database schemas to understand.
- **Every endpoint follows the same pattern**: `Validate → Transform → Call 12go → Transform Response → Apply Pricing → Return`. An AI that learns this pattern for Search can apply it to every other endpoint. This is the holy grail of convention consistency.
- **Strong types throughout** (with .NET recommendation): Same C# type safety as Option A, but applied to a simpler architecture. Every request and response is a strongly-typed model.
- **Self-contained encrypted BookingToken**: Eliminates an entire category of state management that AI would need to reason about. No "where is this booking token stored?" question — it's in the token itself.
- **No Kafka**: Fewer moving parts means fewer things an AI can break. Observability via OTel is simpler and more AI-traceable than Kafka event flows.
- **Honest about limitations**: The "When This Option Breaks Down" section and the "Creep Warning" are valuable for AI agents. An AI reading AGENTS.md can know when to escalate to a human.
- **Best testability**: Each endpoint is a pure transformation function. Input → output. No side effects except 12go calls (which can be mocked). AI can write exhaustive tests.

#### AI-Friendliness Weaknesses

- **Pricing logic adds hidden complexity**: The gateway isn't truly "thin." Markup calculations, currency conversion, and per-client rules are real business logic. AI must understand the pricing flow to make safe changes to any price-touching endpoint.
- **Self-contained tokens have edge cases**: Key rotation, token expiration, schema hash validation, cart expiry races — these are subtle bugs that AI might not anticipate. The token is a form of implicit state that doesn't show up in Redis or a DB, making it harder to debug.
- **Scope creep risk materializes in code**: The document honestly admits the gateway could grow to ~150 files. If it does, the AI-friendliness advantage over Option A diminishes. There's no architectural guardrail that prevents this — only discipline.
- **Same proprietary SDK dependency issue as Option A**: `Connect.Infra.Cyphering`, credit line service, exchange rates — AI has no training data for these.
- **Fewer architectural escape hatches**: If requirements grow, the gateway either becomes thicker (losing its advantage) or must be replaced. Option A has a natural evolution path to split services.

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Navigability | 5/5 | ~100 files, single service, single pattern per endpoint. Best possible. |
| Type Safety | 5/5 | Same C# type safety as Option A, applied to a simpler architecture. |
| Convention Consistency | 5/5 | One pattern for all endpoints. Learn once, apply everywhere. |
| Test Coverage Patterns | 5/5 | Pure transformation functions are the easiest thing to test. Golden files, contract tests. |
| Refactoring Safety | 5/5 | Strong types + simple architecture + comprehensive tests = safest for AI changes. |
| Documentation-as-Code | 4/5 | Fresh codebase enables full AI-first documentation. Tied with Option A. |
| Modification Speed | 5/5 | One file per endpoint layer. Fewest layers, fastest changes. |
| Language/Framework AI Support | 5/5 | .NET Minimal API has the least framework ceremony of any .NET approach. |
| **Total** | **39/40** | |

#### Suggestions to Improve AI-Friendliness

1. **Create an `AGENTS.md`** that includes the endpoint-to-file mapping, the universal `Validate → Transform → Call → Transform → Price → Return` pattern, and the scope guardrails (max 150 files, max 3 Redis data types).
2. **Use .NET Minimal API with endpoint grouping** rather than controllers. This keeps each endpoint definition in a single file, reducing the number of files an AI must navigate.
3. **Document the BookingToken schema** in a dedicated `docs/booking-token.md` with all edge cases (expiry, rotation, validation). AI must be able to reason about tokens without reading the encryption implementation.
4. **Create a `scripts/add-endpoint.sh`** template or a documented checklist in `.cursorrules` for adding new endpoints. This is the most common AI task and should be zero-ambiguity.
5. **Establish the scope guardrail as a CI check**: If file count exceeds 150, fail the build with a message pointing to the "Creep Warning" section. This keeps the architecture honest.

---

## 3. Comparison Matrix

| Criterion | Option A (Trimmed .NET) | Option B (PHP Native) | Option C (Thin Gateway) |
|-----------|:-----------------------:|:---------------------:|:-----------------------:|
| Navigability | 4 | 2 | **5** |
| Type Safety | **5** | 3 | **5** |
| Convention Consistency | 4 | 3 | **5** |
| Test Coverage Patterns | 4 | 3 | **5** |
| Refactoring Safety | 4 | 2 | **5** |
| Documentation-as-Code | 4 | 2 | 4 |
| Modification Speed | 4 | 2 | **5** |
| Language/Framework AI Support | **5** | 3 | **5** |
| **Total** | **34** | **20** | **39** |

### Visual Summary

```
Option C ████████████████████████████████████████ 39/40  Best for AI
Option A █████████████████████████████████████    34/40  Strong second
Option B ████████████████████                     20/40  Weakest for AI
```

---

## 4. The "Add a New Endpoint" Test

**Scenario**: A new team member using Cursor asks: "Add a `GetBoardingPass` endpoint that calls 12go's `GET /booking/{id}/boarding-pass` and returns a boarding pass PDF URL."

### Option A: Trimmed .NET

**Files to touch**: ~5-6

1. `Controllers/PostBookingController.cs` — Add `GetBoardingPass` action method
2. `TravelApi.Contracts/PostBooking/BoardingPassResponse.cs` — New response model
3. `TravelApi.Services/PostBooking/PostBookingService.cs` — Add `GetBoardingPassAsync` method
4. `TravelApi.TwelveGoClient/PostBooking/OneTwoGoPostBookingClient.cs` — Add `GetBoardingPassAsync` HTTP call
5. `TravelApi.TwelveGoClient/Models/BoardingPassResult.cs` — New 12go response model
6. `tests/TravelApi.Tests/PostBooking/GetBoardingPassTests.cs` — Tests

**Discoverability**: Good. AI can find `PostBookingController` by searching for "PostBooking". The three-layer pattern is predictable. But the 4-project split means the AI must know which project each file belongs to.

**AI steps**: Cursor would need to read PostBookingController to understand the pattern, then replicate it. ~10-15 minutes with AI assistance.

### Option B: PHP Native

**Files to touch**: ~4-5 (in our bundle) + understanding of frontend3 internals

1. `Controller/PostBookingController.php` — Add `getBoardingPass` method
2. `Contract/Response/BoardingPassResponse.php` — New response DTO
3. `Service/PostBookingAdapter.php` — Add `getBoardingPass` method
4. `Contract/Transformer/BoardingPassTransformer.php` — Transform 12go response
5. `Config/routes.yaml` — Add route definition

**But first, the AI must answer**: "Does frontend3 have a boarding pass service I should call, or do I call 12go's API directly?" This requires searching through ~968 PHP files in frontend3 to find if `IntegrationApiProxy` has a boarding pass method, or if a new one is needed. The AI must also understand Symfony routing YAML syntax and service wiring.

**Discoverability**: Poor. The bundle is discoverable, but the decision of "call frontend3 service vs. call 12go HTTP directly" requires deep context that AI doesn't have.

**AI steps**: Cursor would need to search frontend3 for boarding pass logic, understand the adapter pattern, then implement. ~30-45 minutes with AI assistance, much of it spent on frontend3 exploration.

### Option C: Thin Gateway

**Files to touch**: ~3-4

1. `Endpoints/PostBooking/GetBoardingPass.cs` — New endpoint (Minimal API style)
2. `Models/Responses/BoardingPassResponse.cs` — Response model
3. `TwelveGoClient/PostBookingClient.cs` — Add `GetBoardingPassAsync` call
4. `tests/PostBooking/GetBoardingPassTests.cs` — Tests

**Discoverability**: Excellent. Every endpoint follows the same pattern. AI reads one existing endpoint (e.g., `GetTicket`), copies the pattern, changes the 12go URL and response model. No ambiguity about "where does this live?" or "which service do I call?"

**AI steps**: Cursor reads `GetTicket` endpoint, copies the pattern, adjusts for boarding pass specifics. ~5-10 minutes with AI assistance.

### Verdict

| Option | Files to Touch | Context Required | AI Time Estimate |
|--------|:--------------:|:----------------:|:----------------:|
| A | 5-6 | Medium (4 projects) | 10-15 min |
| B | 4-5 + frontend3 exploration | High (968-file codebase) | 30-45 min |
| C | 3-4 | Low (one pattern) | 5-10 min |

---

## 5. The "Fix a Pricing Bug" Test

**Scenario**: A client reports that search results for the route BKK→CNX show prices $2.00 higher than expected. The team needs to trace and fix the pricing calculation.

### Option A: Trimmed .NET

**Trace path**:
1. `SearchController.SearchAsync` → `SearchService.SearchAsync` → `_pricingService.ApplyMarkup(trips, clientId, contractCode)`
2. Open `PricingService.cs` — find the markup calculation
3. Check `MarkupService.cs` for the per-client rules
4. Check `Ushba.Revenue.Search.Sdk` — **AI hits a wall**. This is a proprietary NuGet package. AI cannot read its source without decompiling or having docs.

**AI experience**: Cursor traces through the layers confidently until it hits the Ushba SDK boundary. If the bug is in our markup logic, AI fixes it quickly. If the bug is in the SDK, AI cannot help without additional context.

**Fix effort with AI**: 15-30 minutes if bug is in our code. Hours if bug is in SDK.

### Option B: PHP Native

**Trace path**:
1. `SearchController::search` → `SearchAdapter::search` → `PricingService::applyMarkup`
2. Open `PricingService.php` — find the markup calculation
3. The markup logic was ported from .NET's Ushba SDK. It's now inline PHP code.
4. Check `CurrencyRepository::getRates()` for exchange rate source
5. Check `ClientConfigProvider::getMarkupRules()` for per-client config (YAML file)

**AI experience**: The pricing logic is inline and readable — no SDK boundary. But `CurrencyRepository` reads from frontend3's MySQL `fx_rate` table, and the exchange rate may come from a binary-packed source. AI must trace through frontend3's data layer to understand the rate pipeline.

**Fix effort with AI**: 20-40 minutes. Inline pricing logic is readable, but frontend3's data access patterns add complexity.

### Option C: Thin Gateway

**Trace path**:
1. Search endpoint → `PricingEngine.ApplyMarkup(netPrice, currency, clientRules)`
2. Open `PricingEngine.cs` — the entire pricing logic is in one class
3. `loadMarkupRules(clientId, contractCode)` returns `{ percentage, fixedFee }`
4. `convertCurrency(amount, from, to)` uses cached exchange rates
5. `applyMarkup(netPrice, currency, rules)` does the math: `sellPrice = netPrice * (1 + percentage) + fixedFee`

**AI experience**: The entire pricing flow is visible in one file. No SDK boundary, no binary data, no hidden data access. AI can read the formula, check the inputs, write a test, and fix the bug.

**Fix effort with AI**: 5-15 minutes. The pricing logic is a pure function with clear inputs and outputs.

### Verdict

| Option | Trace Depth | External Dependencies | AI Fix Time |
|--------|:-----------:|:---------------------:|:-----------:|
| A | 3 layers + SDK | Ushba SDK (opaque) | 15-30+ min |
| B | 3 layers + frontend3 data | CurrencyRepository (MySQL binary) | 20-40 min |
| C | 1 class | None (inline) | 5-15 min |

---

## 6. AI-First Architecture Recommendations

Regardless of which option is chosen, these patterns should be adopted to maximize AI-assisted development speed.

### 6.1 File Naming Conventions

```
# Endpoints/Controllers — name matches the client-facing operation
SearchController.cs          (or SearchEndpoint.cs for Minimal API)
GetBoardingPassEndpoint.cs   (verb + noun, matches the API operation)

# Services — name matches the business capability
PricingService.cs            (not PricingManager, PricingHelper, PricingUtils)
BookingAdapter.cs            (when wrapping external service)

# Models — name matches the data they carry
SearchResponse.cs            (not SearchResponseDto, SearchResponseModel)
TwelveGoTripResult.cs        (prefix with source for external models)

# Tests — mirror source structure
tests/Search/SearchServiceTests.cs
tests/Pricing/PricingServiceTests.cs
```

**Rule**: A developer (or AI) should be able to guess the file name from the concept. No abbreviations, no clever names, no framework-specific suffixes.

### 6.2 Module Structure

```
src/
├── Endpoints/              # One file per endpoint (or thin controllers)
│   ├── Search/
│   ├── Booking/
│   └── PostBooking/
├── Services/               # Business logic (one file per capability)
│   ├── PricingService.cs
│   ├── SearchService.cs
│   └── BookingService.cs
├── TwelveGoClient/         # All 12go HTTP interaction
│   ├── SearchClient.cs
│   ├── BookingClient.cs
│   └── Models/             # 12go request/response types
├── Contracts/              # Client-facing types
│   ├── Requests/
│   └── Responses/
└── Infrastructure/         # Cross-cutting (Redis, OTel, auth)
```

**Rule**: Max 3 levels of nesting. No file should be more than 2 directory levels from `src/`. AI navigates flat structures faster than deep ones.

### 6.3 Test Patterns

```
tests/
├── Unit/
│   ├── PricingServiceTests.cs       # Pure logic, mocked dependencies
│   └── ContractTransformerTests.cs  # Input/output mapping tests
├── Contract/
│   ├── SearchContractTests.cs       # Golden file response comparison
│   └── BookingContractTests.cs      # Schema validation
├── Integration/
│   └── TwelveGoClientTests.cs       # Real HTTP calls to staging/sandbox
└── Fixtures/
    ├── search_response_golden.json  # Recorded real responses
    └── pricing_rules_test.yaml      # Known markup configurations
```

**Rules for AI-friendly tests**:
1. **Golden file tests**: Record real responses, assert exact match. AI can update golden files when requirements change.
2. **One assertion per test**: Makes failures unambiguous. AI can diagnose a single failed assertion faster than a multi-assertion test.
3. **Builder patterns for test data**: `new SearchQueryBuilder().WithClient("acme").WithRoute("BKK", "CNX").Build()` — AI generates these fluently.
4. **No test infrastructure magic**: Avoid custom base classes, auto-registration, or test discovery conventions. Explicit is better for AI.

### 6.4 Documentation Patterns

**Every project must have**:

1. **`AGENTS.md`** (root) — Entry point for AI agents:
   - What this service does (2-3 sentences)
   - How to add a new endpoint (step-by-step checklist)
   - How to run tests (`dotnet test`)
   - Architecture diagram (Mermaid, renderable in Cursor)
   - The "one pattern" description (e.g., "every endpoint follows Validate → Transform → Call → Transform → Price → Return")

2. **`.cursorrules`** (root) — Coding conventions:
   - "All endpoints follow the transform pattern"
   - "Pricing always goes through PricingService"
   - "No MediatR, no DDD, no CQRS"
   - "Tests use golden files for response comparison"
   - "Max file size: 200 lines. Split if larger."

3. **`docs/endpoint-map.md`** — Table mapping client endpoints to files:
   ```
   | Endpoint | Controller/Endpoint File | Service | 12go Call |
   | GET /itineraries | SearchEndpoint.cs | SearchService | GET /search/{from}p/{to}p/{date} |
   ```

4. **Inline `// WHY:` comments** for non-obvious decisions:
   ```csharp
   // WHY: 12go returns prices in cents (integer) but clients expect decimal.
   // The conversion happens here, not in the mapper, to keep mapper pure.
   var priceDecimal = trip.PriceCents / 100m;
   ```

### 6.5 Type Patterns

**Do**:
- Use strongly-typed IDs: `record BookingId(string Value)` instead of raw `string`
- Use enums for known value sets: `BookingStatus { Reserved, Confirmed, Cancelled }` instead of `string`
- Use `record` types for immutable data transfer: `record SearchResponse(List<Itinerary> Itineraries, bool Recheck)`
- Use `Result<T, Error>` or typed exceptions instead of stringly-typed error handling

**Don't**:
- Use `Dictionary<string, object>` for structured data — AI cannot reason about the keys
- Use `dynamic` or `object` — AI loses all type inference
- Use `string` for IDs, currencies, status codes, or anything with a finite set of valid values
- Use inheritance hierarchies deeper than 2 levels — AI loses track of which virtual method is called

---

## 7. Language Comparison for AI Tools

### 7.1 Training Data Quality/Quantity

| Language | Training Data Volume | Quality Assessment |
|----------|:-------------------:|-------------------|
| **C# / .NET** | Very High | Massive GitHub corpus. ASP.NET is one of the most-used web frameworks. Microsoft's own documentation is extensive and up-to-date. Stack Overflow coverage is excellent. |
| **PHP / Symfony** | High (PHP), Medium (Symfony) | PHP has enormous training data due to WordPress/Laravel dominance, but Symfony-specific patterns are less represented. Frontend3's custom patterns have zero training data. |
| **Go** | High | Excellent for proxy/gateway patterns specifically. Go's simplicity means AI-generated code is often correct. But team has zero Go experience. |
| **TypeScript/Node.js** | Very High | Largest training corpus of any language. But runtime type safety is weaker than C#. |

### 7.2 Type System Strength

| Language | Static Types | Nullable Safety | AI Benefit |
|----------|:----------:|:--------------:|-----------|
| **C#** | Full | Nullable reference types (compile-time) | AI can use types to infer valid operations. Compiler catches AI mistakes. |
| **PHP 8.3** | Partial (type hints) | No compile-time null safety | AI can use type hints but misses nullable bugs. PHPStan helps but is opt-in. |
| **Go** | Full | No null (zero values instead) | Strong, but different model (interfaces vs classes). |
| **TypeScript** | Full (with strict) | Strict null checks | Good, but `any` escape hatch is tempting. |

### 7.3 IDE Integration (Cursor, Copilot)

| Language | Cursor Support | Copilot Quality | AI Refactoring Safety |
|----------|:-------------:|:--------------:|:--------------------:|
| **C#** | Excellent (via OmniSharp/Roslyn) | Excellent | Highest. Roslyn provides accurate type information to AI. |
| **PHP** | Good (via Intelephense) | Good | Medium. Dynamic dispatch and magic methods confuse AI. |
| **Go** | Excellent (via gopls) | Good | High. Simple language means fewer AI mistakes. |
| **TypeScript** | Excellent (native) | Excellent | High (with strict mode). |

### 7.4 Community Example Availability

| Pattern | C# / .NET | PHP / Symfony | Go | TypeScript |
|---------|:---------:|:------------:|:--:|:----------:|
| REST API proxy/gateway | Many | Some | Many | Many |
| HTTP client with retry | Polly (very common) | Guzzle + custom | Standard lib | Axios + custom |
| Redis caching | StackExchange.Redis (common) | Predis/phpredis | go-redis | ioredis |
| OTel instrumentation | First-class SDK | Community SDK | First-class SDK | Community SDK |
| Contract testing (Pact) | Good support | Good support | Good support | Good support |

### 7.5 Verdict

For this specific use case (HTTP translation proxy with pricing), **C# / .NET** and **TypeScript** are tied for best AI tool support. C# wins on type safety; TypeScript wins on JSON ergonomics.

**PHP** is viable but AI tools produce lower-quality PHP code on average, especially for Symfony-specific patterns. The gap is narrowing but still measurable.

**Go** would be excellent for a pure proxy but requires rewriting all 12go client code, which negates its advantage for this specific project.

---

## 8. Overall Recommendation

### For AI-First Development: **Option C (Thin Gateway)**

Option C scores 39/40 on AI-friendliness criteria. Its architecture is the simplest, most predictable, and most testable. An AI agent can understand the entire system, add new endpoints, trace bugs, and write tests with minimal context loading.

The key advantages for daily AI-assisted development:

1. **"Add a retry to the search endpoint"** — AI opens one file (`SearchEndpoint.cs` or `SearchClient.cs`), adds Polly retry configuration. Done in 3 minutes. No need to understand 4 projects, Kafka, or DynamoDB.

2. **"Why is this booking failing?"** — AI traces one request through one service. Request → Transform → 12go call → Transform → Response. No inter-service calls, no event pipelines, no cached state in DynamoDB to check.

3. **"Add observability to the cancel flow"** — AI adds a span to one method. No distributed tracing across multiple services needed.

### If Option C's limitations are unacceptable: **Option A (Trimmed .NET)**

Option A is the safe choice that still scores well (34/40). It handles edge cases better (Kafka for analytics, Redis for proper session state) and has a clear evolution path. The AI-friendliness gap vs Option C (5 points) comes from architectural complexity, not language or tooling.

### Avoid Option B for AI-first development

Option B's score (20/40) reflects a fundamental problem: embedding code inside a large legacy application destroys the navigability, predictability, and isolation that AI tools need. If PHP is mandated by organizational constraints, use the **PHP Thin Proxy sub-variant (Option B-a)** instead of the internal bundle. A standalone PHP app calling frontend3 over HTTP would score ~28-30/40 — much closer to Option A.

### The Practical Test

> A new team member using Cursor asks: "add a retry to the search endpoint"

| Option | AI's task | Confidence |
|--------|-----------|:----------:|
| **C** | Open `SearchClient.cs`, add Polly retry to the `SearchAsync` HTTP call. One file, one change. | Very High |
| **A** | Open `TwelveGoClient/Search/OneTwoGoSearchClient.cs`, add Polly retry. Or check if Polly is already configured in `Program.cs` via `AddHttpClient`. Two files to check. | High |
| **B** | Search frontend3 for where search HTTP calls are made. Discover they're in-process, not HTTP. Realize "retry" means retrying the MySQL query or the `SearchService::newSearch()` call. Unclear where to add retry logic in a Symfony service. | Low |

Option C makes AI-assisted development feel effortless. That's the goal.
