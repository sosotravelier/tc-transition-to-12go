# Pragmatic Minimalist Design

## The Actual Problem (not the stated one)

The stated problem is "the system is over-engineered." That is true but irrelevant on its own -- over-engineered systems that work and are staffed do not need to be replaced. The actual problem is a compound of three forces:

1. **The system cannot be maintained by the available team.** Four .NET repositories totaling ~342 projects and 200-400K LOC are being handed to a single developer. The system was built for a multi-supplier world (11 suppliers plus 12go) but now only serves 12go. The abstraction layers (Supply-Integration framework, Autofac keyed resolution, MediatR pipeline with 10+ behaviors, DynamoDB caches, PostgreSQL audit stores, Kafka event chains) exist to solve problems that no longer exist. They are not just ugly -- they are maintenance traps. Every bug requires understanding layers of indirection that add zero value when there is only one supplier.

2. **Infrastructure is being consolidated.** The team is moving to 12go's cloud. The existing services run on AWS with DynamoDB, PostgreSQL, S3, Kafka, API Gateway -- all of which must be either migrated or eliminated. Migrating all of this infrastructure for a proxy layer is not justified.

3. **New clients need to onboard in Q2 2026.** This is a hard deadline. The system needs to be in a state where new clients can be brought on without requiring the full .NET deployment stack.

The client-facing problem is: nothing is broken for existing clients today. The operational problem is: the system will become unmaintainable and undeployable as infrastructure migrates, and no one can extend or debug it at its current complexity level.

## Should We Rewrite At All? (honest assessment)

**Simplification-in-place fails for concrete reasons, not aesthetic ones.** Here is the honest evaluation:

**Could we strip down the existing .NET services?** In theory, yes. We could:
- Delete all 11 non-12go integrations from Supply-Integration
- Delete the MediatR pipeline in Etna, leaving only the direct 12go search call
- Delete all DynamoDB tables and PostgreSQL stores
- Delete the multi-supplier keyed DI pattern from the notification service

This would reduce the codebase dramatically. But here is what remains after gutting:

- Four separate .NET services still need to be deployed, configured, and monitored
- The Etna-to-SI-Host gRPC communication stays (search goes through two services internally)
- The Denali booking-service and post-booking-service are separate deployments sharing a DynamoDB table -- even after we delete DynamoDB, we need to redesign their interaction
- The Supply-Integration framework's `OneTwoGoApi` class (~500 lines + ~2000 lines of models) is the only piece of actual value, but it is buried inside a framework that requires Autofac, `ISiServiceProvider`, `ISiServiceScope`, `ConnectorFactory`, and `IntegrationHttpMiddleware` just to make an HTTP call
- Infrastructure: we still need AWS DynamoDB (or a replacement for BookingCache), Kafka, PostgreSQL, S3, API Gateway -- or we need to rip those out too, at which point we are rewriting the infrastructure layer anyway

**The extractable value is small enough to port, not large enough to justify keeping the container.** The `OneTwoGoApi` HTTP client logic, the request/response models, the booking schema parser, and the reserve request serializer are the entire business logic. Everything else is framework scaffolding. Porting ~3000 lines of domain logic is cheaper than maintaining ~300K lines of infrastructure to host it.

**Verdict: a rewrite is justified, but only if it is a thin rewrite -- not a second system.**

The danger here is real. The second-system effect says: "the developer, full of knowledge about what was wrong with the first system, builds a new system that is even more over-engineered because they try to fix everything at once." The mitigation is simple: the new system must be a single service with no abstractions beyond what a single-supplier HTTP proxy requires. No plugin architecture, no provider pattern, no event sourcing, no CQRS, no DDD. Just functions that receive HTTP requests and make HTTP calls.

## Option A: Simplify In-Place

### What Gets Removed

- All 11 non-12go integrations (~100K+ LOC)
- MediatR pipeline in Etna (10+ behaviors)
- DynamoDB tables: ItineraryCache, PreBookingCache, BookingCache, IncompleteResults
- PostgreSQL BookingEntities, BookingEntityHistory, ConfirmationInProcess
- Kafka producers and consumers
- HybridCache triple-caching layer
- Etna SI Host as a separate service (fold direct 12go call into Etna Search)
- Multi-supplier abstractions: ISiServiceProvider, ConnectorFactory, IntegrationHttpMiddleware
- Fuji sync Lambdas (out of scope, but remove coupling)
- gRPC inter-service communication
- OpenAPI code generation for inter-service comms

### What Gets Changed

- Etna Search calls 12go directly (no SI Host, no SI framework)
- Denali booking-service calls 12go directly
- Denali post-booking-service calls 12go directly (no local DB reads)
- Notification service reduced to a single POST endpoint

### What Stays Exactly As-Is

- `OneTwoGoApi` HTTP client (the 11 endpoint calls)
- Request/response model classes
- Booking schema parser and dynamic field extraction
- Reserve request serializer
- Error handling/mapping logic
- Client-facing API contracts (all 13 endpoints)

### Resulting Architecture

After gutting, you still have 3-4 separate .NET deployments that each need their own Dockerfile, health checks, configuration, monitoring, and deployment pipeline. The deployment complexity is disproportionate to the business logic. Each service is now a thin wrapper around a few HTTP calls -- but it is a thin wrapper deployed as a full .NET 8 web application with its own ASP.NET pipeline.

**Why this option is worse than Option B:** The gutting work is substantial (touching every project file, every DI registration, every infrastructure reference), the result still requires multi-service deployment, and the remaining .NET codebase is not familiar to anyone on the 12go team who might need to maintain it. The effort-to-deploy ratio is worse than writing a single thin service from scratch.

## Option B: Strangler Fig with a Single New Service

This is the recommended approach. A single new service replaces all four .NET services, one endpoint at a time.

### New Service Role

One service. One deployment. It does exactly what the current four services do after you strip away all the unnecessary layers:

1. Receives client HTTP requests in the TC API contract format
2. Translates them to 12go API calls
3. Translates 12go responses back to the TC API contract format
4. Receives webhook notifications from 12go, transforms them, forwards to clients

That is it. No local database. No message queue. No caching layer (12go already caches in Redis). No supplier abstraction. No plugin architecture.

**Endpoint count: 13.** Each endpoint is a function: parse request, call 12go, map response, return. The most complex is GetItinerary (3 12go calls) and the booking schema parser (~500 lines of mapping). The entire service should be under 5000 lines of application code.

### Coexistence Strategy

**DNS/gateway-level routing with per-endpoint cutover.**

The existing AWS API Gateway routes requests by path and method. During transition:

1. The new service is deployed alongside the existing services
2. API Gateway routes are updated one endpoint at a time to point to the new service
3. The old service continues running for non-migrated endpoints
4. Once all endpoints are migrated, the old services are shut down

This is not per-client migration (which AWS API Gateway does not natively support for path-parameter-based routing). It is per-endpoint migration, which is simpler and safer because:
- Each endpoint is independent (no shared state between endpoints once DynamoDB is eliminated)
- The old service remains running and handling other endpoints
- A bad deployment of one endpoint can be rolled back by reverting the gateway route

**Sequence:**

```
Phase 1: Deploy new service alongside old services
Phase 2: Migrate stateless read endpoints first (Stations, Operators, POIs)
Phase 3: Migrate Search (highest traffic, good validation signal)
Phase 4: Migrate GetItinerary (most complex mapping)
Phase 5: Migrate booking funnel (CreateBooking, ConfirmBooking, SeatLock)
Phase 6: Migrate post-booking (GetBookingDetails, GetTicket, CancelBooking)
Phase 7: Migrate IncompleteResults
Phase 8: Migrate Notifications (different topology -- can be last or offloaded)
Phase 9: Decommission old services
```

### Traffic Migration Sequence

Each phase follows this pattern:

1. Implement endpoint in new service
2. Test against 12go staging/preprod
3. Update API Gateway route to point to new service
4. Monitor for 24-48 hours
5. If problems: revert gateway route (instant rollback)
6. If stable: move to next endpoint

**The old services remain running throughout.** They are not modified. They do not know about the new service. The gateway is the only thing that changes.

### Rollback Plan

| Phase | Rollback Action | Time to Rollback | Data Loss Risk |
|-------|----------------|------------------|----------------|
| Any endpoint migration | Revert API Gateway route to old service | Seconds to minutes | None -- no local state |
| Notification migration | Revert webhook URL in 12go config | Minutes | Notifications during switchover may be missed; 12go retry policy applies |
| Full decommission | Redeploy old services from existing container images | Minutes to hours | None if within DynamoDB TTL window |

**Point of no return:** When DynamoDB tables expire (TTL = 5 days) and PostgreSQL is decommissioned. Until that point, the old services can be reactivated. After that, post-booking operations for old bookings would need the static booking ID mapping table.

## Language and Framework Recommendation

**Start from the job, not the language.**

The job is: receive HTTP, translate JSON, call HTTP, translate JSON, return HTTP. The total domain logic is ~3000 lines ported from C#. The complexity hotspots are:
- Booking schema parser (dynamic field extraction with 20+ wildcard patterns)
- Reserve request serializer (flat key-value bracket notation)
- Search response mapping (trips to itineraries with segment construction)
- Refund flow (two-step with hash/expiry)

**Assessment of language options:**

| Language | Pros | Cons |
|----------|------|------|
| **.NET (C#)** | Soso's expertise; can copy-paste existing models and `OneTwoGoApi` logic directly; zero ramp-up | Not used by 12go team; nobody else can maintain it; requires separate runtime from 12go infra |
| **PHP** | 12go team can maintain it; runs on existing 12go infra; Team Lead's preference for "one system" | Soso has limited PHP experience; F3 local dev is painful (POC proved this); if F3 is refactored away from PHP, this code moves again |
| **Go** | Simple language; fast runtime; AI-assisted development is effective for Go; 12go is considering it | Nobody on the team knows Go today; 12go has not committed to Go |

**Recommendation: PHP inside F3 (the monolith), with a critical caveat.**

The reasoning:
1. **Solo developer with Q2 deadline.** Soso is alone. PHP inside F3 means: one deployment target, one configuration system, one monitoring stack (Datadog), one local dev environment (once set up). A separate .NET service means: a new deployment pipeline, a new monitoring setup, a new configuration system -- all built and maintained by one person.
2. **F3 already has the infrastructure.** `VersionedApiBundle` for API versioning, `ApiAgent` for partner identity, Datadog APM tracing, existing B2B route structure (`/b2b/v1/{clientId}/itineraries`). These are not reimplementable in a few days.
3. **The Search POC already proved it works.** The POC (ST-2432) returned correct B2B contract shapes for all 4 search types. The friction was local dev setup, not PHP capability.
4. **Maintainability after Soso.** If Soso builds a .NET microservice and leaves, the 12go team inherits a .NET service they cannot maintain. If Soso builds inside F3, the 12go team already knows how to deploy, monitor, and modify it.

**The caveat:** F3 refactoring is planned for Q2+ planning. Code written in F3 today may need to move when F3 is restructured. However:
- The transition code is ~5000 lines of translation logic. Moving 5000 lines during a refactor is trivial compared to moving a separate microservice's entire deployment infrastructure.
- Team Lead explicitly said the design is "not throwaway" and will live for a significant time. This argues for putting it where it will be maintained, not where it is technically purest.
- The B2B translation layer is the kind of code that survives refactors: it is leaf-node logic with no internal dependencies. It calls 12go APIs (which are the same APIs that F3 exposes) and formats responses. When F3 is restructured, these functions move as a bundle.

**If PHP inside F3 is vetoed** (by Soso or Team Lead), the fallback is a standalone PHP Symfony service -- same language, same ecosystem, deployable on 12go infrastructure, but outside the monolith. This preserves 12go team maintainability while avoiding the F3 local dev friction.

**If PHP is vetoed entirely**, .NET is the pragmatic second choice. Soso can build it fastest in .NET, and the models can be directly ported. The cost is long-term maintenance by a team that does not use .NET.

## Data Strategy

### DynamoDB Tables

| Table | Verdict | Rationale |
|-------|---------|-----------|
| **ItineraryCache** | Eliminate | Cache of search results. New service calls 12go directly on each request. 12go already caches in Redis. |
| **PreBookingCache** | Eliminate | Cache of booking schema. New service calls 12go `/checkout/{cartId}` on demand. |
| **BookingCache** | Eliminate | In-progress booking state. 12go tracks booking state in MariaDB. The `reserve` call returns a `bid`; the `confirm` call uses that `bid`. No local state needed between these calls. |
| **IncompleteResults** | Eliminate | Async polling store. If 12go `reserve` and `confirm` are synchronous (they appear to be based on the API surface), this is unnecessary. If async flows exist, they can be handled with simple in-memory tracking or a Redis key with TTL. |
| **BookingEntities (PostgreSQL)** | Eliminate | 12go MariaDB is authoritative. `GetBookingDetails` proxies to `GET /booking/{bookingId}` on 12go. |
| **BookingEntityHistory** | Eliminate | Audit trail. 12go has its own booking history. If audit is required, it should be 12go's responsibility as the source of truth. |
| **ConfirmationInProcess** | Eliminate | Async confirmation tracking. Eliminated with synchronous flow. |

### What About Data the Client Expects That 12go Does Not Return?

Two known gaps:
1. **Cancellation policy on GetBookingDetails**: Currently stored locally. 12go's `GET /booking/{bookingId}` does not return it. Solution: if needed, make an additional 12go API call (trip details or similar) to fetch cancellation info. Team Lead confirmed (Mar 17) that cancellation policy exposure is being added to F3 -- this is a pro-monolith argument since the new endpoint would be added in the same codebase.
2. **Booking ID mapping for legacy bookings**: A static one-time mapping table (old TC booking ID to 12go `bid`) is needed for post-booking operations on bookings created before migration. This is a flat lookup table, not a database design -- it could be a JSON file, a Redis hash, or a single DB table. Shauly confirmed (Mar 12) that legacy bookings will naturally expire, so this is a shrinking problem.

### New Storage Required

| What | Technology | Purpose | Lifetime |
|------|-----------|---------|----------|
| API key mapping | Config file or DB table in F3 | Maps TC client_id + api_key to 12go api_key | Until clients switch to 12go keys directly |
| Legacy booking ID mapping | Static lookup (Redis hash or DB table) | Maps old TC booking IDs to 12go `bid` for post-booking ops | Shrinking -- expires as legacy bookings age out |

**No new databases. No new caching layers. No new message queues.**

## Security (required)

### Key Finding #10: Webhook Authentication Gap

**Current state:** 12go webhook notifications to `POST /v1/notifications/OneTwoGo` have zero authentication. The `NotificationAuthenticator` is a no-op (`ValueTask.CompletedTask`). Any HTTP client that discovers the endpoint URL can trigger booking status refresh cycles for arbitrary booking IDs.

**What this design does about it:**

1. **IP allowlisting at the network level.** Since the new service runs on 12go's own infrastructure (or within their VPC), the webhook endpoint should only accept connections from 12go's known internal IP ranges. This is a DevOps configuration, not application code. It is the simplest and most effective control.

2. **Shared secret header verification.** The new webhook endpoint should require a secret token in a custom header (e.g., `X-Webhook-Secret: <shared-secret>`). The same secret is configured in 12go's webhook subscriber table (which already has an `API key` field per subscriber) and validated by the receiving endpoint. Implementation: a single `if` statement comparing the header value against a configured secret. Reject with 401 if missing or wrong.

3. **Request body validation.** The `bid` in the webhook payload should be validated against 12go's API: call `GET /booking/{bid}` to confirm the booking exists and belongs to the expected client before forwarding the notification. This prevents an attacker from triggering actions for non-existent or unrelated bookings. (This call is cheap -- it is the same call the current system makes anyway in the `ReservationUpdaterService`.)

### API Key Handling: Client to Proxy

**Current:** Clients send `x-api-key` header; API Gateway validates; services pass through (always succeed). Real enforcement is at the gateway.

**New design:** Keep API Gateway enforcement for the transition period. Inside the new service, implement actual API key validation as a secondary check:
- Load TC client_id to 12go api_key mapping at startup (from config or DB)
- On each request: validate `x-api-key` against the mapping for the given `{client_id}`
- Use the mapped 12go api_key for outbound calls to 12go API (`?k=<12go_key>`)

This means the service has real authentication even if the gateway is bypassed.

### API Key Handling: Proxy to 12go

**Current:** API key sent as query parameter `?k=<api_key>`. This is 12go's API contract.

**New design:** Same -- this is 12go's requirement. Ensure the key is not logged (exclude query parameters from access logs or redact `k=` values).

### New Attack Surface from Transition

The transition introduces one new risk: during the coexistence period, both old and new services can accept requests for the same endpoints (depending on gateway routing). An attacker who knows both service URLs could bypass the gateway. Mitigation: ensure both old and new services are only reachable through the API Gateway, not directly. This is a standard VPC/security group configuration.

### Webhook Receiver Endpoint Exposure

The current webhook URL is publicly reachable (12go must be able to reach it). The new design should:
- Use a non-guessable URL path (e.g., include a random token in the path: `/webhooks/{random-token}/notifications`)
- Validate the shared secret header (as above)
- Rate-limit the endpoint (e.g., 100 requests/minute -- webhooks should not arrive faster than this)

## Migration Safety Analysis

### Per-Phase Risk Assessment

| Phase | Risk Level | What Could Go Wrong | Mitigation |
|-------|-----------|---------------------|------------|
| Deploy new service | Low | Deployment issues | No traffic routed yet; old services unaffected |
| Static data (Stations, Operators, POIs) | Low | Response format mismatch | Compare responses against old service; these are simple pass-through endpoints |
| Search | Medium | Performance regression, response format differences | Shadow mode: run both old and new in parallel, compare responses, only serve new after validation |
| GetItinerary | Medium-High | Booking schema parser is the most complex mapping; subtle field differences break client booking flows | Extensive testing with real 12go responses; compare field-by-field against old service output |
| Booking funnel | High | Reserve/Confirm failures cause real booking failures | Test on staging with real 12go bookings; migrate one low-traffic client first if gateway supports it; have instant rollback ready |
| Post-booking | Medium | Legacy booking ID mapping misses edge cases | Build mapping table early; test with known legacy booking IDs; keep old service as fallback |
| Notifications | Medium | Missed notifications during switchover | 12go retry policy covers transient failures; verify with test webhooks before cutover |
| Decommission | Low (if above phases pass) | Discovering a hidden dependency | Keep old service images for 30 days after decommission |

### Point of No Return

There is no true point of no return until the old infrastructure (DynamoDB, PostgreSQL, AWS services) is decommissioned. As long as the old services exist with their data, any endpoint can be rolled back by reverting a gateway route.

**Practical point of no return:** When the team decides to stop paying for the AWS infrastructure that hosts the old services. Recommend keeping it alive for 30 days after the last endpoint is migrated.

### Per-Client vs. Per-Endpoint Migration

AWS API Gateway does not natively support routing to different backends based on path parameter values (the `{client_id}` is a path parameter, not a separate path). This means true per-client migration requires either:
- A Lambda authorizer that inspects the `client_id` and routes accordingly (adds complexity)
- A routing layer in front of the gateway (adds a new component)
- Modifying both old and new services to handle routing internally (defeats the purpose)

**Recommendation: per-endpoint migration, not per-client.** It is simpler, requires no gateway modifications beyond route changes, and the blast radius is manageable because each endpoint is independent.

If per-client migration is absolutely required (e.g., to de-risk the booking funnel), the new service itself could implement a feature flag: check client_id against a list, and if not in the "migrated" list, proxy the request to the old service. This is a ~10 line middleware, not a new architectural component.

## Unconventional Idea (optional)

### "Rewrite Nothing, Just Reconfigure 12go"

12go already has a B2B API: `/b2b/v1/{clientId}/itineraries`. The Search POC proved it works. 12go has `ApiAgent` (partner identity), `VersionedApiBundle` (API versioning), and a webhook subscriber table.

What if we do not build a new service at all?

Instead:
1. Create TC clients as 12go `ApiAgent` entries with their existing client IDs
2. Copy TC API keys into 12go's `apikey` table
3. Point TC clients at 12go's B2B API directly
4. Build only the **response format transformer** as a thin middleware (or Nginx/Caddy plugin) that adjusts response shapes from 12go's B2B format to TC's expected format

**Why this was rejected:** The API contract gap is too large. TC clients expect specific response shapes (money as strings, net/gross/taxes pricing structure, `Travelier-Version` header versioning, specific field names like `booking_id` instead of `bid`, encrypted booking IDs, 206 Partial Content for incomplete data). These are not configuration differences -- they are structural response format differences that require code to transform. A "thin middleware" that does this transformation is exactly the service we are proposing in Option B. The middleware IS the service.

However, this thinking validates the design: the new service should be nothing more than a format transformer. If it starts accumulating business logic, caching layers, or storage -- something has gone wrong.

## What This Design Gets Wrong (honest self-critique)

1. **PHP ramp-up cost is underestimated.** Soso has 12 years of .NET experience and limited PHP experience. Even with AI assistance, the first few endpoints in PHP will take 2-3x longer than in C#. The Q2 deadline may be at risk if the PHP learning curve is steeper than expected for the complex mapping logic (booking schema parser, reserve request serializer). The fallback (.NET microservice) should be ready as a pivot option if the first endpoint in PHP takes more than a week.

2. **F3 local dev friction is real.** The Search POC documented real setup problems. If every debugging session requires fighting F3's Docker setup, velocity will suffer. This is the strongest argument against the monolith approach and the primary risk to the recommendation.

3. **The "no caching" stance may be naive.** If 12go's search API has higher latency than TC clients currently experience (because the current system caches aggressively), removing all caching could degrade the client experience. The design should measure search latency through the new service against the old service before committing to zero caching. If caching is needed, a simple Redis TTL cache in front of the search endpoint is acceptable -- but only for search, and only if measured latency warrants it.

4. **Notification service complexity is hand-waved.** The webhook flow has an unsolved puzzle: there is no confirmed mechanism for pushing notifications to client endpoints in the current system (no per-client URL storage, no outbound HTTP delivery code found). The new design says "transform and forward" but the "forward to where" question is genuinely open. This needs to be resolved before the notification endpoint is migrated.

5. **gRPC for Google Metasearch is ignored.** The design scopes out gRPC (as Team Lead agreed), but if it cannot be scoped out, adding gRPC support to a PHP service inside F3 is non-trivial. A separate .NET service for gRPC only might be needed as a tactical exception.

6. **This design assumes 12go's API is stable.** The system context notes that F3 restructuring may change the API surface. If the 12go HTTP API changes during or after migration, every mapping in the new service must be updated. Inside F3, this is less risky (the API and the transformer are in the same codebase). As a separate service, this would be a significant maintenance burden.

7. **Solo developer is a single point of failure.** This design is optimized for one developer with AI assistance. If Soso is unavailable for any period, the migration stalls. No design can fix a resourcing problem, but this one at least minimizes the amount of code and decisions that need human judgment.
