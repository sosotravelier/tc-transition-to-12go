---
status: draft
last_updated: 2026-02-17
agent: V3-business-risk-assessor
---

# Business Risk Review: Migration Architecture Options

## 1. Executive Summary

This migration is moving a revenue-critical booking system — with live clients processing real financial transactions — from a 7-service .NET ecosystem to 12go's PHP infrastructure, and doing so while 20 foundational questions remain unanswered. Every option carries material risk, but they differ sharply in *where* that risk concentrates: Option A bets on 12go tolerating a permanent polyglot tax, Option B bets on deep organizational cooperation with the 12go team, and Option C bets on the system requirements staying thin enough that a gateway never grows a brain. The unanswered questions (Q1-Q5 especially) are not minor details — any single answer could kill an entire option overnight, and the team has no fallback plan for that scenario. My recommendation is **Option A (Trimmed .NET)** as the lowest-risk starting point, with a clear commitment to sunset .NET within 12-18 months via an incremental port to PHP — but only after the Q1-Q5 answers are locked.

---

## 2. Per-Option Risk Assessment

### 2.1 Option A: Trimmed .NET on 12go Infrastructure

#### Timeline Analysis

| Scenario | Person-Weeks | Calendar (2 engineers) | Notes |
|----------|:---:|:---:|---|
| **Design estimate** | 16 | ~8 weeks | As stated in architecture doc |
| **Optimistic** | 20 | ~10 weeks | Add 25% for integration testing surprises, Polly tuning, Pact recording issues |
| **Likely** | 26-30 | ~14-16 weeks | Add: 2-3 weeks waiting for 12go K8s access / staging env; 2 weeks debugging pricing edge cases in canary; 2-3 weeks for infrastructure coordination (networking, DNS, secrets, TLS) that nobody estimated; 1 week for each "answer to Q1-Q5 changes something" adjustment |
| **Pessimistic** | 36-42 | ~20-22 weeks | Add: Q3 answer reveals non-K8s infra (ECS, Fargate) requiring rework; pricing SDK breaks in new environment; DynamoDB→Redis migration reveals hidden state dependencies; 12go staging environment isn't production-like and bugs emerge at canary |

**My honest estimate**: 14-16 weeks with 2 dedicated engineers. The 16 person-week estimate is plausible for *development work alone* but omits coordination overhead, environment setup blockers, and the inevitable debugging cycle during canary.

**Hidden timeline risk**: The estimate assumes Q1-Q3 are answered favorably *before* work starts. If the team begins building before getting 12go's answers, up to 4 weeks of work could be wasted if a critical assumption is wrong.

#### Top 5 Risks

| # | Risk | Probability | Impact | Mitigation | If Mitigation Fails |
|---|------|:---:|:---:|---|---|
| 1 | **12go refuses to run .NET containers** — They mandate PHP-only on their infrastructure, or .NET container support exists on paper but lacks operational tooling (monitoring agents, log shippers, secret injection). | **High** | **Critical** | Confirm Q2/Q3 in writing *before starting any work*. Get a test .NET pod deployed in staging as proof of concept in week 1. | Option A is dead. Pivot to Option B or C. 2-4 weeks of work lost if already started. |
| 2 | **Pricing regression in production** — Ushba Revenue SDK behaves differently in the new consolidated service (different DI configuration, different currency rounding, different exchange rate source timing). Client gets wrong price, books at wrong price, revenue leakage. | **Medium** | **Critical** | Golden file tests with 1,000+ real price calculations. Parallel price comparison logging during canary (old service price vs new service price for identical requests). Hard circuit breaker: any price diff > $0.01 auto-reverts canary traffic. | Revenue loss. Client trust damage. Manual reconciliation of affected bookings. Potentially weeks of debugging subtle numerical differences. |
| 3 | **DynamoDB→Redis migration loses booking state for in-flight transactions** — During cutover, bookings that started on old path (GetItinerary with DynamoDB token) cannot complete on new path (expects Redis token), or vice versa. | **Medium** | **High** | Run both paths simultaneously during canary. A booking started on old path stays on old path for its entire lifecycle. Use booking token format as the discriminator. Never migrate mid-funnel bookings. | Client sees "booking token not found" errors. Must retry the entire booking from GetItinerary. Revenue impact if client abandons. |
| 4 | **Polyglot tax becomes permanent** — The .NET service was supposed to be a 12-18 month bridge but nobody sets a sunset date. 12go team builds resentment maintaining infrastructure they don't understand. Knowledge transfer never happens. The service slowly rots. | **High** | **Medium** | Write the sunset plan into the migration charter. Set a contractual PHP migration date. Budget the PHP rewrite as Phase 2 in the same project, not a future TODO. | 12go carries two tech stacks indefinitely. Operational incidents in the .NET service have slow response (no PHP-native team member understands it). Eventually the service becomes unmaintainable. |
| 5 | **Internal .NET NuGet dependencies break in 12go's environment** — Ushba Revenue SDK, Connect.Infra.Cyphering, Connect.Infra.Observability expect specific config providers, secret managers, or network endpoints that don't exist in 12go's cluster. | **Medium** | **Medium** | Inventory every NuGet dependency's runtime requirements (config keys, service endpoints, feature flags). Test in isolation before integration. Have stubs/mocks for any missing external service. | Multi-week debugging cycle. May need to fork/inline some SDKs. Adds 2-4 weeks to timeline. |

#### Scores (1-5, 5 = best/lowest risk)

| Criteria | Score | Rationale |
|----------|:---:|---|
| Migration Risk | **3** | Low code risk (reuse), but infrastructure integration is unproven |
| Timeline Realism | **4** | Most realistic estimate; least new code to write |
| Rollback Safety | **4** | Clean canary with per-endpoint rollback; 12go is source of truth |
| Client Impact | **5** | Zero client-side changes; byte-for-byte API compatibility |
| Team Skill Match | **5** | Existing .NET team, existing codebase, known patterns |
| Organizational Dependency | **3** | Need K8s access and .NET container agreement, but no code-level dependency on 12go team |
| Ongoing Maintenance Cost | **2** | Polyglot tax is real and ongoing: two runtimes, two CI pipelines, two debugging toolchains |
| Future Flexibility | **3** | Good near-term, but .NET island on PHP continent limits evolution |
| **Weighted Total** | **29/40** | |

#### Kill Criteria

Option A becomes unviable if:
- 12go answers Q2 with "PHP only, no exceptions"
- 12go's infrastructure (Q3) cannot run Docker containers or has no Kubernetes
- The internal NuGet packages (Ushba Revenue SDK, Connect.Infra.*) have hard dependencies on services that won't exist in 12go's environment and cannot be stubbed
- 12go team refuses to include .NET in their on-call rotation and our team cannot provide 24/7 support

---

### 2.2 Option B: PHP Native (Frontend3 Internal Bundle)

#### Timeline Analysis

| Scenario | Person-Weeks | Calendar (2 engineers) | Notes |
|----------|:---:|:---:|---|
| **Design estimate** | 17 (incl. ramp-up) | ~9-10 weeks | As stated in architecture doc |
| **Optimistic** | 22 | ~12 weeks | Add: 1 week for frontend3 onboarding bureaucracy; 1 week for unanticipated BookingProcessor complexity; ramp-up takes 3 weeks not 2 |
| **Likely** | 30-36 | ~16-18 weeks | Add: 4 weeks PHP ramp-up (not 2 — learning Symfony while simultaneously building production code is harder than anyone admits); 2-3 weeks blocked on 12go PR reviews; 2 weeks debugging frontend3 internal API quirks (undocumented edge cases, implicit state, binary formats like PriceBinaryParser); 1-2 weeks for pricing port validation |
| **Pessimistic** | 42-50 | ~22-26 weeks | Add: 12go team pushback on bundle approach causes design renegotiation; frontend3 internal API changes during development break our code; BookingProcessor turns out to be more complex than documented; PHP ramp-up takes 6 weeks for production-quality code |

**My honest estimate**: 16-20 weeks with 2 engineers. The 17 person-week estimate dramatically understates the coordination overhead with 12go and the real cost of learning a new language while building production-critical code.

**The "2-4 week ramp-up" fiction**: The architecture doc claims developers will be independent PHP contributors in 2-4 weeks. I've seen this claim in every language migration I've managed. The truth: developers will write syntactically correct PHP in 2 weeks, but writing *idiomatic, production-quality Symfony code that passes 12go's code review* takes 6-8 weeks. During weeks 2-6, expect 50% productivity at best — every PR will have extensive review feedback, and debugging will take 3x longer than in the familiar language.

#### Top 5 Risks

| # | Risk | Probability | Impact | Mitigation | If Mitigation Fails |
|---|------|:---:|:---:|---|---|
| 1 | **12go rejects the internal bundle approach** — They don't want external code in frontend3, or their release process doesn't accommodate external contributors, or legal/compliance blocks shared codebase. | **Medium** | **Critical** | Get explicit written approval from 12go engineering leadership *and* their release manager before writing any code. Deploy a "hello world" bundle through their full CI/CD pipeline as a proof of concept. | Entire design scrapped. Fall back to Option B(a) (PHP Thin Proxy via HTTP) or Option A. 4-6 weeks lost if already building the bundle. |
| 2 | **Frontend3 internal API changes break our bundle** — 12go refactors BookingProcessor, changes CartHandler signatures, renames services, or alters internal data formats. We discover this when our tests fail on their next release. | **High** | **High** | Comprehensive integration tests running in frontend3's CI pipeline (must pass before their release). Establish a breaking-change notification channel. Pin to specific service interfaces. | Recurring breakages. Each one requires urgent coordination. Over time, 12go starts seeing our bundle as a liability that slows their releases. Political pressure to remove it. |
| 3 | **Pricing port introduces subtle financial errors** — The Ushba Revenue SDK pricing logic is ported to PHP, but floating-point behavior, rounding rules, or currency conversion edge cases differ between .NET decimal and PHP float. | **High** | **Critical** | Golden file tests with 1,000+ calculations. Use `bcmath` or integer cents in PHP (not floats). Parallel price comparison during shadow testing. Zero tolerance: any discrepancy blocks cutover. | Revenue leakage or overcharging. Client complaints. Financial reconciliation nightmare. Trust damage that takes months to repair. |
| 4 | **Team PHP ramp-up takes much longer than estimated** — Engineers struggle with PHP/Symfony idioms. Code quality is low. 12go reviewers reject PRs repeatedly. Morale drops as experienced .NET developers feel unproductive. | **High** | **Medium** | Start ramp-up before the project officially begins (during the Q1-Q5 answer waiting period). Budget 6 weeks, not 2-4. Hire a PHP contractor as an accelerator if needed. Use AI-assisted coding tools aggressively. | Schedule slips by 4-8 weeks. Burnout risk. Team members may leave if forced into a language transition they don't want. |
| 5 | **Performance degradation on shared frontend3 infrastructure** — Our partner API traffic causes memory pressure, connection pool exhaustion, or CPU contention that affects 12go.com's main traffic. | **Low** | **Critical** | Separate pod group with dedicated resource limits. Load test in staging before production. Rate limiting on partner API. Monitoring alerts for cross-contamination signals. | 12go.com goes down because of our traffic. Relationship damage. Possible emergency removal of the bundle. Catastrophic timeline setback. |

#### Scores (1-5, 5 = best/lowest risk)

| Criteria | Score | Rationale |
|----------|:---:|---|
| Migration Risk | **2** | High: new language, coupling to undocumented internals, binary data formats |
| Timeline Realism | **2** | Estimate excludes realistic ramp-up time and 12go coordination overhead |
| Rollback Safety | **4** | Per-endpoint ingress routing; .NET services stay deployed during canary |
| Client Impact | **4** | URL path changes to `/partner/v1/*` but response contracts preserved |
| Team Skill Match | **1** | PHP is a foreign language for the team; 6-8 week real ramp-up |
| Organizational Dependency | **1** | Maximum dependency on 12go: repo access, PR reviews, release coordination, pair programming |
| Ongoing Maintenance Cost | **5** | Best long-term: single stack, 12go team can own it |
| Future Flexibility | **5** | Best: integrated with platform, can leverage all frontend3 capabilities |
| **Weighted Total** | **24/40** | |

#### Kill Criteria

Option B becomes unviable if:
- 12go answers Q1 with anything other than "internal bundle welcome"
- 12go's release process requires weeks-long approval cycles for each bundle PR
- Frontend3's internal services are so undocumented/unstable that integration testing is impossible
- The team cannot hire or train PHP developers within the project timeline
- 12go's BookingProcessor uses binary serialization formats (PriceBinaryParser) that are impractical to consume safely from the bundle

---

### 2.3 Option C: Thin Stateless API Gateway

#### Timeline Analysis

| Scenario | Person-Weeks | Calendar (2 engineers) | Notes |
|----------|:---:|:---:|---|
| **Design estimate** | 20 | ~12 weeks (2 engineers) | As stated in architecture doc |
| **Optimistic** | 24 | ~13 weeks | Add: 1 week for BookingToken edge cases (expiry, key rotation); 1 week for recheck flow tuning; 1 week for pricing engine validation |
| **Likely** | 32-38 | ~17-20 weeks | Add: 2-3 weeks for Q5 answer revealing incomplete booking details (need to add a DB after all); 2 weeks for self-contained token approach proving fragile in production (cart expiry timing, token size, encryption key management); 2-3 weeks for scope creep (someone asks for analytics, ticket generation, or webhook processing); 2 weeks for 12go rate limit negotiations |
| **Pessimistic** | 44-52 | ~23-27 weeks | Add: the gateway inevitably thickens (pricing + caching + seat locks + idempotency + analytics = it's Option A in disguise); 12go API rate limits force heavy caching (adds state); Q5 answer requires a booking DB (goodbye "stateless"); the team spends weeks building a gateway that leadership later decides should have been PHP |

**My honest estimate**: 17-22 weeks with 2 engineers. The design doc's 20 person-week estimate is reasonable for the initial "thin" gateway, but the gateway *will not stay thin*. By month 3, scope creep will have added at least 20-30% more features.

**The scope creep problem**: Option C is the most intellectually honest about its own weakness — the architecture doc itself includes a "When This Option Breaks Down" section and a "Creep Warning" timeline showing how a thin gateway becomes Option A. This candor is valuable, but it also reveals the core fragility: **the option's viability depends on requirements staying permanently minimal**, which contradicts every migration I've managed.

#### Top 5 Risks

| # | Risk | Probability | Impact | Mitigation | If Mitigation Fails |
|---|------|:---:|:---:|---|---|
| 1 | **Scope creep transforms thin gateway into thick service** — Pricing logic, seat lock state, search caching, idempotency keys, analytics events, ticket generation — each individually small, collectively they make the gateway as complex as Option A but without Option A's proven codebase. | **Very High** | **High** | Define a strict scope boundary in writing. If the gateway exceeds 150 files or 3 Redis data types, formally re-evaluate and consciously switch to Option A. Appoint a "scope guardian" who says no. | After 6 months, you have an ad-hoc service that does everything Option A does but without the battle-tested code. Worst of both worlds: same complexity, less reliability. |
| 2 | **12go GetBookingDetails endpoint is incomplete (Q5)** — Missing fields force adding a local booking database, which fundamentally undermines the "no DB" premise. | **Medium** | **Critical** | Get Q5 answered definitively before starting. Test the GET /booking/{id} endpoint against every field the client contract requires. Document exact field mapping. | The "thin gateway" needs a PostgreSQL database. This adds 3-4 weeks of development, an ongoing operational burden, and makes the architecture indistinguishable from Option A. |
| 3 | **Self-contained BookingToken proves fragile** — Cart expires before client uses the token. Key rotation invalidates in-flight tokens. Token payload grows too large as requirements expand. Encrypted tokens are opaque and impossible to debug in production. | **Medium** | **High** | Set token TTL conservatively (5 min shorter than cart TTL). Implement key rotation with grace period. Log decrypted token contents (minus secrets) for debugging. Have Redis fallback ready. | Fall back to Redis-backed booking tokens (which is what Option A does). The "stateless" advantage disappears. Development time spent on token infrastructure is partially wasted. |
| 4 | **12go API rate limits crush the stateless model** — Without local caching, every search hits 12go directly. If 12go has limits below 500 RPS, popular routes during peak hours will exceed limits, causing 429 errors for clients. | **Medium** | **High** | Get Q18 answered before design finalization. Add search caching from day 1 (don't make it optional). Implement client-aware rate limiting that distributes quota fairly. | Add heavy caching layer. The gateway becomes a caching proxy with significant state, debugging complexity, and cache invalidation headaches. |
| 5 | **Pricing regression with no safety net** — Same risk as all options, but Option C has no established pricing test infrastructure to port from. The pricing engine is reimplemented inline, without the Ushba SDK's edge case handling. | **Medium** | **Critical** | Extract test cases from the existing system before building the new pricing engine. Same golden file approach as other options. Parallel comparison during shadow testing. | Revenue impact. Same as other options but potentially harder to debug because the pricing code is new and untested (no production history). |

#### Scores (1-5, 5 = best/lowest risk)

| Criteria | Score | Rationale |
|----------|:---:|---|
| Migration Risk | **3** | Simpler architecture, but more new code and unproven token approach |
| Timeline Realism | **3** | Reasonable if scope stays thin; unrealistic if scope creeps |
| Rollback Safety | **4** | Same reverse strangler pattern as A; per-endpoint rollback |
| Client Impact | **5** | Zero client-side changes; same contracts |
| Team Skill Match | **4** | .NET team, but new codebase (no reuse of battle-tested code) |
| Organizational Dependency | **3** | Same as A: need K8s access and container agreement |
| Ongoing Maintenance Cost | **3** | Thin initially, but maintenance cost grows with scope creep |
| Future Flexibility | **2** | Good only if requirements stay minimal; poor if features grow |
| **Weighted Total** | **27/40** | |

#### Kill Criteria

Option C becomes unviable if:
- Q5 answer requires local booking storage (adds a DB, it's now Option A)
- Q18 reveals rate limits requiring heavy caching (adds significant state)
- More than 3 custom features are requested beyond contract translation + pricing
- 12go asks the team to own business logic (routing, fallback, inventory)
- Multi-supplier requirement returns (contradicts single-supplier simplification premise)
- The gateway exceeds 150 source files within 6 months of launch

---

## 3. Comparison Matrix

| Criteria | Option A (Trimmed .NET) | Option B (PHP Native) | Option C (Thin Gateway) |
|---|:---:|:---:|:---:|
| **Migration Risk** | 3 | 2 | 3 |
| **Timeline Realism** | 4 | 2 | 3 |
| **Rollback Safety** | 4 | 4 | 4 |
| **Client Impact** | 5 | 4 | 5 |
| **Team Skill Match** | 5 | 1 | 4 |
| **Organizational Dependency** | 3 | 1 | 3 |
| **Ongoing Maintenance Cost** | 2 | 5 | 3 |
| **Future Flexibility** | 3 | 5 | 2 |
| **TOTAL** | **29** | **24** | **27** |

**Short-term winner** (next 6 months): **Option A** — lowest execution risk, fastest to production, existing team can deliver.

**Long-term winner** (18+ months): **Option B** — single stack, best maintainability, natural ownership by 12go.

**Best theoretical architecture**: **Option C** — cleanest design on paper, but fragile under real-world scope pressure.

---

## 4. Q1-Q20 Sensitivity Analysis

The most impactful unanswered questions can swing the entire recommendation. Here is how different answers shift the risk profile:

### Q1: Integration Method

| If 12go says... | Impact |
|---|---|
| **"Keep HTTP REST"** | Options A and C are viable. Option B(b) (internal bundle) is still possible but less compelling. |
| **"We want direct code integration (Symfony bundle)"** | Option B becomes strongly preferred. Option A is wasteful (why maintain an HTTP proxy when you can call in-process?). Option C is redundant. |
| **"Direct database access is fine"** | Extremely dangerous. All three options should still use the service API, not raw SQL. Option B(c) was wisely rejected. Refuse this option even if offered. |
| **"We'll provide a gRPC API"** | All three options work with adapter changes. Slight advantage to C (even thinner with gRPC). |

### Q2: Programming Language

| If 12go says... | Impact |
|---|---|
| **"PHP only, no exceptions"** | **Option A is dead.** Option B becomes mandatory. Option C survives only if rewritten in PHP (loses the code-reuse advantage). |
| **"We tolerate .NET containers"** | All options viable. A and C gain breathing room. |
| **"We're moving to Go/Rust/whatever"** | Wildcard. All current plans need revision. Option C (language-agnostic by design) is most resilient. |

### Q3: Infrastructure

| If 12go says... | Impact |
|---|---|
| **"AWS EKS (Kubernetes)"** | All options work as designed. Best case. |
| **"AWS ECS/Fargate"** | All options work with container adjustment. Option B may need sidecar patterns instead of shared pod groups. +1-2 weeks. |
| **"Bare metal / PHP-FPM on VMs"** | **Options A and C are significantly harder** (no container orchestration). Option B wins (runs inside PHP-FPM natively). |
| **"Serverless (Lambda)"** | Option C partially works (but Lambda cold starts hurt booking latency). Options A and B are impractical on Lambda. |

### Q4: Multi-Client Support

| If 12go says... | Impact |
|---|---|
| **"We have per-partner config"** | All options simplify. Pricing/markup layer may be eliminable. Largest simplification for Option C (closer to truly thin). |
| **"No partner concept — you manage clients"** | As assumed. All options carry the pricing/markup burden. No change. |

### Q5: Booking Storage

| If 12go says... | Impact |
|---|---|
| **"GET /booking/{id} returns everything"** | All options viable as designed. Option C's "no DB" promise holds. |
| **"Some fields are missing"** | Options A and B absorb this easily (add a thin persistence layer). **Option C's core premise breaks** — it needs a DB, converging toward Option A with extra work. |

### Q14: Monitoring

| If 12go says... | Impact |
|---|---|
| **"We support W3C Trace Context + OTLP"** | All options get end-to-end distributed tracing. Best case. |
| **"No trace propagation, we use our own system"** | All options lose cross-boundary tracing. Debugging production issues becomes log-correlation-only. Customer support impact: longer resolution times. Affects all options equally. |

### Critical Combinations

| Combination | Outcome |
|---|---|
| Q2="PHP only" + Q1="internal bundle OK" | **Option B is the only viable path.** |
| Q2="PHP only" + Q1="HTTP only" | Option B(a) (PHP Thin Proxy). A new PHP service calling 12go over HTTP. Worst case: all the PHP ramp-up pain with none of the code reuse benefits. |
| Q5="fields missing" + Q18="strict rate limits" | **Option C is dead.** It needs both a DB and a cache, making it heavier than Option A with less proven code. |
| Q1="HTTP" + Q2=".NET OK" + Q3="K8s" | **The happy path.** All options viable. Choose on merit. |

---

## 5. The "18 Months Later" Scenario

### Option A: 18 Months After Migration

The .NET unified API service is running in 12go's cluster. It works. Clients are happy. But:

- **The "temporary bridge" is now permanent.** Nobody prioritized the PHP rewrite because the service works fine. The original engineers who built it have moved to other projects.
- **12go's ops team grudgingly maintains the .NET container.** They've learned to restart pods and read basic logs, but when a real .NET issue occurs (GC tuning, thread pool starvation, NuGet dependency conflict), they escalate to... nobody, because the original team is gone.
- **The Ushba Revenue SDK hasn't been updated in 8 months** because the team that owned it moved on. A pricing bug is discovered, and nobody knows how to build/deploy the fix.
- **Connect.Infra.* packages are now abandoned** by the parent organization, which has fully committed to PHP. Security patches aren't being applied.
- **Adding a new feature** (e.g., a new client endpoint, a new booking field) requires finding a .NET developer, setting up the dev environment, understanding the consolidated codebase, making the change, and navigating a CI/CD pipeline that nobody has touched in months. Estimated time for a "simple" feature: 2-3 weeks. In a PHP service it would be 2-3 days.
- **The service is a technical debt island** that everyone acknowledges but nobody owns.

### Option B: 18 Months After Migration

The PartnerApiBundle ships with every frontend3 release. It's PHP, it's integrated, the 12go team understands it:

- **New features are straightforward.** A developer adds a new endpoint to the bundle, writes tests, opens a PR. Reviewed and merged within 2 days. This is the best-case long-term scenario.
- **BUT**: There was a painful incident at month 9 when 12go refactored the BookingProcessor. The bundle's integration tests caught the breakage in CI, but fixing it took 3 days of urgent cross-team coordination. 12go considered it our problem; we considered it theirs.
- **The pricing service** (ported from Ushba SDK) has diverged from the original. Two subtle rounding bugs were found and fixed. It works, but nobody is confident it matches the original exactly anymore.
- **Team knowledge** is healthy — the developers who built it are now proficient PHP developers who can maintain and extend it. The 12go team can also modify it if needed.
- **The biggest ongoing cost** is coordination: every frontend3 release requires checking that the bundle still works. Every 3-4 months, a frontend3 change breaks something in the bundle, and there's a scramble to fix it before release day.

### Option C: 18 Months After Migration

The "thin gateway" is no longer thin:

- **Month 3**: Added search result caching because 12go asked us to reduce API load.
- **Month 5**: Added a booking persistence layer because a client needed booking history for reconciliation, and 12go's GET endpoint didn't have the right timestamps.
- **Month 8**: Added PDF ticket generation because 12go's ticket URLs expire after 30 days and a client needs 90-day access.
- **Month 11**: Added Kafka event publishing because the analytics team needs booking events.
- **Month 14**: Added a background worker to process webhook notifications with retry logic.
- **Month 18**: The gateway has 250+ source files, PostgreSQL, Redis, Kafka producer, and a background worker. It is functionally identical to Option A, but built incrementally without the architectural coherence of a planned design. It's harder to maintain than Option A would have been.
- **Adding a new feature** is unpredictable — some changes are easy (new translation), some require archaeology to understand how the gateway's organic growth interconnected.

---

## 6. Hidden Costs

These costs are absent or underrepresented in all three architecture documents:

### 6.1 Coordination Overhead with 12go Team

| Activity | Estimated Cost | Affects |
|---|---|---|
| Getting answers to Q1-Q20 (scheduling meetings, chasing answers, waiting) | 2-4 weeks of calendar time | All options |
| Negotiating K8s access, staging environment, CI/CD integration | 2-3 weeks of engineer time across meetings, tickets, waiting | A, C |
| PR review cycles for frontend3 bundle (back-and-forth, code style debates) | 1-2 weeks of calendar delay per major PR | B |
| Agreement on Kafka topic ownership, schema, and consumer coordination | 1 week | All options |
| Agreement on monitoring/alerting responsibilities and escalation paths | 0.5-1 week | All options |
| Coordinating canary rollout scheduling (who monitors, who rolls back, at what hours) | 1 week | All options |
| **Total coordination overhead** | **7-12 weeks of calendar time** | **Not in any estimate** |

### 6.2 Knowledge Transfer & Documentation

| Activity | Estimated Cost | Notes |
|---|---|---|
| Documenting current .NET system behavior (edge cases, pricing quirks, error handling) before it's deleted | 2-3 person-weeks | If you delete the old code without documenting its behavior, you lose the knowledge forever. Nobody does this. |
| Documenting the new system for 12go's team (ops runbooks, debugging guides, architecture diagrams) | 1-2 person-weeks | Required for handover. |
| Recording all Pact contracts / golden files from the production .NET system | 1 person-week | Must be done while old system is still live. |

### 6.3 Client Communication & Testing

| Activity | Estimated Cost | Notes |
|---|---|---|
| Notifying clients of migration (even if contracts are unchanged, clients need to know) | 0.5 person-week | Some clients will want to test anyway. |
| Supporting client-side regression testing | 1-2 person-weeks | Clients will report phantom issues. Each one needs investigation. |
| URL/DNS changes if applicable (Option B's `/partner/v1/*` path) | 0.5-1 person-week | Plus client-side changes if paths change. |

### 6.4 Monitoring & Alerting Setup

| Activity | Estimated Cost | Notes |
|---|---|---|
| Building new Grafana dashboards for the new service | 1 person-week | Old dashboards won't work with new metric names (even Option A changes some). |
| Setting up alerts with appropriate thresholds (tuning after go-live) | 1 person-week | Thresholds need tuning during canary — too sensitive = alert fatigue, too loose = missed issues. |
| Validating end-to-end tracing works (OTel Collector → Coralogix → queryable) | 0.5 person-week | Commonly underestimated. |

### 6.5 Performance Tuning Post-Migration

| Activity | Estimated Cost | Notes |
|---|---|---|
| Connection pool tuning (to 12go, to Redis) | 0.5-1 person-week | Defaults are rarely optimal. |
| Cold start / warm-up optimization | 0.5 person-week | First requests after deploy may be slow. |
| Identifying and fixing latency regression from removing caching layers | 1-2 person-weeks | Removing DynamoDB/HybridCache means every call hits 12go. Some paths will be slower. |

### 6.6 Bug Fixing During Parallel Run

| Activity | Estimated Cost | Notes |
|---|---|---|
| Investigating discrepancies between old and new service responses | 2-4 person-weeks | This is the single most underestimated cost in every migration I've managed. During shadow/canary, you will find dozens of subtle differences — most benign, some critical. Each one requires investigation. |

### Hidden Cost Summary

| Category | Person-Weeks | Applies To |
|---|---|---|
| Coordination overhead | 4-8 | All |
| Knowledge transfer | 3-5 | All |
| Client communication | 1.5-3.5 | All (more for B) |
| Monitoring & alerting | 2.5 | All |
| Performance tuning | 2-3.5 | All |
| Bug fixing during parallel run | 2-4 | All |
| **Total hidden costs** | **15-27.5** | **Add to every option's estimate** |

This means the *real* total effort for each option is:

| Option | Stated Estimate | + Hidden Costs | Realistic Total | Calendar (2 engineers) |
|---|:---:|:---:|:---:|:---:|
| A | 16 pw | +15-27 pw | **31-43 pw** | **16-22 weeks** |
| B | 17 pw | +18-30 pw | **35-47 pw** | **18-24 weeks** |
| C | 20 pw | +15-27 pw | **35-47 pw** | **18-24 weeks** |

---

## 7. The "What If It Fails" Playbook

### 7.1 Option A: Failure Recovery

**At 25% complete** (consolidated codebase built, not yet deployed):
- **State**: New .NET solution exists locally. Old services still running untouched in production.
- **Recovery**: Stop work. Discard new solution. No production impact. Cost: 4-6 person-weeks wasted.
- **Residual value**: Pact contracts recorded, knowledge of code inventory useful for any future attempt.
- **Decision time**: ~2 days.

**At 50% complete** (deployed to 12go staging, integration testing in progress):
- **State**: New service exists in 12go staging. Old services still in production. No client traffic on new path.
- **Recovery**: Delete staging deployment. Stop work. No production impact. Cost: 8-12 person-weeks wasted.
- **Residual value**: Integration testing revealed 12go infra issues that inform any future migration.
- **Decision time**: ~3 days.

**At 90% complete** (canary live, 50%+ traffic on new service):
- **State**: New service handling real client traffic. Old services running in parallel on reduced load.
- **Recovery**: Shift all traffic back to old services via ingress config change. Takes 5-15 minutes. Bookings created on new path are in 12go (source of truth) — old services can read them.
- **Risk during recovery**: Brief increase in error rate during traffic shift. Clients with in-flight bookings may need to retry GetItinerary.
- **Cost**: 14-16 person-weeks wasted. Plus reputation cost if clients noticed issues.
- **Decision time**: Immediate (ingress switch), but 1-2 days to verify old path is fully stable.

### 7.2 Option B: Failure Recovery

**At 25% complete** (bundle scaffolding, a few endpoints):
- **State**: PartnerApiBundle exists as code in frontend3 repo. Not deployed. Old services untouched.
- **Recovery**: Delete bundle branch/code. No production impact. Cost: 5-8 person-weeks wasted (including ramp-up time).
- **Complication**: If bundle was already merged to frontend3's main branch, removing it requires coordination with 12go team.
- **Decision time**: ~3 days.

**At 50% complete** (read-only endpoints live, booking endpoints in development):
- **State**: Search and stations served by PHP bundle. Booking still on .NET.
- **Recovery**: Revert ingress to route search back to .NET. Takes 5-15 minutes. No booking impact.
- **Complication**: Bundle code is in frontend3 — removing it requires a deliberate cleanup PR. The bundle may need to stay dormant in the codebase until explicitly removed.
- **Cost**: 10-14 person-weeks wasted.
- **Decision time**: 1 day.

**At 90% complete** (all endpoints on PHP, .NET services idle):
- **State**: All client traffic on PHP bundle. .NET services deployed but idle.
- **Recovery**: Revert all ingress routes to .NET. Takes 5-15 minutes. Bookings created via PHP are in 12go MySQL — .NET can read them via the same 12go API.
- **Complication**: If the bundle modified frontend3 shared state (Redis keys, MySQL tables) in a way that .NET doesn't expect, there may be data format incompatibilities for in-flight bookings.
- **Cost**: 16-20 person-weeks wasted. PHP team skill investment is partially recoverable for future PHP work.
- **Decision time**: Immediate (ingress switch), but 1-2 days to verify.

### 7.3 Option C: Failure Recovery

**At 25% complete** (foundation built, search endpoint working):
- **State**: Gateway exists locally or in staging. Old services untouched.
- **Recovery**: Stop work. Discard gateway. No production impact. Cost: 5-8 person-weeks wasted.
- **Decision time**: ~2 days.

**At 50% complete** (search live on gateway, booking in development):
- **State**: Search traffic split between old and new. Booking on old.
- **Recovery**: Route all search back to old services. Takes 5-15 minutes. No data at risk.
- **Cost**: 10-14 person-weeks wasted.
- **Decision time**: 1 day.

**At 90% complete** (most traffic on gateway, old services idle):
- **State**: Gateway handling most client traffic. Old services deployed but idle.
- **Recovery**: Route all traffic back to old services. Takes 5-15 minutes.
- **Complication**: If the gateway's self-contained BookingTokens are incompatible with old-service booking tokens, in-flight bookings between GetItinerary and CreateBooking will fail. Clients need to restart the booking flow.
- **Cost**: 18-22 person-weeks wasted. The "thin gateway" code may have limited reuse value if the team pivots to Option B.
- **Decision time**: Immediate (ingress switch), but 1-2 days to verify.

### Recovery Summary

| Recovery Point | Option A | Option B | Option C |
|---|---|---|---|
| 25% complete | Clean, cheap | Clean, but bundle cleanup needed | Clean, cheap |
| 50% complete | Clean, moderate cost | Slightly messy (ingress + bundle code) | Clean, moderate cost |
| 90% complete | Fast rollback, high cost | Fast rollback, code cleanup needed later | Fast rollback, token incompatibility risk |
| **Rollback speed** | 5-15 min | 5-15 min | 5-15 min |
| **Data safety** | Safe (12go is SoT) | Safe (12go MySQL is SoT) | Safe (12go is SoT) |

---

## 8. Recommendation

### Primary Recommendation: Option A (Trimmed .NET), with a mandatory Phase 2 sunset plan

**Why Option A wins on risk:**

1. **Lowest execution risk**: The team writes in the language they know, reuses battle-tested code, and doesn't depend on 12go team cooperation for code-level decisions. The only organizational dependency is infrastructure access, which is needed by all options.

2. **Fastest to production**: Even with realistic overhead, Option A reaches production 4-8 weeks before Options B or C. For a revenue-critical system, shorter migration windows mean less time in the danger zone.

3. **Safest for clients**: Zero API changes, zero URL changes, proven pricing code, proven 12go client code. The probability of a client-visible regression is lowest.

4. **Best rollback posture**: At every phase, rollback is clean because both old and new services talk to 12go via HTTP — there's no state entanglement between old and new paths.

5. **Preserves optionality**: If the Q1-Q5 answers shift the landscape, Option A is the easiest to pivot from. A working .NET service on 12go's infrastructure is a valid starting point for either a PHP rewrite (Option B later) or a thinner gateway (Option C later).

### The Mandatory Sunset Clause

Option A's fatal flaw is the polyglot tax. **Without a contractual sunset date, the .NET service will become permanent technical debt.** My recommendation includes:

- **Month 0-4**: Build and deploy Option A (Trimmed .NET)
- **Month 4-6**: Stabilize, optimize, close out migration
- **Month 6-8**: Plan the PHP migration (informed by actual production experience and Q1-Q20 answers)
- **Month 8-18**: Incrementally port .NET service to PHP (Option B approach), using the running .NET service as the specification
- **Month 18**: .NET service decommissioned

This two-phase approach gives us:
- **Phase 1 (Option A)**: Fast, safe migration to 12go infrastructure
- **Phase 2 (Option B)**: Long-term sustainable architecture in PHP

### Pre-Conditions (Do Not Start Without These)

| Pre-Condition | Status | Blocking? |
|---|---|---|
| Q1 answered (integration method) | Pending (Wed meeting) | **Yes** |
| Q2 answered (language preference) | Pending | **Yes** — if "PHP only", skip to Option B |
| Q3 answered (infrastructure) | Pending | **Yes** — determines deployment model |
| Q5 answered (booking details completeness) | Pending | **Yes** for Option C, Medium for A/B |
| Proof-of-concept .NET pod deployed on 12go staging | Not started | **Yes** for Option A |
| Pact contracts recorded from current production | Not started | **Yes** for all options |

### If 12go Says "PHP Only"

If Q2 eliminates .NET, the recommendation shifts to:
1. **Option B(a) — PHP Thin Proxy** (separate PHP app calling 12go over HTTP) as the safe starting point
2. **Evolve toward Option B(b)** (internal bundle) if 12go agrees to the bundle approach
3. Budget 6-8 weeks of PHP ramp-up before the main project begins

### Final Warning

Do not begin implementation before the Wednesday meeting. A single answer (Q1, Q2, or Q3) can invalidate an entire option. Starting early to "save time" is how teams waste months building the wrong thing.

---

*Review prepared by Agent V3 (Business Risk Assessor). This review is deliberately skeptical of optimistic timelines and architectural purity. Its purpose is to prevent a failed migration, not to choose the most elegant solution.*
