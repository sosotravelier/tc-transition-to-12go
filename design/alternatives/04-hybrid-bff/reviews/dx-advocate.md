# Developer Experience Review: Hybrid BFF / Thin Proxy (TypeScript/Bun)

## Overall DX Assessment

This design is refreshingly honest about what it is — a bag of transform functions, not a "thin proxy." The DX vision is appealing: write a function that takes JSON in and returns JSON out, wire it to a route, done. TypeScript's native JSON handling makes the core problem (reshape data between two APIs) as frictionless as it can be. But choosing Bun as the runtime introduces a wild card that undermines the simplicity story. The team doesn't know TypeScript *or* Bun, and Bun's production track record is thin. The design tries to be the simplest option but introduces two unknowns instead of one.

## Daily Workflow

The daily loop would be: edit a transform function, run tests (fast with Bun's test runner), hit the endpoint locally. Bun starts in 15ms — there's no waiting. The feedback loop is excellent on paper. But during the first weeks, developers will fight with unfamiliar tooling: Bun's npm compatibility gaps, TypeScript configuration, ESM vs CommonJS confusion, and a package manager they've never used. The "git pull to running locally" path has more hidden friction than the design acknowledges — `bunx`, `.env` files, and Bun-specific Docker images are not zero-effort for a .NET team.

## Code Writing Experience

For this specific problem — JSON transformation — TypeScript is arguably the best language. Object destructuring, spread operators, `Record<string, T>`, native regex on object keys — all of these make the booking schema mapper genuinely simpler than in C#. The design's claim that "this is actually simpler in TypeScript than in C#" for schema mapping is correct. The reserve serializer is also cleaner — building a flat object with bracket-notation keys is trivial JavaScript.

The concern: the design is light on framework structure. There's no `app.ts` composition root shown, no clear plugin architecture, no typed route handlers. It reads more like a sketch than a design — "here are some functions" rather than "here is how the system is organized." For developers coming from .NET's structured DI/middleware world, the lack of visible architecture may feel like chaos. The minimalism is a feature for experienced TypeScript devs but a bug for .NET devs navigating a new ecosystem.

## Debugging Experience

Bun's debugging story is immature compared to Node.js. The Bun Inspector exists but lacks the ecosystem support of Node.js `--inspect` + Chrome DevTools. Stack traces in Bun can be less informative. For a team whose debugging workflow is "F5 in Rider, set breakpoint, step through," moving to `console.log`-based debugging in a runtime they don't know is a significant downgrade. The design doesn't address debugging at all, which is a red flag for a DX review.

## Testing Experience

The design mentions testing briefly but doesn't specify a test framework or show test examples. Bun has a built-in test runner, but it's less mature than Vitest or Jest. For a team learning TypeScript, the testing setup is another unknown to navigate. The positive: transform functions are pure functions that take JSON and return JSON — these are trivially testable in any framework. The negative: there's no shown test infrastructure for mocking 12go HTTP calls or testing the full request pipeline.

## Onboarding Assessment

The ~2,850 LOC estimate is the smallest of any option — genuinely impressive. A new developer could read the entire codebase in an afternoon. But "read" and "understand" differ when the reader doesn't know TypeScript. For the current .NET team: 1-2 weeks to productivity with AI assistance, longer to confidence. For a future TypeScript developer: excellent, near-instant onboarding. The codebase is small enough that tribal knowledge barely exists.

## Language/Framework Learning Curve

TypeScript-to-C# is the easiest language transition available (same designer, same concepts). The design correctly identifies this. But Bun adds a second learning curve on top — its APIs differ from Node.js in subtle ways, its module resolution has quirks, and when something goes wrong, Stack Overflow has fewer answers for Bun than for Node.js. The design recommends Bun for performance, but the performance difference is irrelevant when 12go's API is the bottleneck. Choosing Bun over Node.js is optimizing the wrong variable at the cost of ecosystem maturity.

## Joy Factor

Mixed. The concept is exciting — "we'll write the thinnest possible translation layer, ~3K lines, and be done." There's intellectual joy in radical simplification. But the execution reality — learning TypeScript, learning Bun, debugging in an unfamiliar runtime, building without clear architectural patterns — may feel more chaotic than liberating. The design's minimalism only sparks joy if you already know the ecosystem. For newcomers, minimalism can feel like "there's no structure to lean on."

The "thin proxy" framing is also slightly misleading. The design admits 6 of 13 endpoints require real application logic. Calling it "thin" sets expectations that reality will violate, which is a small but real risk to team satisfaction.

## DX Risks

- **Bun's production maturity**: the design itself acknowledges this but proceeds anyway. A runtime issue at 2 AM that nobody on the team can diagnose is a real scenario.
- **No architecture to fall back on**: the minimalist approach means developers must make structural decisions without guidance. In a new language, this leads to inconsistency.
- **Notification state management**: the in-memory booking-to-client map that's lost on restart is a production incident waiting to happen. The design acknowledges it but doesn't solve it.

## Recommendations

- If this direction is chosen, use Node.js 22 LTS instead of Bun. The performance difference doesn't matter; the maturity difference does. (Alternative 5 makes this exact choice.)
- Add more architectural structure to the design — show the composition root, plugin registration, and testing approach explicitly.
- Define the debugging workflow for the team before starting.
- Don't call it "thin" — call it what the design itself admits: "a small application service." Setting honest expectations protects team engagement.

## Score Adjustments

The self-assessment gives Team Competency Match a 3, but the Bun choice should push it toward 2.5 — it's two unfamiliar technologies, not one. Infrastructure Fit at 4 is fair. I'd lower AI-Friendliness from 5 to 4 because Bun-specific patterns are less represented in AI training data than Node.js equivalents. The overall score of 99 feels right for the concept but slightly generous for the Bun-specific execution.
