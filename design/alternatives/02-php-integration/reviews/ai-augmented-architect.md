# AI-Augmented Development Review: PHP Integration

## Overall AI-Friendliness (Score: 3)

PHP/Symfony is well-represented in AI training data, and Cursor generates correct controllers, DTOs, and PHPUnit tests reliably. However, the real AI challenge is not the language — it's the f3 codebase. AI tools cannot reason about an unfamiliar proprietary monolith, and that's exactly where this design's value proposition lives. The gap between "AI generates PHP" and "AI generates correct f3 integration code" is the critical risk.

## Code Generation Assessment

For the B2B module itself (controllers, mappers, DTOs, request serializers), AI generation quality is high. Symfony 6.4 patterns — attribute-based routing, constructor-promoted services, readonly classes — are well-known to Claude and Copilot. Porting the booking schema mapper from C# to PHP is a direct translation task where AI performs well. The bracket-notation `ReserveRequestSerializer` translates almost line-for-line.

Where AI falls short: generating code that correctly calls f3's internal services. These are proprietary classes with undocumented interfaces, implicit dependencies, and framework-specific conventions. The AI can generate the PHP syntax, but it cannot know that `SearchService::findTrips()` expects a province ID format, or that `CartService` requires a specific session context. This gap can only be bridged by the 12go veteran embedded in the team — AI is a syntax accelerator here, not a knowledge source.

## Test Generation Assessment

PHPUnit test generation works well for the isolated B2B module: mapper unit tests, controller functional tests with Symfony's test client, and request/response validation tests. AI can generate these from recorded JSON fixtures with the same reliability as xUnit tests. The challenge is integration testing against f3's services — setting up the test environment requires f3-specific database seeding, service container configuration, and potentially running the full Symfony kernel. This is hard for AI to scaffold without explicit examples from the existing f3 test suite.

## Refactoring and Maintenance

The B2B module's internal structure is clean and AI-refactorable: controllers delegate to handlers, handlers call services, mappers are pure functions. Cursor handles PHP refactoring (rename, extract method, change signatures) competently. The risk is coupling to f3 internals — if an f3 service changes its interface, the B2B module breaks, and AI cannot diagnose why without understanding f3's codebase. This creates a debugging bottleneck that AI cannot resolve autonomously.

## Agentic Coding Suitability

Poor for the integration layer, adequate for the module itself. An autonomous AI agent could implement a new B2B endpoint that calls the 12go HTTP API (Phase 1 proxy mode). It cannot implement an endpoint that calls f3's internal services without extensive context about f3's architecture. The monolith coupling fundamentally limits how much an AI agent can do independently. File navigation is also harder — the B2B module lives inside a large repository with thousands of existing files, making it harder for agents to find relevant code.

## Specific Concerns

- The team has zero PHP debugging intuition. When AI-generated code fails at runtime, the team cannot fall back on instinct. PHP error messages (especially Symfony's DI container errors) are notoriously cryptic for newcomers.
- Opcache, PHP-FPM worker lifecycle, and memory management are PHP-specific operational concerns that AI tools rarely surface during code generation but can cause production issues.
- The Phase 1 HTTP proxy approach is essentially a worse version of Alternative 1 (Trimmed .NET) — same pattern, unfamiliar language.

## Recommendations

- If this alternative is chosen, stay in Phase 1 (HTTP proxy) as long as possible. This is the AI-friendly mode where the team writes standard PHP that calls 12go's REST API.
- Invest heavily in pair programming sessions with the 12go veteran and record them — this creates the contextual knowledge that AI lacks.
- Consider providing f3's service interfaces as context to Cursor via `.cursorrules` or pinned files to improve AI's ability to generate integration code.

## Score Adjustments

The design's self-assessed AI-Friendliness of 4 is generous. I'd adjust to **3**. Pure PHP/Symfony: 4-5. PHP integrated into an unfamiliar proprietary monolith with a team that has no PHP experience: 3 at best. The AI-augmented velocity of a 3-person .NET team writing PHP inside f3 is roughly 40-50% of their .NET velocity for the first 6-8 weeks, even with heavy Cursor usage.
