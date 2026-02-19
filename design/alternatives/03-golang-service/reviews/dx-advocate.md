# Developer Experience Review: Go Service

## Overall DX Assessment

Go is the "eat your vegetables" option — genuinely good for you in the long run, but the first few bites are hard to swallow. The resulting codebase would be beautiful: 25 files, single binary, sub-millisecond GC, explicit everything. But getting there requires the team to unlearn 12 years of C# idioms while shipping production code under a deadline. The DX during building is rough. The DX after building is outstanding. The question is whether the team can tolerate the valley of despair without losing people.

## Daily Workflow

After initial setup, the daily workflow is genuinely pleasant. `go build` compiles the entire project in under 5 seconds. `go test ./...` runs the full suite in seconds. No NuGet restore, no MSBuild, no `.sln` files. The feedback loop is the fastest of any compiled language. Local development is `go run ./cmd/server` — binary starts in under 100ms, instant restart on changes with tools like `air`. Docker image is 10MB. Everything is fast, minimal, and predictable.

But during the ramp-up (weeks 1-3), the workflow is: write code, get compiler errors you don't understand, Google "go unused variable error," ask AI to fix it, repeat. Go's compiler is strict in ways that will infuriate C# developers (unused imports are errors, not warnings). The feedback loop is fast, but the developer is slow.

## Code Writing Experience

Go code for an HTTP proxy is remarkably clean. Handlers are plain functions. No DI container magic, no attribute decorators, no interface soup. The `if err != nil` pattern is verbose but brutally honest — every error path is visible. After the initial shock, many developers appreciate this explicitness.

The pain points: no LINQ equivalents (everything is `for` loops), no generics for most use cases (improving but still limited), and the error handling verbosity is real. Writing `if err != nil { return nil, fmt.Errorf("get trip details: %w", err) }` after every function call feels like punishment coming from C#'s try/catch. AI handles the boilerplate well, but reviewing AI-generated Go requires understanding Go idioms the team doesn't have yet.

The booking schema mapper — iterating over dynamic JSON keys and pattern-matching — is actually awkward in Go. `map[string]interface{}` and type assertions are clunky compared to C#'s `JsonElement` or TypeScript's native objects.

## Debugging Experience

Go's Delve debugger works in VS Code and GoLand, but it's a step down from Rider's .NET debugger. The experience is adequate but not delightful. The bigger issue: for the first month, developers won't have the intuition to know *where* to set breakpoints in Go code. The implicit interface pattern and goroutine-based concurrency create call stacks that look unfamiliar. Most debugging will be log-based (`slog` output), which is fine for a proxy service but feels primitive to developers spoiled by Rider.

## Testing Experience

Go's built-in testing is excellent. `httptest` for HTTP handlers, table-driven tests for mappers — these patterns are clean and fast. No test framework to configure, no test runner to install. But writing the first table-driven test when you've only ever written `[Fact]` and `[Theory]` xUnit tests requires a mental model shift. AI helps generate test scaffolding, but understanding test failures requires Go knowledge.

## Onboarding Assessment

For a Go-experienced developer joining later: superb. 25 files, single binary, explicit everything — they could contribute on day one. For the current .NET team: 2-4 weeks before meaningful contributions. For a 12go PHP developer: Go is likely more accessible than .NET, especially if 12go adopts Go. This option has the best *future* onboarding story, at the cost of the worst *present* onboarding experience.

## Language/Framework Learning Curve

The curve is real and the mental shifts are significant. Error-handling-as-values is the biggest one — it changes how you think about control flow. Implicit interfaces (no `implements` keyword) feel unsafe at first. The lack of a DI container means wiring dependencies manually in `main.go`, which feels wrong to .NET developers but is idiomatic Go. Context propagation replaces `CancellationToken` but works differently. Goroutines replace `async/await` but the mental model is distinct.

AI bridges approximately 60-70% of the gap. Cursor generates correct Go for HTTP handlers and tests. It struggles more with Go-specific idioms like error wrapping, context usage, and interface design.

## Joy Factor

This depends entirely on the team's attitude toward learning. If even one developer is excited about Go, this option can energize the whole team — Go developers tend to love Go. The language has a devoted community and growing market demand. Learning Go is unambiguously a career investment, especially in the cloud-native space.

But if the team sees it as a stack change introduced during a high-pressure transition, the experience will be challenging. You can't force engagement. The 2-week ramp-up where nothing compiles and everything feels alien is a real risk to team focus when people are already navigating significant organizational change.

The endgame, though — owning a 3-5K LOC Go service with a 10MB binary that starts in 100ms? That's something to be genuinely proud of.

## DX Risks

- **Weeks 1-3 are brutal**: the team is slow, frustrated, and producing code they can't fully review. This is the highest-risk period for someone deciding to leave.
- **"C# in Go" syndrome**: developers write Go that looks like C# (huge structs, error swallowing, channel misuse). Code reviews become contentious.
- **12go may not actually adopt Go**: the strategic alignment argument is speculative. If it doesn't materialize, the team learned Go for a proxy service that could have been .NET.

## Recommendations

- Gauge genuine team interest before committing. An informal poll or a 2-day Go spike would reveal whether this is "exciting challenge" or "unwanted burden."
- If chosen, pair programming during weeks 1-2 is non-negotiable — isolation amplifies frustration.
- Accept that the first version will be "C# in Go" and plan a refactoring pass in week 5-6 for idiomatic improvements.
- Have an explicit fallback plan: "if Go isn't working after 2 weeks, we pivot to .NET."

## Score Adjustments

The self-assessment is honest. Team Competency Match at 2 is accurate. I'd push Development Velocity down to 2 for the first month (it's scored 3, but the ramp-up dip is deeper than acknowledged). The Simplicity score of 5 is earned — the resulting codebase genuinely is simpler than any other option. The tension between "best end-state DX" and "worst transition DX" is the core trade-off that no scoring system captures well.
