---
status: draft
last_updated: 2026-03-17
agent: execution-realist
---

# Execution Realist Analysis

## Team Reality Check

Here is what I know about this team that shapes every score below.

**One developer: Soso.** 12 years .NET experience. 2 years at this company. Senior-level. Plans to resign after this transition is complete (around June 2026). He expected 4 developers and was told he works alone. He is demoralized by the resourcing decision.

**The "team" is AI.** Soso uses Claude Code with multi-agent workflows. This is a genuine productivity multiplier -- I have seen AI-augmented solo developers perform at roughly 2-3x the velocity of an unassisted solo developer on well-defined transformation tasks. But AI does not eliminate: production debugging at 3am, operational decisions under ambiguity, integration test failures caused by undocumented 12go behavior, or the cognitive overhead of context-switching between maintenance of existing services and building new ones.

**Q2 2026 deadline.** New clients must onboard on the new system. Today is March 17. Q2 ends June 30. That is roughly 15 weeks. But Soso is also maintaining existing services. Effective availability is probably 60-70% of full-time, which means ~9-10 fully dedicated weeks of work.

**Not throwaway.** Team Lead confirmed the design will live for a significant time. This rules out quick hacks. The code needs to be maintainable by someone other than Soso -- which, given Soso's resignation plan, means by someone on the 12go PHP team or a future hire.

**Scope reduction is real.** gRPC can be scoped out. Booking notification can be offloaded. This means the core scope is closer to 10-11 endpoints, not 13.

**The hard parts are well-understood.** The existing C# code for the 12go integration is ~3000 lines of domain logic buried in ~300K lines of framework scaffolding. The task is fundamentally: extract and rewrite 3000 lines of translation logic as a thin HTTP service. This is achievable by one AI-augmented developer -- the question is how fast, in what language, and with what risk profile.

---

## Complexity Hotspot Assessment

Every design must handle these five non-negotiable hard parts. Here is how each design addresses them.

### 1. Booking Schema Parser (~500 lines, 20+ wildcard patterns)

| Design | Approach | Risk Assessment |
|---|---|---|
| Pragmatic Minimalist | PHP inside F3, ports the parser. Acknowledges it is the most complex single component. | Medium risk. PHP pattern matching is adequate but Soso has never written 500 lines of PHP pattern matching. AI will generate ~70-75% correctly on first try. |
| Disposable Architecture | .NET recommended (language-agnostic design). Parser lives in `Adapters/Outbound/TwelveGo/Mappers/BookingSchemaMapper.cs`. Explicitly tagged as DISPOSABLE. | Low risk if .NET, medium if PHP. The adapter boundary is clean but does not reduce parser complexity. |
| Data Flow Architect | PHP/Symfony. Parser not deeply analyzed -- focus is on events. | Medium risk. Same PHP learning curve applies. |
| Team-First Developer | PHP standalone microservice. Parser estimated at ~300-400 lines. Notes AI generates mapper tests well. | Medium risk. Good mitigation strategy (test fixtures from real 12go responses, TDD approach). |
| Platform Engineer | PHP/Symfony standalone. Notes PHP 8.3 type safety is weaker than C# for dynamic field handling. Proposes PHPStan at max level as mitigation. | Medium-High risk. The parser is where PHP's weaker typing hurts most. |
| Clean Slate | Go. Estimates parser at ~300 lines (combined parser + assembler). Acknowledges Go's JSON handling for dynamic fields is verbose. Proposes `json.RawMessage` / `map[string]interface{}`. | High risk. Go's JSON handling for dynamic bracket-notation keys is genuinely painful. This is where the "Go is great for proxies" argument breaks down. |

**Assessment:** The booking schema parser is the single highest-risk component regardless of design. In .NET, Soso could port the existing C# code with minimal changes. In PHP, AI can generate ~70-75% correctly but the edge cases in wildcard pattern matching will require manual debugging. In Go, the dynamic JSON handling adds significant friction. Every design that picks a non-.NET language adds 3-5 days of parser implementation risk.

### 2. Reserve Request Serialization (bracket notation)

| Design | Approach | Risk |
|---|---|---|
| All PHP designs | Rebuild the `FromRequestDataToReserveDataConverter` logic in PHP | Medium. The conversion logic is well-documented and can be AI-generated from the spec. |
| Clean Slate (Go) | Struct to flat key-value bracket notation | Medium-High. Go does not have a natural way to express this; it becomes manual string building. |
| Disposable (.NET) | Direct port of existing `ReserveDataRequest` serializer | Low. Copy-paste from existing codebase. |

**Assessment:** In .NET, this is a non-issue -- copy the existing code. In any other language, this is ~100 lines of well-specified transformation logic that AI can generate from the documentation. Risk is low-medium regardless.

### 3. Station ID Mapping (bidirectional, every search and booking)

All designs handle this identically: in-memory hash map loaded at startup from a static mapping file or database. This is well-understood, low-risk regardless of language.

### 4. Authentication Bridge (clientId + apiKey -> 12go apiKey)

All designs handle this as a simple config table. Low risk. The March 12 meeting clarified the approach. No design differentiates here.

### 5. Notification Transformer (12go webhook -> client format, per-client config)

All designs acknowledge this can be scoped out or offloaded. When included, it is a ~30-50 line transformation plus webhook security (IP allowlist + shared secret). Low-medium risk. The risk is operational (ensuring 12go correctly routes webhooks) rather than code complexity.

---

## Design Scoring

### Pragmatic Minimalist

**Summary:** PHP inside F3 monolith. Single deployment, leverages F3's existing infrastructure. Fallback to standalone PHP or .NET.

#### C1: Implementation Effort (x3): 3/5

The design is right that the extractable business logic is ~3000 lines. PHP inside F3 means zero new deployment infrastructure. But the practical reality for Soso:

- Week 1: Fight F3 local dev setup (again -- POC documented 16 issues). Get productive with Symfony conventions.
- Week 2-3: Implement Search endpoint inside F3. Learning PHP patterns for HTTP client, JSON manipulation, response transformation.
- Week 4-5: GetItinerary with booking schema parser. This is where the PHP learning curve hits hardest -- 500 lines of dynamic pattern matching in an unfamiliar language.
- Week 6-7: Booking funnel (CreateBooking, ConfirmBooking).
- Week 8-9: Post-booking endpoints, master data.
- Week 10+: Notifications, hardening, migration tooling.

The Search POC already proved F3 works but the local dev friction is ongoing, not one-time. Every context switch (maintain existing services, come back to F3) requires re-establishing the dev environment state.

AI assistance quality for PHP/Symfony: ~70-75% correct on first generation. That 25-30% error rate on a solo developer means manual debugging cycles that add up.

Score of 3: Achievable in Q2 but tight. Not 3-4 weeks for MVP -- more like 6-8 weeks for core endpoints.

#### C2: Solo Developer Fit (x3): 2/5

Soso has zero production PHP experience. He is a senior .NET developer being asked to work in PHP. The F3 local dev environment is documented as painful. 12go veterans are available for advice, which helps, but advice is not the same as pair programming.

AI tools help -- they turn a complete PHP beginner into a productive-but-slow PHP developer. But debugging production PHP issues at 3am? Soso would be googling "PHP-FPM 502 debugging" while under time pressure. This is not a fit issue that AI can fully compensate for.

The saving grace: the problem domain is HTTP proxying, which is conceptually identical across languages. Soso understands the domain deeply. The language is the only barrier.

Score of 2: Soso is not immediately productive. He needs 2-3 weeks to reach acceptable velocity. He cannot independently diagnose PHP-specific production issues without significant learning.

#### C6: Migration Risk (x2): 4/5

Per-endpoint migration via API Gateway routing is the safest possible approach. Old services stay live. Rollback is a gateway route revert. No local state means no data migration risk.

Inside F3 specifically: deploying new B2B endpoints alongside existing F3 code is a well-understood pattern. F3 already has B2B route structure.

The one risk: code inside F3 is coupled to F3 deployments. A bug in B2B code could theoretically be deployed as part of an unrelated F3 release, and vice versa. For a solo developer managing deployments, this coupling adds coordination overhead with the F3 team.

Score of 4: Strong migration safety. The coupling to F3 deployments is the only downside.

#### C12: Development Velocity (x1): 2/5

After initial build, every change requires:
1. Spinning up F3 local environment (or hoping it is still running)
2. Writing PHP code in a language Soso does not know deeply
3. Navigating Symfony conventions that differ from his .NET mental models
4. Deploying through F3's release process

AI generates PHP changes at ~70-75% correctness. For simple endpoint modifications, this is fine. For debugging subtle booking schema issues, the unfamiliar language slows diagnosis.

Score of 2: Changes are slower than they need to be, persistently, because of the language mismatch.

#### Timeline Estimate
- Optimistic: 8 weeks (everything goes right, F3 local dev works smoothly, AI generates clean PHP)
- Realistic: 12 weeks (F3 local dev friction, PHP learning surprises, one integration blocker with 12go API behavior)
- First Blocker: Week 2-3. F3 local dev environment breaks after a colleague's migration, requiring 1-2 days to fix. This compounds with PHP learning curve to slip the Search endpoint by a week.
- What Gets Cut First: Booking notifications (offloaded), then gRPC (scoped out). If still behind: IncompleteResults endpoint deprioritized, SeatLock deferred until 12go endpoint is ready.

---

### Disposable Architecture

**Summary:** .NET microservice (language-agnostic design, but practically .NET) with clean adapter boundaries. Outbound 12go adapter is explicitly disposable. Contract tests (Hurl files) as the most durable artifact.

#### C1: Implementation Effort (x3): 4/5

If built in .NET (which the design implicitly recommends for solo developer velocity):
- Week 1: Project skeleton, search endpoint end-to-end. Soso can copy-paste existing `OneTwoGoApi` code and response models.
- Week 2: GetItinerary with booking schema parser. Port existing C# code directly.
- Week 3: Booking funnel (CreateBooking, ConfirmBooking). Existing reserve serializer ports directly.
- Week 4: Post-booking endpoints.
- Week 5: Master data, notifications, feature flags.
- Week 6: Contract tests, migration tooling, hardening.

The adapter boundary pattern adds ~20% upfront work (defining interfaces, separating domain types from 12go types). But this is exactly the kind of structural work AI excels at -- "create an interface matching these method signatures, create a domain type matching this shape."

The real question: does the adapter boundary pattern pay for itself during the build phase? For a solo developer under deadline pressure, interfaces with single implementations feel like overhead. But the design correctly identifies that the 12go adapter is disposable -- when F3 changes, only one directory changes.

Score of 4: MVP in 4-5 weeks if .NET. The adapter boundary adds a week but is reasonable. If PHP is mandated instead, this drops to 3/5.

#### C2: Solo Developer Fit (x3): 4/5

In .NET: Soso is immediately productive on day 1. He has 12 years of experience. He can debug production issues alone. The patterns (ASP.NET Minimal APIs, HttpClient, xUnit) are deeply familiar.

The design's adapter boundary pattern (IBookingGateway, domain types, separated adapters) is standard .NET architecture that Soso knows well. AI tools generate excellent .NET code for this pattern.

The deduction from 5: the adapter pattern is slightly more complex than a raw pass-through proxy. And .NET is not what the 12go team can maintain after Soso leaves -- but that is a strategic concern, not a solo developer fit concern.

Score of 4: Soso is immediately productive. Can debug production issues alone. Strong AI support.

#### C6: Migration Risk (x2): 4/5

Per-client and per-endpoint feature flags with database-stored flags. Both old and new systems run simultaneously. Rollback is a flag flip.

The feature flag router adds complexity that a raw gateway routing approach does not have. During the "both systems running" phase, some clients on old, some on new, some partially migrated -- this is real operational complexity for one person. But the safety is worth the complexity.

Score of 4: Excellent safety. Feature flag router is powerful but adds operational overhead for a solo developer.

#### C12: Development Velocity (x1): 4/5

In .NET: endpoint changes take hours. AI generates the change, Soso reviews. The adapter boundary means changes to 12go-facing logic are confined to one directory. The clean separation makes AI navigation effective.

Score of 4: Fast iteration in .NET. The adapter boundary helps AI understand the codebase structure.

#### Timeline Estimate
- Optimistic: 5 weeks (Soso ports existing C# code, AI generates adapter structure, everything clicks)
- Realistic: 7-8 weeks (one blocker with contract test tooling setup, one ramp-up on Hurl files, context-switching overhead)
- First Blocker: Week 3. The booking schema parser port works for the happy path but breaks on an edge case with a specific 12go operator's checkout fields. Debugging requires comparing old and new behavior side-by-side, which means running both systems simultaneously. 2-3 day slip.
- What Gets Cut First: Contract tests (Hurl files) get deferred from "build with MVP" to "add after MVP works." This reduces the disposability value but does not block Q2. Then gRPC, then notifications.

---

### Data Flow Architect

**Summary:** PHP/Symfony. Primary focus is on event emission and data pipeline preservation. Recommends structured logs as the event transport.

#### C1: Implementation Effort (x3): 2/5

This design asks Soso to build the same PHP proxy as the other PHP designs, PLUS a comprehensive event emission system with 17+ event types, structured log pipeline configuration, correlation ID propagation to ClickHouse, and data team coordination.

The event audit is thorough and valuable as documentation. But it massively increases scope for a solo developer:
- Defining 17 event schemas
- Implementing post-response event emission for every endpoint
- Configuring Datadog log pipeline rules
- Coordinating with the data team (unresolved action item from Feb 25)
- Verifying ClickHouse ingestion

The structured logs approach (emit JSON, let Datadog route to ClickHouse) is the simplest option and the design correctly identifies this. But "simplest" is still significant work on top of the core proxy build.

The data team coordination is a blocking dependency that is not in Soso's control. If the data team call does not happen, Soso cannot finalize event schemas, and the entire event pipeline is built on assumptions.

Score of 2: The core proxy is the same effort as other PHP designs (6-8 weeks). The event emission adds 2-3 weeks. Total: 8-11 weeks. This pushes hard against Q2.

#### C2: Solo Developer Fit (x3): 2/5

Same PHP learning curve as other PHP designs. Plus: Soso must understand Datadog log pipeline configuration, ClickHouse ingestion patterns, and Symfony's `kernel.terminate` event lifecycle. These are 12go infrastructure details that Soso has no experience with.

Score of 2: PHP + unfamiliar observability infrastructure.

#### C6: Migration Risk (x2): 3/5

The design does not deeply address migration strategy beyond the event pipeline. It assumes the same per-endpoint migration as other designs. The event pipeline introduces its own migration risk: old events (Kafka topics) versus new events (structured logs). During migration, some endpoints emit old-style events, some emit new-style. The data team needs to handle both.

Score of 3: Adequate migration safety for the proxy. Event pipeline transition adds its own risk.

#### C12: Development Velocity (x1): 2/5

Same PHP velocity constraints as other PHP designs. Plus: every endpoint change requires updating the event schema and verifying the log pipeline. The event emission is tightly coupled to endpoint implementation.

Score of 2: Changes are slower because of the dual concern (proxy logic + event emission).

#### Timeline Estimate
- Optimistic: 9 weeks (proxy + events, Soso is focused, data team provides requirements quickly)
- Realistic: 13-14 weeks (data team coordination delays event schema finalization, PHP learning curve, one ClickHouse ingestion issue)
- First Blocker: Week 4-5. Data team call finally happens and reveals that 3 of the proposed event schemas are missing fields the performance dashboard requires. Redesign of event schemas costs 1 week.
- What Gets Cut First: Event emission for low-criticality endpoints (master data, incomplete results). Then booking notifications. Then the Kafka upgrade path. Core proxy without events ships first; events are added incrementally.

---

### Team-First Developer

**Summary:** Standalone PHP/Symfony microservice (NOT inside F3). Optimizes for post-Soso maintainability by the 12go PHP team. Detailed AGENTS.md specification for AI-assisted maintenance.

#### C1: Implementation Effort (x3): 3/5

Same PHP learning curve as Pragmatic Minimalist, but WITHOUT the F3 local dev friction. A standalone Symfony project with Docker Compose is genuinely simpler to set up and maintain than working inside F3.

Timeline:
- Week 1-2: PHP/Symfony ramp-up, project setup, Docker Compose, Search endpoint.
- Week 3-4: GetItinerary with booking schema parser (the hard part in PHP).
- Week 5-6: Booking funnel, post-booking endpoints.
- Week 7-8: Master data, notifications, hardening.

The standalone approach saves ~1 week versus F3 monolith by avoiding F3 local dev friction. But PHP learning curve remains the same.

The AGENTS.md specification is a clever idea that costs ~half a day to write and pays dividends for AI-assisted maintenance. This is essentially free velocity.

Score of 3: Achievable in Q2. Standalone PHP is faster than F3 monolith by ~1 week. Still limited by PHP learning curve.

#### C2: Solo Developer Fit (x3): 2/5

Same PHP score as other PHP designs. Soso is a .NET developer writing PHP. The standalone setup helps (no F3 env issues) but the language barrier remains.

The design honestly acknowledges this: "PHP will be slower for Soso to build in. He will spend 2-3 weeks getting productive."

The AGENTS.md and comprehensive test fixtures partially compensate by making AI more effective. But they do not change the fact that Soso is debugging PHP at 3am.

Score of 2: PHP learning curve is real. Standalone setup helps but does not change the language barrier.

#### C6: Migration Risk (x2): 4/5

Same per-endpoint gateway routing as Pragmatic Minimalist. Old services stay live. No local state. Easy rollback.

The standalone deployment gives an advantage over the monolith approach: B2B deployments are fully independent of F3. No risk of coupling. Soso controls his own release cycle.

Score of 4: Clean migration with independent deployment.

#### C12: Development Velocity (x1): 3/5

Better than F3 monolith approaches because:
- Standalone service: fast local dev loop (no F3 dependencies)
- AGENTS.md: AI can navigate the codebase more effectively
- Pure mapper pattern: AI generates well

Worse than .NET approaches because PHP learning curve persists.

Score of 3: Reasonable velocity after the initial ramp-up period.

#### Timeline Estimate
- Optimistic: 7 weeks (Soso picks up PHP quickly, AI generates most mappers, standalone setup is frictionless)
- Realistic: 10 weeks (PHP learning takes full 3 weeks, one booking schema parser edge case, context-switching overhead)
- First Blocker: Week 3. Booking schema parser in PHP -- the dynamic field extraction with 20+ wildcard patterns. AI generates ~70% correctly, but the remaining patterns require manual debugging in an unfamiliar language. 3-4 day slip.
- What Gets Cut First: Booking notifications (offloaded). Then gRPC. Then WireMock integration tests (replaced with simpler fixture-based tests).

---

### Platform Engineer

**Summary:** Standalone PHP/Symfony. Detailed operational specification: Docker images, health checks, CI/CD pipeline, Datadog APM, on-call runbook. Strongest infrastructure design.

#### C1: Implementation Effort (x3): 3/5

Same core proxy effort as Team-First Developer (standalone PHP/Symfony). The operational specifications (Dockerfile, health checks, CI/CD, monitoring) are additional work but much of it is infrastructure boilerplate that DevOps can help with.

The comprehensive monitoring design (custom metrics, alerting thresholds, correlation ID propagation) is valuable for production but adds ~1 week of implementation on top of the core proxy.

Score of 3: Same PHP proxy effort plus operational infrastructure. The operational work can be parallelized with DevOps support.

#### C2: Solo Developer Fit (x3): 2/5

Same PHP score as all PHP designs. The operational infrastructure (Datadog APM, DogStatsD, nginx configuration) adds more unfamiliar technology. Soso has never configured `dd-trace-php` or written PHP-FPM pool configurations.

However: DevOps can handle most of the infrastructure configuration. Soso's responsibility is the application code.

Score of 2: PHP + operational infrastructure unfamiliarity. DevOps can help with the infrastructure parts.

#### C6: Migration Risk (x2): 4/5

Same clean migration as Team-First Developer. Independent deployment. Gateway routing.

The on-call runbook is a genuine migration safety feature -- it means the on-call engineer knows what to do when the new service breaks, without needing to call Soso.

Score of 4: Strong migration safety with operational readiness.

#### C12: Development Velocity (x1): 3/5

Same as Team-First Developer. Standalone PHP with Docker Compose.

Score of 3: Same velocity profile.

#### Timeline Estimate
- Optimistic: 7 weeks (proxy + basic monitoring, DevOps handles infrastructure)
- Realistic: 10 weeks (same PHP learning curve, plus operational configuration takes longer than expected)
- First Blocker: Week 2. Setting up `dd-trace-php` auto-instrumentation in the standalone Docker container -- configuration that works in F3 does not automatically work in a standalone service. 2-day detour.
- What Gets Cut First: Custom metrics and alerting (use Datadog APM auto-metrics first). Then notifications. Then detailed on-call runbook (write after go-live based on actual incidents).

---

### Clean Slate Designer

**Summary:** Go microservice. First-principles design. ~2000 lines of Go code. Minimal layers. No framework.

#### C1: Implementation Effort (x3): 2/5

Go is the highest-risk language choice for Soso. Zero production Go experience on the team. The design estimates 1500-2000 lines of Go, which is accurate for the happy path. But:

- Week 1-2: Go language ramp-up. Soso must learn: goroutines, error handling patterns (`if err != nil`), struct tags for JSON, Go module system, testing conventions. AI accelerates this but does not eliminate it.
- Week 3-4: HTTP server + search endpoint. Go's `net/http` is simple, but Soso will fight unfamiliar patterns (handler signatures, middleware chaining, context propagation).
- Week 5-7: Booking schema parser in Go. This is where the design falls down. Go's JSON handling for dynamic bracket-notation keys requires `map[string]interface{}`, type assertions, and manual key iteration. The existing 500-line C# parser with `JsonExtensionData` becomes ~300-400 lines of Go that is harder to read, harder to debug, and harder for AI to generate correctly.
- Week 8-10: Remaining endpoints, operational tooling.

The design honestly acknowledges missing pieces: "no metrics, no tracing, no structured logging" -- these must be added. That is another 200-300 lines and 1-2 weeks.

The design also ignores event emission entirely ("What This Design Ignores" section), which means the data team's needs are unaddressed.

Score of 2: Achievable but slow. Go learning curve + dynamic JSON handling friction + missing operational infrastructure. 10+ weeks for MVP.

#### C2: Solo Developer Fit (x3): 1/5

Soso has zero Go experience. The team has zero Go experience. 12go has zero Go production code. There is no one to ask for help.

Go is simple to learn for basic programs. But production Go -- connection pooling, context cancellation, goroutine leak prevention, proper error wrapping, pprof debugging -- requires experience that reading documentation does not provide.

AI generates decent Go code for HTTP handlers and struct definitions. But for debugging production issues? Soso would be completely lost. A Go panic stack trace, a goroutine leak, a `context.DeadlineExceeded` cascading through handlers -- these require Go expertise that Soso does not have.

The design's argument that "AI-assisted development neutralizes the learning curve" is optimistic. AI neutralizes the syntax learning curve. It does not neutralize the operational learning curve.

Score of 1: Soso cannot independently diagnose and fix production Go issues. Nobody on the team can. This is the highest solo-developer risk of any design.

#### C6: Migration Risk (x2): 3/5

Same per-endpoint gateway routing as other microservice designs. Old services stay live. No local state.

But: introducing Go into an all-PHP infrastructure means DevOps must learn new tooling for one service. During migration, if the Go service has operational issues, the debugging chain breaks -- nobody knows Go.

Score of 3: Migration mechanics are fine. Operational risk during and after migration is elevated due to unfamiliar technology.

#### C12: Development Velocity (x1): 2/5

After initial build, Go changes are reasonably fast for a Go developer. For Soso -- still learning Go -- changes will be slower than necessary.

AI generates Go endpoint code well. But every change to the booking schema parser or dynamic JSON handling requires manual intervention because AI's Go JSON code is often not idiomatic.

Score of 2: Slower than .NET, on par with PHP for Soso's specific skill profile.

#### Timeline Estimate
- Optimistic: 8 weeks (Soso picks up Go fast, AI generates most handlers, dynamic JSON is manageable)
- Realistic: 13-14 weeks (Go learning takes 3 weeks to productive, booking schema parser is a 2-week effort in Go, operational infrastructure adds 2 weeks, context-switching overhead)
- First Blocker: Week 4-5. Booking schema parser in Go. The dynamic bracket-notation field extraction that uses `JsonExtensionData` in C# has no clean Go equivalent. Soso spends 5-7 days trying different approaches (`map[string]json.RawMessage`, `gjson`, manual iteration). The first working version has bugs with nested passenger fields.
- What Gets Cut First: Observability (no metrics, no tracing -- ship without it, add post-launch). Then notifications. Then master data endpoints (serve static files instead of computed responses).

---

## Comparative Scoring Matrix

| Design | C1 Effort (x3) | C2 Solo Fit (x3) | C6 Risk (x2) | C12 Velocity (x1) | Weighted Total |
|---|---|---|---|---|---|
| Pragmatic Minimalist (PHP/F3) | 3 (9) | 2 (6) | 4 (8) | 2 (2) | **25** |
| Disposable Architecture (.NET) | 4 (12) | 4 (12) | 4 (8) | 4 (4) | **36** |
| Data Flow Architect (PHP) | 2 (6) | 2 (6) | 3 (6) | 2 (2) | **20** |
| Team-First Developer (PHP standalone) | 3 (9) | 2 (6) | 4 (8) | 3 (3) | **26** |
| Platform Engineer (PHP standalone) | 3 (9) | 2 (6) | 4 (8) | 3 (3) | **26** |
| Clean Slate (Go) | 2 (6) | 1 (3) | 3 (6) | 2 (2) | **17** |

Maximum possible weighted total for these 4 criteria: (5x3) + (5x3) + (5x2) + (5x1) = 15 + 15 + 10 + 5 = **45**

---

## Cross-Design Observations

### 1. The language decision dominates everything

Every PHP design scores identically on Solo Developer Fit (2/5). Every PHP design has the same ~2-3 week ramp-up overhead. This is not a design difference -- it is a language decision that cascades through every score. The Disposable Architecture design, by allowing .NET, gains 6 weighted points on Solo Developer Fit alone.

### 2. The booking schema parser is every design's chokepoint

Regardless of language, architecture, or framework, every design must implement the ~500-line booking schema parser with 20+ wildcard patterns. In .NET, Soso can port existing code. In PHP, it is 3-5 days of AI-assisted development plus debugging. In Go, it is a 5-7 day effort with real risk of bugs. This single component accounts for ~20% of the variation in timelines across designs.

### 3. F3 monolith vs standalone microservice matters more than the designs suggest

The Pragmatic Minimalist (inside F3) loses ~1 week to F3 local dev friction compared to standalone PHP designs (Team-First, Platform Engineer). This is not a one-time cost -- it recurs every time Soso context-switches away from and back to F3 development. Over a 10-week project, this accumulates to a significant velocity penalty.

### 4. Event emission is scope creep, not architecture

The Data Flow Architect design adds 2-3 weeks of event emission work. This is real and necessary work, but it is orthogonal to the proxy architecture. Any design can emit structured logs after the proxy works. Baking it into the core design inflates implementation effort without changing the proxy's architecture.

### 5. The operational infrastructure is largely design-independent

Datadog APM, health checks, CI/CD pipelines, Docker images -- all of these are operational concerns that DevOps handles. The Platform Engineer design is the most thorough here, but any PHP standalone design gets the same operational benefits. The operational design is a deployment concern, not an architecture concern.

### 6. Contract tests are nice-to-have, not MVP-blocking

The Disposable Architecture design's Hurl contract tests are the most durable artifact concept in any design. But for a solo developer under Q2 deadline pressure, writing Hurl files for 13 endpoints is 2-3 days of work that competes with building the endpoints themselves. In practice, contract tests get deferred. This is fine -- they can be added post-MVP.

---

## Execution Recommendation

**The Disposable Architecture design, implemented in .NET, is the one Soso can actually ship by Q2.**

Here is why, grounded in execution reality rather than architectural preference:

**1. Speed to MVP.** Soso can port existing C# code on day 1. The `OneTwoGoApi` class, request/response models, booking schema parser, and reserve serializer -- all of this is directly portable. AI assists with the adapter boundary scaffolding. MVP in 5 weeks is realistic.

**2. Solo developer fit.** Soso is immediately productive. He can debug production issues at 3am. He does not need to learn a new language under deadline pressure. His 12 years of .NET experience is his strongest asset -- forcing him onto PHP wastes that asset.

**3. The adapter boundary pattern is worth the overhead.** The clean separation between domain logic and 12go-specific code means: (a) when 12go's API changes during F3 decomposition, only one directory changes, (b) AI can navigate the codebase because the boundaries are explicit, and (c) the code is portable -- if the team later decides to rewrite in PHP, the domain types and contract tests transfer.

**4. The orphan service risk is real but manageable.** Yes, the 12go team cannot maintain .NET code. But the service is ~3000-5000 lines of translation logic. It is not complex software. A future developer (in any language) can understand what it does by reading the contract tests and adapter interfaces. The Team Lead's concern about maintainability is valid but secondary to the Q2 deadline.

**5. What gets cut.** gRPC (Team Lead approved scoping out). Booking notifications (offloaded). Contract tests (deferred to post-MVP). Event emission (structured logs, added after core proxy works). This leaves 10 core endpoints, achievable in 5-7 weeks.

### The honest trade-off

Choosing .NET means Soso builds faster, ships on time, and the organization inherits a .NET service that nobody on the 12go team can maintain. Choosing PHP means Soso builds 3-4 weeks slower, risks missing Q2, and the organization gets a service the 12go team can maintain.

The Q2 deadline tips the scale. A shipped .NET service that works is better than an unfinished PHP service. After Soso ships, the team has a working system and a comprehensive set of transformation rules (encoded in code and tests) that can be rewritten in PHP at leisure -- without deadline pressure, by someone who knows PHP.

**If Team Lead mandates PHP:** The Team-First Developer design (standalone PHP microservice, NOT inside F3) is the second-best option. It avoids F3 local dev friction, gives a clean inner loop, and is maintainable by the 12go team. Timeline: 10 weeks realistic, which just barely fits Q2 if scope is reduced and Soso starts immediately.
