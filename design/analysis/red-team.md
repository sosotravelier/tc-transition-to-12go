---
status: draft
last_updated: 2026-03-17
agent: red-team
---

# Red Team Analysis

## How to Read This Document

This document does not score. It finds failure modes. A design that survives red team scrutiny is not necessarily the best -- it is just the most honest about its risks.

Each design gets a fair examination. Where a design has genuinely addressed a risk, that is noted. Where it has swept a risk under a rug or made an unstated assumption, that is surfaced. The goal is not to kill every design -- it is to ensure the final recommendation is made with open eyes.

---

## Pragmatic Minimalist: Failure Mode Analysis

**Design summary**: PHP/Symfony bundle inside F3. Thin translation layer, no local persistence, per-client rollout via gateway routing.

**Credit where due**: This design is the most self-aware of the six. It includes a detailed "What This Design Gets Wrong" section that honestly flags the booking schema complexity, 12go API instability, station ID mapping gap, F3 local dev friction, solo developer risk, monitoring handwave, and data strategy gaps. That section identified seven of the risks I would flag, which is unusual for a design document.

### Top 5 Ways This Fails

1. **F3 local development friction becomes a daily productivity tax that compounds into missed deadlines** -- Severity: High -- Likelihood: High
   - Root cause: The Search POC already documented setup difficulties with F3's Docker environment. The design acknowledges this ("the F3 local development friction is real") but treats it as an accepted trade-off rather than a quantified risk. A solo developer losing 30-60 minutes per day to environment issues over a 12-week timeline is 30-60 hours of lost productivity -- equivalent to losing 1-2 full work weeks.
   - Early warning signal: If Soso spends more than 1 hour on F3 environment issues in the first 3 days of implementation, the productivity tax is real and compounding.
   - Mitigation: Before committing to the F3 monolith path, invest 2 days in fully resolving the local environment issues documented in the POC. If they cannot be resolved, the standalone PHP service (Platform Engineer's approach) becomes strictly superior.

2. **Booking schema parser port takes 4-6 weeks instead of "2-3 weeks"** -- Severity: High -- Likelihood: Medium
   - Root cause: The design estimates the entire 12go HTTP client and schema parsing code can be ported to PHP in "2-3 weeks with AI assistance." The booking schema parser alone is ~1,200 lines of C# with 20+ wildcard field patterns, bracket-notation serialization, and cross-request state. The design itself admits "porting this to PHP with full fidelity will take longer than the '2-3 weeks' estimate suggests." This is a known-known that the estimate contradicts.
   - Early warning signal: If the schema parser is not code-complete with passing tests by week 3, the timeline is blown.
   - Mitigation: Port the booking schema parser first (not last). Use the existing C# test fixtures as the specification. If the port is not complete within 2 weeks, this is a signal to re-evaluate scope or approach.

3. **PHP learning curve collides with Q2 deadline pressure** -- Severity: High -- Likelihood: Medium
   - Root cause: Soso has 12 years of .NET experience and zero production PHP experience. The design assumes AI tools compensate for this gap. But AI generates code -- it does not generate the mental model of PHP/Symfony debugging, error handling idioms, and framework conventions that a developer needs when things go wrong at 2am. The first 2-4 weeks of PHP development will be significantly slower than .NET development, and those 2-4 weeks are a large fraction of the Q2 timeline.
   - Early warning signal: If Soso's first complete endpoint (Search, which already has a POC) takes more than 5 working days to complete with full tests, the learning curve is steeper than assumed.
   - Mitigation: Pair with a 12go PHP veteran for the first week. Not "available for consultation" -- scheduled daily 1-hour pairing sessions.

4. **Per-client gateway routing turns out to be harder than assumed** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design offers two routing options (Lambda authorizer or reverse proxy) but notes that "exact gateway configuration is not yet investigated -- needs DevOps input." This is an unresolved dependency that the design treats as a minor implementation detail. If AWS API Gateway cannot route by path parameter value (confirmed: it cannot natively), and DevOps is unfamiliar with Lambda authorizers, this becomes a multi-day blocker at exactly the wrong time.
   - Early warning signal: DevOps has not confirmed a routing approach by the end of week 1.
   - Mitigation: Resolve the gateway routing mechanism before writing any application code. This is a hard blocker for per-client rollout, which is the design's entire migration strategy.

5. **Event/data pipeline goes dark with no replacement plan** -- Severity: High -- Likelihood: High
   - Root cause: The design says "monitoring and observability are handwaved" and "the data team coordination (25+ Kafka events) is similarly unaddressed." This is not a minor gap. When the .NET services stop, 14 HIGH/CRITICAL events stop being emitted. The performance dashboards the data team uses go dark. The design offers no concrete plan for replacing these events, deferring to "use Datadog" without specifying which events, which metrics, or how ClickHouse ingestion works.
   - Early warning signal: The pending data team call has not happened by the time implementation starts.
   - Mitigation: The Data Flow Architect's structured logging approach should be adopted regardless of which design wins. Event emission is not optional -- it is a hard requirement that this design does not address.

### Hidden Assumptions

- **"12go's Redis caching is sufficient, so no caching layer is needed."** The design eliminates all caching. But the current system has triple-layer caching (HybridCache + DynamoDB + MemoryCache) for a reason. If 12go's Redis does not cache the specific queries B2B clients make (e.g., province-to-province search patterns), search latency may increase noticeably. This assumption is unverified.
- **"In-memory cache for booking schema field-name mapping is sufficient."** The design uses Redis with 1-hour TTL. But if the service runs inside F3 (PHP-FPM model), in-memory state does not persist across requests. The design acknowledges this for PHP's per-request model but then says "Redis with 1-hour TTL" without noting that this adds Redis as a dependency for a service that claims to have "no caching layer."
- **"Oleksandr estimated ~2 weeks for implementing B2B API in F3."** This estimate is from a 12go PHP veteran, not from a .NET developer learning PHP. The design uses this estimate to justify the PHP path but does not calibrate it for Soso's actual starting point.

### Optimistic Estimates (and realistic alternatives)

| Estimate in design | Realistic alternative | Why |
|---|---|---|
| "2-3 weeks" to port HTTP client + schema parsing to PHP | 4-6 weeks for a developer new to PHP, even with AI | The booking schema parser alone has 20+ field patterns with edge cases that only surface in testing. AI generates code but Soso must understand and debug it in an unfamiliar language. |
| Week 1-2: Deploy Search endpoint + shadow traffic | Week 2-3 at earliest | F3 environment setup, PHP learning curve, and Search endpoint validation each take longer for a PHP novice. |
| Week 11-12: Migrate remaining clients | Week 14-16 | Every estimate in the 13-week timeline is best-case. A solo developer has zero slack for unexpected issues. |
| "13 weeks" total timeline | 16-20 weeks realistic | Solo developer timelines should multiply best-case by 1.3-1.5x for unexpected issues, especially with a new language. |

### The Amplified Error Scenario

**The one wrong assumption**: "F3 local development friction is manageable."

If the F3 Docker environment proves consistently unreliable -- builds fail, migrations break, database state gets corrupted, the service crashes in ways that require full environment rebuilds -- then the entire monolith approach collapses. Every development session becomes a fight with infrastructure rather than productive coding. A solo developer cannot both fix the development environment and build 13 endpoints under a Q2 deadline.

Discovery at 3 months: Soso has built 6 of 13 endpoints inside F3 but has spent 25% of development time fighting the local environment. The remaining 7 endpoints plus migration work cannot be completed in Q2. The options are: (a) descope aggressively, (b) extract the code into a standalone PHP service (which requires reworking the deployment), or (c) extend the deadline. All three options are painful.

---

## Clean Slate Designer: Failure Mode Analysis

**Design summary**: Go standalone proxy. Single binary, stdlib + chi router, in-memory state, ~35 files / ~2,000 LOC.

**Credit where due**: This is the most technically rigorous analysis of the problem space. The "Irreducible Complexity Analysis" section genuinely identifies every transformation that must be built, with honest complexity ratings. The "API Contract Analysis" correctly categorizes the 13 endpoints by type. The language evaluation is the most thorough of any design.

### Top 5 Ways This Fails

1. **Nobody in the organization writes Go -- this is an orphan from day one** -- Severity: Critical -- Likelihood: High
   - Root cause: The design acknowledges this ("Go is not the team's language") but dismisses it with "the service is ~35 files, ~2000 lines of application code. Go's syntax can be learned in days." This fundamentally misunderstands the maintenance problem. The issue is not syntax -- it is operational knowledge. When this service has a production issue at 3am, who debugs it? Not the 12go PHP team. Not the .NET team. Only Soso. And Soso plans to resign after the transition.
   - Early warning signal: No one other than Soso can explain what the service does after 4 weeks of development.
   - Mitigation: If Go is chosen, a co-maintainer must be identified and trained before the service goes to production. This co-maintainer does not currently exist.

2. **"One system" organizational directive is directly violated** -- Severity: High -- Likelihood: High
   - Root cause: Management explicitly stated "there is no permanent separation between 12go core and B2B." A Go microservice is a permanent separation. The design argues it should be "designed to be deleted, not to be permanent." But Team Lead confirmed (Mar 17) that the transition design "will live for a significant time" and that "old clients migrate gradually." This is not a service that gets deleted in 3 months -- it lives for quarters, possibly years. During that time, every organizational review will question why there is a Go service in a PHP ecosystem.
   - Early warning signal: Team Lead or management pushes back on the Go choice before implementation begins.
   - Mitigation: Get explicit written approval from Team Lead and management that a Go service is acceptable. If this approval cannot be obtained, the design is dead on arrival regardless of its technical merits.

3. **In-memory booking schema cache is a single point of failure** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design stores booking schema field-name mappings and incomplete results in in-memory maps with TTL. It states "For single-instance deployment (likely given solo developer, moderate traffic): all state is in-memory." If the service restarts between a client's GetItinerary call and their CreateBooking call, the booking schema mapping is lost. The client's booking attempt fails. They must re-call GetItinerary, which re-fetches the checkout schema from 12go, which may return different data (seat availability changes, pricing changes). This is a user-visible failure.
   - Early warning signal: First production restart during business hours causes booking failures.
   - Mitigation: Use Redis from day one, not as a "later upgrade." The design claims this is "a simple upgrade, not an architecture change," but adding Redis to a Go service that was designed for zero external dependencies changes the deployment topology. Add it from the start.

4. **DevOps has never operated a Go service in this infrastructure** -- Severity: High -- Likelihood: High
   - Root cause: The Platform Engineer design documents this extensively: 12go's DevOps toolchain is PHP-native. Docker images, Datadog APM, process monitoring, on-call runbooks -- all assume PHP-FPM. A Go binary has different process models, different debugging tools, different failure signatures. The design does not address DevOps acceptance at all ("This design ignores... Infrastructure Operational Burden").
   - Early warning signal: DevOps raises concerns about supporting a Go container during architecture review.
   - Mitigation: Get explicit DevOps buy-in before choosing Go. If DevOps has not operated Go in production, they are taking on operational risk for a technology they cannot debug.

5. **The 4-6 week build estimate assumes best-case Go proficiency** -- Severity: Medium -- Likelihood: Medium
   - Root cause: "A solo developer with AI assistance can build this in 4-6 weeks (13 endpoints at ~2 endpoints per week, plus testing and deployment)." Soso has no Go experience. The design assumes Go's simplicity makes the learning curve negligible. But Go's error handling patterns (`if err != nil` everywhere), its concurrency model (goroutines, channels, errgroup), and its JSON handling (struct tags, `json.RawMessage` for dynamic schemas) are all new concepts. The booking schema parser in Go will be particularly awkward due to Go's lack of dynamic JSON ergonomics.
   - Early warning signal: The first endpoint (Search) takes more than 5 working days to complete with tests.
   - Mitigation: Build a small Go spike (just the Search endpoint calling 12go's staging API) before committing to the Go path. If it takes more than 3 days, multiply the timeline estimate accordingly.

### Hidden Assumptions

- **"Go's syntax can be learned in days."** Syntax, yes. Idiomatic Go patterns (error handling, interface design, package structure, testing conventions), no. The difference between "compilable Go" and "maintainable Go" is significant.
- **"In-memory maps persist across requests with zero infrastructure."** True for Go's HTTP server, but this assumes single-instance deployment forever. The moment horizontal scaling is needed, this breaks.
- **"The hard part is understanding the 12go API and the transformation logic, not the language."** This is backwards. Soso already understands the 12go API and transformation logic from 2 years of working on the .NET services. The hard part is implementing that understanding in an unfamiliar language.
- **"Chi adds only routing on top of net/http."** True, but the design does not account for middleware, structured logging, Datadog APM integration, graceful shutdown, health checks, or metrics -- all of which require additional libraries and configuration in Go.

### Optimistic Estimates (and realistic alternatives)

| Estimate in design | Realistic alternative | Why |
|---|---|---|
| "4-6 weeks" to build all 13 endpoints | 8-12 weeks | Go learning curve + booking schema parser awkwardness + deployment setup + DevOps coordination |
| "~2000 lines of application code" | 3,000-4,000 lines | Go's explicit error handling inflates line count. The booking schema parser alone will be 400-600 lines in Go. |
| "Single static binary. No runtime dependencies. Docker image is ~10MB." | True but irrelevant -- the deployment concern is DevOps acceptance, not image size | |

### The Amplified Error Scenario

**The one wrong assumption**: "DevOps will accept a Go container."

If at month 2, DevOps says "we cannot support a Go service in production -- we have no runbooks, no alerting baselines, no debugging expertise," then Soso must either: (a) rewrite in PHP (losing 2 months of work), (b) become the sole on-call for the service (unsustainable and at odds with the resignation plan), or (c) convince DevOps to make an exception (organizational capital spent on infrastructure politics instead of building endpoints).

---

## Platform Engineer: Failure Mode Analysis

**Design summary**: PHP/Symfony standalone service (separate container from F3), same infrastructure as F3, identical DevOps toolchain.

**Credit where due**: This is the most operationally detailed design. The Dockerfile, health check implementation, CI/CD pipeline, alerting rules, and on-call runbook are all production-ready specifications. The "3am question" framing correctly identifies the operational reality that most designs ignore.

### Top 5 Ways This Fails

1. **Two PHP codebases for a solo developer: the standalone service AND F3** -- Severity: High -- Likelihood: High
   - Root cause: Team Lead explicitly wants B2B code inside F3 for co-location benefits during refactoring. The Platform Engineer explicitly rejects the F3 monolith approach and advocates a standalone service. This creates organizational friction. More practically, Soso must still make F3 changes (cancellation policies, new capabilities) in addition to building the standalone service. The design argues this is better than "two languages" but it is still "two codebases, two deployment pipelines, two sets of infrastructure concerns." The cognitive overhead of maintaining a standalone PHP service and F3 simultaneously is real, even if both are PHP.
   - Early warning signal: Soso finds that B2B feature development requires coordinated changes in both F3 and the standalone service for the same feature (e.g., cancellation policy changes need F3 endpoint + B2B mapping).
   - Mitigation: Accept this as a structural cost and scope accordingly. If more than 2 features require dual-codebase changes in Q2, the monolith approach may have been the right call.

2. **PHP-FPM per-request model kills in-memory mapping performance** -- Severity: Medium -- Likelihood: High
   - Root cause: The design specifies PHP-FPM workers, which means per-request process lifecycle. Station ID mapping (~thousands of entries), operator mapping, and seat class mapping must be loaded per-request or cached in Redis/shared memory. The design does not address this. A standard PHP-FPM service cannot hold mapping tables in memory across requests. Every search request would need to either (a) load thousands of mapping entries from Redis/file, adding latency, or (b) use a persistent process model like Swoole/RoadRunner, which the design does not mention and DevOps has never operated.
   - Early warning signal: Search endpoint latency is 50-100ms higher than expected due to mapping table loading on every request.
   - Mitigation: Use Symfony's APCu caching for mapping tables (loads once per FPM worker, persists across requests within that worker). Or use OPcache for static PHP arrays. This is a solved problem in PHP but the design does not mention it, which suggests the author may not be aware of the constraint.

3. **The standalone service creates the "second migration" problem that Team Lead explicitly warned about** -- Severity: High -- Likelihood: Medium
   - Root cause: Team Lead stated (Mar 17): "if F3 gets disassembled, it's easier to have everything together rather than having to migrate a separate service later." The Platform Engineer counters with "a standalone Symfony service is straightforward to absorb into whatever F3 becomes." This is true in theory but ignores the organizational reality: when F3 is refactored, the team will focus on F3's codebase, not on absorbing an external service. The standalone B2B service will be the last priority, creating the exact "two migration" scenario Team Lead wanted to avoid.
   - Early warning signal: F3 refactoring planning (Q2) does not include absorption of the standalone B2B service in its scope.
   - Mitigation: Document the absorption plan explicitly. If the standalone service exists, someone must own its integration into the refactored F3. If no one owns it, it becomes permanent -- which contradicts "one system."

4. **Soso's PHP learning curve is the same whether inside or outside F3** -- Severity: Medium -- Likelihood: High
   - Root cause: The design's primary argument against the F3 monolith is "smaller cognitive footprint" of a standalone service. But the PHP learning curve is identical either way. Soso still learns Symfony, PHP 8.3 conventions, Composer, and Datadog integration. The standalone service avoids F3's codebase complexity but adds deployment complexity. The net cognitive load may be comparable.
   - Early warning signal: Soso spends as much time on standalone service deployment setup as they would have spent on F3 environment issues.
   - Mitigation: This is not mitigable -- it is a trade-off. Acknowledge it honestly rather than claiming the standalone service is strictly easier.

5. **The observability design is excellent but adds implementation scope** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design specifies 10 custom DogStatsD metrics, structured JSON logging, Datadog APM enrichment with client_id and booking_id, three alerting rules, and an on-call runbook. This is production-grade observability -- and it is work. For a solo developer under Q2 deadline pressure, implementing all of this is an additional 3-5 days of development that competes with endpoint implementation.
   - Early warning signal: Observability implementation is deferred to "after MVP" and never completed.
   - Mitigation: Prioritize ruthlessly. The Datadog APM auto-instrumentation (zero code) provides 80% of the observability value. Custom metrics and alerting can come in week 2-3 of production, not pre-launch.

### Hidden Assumptions

- **"DevOps copies an existing service config and changes the app directory."** This assumes DevOps has capacity to set up a new service. With 2 DevOps engineers managing the transition to 12go's infrastructure, they may not prioritize a new PHP container as quickly as assumed.
- **"PHP-FPM workers use ~20-40MB each."** This does not account for loading large mapping tables (station IDs, operator IDs) into each worker. With thousands of mapping entries loaded into every FPM worker, memory per worker may be 40-60MB.
- **"Independent scaling... the B2B API has a different load profile than F3."** Does it? Both serve HTTP requests that hit the same 12go backend. The B2B API is a subset of F3's traffic. Independent scaling for a thin proxy serving 20-30 clients is likely unnecessary.

### Optimistic Estimates (and realistic alternatives)

| Estimate in design | Realistic alternative | Why |
|---|---|---|
| "Clone an existing service config, change the app code, deploy. No new infrastructure." | 3-5 days to get the first deployment working | Even cloning a service config requires DevOps time, Docker network configuration, environment variable setup, and health check verification. |
| No explicit timeline provided | 12-16 weeks total (similar to Pragmatic Minimalist but with deployment overhead) | The standalone service adds deployment setup time but eliminates F3 environment friction. Net effect is approximately equal. |

### The Amplified Error Scenario

**The one wrong assumption**: "A standalone Symfony service has a smaller cognitive footprint than working inside F3."

If Soso discovers at month 2 that the B2B service needs direct access to F3's internal data (e.g., cancellation policies require reading F3's trip pool, or the booking schema format depends on F3's internal cart state), then the "standalone" service must either (a) call F3 over HTTP for this data (adding latency and coupling), (b) duplicate the data access logic (violating DRY and creating a sync problem), or (c) be absorbed back into F3 (admitting the standalone approach was wrong). The Team Lead's concern about "easier to have everything together" would be validated at significant sunk cost.

---

## Data Flow Architect: Failure Mode Analysis

**Design summary**: Language-neutral event architecture with structured log emission, detailed event schemas for all 13 endpoints, Datadog + ClickHouse analytics pipeline.

**Credit where due**: This is the only design that comprehensively addresses the event/data pipeline gap. The audit of 35+ existing Kafka events with criticality ratings is invaluable. The distinction between the 14 events that must be preserved and the 21 that can be dropped is the kind of analysis that prevents "dashboards go dark" surprises in production. Every other design either ignores this problem or hand-waves it.

### Top 5 Ways This Fails

1. **This is not a complete design -- it is an event architecture overlaid on an unspecified service** -- Severity: Critical -- Likelihood: High
   - Root cause: The Data Flow Architect explicitly does not choose a language, framework, or deployment model. It provides event schemas and a correlation ID strategy, but no implementation plan for the 13 endpoints, no migration strategy details, no booking schema parser approach, no project structure. This is a supplementary design, not a standalone proposal. It cannot be selected as "the design" without grafting it onto one of the other five proposals.
   - Early warning signal: When someone tries to estimate implementation effort, they realize the core service architecture is undefined.
   - Mitigation: Treat this design as a mandatory overlay for whichever design wins, not as a competing alternative. Its event schemas and analytics pipeline design should be adopted by the winning design.

2. **The structured logging approach may not satisfy the data team's Kafka dependency** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design recommends structured logs over Kafka as the primary event transport. But the data team may have existing Kafka consumers that process the current events (this is flagged as an open question). If the T-Rex project or ClickHouse ingestion relies on Kafka consumer groups, structured logs routed through Datadog are not a drop-in replacement. The "upgrade path to Kafka" is described as "a 1-2 day change" -- but adding a Kafka producer to a PHP-FPM service (using php-rdkafka, which requires a PECL extension and librdkafka) is more like a 3-5 day change including testing and deployment.
   - Early warning signal: Data team call reveals they have active Kafka consumers for booking events.
   - Mitigation: Have the data team call BEFORE choosing the event emission approach. If they need Kafka, budget for it from day one.

3. **Event emission scope adds 1-2 weeks to the timeline that no other design accounts for** -- Severity: Medium -- Likelihood: High
   - Root cause: The design specifies detailed JSON schemas for 13+ event types, correlation ID propagation, timing breakdowns per upstream call, and dual-event emission for webhooks (received + forwarded). Implementing this correctly across all 13 endpoints is real work. No other design budgets time for event emission, and this design does not provide a timeline. The implied assumption is that event logging is "free" -- it is not.
   - Early warning signal: Event implementation is consistently deferred in favor of endpoint implementation, creating a gap that grows with each completed endpoint.
   - Mitigation: Build event emission into the endpoint implementation workflow from the first endpoint. Do not treat it as a separate phase.

4. **Correlation ID propagation through 12go is aspirational, not achievable** -- Severity: Low -- Likelihood: High
   - Root cause: The design proposes appending `correlation_id` as a query parameter to 12go API calls for "post-hoc correlation." But 12go's API uses `?k=<apiKey>` as its query parameter pattern. Adding arbitrary query parameters may break 12go's request parsing or be ignored entirely. The design acknowledges "the correlation chain is broken inside 12go" but still proposes a mitigation that requires 12go to not reject unknown query parameters.
   - Early warning signal: 12go's API returns 400 when an unknown query parameter is appended.
   - Mitigation: Test whether 12go's API tolerates unknown query parameters in staging before building this into the architecture. Fallback: correlation exists only within the proxy's own trace spans.

5. **The 14 "must preserve" events may not all be consumed by anyone** -- Severity: Low -- Likelihood: Medium
   - Root cause: The event audit classifies 14 events as HIGH or CRITICAL based on the assumption that the data team uses them. But this is unverified. The data team call has not happened. The T-Rex project may already have direct 12go data feeds. Some of these events may be consumed by services that no longer exist. Implementing 14 event types is wasted effort if only 5 are actually needed.
   - Early warning signal: Data team call reveals they only use 4-5 of the 14 events.
   - Mitigation: Prioritize: implement the minimum viable events first (search count, booking created, booking confirmed, booking cancelled), then add more based on data team feedback.

### Hidden Assumptions

- **"Datadog Agent is already deployed on 12go's infrastructure."** True, but Datadog log forwarding to ClickHouse is a configuration task that requires DevOps. If DevOps does not prioritize this, events are in Datadog but not in ClickHouse -- and the data team's dashboards remain dark.
- **"Events are searchable in Datadog Log Explorer within seconds."** True, but at what cost? High-volume structured logging (every search request, every booking) may significantly increase Datadog ingestion costs. Has anyone estimated the log volume?
- **"ClickHouse ingestion from Datadog is a configuration task, not a development task."** This assumes a specific Datadog plan tier that supports log forwarding to external destinations. Verify this is available in 12go's Datadog subscription.

### The Amplified Error Scenario

**The one wrong assumption**: "The data team's needs can be satisfied by structured logs."

If at month 2, the data team says "we need Kafka events in the exact same format as the old system, consumed by existing consumer groups, with exactly-once delivery guarantees," then the structured logging approach is insufficient. Adding Kafka produces to a PHP service mid-flight is disruptive. The event schemas survive (they are transport-agnostic), but the implementation and testing effort for Kafka in PHP is a 1-2 week detour that competes with endpoint development.

---

## Team-First Developer: Failure Mode Analysis

**Design summary**: PHP/Symfony inside F3 monolith, with AGENTS.md for AI context, detailed DX analysis, and post-departure maintainability focus.

**Credit where due**: This is the only design that honestly grapples with the human factors: developer morale, post-departure maintainability, and the gap between "technically optimal" and "actually shippable by one stressed person." The AGENTS.md specification for AI context is a genuine innovation -- it makes the codebase AI-navigable from day one. The "Retention and Morale Assessment" section is uncomfortably honest.

### Top 5 Ways This Fails

1. **PHP learning curve is underestimated for complex code, not just simple endpoints** -- Severity: High -- Likelihood: Medium
   - Root cause: The design says "AI compensates for PHP unfamiliarity" and "the code being written is HTTP translation logic, not complex algorithmic work." But the booking schema parser IS complex algorithmic work: 20+ wildcard patterns, dynamic key extraction, bracket-notation serialization, cross-request state management. Writing this in an unfamiliar language under time pressure -- even with AI -- is where the "2-4 weeks of syntactic discomfort" becomes a serious risk. AI generates PHP code, but when that code has a subtle bug in the schema parser, Soso must debug PHP code they do not yet instinctively understand.
   - Early warning signal: The booking schema mapper has more than 3 bugs discovered during integration testing that require PHP-specific debugging (type coercion issues, array vs. object ambiguity, null handling differences).
   - Mitigation: Port the booking schema parser as a standalone module with comprehensive tests BEFORE integrating it into the F3 monolith. Validate it independently.

2. **The monolith co-location argument assumes F3's codebase is navigable** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design argues that one codebase is better than two for a solo developer. This is true in the abstract. But F3 is a large Symfony monolith that a .NET developer has never worked in. "One codebase" that you understand is less cognitive load than "two codebases." "One massive codebase" that you are learning while building new features is potentially MORE cognitive load than "one small standalone codebase" you wrote yourself. The design does not quantify the cognitive cost of navigating F3's existing code, conventions, and configuration.
   - Early warning signal: Soso spends significant time understanding F3's existing Symfony configuration, service wiring, and testing conventions before writing any B2B code.
   - Mitigation: Create the B2B module as a maximally isolated subdirectory within F3. Follow the project structure exactly as specified. Do not integrate with F3's existing service layer unless absolutely necessary.

3. **The "one codebase" benefit is eroded if F3 has its own deployment cadence** -- Severity: Medium -- Likelihood: Medium
   - Root cause: Inside F3, B2B code is subject to F3's deployment pipeline, testing requirements, and release schedule. If F3 deploys weekly (or on a specific cadence), B2B endpoint changes must wait for the next deployment window. Soso does not control the deployment pipeline. The "conveyor belt" approach (new endpoint every ~2 days) requires deployment frequency that F3's pipeline may not support.
   - Early warning signal: First B2B endpoint is code-complete but deployment is blocked by F3's release process.
   - Mitigation: Negotiate with Team Lead and DevOps for independent B2B deployment capability within F3 (e.g., feature flags that enable/disable B2B endpoints independently of F3 releases). If this is not possible, the standalone service approach regains its advantage.

4. **Post-departure maintainability assumes 12go developers will actually maintain it** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design's strongest argument for PHP is "when Soso leaves, 12go's developers inherit code in their own language." But 12go's developers are not currently allocated to B2B maintenance. They have their own F3 development work. The assumption that "PHP code = someone will maintain it" ignores the organizational reality that maintenance ownership must be explicitly assigned. Code in the right language but with no assigned maintainer is still orphaned.
   - Early warning signal: No specific 12go developer is identified as the B2B module maintainer during Q2 planning.
   - Mitigation: Get explicit commitment from Team Lead that a named 12go developer will be the B2B module maintainer after Soso departs. The language choice is necessary but not sufficient.

5. **The AGENTS.md and AI-optimized structure adds upfront work** -- Severity: Low -- Likelihood: Medium
   - Root cause: Creating and maintaining the AGENTS.md context file, naming conventions, file size limits (200-300 lines per file), and explicit imports is valuable for long-term AI navigability. But for a solo developer under Q2 pressure, this is overhead that competes with endpoint implementation. If the AGENTS.md goes stale because Soso is too busy shipping endpoints, it becomes misleading documentation.
   - Early warning signal: AGENTS.md has not been updated after the third endpoint is implemented.
   - Mitigation: Generate AGENTS.md from the code structure rather than maintaining it manually. Or accept that it may go slightly stale and update it post-MVP.

### Hidden Assumptions

- **"Symfony's dev server picks up changes immediately (no compile step)."** True for code changes, but F3's Symfony container may need cache clearing, config recompilation, or service container rebuilds for certain changes. This is not instant.
- **"F3's built-in versioning (VersionedApiBundle), API agent identity (ApiAgent), and Datadog tracing can be reused."** These features exist in F3, but using them requires understanding F3's extension points. A .NET developer new to Symfony will need time to understand how to hook into these features.
- **"The total code to write is small (~2,500-3,500 lines for all 13 endpoints plus mappers)."** This estimate does not include test code, configuration, event emission, or the inevitable debugging and rework cycles.

### The Amplified Error Scenario

**The one wrong assumption**: "AI compensates for PHP unfamiliarity sufficiently to meet the Q2 deadline."

If at month 2, Soso has built 5 endpoints but each one took 50% longer than expected due to PHP debugging difficulties, type coercion surprises, and Symfony configuration mysteries, then the Q2 deadline is unachievable. The AI generates code that compiles but has subtle bugs that only a PHP-experienced developer would catch. The debugging time -- not the coding time -- is the bottleneck. Switching to .NET at this point means abandoning 2 months of PHP work.

---

## Disposable Architecture: Failure Mode Analysis

**Design summary**: Anti-corruption layer with explicit permanent/disposable boundaries, outbound port interfaces, language-neutral pattern applicable in PHP (F3 monolith) or .NET (standalone).

**Credit where due**: This is the most architecturally principled design. The survivability analysis (40% permanent, 60% disposable) is honest and useful. The contract testing strategy (language-agnostic HTTP test fixtures) is the most durable testing approach proposed. The design does not pretend the 12go API is stable -- it explicitly designs for its instability.

### Top 5 Ways This Fails

1. **The adapter boundary adds architectural overhead that a solo developer under deadline pressure will shortcut** -- Severity: High -- Likelihood: High
   - Root cause: The design requires: domain model types, outbound port interfaces (ITravelProvider, IBookingProvider, IPostBookingProvider), adapter implementations, and strict separation between permanent and disposable code. For a team of 3-4, this is good discipline. For a solo developer with a Q2 deadline, the adapter indirection is the first thing that gets cut when schedule pressure hits. The design acknowledges this risk ("a solo developer under deadline pressure may shortcut the adapter boundary and call F3 services directly") but does not solve it.
   - Early warning signal: By week 3, domain model types are not defined, and endpoint handlers call 12go directly without going through the port interfaces.
   - Mitigation: Build the port interfaces and domain types first (the design recommends this in Phase 1). If they exist before any adapter code is written, the pattern is easier to maintain. But if Phase 1 slips, the entire adapter architecture is at risk.

2. **The design does not resolve its own central tension: PHP in F3 vs .NET standalone** -- Severity: High -- Likelihood: High
   - Root cause: The design evaluates both PHP and .NET for boundary expressiveness and concludes: ".NET microservice -- hardest boundary, best type enforcement, cleanest adapter isolation" and "PHP in F3 -- softer boundary but co-location makes extraction easier." It then says "this design does not resolve that tension." For a decision document, not resolving the central question is a significant gap. The adapter pattern works in both, but the trade-offs are different enough that the choice matters.
   - Early warning signal: Architecture review spends the entire meeting debating PHP vs .NET instead of evaluating the adapter pattern itself.
   - Mitigation: This design should be treated as a pattern to apply to whichever language/deployment model is chosen, not as a standalone design proposal.

3. **The 40% permanent / 60% disposable ratio is optimistic** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The survivability analysis claims 40% of code survives F3 decomposition. But the "permanent" artifacts include "inbound HTTP handlers" and "domain model types." When F3 is decomposed, the client contract may also change (new API version, new capabilities, deprecation of some endpoints). The assumption that the inbound surface is permanent is only true if clients never change -- which is likely for years, but not forever. More importantly, the 60% "disposable" code is the hardest code (booking schema parser, reserve serializer, response mappers). The "permanent" 40% is relatively simple.
   - Early warning signal: First F3 API change that requires modifying both the outbound adapter AND the inbound handler, violating the boundary.
   - Mitigation: Accept that the boundary is useful but imperfect. Some changes will cross it. The value is reducing the replacement scope from 100% to ~60%, not achieving zero-cost replacement.

4. **Contract tests are valuable but add another deliverable to the timeline** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design recommends language-agnostic HTTP contract test fixtures as the "most durable artifact." Writing these fixtures for all 13 endpoints with multiple scenarios each is valuable long-term work. But it is work. For a solo developer, the question is: does this work replace other testing work, or is it additional? The design positions it as additional ("adapter unit tests" AND "inbound contract tests" AND "outbound contract tests").
   - Early warning signal: Contract tests are deprioritized in favor of manual testing due to time pressure.
   - Mitigation: Contract tests for the top 4 endpoints (Search, GetItinerary, CreateBooking, ConfirmBooking) are sufficient for launch. Expand to all 13 post-MVP.

5. **The build order (domain types first, then adapters) delays the first working endpoint** -- Severity: Medium -- Likelihood: Medium
   - Root cause: Phase 1 is "Foundation (Week 1-2): Domain model types, outbound port interfaces, client config table, station ID mapping data." No working endpoint until Phase 2 (Week 2-3). For a solo developer who needs to demonstrate progress to Team Lead and build confidence, spending 2 weeks on types and interfaces with no working HTTP endpoint is demoralizing and makes progress invisible.
   - Early warning signal: Team Lead asks "what does it do?" at the end of week 2, and the answer is "nothing yet, but the domain types are defined."
   - Mitigation: Build one working endpoint (Search) in week 1 with a quick-and-dirty approach, then refactor into the adapter pattern. This provides visible progress and validates the architecture simultaneously.

### Hidden Assumptions

- **"The outbound port interface is the hard seam."** This assumes the seam is in the right place. If F3's decomposition changes not just the outbound API but also the concept of "cart" and "checkout" (which the design considers likely), the port interfaces themselves may need to change. The interfaces are defined in terms of domain concepts (SearchResult, BookingSchema) that are currently shaped by 12go's cart-based flow.
- **"When F3 is decomposed, a new adapter implements the same interface with different mapping logic."** This assumes the domain model (defined by client contract) remains stable while only the 12go API changes. If the team decides to also evolve the client contract during F3 decomposition, both sides of the adapter change simultaneously, negating the boundary's value.
- **"Booking schema parser: Probably not surviving."** The design is honest here but does not note that this is the single most expensive piece of code (~1,200 lines). Writing it knowing it will be thrown away is a hard sell for developer morale.

### The Amplified Error Scenario

**The one wrong assumption**: "The adapter boundary will be maintained under deadline pressure."

If at month 2, Soso has bypassed the port interfaces for 3 of 5 implemented endpoints because defining the interface, implementing it, and wiring the DI took too long, then the entire "disposable architecture" value proposition is lost. The code is no more replaceable than a flat proxy. The architectural overhead was paid but the benefit was not realized. Worse, the codebase now has inconsistent patterns (some endpoints use adapters, some don't), making it harder to understand than a consistently flat design.

---

## Cross-Cutting Red Flags

These issues appear in multiple designs and are not addressable by choosing a different design.

### 1. Station ID Mapping Is Not "Out of Scope" -- It Is On Every Request's Critical Path

Every design acknowledges that station ID mapping is "out of scope" per the requirements, yet every design includes it as a required translation. Search requests send Fuji CMS IDs; 12go expects integers. This translation must happen on every search, every booking, every master data response.

The mapping data lives in Fuji's DynamoDB tables. Fuji is being decommissioned. If the mapping data is not exported before Fuji is turned off, the new service cannot translate station IDs and is useless.

**This is not a design risk. It is a project risk that blocks all designs.** Someone must extract the Fuji station/operator/POI/seat-class mapping data into a portable format (JSON, CSV, MariaDB table) before any design can be implemented. None of the designs own this work explicitly.

### 2. The Booking Schema Parser Is the Make-or-Break Deliverable

All six designs identify the booking schema parser (~1,200 lines, 20+ dynamic field patterns, bracket-notation serialization) as the most complex piece of code. None of them provide a detailed porting plan. The estimates range from "it is well-specified by tests" (optimistic) to "this will take longer than estimated" (honest but vague).

The schema parser is on the critical path for 3 of the highest-value endpoints (GetItinerary, CreateBooking, ConfirmBooking). If the parser port fails, the booking funnel does not work, and the system cannot ship.

**Recommendation for all designs**: Port the booking schema parser FIRST, in the first 2 weeks, with comprehensive test coverage from existing C# fixtures. If it cannot be ported in 2 weeks, the timeline for everything else must be adjusted.

### 3. Solo Developer Risk Cannot Be Designed Away

Every design acknowledges that Soso is a single point of failure. No architecture solves this. If Soso gets sick for 2 weeks, the project stops for 2 weeks. If Soso burns out under the pressure of learning a new language while building 13 endpoints solo under a Q2 deadline, the project fails regardless of how elegant the design is.

The only mitigation is organizational: reduce scope, add resources, or extend the deadline. The March 17 meeting noted that Team Lead is "open to altering the plan and adding people." This option should be exercised, not left as a theoretical possibility.

### 4. PHP Per-Request Memory Model vs. In-Memory Mapping Tables

Four designs recommend PHP. None of them address PHP's fundamental constraint for this workload: PHP-FPM creates a new process (or reuses a worker) for each request, and in-memory state does not persist across requests. The mapping tables (station IDs, operator IDs, seat classes -- thousands of entries) must be loaded per-request or cached externally.

Solutions exist (APCu, OPcache preloading, Swoole, RoadRunner), but none of the PHP designs mention this. The first PHP implementation that naively loads mapping tables from a JSON file on every request will have unacceptable search latency.

### 5. The Gateway Routing Question Is Still Unanswered

Every design depends on per-client routing during migration. The system context confirms: "AWS API Gateway does NOT natively support routing to different backends based on path parameter values." Six designs, zero verified routing mechanisms.

Options proposed (Lambda authorizer, nginx reverse proxy, app-level feature flag) are all reasonable, but none have been validated with DevOps. This is a hard dependency that blocks the migration strategy of every design.

---

## Unresolved Questions That Block All Designs

From the decision map and meeting outcomes, these questions must be answered before any design can proceed safely:

### Must Answer Before Implementation

| # | Question | Why It Blocks | Default if Unanswered |
|---|----------|--------------|----------------------|
| G1 | Can AWS API Gateway route by `client_id`? | Per-client migration depends on this. Every design assumes per-client rollout. | Deploy nginx reverse proxy as routing layer (adds infrastructure, adds DevOps work). |
| G4 | Will 12go DevOps support the proposed runtime? | Go and .NET designs are dead if DevOps says no. PHP designs need confirmation that a second PHP container is acceptable. | Assume PHP only; kills Go and .NET designs. |
| G5 | Does a `clientId -> 12go apiKey` mapping exist anywhere? | Authentication bridge depends on this. All designs assume the mapping can be created. | Manual creation of ~20-30 mapping entries; manageable but needs to be done. |

### Must Answer Before First Client Migration

| # | Question | Why It Blocks | Default if Unanswered |
|---|----------|--------------|----------------------|
| G2 | What events does the data team require? | Dashboard continuity. Migration without event replacement means dashboards go dark. | Emit DA's proposed structured events; adapt after data team call. |
| G3 | Does 12go consume any TC Kafka topics? | If yes, the new system must continue producing to those topics or 12go breaks. | Assume no; verify before decommissioning .NET services. |

### Should Answer But Can Proceed Without

| # | Question | Impact if Unknown |
|---|----------|------------------|
| G6 | Per-client pricing/markup in 12go? | May need additional transformation logic. Assume transparent for now. |
| G7 | Recheck mechanism details? | IncompleteResults endpoint may not work correctly. Acceptable for MVP. |
| G8 | What monitoring does 12go actively use? | Observability design may duplicate or miss metrics. Acceptable for MVP. |

---

## Red Team Verdict

This is not a recommendation. It is a list of conditions under which each design should NOT be chosen.

### Do NOT choose Pragmatic Minimalist (PHP in F3) if:
- F3 local development friction cannot be resolved within the first week
- The PHP learning curve for the booking schema parser proves steeper than 2 weeks
- F3's deployment cadence prevents the "conveyor belt" (endpoint every 2 days) approach

### Do NOT choose Clean Slate Designer (Go standalone) if:
- DevOps cannot commit to supporting a Go container in production
- No co-maintainer for Go can be identified before Soso's departure
- Management does not explicitly approve a non-PHP service (the "one system" directive)

### Do NOT choose Platform Engineer (PHP standalone) if:
- Team Lead insists on F3 co-location for refactoring benefits
- The overhead of maintaining a separate deployment pipeline for one solo developer exceeds the benefit of avoiding F3's codebase
- No one owns the plan to absorb the standalone service into the refactored F3

### Do NOT choose Data Flow Architect (event overlay) as a standalone design:
- It is not a complete design. It must be combined with one of the other five. Its event architecture should be adopted by whichever design wins.

### Do NOT choose Team-First Developer (PHP in F3) if:
- AI-assisted PHP development proves insufficiently accurate for the booking schema parser (measured: more than 5 parser bugs found in integration testing)
- F3's Symfony conventions require more than 1 week to understand sufficiently for productive development
- No named 12go developer is assigned as post-departure maintainer

### Do NOT choose Disposable Architecture (ACL pattern) as a standalone design if:
- The Q2 deadline is firm and non-negotiable (the adapter boundary adds 1-2 weeks of upfront work)
- The solo developer under pressure will not maintain the boundary (realistic risk)
- Like the Data Flow Architect, this is best treated as a pattern to overlay on whichever language/deployment model is chosen, not as a standalone choice

### The condition that blocks every design:
- If the station ID mapping data cannot be extracted from Fuji DynamoDB before implementation begins, no design can function. This is a project-level prerequisite, not a design-level concern.
