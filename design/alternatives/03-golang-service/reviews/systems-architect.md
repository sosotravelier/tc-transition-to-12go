# Systems Architect Review: Go Service

## Overall Assessment

This design makes a compelling technical argument for Go as a proxy runtime: single binary, sub-millisecond GC, goroutine concurrency, and 10MB Docker images. These are real advantages, not marketing. The architecture itself is clean — flat project structure, explicit dependency wiring, no framework magic. However, the design oversells Go's "simplicity" advantage over .NET while underweighting the team competency gap. For a proxy/translation layer, Go and .NET produce nearly identical architectures — the differentiator is team velocity, not language capability.

## Strengths

- **Project structure is appropriately flat.** ~25 Go files with a clear `handler → service → twelvegoapi → transform` flow. No `pkg/` directory, no framework abstractions, no interface proliferation. The `internal/` convention enforces encapsulation without DI containers. This matches the problem's complexity — a proxy doesn't need architectural layers.
- **Explicit error handling is actually a feature here.** The design correctly reframes Go's `if err != nil` verbosity as a strength for a proxy service where every 12go failure must be handled explicitly. In C# with try/catch, it's easy to accidentally swallow a `TaskCanceledException` or mishandle a transient `HttpRequestException`. Go forces you to handle every error at the call site.
- **Operational characteristics are genuinely superior.** <100ms startup, 20-30MB RSS, 10MB Docker image. For a service that may need rolling restarts during a canary rollout, these numbers matter — no warm-up period means no dropped requests during deployment.
- **Context propagation design is clean.** Using `context.Context` for timeout propagation, trace injection, and correlation ID forwarding is idiomatic Go and results in every 12go call being automatically cancellable when the client disconnects.

## Weaknesses

- **The "strategic alignment with 12go" argument is speculative.** The system context says 12go is "considering Go, but nothing decided." Building in Go on the basis of a possible future direction is risky. If 12go decides against Go (or takes 2+ years to adopt it), the team has learned a language with no strategic payoff. The design acknowledges this but underweights it — Future Extensibility at 5/5 assumes Go adoption that hasn't been confirmed.
- **The ramp-up estimate is optimistic.** Two weeks to Go productivity is achievable for syntax and basic patterns. But Go has deep idioms (channel patterns, context cancellation, interface-based testing without generics, error wrapping with `%w`) that take months to internalize. The team will write "C# in Go" for the first 4-6 weeks, which may produce code that works but isn't idiomatic or maintainable.
- **JSON manipulation in Go is genuinely painful for this use case.** The booking schema parser requires iterating over arbitrary JSON keys and matching patterns — exactly the kind of dynamic data handling where Go's strict type system creates friction. `map[string]interface{}` with type assertions is verbose and error-prone compared to TypeScript's native object handling or C#'s `JsonElement` API. The design understates this.
- **Circuit breaker configuration is aggressive.** `ConsecutiveFailures > 10` with a 10-second timeout means the circuit opens after 10 sequential failures but resets after only 10 seconds. For a proxy where the downstream (12go) may have multi-minute outages, this configuration will flap. Needs tuning guidance.

## Domain Modeling Critique

Correctly minimal. The `model/` package contains only client-facing types. The `twelvegoapi/` package contains only 12go types. The `transform/` package maps between them. No domain entities, no aggregates, no repositories. This is the right answer for a translation layer.

## Architecture Pattern Critique

The handler → service → client pattern with explicit dependency injection in `main.go` is clean and appropriate. No DI container, no interface registration, no service locator — just constructor functions called at startup. The one concern is the service layer: for endpoints that make a single 12go call with a single transformation, the service layer adds an indirection that handlers could do directly. The design should clarify when a service adds value (multi-call orchestration) vs. when it's ceremony (1:1 proxy).

## Error Handling Assessment

The `TwelveGoError` struct with `ErrorCategory` classification is well-designed. The separation of error parsing (in `twelvegoapi/errors.go`) from error-to-HTTP-response mapping (in handlers via `respondServiceError`) is correct. However, the design doesn't show how errors from multi-step orchestrations are handled — if step 2 of 3 in `GetItinerary` fails, should the cart created in step 1 be cleaned up? (Probably not — 12go carts expire — but this should be documented.)

## Recommendations

1. **Reduce Future Extensibility from 5 to 3.** Until 12go commits to Go, the alignment argument is aspirational. Score what's known, not what's hoped.
2. **Invest in a Go-idiomatic booking schema parser.** Rather than `map[string]interface{}`, consider using `json.RawMessage` with targeted unmarshal patterns. This is where Go expertise matters most — have a Go-experienced reviewer (even external) validate this component.
3. **Add explicit guidance on the service layer's purpose.** Define a rule: "If an endpoint makes 1 call to 12go, the handler calls the client directly. If it makes 2+ calls, it goes through a service." This prevents the service layer from becoming an unnecessary pass-through.
4. **Get a signal from 12go on Go adoption before committing.** The entire strategic justification depends on this. A non-committal "considering" is not a strong enough signal to justify a language change.

## Score Adjustments

| Criterion | Self-Score | Suggested | Justification |
|-----------|-----------|-----------|---------------|
| Future Extensibility | 5 | 3 | 12go hasn't committed to Go; speculative alignment shouldn't score as if confirmed |
| Development Velocity | 3 | 2 | First 4-6 weeks will be significantly slower than estimated due to Go idiom internalization |
| AI-Friendliness | 4 | 4 | Fair — Go's AI generation is good but error handling patterns have subtleties |
| **Revised Total** | **112** | **~106** | Realistic given unconfirmed strategic alignment |
