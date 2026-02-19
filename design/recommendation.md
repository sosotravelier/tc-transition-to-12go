# Recommendation

## TL;DR

Build the Trimmed .NET Service (Alternative 1). It is the fastest path to production (7-8 weeks), carries the lowest execution risk, and maintains team focus during the migration period. The 6K-LOC codebase is so small that if strategic alignment with 12go demands a rewrite in Go or TypeScript later, that rewrite costs 2-4 weeks — not months. Optimizing for "cheapest to redo" beats optimizing for "perfect first choice" when immediate delivery is critical and the business needs a working migration now.

## Primary Recommendation

### Alternative 1: Trimmed .NET Service

A single .NET 8 Minimal API service (~6K LOC, 2 .csproj files) replacing 4 repositories, ~342 projects, and 200-400K lines of code. Stateless HTTP proxy to 12go. Zero databases. One Docker container. Datadog native tracing.

### Why This Approach

The decision framework is simple: **what gets us to production fastest with the least chance of failure, given the team we have?**

Every alternative produces roughly the same architecture — a single stateless proxy service with vertical slices, an HTTP client to 12go, JSON transformers, and cross-cutting middleware. The architecture is language-agnostic. What differs is execution risk, and execution risk is dominated by one variable: **how fast can this team ship reliable code?**

The .NET team ships reliable .NET code on day one. Every other option introduces a learning tax of 1-6 weeks before the team is productive, during a period where:

- Near-term team focus is prioritized
- The business needs a working migration, not a learning exercise
- Every week of delay is a week of increased technical debt in the legacy system
- The current 342-project system is a maintenance burden that compounds daily

The math is unambiguous: 26 person-days and 3 weeks to MVP in .NET vs. 38+ person-days and 4-6+ weeks in any other language. That delta buys 1-3 weeks of production validation that no alternative can match.

### Key Strengths

1. **Zero ramp-up.** The team writes production code on day one. No tutorials, no language orientation, no "C# in Go" anti-patterns. The developers think about the domain problem — 12go API transformation — not the toolchain.

2. **Lowest execution risk.** Reviewers unanimously rated this LOW risk. Shadow traffic, response diffing, per-client cutover, instant rollback via load balancer. The old services stay warm for 2+ weeks post-cutover. Every phase is reversible in seconds.

3. **Team continuity.** During a major system transition, asking developers to abandon 12+ years of expertise for a new language is a significant cognitive burden. .NET removes that variable. The team channels their energy into the 98% code reduction — a major architectural simplification — rather than fighting a new ecosystem.

4. **Operationally minimal.** One Docker container replaces 6+ services. DevOps adds one health check instead of managing a fleet. Datadog `dd-trace-dotnet` auto-instruments everything. Build time drops from 5-10 minutes to under 30 seconds. Startup from 5-15 seconds to under 2 seconds.

5. **Cheap to replace.** At ~6K LOC with vertical slices, the entire service can be rewritten in Go, TypeScript, or PHP in 2-4 weeks by anyone who understands the domain. The architecture — handler → client → transformer — translates directly to any language. This is not a 5-year commitment; it's a bridge that works.

### Known Trade-offs

1. **.NET is not 12go's stack.** The PHP platform team won't naturally maintain a .NET service. If team composition changes, 12go must either hire .NET talent for a 6K-LOC service or rewrite it. Given the service's size, rewriting is the pragmatic choice.

2. **No strategic alignment.** This doesn't move toward Go (12go's "considering" direction) or PHP (12go's current stack). It's a deliberate short-term choice that prioritizes delivery speed over long-term stack convergence.

3. **Search latency is not optimal.** The .NET service adds 2-5ms of proxy overhead to 12go's response time. The PHP integration (Alternative 2, Phase 2) eliminates the HTTP round-trip entirely for sub-100ms search. For most B2B traffic, 2-5ms is imperceptible, but if search latency becomes a competitive differentiator, the PHP path offers a structurally better ceiling.

4. **Container overhead.** ~250MB Docker image and ~150-200MB memory footprint is 10-15x larger than Go. Acceptable on EC2 but less efficient per instance.

### When This Could Fail

- **If 12go mandates stack convergence in the near term.** A directive to eliminate non-PHP/Go services would force a premature rewrite. Mitigated by the service's small size.
- **If the booking schema parser has undocumented edge cases.** The 20+ wildcard field patterns are the highest-risk code regardless of language. Mitigated by porting all existing SI tests and running shadow traffic for 2+ weeks.
- **If team rotation occurs during migration.** A team without senior oversight may struggle to port the complex booking schema parser and reserve serializer. Mitigated by front-loading the hardest components in weeks 1-2 and documenting aggressively.

## Runner-Up

### Alternative 5: TypeScript/Node.js Service

A single Fastify service on Node.js 22 LTS (~5K LOC). Same architecture as the .NET option with native JSON handling, Zod validation, and the strongest AI-assisted development story of any language.

### Why It's Second

TypeScript scores second-highest across reviewers (~112-113/140 adjusted vs. ~122-126 for .NET). It loses on two criteria that matter most right now — Team Competency Match and Implementation Effort — but wins on two criteria that matter most later — AI-Friendliness and future maintainer availability.

The 1-2 week learning tax is genuine but the smallest of any non-.NET option. TypeScript was designed by the same person as C# (Anders Hejlsberg), and the concept mapping is mechanical: `Task<T>` → `Promise<T>`, `IMiddleware` → Fastify plugin, `Dictionary<K,V>` → `Record<K,V>`. The booking schema parser — the hardest code in the system — is actually *simpler* in TypeScript because iterating over dynamic JSON keys and regex-matching is native JavaScript, not a `JsonExtensionData` + `Dictionary<string, JsonElement>` conversion.

### When to Choose This Instead

Choose TypeScript over .NET if **any two** of these conditions are true:

1. **12go leadership explicitly asks for non-.NET technology.** If the message is "we don't want another .NET service in our ecosystem," TypeScript is the best non-.NET option by a clear margin.
2. **The team is genuinely enthusiastic about TypeScript.** Not "willing to tolerate" — genuinely excited. Run a 2-day spike: if the team enjoys the AI-assisted workflow and the JSON-native development, the satisfaction benefit compounds over months.
3. **Strategic runway is longer than assumed.** If there is a longer strategic planning horizon (longer term), the 1-2 week TypeScript investment pays back in AI productivity gains and broader future hiring options.
4. **The primary concern is long-term maintainability by diverse teams.** TypeScript has the largest developer pool of any typed language globally. Finding replacements is easier than for .NET, Go, or PHP in most markets.

## Hybrid Approach

### Take the Best Ideas from Each Alternative

The alternatives are not mutually exclusive in their insights. Regardless of which language is chosen:

| Adopt From | Insight | Application |
|-----------|---------|-------------|
| **Alt 4 (Hybrid BFF)** | Endpoint classification analysis | Use the 7-thin / 4-orchestrated / 2-complex breakdown for sprint planning and risk estimation. Prioritize the 7 thin endpoints first for quick wins. |
| **Alt 2 (PHP Integration)** | Phase 1 HTTP proxy → Phase 2 direct access | If search latency becomes critical post-migration, explore embedding search logic into f3 as a Phase 2 optimization — regardless of what language the B2B proxy uses. |
| **Alt 3 (Go Service)** | Distroless container + health check patterns | Apply Go's operational best practices (explicit config structs, built-in profiling endpoints, minimal container images) to whichever runtime is chosen. |
| **Alt 5 (TypeScript)** | Zod-style single source of truth for types + validation | Even in .NET, consider `System.Text.Json` source generators to achieve similar type-safety benefits and reduce serialization boilerplate. |

### What NOT to Hybridize

Do not attempt to split the service by language (e.g., "search in Go, booking in .NET"). The 13 endpoints share a single 12go HTTP client, common middleware, and unified configuration. Splitting creates 2 services, 2 deployment pipelines, 2 monitoring dashboards, and coordination overhead for a team of 3-4 developers. The entire point is radical simplification.

## Phased Migration Plan

### Phase 1: Foundation (Week 1-2)

| Task | Owner | Deliverable |
|------|-------|-------------|
| Scaffold project: `B2bApi.csproj`, `B2bApi.Tests.csproj`, `Program.cs`, Dockerfile | Senior Dev A | Empty running service with health checks |
| Port `TwelveGoApiClient` + all 12go request/response models from SI | Senior Dev A | Working HTTP client hitting 12go staging |
| Implement cross-cutting middleware: correlation ID, API versioning, error handling, client auth | Senior Dev B | Middleware pipeline passing integration tests |
| Implement Search endpoint end-to-end | Senior Dev A + B | Search returning correct responses from 12go staging |
| Set up CI: build → test → Docker push | DevOps + Senior Dev | Green CI pipeline on every PR |
| Set up Datadog tracing via `dd-trace-dotnet` | DevOps | Traces visible in Datadog for staging requests |

**Exit criteria:** Search endpoint returns correct responses against 12go staging. CI is green. Datadog shows traces.

### Phase 2: Core Endpoints (Week 3-4)

| Task | Owner | Deliverable |
|------|-------|-------------|
| Port `BookingSchemaParser` with all 20+ wildcard patterns + existing SI tests | Senior Dev A (highest priority) | Parser passing all ported test fixtures |
| Port `ReserveDataConverter` (bracket-notation serializer) + tests | Senior Dev A | Serializer producing byte-identical output to SI |
| Implement GetItinerary (3 calls + schema) | Senior Dev A | Most complex endpoint working |
| Implement CreateBooking, ConfirmBooking, SeatLock | Senior Dev B | Full booking funnel working |
| Implement post-booking: GetBookingDetails, GetTicket, CancelBooking, IncompleteResults | Mid Dev | Post-booking endpoints working |
| Implement Stations, Operators, POIs | Mid Dev | Master data endpoints working |

**Exit criteria:** All 13 endpoints return responses from 12go staging. BookingSchemaParser passes 100% of ported SI tests.

### Phase 3: Validation (Week 5-6)

| Task | Owner | Deliverable |
|------|-------|-------------|
| Implement notification transformer + webhook delivery | Mid Dev | Webhook receiver + client forwarding working |
| Record production 12go responses (all endpoint types) | Senior Dev A | JSON fixture library for contract tests |
| Build contract test framework: replay recorded traffic through old + new, diff output | Senior Dev B | Automated diff report showing 0 discrepancies |
| Deploy to staging, run shadow traffic on read-only endpoints | DevOps + Senior Dev A | Shadow mode running, Datadog dashboard showing comparison metrics |
| Load test search endpoint against staging | Senior Dev B | p95 latency documented, within acceptable bounds |

**Exit criteria:** Contract tests show zero response discrepancies. Shadow traffic stable for 5+ days. Load test confirms acceptable latency.

### Phase 4: Cutover (Week 7-8)

| Task | Owner | Deliverable |
|------|-------|-------------|
| Week 7: Route 1 non-critical client to new service | DevOps + Senior Dev A | Single client on new service, monitored |
| Week 7: Monitor for 3 days, fix any discrepancies | All devs | Zero client-reported issues |
| Week 8: Route all clients to new service | DevOps | 100% traffic on new service |
| Week 8: Keep old services warm as fallback | DevOps | Rollback possible in seconds |

**Exit criteria:** All clients migrated. Old services warm but receiving no traffic. Datadog confirms healthy metrics for 5+ days.

### Phase 5: Cleanup (Week 9-10)

| Task | Owner | Deliverable |
|------|-------|-------------|
| 2-week bake period — monitor for edge cases | All | Stable production metrics |
| Decommission old .NET services (Etna, Denali, SI) | DevOps | Old infrastructure removed |
| Document the new service: README, architecture, runbook | Senior Dev A | Onboarding-ready documentation |
| Retrospective: document lessons learned, update transition-design repo | All | Knowledge captured |

## Risk Mitigation Strategy

### Risk 1: Booking Schema Parser Regression (Medium Likelihood, High Impact)

The 20+ wildcard field patterns (`selected_seats_*`, `points*[pickup]`, `passenger[0][baggage_*]`) are the single most dangerous code in the system. A subtle pattern-matching bug could cause booking failures in production.

**Mitigation:**
- **Week 1**: Port ALL existing SI unit tests for the schema parser before writing new code. Tests are the safety net.
- **Week 5**: Record production 12go `/checkout` responses for every active operator. Replay through both old and new parsers. Diff byte-by-byte.
- **Week 6-7**: During shadow traffic, log every booking schema mapping. Automated alerting on any response that differs from the .NET system.
- **Standing rule**: No cutover for booking endpoints until the parser has processed 1,000+ unique schemas in shadow mode with zero discrepancies.

### Risk 2: Team Composition Changes During Migration (Medium Likelihood, High Impact)

Given the importance of rapid knowledge transfer, losing a senior developer mid-migration could stall the project. The booking schema parser and reserve serializer require deep domain knowledge.

**Mitigation:**
- **Front-load the hardest work.** The schema parser and reserve serializer are built in weeks 1-3 by the senior developers. By week 4, the critical code is written and tested — the remaining work (post-booking endpoints, notifications, testing) can be completed by other team members.
- **Document as you go.** Every complex transformation gets inline comments explaining the *why*, not the *what*. The architecture decision record (this document) serves as the strategic context.
- **Pair on critical code.** Both senior developers review each other's schema parser and serializer code. No single person holds the full mental model.
- **The 6K-LOC codebase is itself a mitigation.** If there are team changes, a new developer can understand the entire system in 2-3 days. Compare this to the 342-project system they'd inherit otherwise.

### Risk 3: Strategic Misalignment with 12go (Medium Likelihood, Medium Impact)

12go's platform is PHP. They're "considering" Go. A .NET service is a standalone stack in the ecosystem.

**Mitigation:**
- **Accept this deliberately.** .NET is a bridge technology, not a destination. Document this in the architecture decision record with a 12-month review trigger.
- **The rewrite cost is bounded.** At 6K LOC with vertical slices, a rewrite to Go or TypeScript takes 2-4 weeks. The architecture (handler → client → transformer) and test fixtures (recorded 12go responses) transfer to any language.
- **Ask 12go for a signal.** Before committing to any alternative, request clarity on 12go's technology direction. "Considering Go" is not actionable; "adopting Go in Q3" is. If a concrete Go timeline exists, weigh Alternative 3 more heavily.
- **Set a strategic review checkpoint.** If 12go has committed to Go by then, plan the 2-4 week rewrite. If not, the .NET service continues serving well.

## Decision Criteria for Stakeholders

If leadership needs to decide between the top two options (.NET vs. TypeScript), here is the decision matrix:

| Factor | Choose .NET If... | Choose TypeScript If... |
|--------|-------------------|------------------------|
| **Timeline pressure** | Need MVP in 3 weeks | Can absorb 4-5 weeks |
| **Team sentiment** | Team wants stability and comfort | Team is interested in TypeScript |
| **Retention confidence** | Delivery-focused | Higher (12+ months expected) |
| **12go's direction** | Unknown or PHP-focused | Doesn't matter (TS is a neutral choice) |
| **Future hiring** | Will hire .NET developers | Open to any typed-language developers |
| **AI investment** | Current AI workflow is sufficient | Want to maximize AI-assisted development |
| **Search latency** | 2-5ms overhead is acceptable | 2-5ms overhead is acceptable (same) |
| **Long-term stack** | Accept .NET as a bridge | Want to diversify from .NET |

**The default is .NET.** Choose TypeScript only if you have affirmative reasons to switch, not because .NET feels "boring." Boring is a feature when everything else is a major transition.

## What We're NOT Recommending (and Why)

### Alternative 2: PHP Integration (Inside f3) — REJECTED

**Score: ~98-100/140 (lowest)**

The technical design is sound — direct MariaDB access eliminates HTTP round-trips and delivers the best possible search latency. But the execution risk is high:

- **Skills alignment is a critical risk.** .NET developers writing PHP under significant stack friction during a high-pressure transition is a recipe for team turnover and poor-quality code.
- **The 12go veteran dependency is single-threaded.** If the embedded PHP expert is pulled to other priorities (likely at a large company), the team is blocked.
- **13-21 week timeline** is 2-3x longer than the .NET option. The "PHP tax" is 6-13 extra weeks of developer time.
- **Coupling to f3's monolith** introduces a new failure mode: f3 deploys breaking B2B endpoints without our team being able to diagnose the issue.

**When to reconsider:** If 12go leadership mandates that B2B logic lives inside f3, AND the team agrees to PHP, AND a 12go veteran is allocated full-time for 6 weeks, AND search latency is a competitive differentiator that justifies the risk. That's a lot of criteria.

### Alternative 3: Go Service — REJECTED

**Score: ~103-106/140**

Go produces a beautiful artifact — 10MB binary, sub-millisecond GC, 100ms startup. But the strategic justification depends on 12go adopting Go, which hasn't been decided:

- **The alignment argument is speculative.** "Considering Go" with no timeline is not a strong enough signal to justify a language change for a team that knows zero Go.
- **2-week ramp-up produces no shippable code.** Those weeks are pure training cost. In a delivery-focused window, that's 2 weeks of risk with no deliverables.
- **JSON manipulation in Go is genuinely challenging** for the booking schema's dynamic field patterns. `map[string]interface{}` with type assertions is a difficult fit for this specific problem.
- **The mental model shift risk is real.** Reviewers noted the team will write non-idiomatic Go for weeks 3-4, requiring refactoring that extends the timeline.

**When to reconsider:** If 12go commits to Go with a concrete timeline (e.g., "Go is our standard for all new services starting Q3"), Go becomes the strongest long-term choice. Re-evaluate if that signal materializes.

### Alternative 4: Hybrid BFF (TypeScript/Bun) — REJECTED

**Score: ~93-95/140 (adjusted for Bun risk)**

The endpoint analysis and "where thin breaks down" framework are the most analytically valuable artifacts in the entire evaluation. But the design is undermined by the Bun runtime recommendation:

- **Bun's Datadog integration is experimental.** `dd-trace` does not officially support Bun. Auto-instrumentation may be incomplete. This is a dealbreaker for production monitoring during migration.
- **Bun adds runtime risk on top of language risk.** The team doesn't know TypeScript OR Bun. Two unknowns simultaneously is excessive.
- **Alternative 5 is this design done right.** Same language, mature runtime (Node.js 22 LTS), proper framework (Fastify), complete monitoring integration. There is no scenario where Alt 4 is preferable to Alt 5.

**Salvage value:** The endpoint classification analysis (7 thin, 4 orchestrated, 2 complex) should be used for sprint planning regardless of which alternative is chosen.

## Next Steps

### Immediate (This Week)

1. **Share this recommendation with the team.** The developers' input on language choice matters — they're the ones building it. If they have strong feelings about TypeScript, that changes the calculus.
2. **Request a technology direction signal from 12go leadership.** "Are you committed to Go? If so, when?" A concrete answer eliminates the speculation that makes this decision harder than it needs to be.
3. **Confirm 12go DevOps capacity** for adding one new Docker container to the EC2 fleet. Verify Datadog agent sidecar availability on the target instances.

### Week 1 (After Decision)

4. **Create the `b2b-api` repository** with the project scaffold from Alternative 1's design document.
5. **Record production 12go API responses** for all 13 endpoints. These JSON fixtures are needed regardless of language — they're the contract test ground truth.
6. **Port the `BookingSchemaParser` tests from the SI repository** to the new project. The test cases transfer even if the code is being rewritten.
7. **Set up CI/CD pipeline**: build → test → Docker push → deploy to staging.

### Week 2-3 (Build Phase)

8. **Implement endpoints in priority order**: Search → GetItinerary → CreateBooking → ConfirmBooking → remaining. This matches the endpoint classification's risk ordering.
9. **Deploy to staging and begin shadow traffic** on Search as soon as it's working (possibly end of week 2). Don't wait for all 13 endpoints.

### Week 4+ (Validation and Cutover)

10. **Run contract test diffs** against all recorded production responses.
11. **Begin per-client cutover** starting with the lowest-traffic client.
12. **Set a strategic review checkpoint** to evaluate whether a stack migration (to Go, TypeScript, or PHP) is warranted based on 12go's direction and evolving team needs.
