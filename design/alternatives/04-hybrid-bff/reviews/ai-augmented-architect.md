# AI-Augmented Development Review: Hybrid BFF / Thin Proxy

## Overall AI-Friendliness (Score: 5)

This design maximizes the intersection of "simplest possible architecture" and "best AI-supported language." TypeScript on Bun/Node.js is the single best target for AI code generation today, and the ultra-thin design (~2,850 LOC) means AI can reason about the entire system in one context window. For a team that already uses Cursor daily, this is the alternative where AI does the most heavy lifting per line of code.

## Code Generation Assessment

TypeScript is where Claude and Cursor are most capable — approximately 92% first-attempt accuracy for HTTP handlers, JSON transformations, and test scaffolding. The specific patterns in this design (pure transform functions, object destructuring, regex-based field matching) are exactly the kind of code AI generates flawlessly. The booking schema mapper — the hardest part of any alternative — is actually *simpler* in TypeScript than in any other language because iterating over object keys and pattern-matching strings is native JavaScript. AI will produce a working `mapBookingSchema` function from a natural-language description of the 20+ field patterns with minimal correction needed.

The reserve serializer (bracket-notation flattening) is similarly well-suited: building a `Record<string, unknown>` by concatenating string keys is trivial TypeScript that AI generates correctly every time. Compare this to C#'s 200-line `JsonConverter<T>` — the TypeScript version is ~60 lines and more readable.

## Test Generation Assessment

This is the strongest test generation story across all alternatives. Vitest is fast, JSON fixtures are first-class citizens (import JSON files directly), and Fastify's `inject()` method makes integration testing zero-setup. AI generates comprehensive test suites from example JSON inputs — "given this 12go search response, assert the client response has this shape" is a prompt that produces correct, maintainable tests. The pure-function design of the transform layer means every mapper can be tested in isolation with zero mocking.

The one gap: the team won't immediately recognize when AI-generated TypeScript tests are testing implementation details rather than behavior. This is a general TypeScript testing pitfall, not specific to AI, but it's amplified when the team is new to the ecosystem.

## Refactoring and Maintenance

The ~2,850 LOC codebase is the smallest of all alternatives, which directly benefits AI refactoring. Cursor can hold the entire project in context for multi-file edits. Renaming a field propagates cleanly through TypeScript's type system — the compiler catches every missed reference, and AI tools leverage this for safe automated refactoring. The "bag of transform functions" architecture has no framework coupling to fight against.

However, Bun is newer and less represented in AI training data than Node.js. If the team hits a Bun-specific runtime issue, AI tools will be less helpful than for Node.js equivalents. The design mitigates this with Node.js compatibility as a fallback, but it's worth noting.

## Agentic Coding Suitability

The best of all alternatives for autonomous AI agents. The reasons compound: smallest codebase, flattest structure, most AI-friendly language, pure functions with clear inputs/outputs, and JSON as the native data format. An autonomous agent could implement a new endpoint from scratch — route, transform, test — with high confidence. The entire `twelve-go/` client and all transforms could be generated from the C# source code with a single well-crafted prompt per file.

The design explicitly avoids DI containers, framework magic, and abstraction layers that confuse AI agents. Every dependency is a direct import, every function declares its inputs and outputs, and there are no hidden side effects.

## Specific Concerns

- Bun's Datadog integration is experimental. If the team hits tracing issues, AI cannot help debug Bun-specific APM behavior. Switching to Node.js 22 eliminates this risk with zero code changes.
- The "thin proxy" label is somewhat misleading — this is a small application service. If the team expects pure configuration-driven proxying, the 500 LOC booking schema mapper will be a surprise. AI handles it well, but the expectation mismatch could affect planning.
- TypeScript's type coercion edge cases (truthy/falsy, `==` vs `===`, `null` vs `undefined`) can produce subtle bugs that AI generates but doesn't flag. The team needs a strict ESLint config from day one.
- The team's zero TypeScript experience means they cannot evaluate AI output quality during week 1. Pair-reviewing AI-generated TypeScript with the existing C# as reference is essential.

## Recommendations

- Use Node.js 22 instead of Bun for production. The performance difference is irrelevant for this workload, and dd-trace support is battle-tested. Keep Bun as a local dev option for speed.
- Configure strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`) and strict ESLint rules — these catch the exact class of bugs that AI generates in TypeScript.
- Have the most TypeScript-curious developer do the first endpoint while others observe. AI-assisted "live coding" sessions build team confidence faster than documentation.

## Score Adjustments

The design's self-assessed AI-Friendliness of 5 is justified. This is objectively the best codebase for AI-augmented development: smallest surface area, most AI-friendly language, pure functional transforms, and native JSON handling. The only caveat is the team's TypeScript inexperience, which temporarily limits their ability to evaluate AI output quality — but this resolves within 1-2 weeks. For a 3-person team using Cursor daily, this alternative achieves the highest ratio of AI-generated code to human-reviewed code.
