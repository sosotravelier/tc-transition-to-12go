# Systems Architect Review: Hybrid BFF / Thin Proxy

## Overall Assessment

This design starts from the right question — "what is the absolute minimum code needed to translate between two known HTTP APIs?" — and honestly discovers that the answer is "more than a thin proxy, less than an application service." The endpoint classification analysis (pure transform vs. orchestrated vs. complex logic vs. stateful) is the most rigorous of all five designs and provides real insight. However, the final recommendation (TypeScript/Bun) undermines its own thesis: if you're building a ~3K LOC application service, the "thin" framing adds confusion without adding value, and Bun is an unnecessary production risk.

## Strengths

- **Best problem decomposition.** The endpoint-by-endpoint classification is the most analytically useful artifact across all five designs. Identifying that 7/13 endpoints are genuinely thin while 6 require real application logic gives the team concrete data for planning and risk assessment. Every other design should reference this analysis.
- **Honest about where "thin" breaks down.** The booking schema mapper (~500 LOC), reserve serializer (~150 LOC), itinerary ID encoding (~50 LOC), and notification state are called out as irreducible complexity. The conclusion — "this is a thin application service, not a proxy" — is correct and refreshingly candid.
- **Gateway options are correctly eliminated.** The analysis showing Kong/Traefik cannot handle complex body transformation, multi-call orchestration, or notification webhooks is precise. Too many designs default to "put an API gateway in front" without understanding what gateways can and cannot do.
- **Smallest codebase estimate (~2,850 LOC).** If achievable, this represents the highest signal-to-noise ratio of any alternative.

## Weaknesses

- **Bun as a production runtime is an unnecessary risk.** The design chooses Bun over Node.js for performance (200K vs 68K req/s) that is irrelevant — the bottleneck is 12go's MariaDB at 50-500ms per request. Meanwhile, Bun's Datadog integration is experimental, its production track record is thin, and the team has zero JavaScript experience. Adding runtime immaturity on top of language unfamiliarity compounds risk for no benefit. The Alternative 5 (TypeScript/Node.js) design makes this argument better.
- **The notification booking-to-client mapping problem is underspecified.** Options A (12go includes client ID), B (in-memory map), and C (Redis) are listed but the design doesn't commit. This is the one piece of state the service needs, and "start with Option B, hope for Option A" is not a strategy — the in-memory map means every restart loses the mapping table for all in-flight bookings. The design should commit to Redis from day one (it's one key-value store on existing infrastructure).
- **Self-assessment scores underweight the team competency gap.** Team Competency Match at 3 claims TypeScript is "the closest non-.NET language to C#." This is true syntactically, but the team has zero experience with npm, Node.js event loop semantics, or JavaScript ecosystem conventions. The ramp-up estimate ("1-2 days with AI assistance") for senior .NET devs to be productive in TypeScript/Bun is unrealistically compressed.
- **No discussion of the `orchestrate` abstraction's failure modes.** The sequential orchestration pattern shown (`steps` array with `combine`) doesn't address what happens when step 2 fails after step 1 succeeds. For `GetItinerary`, a failed `GetBookingSchema` after a successful `AddToCart` creates an orphaned cart in 12go. This is probably harmless (carts expire) but should be documented.

## Domain Modeling Critique

There is no domain model, which is correct. The design correctly identifies that the "domain" is the transformation rules themselves — expressed as pure functions mapping between two JSON shapes. The `ClientBookingSchema` type is the closest thing to a domain object, and it's just a structural type for the mapped output. No over-engineering here.

## Architecture Pattern Critique

"Bag of transform functions with some orchestration" is the right pattern for this problem. No mediator, no repository, no unit of work — just functions that take JSON in and produce JSON out. The concern is that the design doesn't provide enough structure for the orchestrated endpoints (GetItinerary, CreateBooking, CancelBooking) — these need explicit error handling for partial failures, which the generic `orchestrate` function abstracts away.

## Error Handling Assessment

The error mapping table (12go status → client status) is correct and well-specified. The 401→500 mapping (hiding 12go auth errors from clients) is the right call. However, the design lacks a structured error type hierarchy — errors are handled ad-hoc in handlers rather than through a consistent exception/error type system. Alternative 1 and 5 handle this better.

## Recommendations

1. **Switch from Bun to Node.js 22 LTS.** The performance difference is irrelevant; the maturity difference is material. This aligns with Alternative 5's recommendation and eliminates the runtime risk.
2. **Commit to Redis for booking-to-client mapping.** It's one key-value pair per booking on existing Redis infrastructure. Don't start with a known-broken in-memory approach.
3. **Merge this analysis with Alternative 5.** The endpoint classification and "where thin breaks down" analysis from this design combined with the framework/runtime choices from Alternative 5 would produce the strongest TypeScript alternative.
4. **Adjust Team Competency Match to 2.** TypeScript similarity to C# is real but the npm/Node.js/event-loop ecosystem gap is larger than acknowledged.

## Score Adjustments

| Criterion | Self-Score | Suggested | Justification |
|-----------|-----------|-----------|---------------|
| Team Competency Match | 3 | 2 | npm/Node.js ecosystem is genuinely foreign; "1-2 days" ramp-up is unrealistic |
| Infrastructure Fit | 4 | 3 | Bun introduces an untested runtime; even Node.js is new for DevOps |
| Elegance | 3 | 3 | Fair self-assessment |
| **Revised Total** | **99** | **~93** | The analytical insight is excellent but the runtime choice weakens execution |
