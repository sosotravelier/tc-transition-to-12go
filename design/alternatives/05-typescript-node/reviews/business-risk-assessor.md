# Business Risk Review: TypeScript/Node.js Service

## Overall Risk Assessment

**Risk Level: LOW-MEDIUM**

This is the most pragmatic non-.NET alternative. It combines the language closest to C# (TypeScript), the most battle-tested non-.NET runtime (Node.js 22 LTS), and the strongest AI-assisted development story. The risk profile is dominated by a single factor: the team must learn a new language during an uncertain transition period. Every other risk dimension — infrastructure, rollback, client disruption — is well-managed. If the team accepts TypeScript, this is a strong contender. If they resist, it becomes another PHP-style morale problem.

## Migration Timeline Risk

The 8-9 week total estimate (1 week ramp-up + 3 weeks build + 2 weeks validate + 2-3 weeks cutover) is realistic. TypeScript's similarity to C# compresses the learning curve compared to Go or PHP — async/await, interfaces, generics, and class-based patterns all transfer directly. The 1-week ramp-up estimate for basic productivity is credible; the design honestly notes that production confidence takes longer (weeks 2-3 code needs extra review). The realistic risk is in **weeks 2-3 of the build phase** — the team is writing production TypeScript before they've internalized Node.js patterns (event loop, stream handling, module resolution). Bugs during this period will be subtler and harder to diagnose than equivalent .NET bugs. Timeline risk overall: **8-11 weeks** to full cutover. Not dramatically worse than .NET's 7-8 weeks.

## Client Disruption Risk

Low. Identical migration strategy to the .NET alternative — shadow traffic, response diffing, per-client cutover, instant rollback via load balancer. The stateless proxy design means zero data migration. The TypeScript service's JSON-native handling actually reduces a subtle risk: JSON serialization edge cases (number precision, null handling, date formatting) are easier to get right in TypeScript than in C#'s `System.Text.Json`, where custom converters can introduce drift.

## Team Impact Assessment

**The pivotal factor.** TypeScript occupies a unique position: it's not the team's native language (.NET), but it's the closest alternative and the one most likely to be received positively. Unlike PHP (which developers often view negatively) or Go (which requires unlearning OOP patterns), TypeScript is broadly seen as a desirable skill. Senior C# developers typically view TypeScript as "something I should probably know." This framing matters for morale. The risk is real but less acute than PHP or Go: if a developer leaves during the TypeScript migration, finding a TypeScript replacement is easier than finding a .NET developer (in most global markets) or a Go developer. The bus factor is moderate — the domain knowledge is the scarce resource, not the language expertise.

## Knowledge Transfer Risk

**Best non-.NET option for hiring flexibility.** TypeScript has the largest global developer pool of any typed language. If there are team composition changes during the transition, replacement TypeScript developers are readily available. They won't know the domain (12go B2B API specifics), but a 5K-LOC codebase with vertical slices is learnable in days. The counterpoint: 12go's ecosystem is PHP (and possibly Go). A TypeScript service is a technology island — maintainable by easily-hired talent but not naturally integrated with 12go's team or tooling. This is a real but manageable concern given the service's small size.

## Cost Analysis

Infrastructure: minimal (single Docker container, ~150MB image). Training: 1 week of explicit ramp-up + 2-3 weeks of reduced velocity = ~2-3 weeks of productivity cost, comparable to Go but less than PHP. Total person-days: 38 vs 26 for .NET — a 46% increase, almost entirely from ramp-up. No licensing costs. The Node.js 22 LTS support extends to April 2027, so no forced runtime migration within the planning horizon. Opportunity cost: 1-2 extra weeks vs .NET, which is the smallest delta among all non-.NET alternatives.

## Rollback Strategy Assessment

Excellent. Identical to .NET — DNS/load-balancer switch, old services stay warm, zero data migration. The maximum rollback window extends until .NET services are decommissioned. If TypeScript proves problematic at any phase, reverting to .NET and re-starting with Alternative 1 costs approximately 4-5 weeks of sunk time — painful but not catastrophic given the small codebase.

## Top 3 Risks (Ranked by Severity)

1. **Team productivity dip in weeks 2-4** — developers write production TypeScript before fully internalizing Node.js patterns; subtle bugs (event loop blocking, unhandled promise rejections, npm dependency conflicts) consume debugging time that wouldn't exist in .NET
2. **Strategic misalignment with 12go** — TypeScript is neither the team's native .NET nor 12go's potential Go future; the service may need rewriting in 1-2 years regardless
3. **npm supply chain risk** — dependency management requires discipline the team hasn't built; a transitive dependency issue could cause production failures that are foreign to .NET developers' experience

## Risk Mitigations

1. Pair the first production feature (search endpoint) with mandatory code review by both senior developers. Budget 2-3 extra review days in weeks 2-3. Run `node --prof` and heap snapshots during load testing to catch event loop issues early.
2. Accept TypeScript as a deliberate bridge technology. At 5K LOC, a rewrite to Go (if 12go commits) takes 2-3 weeks. Document this exit path explicitly in the architecture decision record.
3. Lock all dependencies with `package-lock.json`. Use only top-tier libraries (Fastify, Zod, Pino, undici — all with millions of weekly downloads). Run `npm audit` in CI. Avoid any dependency with fewer than 10K weekly downloads.

## Score Adjustments

The self-assessed 115/140 is slightly generous. I would lower **Team Competency Match to 2** (the team genuinely doesn't know TypeScript; scoring 3 because "it's similar to C#" overstates readiness — knowing syntax is not knowing an ecosystem) and keep **Implementation Effort at 3**. Adjusted score: ~**112/140**. This places it below .NET (~126) but above PHP (~98) and Go (~103), and roughly even with the Hybrid BFF (~99) but with a more mature runtime choice. The strongest argument for this alternative over .NET is the AI-friendliness advantage and the larger future maintainer pool — but those advantages must be weighed against the immediate productivity cost of language switching.
