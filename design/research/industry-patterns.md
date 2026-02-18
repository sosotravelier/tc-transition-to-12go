---
status: draft
last_updated: 2026-02-17
agent: R3-industry-patterns-researcher
---

# Industry Patterns Research: .NET-to-12go Transition

## Executive Summary

This document catalogs industry patterns relevant to our transition from 6+ .NET microservices to 12go's PHP/Symfony backend. Our scenario is unusual: we are not strangling a monolith, nor decomposing into microservices. We are **consolidating** proxy/adapter services into a simpler translation layer against an already-existing, mature backend. The patterns below are evaluated through that lens.

---

## 1. Strangler Fig Pattern (and Reverse Strangler / Microservice Consolidation)

### What It Is

The Strangler Fig pattern incrementally replaces a legacy system by routing traffic through a facade layer, gradually shifting requests from the old system to the new one. Originally described by Martin Fowler for migrating monoliths to microservices, the mechanics work in reverse as well — consolidating distributed services into a simpler architecture.

### How It Applies to Our Case

Our situation is a **reverse strangler**: instead of decomposing a monolith, we are collapsing 6+ microservices into a thinner adapter layer. The pattern's core mechanics still apply:

- **Facade/choke point**: We already have client-facing API contracts that act as the interception layer. The client endpoints don't change — only what sits behind them.
- **Gradual routing**: We can migrate endpoints one at a time (e.g., search first, then booking, then ticketing), routing each to either the old .NET pipeline or the new direct-to-12go path.
- **Parallel operation**: Both old and new paths can coexist during transition, with routing controlled per-endpoint or per-client.
- **Read-first migration**: Start with read-heavy endpoints (search, stations, operators) before moving to write paths (booking, cancellation).

The key difference from textbook strangler fig: we're not building new services — we're *removing* intermediate services and connecting more directly to the 12go backend.

### Recommendation

**Use it.** The reverse strangler approach is our primary migration strategy. Migrate endpoint-by-endpoint, starting with stateless read paths. Maintain the client contract facade throughout.

### Sources

- [Microsoft Azure Architecture Center — Strangler Fig Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [The Art of CTO — Fig Tree Pattern for Legacy Modernization (2026)](https://theartofcto.com/frameworks/2026-02-06-fig-tree-strangler-pattern-replace-legacy-without-big-bang/)
- [OneUpTime — Implementing the Strangler Fig Pattern (2026)](https://oneuptime.com/blog/post/2026-01-30-strangler-fig-pattern/view)
- [Confluent — Strangler Fig Compositional Pattern](https://developer.confluent.io/patterns/compositional-patterns/strangler-fig)

---

## 2. Backend-for-Frontend (BFF) Pattern

### What It Is

The BFF pattern creates dedicated backend services tailored to specific client types (web, mobile, partner API). Each BFF handles data aggregation, transformation, and formatting specific to its consumer, sitting between the client and downstream services.

### How It Applies to Our Case

Our adapter layer **is essentially a BFF** — but for partner/B2B API consumers rather than frontend UIs. The parallels are strong:

- Our clients consume a specific API contract (the "frontend" in BFF terms)
- We transform 12go's internal data model into client-expected formats
- Different clients may eventually need different response shapes (versioning)
- The adapter handles cross-cutting concerns (auth, markup, observability) specific to client needs

However, BFF patterns typically assume you control both the frontend and backend. In our case, we control the adapter but not the 12go backend, making this closer to an **API adapter** than a pure BFF.

**Key insight from research**: The "Smart Gateway" anti-pattern — putting too much business logic into the gateway/BFF — is the primary risk. Our adapter should do contract translation and markup, not business logic. Business logic belongs in 12go.

### Recommendation

**Partially applicable.** Think of the adapter as a BFF, but resist the temptation to accumulate business logic. The adapter's scope should be strictly: contract translation, pricing/markup, observability, and auth bridging. If logic starts growing, push it into 12go.

### Sources

- [Developers.dev — API Gateway Patterns: BFF, Aggregation, and Sidecar Decision Framework](https://www.developers.dev/tech-talk/the-api-gateway-dilemma-choosing-the-right-pattern-bff-aggregation-sidecar-for-microservices-at-scale-.html)
- [Tirnav — Mastering API Patterns: BFF vs. Gateway vs. GraphQL (2026)](https://tirnav.com/blog/api-patterns-bff-vs-gateway-vs-graphql)
- [Leapcell — Understanding Core Differences Between API Gateways and BFFs](https://leapcell.io/blog/understanding-the-core-differences-between-api-gateways-and-bffs)
- [Manuel Kruisz — API Gateway vs Backend For Frontend](https://www.manuelkruisz.com/blog/posts/api-gateway-vs-bff)

---

## 3. API Gateway vs Custom Adapter

### What It Is

Off-the-shelf API gateways (Kong, Tyk, AWS API Gateway) provide declarative request/response transformation, rate limiting, auth, and routing. The question is whether these can replace a custom-built translation layer.

### How It Applies to Our Case

API gateways excel at:
- Header manipulation, query parameter rewriting
- Simple field renaming and restructuring
- Auth token translation (e.g., JWT to Bearer)
- Rate limiting, caching, and routing

But our contract translation requires:
- **Deep structural transformation**: Different data models between our client contracts and 12go's API (nested objects, different field semantics, enum mappings)
- **Pricing/markup logic**: Business rules for markup calculation that go beyond simple field mapping
- **Recheck/polling orchestration**: Managing async search completion with polling logic
- **Conditional response assembly**: Different response shapes based on supplier data availability

Kong's Request Transformer plugin and Tyk's body transformation handle simple mappings but struggle with complex structural transformations. YARP (.NET's reverse proxy) offers programmatic transforms via middleware but requires custom code for anything beyond header/path manipulation.

### Recommendation

**Don't use an off-the-shelf API gateway as the primary adapter.** The contract translation is too complex for declarative gateway policies. However, an API gateway (or YARP) can sit *in front of* our custom adapter for cross-cutting infrastructure concerns (rate limiting, TLS termination, basic routing, observability injection).

**Architecture**: API Gateway (infra concerns) → Custom Adapter (contract translation + markup) → 12go Backend

### Sources

- [Kong — Common API Gateway Request and Response Transformation Policies](https://konghq.com/blog/engineering/api-gateway-request-transformation)
- [Kong — Request Transformer Plugin Docs](https://developer.konghq.com/plugins/request-transformer/)
- [Tyk — Request Body Transformation](https://tyk.io/docs/api-management/traffic-transformation/request-body/)
- [Microsoft — YARP Request and Response Transforms](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/transforms)
- [Microsoft — YARP Extensibility Transforms](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/extensibility-transforms)

---

## 4. Travel Tech Architecture at Scale

### What It Is

Patterns used by major travel platforms (Booking.com, Skyscanner, Expedia) for multi-supplier search aggregation, booking pipelines, async result completion, and API partner management.

### How It Applies to Our Case

#### Async Search with Polling (Recheck Pattern)

The **create-and-poll** pattern is the industry standard for travel search aggregation:

1. **Initiate**: Client sends search request; API returns initial fast results + session token
2. **Poll**: Client polls with session token; API returns progressively more complete results as slower suppliers respond
3. **Complete**: Polling stops when all suppliers respond or timeout threshold is reached

This maps directly to our recheck pattern. Skyscanner's Flights Live Prices API uses exactly this: create a search session, poll for results, receive incremental updates. Session tokens are typically valid for ~60 minutes.

**Key insight**: 12go likely implements this internally for its own multi-supplier aggregation. Our adapter may be able to simplify by passing through 12go's polling mechanism rather than re-implementing it. If 12go's internal search is synchronous from our perspective (they handle the aggregation), we can potentially eliminate our entire recheck infrastructure.

#### Two-Phase Booking (Reserve + Confirm)

Both Booking.com and Expedia use two-phase booking:
- **Booking.com OTA**: Retrieve reservation → Acknowledge/Confirm with ~20-second polling intervals
- **Expedia Rapid API**: Hold and Resume pattern — hold inventory before final confirmation

This validates our booking pipeline approach. The adapter should preserve two-phase semantics if 12go supports them.

#### GraphQL Federation for API Orchestration

Booking.com moved from a monolithic orchestration layer to Apollo Federation to connect clients with backend services across accommodations, flights, attractions, and vehicle rentals. This is relevant if we ever need to expose a unified API across multiple 12go verticals.

#### Scale Reference Points

- **Skyscanner**: 110M monthly users, 1,200+ travel partners, 35M searches/day, 80B+ prices checked daily
- **Booking.com**: 1,000+ simultaneous A/B experiments, multi-vertical domains

### Recommendation

**Use the async polling pattern** as our mental model for search. Investigate whether we can simplify by leveraging 12go's internal aggregation. **Preserve two-phase booking semantics** in the adapter. Skip GraphQL federation for now — it solves a multi-domain problem we don't have yet.

### Sources

- [Skyscanner — Create and Poll API Documentation](https://developers.skyscanner.net/docs/getting-started/create-and-poll)
- [Skyscanner — Flights Live Prices Overview](https://developers.skyscanner.net/docs/flights-live-prices/overview)
- [ZentrumHub — Asynchronous Search API](https://docs-hotel.prod.zentrumhub.com/docs/asynchronous-search-api)
- [Booking.com — OTA Reservations Process](https://developers.booking.com/connectivity/docs/reservations-api/reservations-process-ota)
- [Expedia — Hold and Resume](https://developers.expediagroup.com/rapid/lodging/booking/hold-resume)
- [Apollo GraphQL — How Booking.com Orchestrated with Federation](https://www.apollographql.com/blog/how-booking-com-orchestrated-their-service-architecture-with-apollo-federation)
- [Skyscanner Engineering — Journey to Effective Observability](https://medium.com/@SkyscannerEng/skyscanners-journey-to-effective-observability-655167a49d2f)

---

## 5. .NET vs PHP Performance for API Proxies

### What It Is

Performance comparison between .NET and PHP specifically for thin HTTP proxy/request-transformation workloads — not general application benchmarks.

### How It Applies to Our Case

#### Raw Performance Numbers

- **ASP.NET Core**: ~14,700 RPS at 1.2ms latency (Sharkbench)
- **Symfony (PHP-FPM)**: ~941 RPS at 8.7ms latency (Sharkbench)
- **Gap**: .NET is approximately **15x faster** in raw throughput for HTTP handling

#### Modern PHP Improvements

PHP's performance story has improved significantly with alternative runtimes:
- **FrankenPHP**: ~5x throughput over PHP-FPM (still ~3x slower than .NET)
- **OpenSwoole**: Competitive for I/O-bound operations (external HTTP calls)
- **RoadRunner**: Significant improvement, persistent workers avoid cold-start overhead

#### Practical Implications for Our Case

The raw benchmark gap is misleading for our workload because:
1. **Our adapter is I/O-bound, not CPU-bound**: 90%+ of request time is waiting for 12go's API response. A 1ms vs 8ms framework overhead is negligible when the downstream call takes 200-2000ms.
2. **Search latency budget**: If 12go responds in 300ms, adding 1ms (.NET) vs 8ms (PHP) is a 0.3% vs 2.6% overhead — both negligible.
3. **Throughput matters more for search**: High-concurrency search with many parallel requests benefits from .NET's async model, but PHP with FrankenPHP/Swoole handles concurrency well for proxy workloads.
4. **YARP**: .NET has YARP (Yet Another Reverse Proxy) with built-in transform support, purpose-built for this exact workload pattern.

#### The Real Decision Factor

Performance is not the deciding factor between .NET and PHP for this adapter. The decision should be driven by:
- **Operational alignment**: PHP runs natively in 12go's infrastructure (PHP-FPM, Symfony ecosystem)
- **Team capabilities**: Which team maintains this long-term?
- **Deployment simplicity**: One tech stack vs polyglot infrastructure

### Recommendation

**Performance favors .NET but is not a deciding factor.** For an I/O-bound proxy, both are adequate. If staying .NET, consider YARP with custom transforms. If going PHP, use FrankenPHP or OpenSwoole for the performance boost. Choose based on operational fit, not benchmarks.

### Sources

- [Sharkbench — PHP Benchmarks](https://sharkbench.dev/web/php)
- [Okami101 — Web API Benchmarks 2025](https://www.okami101.io/blog/web-api-benchmarks-2025/)
- [LinkedIn — Laravel 12 Performance Face-Off: FrankenPHP, RoadRunner, Swoole (2025)](https://www.linkedin.com/pulse/laravel-12-performance-face-off-2025-frankenphp-roadrunner-roque-4rnrf)
- [Milan Jovanovic — YARP vs Nginx Performance Comparison](https://www.milanjovanovic.tech/blog/yarp-vs-nginx-a-quick-performance-comparison)
- [Microsoft — YARP Documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/transforms)

---

## 6. Event-Driven Booking Patterns

### What It Is

Patterns for reliable booking transactions in distributed systems: Saga pattern for multi-step workflows, Outbox pattern for guaranteed event publishing, and two-phase booking for inventory management.

### How It Applies to Our Case

#### Saga Pattern

The Saga pattern orchestrates multi-step booking transactions with compensating actions:
- **Book seat** → **Process payment** → **Issue ticket** → **Send confirmation**
- If payment fails: compensate by releasing the seat
- If ticketing fails: compensate by refunding payment and releasing seat

**For our case**: The Saga pattern is **less relevant** than it first appears. Our adapter doesn't own the booking transaction — 12go does. We're a passthrough, not an orchestrator. The only scenario where Saga applies is if we need to coordinate between our system and 12go (e.g., record markup in our DB + complete booking in 12go), but this should be minimized.

**Orchestration vs Choreography**: If a Saga is needed, use orchestration (central coordinator) rather than choreography (event-based). Our adapter could be the orchestrator for the thin slice of coordination needed.

#### Outbox Pattern

Guarantees that database writes and event publications are atomic:
1. Write booking record to database
2. Write event to outbox table (same transaction)
3. Background process publishes outbox events to Kafka

**For our case**: Relevant only if we need to publish events to Kafka alongside API responses (e.g., booking notifications to downstream 12go systems). If 12go handles event publishing internally, we can skip the outbox entirely.

#### Two-Phase Booking

Industry-standard reserve-and-confirm:
1. **Reserve**: Lock inventory, return booking token
2. **Confirm**: Finalize booking with payment

**For our case**: Map directly to our existing create-booking → confirm-booking flow. The adapter translates between client contract and 12go's booking API, preserving two-phase semantics.

### Recommendation

**Saga: Don't use** unless adapter must coordinate writes across multiple systems. Push transaction orchestration into 12go. **Outbox: Use only if** Kafka event publishing is required from the adapter layer; otherwise skip. **Two-phase booking: Preserve** the existing reserve/confirm contract translation.

### Sources

- [Temporal — Build a Trip Booking System with PHP Saga](https://learn.temporal.io/tutorials/php/booking_saga/)
- [Stackademic — Orchestrating Microservices with Saga and Outbox](https://blog.stackademic.com/orchestrating-microservices-with-the-saga-pattern-and-outbox-table-0832cb4db60f)
- [InfoQ — Saga Orchestration with Outbox](https://www.infoq.com/articles/saga-orchestration-outbox/)
- [Medium — Inbox & Outbox Patterns and Saga Pattern](https://medium.com/@mahmoudsallam2111/inbox-outbox-patterns-and-saga-pattern-in-microservices-df65b66bf41d)
- [Booking.com — OTA Reservations Process](https://developers.booking.com/connectivity/docs/reservations-api/reservations-process-ota)
- [Expedia — Hold and Resume Booking](https://developers.expediagroup.com/rapid/lodging/booking/hold-resume)

---

## 7. Stateless API Adapter Patterns

### What It Is

Design patterns for building translation layers that mediate between incompatible API contracts, with emphasis on maintaining statelessness where possible.

### How It Applies to Our Case

#### Anti-Corruption Layer (ACL)

The ACL pattern is the canonical pattern for our exact situation. It:
- Isolates our client contracts from 12go's internal API model
- Translates requests/responses between two incompatible domains
- Prevents 12go's data model from "corrupting" our client-facing contracts
- Can be deployed as a separate service or embedded component

**This is our adapter.** The ACL pattern gives us a formal name and well-understood boundaries for what we're building.

#### Where Statelessness Breaks Down

Truly stateless adapters work for:
- Search (request in, results out)
- Station/operator lookups
- Ticket retrieval

Statelessness breaks down for:
- **Recheck/polling**: Need to track search session state (but this can be delegated to 12go session tokens, passed through to clients)
- **Booking tokens**: Two-phase booking needs a token between reserve and confirm (again, pass through 12go's token)
- **Markup/pricing state**: If markup rules need to reference booking context, some state is needed (but can be computed from request parameters)
- **Rate limiting**: Per-client rate tracking requires state (use Redis or API gateway)

**Key insight**: Most "state" in our adapter can be **passed through** as opaque tokens from 12go rather than maintained by us. The adapter becomes a stateless translator with pass-through tokens.

#### Implementation Considerations

- Latency overhead: Each translation adds processing time (1-10ms typically)
- The ACL can become a bottleneck if it accumulates too much logic
- Contract versioning in the ACL allows independent evolution of client and backend APIs
- Deploy the ACL as close to the backend as possible to minimize network hops

### Recommendation

**Use the Anti-Corruption Layer pattern** as the primary design pattern for the adapter. Maximize statelessness by passing through 12go's session/booking tokens rather than maintaining parallel state. Use Redis only for cross-request state that cannot be avoided (rate limits, caching).

### Sources

- [Microsoft Azure Architecture Center — Anti-Corruption Layer Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
- [GitHub/jurf — Anti-Corruption Layer (DAAP Patterns)](https://jurf.github.io/daap/migration-and-compatibility-patterns/anti-corruption-layer/)
- [AWS Well-Architected — Service Contracts per API](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_service_architecture_api_contracts.html)
- [LocalStack — Anti-Corruption Layer Pattern Sample](https://github.com/localstack-samples/sample-anti-corruption-layer-pattern)

---

## 8. Polyglot Microservice Patterns

### What It Is

Patterns for running services written in different languages (.NET and PHP) within the same Kubernetes infrastructure, sharing observability, deployment pipelines, and service discovery.

### How It Applies to Our Case

#### If We Keep .NET (Options 1 or 3)

Running a .NET adapter alongside 12go's PHP services on the same K8s cluster is well-supported:

- **Container-based deployment**: .NET and PHP services are just Docker containers — K8s doesn't care about the language inside
- **Service mesh**: Istio/Linkerd/Kong Mesh can handle inter-service communication, mTLS, and traffic management between .NET and PHP pods
- **Shared observability**: OpenTelemetry (OTEL) provides language-agnostic distributed tracing with W3C Trace Context propagation across HTTP boundaries. Both .NET and PHP have OTEL SDKs.

**Dapr** (Distributed Application Runtime) is worth noting: it provides language-agnostic abstractions for service invocation, state management, and pub/sub. However, it adds infrastructure complexity that may not be justified for a thin adapter.

#### Observability Across Boundaries

The critical requirement is **distributed tracing continuity**:
- .NET adapter creates a trace span for the incoming client request
- Propagates `traceparent` header to 12go's PHP backend
- 12go continues the trace with its own spans
- Result: unified trace from client → adapter → 12go backend

This requires both sides to support W3C Trace Context (OpenTelemetry standard). PHP Symfony has OTEL integration; .NET has first-class OTEL support.

#### Operational Overhead

Polyglot infrastructure has real costs:
- Two sets of Docker base images to maintain and patch
- Two CI/CD pipeline configurations
- Two sets of language-specific monitoring/alerting rules
- Different debugging tools and expertise required

The case study of reducing 25 microservices to 5 (with 82% cost savings) suggests that reducing polyglot complexity has significant operational value.

### Recommendation

**Polyglot is viable but not free.** If keeping .NET, invest in OpenTelemetry for cross-language observability and use K8s service mesh for traffic management. However, the operational overhead of maintaining two tech stacks is a real cost that should factor into the Option 1 vs Option 2 decision. Skip Dapr — it's overkill for a single adapter service.

### Sources

- [Medium — Polyglot Microservices Architecture using Dapr](https://medium.com/@bakhtmunir/polyglot-microservices-architecure-using-dapr-36ef17a7782e)
- [OneUpTime — Distributed Tracing for Polyglot Architectures (2026)](https://oneuptime.com/blog/post/2026-02-06-distributed-tracing-polyglot-architectures/view)
- [Elastic — Instrumenting Polyglot Microservices with APM](https://elastic.co/blog/how-to-instrument-a-polyglot-microservices-application-with-elastic-apm)
- [AWS — EKS App Mesh Polyglot Demo](https://github.com/aws-containers/eks-app-mesh-polyglot-demo)
- [GrapeUp — Hidden Cost of Overengineering Microservices: 82% Cost Reduction](https://grapeup.com/blog/the-hidden-cost-of-overengineering-microservices)

---

## 9. Migration Risk Patterns

### What It Is

Techniques for safely migrating API backends: shadow traffic testing, canary deployments, contract testing, and parallel-run verification.

### How It Applies to Our Case

#### Shadow Traffic / Traffic Mirroring

Duplicate production traffic to the new adapter without affecting clients:
- Configure Istio/Envoy `mirror` directive to copy requests to the new path
- Responses from the mirrored (new) path are discarded — clients always get responses from the old path
- Compare response bodies, latency, and error rates between old and new paths
- Start with a `mirrorPercent` of 10-20%, increase as confidence grows

**For our case**: Shadow traffic is ideal for validating search endpoint migration. Mirror search requests to the new direct-to-12go adapter and compare results. **Caution**: Do NOT mirror booking/write endpoints — this would create duplicate bookings. Shadow traffic works for read-only operations only.

**Tools**: Istio traffic mirroring, Envoy shadow mirroring, GoReplay for request replay.

#### Canary Deployment

Gradually shift real traffic from old to new backend:
- Start: 95% old / 5% new
- Monitor error rates, latency percentiles, business metrics
- Increase: 80/20 → 50/50 → 20/80 → 0/100
- Automated rollback if metrics degrade

Kubernetes Gateway API + Flagger or Argo Rollouts provide automated canary with metric-driven promotion. HTTPRoute weighted `backendRefs` handle traffic splitting natively.

**For our case**: Use canary for the actual cutover after shadow testing validates correctness. Apply per-endpoint: search canary first, then booking endpoints.

#### Contract Testing (Pact)

Consumer-driven contract testing ensures the new adapter preserves API compatibility:
- **Consumer contracts**: Define expected request/response shapes from client perspective
- **Provider verification**: New adapter is verified against all consumer contracts
- **can-i-deploy**: CI check that blocks deployment if contracts are broken
- **Bi-directional testing**: PactFlow can verify consumer contracts against OpenAPI specs

**For our case**: Essential. Our #1 constraint is "don't break client contracts." Pact tests should be the gate for every adapter change. Record existing client contract expectations, then verify the new adapter satisfies them all.

#### Parallel Run (Comparison Testing)

Run both old and new paths simultaneously, compare results:
- Both paths process the same request
- Compare response bodies field-by-field
- Log discrepancies for investigation
- Use the old path's response as the "source of truth"

**For our case**: Combine with shadow traffic. Log both old and new responses, run automated comparison. Flag discrepancies in search results (different prices, missing results, etc.) for investigation before cutover.

### Recommendation

**Use all four patterns in sequence:**
1. **Contract testing (Pact)**: Set up first, before any migration work. Record existing contracts.
2. **Shadow traffic**: Mirror read-only endpoints to new adapter, compare results.
3. **Parallel run**: For booking endpoints, run both paths and compare (but only commit the old path's result).
4. **Canary deployment**: Gradual traffic shift for final cutover, with automated rollback.

### Sources

- [Istio — Traffic Mirroring](https://istio.io/v1.22/docs/tasks/traffic-management/mirroring/)
- [Gravitee — Implementing Traffic Shadowing and Dark Launch](https://www.gravitee.io/blog/implementing-traffic-shadowing-dark-launch-api-gateway)
- [Mark Vincze — Shadow Mirroring with Envoy](https://blog.markvincze.com/shadow-mirroring-with-envoy/)
- [Google Cloud — Canary Deployments using Gateway API and Flagger](https://cloud.google.com/blog/topics/developers-practitioners/canary-deployments-using-kubernetes-gateway-api-flagger-and-google-cloud-deploy)
- [Kubernetes — HTTP Traffic Splitting](https://gateway-api.sigs.k8s.io/guides/traffic-splitting)
- [Argo Rollouts — Progressive Delivery with Gateway API](https://rollouts-plugin-trafficrouter-gatewayapi.readthedocs.io/en/latest/)
- [PactFlow — Compatibility Checks / Breaking Change Detection](https://docs.pactflow.io/docs/bi-directional-contract-testing/compatibility-checks)
- [Pact Docs — Set Up Checklist](https://docs.pact.io/pact_broker/set_up_checklist)

---

## Pattern Combination Recommendations

### For Option 1: Trimmed .NET

**Best pattern combination:**

| Pattern | Role |
|---|---|
| Anti-Corruption Layer | Core adapter architecture |
| Reverse Strangler Fig | Migration strategy (endpoint-by-endpoint) |
| YARP + Custom Middleware | .NET reverse proxy with programmatic transforms |
| OpenTelemetry (polyglot) | Cross-language tracing (.NET ↔ PHP) |
| Shadow Traffic + Canary | Migration safety net |
| Pact Contract Testing | Client contract preservation |

**Strengths**: Leverages existing .NET expertise, fastest raw performance, YARP is purpose-built for this pattern.

**Weaknesses**: Permanent polyglot infrastructure cost, two CI/CD pipelines, two sets of container images, requires .NET expertise in 12go's team long-term.

**Recommended when**: The team maintaining this long-term has .NET expertise, or the adapter is complex enough that .NET's type system and tooling provide significant value.

---

### For Option 2: PHP Native (Symfony Bundles)

**Best pattern combination:**

| Pattern | Role |
|---|---|
| Anti-Corruption Layer | Core adapter architecture (Symfony bundle) |
| Reverse Strangler Fig | Migration strategy |
| BFF-lite | Adapter as client-specific backend |
| Symfony Messenger + Outbox | If async event publishing needed |
| Shadow Traffic + Canary | Migration safety |
| Pact Contract Testing | Contract preservation |

**Strengths**: Single tech stack with 12go (shared infrastructure, tooling, CI/CD, expertise), eliminates polyglot overhead, can leverage 12go's internal Symfony patterns and libraries, natural path to tighter integration over time.

**Weaknesses**: Rewrite cost, potential for PHP performance concerns under extreme load (mitigated by FrankenPHP/Swoole), .NET team needs PHP ramp-up time.

**Recommended when**: Long-term ownership shifts to 12go's team, operational simplicity is prioritized, the adapter is thin enough that rewrite risk is manageable.

---

### For Option 3: Thin Stateless Gateway

**Best pattern combination:**

| Pattern | Role |
|---|---|
| Anti-Corruption Layer | Minimal translation layer |
| API Gateway (infra) | Kong/YARP for cross-cutting concerns |
| Stateless pass-through | Session tokens from 12go passed to clients |
| Contract Testing (Pact) | Automated compatibility verification |
| Canary Deployment | Traffic shifting for cutover |

**Strengths**: Minimal code, lowest maintenance burden, technology-agnostic (could be .NET, PHP, Go, or even a gateway with custom plugins).

**Weaknesses**: Only works if the translation is truly simple — if contracts diverge significantly, a "thin" gateway becomes a "thick" gateway by necessity. Pricing/markup logic may not fit a "thin" model.

**Recommended when**: The contract gap between clients and 12go is small enough that transformation is mechanical, and pricing/markup can be handled elsewhere (e.g., in 12go itself).

---

## Anti-Patterns to Avoid

### 1. The Big Bang Rewrite

**What it is**: Attempting to replace all 6+ microservices simultaneously with a new adapter.

**Why it's dangerous**: No incremental validation, all-or-nothing deployment, impossible to rollback partially. History shows big-bang rewrites have a high failure rate.

**Instead**: Use reverse strangler fig — migrate one endpoint at a time, validate each before moving to the next.

### 2. The Smart Gateway Trap

**What it is**: Starting with "just a thin translation layer" that gradually accumulates business logic, validation rules, caching strategies, retry policies, and eventually becomes a new monolith.

**Why it's dangerous**: The adapter becomes the new single point of failure with high cognitive complexity. Changes require understanding both the adapter's logic and 12go's behavior.

**Instead**: Establish a strict boundary: the adapter does contract translation, markup, and observability. Everything else belongs in 12go. Code review for scope creep.

### 3. Premature Optimization of the Proxy Layer

**What it is**: Building complex caching, connection pooling, request batching, or circuit-breaking in the adapter before measuring actual performance.

**Why it's dangerous**: Adds complexity before proving it's needed. Many of these concerns are already handled by 12go's infrastructure (Redis caching, load balancing).

**Instead**: Build the simplest possible adapter first. Measure latency and throughput under real traffic. Optimize only the proven bottlenecks.

### 4. Ignoring the Recheck Complexity

**What it is**: Assuming the async search/recheck pattern is trivial to re-implement or eliminate.

**Why it's dangerous**: The recheck pattern exists because travel search aggregation is inherently async. If 12go's search API is synchronous from our perspective, we can eliminate it. If not, the polling logic needs careful design to avoid race conditions, timeout mishandling, and stale results.

**Instead**: Investigate 12go's search API behavior first. If it handles aggregation internally and returns complete results synchronously, remove the recheck layer entirely. If not, implement the industry-standard create-and-poll pattern with proper timeout handling.

### 5. Polyglot Creep Without Commitment

**What it is**: Keeping .NET "temporarily" while planning to migrate to PHP "eventually" — but the temporary solution becomes permanent.

**Why it's dangerous**: You pay the polyglot infrastructure tax indefinitely without the benefit of either approach. The .NET adapter accumulates changes that make future migration harder.

**Instead**: Make a deliberate choice and commit. If .NET, invest in making it a first-class citizen in 12go's infrastructure. If PHP, invest in the rewrite upfront. The worst outcome is a permanent "temporary" solution.

### 6. Testing the New System in Isolation

**What it is**: Validating the new adapter only with unit tests and synthetic test data, without shadow traffic or production comparison.

**Why it's dangerous**: Synthetic tests cannot reproduce the full variety of production traffic. Edge cases in real data (Unicode station names, unusual booking combinations, timezone issues) will be missed.

**Instead**: Use shadow traffic mirroring with production data comparison as the primary validation mechanism, supplemented by contract tests and unit tests.

### 7. Migrating Everything at Once vs. Prioritizing by Risk

**What it is**: Treating all endpoints as equal priority.

**Why it's dangerous**: Search (high traffic, latency-sensitive) and booking (financial transactions, must not lose bookings) have very different risk profiles. Using the same migration approach for both wastes effort and increases risk.

**Instead**: Prioritize by risk profile:
- **Low risk first**: Stations, operators, POIs (read-only, cacheable, low traffic)
- **Medium risk**: Search, incomplete results (read-only but latency-sensitive and high traffic)
- **High risk last**: Create booking, confirm booking, cancel booking (write operations, financial impact)

---

## Cross-Cutting Recommendations

### Observability Strategy

Regardless of which option is chosen, invest in:
1. **OpenTelemetry traces** spanning client → adapter → 12go
2. **Request/response logging** (sanitized) for debugging contract translation issues
3. **Business metrics**: Search result count comparison (old vs new), booking success rate, latency percentiles per endpoint
4. **Alerting on divergence**: Automated alerts when new adapter produces different results than old path

### Contract Preservation Strategy

1. **Record all current client contracts** as Pact consumer contracts or OpenAPI specs
2. **Automate contract verification** in CI/CD pipeline
3. **Version the adapter API** to allow controlled evolution
4. **Maintain backward compatibility** for at least one major version behind

### Recommended Migration Sequence

```
Phase 0: Setup
├── Record client API contracts (Pact/OpenAPI)
├── Set up shadow traffic infrastructure
└── Set up comparison logging

Phase 1: Read-Only Endpoints (Low Risk)
├── Stations, Operators, POIs
├── Shadow test → Compare → Canary → Cutover
└── Validate: response accuracy, latency, error rates

Phase 2: Search (Medium Risk)
├── Search + Incomplete Results (recheck)
├── Shadow test with production traffic
├── Extended parallel run (compare results at scale)
└── Gradual canary: 5% → 25% → 50% → 100%

Phase 3: Booking (High Risk)
├── Create Booking, Confirm Booking
├── Parallel run (old path is source of truth)
├── Extended canary with financial reconciliation
└── Get Booking Details, Get Ticket, Cancel

Phase 4: Decommission
├── Remove old .NET services
├── Remove DynamoDB, old caching layers
└── Simplify infrastructure
```

---

## Summary Matrix

| Pattern | Option 1 (Trimmed .NET) | Option 2 (PHP Native) | Option 3 (Thin Gateway) |
|---|---|---|---|
| Reverse Strangler Fig | Essential | Essential | Essential |
| Anti-Corruption Layer | Core architecture | Core architecture | Core architecture |
| BFF | Partially applicable | Partially applicable | Less relevant |
| API Gateway (off-shelf) | Infra layer only | Infra layer only | Possible core (if simple) |
| Saga/Outbox | Avoid unless needed | Avoid unless needed | Avoid |
| Two-Phase Booking | Preserve | Preserve | Preserve |
| Async Polling (Recheck) | Simplify if possible | Simplify if possible | Simplify if possible |
| OpenTelemetry | Essential (polyglot) | Native integration | Depends on tech choice |
| Shadow Traffic | Essential for migration | Essential for migration | Essential for migration |
| Canary Deployment | Essential for cutover | Essential for cutover | Essential for cutover |
| Contract Testing (Pact) | Essential | Essential | Essential |
| YARP | Strong fit | N/A | Possible |

---

*This document should be reviewed alongside the current-state analysis and updated as architectural decisions are made. Patterns marked "Essential" should be implemented regardless of which option is selected.*
