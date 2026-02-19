# AI-Augmented Development Review: Trimmed .NET Service

## Overall AI-Friendliness (Score: 5)

This is the safest choice for a team already embedded in Cursor + Claude workflows. .NET 8 Minimal API patterns are extremely well-represented in AI training data, and the vertical slice structure produces small, self-contained files that fit perfectly within AI context windows. The team ships at full velocity from day one — no ramp-up tax.

## Code Generation Assessment

AI tools generate correct .NET 8 Minimal API handlers, `HttpClient` wrappers, and middleware on the first attempt with high reliability. The patterns chosen — static endpoint classes, typed `HttpClient`, `System.Text.Json` with custom converters — are bread-and-butter .NET that Cursor and Copilot know deeply. The one area where AI will struggle is the `BookingSchemaParser` and `ReserveDataConverter` — these involve domain-specific wildcard pattern matching and bracket-notation serialization that require human porting and verification. AI can scaffold the structure, but the 20+ field patterns need careful human review against recorded production responses.

## Test Generation Assessment

AI excels at generating xUnit + `WebApplicationFactory` integration tests and WireMock-based 12go fakes. The vertical slice structure means test generation is straightforward: give AI the endpoint code and recorded JSON fixtures, and it produces meaningful test cases. Table-driven test patterns for the booking schema parser can be AI-generated from example inputs. The team's existing xUnit fluency means they can immediately evaluate and refine AI-generated tests — no translation overhead.

## Refactoring and Maintenance

This is where the design truly shines for AI workflows. Each endpoint is one file (~50-150 lines), mappers are pure functions, and there is no deep inheritance or framework magic. Cursor's multi-file edit capabilities work well because the dependency graph is flat: endpoint → client → 12go. Renaming a field, changing a mapping rule, or adding a new endpoint is a localized change that AI can execute confidently. The 2-project structure (API + Tests) means AI agents can navigate the entire codebase without context window pressure.

## Agentic Coding Suitability

Excellent. The ~6K LOC codebase with ~25 files is well within what Claude Code or Cursor's agentic mode can reason about holistically. File sizes are manageable (50-300 lines each). The flat project structure means no deep directory traversal. An autonomous agent could implement a new endpoint — route registration, handler, mapper, test — with minimal human guidance. The one caveat: the `TwelveGoApiClient` is a single file covering all 11 endpoints, which could grow to 500+ lines. Consider splitting by domain (search, booking, post-booking) if it becomes unwieldy for AI context.

## Specific Concerns

- The `System.Text.Json` custom converters for `ReserveData` and `BookingSchema` are the least AI-friendly parts. These require domain knowledge that AI cannot infer — the team must port and validate them manually.
- C#'s verbosity (nullable annotations, `async Task<IResult>` signatures, DI registration) creates more boilerplate than TypeScript/Go equivalents. AI handles this boilerplate well, but it still inflates file sizes.
- Source-generated `LoggerMessage` patterns are well-known to AI but add ceremony that simpler languages avoid.

## Recommendations

- Keep files under 200 lines to maintain AI context efficiency.
- Record production 12go JSON responses as test fixtures — these become the ground truth for AI-generated contract tests.
- Use Cursor's "port this C# to the new project" workflow for the SI client code — the types and patterns translate directly.

## Score Adjustments

The design's self-assessed AI-Friendliness score of 5 is accurate. The combination of team expertise + well-known patterns + simple structure makes this the highest-confidence choice for AI-augmented velocity. No adjustment needed. For a 3-person team using Cursor daily, this alternative has the lowest risk of AI-related friction and the fastest path to a working MVP.
