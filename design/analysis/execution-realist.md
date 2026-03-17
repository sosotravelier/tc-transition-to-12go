---
status: draft
last_updated: 2026-03-17
agent: execution-realist
---

# Execution Realist Analysis

## Team Reality Check

Everything below flows from these facts:

**One developer. Soso.** Twelve years of .NET. Two years at the company. Senior-level. No production experience in PHP, Go, or TypeScript. This is the person who will write every line of code, debug every production issue, manage every client cutover, and handle every incident -- alone.

**AI tools are real but not unlimited.** Soso uses Claude Code with multi-agent workflows daily. This is a genuine productivity multiplier -- probably 2-3x for well-understood problem domains. For unfamiliar languages, AI closes perhaps 60-70% of the gap in the first two weeks but cannot replace the debugging instincts that come from years of production experience. When a booking fails at 2am and the stack trace is in PHP, AI helps with syntax but not with "I have seen this pattern before."

**Context-switching is the silent killer.** Soso is maintaining existing services while building the replacement. Every context switch between old .NET services and new code costs 30-60 minutes of re-orientation. With a different language for the new service, every switch also involves a mental language swap. Over a 10-week project, this adds up to weeks of lost productivity.

**Q2 2026 means roughly 10-12 working weeks from decision.** Assuming an architecture decision by end of March 2026 and Q2 meaning June 30, that is 13 calendar weeks. Subtract 1-2 weeks for ramp-up, investigation, and environment setup. Subtract ongoing maintenance of existing services (call it 20% overhead). Effective development time: approximately 8-9 full weeks of focused coding.

**Team Lead provides oversight, not code.** Decisions must be escalated. Code review is available but not deep technical review in PHP or Go. The feedback loop on "is this PHP idiomatic?" is slow (12go veterans are advisory, not sitting next to Soso).

**The developer plans to leave after completion.** This is not a factor in scoring execution speed, but it matters for migration risk: whoever inherits this system will not have the builder available for knowledge transfer beyond documentation.

## Complexity Hotspot Assessment

These five hotspots are the actual hard parts. Every design must address them. Here is how each design handles them -- or does not.

### Booking Schema Parser (~500 lines, 20+ wildcard patterns)

This is the single most complex piece of code in the entire transition. It parses dynamic checkout fields with keys like `selected_seats_TH013r013800Cb00603SPY6d` and maps them to normalized names. The current C# implementation uses `[JsonExtensionData]` with regex-like pattern matching.

| Design | Approach | Risk Assessment |
|--------|----------|-----------------|
| **Pragmatic Minimalist** | Port to PHP inside F3. Acknowledges this is the hardest part (~500 lines). | Honest about difficulty. PHP arrays handle dynamic JSON well, but debugging edge cases without C# type safety is harder. |
| **Clean Slate** | Port to Go with `map[string]interface{}`. Estimates ~300-400 lines. | Underestimates. Go's JSON handling for dynamic keys is more verbose than C#'s `[JsonExtensionData]`. Closer to 500-600 lines in Go. |
| **Platform Engineer** | Port to PHP standalone service. Same complexity as Pragmatic Minimalist. | Same risk as Pragmatic Minimalist, with the added friction of setting up a new PHP project from scratch. |
| **Data Flow Architect** | Does not specifically address the parser -- focuses on event emission around it. | The parser is assumed handled by whatever language is chosen. Not a gap, but not a contribution either. |
| **Team-First Developer** | Port to PHP inside F3. Recommends fixture-driven AI translation from C# test cases. | Best approach to the porting process. Using existing test fixtures as the specification is exactly right. |
| **Disposable Architecture** | Places parser in the "disposable" adapter layer. Estimates ~1,180 lines. | Most honest about actual size. The adapter boundary is good architecture but does not reduce the porting effort. |

**Bottom line:** No design makes this easy. The best mitigation is the Team-First Developer's fixture-driven approach: extract the existing C# test fixtures, use them as input/output specifications, and have AI generate the target-language implementation. This works in any language. Estimated effort for a solo developer: 3-5 days regardless of language, with 1-2 more days chasing edge cases in production.

### Reserve Request Serialization (bracket notation)

Custom flat key-value format: `passenger[0][first_name]`, `contact[email]`, `selected_seats_*`. The current C# uses a custom `JsonConverter`.

All designs handle this similarly -- it is a well-specified transformation. Estimated effort: 1-2 days in any language. AI generates correct bracket-notation serialization reliably. The risk is not in the initial implementation but in missing conditional fields (baggage, seat type, ID scan) that only appear for specific operators.

### Station ID Mapping (Fuji IDs to 12go IDs)

Every search request and response depends on this. The mapping data lives in Fuji's DynamoDB tables (out of scope but required).

| Design | Approach |
|--------|----------|
| Most designs | Static JSON file loaded at startup, bidirectional hash map |
| PHP designs (F3 monolith) | Per-request loading from Redis or database, since PHP-FPM has no persistent memory |

**The PHP per-request loading problem is real and underappreciated.** With standard PHP-FPM, thousands of station mappings must be loaded on every request. Options: Redis lookup, shared memory (APCu), or switching to a persistent PHP worker (Swoole/RoadRunner). The Clean Slate (Go) and any .NET approach handle this trivially with in-memory maps. This is a genuine performance concern for PHP approaches, adding 2-5ms per request for Redis lookups on the hot search path.

### Authentication Bridge (clientId + apiKey to 12go apiKey)

Simple mapping table with 20-30 entries. All designs handle this identically: config file or database table, loaded at startup or cached. Estimated effort: half a day. Not a complexity hotspot in practice.

### Notification Transformer (webhook shape transformation)

12go webhook format to client expected format, per-client config. All designs handle this as a straightforward JSON transformation with booking ID resolution. The Mar 17 meeting indicated this could be offloaded. Estimated effort if kept: 2-3 days including the webhook receiver endpoint. This is a strong candidate for scope reduction.

## Design Scoring

### Pragmatic Minimalist (PHP/Symfony inside F3)

#### C1: Implementation Effort (x3): 3/5

PHP inside F3 means Soso works in an unfamiliar language inside a large unfamiliar codebase. The Search POC is done, which proves the approach works, but extending from 1 endpoint to 13 while learning PHP conventions is a steep ramp. The first 2-3 weeks will be at 40-60% of normal productivity. AI helps with syntax but not with F3 navigation. However, this design correctly identifies that the total code is small (~2,500-3,500 lines) and that no local persistence eliminates a huge chunk of complexity. The self-critique section is unusually honest -- acknowledging the booking schema parser difficulty and the station ID mapping elephant. Realistic for a solo developer to complete in 8-10 weeks with scope reduction.

#### C2: Solo Developer Fit (x3): 2/5

Soso has zero PHP production experience. The F3 local environment is documented as painful. Every PHP debugging session will be slower than the equivalent .NET session for at least the first 4-6 weeks. AI narrows the gap but does not close it -- when a Symfony service container throws a cryptic error at runtime, Soso cannot pattern-match against 12 years of experience. The 12go veteran support is real but asynchronous (advisory, not pair programming). Score reflects that Soso will be a beginner PHP developer for the duration of this project.

#### C6: Migration Risk (x2): 4/5

Strong per-client rollout plan. Old system stays live. Rollback is a routing change. No local database means no data migration. The Lambda authorizer concern is flagged as an open question (good -- most designs gloss over this). One person can manage the cutover safely because 12go is the source of truth for all data. The risk is that gateway routing for per-client migration has not been investigated yet and could be a blocker.

#### C12: Development Velocity (x1): 3/5

After the initial ramp-up, PHP inside F3 provides reasonable velocity. Symfony's conventions are well-known to AI tools. Changing an endpoint is straightforward once the patterns are established. But velocity in the first month is significantly lower than .NET would be.

#### Timeline Estimate
- **Optimistic**: 8 weeks (Soso adapts to PHP quickly, F3 environment cooperates, AI assistance works well)
- **Realistic**: 12 weeks (PHP ramp-up takes 3 weeks instead of 2, F3 local dev friction costs 1 week, gateway routing investigation takes 1 week)
- **First Blocker**: Week 2-3 -- F3 local development environment breaks during a Symfony update or migration issue. Soso loses 2-3 days debugging infrastructure instead of writing business logic. This happened during the Search POC and will happen again.
- **What Gets Cut First**: Booking notification transformer. It is a separate topology, confirmed as offloadable in the Mar 17 meeting. gRPC module is already scoped out.

---

### Clean Slate Designer (Go standalone microservice)

#### C1: Implementation Effort (x3): 3/5

Go is genuinely simple for this type of problem. The design correctly estimates ~2,000 lines of application code and ~35 files. A single binary with no framework is attractive. However, Soso has never written production Go. The learning curve is real -- not for syntax (Go is learnable in days) but for production patterns: error handling idioms, testing conventions, module management, Datadog APM integration. The 4-6 week estimate for 13 endpoints is optimistic for a first-time Go developer. Also, deploying Go on 12go's PHP-centric infrastructure requires DevOps to learn a new runtime -- this is unplanned work by a team that is not allocated to this project.

#### C2: Solo Developer Fit (x3): 1/5

This is the critical weakness. Soso has zero Go experience. Nobody on the team writes Go. Nobody on 12go's DevOps team has operated Go in production. When a Go service panics at 2am with a goroutine stack trace, nobody in the organization can diagnose it without reaching for documentation. AI tools generate correct Go for simple patterns, but debugging production Go requires experience that does not exist in this organization. The "consider it Soso's service maintained by Soso" caveat in the design is exactly the problem -- Soso is leaving after completion.

#### C6: Migration Risk (x2): 4/5

Same strong per-client migration story as other designs. Stateless, 12go is source of truth, easy rollback. The in-memory state for booking schema mappings is a concern for multi-instance deployment but not for initial rollout. The organizational risk is higher -- a Go service against the "one system" direction creates friction that could slow down approvals and deployments.

#### C12: Development Velocity (x1): 3/5

Go's simplicity means high velocity once learned. After the ramp-up period, changing an endpoint is fast. AI generates correct Go HTTP handlers reliably. But the ramp-up period for a solo developer is the entire Q2 timeline.

#### Timeline Estimate
- **Optimistic**: 7 weeks (Go's simplicity pays off, Soso learns fast, DevOps is cooperative)
- **Realistic**: 14 weeks (Go ramp-up takes 3 weeks, DevOps integration takes 2 weeks of back-and-forth, booking schema parser in Go takes longer than estimated)
- **First Blocker**: Week 2 -- Deploying the Go binary on 12go's infrastructure. DevOps has no Dockerfile template, no health check convention, no Datadog APM setup for Go. Soso writes tickets, waits for DevOps. This blocks integration testing by 1-2 weeks.
- **What Gets Cut First**: The same as all designs -- notification transformer and gRPC. But with Go, the Datadog observability is also likely to be minimal at launch (manual instrumentation required, vs. automatic in PHP).

---

### Platform Engineer (PHP/Symfony standalone service)

#### C1: Implementation Effort (x3): 3/5

Same PHP learning curve as Pragmatic Minimalist, but with the overhead of setting up a new standalone Symfony project from scratch. The upside is a smaller, focused codebase without F3's complexity. The Dockerfile, CI pipeline, and deployment configuration are all specified in detail -- this is the most deployment-ready design. But Soso must set all of this up, and for a solo developer, every hour spent on infrastructure is an hour not spent on business logic.

#### C2: Solo Developer Fit (x3): 2/5

Same PHP unfamiliarity as the monolith designs, with one advantage: the standalone codebase is small and focused. Soso does not need to navigate F3's large codebase. The disadvantage: F3 feature work (cancellation policies) still requires working in F3, so Soso maintains two PHP codebases instead of one. This partially negates the benefit.

#### C6: Migration Risk (x2): 4/5

Excellent migration story with detailed nginx per-client routing configuration, specific rollback mechanisms, and in-flight booking safety analysis. The separate container provides blast radius isolation -- a crash in the B2B service does not affect F3. This is a genuine operational advantage over the monolith approach.

#### C12: Development Velocity (x1): 3/5

Similar to Pragmatic Minimalist. Standalone Symfony with Datadog auto-instrumentation means the feedback loop is fast after setup. The detailed runbook and alerting specification means operational issues are handled faster. But there is a two-codebase overhead for a solo developer.

#### Timeline Estimate
- **Optimistic**: 9 weeks (standalone setup takes 1 week, then similar pace to monolith)
- **Realistic**: 13 weeks (standalone setup takes 2 weeks, PHP ramp-up same as monolith, two-codebase context switching adds 1 week)
- **First Blocker**: Week 1-2 -- Setting up the standalone PHP Symfony project with Datadog, Docker, and CI pipeline on 12go's infrastructure. This is all specified in the design, but someone has to actually do it, and that someone is a .NET developer who has never configured PHP-FPM.
- **What Gets Cut First**: Notification transformer (offloaded), then the detailed observability specification (basic logging instead of full DogStatsD metrics).

---

### Data Flow Architect (PHP/Symfony, event-focused)

#### C1: Implementation Effort (x3): 2/5

This design adds substantial scope to the transition: 14 structured events must be preserved, each with a specific schema, emission timing, and error handling. The design correctly identifies that a naive proxy loses all event visibility, but solving this problem adds 2-3 weeks of work. The solo developer now builds 13 endpoints AND an event emission layer. The recommendation to use structured logs instead of Kafka is pragmatic and saves significant effort, but the event schemas themselves are detailed work. For a Q2 deadline with one developer, this is scope creep -- important scope creep, but scope creep nonetheless.

#### C2: Solo Developer Fit (x3): 2/5

Same PHP learning curve. The additional event emission work does not change the language fit. However, the data team coordination (identifying which events are needed, verifying 12go coverage, working with ClickHouse) is exploration work that Soso explicitly said he does not want to own. This design assumes Soso will do it anyway.

#### C6: Migration Risk (x2): 3/5

Good per-client migration plan with event continuity at every stage. But the additional event emission complexity means more things can go wrong during cutover. If an event schema is wrong, the data team's dashboards break silently -- this is invisible to Soso during testing and visible only after production traffic flows through.

#### C12: Development Velocity (x1): 2/5

Every endpoint now requires implementing the HTTP handler, the 12go client call, the response transformation, AND the event emission with the correct schema. This multiplies the work per endpoint. Post-MVP velocity is also lower because every change to an endpoint requires updating the event schema.

#### Timeline Estimate
- **Optimistic**: 10 weeks (structured logs are easy, event schemas are defined upfront)
- **Realistic**: 15 weeks (data team coordination takes 2 weeks, event schema iteration takes 2 weeks on top of the base implementation)
- **First Blocker**: Week 3 -- Data team requirements are unclear. The call with the data team is pending (as of Mar 12). Until Soso knows exactly which events are needed and what dimensions the dashboards depend on, the event schemas cannot be finalized. This blocks a significant portion of the work.
- **What Gets Cut First**: The event emission itself. If the timeline slips, Soso ships the proxy endpoints without events and adds events as a follow-up. This is the design's own recommended fallback (structured logs are additive).

---

### Team-First Developer (PHP/Symfony inside F3)

#### C1: Implementation Effort (x3): 3/5

Very similar to Pragmatic Minimalist -- PHP inside F3 monolith. The distinguishing contribution is the AI-augmented development assessment and the fixture-driven porting strategy. The AGENTS.md specification for the B2B module is a genuinely useful idea that reduces AI ramp-up time for the codebase. The phased build order is realistic. But the underlying effort is the same: one developer learning PHP while building 13 endpoints.

#### C2: Solo Developer Fit (x3): 2/5

Identical to Pragmatic Minimalist. The design is brutally honest about this: "No option makes a solo developer happy." The 2-4 week PHP learning curve is acknowledged as real pain. The morale assessment is accurate -- short-term pain, medium-term improvement as organizational friction reduces.

#### C6: Migration Risk (x2): 4/5

Per-client feature flag inside F3's existing `ApiAgent` system. This is the simplest rollout mechanism of any design -- no Lambda authorizer, no nginx routing, just a config flag per client. Rollback is flipping the flag. The in-flight booking safety analysis is thorough.

#### C12: Development Velocity (x1): 3/5

Same as Pragmatic Minimalist. The AGENTS.md specification and the fixture-driven testing approach may provide a slight velocity advantage after the initial setup, but the difference is marginal.

#### Timeline Estimate
- **Optimistic**: 8 weeks (same as Pragmatic Minimalist)
- **Realistic**: 11 weeks (fixture-driven approach saves 1 week on booking schema parser compared to manual porting)
- **First Blocker**: Week 2 -- Same as Pragmatic Minimalist. F3 local development environment friction. Additionally, figuring out where to place the B2B module within F3's existing directory structure and routing configuration takes longer than expected.
- **What Gets Cut First**: Notification transformer (offloaded). The AGENTS.md specification is written early and maintained throughout.

---

### Disposable Architecture (adapter boundary pattern)

#### C1: Implementation Effort (x3): 2/5

The design adds an abstraction layer that a pure proxy does not need: outbound port interfaces, domain model types, and a formal adapter boundary. For a 13-endpoint HTTP proxy that needs to ship in Q2, defining `ITravelProvider`, `IBookingProvider`, and `IPostBookingProvider` interfaces plus domain model types before writing any integration code adds 1-2 weeks of upfront work. The design acknowledges this trade-off ("sacrifices initial build speed") but does not adequately weigh it against the Q2 deadline. The adapter pattern is architecturally sound for the long term but expensive for a solo developer under time pressure.

#### C2: Solo Developer Fit (x3): 2/5

The design is language-agnostic, which means it does not fully commit to a stack. It leans toward .NET for boundary enforcement (strongest type safety) and PHP for organizational alignment -- but this ambiguity means Soso must make the language decision separately. The adapter pattern adds cognitive overhead: every endpoint requires thinking about which layer handles which transformation. For a solo developer, the "just proxy it" approach of simpler designs is more cognitively manageable.

#### C6: Migration Risk (x2): 4/5

Good per-client rollout with the `b2b_client_config` MariaDB table. The contract testing strategy (inbound contract tests that survive F3 decomposition) is the most thoughtful of any design. The practical cutover mechanism is sound.

#### C12: Development Velocity (x1): 2/5

The adapter pattern slows velocity on every endpoint. Each endpoint requires: inbound handler, domain type mapping, outbound port call, adapter implementation, 12go client call, response mapping back through domain types. This is 3 layers instead of 2. After MVP, the adapter boundary makes changes cleaner -- but getting to MVP is the constraint.

#### Timeline Estimate
- **Optimistic**: 10 weeks (upfront domain modeling pays off, adapter implementations are straightforward)
- **Realistic**: 14 weeks (domain modeling takes 2 weeks, adapter pattern adds overhead to every endpoint, booking schema parser still takes the same time)
- **First Blocker**: Week 2 -- The domain model types require understanding the client API contract in detail. Soso discovers that the TC API response shapes for search results have subtle version-dependent differences that the domain model must accommodate. Iterating on the domain model while learning a new language compounds the difficulty.
- **What Gets Cut First**: The adapter boundary itself. Under time pressure, Soso starts calling 12go directly from handlers, eroding the architecture. The disposability benefit disappears, but the endpoints ship.

## Comparative Scoring Matrix

| Design | C1 Effort (x3) | C2 Solo Fit (x3) | C6 Risk (x2) | C12 Velocity (x1) | Weighted Total |
|---|---|---|---|---|---|
| Pragmatic Minimalist | 3 (9) | 2 (6) | 4 (8) | 3 (3) | **26** |
| Clean Slate (Go) | 3 (9) | 1 (3) | 4 (8) | 3 (3) | **23** |
| Platform Engineer | 3 (9) | 2 (6) | 4 (8) | 3 (3) | **26** |
| Data Flow Architect | 2 (6) | 2 (6) | 3 (6) | 2 (2) | **20** |
| Team-First Developer | 3 (9) | 2 (6) | 4 (8) | 3 (3) | **26** |
| Disposable Architecture | 2 (6) | 2 (6) | 4 (8) | 2 (2) | **22** |

Weighted calculation: C1 score x3 + C2 score x3 + C6 score x2 + C12 score x1.

## Cross-Design Observations

**1. The language decision dominates everything.** Five of six designs recommend PHP (four inside F3, one standalone). One recommends Go. None recommends .NET, despite Soso's 12 years of experience. This is because the organizational constraints (one system, 12go infrastructure, F3 feature work) override developer preference. But the execution cost of PHP for a .NET developer is consistently underestimated across all designs. Every PHP design says "AI compensates" -- this is partially true but not fully.

**2. The PHP-FPM per-request model is a hidden problem.** The Clean Slate design correctly identifies that PHP-FPM loads fresh state per request, making in-memory ID mapping tables impossible without Redis or APCu. None of the PHP designs adequately addresses this. Station ID mapping on every search request either adds Redis latency or requires a non-standard PHP deployment (Swoole/RoadRunner). This will surface as a performance issue in week 4-5 when search latency testing begins.

**3. F3 local development friction is the universal first blocker.** Every design that involves F3 (four of six) faces the same problem: the Search POC documented setup difficulties. This is the most likely cause of a week-1 slip.

**4. Gateway routing is an unsolved dependency.** Every design assumes per-client routing at the API Gateway level. Nobody has investigated whether AWS API Gateway supports this. This is a DevOps dependency that blocks the migration plan. If it requires a Lambda authorizer or an nginx reverse proxy, that is additional work not accounted for in any timeline.

**5. The booking schema parser takes the same effort in every language.** No design makes this easier. The differences are marginal: PHP and TypeScript handle dynamic JSON slightly more naturally than Go, but the complexity is in the business rules (20+ field patterns), not the language. This is 3-5 days regardless.

**6. Scope reduction is the real safety valve.** Every design can shed the notification transformer (offloadable) and gRPC (already scoped out). If the timeline slips, the IncompleteResults endpoint can be stubbed (return 404 initially). Master data endpoints (Stations, Operators, POIs) can proxy to existing Fuji S3 URLs with minimal transformation. The core deliverable for Q2 is: Search + GetItinerary + CreateBooking + ConfirmBooking + GetBookingDetails + GetTicket + CancelBooking. That is 7 endpoints, not 13.

**7. Nobody addresses the "Soso leaves" risk adequately.** The Team-First Developer is most honest about this. But even that design's mitigation (PHP so 12go team can maintain it) assumes that 12go developers will want to maintain B2B proxy code they did not write. In practice, handoff documentation and an AGENTS.md file are the most valuable investments for this risk.

## Execution Recommendation

**For Soso to ship solo by Q2: Team-First Developer or Pragmatic Minimalist (PHP/Symfony inside F3), with aggressive scope reduction.**

The three PHP-inside-F3 designs (Pragmatic Minimalist, Team-First Developer, and implicitly the Data Flow Architect) converge on the same answer: PHP inside F3, one codebase, no second deployment. Between these, the **Team-First Developer** design has the most realistic ramp-up plan and the best porting strategy (fixture-driven AI translation).

However, I must be honest about the risk: **PHP inside F3 is not the fastest path to a working MVP.** A .NET microservice would get Soso to a working Search endpoint in 3 days instead of 2 weeks. The reason every design rejects .NET is organizational, not technical -- and organizational constraints are real constraints.

**My recommended execution plan:**

1. **Week 1**: Set up F3 local environment. Get the Search POC running again. Write the B2B module directory structure and AGENTS.md. Load station mapping data into Redis/APCu.
2. **Week 2-3**: Implement Search and GetItinerary. These are the hardest endpoints (booking schema parser). Use fixture-driven AI translation from existing C# test cases.
3. **Week 4-5**: Implement CreateBooking, ConfirmBooking, GetBookingDetails. The booking funnel is the core value.
4. **Week 6-7**: Implement GetTicket, CancelBooking, SeatLock (stub). Post-booking operations.
5. **Week 8**: Master data endpoints (Stations, Operators, POIs). Shadow traffic testing for Search.
6. **Week 9-10**: Per-client rollout starting with internal test client. Fix issues as they surface.
7. **Deferred**: Notification transformer (offload to separate task), gRPC (scoped out), IncompleteResults (stub initially).

**The realistic outcome by end of Q2**: 10-11 core endpoints working, 1-2 clients migrated, notification transformer deferred. New clients can onboard on the new system. This meets the Q2 commitment.

**What kills this plan**: F3 local development being truly unworkable (not just painful -- actually broken). If that happens, the Platform Engineer's standalone PHP service becomes the fallback, at the cost of 1-2 weeks to set up the separate deployment pipeline.
