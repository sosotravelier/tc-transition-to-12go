# Business Risk Review: Go Service

## Overall Risk Assessment

**Risk Level: MEDIUM-HIGH**

The Go alternative is a bet on strategic alignment with 12go's future direction — but that future is speculative. The team invests 2 weeks of ramp-up learning a language nobody knows, during a period where team retention is uncertain and the business needs a working migration, not a learning exercise. If 12go commits to Go, this looks brilliant in retrospect. If they don't (or the team leaves before the migration completes), the investment is wasted. The technical design itself is excellent — the risk is entirely in timing and people.

## Migration Timeline Risk

The 4-6 week estimate includes 2 weeks of Go ramp-up, which is aggressive. Go is genuinely simpler than .NET, but "simpler" doesn't mean "instant." Developers will hit walls with error handling patterns, lack of LINQ equivalents, and Go's interface model. Realistic expectation: team becomes minimally productive in Go by end of week 2, but writes "C# in Go" for weeks 3-4 (verbose, non-idiomatic, requiring refactoring). Realistic MVP: **6-8 weeks**, with an additional 2-3 weeks for production hardening. Total to cutover: **10-12 weeks**. The booking schema transformer in Go is particularly risky — Go's type system makes dynamic JSON key iteration verbose and error-prone compared to C# or TypeScript. This single component could consume a disproportionate amount of development time.

## Client Disruption Risk

Low, comparable to the .NET alternative. Shadow traffic, response diffing, and per-client cutover are all standard patterns that apply equally well to a Go service. The rollback story is clean — old .NET services stay warm, load balancer switches traffic. No special concerns here.

## Team Impact Assessment

**The critical question: is this a career investment or a forced march?** If the team is genuinely excited about learning Go (some .NET developers are — Go's simplicity appeals to engineers tired of enterprise complexity), this boosts morale and retention. If it's perceived as "we don't trust you to pick the right tool," it accelerates departures. The design acknowledges this but frames it optimistically ("frame as skill investment"). In reality, during a transition period where job security is already uncertain, asking developers to abandon their 12-year expertise and learn a new language is a significant psychological burden. The bus factor during weeks 1-4 is very high — if one of the two senior developers leaves during Go ramp-up, the remaining team cannot sustain the migration. Unlike with .NET, you cannot quickly hire a replacement who knows both the domain and Go.

## Knowledge Transfer Risk

**Depends entirely on 12go's direction.** If 12go adopts Go: excellent — the service becomes a shared-stack asset and 12go engineers can maintain it. If 12go doesn't adopt Go: the service is maintained by nobody's first-choice language. The current .NET team doesn't know Go well enough (even post-ramp-up, 6 weeks of experience is not deep expertise), and 12go's PHP team doesn't know Go either. Hiring Go developers is feasible (growing market) but adds another variable. If the current team leaves at 6 months, a 3-5K LOC Go service is small enough for any competent Go developer to pick up quickly — this is a genuine advantage of Go's simplicity.

## Cost Analysis

Infrastructure: zero (single binary, tiny Docker image, fits existing EC2). Training: 2 weeks of ramp-up for 3 developers = 6 person-weeks of reduced productivity, which is the second-highest training cost after PHP. Opportunity cost: 10-12 weeks vs 7-8 for .NET = 2-4 extra weeks. The total delta is real but bounded. No licensing costs. Go's minimal resource footprint (20-30MB RAM vs 150-300MB for .NET) saves marginal infrastructure cost — unlikely to matter at this scale.

## Rollback Strategy Assessment

Good at the technical level — identical to .NET. Load balancer switch, old services stay warm. The organizational rollback concern: if Go doesn't work out at week 4, you've spent 4 weeks learning a language instead of building a product. The "restart with .NET" fallback is painful but possible since the domain understanding is preserved.

## Top 3 Risks (Ranked by Severity)

1. **Team departure during Go ramp-up** — the 2-week learning period is the highest-vulnerability window; losing a senior developer here is unrecoverable
2. **12go doesn't commit to Go** — the strategic alignment argument collapses, leaving a service in a language that neither the team nor 12go's platform team prefers
3. **Booking schema transformer complexity in Go** — Go's static typing makes dynamic JSON field iteration verbose; this component takes 2-3x longer than estimated

## Risk Mitigations

1. Get explicit team buy-in before committing. Run a 1-week Go spike (build the search endpoint). If the team is struggling or unhappy, redirect to .NET with minimal sunk cost.
2. Ask 12go leadership for a signal on Go direction before investing. If "considering Go" is just aspirational with no timeline, discount the alignment argument heavily.
3. Consider implementing the booking schema transformer in .NET first (known territory), verify correctness, then port to Go with the working implementation as a reference. This de-risks the hardest component.

## Score Adjustments

The self-assessed 112/140 is slightly high. I would lower **Implementation Effort to 2** (4-6 weeks is optimistic; 6-8 realistic, and the ramp-up weeks produce no shippable code) and **Team Competency Match to 1** (zero Go experience is worse than the design acknowledges — "AI handles 60-70%" is aspirational, not proven for Go). Adjusted score: ~**103/140**. The strategic upside is real but contingent on factors outside the team's control.
