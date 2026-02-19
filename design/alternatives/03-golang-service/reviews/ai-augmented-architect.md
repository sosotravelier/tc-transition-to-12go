# AI-Augmented Development Review: Go Service

## Overall AI-Friendliness (Score: 4)

Go's simplicity is a double-edged sword for AI-augmented development. On one hand, the language's small surface area means AI tools generate idiomatic, correct code with high reliability — there are fewer ways to write a Go HTTP handler wrong. On the other hand, Go's explicit error handling and lack of generics-heavy abstractions produce more lines of code per feature, giving AI more boilerplate to generate but also more opportunities for repetitive `if err != nil` patterns that feel tedious even when AI writes them.

## Code Generation Assessment

Claude and Cursor generate correct Go HTTP handlers, struct definitions, and JSON marshaling code on the first attempt approximately 80-85% of the time — slightly below TypeScript (~92%) but above average. Go's strength is that AI-generated code rarely has subtle bugs: the type system catches most issues at compile time, and the explicit error handling means failure paths are always visible. The `chi` router patterns, `slog` logging, and `net/http` middleware are all well-represented in training data.

The booking schema transformer is where AI needs the most human oversight. Go's static type system makes dynamic field extraction (iterating over `map[string]interface{}` keys with pattern matching) more verbose and error-prone than in TypeScript or PHP. AI will generate the scaffolding correctly but may get the type assertions wrong — `value.(map[string]interface{})` chains are a common source of runtime panics that AI doesn't always anticipate.

## Test Generation Assessment

Go's table-driven test idiom is one of the best patterns for AI-generated tests. Give Claude a function signature and example inputs, and it produces comprehensive `[]struct{ name, input, expected }` test tables with high accuracy. The `httptest` package for handler testing and `testify` for assertions are well-known to AI tools. Test generation is a genuine strength of the Go + AI combination — arguably better than .NET's xUnit pattern because the table-driven structure is more mechanical and less framework-dependent.

## Refactoring and Maintenance

Go's lack of inheritance, minimal abstraction layers, and enforced `gofmt` formatting make AI-assisted refactoring straightforward. Every function is explicit about its dependencies (passed as arguments), so Cursor can trace data flow through the codebase without framework magic. The ~25-file structure means the entire project fits in an AI agent's context window comfortably.

The risk is "C# in Go" — .NET developers who haven't internalized Go idioms may write patterns that AI tools then propagate (e.g., creating unnecessary interfaces, building DI-like wrappers, or using `panic/recover` as exception handling). Code review discipline is essential during the first 4 weeks.

## Agentic Coding Suitability

Strong. The flat project structure (~25 files), single `go.mod`, and explicit dependency wiring in `main.go` make this an excellent target for autonomous AI agents. Claude Code could implement a new endpoint (handler + service + transformer + test) with minimal guidance. Go's compilation speed (<5 seconds) enables rapid agent feedback loops: edit → compile → test → fix. No waiting for NuGet restore or MSBuild. The `internal/` package convention also helps agents understand scope boundaries.

## Specific Concerns

- The 2-week ramp-up is realistic but compresses the AI learning advantage. During weeks 1-2, AI generates Go code that the team cannot fully evaluate — they're learning the idioms at the same time. This creates a quality risk that doesn't exist with the .NET alternative.
- Go's error handling verbosity means approximately 30% of the codebase is `if err != nil` blocks. AI handles this dutifully, but it inflates the LOC count and can obscure business logic during code review.
- The `encoding/json` package's behavior with `interface{}` and custom marshal/unmarshal methods has subtleties that trip up both AI and humans. The `BookingSchemaResponse` with its dynamic keys requires careful manual implementation.

## Recommendations

- Use AI to generate the boilerplate (handlers, routes, error handling) but manually implement and review the transformer layer — this is where domain logic lives and where Go's type system provides less safety than TypeScript's dynamic objects.
- Establish Go code review guidelines before development starts. AI-generated Go that looks correct to a C# developer may be non-idiomatic.
- Consider `go vet` and `golangci-lint` in CI from day one — these catch AI-generated anti-patterns that compile but aren't idiomatic.

## Score Adjustments

The design's self-assessed AI-Friendliness of 4 is accurate. Go is well-supported by AI tools, the project structure is agent-friendly, and compilation speed enables fast feedback loops. The deduction from 5 is justified: Go's verbose error handling and weaker dynamic typing (compared to TS) make certain transformations harder for AI to get right, and the team's zero Go experience limits their ability to evaluate AI output during the critical first weeks.
