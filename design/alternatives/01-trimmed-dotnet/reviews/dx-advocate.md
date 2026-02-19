# Developer Experience Review: Trimmed .NET Service

## Overall DX Assessment

This is the stable option — and I mean that as a genuine compliment. The team wakes up, opens Rider or VS, and writes code in the language they are experts in. During a transition where many factors are changing — org structure, strategic direction, system architecture — the codebase itself being familiar is a profound stabilizing force. The DX is excellent precisely because it maintains continuity in a period of change.

## Daily Workflow

A developer pulls, runs `dotnet build` (under 30 seconds for ~6K LOC), and is immediately productive. The feedback loop is tight: change a mapper, run the test, see the result in seconds. `dotnet watch` gives live reload during development. Local debugging means `docker compose up` to get a fake 12go server via WireMock, then F5 in Rider. This is the workflow the team has done thousands of times. There is zero friction between intent and execution — the developer thinks about the business problem, not the toolchain.

## Code Writing Experience

Vertical slices with static endpoint handlers are about as clean as .NET gets. Each endpoint is 50-150 lines, self-contained, readable top to bottom. No MediatR pipelines, no deep DI graphs, no `IAbstractFactoryProvider` nonsense. The patterns (typed HttpClient, middleware, minimal API) are the most well-documented in the .NET ecosystem, meaning AI generates correct code on the first try. The ratio of business logic to boilerplate is excellent — most code is mappers and HTTP calls, not framework ceremony. Writing code here will feel like relief after the 342-project monstrosity.

## Debugging Experience

This is where .NET truly shines. Rider's debugger is world-class. Set a breakpoint in `SearchEndpoint.Handle`, step through the `TwelveGoApiClient` call, inspect the response, step into the mapper. The call stack is shallow and readable. Exception messages from `System.Text.Json` are detailed. Reproducing production issues locally is straightforward — capture the 12go response JSON, feed it to a test, step through. No guesswork.

## Testing Experience

`WebApplicationFactory` + WireMock is the gold standard for integration testing HTTP services in .NET. Tests run fast (seconds for the full suite at ~6K LOC). Running a single test is one click in Rider. Mocking the 12go client for unit tests is standard `IHttpClientFactory` setup. The booking schema parser will need thorough fixture-based tests, but the test infrastructure is something the team has built dozens of times.

## Onboarding Assessment

A new .NET developer reads `Program.cs`, understands the middleware pipeline, picks a feature folder, and starts contributing. Time to first meaningful PR: 1-2 days. For a 12go PHP developer, the barrier is higher — they'd need .NET fundamentals. But the codebase is small enough (25-30 files) that the structure is self-documenting.

## Language/Framework Learning Curve

Zero. This is .NET 8 minimal API with standard libraries. If the team has used minimal APIs before (likely), there is literally nothing new to learn. If they've only used MVC controllers, the shift is trivial — Minimal API is simpler, not harder.

## Joy Factor

There is a quiet satisfaction in taking a 342-project catastrophe and replacing it with 2 `.csproj` files and 6K lines of clean code. Developers will feel pride in the dramatic simplification. They won't feel the thrill of learning something new, but they will feel competent, productive, and in control. During a turbulent transition, "in control" might be exactly the feeling that keeps people from updating their LinkedIn.

The honest counter: some developers might feel like they're "just doing more .NET" when the world is moving on. If the team is curious about new technologies, this option doesn't feed that curiosity. It's pragmatic, not exciting.

## DX Risks

- **Stagnation perception**: developers may feel this choice signals the org isn't investing in their growth.
- **Future orphan**: if 12go goes Go/PHP, this becomes the foreign service nobody wants to touch. The team that built it may not be around to maintain it.

## Recommendations

- Let the team own the simplification narrative — "we killed 340 projects" is a story worth telling.
- Invest the time saved (vs other options) in thorough contract testing and documentation.
- Be transparent that this may be a stepping stone, not a destination.

## Score Adjustments

The design's self-assessment is fair. I'd nudge **Development Velocity** from 5 to 5 (confirmed) and note that the real DX score of this option comes from the compounding effect of zero learning curve + excellent tooling + team confidence. No criteria individually capture how much that combination matters when morale is fragile.
