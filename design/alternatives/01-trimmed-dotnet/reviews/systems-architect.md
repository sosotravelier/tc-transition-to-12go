# Systems Architect Review: Trimmed .NET Service

## Overall Assessment

This is the most architecturally honest design of the five. It correctly identifies the problem as a proxy/translation layer and refuses to over-engineer it. The vertical slice organization, stateless data strategy, and single-service topology are all the right calls for a system whose entire job is "HTTP in, transform, HTTP out." This is the design I'd ship if the team needs to move fast and own the result with confidence.

## Strengths

- **Right-sized architecture.** No mediator, no CQRS, no DI framework beyond the built-in container, no separate library projects. The design resists the gravitational pull of enterprise .NET patterns that inflated the current 342-project system. Static endpoint classes with direct `TwelveGoApiClient` calls is exactly the right level of indirection for this problem.
- **Stateless by default.** Eliminating all local databases is a bold, correct call. Every piece of state currently cached locally exists authoritatively in 12go's MariaDB. The design properly identifies when to re-introduce storage (audit trail, outbox) — and importantly, defers it until a concrete need arises.
- **Honest risk identification.** The self-assessment correctly flags the booking schema parser and reserve serializer as the high-risk components and proposes concrete mitigations (recorded response diffing, contract tests). No hand-waving.
- **Operational minimalism.** One Docker image, Datadog auto-instrumentation via `dd-trace-dotnet`, zero-code tracing. This respects DevOps capacity during transition.

## Weaknesses

- **Self-assessment scores are inflated.** Multiple medium-weight criteria scored 5/5 (Maintainability, Development Velocity, Simplicity, AI-Friendliness, Operational Complexity). A 58/60 on medium-weight suggests near-perfection, which no design achieves. Maintainability should account for what happens when the team turns over — a new .NET developer still needs to understand the 12go API quirks, the dynamic schema parsing, and the bracket-notation serialization. Score 4, not 5.
- **Notification transformer reliability is underspecified.** In-memory retry with "notifications lost on restart" is acknowledged but underweighted. If a webhook fails during a deploy (rolling restart), booking status notifications are silently dropped. For an MVP this is defensible, but the design should estimate the cost to add the outbox pattern sooner.
- **No discussion of connection pool sizing or HTTP client tuning.** For a service making 1-3 HTTP calls per inbound request at scale, the `SocketsHttpHandler` pool configuration and Polly timeout interaction deserve explicit attention, especially under 12go's variable response times (search rechecks up to 60 seconds).

## Domain Modeling Critique

Correct — there is essentially no domain model, because there is essentially no domain. The service transforms between two fixed API contracts. Introducing aggregates, entities, or bounded contexts here would be textbook over-engineering. The "domain" is the transformation rules, and those live properly in mapper classes.

## Architecture Pattern Critique

Vertical slices without a mediator is the right pattern. Each endpoint is 50-150 lines with a clear input→transform→output flow. The decision to avoid MediatR is particularly good — pipeline behaviors would be empty for a proxy, and the indirection adds cognitive overhead for no benefit. The one area where a shared concern could emerge is per-client configuration resolution (API key, markup, webhook URL), which the design handles cleanly via middleware/options.

## Error Handling Assessment

The exception hierarchy is well-structured: flat, no deep inheritance, status code baked into each exception type. The flow from `TwelveGoErrorHandler` through middleware to client response is explicit and testable. The distinction between transient (502) and pass-through (4xx mapping) errors is correct. One concern: the retry policy retries on all 5xx, but 12go might return 503 for intentional rate limiting — the design should distinguish between retryable and non-retryable 5xx.

## Recommendations

1. **Reduce self-assessment inflation.** Maintainability: 4, Development Velocity: 4, AI-Friendliness: 4 are more realistic. The overall score would be ~120, still the strongest.
2. **Specify the notification outbox trigger.** Define a metric threshold (e.g., >1% delivery failure rate) that triggers the PostgreSQL outbox addition.
3. **Add explicit HTTP client pool sizing guidance.** Document expected concurrent connections to 12go and configure `SocketsHttpHandler` accordingly.
4. **Consider a circuit breaker on the 12go client** for scenarios where 12go is degraded but returning slow 200s (preventing request pile-up).

## Score Adjustments

| Criterion | Self-Score | Suggested | Justification |
|-----------|-----------|-----------|---------------|
| Maintainability | 5 | 4 | Turnover risk means "any .NET dev understands it in a day" is optimistic for the schema/serialization complexity |
| Development Velocity | 5 | 4 | Adding endpoints is easy; debugging the booking schema edge cases is not |
| AI-Friendliness | 5 | 4 | AI generates boilerplate well but struggles with the 12go-specific serialization quirks |
| **Revised Total** | **128** | **~122** | Still the strongest alternative |
