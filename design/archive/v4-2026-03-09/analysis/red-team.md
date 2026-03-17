---
status: complete
last_updated: 2026-03-17
agent: red-team
---

# Red Team Analysis

## How to Read This Document

This document does not score. It finds failure modes. A design that survives red team scrutiny is not necessarily the best -- it is just the most honest about its risks.

Each design is examined for hidden assumptions, optimistic estimates, structural flaws, and the one wrong assumption that would be most expensive to discover late. Designs that genuinely address a risk get credit for it. The goal is not to kill every design -- it is to ensure the final recommendation is made with eyes open.

---

## Pragmatic Minimalist: Failure Mode Analysis

### Top 5 Ways This Fails

1. **PHP inside F3 becomes a development velocity trap** -- Severity: Critical -- Likelihood: High
   - Root cause: The design recommends PHP inside F3 as primary, but the Search POC documented 16 separate infrastructure issues over two days. The design acknowledges this ("F3 local dev friction is real") but still recommends it. The self-critique section identifies this as the "strongest argument against the monolith approach" -- and then recommends the monolith approach anyway.
   - Early warning signal: First endpoint takes more than 5 business days to complete including local environment time.
   - Mitigation: The design includes a fallback (standalone PHP Symfony), but switching after 2-3 weeks of F3 work means lost time. The fallback should be the primary recommendation, not the backup.

2. **Per-endpoint migration creates a dangerous coexistence window for the booking funnel** -- Severity: High -- Likelihood: Medium
   - Root cause: Per-endpoint migration means there will be a period where Search points to the new service, but GetItinerary or CreateBooking still points to the old service. The itinerary IDs returned by the new Search must be compatible with the old Denali's GetItinerary. This is not explicitly analyzed -- the design assumes "each endpoint is independent," but the booking funnel is a stateful flow (Search -> GetItinerary -> CreateBooking -> ConfirmBooking) where IDs flow across endpoints.
   - Early warning signal: Integration testing reveals that itinerary IDs from the new Search service are not parseable by the old Denali service, or vice versa.
   - Mitigation: Migrate the entire booking funnel (Search through ConfirmBooking) as a single batch, not individually. Or ensure ID format compatibility is verified before any endpoint goes live.

3. **"No caching" stance causes latency regression** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design eliminates all caching layers (DynamoDB, HybridCache, MemoryCache) and states "12go already caches in Redis." But the current system has triple-caching for a reason -- the 12go API adds network latency that the old system hid with local caches. The design acknowledges this risk in the self-critique but does not resolve it.
   - Early warning signal: Search latency p95 through the new service is measurably higher than through the old service when tested side-by-side.
   - Mitigation: Measure before cutting over. If needed, add a simple Redis TTL cache for search results. The design mentions this but treats it as optional.

4. **Notification transformer complexity is hand-waved** -- Severity: High -- Likelihood: High
   - Root cause: The design admits "the 'forward to where' question is genuinely open" for webhook notifications. There is no confirmed mechanism for client webhook URLs, no outbound delivery code, no retry logic. This is not a minor detail -- it is an entire endpoint that clients depend on. The design proposes it as "Phase 8" and suggests it "can be last or offloaded," but a booking notification failure means clients do not know their bookings were confirmed or cancelled.
   - Early warning signal: When implementation reaches notifications, the discovery of missing client webhook URL storage or delivery infrastructure causes a scope expansion.
   - Mitigation: Investigate the notification delivery mechanism now (before architecture decision), not during Phase 8.

5. **Solo developer language switch costs more than estimated** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design estimates PHP learning at "2-3x longer for the first few endpoints." For the booking schema mapper (~500 lines of complex pattern matching), 2-3x may be optimistic. Pattern matching, string manipulation, and dynamic JSON handling are areas where language-specific idioms matter most. AI generation quality for PHP is estimated at 70-75% (by the Team-First Developer design, which is the most honest assessment). That means ~25-30% of AI-generated PHP code needs manual correction by a developer learning the language.
   - Early warning signal: AI-generated PHP code for the booking schema mapper requires extensive manual debugging.
   - Mitigation: Port the booking schema mapper in C# first (where Soso can verify correctness), then translate to PHP with AI assistance using the C# version as a reference.

### Hidden Assumptions

- **"12go already caches in Redis"** -- This assumes 12go's Redis cache provides equivalent latency to having local caches. Not verified. 12go's Redis may cache for their own B2C traffic patterns, not for B2B query patterns.
- **"Each endpoint is independent"** -- This is true for post-booking endpoints but not for the booking funnel. Search -> GetItinerary -> CreateBooking -> ConfirmBooking is a stateful flow where IDs and schema field maps carry across endpoints.
- **"Moving 5000 lines during a refactor is trivial"** -- When F3 is decomposed, the B2B code inside F3 will need to be extracted along with its routing, its configuration, its auth bridge, and its relationship to F3's internal services. The code itself may be 5000 lines, but the extraction effort includes understanding all the implicit dependencies on F3's DI container, Symfony kernel events, and database configuration.
- **API Gateway route changes are "seconds to minutes"** -- This assumes the team has the authority and tooling to modify API Gateway routes independently. In practice, this may require a DevOps release request (which is the deployment model described in the system context).

### Optimistic Estimates (and realistic alternatives)

- **"8 phases" timeline is presented without duration** -- The design does not estimate how long each phase takes. For a solo developer learning PHP while implementing, a realistic estimate is: Phase 1-3 (Search + BookingFunnel) = 4-6 weeks. Phase 4-8 (post-booking, master data, notifications, decommission) = 4-6 weeks. Total: 8-12 weeks, not the 6-8 weeks the Q2 deadline implies.
- **"The entire service should be under 5000 lines"** -- This is the application code estimate. It does not include: Dockerfile, CI/CD configuration, monitoring setup, deployment configuration, test code, test fixtures, migration tooling. These are real work for a solo developer.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "Per-endpoint migration is simpler and safer than per-client migration." If the booking funnel endpoints cannot be migrated independently (because itinerary IDs, booking schema caches, or booking IDs are not compatible across old and new services), the entire migration strategy must be rethought. The design would need either full-funnel cutover (higher risk, bigger blast radius) or per-client routing (which requires the Lambda authorizer or in-proxy routing that the design explicitly rejected). Three months of per-endpoint-first implementation creates code that assumes independent endpoint migration.

### Credit Where Due

This design is the most honest about its weaknesses. The self-critique section identifies 7 specific risks, including several that other designs ignore entirely. The "Unconventional Idea" section (reconfigure 12go directly, build nothing) demonstrates genuine first-principles thinking. The analysis of why simplification-in-place fails is the most rigorous of all designs.

---

## Disposable Architecture: Failure Mode Analysis

### Top 5 Ways This Fails

1. **The ACL/port-adapter boundary adds upfront cost that the Q2 deadline cannot absorb** -- Severity: High -- Likelihood: High
   - Root cause: The design creates three abstraction layers (Inbound Adapter / Domain / Outbound Adapter) with formal interfaces (`IBookingGateway`, `ITripSearcher`, `INotificationSender`), domain types (`Trip`, `Booking`, `Money`, `StationId`), and mapper classes at each boundary. For 13 endpoints that are fundamentally HTTP proxying, this is three layers of type conversion: client types -> domain types -> 12go types (and back). Each conversion is code that must be written, tested, and maintained. For a solo developer under a Q2 deadline, the upfront design cost of defining domain types, interfaces, and two complete sets of mappers is significant.
   - Early warning signal: The domain type definitions and interface contracts take more than 1 week to finalize before any endpoint is functional.
   - Mitigation: Start with direct client-to-12go mapping for the first 3-4 endpoints. Extract the domain layer later if the code suggests it. "You Ain't Gonna Need It" applies to the domain layer until F3 is actually decomposed.

2. **The "disposable adapter" premise assumes F3 decomposition will produce a clean new API** -- Severity: High -- Likelihood: Medium
   - Root cause: The entire architecture is built around the idea that the 12go adapter is "disposable" and will be replaced when F3 is decomposed. But F3 decomposition has no timeline, no target language, and no API design. The decomposed F3 might expose exactly the same HTTP API (in which case the adapter is permanent, not disposable). Or it might expose a completely different paradigm (gRPC, GraphQL, event-driven) that does not fit the `IBookingGateway` interface at all.
   - Early warning signal: F3 decomposition planning (Q2+) reveals that the new API surface is fundamentally different from what the `IBookingGateway` interface assumes (e.g., event-driven instead of request/response).
   - Mitigation: Design the interface to be simple enough that replacing it is genuinely cheap. The current `IBookingGateway` with 8 methods is reasonable, but if domain types become complex, replacement cost grows.

3. **Feature flag routing in the proxy creates a complex "both systems running" state** -- Severity: Medium -- Likelihood: High
   - Root cause: The design includes a MariaDB-backed feature flag system with per-client AND per-endpoint granularity. The proxy acts as a router: check flags, route to legacy or handle locally. This means the proxy must be able to forward requests to the old Denali/Etna services during migration. This adds a reverse-proxy capability to what is supposed to be a simple translation layer. Error handling becomes complex: what if the legacy service is down? What if the flag state is inconsistent? The flag refresh interval (30 seconds) means there is a window where different requests for the same client go to different backends.
   - Early warning signal: During the first per-client migration, a flag state race causes one request in a booking flow to go to the new service and the next to go to the old service.
   - Mitigation: Use API Gateway routing instead of in-proxy routing. Let the proxy handle only its own endpoints. Simpler, but loses per-client granularity.

4. **Contract testing with Hurl is proposed but no test infrastructure exists yet** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design invests significant attention in Hurl-based contract testing, WireMock stubs, drift detection, and three-level test strategy. This is excellent engineering but represents substantial work. A solo developer building 13 endpoints in PHP while learning the language must also set up Hurl, WireMock, drift detection scripts, and maintain test fixtures. The test infrastructure itself becomes a project.
   - Early warning signal: Test setup takes more than 2-3 days, or tests are skipped under deadline pressure.
   - Mitigation: Start with PHPUnit mapper tests using JSON fixtures. Add Hurl contract tests only for the most critical endpoints (Search, CreateBooking). Defer WireMock and drift detection to post-launch.

5. **The design does not choose a language** -- Severity: Medium -- Likelihood: N/A (structural gap)
   - Root cause: The design says "this design is language-agnostic by construction" and presents a comparison table but makes no firm recommendation. The language decision is described as "secondary to the deployment boundary question." In practice, the language choice determines development velocity, team maintainability, and operational fit. Deferring it means the design cannot be evaluated on feasibility -- will the booking schema mapper take 1 week (in C#) or 3 weeks (in PHP)? The answer depends entirely on the language.
   - Early warning signal: N/A -- this is a gap in the design, not a runtime failure.
   - Mitigation: Make the language choice explicit. The design's own analysis points toward .NET for build speed or PHP for operational alignment.

### Hidden Assumptions

- **"Roughly 60% of the codebase survives F3 decomposition"** -- This assumes the domain types (`Trip`, `Booking`, `Money`) are correct abstractions that will remain stable. If the domain model turns out to be too 12go-shaped (because it was designed against 12go's current API), it may not survive unchanged.
- **"The most expensive single replacement is the booking schema mapper"** -- This may be true for code replacement, but the most expensive replacement might actually be the ID mapping tables (station, operator, seat class, vehicle). If the decomposed F3 uses different IDs than the current F3, all mapping data must be regenerated.
- **"Contract tests are the single most durable artifact"** -- True, but only if the client contract never changes. The design does not account for the possibility that the client contract itself might evolve (new endpoints, new fields, deprecation of old versions).

### Optimistic Estimates (and realistic alternatives)

- **Week 1-2: Skeleton + Search** -- For a fresh project with three-layer architecture, domain interfaces, two sets of mappers, contract tests, feature flag table, and authentication bridge? In a language the developer is learning? Realistic: 3-4 weeks for the skeleton + Search endpoint with full test coverage.
- **Week 3-5: Booking Funnel** -- GetItinerary (the most complex endpoint, with 3 12go calls and the booking schema mapper) plus CreateBooking and ConfirmBooking in 2 weeks? Realistic: 3-4 weeks, especially with the three-layer type conversion overhead.
- **Total 7-8 weeks** -- Realistic: 10-14 weeks. This design has the highest upfront investment of all proposals.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "The domain layer provides meaningful isolation from 12go API changes." If the domain types are too thin (just renamed 12go types) they add overhead without isolation. If they are too thick (rich domain model), they constrain the adapter replacement when F3 decomposes. Three months in, the team discovers that the `IBookingGateway` interface does not match the decomposed F3's new API paradigm, and the "disposable adapter" turns out to require changes to the "permanent" domain layer and controllers as well. The entire three-layer investment becomes sunk cost.

### Credit Where Due

The survivability analysis table is the most thorough artifact-by-artifact assessment of what survives F3 decomposition. The contract testing strategy (Hurl + WireMock + drift detection) is the most complete testing approach across all designs. The "Two Services" unconventional idea (and its honest rejection for solo-developer reasons) shows mature architectural thinking.

---

## Data Flow Architect: Failure Mode Analysis

### Top 5 Ways This Fails

1. **The event design is speculative because the data team call has not happened** -- Severity: Critical -- Likelihood: High
   - Root cause: The design proposes 17 preserved events with detailed JSON schemas, a structured-logs-to-ClickHouse pipeline, and correlation ID propagation. But the design itself documents that the blocking dependency -- the data team call -- has not occurred as of March 17. RnD was assigned to "send list of event requirements from data side" on Feb 25 and has not delivered. The data team may need completely different events, different fields, different delivery mechanisms, or may already have coverage through T-Rex.
   - Early warning signal: The data team call reveals that (a) they need Kafka, not structured logs, or (b) T-Rex already covers booking events and most of these events are unnecessary, or (c) the event schema needs fields that are not available in the proxy.
   - Mitigation: Do not finalize event schemas before the data team call. Build the proxy first with minimal logging. Add events as a second pass once requirements are confirmed.

2. **Structured logs as the event pipeline are unreliable for business events** -- Severity: High -- Likelihood: Medium
   - Root cause: The design recommends structured JSON logs -> Datadog Agent -> ClickHouse as the event pipeline. The design acknowledges that "log pipelines can drop events under load" and "no replay." For analytics, this may be acceptable. But some of these events are described as "CRITICAL" (BookSucceeded for revenue tracking, ReservationConfirmationSucceeded for confirmed booking records). Losing revenue tracking events is not an analytics inconvenience -- it is a business data integrity problem.
   - Early warning signal: During load testing or production spikes, Datadog Agent backpressure drops events. Or Datadog -> ClickHouse pipeline latency makes dashboards stale for hours.
   - Mitigation: If any event is truly "CRITICAL," use Kafka for that event class. The design suggests this as an "upgrade path" but does not define the trigger for when to upgrade.

3. **The 33-event audit is thorough but creates scope pressure** -- Severity: Medium -- Likelihood: High
   - Root cause: The design identifies 33 current event types and proposes preserving 17 of them. Implementing 17 event types with the specified JSON schemas, correlation ID propagation, and post-response emission is real work. For a solo developer building 13 endpoints, adding 17 event emission points (plus failure variants) adds approximately 30% more code and testing. The design says "structured logs require zero infrastructure changes" -- true for the pipeline, but the application code to emit well-structured events with correct fields is not zero effort.
   - Early warning signal: Event implementation is deferred repeatedly because endpoint implementation takes longer than expected. Events ship incomplete or without the specified fields.
   - Mitigation: Implement only the 5 most critical events for launch (SearchCompleted, BookingReserved, BookingConfirmed, BookingCancelled, NotificationReceived). Add the rest post-launch.

4. **Correlation ID chain breaks at the 12go boundary** -- Severity: Medium -- Likelihood: High
   - Root cause: The design acknowledges that "Datadog APM spans in 12go will NOT carry [the correlation ID] as a trace tag." The 12go boundary is opaque. The design proposes sending `x-request-id` to 12go's MonologRequestProcessor, but joining traces requires querying two different systems (ClickHouse for B2B events, Graylog for 12go logs) by the same ID. In practice, this means the "end-to-end correlation" marketing is actually "correlation up to the 12go boundary, then manual log search."
   - Early warning signal: First production incident where a 12go API error needs root cause analysis, and the team spends 30+ minutes correlating across Datadog and Graylog.
   - Mitigation: Accept this limitation and document it. Build a simple query tool that searches both Datadog logs and 12go Graylog by correlation ID.

5. **PHP Symfony kernel.terminate assumption may not work for all deployment models** -- Severity: Low -- Likelihood: Low
   - Root cause: The design relies on Symfony's `kernel.terminate` event for zero-latency event emission. This works correctly with PHP-FPM (the response is sent, then the terminate event fires). But if the service is deployed behind a load balancer that considers the request "done" when the backend closes the connection, the `kernel.terminate` processing may be killed if the container is under memory pressure or the load balancer times out.
   - Early warning signal: Events are intermittently missing in ClickHouse, correlating with high-load periods.
   - Mitigation: Use a short async flush (log buffering) rather than relying entirely on kernel.terminate. Or accept that structured log event loss is within tolerance for analytics.

### Hidden Assumptions

- **"B2B traffic is a fraction of 12go's total volume"** -- Assumed but not verified. If B2B search traffic is substantial, the structured log volume could be significant and the Datadog Agent pipeline may need tuning.
- **"Datadog -> ClickHouse pipeline exists or can be created easily"** -- The design assumes Datadog can forward logs to ClickHouse. This requires a Datadog pipeline rule that may not exist today. If 12go's current setup is Kafka -> ClickHouse, asking them to also set up Datadog -> ClickHouse is a new infrastructure request.
- **"The data team will accept structured logs instead of Kafka"** -- Entirely unverified. The data team may have existing consumers that read from specific Kafka topics and cannot switch.

### Optimistic Estimates (and realistic alternatives)

- **Event implementation is "a logging call"** -- For each event, the developer must: define the event structure, populate all fields (including performance timing), handle error variants, test emission, and verify the fields match what ClickHouse expects. This is not a single logging call -- it is 17 separate structured event definitions.
- **"Can be set up in a Datadog pipeline rule without code changes"** -- Setting up Datadog pipeline rules requires Datadog admin access and configuration expertise that may not be available to Soso. This is a DevOps dependency.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "The data team's requirements are analytics-grade (minutes of latency acceptable, occasional event loss tolerable)." If the data team reveals (when the call finally happens) that they need guaranteed delivery for booking events (because revenue reconciliation depends on them), the entire structured-logs approach must be replaced with Kafka. This means adding php-rdkafka, negotiating Kafka cluster access, topic creation, ACL setup, and rewriting all event emission code. Three months of structured-log events are not retroactively available in Kafka.

### Credit Where Due

The 33-event audit is by far the most thorough analysis of what the current system emits and what must be preserved. No other design even attempts this inventory. The correlation ID strategy with its honest assessment of 12go boundary limitations is realistic. The recommendation to start with structured logs and upgrade to Kafka is pragmatic for a solo developer.

---

## Team-First Developer: Failure Mode Analysis

### Top 5 Ways This Fails

1. **PHP learning curve combined with Q2 deadline creates a quality-speed conflict** -- Severity: High -- Likelihood: High
   - Root cause: The design estimates 2-3 weeks for Soso to become productive in PHP, with 10-15% lower AI generation quality compared to TypeScript. For 13 endpoints in 8-10 weeks, losing 2-3 weeks to language ramp-up leaves 5-7 weeks for implementation. The booking schema mapper alone -- the most complex component -- must be implemented in an unfamiliar language. The design says "AI generation quality for PHP/Symfony is 70-75%" and acknowledges Symfony-specific conventions are a common failure mode. Quality will suffer under time pressure.
   - Early warning signal: The first 2 endpoints take 3+ weeks total, leaving only 5-7 weeks for 11 more endpoints plus testing.
   - Mitigation: Build a working prototype of the booking schema mapper in PHP as the very first task (not Search). If this critical component works, the rest is manageable. If it does not, pivot to .NET immediately.

2. **"The medicine that works" framing assumes PHP is actually accepted by management** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design recommends PHP to "avoid a political battle" and preserve "political capital." But the Team Lead's explicit position (Mar 17) was PHP *inside F3*, not a standalone PHP microservice. A standalone PHP service is a third option that neither the Team Lead (monolith) nor Soso (.NET microservice) explicitly proposed. It may satisfy neither party.
   - Early warning signal: Team Lead pushes back on a standalone PHP service, insisting that if it is PHP, it should be inside F3.
   - Mitigation: Get explicit approval for standalone PHP before starting implementation. Do not assume it will be accepted just because it is PHP.

3. **Post-departure maintainability assumes 12go PHP team will adopt the service** -- Severity: High -- Likelihood: Medium
   - Root cause: The central argument for PHP is "the 12go PHP team can maintain it." But the 12go PHP team maintains F3. A standalone Symfony service outside F3 is something they need to actively adopt. There is no organizational commitment from 12go to maintain B2B services. The service may end up as an orphan regardless of language -- not because nobody CAN maintain it, but because nobody is ASSIGNED to maintain it.
   - Early warning signal: After Soso's departure, no specific team or individual is assigned ownership of the B2B proxy service.
   - Mitigation: Get explicit ownership commitment from 12go team before starting. If no commitment, the language choice matters less than the design suggests.

4. **The AGENTS.md for AI-assisted development is well-designed but adds meta-work** -- Severity: Low -- Likelihood: Medium
   - Root cause: The design specifies a detailed AGENTS.md, naming conventions optimized for AI, file structure guidelines, and "patterns to avoid" rules. This is thoughtful meta-engineering, but writing and maintaining this documentation is work that competes with endpoint implementation under a tight deadline. A solo developer optimizing the AI tooling pipeline while trying to deliver 13 endpoints may be over-engineering the development process.
   - Early warning signal: More time spent configuring AI tooling and project structure than writing endpoint code.
   - Mitigation: Write a minimal AGENTS.md (10 lines, not 50) and iterate. The AI tools work without a perfect AGENTS.md.

5. **Morale assessment is perceptive but may be self-fulfilling** -- Severity: Medium -- Likelihood: Low
   - Root cause: The design frames PHP as "the medicine that works" and extensively discusses Soso's demoralization. While empathetic, this framing could become a self-fulfilling prophecy: the developer approaches PHP expecting misery, which reduces productivity and quality more than the language itself would. The design says "PHP is the choice Soso likes least" -- and then recommends it.
   - Early warning signal: Soso's productivity remains low after the ramp-up period, not because of PHP difficulty but because of motivational drain.
   - Mitigation: The design actually provides this mitigation: standalone service (not F3), modern PHP, AI assistance, veteran support. The risk is that these mitigations are insufficient.

### Hidden Assumptions

- **"12 years of C# knowledge is not leveraged"** -- The design treats .NET expertise as wasted. But significant C# knowledge transfers to PHP: HTTP concepts, JSON handling patterns, DI concepts, testing patterns. The 2-3 week ramp-up estimate may be pessimistic because the design underestimates conceptual transfer.
- **"Soso will resign after completing the transition"** -- This is stated as fact. If Soso does not resign (plans change), the PHP choice becomes a long-term penalty to a developer who would have been more productive in .NET. The design optimizes for the departure scenario and penalizes the staying scenario.
- **"No file exceeds 300 lines"** -- This is a structural goal, but the booking schema mapper in the current system is ~500 lines (in C#). In PHP without the same pattern matching capabilities, it could be longer. The 300-line limit may force artificial file splitting that reduces readability.

### Optimistic Estimates (and realistic alternatives)

- **"2-3 weeks getting productive with PHP/Symfony"** -- "Productive" in this context means writing correct, idiomatic Symfony code. For the booking schema parser with its 20+ dynamic field patterns, "productive" in PHP/Symfony may take 4-5 weeks, not 2-3.
- **"Build speed: 2-4 weeks slower than .NET"** -- This estimate appears low. If Search takes 2 weeks in PHP vs. 1 week in .NET, and the booking funnel takes 4 weeks vs. 2 weeks, the total difference is closer to 4-6 weeks. For a Q2 deadline, this is the difference between on-time and late.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "The 12go PHP team will adopt and maintain this service." If at month 3, 12go's team says "we maintain F3, not standalone services -- if you want us to own it, put it inside F3," then the entire standalone-PHP rationale collapses. The service must either be moved into F3 (significant rework, plus the F3 local dev problems) or remain an orphan (defeating the purpose of choosing PHP).

### Credit Where Due

The human constraint analysis is the most thoughtful and honest of all designs. The acknowledgment of Soso's planned departure and its implications for technology choice is unique -- no other design confronts this. The F3 local development friction analysis is the most detailed. The AGENTS.md specification for AI-assisted development is the most practical guide for Claude Code effectiveness.

---

## Platform Engineer: Failure Mode Analysis

### Top 5 Ways This Fails

1. **DevOps acceptance is assumed, not confirmed** -- Severity: Critical -- Likelihood: Medium
   - Root cause: The entire design is built on the premise that "PHP/Symfony is the only operationally responsible choice" because DevOps already knows PHP. But question G4 from the decision map is explicitly unresolved: "Will 12go DevOps support a standalone PHP Symfony container?" The design assumes yes. If DevOps says "we support F3, not random Symfony services -- if you want PHP, put it in F3," the design's core premise fails. The design distinguishes between F3 and standalone PHP for development reasons but assumes DevOps will treat them identically for operational reasons.
   - Early warning signal: DevOps pushback during the first deployment conversation. "We don't have a CI/CD template for standalone PHP services -- only for F3."
   - Mitigation: Ask DevOps explicitly before starting. This is a 1-hour conversation that should have happened already.

2. **Nginx reverse proxy requirement is not trivial** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design correctly notes that "PHP-FPM does not serve HTTP directly" and needs nginx as a reverse proxy. It recommends "matching whatever pattern F3 uses." But this means the service is actually two containers (nginx + PHP-FPM), or one container running two processes (with supervisord). Neither is as simple as "deploy a single container." The Dockerfile provided only shows the PHP-FPM container. The nginx configuration, the inter-container networking, and the process management are additional work.
   - Early warning signal: Soso spends 2-3 days setting up nginx + PHP-FPM communication, SSL termination, and health check routing before writing any application code.
   - Mitigation: Use Caddy instead of nginx (simpler configuration, auto-SSL). Or use `symfony serve` with a production-ready reverse proxy like FrankenPHP (a single-binary PHP server that does not require FPM).

3. **The on-call runbook assumes infrastructure knowledge that Soso does not have** -- Severity: Low -- Likelihood: Medium
   - Root cause: The design provides a detailed on-call runbook for debugging PHP-FPM issues, but Soso (the solo developer) will be the first person operating this service. He does not know PHP-FPM configuration, `pm.max_children` tuning, or `php-fpm-healthcheck` semantics. The runbook is written for an experienced PHP operator. Soso will be both the developer AND the operator during the transition period.
   - Early warning signal: First production issue requires PHP-FPM debugging knowledge that Soso does not have.
   - Mitigation: The design already mitigates this by stating "Restart is always safe: No state to lose." For a stateless service, the runbook can be simplified to "restart the container, check if 12go is up."

4. **Resource limits may be miscalibrated** -- Severity: Low -- Likelihood: Low
   - Root cause: The design specifies 0.25 CPU / 128MB request, 0.5 CPU / 256MB limit based on a workload analysis that assumes low CPU usage. But the booking schema parser (~500 lines of pattern matching) and search response restructuring involve non-trivial JSON manipulation. Under concurrent load, 8 PHP-FPM workers each parsing booking schemas could exceed the memory limit.
   - Early warning signal: OOM kills during load testing with concurrent booking schema requests.
   - Mitigation: Start with higher limits (1 CPU / 512MB) and tune down after observing real usage. Over-provisioning is cheap.

5. **The design is operationally complete but architecturally thin** -- Severity: Medium -- Likelihood: N/A (structural observation)
   - Root cause: This design is the most detailed on deployment, monitoring, alerting, on-call, and infrastructure. But it is the thinnest on the actual application architecture. There is no discussion of: how the 13 endpoints are structured internally, how the booking schema mapper works, how error handling translates across boundaries, how the booking ID mapping table is populated, or how the notification forwarding works. The design assumes these are "just PHP code" and focuses on infrastructure -- but for a solo developer, the code is the hard part.
   - Early warning signal: N/A -- this is a scope gap in the design document, not a runtime failure.
   - Mitigation: Complement this design with the application architecture from Team-First Developer or Pragmatic Minimalist.

### Hidden Assumptions

- **"dd-trace-php auto-instrumentation covers 100% of the spans this service needs"** -- True for HTTP in/out, but not for business-level spans (per-client tagging, booking ID tagging, endpoint-specific metrics). The design acknowledges custom spans are needed but describes them as minimal. In practice, getting the right Datadog tags for per-client monitoring is significant configuration work.
- **"PHP-FPM has predictable, request-scoped memory usage"** -- Generally true, but the booking schema response can be large (dynamic fields, seat maps). If a booking schema response is 200KB+ and needs to be parsed and mapped, 8 concurrent workers each holding a 200KB response plus the mapping data could approach the 256MB limit.
- **"Same base image, same FPM config, same Datadog setup"** -- The F3 container and the B2B proxy container may use the same base image, but F3's FPM config is tuned for F3's workload (which includes MariaDB queries, Redis access, Kafka production). The B2B proxy has a different workload profile. Copy-pasting F3's FPM config may not be appropriate.

### Optimistic Estimates (and realistic alternatives)

- **"Build time: ~2-3 minutes (Composer install is fast; no compilation step)"** -- Composer install with no cache can take 5-10 minutes for a Symfony project with dependencies. Layer caching helps, but the first build will be slower.
- **"20-30% reduced velocity compared to .NET for the first 2-3 weeks, decreasing to ~10% after familiarity builds"** -- This assumes a smooth learning curve. If the F3-style PHP conventions (which Symfony shares) are confusing, the velocity reduction may persist longer.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "DevOps treats a standalone PHP Symfony service identically to F3." If DevOps requires the service to go through F3's deployment pipeline (because they only have one PHP deployment template), the standalone service may need to be restructured to fit F3's build/deploy conventions. Or if DevOps requires the service to use F3's docker-compose configuration, the standalone development advantage is lost.

### Credit Where Due

The operational depth is unmatched. The Dockerfile with Datadog APM setup, the PHP-FPM configuration with rationale, the health check design philosophy (do NOT check 12go connectivity), the CI/CD pipeline matching F3's deployment process, and the on-call runbook are production-ready artifacts that other designs lack entirely. The analysis of why FPM health checks should not check upstream dependencies is a genuine insight.

---

## Clean Slate Designer: Failure Mode Analysis

### Top 5 Ways This Fails

1. **Go recommendation contradicts every organizational constraint** -- Severity: Critical -- Likelihood: High
   - Root cause: The design recommends Go for a solo .NET developer working on a system that will be maintained by a PHP team, deployed on PHP infrastructure, monitored with PHP-tuned Datadog, and operated by PHP-experienced on-call engineers. The design acknowledges these problems in the "What This Design Ignores" section but proposes Go anyway. "AI-assisted development neutralizes the learning curve" is a strong claim that is not supported by the Platform Engineer's analysis showing that `dd-trace-go` requires explicit manual instrumentation (no auto-instrumentation), DevOps has zero Go experience, and the on-call runbook for a Go service would need to be written from scratch.
   - Early warning signal: Soso spends the first 2 weeks fighting Go's error handling patterns, JSON marshaling verbosity, and lack of auto-instrumented Datadog tracing -- all documented as Go weaknesses in this design and others.
   - Mitigation: The design itself provides the mitigation: "The runner-up is TypeScript." Or fall back to PHP, which 4 of 6 design agents recommend.

2. **The design explicitly defers all operational concerns to "another agent"** -- Severity: High -- Likelihood: N/A (structural gap)
   - Root cause: The "What This Design Ignores" section lists: team learning curve, infrastructure operational burden (health checks, log aggregation, metrics, deployment, configuration management, certificates), event emission for ClickHouse, and replaceability when F3 decomposes. These are not nice-to-haves -- they are requirements. A design that explicitly ignores deployment, monitoring, event emission, and team capability is a design that cannot be implemented without significant supplementary work.
   - Early warning signal: N/A -- this is a scope gap that would be discovered immediately when implementation begins.
   - Mitigation: This design must be combined with the Platform Engineer and Data Flow Architect designs to be complete. As a standalone proposal, it is insufficient.

3. **"In-memory TTL cache for booking schema" fails in multi-instance deployment** -- Severity: High -- Likelihood: Medium
   - Root cause: The design notes that the booking schema field name map (from GetItinerary, used by CreateBooking) is stored in-memory. If the service runs as a single instance, this works. But any production deployment on 12go's infrastructure (8 EC2 instances) will likely run multiple instances behind a load balancer. If GetItinerary hits instance A and CreateBooking hits instance B, the schema field map is missing on instance B.
   - Early warning signal: CreateBooking fails intermittently with "missing field name map" errors after deployment to production with multiple instances.
   - Mitigation: The design acknowledges this: "For multi-instance, use Redis." But it says "Start with in-memory." Starting with in-memory and adding Redis later means the architecture changes after launch, which is additional work under time pressure. Use Redis from the start if multi-instance is the production deployment model.

4. **"~2,000 lines of Go" estimate excludes significant required code** -- Severity: Medium -- Likelihood: High
   - Root cause: The design estimates ~1,500-2,000 lines of Go for the proxy, with ~200 lines added for observability. But the Data Flow Architect identifies 17 events that need to be emitted. The Platform Engineer identifies Datadog APM integration, custom metrics, alerting, health checks, and configuration management. The Disposable Architecture design identifies contract tests, drift detection, and feature flag routing. Adding all of these brings the realistic total to ~4,000-5,000 lines plus ~2,000 lines of tests -- comparable to the PHP designs that explicitly account for operational code.
   - Early warning signal: The "clean" 2K-line estimate balloons as production requirements are added.
   - Mitigation: Accept that the production version is 2-3x the "clean" estimate and plan accordingly.

5. **Static mapping files checked into the repo create a maintenance burden** -- Severity: Medium -- Likelihood: Medium
   - Root cause: The design stores station mappings, operator mappings, and booking ID mappings as JSON files in the `data/` directory. These are "one-time exports" from the existing system. But station mappings change when new stations are added. Operator mappings change when operators are added or renamed. Updating these requires a code deployment (even though the data, not the code, changed). In F3's monolith, these mappings would be in the database and queryable without deployment.
   - Early warning signal: A new station is added in 12go, a client queries it, and gets a "station not found" error. The fix requires: export new mapping, commit to repo, build Docker image, deploy. This is a multi-hour process for a data change.
   - Mitigation: Add a config reload endpoint or load mappings from a URL (S3, database query) at startup with periodic refresh.

### Hidden Assumptions

- **"Go's simplicity (25 keywords, no inheritance, explicit error handling) makes it one of the most AI-friendly languages"** -- The Team-First Developer design estimates AI generation quality for Go at 75-80%, lower than TypeScript (85-90%) and .NET (80%). Go's error handling boilerplate is a specific area where AI generates verbose, cargo-culted code. The claim that Go is "AI-friendly" is contested by the data.
- **"12go is considering Go for their future"** -- The Feb 25 meeting says "Considering Go, but nothing decided." The Mar 17 meeting says the target language for F3 refactoring is "still unclear." Building on an unconfirmed strategic direction is a bet, not a plan.
- **"A single binary is operationally simpler than a Node.js process"** -- True in isolation, but operationally, a Go binary on PHP infrastructure is more complex than a Node.js process on PHP infrastructure. The infrastructure team has no tooling for either, but Node.js is at least widely known.

### Optimistic Estimates (and realistic alternatives)

- **"Total irreducible code: ~1,500-2,000 lines"** -- This is the thinnest estimate of all designs and does not include operational code. Realistic total for a production-ready service: ~4,000-5,000 lines of Go.
- **"A developer can read the entire codebase in an afternoon"** -- True for the 2K-line version. Not true for the 5K-line production version with observability, event emission, feature flags, and health checks.

### The Amplified Error Scenario

**The one wrong assumption that causes rework if discovered at month 3**: "AI-assisted development neutralizes the Go learning curve." If Soso discovers at month 3 that Go's JSON handling for the dynamic booking schema fields is genuinely painful (which the design itself flags as "the concrete cost of choosing Go"), and that AI tools generate verbose, hard-to-maintain Go code for this specific problem, the service may need to be rewritten in PHP or TypeScript. Three months of Go code become sunk cost.

### Credit Where Due

The irreducible complexity analysis is the most rigorous first-principles decomposition of the problem. By identifying exactly what transformations must exist in any correct implementation, the design establishes a lower bound on complexity that is genuinely useful for evaluating all other designs. The operation-type taxonomy (5 types for 13 endpoints) is the clearest structural analysis. The OpenAPI-first unconventional idea (and its partial adoption recommendation) is pragmatic.

---

## Cross-Cutting Red Flags

These issues appear across multiple designs and represent systemic risks, not design-specific problems.

### 1. The Data Team Call Has Not Happened

Every design that discusses events (Data Flow Architect explicitly, others implicitly) depends on understanding what the data team needs. This action item was assigned on Feb 25 and remains unresolved on Mar 17. Until this call happens, any event design is speculative. This blocks: event schema finalization, decision between structured logs vs. Kafka, verification of whether T-Rex already covers booking events, and understanding which ClickHouse dashboards must be preserved.

### 2. Solo Developer Is the Single Point of Failure -- No Design Can Fix This

All 6 designs acknowledge the solo-developer constraint. None can mitigate the bus factor risk. If Soso is unavailable for 2 weeks (illness, burnout, personal emergency), the transition stalls regardless of language or architecture. The Q2 deadline has no buffer for human contingency. This is an organizational risk, not a design risk, but it makes every timeline estimate fragile.

### 3. The Booking Funnel Is Not As Stateless As Designs Claim

Five of 6 designs describe the service as "stateless" or "nearly stateless." But the booking flow has cross-request state: the booking schema field name map (from GetItinerary) must be available at CreateBooking time. If the cart expires between these calls, the schema must be re-fetched, which requires re-adding to cart. This is a genuine stateful concern that most designs mention briefly and then proceed as if the service were stateless. The Clean Slate design is the most honest about this, identifying it as "the only state that is truly cross-request."

### 4. Notification Delivery Mechanism Is Genuinely Unknown

The webhook notification flow requires: (a) receiving webhooks from 12go, (b) transforming the payload, and (c) forwarding to the client's webhook endpoint. Step (c) requires knowing each client's webhook URL. No design has confirmed where client webhook URLs are stored or how outbound delivery (including retries) works. The Pragmatic Minimalist is the only design that admits "the 'forward to where' question is genuinely open."

### 5. Per-Client vs. Per-Endpoint Migration Is Not An Either/Or Choice

All designs choose per-endpoint migration and explicitly reject per-client migration (because AWS API Gateway cannot route by path parameter). But the booking funnel endpoints are interconnected. If Search is migrated but CreateBooking is not, the itinerary IDs must be compatible across old and new services. No design analyzes this cross-endpoint compatibility requirement in depth.

### 6. F3 Local Development Friction Is Cited By All But Experienced By Few

The Search POC documented 16 setup issues. Every design references this as evidence against the monolith approach. But these were first-time setup issues. It is not clear whether ongoing development (after setup) has the same friction level. The designs may be over-weighting a one-time cost.

---

## Unresolved Questions That Block All Designs

From the decision map's open questions, these must be answered before any design can proceed safely:

| # | Question | Why It Blocks | Urgency |
|---|---|---|---|
| **G4** | Will 12go DevOps support a standalone PHP Symfony container (or any non-F3 container)? | 5 of 6 designs propose standalone deployment. If DevOps says no, only the F3 monolith option remains. | **Blocking -- answer before architecture decision** |
| **G5** | Does a `clientId -> 12go apiKey` mapping already exist anywhere? | All designs need this mapping. If it does not exist, it must be created. If it exists in a specific format, the service must read that format. | **Blocking -- answer before implementation starts** |
| **G1** | Can AWS API Gateway route by `client_id` path parameter? | If yes, per-client migration becomes feasible and the per-endpoint-only constraint relaxes. If no (confirmed), all designs must use per-endpoint migration or in-proxy routing. | **High -- answer before migration strategy is finalized** |
| **G9-G11** | Data team event requirements, T-Rex coverage, ClickHouse pipeline | Blocks event schema finalization. Without this, the Data Flow Architect design is speculative and all other designs have an unknown scope item. | **High -- schedule the call this week** |
| **G3** | What is 12go's preferred language for new services? | Directly impacts D11 (language choice). If 12go says "PHP only," Go and .NET are dead. If they say "Go," the Clean Slate design gains credibility. | **Medium -- ask before committing to language** |
| **G6** | Can 12go add HMAC signing to webhooks? | All designs propose this as "future" security. If 12go says no, the IP allowlist + shared secret is the permanent solution, not a transitional one. | **Medium -- ask now, implement later** |
| **G7** | Will 12go ship native seat lock API? ETA? | If the ETA is after Q2, the proxy must implement temporary seat lock logic. If before Q2, it can simply proxy. | **Medium** |

---

## Red Team Verdict

This is not a recommendation. It is a list of conditions under which each design should NOT be chosen.

**Do NOT choose Pragmatic Minimalist if:**
- The Team Lead will not accept PHP inside F3 as the primary approach but will not give Soso freedom to choose a standalone service either. The design's recommendation (F3) and its fallback (standalone PHP) require different organizational approvals.
- Per-endpoint migration has not been validated for booking funnel cross-endpoint compatibility.

**Do NOT choose Disposable Architecture if:**
- The Q2 deadline is firm and non-negotiable. The three-layer ACL design has the highest upfront cost of all proposals and the most uncertain timeline.
- F3 decomposition is more than 12 months away. The disposability premium (extra layers, formal interfaces, three boundary types) does not pay off if the "disposal" event is distant.

**Do NOT choose Data Flow Architect if:**
- The data team call has not happened. Building 17 event types against unverified requirements is wasted effort if the data team needs something different.
- (This design is complementary -- it should be combined with a primary architecture design, not chosen as a standalone proposal.)

**Do NOT choose Team-First Developer if:**
- Nobody from the 12go team has committed to maintaining the standalone PHP service after Soso leaves. Without that commitment, the PHP choice loses its primary justification.
- The Q2 deadline cannot absorb 2-4 weeks of PHP ramp-up time. If the deadline is firm, .NET is faster to build.

**Do NOT choose Platform Engineer if:**
- DevOps has not confirmed they will support a standalone PHP container. The design's entire operational argument depends on this unverified assumption.
- (This design is operationally focused and should be combined with an application architecture design.)

**Do NOT choose Clean Slate Designer if:**
- The team that will maintain this service after Soso leaves does not know Go and has no plans to learn Go. The design explicitly defers team learning curve as "another agent's concern," but it is this team's concern.
- 12go has not confirmed Go as their strategic direction. Building the first Go service in the fleet on an unconfirmed strategic bet is high-risk for a critical-path transition.
- The dynamic JSON handling for the booking schema parser has not been prototyped in Go. The design identifies this as "the concrete cost of choosing Go" but does not prove it is manageable.
