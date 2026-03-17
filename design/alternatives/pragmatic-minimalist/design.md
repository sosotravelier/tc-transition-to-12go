# Pragmatic Minimalist Design

## The Actual Problem (not the stated one)

The stated problem is "the system is over-engineered and we need to simplify." That is true but not actionable. The actual problems are:

1. **Maintenance cost of 342 .NET projects that proxy HTTP calls to 12go.** The four repositories (Etna, Denali, Fuji, Supply-Integration) contain 200-400K lines of C# that exist primarily to abstract away a multi-supplier world that no longer exists. There is now exactly one supplier: 12go. The abstraction layers (ISiServiceProvider, ConnectorFactory, IntegrationHttpMiddleware, MediatR pipeline with 10+ behaviors) serve no purpose and actively hinder understanding.

2. **Organizational direction toward "one system."** Management has explicitly stated there is no permanent separation between 12go core and B2B. The .NET services are not part of 12go. They are a separate system that will require a second migration when F3 is eventually refactored.

3. **Infrastructure divergence.** Our services run on AWS with DynamoDB, PostgreSQL, S3, Kafka, Coralogix/Grafana. 12go runs on EC2 with MariaDB, Redis, Kafka, Datadog. Maintaining both stacks for what amounts to an HTTP translation layer is operationally expensive.

4. **Solo developer constraint.** Soso is the only developer allocated. Maintaining four .NET repos while simultaneously building a replacement is not feasible for one person. The existing system needs to go away, not be maintained in parallel indefinitely.

5. **Q2 2026 deadline.** New clients must be able to onboard on the new system in Q2. This means something must ship, not just be designed.

The client-facing problem is indirect: clients are not currently broken, but the maintenance burden means bugs take longer to fix, new features (like cancellation policies) cannot be added without understanding 342 projects, and the team cannot respond to 12go API changes quickly.

## Should We Rewrite At All? (honest assessment)

**Yes, but the word "rewrite" overstates what is needed.**

Can the existing .NET services be simplified in-place? Let me evaluate this honestly:

**Arguments for simplification in-place:**
- The existing code works. Clients are not broken.
- The 12go HTTP client (`OneTwoGoApi.cs`, ~500 lines + ~2000 lines of models) is the actual business logic and is well-tested.
- The request/response mapping code is complex but stable (booking schema parser, reserve request serializer).
- Simplifying means deleting code, which is lower risk than writing new code.

**Arguments against simplification in-place:**
- "Simplification" of 342 projects means deleting ~330 of them, ripping out DynamoDB, PostgreSQL, Kafka, MediatR, Autofac, the multi-supplier abstraction, gRPC, HybridCache, and the OpenTelemetry SDK -- while keeping the ~12 projects that matter. This is not simplification; it is a rewrite with extra steps. The resulting code would still be .NET deployed on AWS infrastructure that the organization wants to eliminate.
- The "one system" constraint means .NET code on AWS is working against the organizational direction regardless of how clean it is. The infrastructure will need to move to 12go's EC2/Datadog stack.
- F3 already has a B2B API surface (`/b2b/v1/{clientId}/itineraries`). A Search POC has been completed inside F3 that returns correct B2B contract shapes. Building on this is extending existing work, not starting from scratch.
- Solo developer + .NET + PHP means maintaining two language ecosystems. If the developer must also add features to F3 (cancellation policies are confirmed), they are already working in PHP. Adding a .NET service means two local dev environments, two deployment pipelines, two monitoring stacks.

**Verdict:** In-place simplification of the .NET services is theoretically possible but practically worse than building a thin new service. The effort to strip 330 projects from four repos while preserving the 12 that matter, then redeploying on 12go's infrastructure, is comparable to writing a new thin translation layer. And the result would still be a .NET service that doesn't align with the "one system" direction.

However -- and this is critical -- the "new service" should not be a fresh architecture. It should be a boring HTTP translation layer. No DDD, no CQRS, no multi-layer abstraction. One service, flat structure, direct HTTP calls. The complexity budget is approximately 3,000-5,000 lines of application code.

## Option A: Simplify In-Place

### What Gets Removed
- All of Etna (72 projects): MediatR pipeline, gRPC, search engine, SI host, mapper lambdas
- All of Supply-Integration (116 projects): multi-supplier abstraction, connector factory, all non-12go integrations
- Most of Denali (40+ projects): DynamoDB tables, PostgreSQL, Kafka producers/consumers, booking-notification-service Kafka pipeline
- All of Fuji (108 projects): entity mapping DynamoDB, S3 snapshots, Kafka consumers (out of scope per requirements, but would need to remain running)
- All DynamoDB tables (ItineraryCache, PreBookingCache, BookingCache, IncompleteResults)
- PostgreSQL BookingEntities and related tables
- HybridCache, triple-caching layer
- OpenTelemetry SDK integration (would need replacement with Datadog)

### What Gets Changed
- `OneTwoGoApi.cs` and its models would become the core of a stripped-down single-project .NET service
- Controller layer would be rewritten to directly call `OneTwoGoApi` without going through SI abstractions
- Booking schema parser and reserve request assembler would be preserved but extracted from their current project structure
- Authentication would be simplified to a mapping table lookup (clientId -> 12go API key)

### What Stays Exactly As-Is
- The 12go HTTP client code and request/response models (~2,500 lines)
- The booking schema dynamic field extraction logic (~1,200 lines)
- The reserve request serialization with bracket notation
- Error handling patterns (HTTP status code to exception mapping)
- Retry/timeout infrastructure (could be simplified to raw Polly)

### Resulting Architecture
A single .NET 8 service (~5-10K LOC) deployed on 12go's infrastructure, calling 12go's HTTP API. This is viable but creates a .NET island in a PHP ecosystem, requiring .NET runtime on 12go's EC2 instances and a separate deployment pipeline.

**Why I do not recommend this:** The organizational constraint ("one system") and the infrastructure constraint (12go's EC2 stack) make a standalone .NET service an awkward fit. The developer must work in PHP anyway for F3 features. The code to preserve (~3,700 lines of HTTP client + schema parsing) can be ported to PHP or any language in 2-3 weeks with AI assistance.

## Option B: Thin Translation Service

This is my recommendation. Not a strangler fig (there is nothing to strangle gradually -- the .NET services either handle a request or they don't), but a **parallel deployment with per-client traffic cutover**.

### New Service Role

A single PHP Symfony bundle inside F3 (or a standalone PHP service -- see Language section for the trade-off) that does exactly one thing: **translate between the B2B client API contract and 12go's internal API**.

The service handles all 13 client-facing endpoints. For each request:
1. Accept the request in the B2B API format (clientId in path, x-api-key header, Travelier-Version header, etc.)
2. Look up the 12go API key for this client
3. Call 12go's existing internal HTTP API (the same endpoints the .NET services call today)
4. Transform the 12go response into the B2B API response format
5. Return to the client

No local database. No caching layer (12go already caches in Redis). No message queue. No event sourcing. No abstraction layers.

The transformation logic for each endpoint:

| Endpoint | Complexity | Key Transformation |
|----------|-----------|-------------------|
| Search | Medium | Station ID mapping (Fuji CMS <-> 12go int), pricing format, segment construction |
| GetItinerary | High | 3 12go calls (trip + cart + checkout), booking schema parsing (~500 lines), seat map construction |
| CreateBooking | High | Reserve request bracket-notation serialization, booking ID generation/mapping |
| ConfirmBooking | Low | Confirm + fetch details, format transformation |
| SeatLock | Low | Fake lock (validate against schema) until 12go ships native support |
| GetBookingDetails | Low | Proxy to 12go `/booking/{bid}`, format response |
| GetTicket | Low | Proxy to 12go, extract ticket_url |
| CancelBooking | Medium | Two-step: get refund options + execute refund, hash/expiry handling |
| IncompleteResults | Low | May not be needed if all flows are synchronous through 12go |
| Stations | Low | Proxy to 12go station data, map IDs |
| Operators | Low | Proxy to 12go operator data, map IDs |
| POIs | Low | Proxy to 12go POI data |
| Notifications | Medium | Receive 12go webhook, transform format, forward to client URL |

### Coexistence Strategy

During the transition period, both systems run simultaneously. The routing is controlled at the API Gateway level:

**Phase 1 (Gateway routing by client):** AWS API Gateway does not natively support routing by path parameter value. Two options:
- **Option A (recommended):** Add a Lambda authorizer that reads the clientId from the path and returns a routing decision (old backend vs. new backend). This is 20-30 lines of Lambda code.
- **Option B:** Use a lightweight reverse proxy (nginx, Caddy, or the new service itself) as the single API Gateway target, with internal routing logic based on clientId.

**Phase 2 (Client-by-client cutover):** Start with an internal test client or a low-traffic cooperative client. Move one client at a time to the new backend. Both backends share the same 12go API, so there is no data consistency issue -- 12go is the single source of truth.

**Phase 3 (Old system decommission):** Once all clients are routed to the new system, turn off the .NET services.

### Traffic Migration Sequence

1. **Week 1-2:** Deploy new service with Search endpoint only. Run shadow traffic (send real search requests to both old and new, compare responses, serve from old).
2. **Week 3:** Enable Search for one internal/test client on the new system. Validate responses match.
3. **Week 4-5:** Add GetItinerary and CreateBooking endpoints. Shadow traffic comparison.
4. **Week 6:** Enable full booking flow for test client.
5. **Week 7-8:** Add post-booking endpoints (GetBookingDetails, GetTicket, Cancel). Enable for test client.
6. **Week 9-10:** Migrate cooperative external clients one at a time.
7. **Week 11-12:** Migrate remaining clients. Add notification transformer.
8. **Week 13+:** Decommission .NET services.

This timeline assumes a solo developer with heavy AI assistance.

### Rollback Plan

At every step, rollback is: **change the routing back to the old system.** The old .NET services remain running throughout. No data migration is involved because the new system is stateless -- 12go is the source of truth.

Specific rollback mechanisms:
- **Per-client rollback:** Change the routing table entry for that clientId back to the old backend. Takes effect on next request.
- **Full rollback:** Revert the API Gateway configuration to point all traffic at the old backend.
- **Point of no return:** Only occurs when the .NET services' infrastructure (DynamoDB tables, PostgreSQL database) is actually decommissioned. This should not happen until all clients have been on the new system for at least 2-4 weeks with no issues.

## Language and Framework Recommendation

**Recommended: PHP 8.3 / Symfony, as a bundle inside F3.**

This is not because PHP is the best language for this job. It is because the constraints make it the cheapest choice:

1. **Solo developer must work in F3 anyway.** Cancellation policies and other F3 features are confirmed as Q2 work. The developer will have F3 running locally regardless.

2. **"One system" organizational direction.** Code inside F3 stays together when F3 is refactored. Code outside F3 requires a separate migration later.

3. **Infrastructure reuse.** F3 already runs on 12go's EC2 instances with Datadog monitoring, Redis caching, MariaDB, and established deployment pipelines. A new service inside F3 gets all of this for free.

4. **12go veteran support.** Oleksandr estimated ~2 weeks for implementing B2B API in F3. PHP expertise is available for consultation. .NET expertise for a new service on 12go infrastructure would be self-service only.

5. **Search POC already done.** The F3 Search endpoint POC (ST-2432) is complete and returns correct B2B contract shapes. This is not starting from zero.

**What about the .NET developer experience?** Soso has 12 years of .NET experience and would need to write PHP. This is a real cost. However:
- AI-assisted development (Claude Code) is highly effective at PHP, especially for Symfony which is well-documented and convention-driven.
- The code being written is HTTP translation logic, not complex algorithmic work. Most of it is "read JSON field X, write JSON field Y."
- The booking schema parser (~500 lines) and reserve request serializer are the most complex parts. These are well-specified by tests in the existing .NET codebase and can be ported methodically.

**Alternative considered and rejected: Standalone .NET microservice.**
- Adds a second infrastructure to maintain (or requires deploying .NET on 12go's EC2 stack, which nobody has done before).
- Creates a service that must be migrated again when F3 is refactored (Team Lead's explicit concern).
- Does not align with "one system" direction.
- Still requires PHP work for F3 features -- so the developer works in two languages and two codebases.

**Alternative considered and rejected: Standalone PHP microservice (outside F3).**
- Loses the "one system" benefit and F3 feature co-location benefit.
- Requires separate deployment pipeline.
- Only justified if F3 local development is truly unworkable -- the POC showed friction but not impossibility.

**Alternative considered and rejected: Go.**
- 12go is "considering Go" but nothing is decided. Writing Go now means the solo developer learns a third language for a platform that doesn't exist yet.
- No infrastructure support, no deployment pipeline, no team expertise.

## Data Strategy

### Tables to Eliminate (all of them)

| Table | Current Purpose | Replacement | Justification |
|-------|----------------|-------------|---------------|
| ItineraryCache (DynamoDB) | Cache search results between search and booking | None -- call 12go directly | 12go caches in Redis. The extra hop adds no value. |
| PreBookingCache (DynamoDB) | Cache booking schema between GetItinerary and CreateBooking | In-memory (PHP session or Redis) for the name-to-supplier-name mapping only | The mapping between internal field names and supplier bracket-notation keys must survive between GetItinerary and CreateBooking. This is ~1KB of data per booking session. Store it in Redis with a 1-hour TTL keyed by cartId. |
| BookingCache (DynamoDB) | Track booking funnel state | None | 12go tracks booking state in MariaDB. The funnel state machine (Reserved -> Confirmed/Cancelled) is managed by 12go. |
| IncompleteResults (DynamoDB) | Async polling store | None | If 12go's reserve and confirm are synchronous (they appear to be), this is unnecessary. |
| BookingEntities (PostgreSQL) | Persistent booking store | None -- 12go MariaDB is authoritative | Confirmed in Mar 12 meeting: eliminate local DB layer, rely on 12go as source of truth. |
| BookingEntityHistory (PostgreSQL) | Audit trail | None | 12go has its own booking history. |
| ConfirmationInProcess (PostgreSQL) | Async confirmation tracking | None | 12go confirm is synchronous. |
| Fuji Station/Operator/POI (DynamoDB) | Master data mapping | Out of scope | Station ID mapping is explicitly out of scope. Keep Fuji running until mapping is resolved. |

### The one piece of state that cannot be eliminated

**Booking ID mapping table.** For pre-cutover bookings, clients hold Denali booking IDs (KLV-encoded or short format). These must resolve to 12go `bid` values for post-booking operations. This requires a one-time static mapping table populated from the PostgreSQL BookingEntities table before decommission.

Implementation: A simple key-value lookup. Could be:
- A JSON file loaded at startup (if the number of active bookings is small -- likely hundreds, not millions)
- A Redis hash
- A row in a MariaDB table in 12go's database

This table is read-only after initial population and shrinks naturally as old bookings expire.

### The booking schema field name mapping

The checkout response from 12go contains dynamic field names with embedded cart IDs (e.g., `selected_seats_TH013r013800Cb00603SPY6d`). Between GetItinerary (which fetches the schema) and CreateBooking (which must reconstruct these names), the mapping must be stored somewhere.

In the current system, this lives in DynamoDB (PreBookingCache) or HybridCache. In the new system, Redis with a 1-hour TTL keyed by `cartId` is sufficient. This is approximately 1KB of data per active booking session.

## Security (required)

### Webhook Authentication (Key Finding #10)

**Current state:** 12go webhooks to our notification endpoint have zero authentication. `NotificationAuthenticator.Authenticate()` returns `ValueTask.CompletedTask`. Anyone who discovers the endpoint URL can send fake booking status notifications for any `bid`.

**This design's approach:**

1. **IP allowlisting at the network level.** The webhook receiver endpoint should only accept connections from 12go's known egress IP addresses. This is configured in the reverse proxy or API gateway, not in application code. It is the simplest measure with the highest impact.

2. **Shared secret header verification.** Negotiate with 12go to include a shared secret in a custom header (e.g., `X-Webhook-Secret: <secret>`) on all outbound webhook calls. The receiver validates this header before processing. This is straightforward: 12go's webhook table already has an `API key` column per subscriber -- this may already support exactly this. Verify with 12go engineering whether the API key in their webhook subscriber table is sent as a header on outbound calls.

3. **Bid validation.** Before processing a webhook notification, verify that the `bid` in the payload actually belongs to a booking made through our system by checking against 12go's API (`GET /booking/{bid}`) with our API key. If the booking does not exist or does not belong to our agent, discard the notification. This adds one API call per notification but prevents spoofed bids.

4. **Rate limiting on the webhook endpoint.** Cap incoming webhook requests to a reasonable rate (e.g., 100/minute) to prevent abuse even if authentication is bypassed.

Priority order: IP allowlisting first (zero code, highest impact), then shared secret header (low code, requires 12go cooperation), then bid validation (fallback if 12go cannot add a secret header).

### Webhook Receiver Endpoint Exposure

The notification endpoint URL will be registered in 12go's webhook subscriber table. It should not be publicly discoverable:
- Do not include it in any public API documentation.
- Use an unguessable path segment (e.g., `/webhooks/12go-notifications/{random-token}` rather than `/v1/notifications/OneTwoGo`).
- The URL registered with 12go can include the client_id as a query parameter (e.g., `?client_id=bookaway`) to avoid a booking-to-client database lookup.

### API Key Handling

**Inbound (client -> our service):** Continue accepting `x-api-key` header. Validate at the API Gateway level (as today). The service trusts the gateway's authentication decision. For the transition, maintain a mapping table: `(client_id, x-api-key-hash) -> 12go_api_key`. This table has ~20-30 entries.

**Outbound (our service -> 12go):** Attach the looked-up 12go API key as `?k=<key>` query parameter on every outbound request. This is the existing pattern; no change needed.

**Preferred approach (from Shauly, Mar 12):** Clients eventually switch to 12go API keys directly. This eliminates the mapping table. During the transition, support both: accept the old key (map it) and accept 12go keys directly (pass through). This allows clients to migrate at their own pace.

### New Attack Surface

The new service introduces one new attack surface compared to the old system: it is a single service rather than four, so a vulnerability in one endpoint potentially exposes the entire B2B API surface. Mitigation: the service is stateless with no local database, so the worst case for a compromise is unauthorized access to 12go's API through stored API keys. Keys should be stored in a secrets manager (12go uses .env files + DB config), not in application code.

## Migration Strategy

### Client Transition Approach

**Transparent switch.** Clients should not need to change anything initially. The new service preserves all 13 endpoints with identical URL patterns, request/response formats, and behavior. The switch happens at the routing layer (API Gateway or reverse proxy), invisible to clients.

Over time, clients can optionally:
- Switch from TC API keys to 12go API keys (Shauly's preferred approach)
- Update base URLs if the gateway endpoint changes
- Adopt 12go booking IDs for new bookings (automatic -- new bookings will use 12go `bid` format)

Station ID mapping is out of scope for this transition but will eventually require client changes. That is a separate, larger migration.

### Authentication Bridge

**Mapping table approach.** A simple configuration table maps `client_id -> 12go_api_key`. This table has ~20-30 entries and changes infrequently (only when clients are added or keys are rotated).

Implementation: store as a configuration file or database table in 12go. The existing "client identity" SDK (David's middleware) already loads client-API key pairs from a database at startup. 12go's `apikey` + `usr` tables already contain the 12go-side mapping. The bridge is: add TC's `client_id` to 12go's user/agent record, and look up the 12go API key by client_id on each request.

This aligns with the Mar 12 finding: "12go's client creation process will need to include TC's client ID."

Why not a new gateway: adding a new API Gateway is a new infrastructure component to maintain. The existing AWS API Gateway can continue to handle authentication and route to the new backend. No new gateway needed.

### Per-Client Rollout Mechanism

**Routing table with per-client entries.** The simplest mechanism:

1. A configuration table (Redis hash, .env file, or DB table) maps each `client_id` to a backend: `old` or `new`.
2. The routing layer (Lambda authorizer or reverse proxy) reads this table on each request.
3. To migrate a client: change their entry from `old` to `new`.
4. To roll back a client: change their entry back to `old`.

This does not require feature flags, Lambda authorizers, or complex gateway configuration. A reverse proxy with a lookup table is sufficient.

For F3-embedded deployment: the B2B bundle inside F3 can check this table internally. Requests for clients still on the old system return 404 (or are never routed to F3 in the first place if the gateway handles it).

### In-Flight Booking Safety

**Scenario 1: Client starts booking on old system, cutover happens, client sends ConfirmBooking to new system.**

This works because both systems call the same 12go API. The 12go `bid` (booking ID) is the shared reference. If the client holds a Denali-format booking ID:
- KLV-format IDs: the 12go `bid` is embedded and can be extracted by decoding the KLV structure.
- Short IDs: require the booking ID mapping table to resolve.

**Recommendation:** Do not cut over a client mid-booking-funnel. Cutover should happen during low-traffic periods (overnight). Any in-flight bookings will complete on the old system. The TTL on DynamoDB booking cache is 5 days, so bookings older than that have already expired naturally.

**Scenario 2: Client has old bookings and calls GetBookingDetails after cutover.**

The new service must support resolving old booking IDs. Two paths:
- KLV IDs: decode the KLV structure, extract the embedded `bid`, call 12go's API.
- Short IDs: look up in the static mapping table, get the `bid`, call 12go's API.

This is a small amount of code (~50 lines for KLV decoding, which is well-specified in the existing codebase).

### Webhook/Notification Transition

During the transition period, both old and new systems may need to receive webhooks:

1. **Before cutover:** 12go's webhook subscriber table points to the old notification service URL. Notifications flow through the existing Kafka pipeline.
2. **After cutover (per client):** Update the webhook URL in 12go's subscriber table to point to the new notification endpoint, with `?client_id=X` in the URL. The new endpoint receives the webhook, transforms the format (12go format -> TC format), and forwards directly to the client's callback URL.
3. **During mixed state:** If some clients are on old and some on new, 12go needs two webhook subscriber entries (or the new service forwards old-system notifications to the old endpoint). The simplest approach: register the new webhook endpoint as the sole receiver, and have it internally route based on client_id -- forward to old system for clients not yet migrated, handle directly for migrated clients.

The notification transformer is simpler in the new system: no DB lookup, no Kafka pipeline. Just receive JSON, transform field names (`bid` -> `booking_id`, 12go status codes -> TC status codes), and POST to the client's webhook URL.

### Validation Plan

**Search validation (shadow traffic):**
- For each search request to the old system, send a parallel request to the new system.
- Compare response bodies field by field. Log differences. Do not serve the new response to clients.
- Run for 1-2 weeks on all search traffic before enabling any client on the new system.
- Focus on: trip count, pricing values, station IDs, segment structure, recheck behavior.

**Booking validation (contract tests):**
- Port the existing test fixtures from the .NET codebase (checkout JSON fixtures, reserve request expectations).
- Write contract tests that: send a known GetItinerary request, verify the response matches the expected B2B format; send a known CreateBooking request, verify the 12go reserve call has correct bracket-notation body.
- Run against 12go's staging/preprod environment.

**Canary rollout sequence:**
1. Internal test client (TC automation) -- full booking flow, automated regression.
2. Low-traffic external client with cooperative engineering team.
3. Medium-traffic client.
4. Remaining clients in batches of 3-5.

Each step runs for at least 3-5 business days before proceeding.

## Migration Safety Analysis

### Blast Radius Analysis

| Failure Scenario | Blast Radius | Recovery |
|-----------------|-------------|----------|
| New search returns wrong results | One client (if per-client rollout) | Route client back to old system. Immediate. |
| New booking flow fails | One client, one booking attempt | Route client back. Booking was never submitted to 12go (or was submitted and can be checked via 12go API). |
| New service crashes | All migrated clients | Old services are still running. Revert routing. All-migrated-clients impact, but recovery is < 1 minute. |
| Mapping table is wrong (client gets wrong 12go API key) | One client | Fix mapping table entry. No data corruption -- wrong key means 12go rejects the request with 401. |
| Old booking ID lookup fails | One post-booking request | Client retries. Fix mapping table. No data loss. |
| Webhook notification lost | One booking status update | Client can poll GetBookingDetails. 12go retries webhooks (verify retry policy). |

### Point of No Return

The point of no return is **decommissioning the DynamoDB tables and PostgreSQL database.** Until that point, the old system can be reactivated at any time.

Recommended sequence:
1. Move all clients to new system.
2. Wait 4 weeks with old system running but receiving no traffic.
3. Take a final snapshot of PostgreSQL BookingEntities for the booking ID mapping table.
4. Decommission DynamoDB tables (TTL will have expired most entries anyway).
5. Decommission PostgreSQL. This is the point of no return for post-booking lookups of old booking IDs via the old system.
6. Keep the booking ID mapping table (static, read-only) for as long as clients might present old booking IDs.

### Per-Client Migration vs. Big-Bang

**Per-client migration is strongly recommended.** The routing mechanism makes this straightforward. Big-bang cutover risks all 20-30 clients simultaneously, with no way to isolate failures. Per-client cutover means each client is an independent experiment with independent rollback.

## Unconventional Idea (optional)

**Considered: Do not build a new service at all. Instead, configure 12go's existing B2B API to serve TC clients directly.**

12go's F3 already has a B2B API at `/b2b/v1/{clientId}/itineraries` that accepts the same URL pattern as TC's API. The Search POC proved it can return the correct B2B contract shape. If the remaining differences between 12go's B2B API and TC's B2B API are small enough, the cheapest path might be:

1. Extend 12go's existing B2B API to cover all 13 endpoints (not just search).
2. Add the TC-specific transformations (Fuji station ID mapping, booking schema format differences, pricing format differences) as configuration or middleware within F3's existing B2B bundle.
3. Have clients switch their base URL to 12go's B2B API endpoint.

**Why this was not pursued as the primary recommendation:** The TC API contract has specific conventions (money as strings, Travelier-Version header, 206 Partial Content, specific pricing structure with net/gross/taxes_and_fees) that differ from 12go's internal conventions. Extending 12go's B2B API to match TC's contract exactly means modifying 12go's codebase in ways that mix TC-specific logic with 12go's generic B2B functionality. This violates the "one system" vision from the other direction -- instead of TC building on top of 12go, TC would be modifying 12go's internals.

However, this approach deserves a 2-hour spike to quantify the actual differences between 12go's B2B API responses and TC's expected responses. If the differences are smaller than expected (just formatting, not structural), this could save weeks of development.

**Rejected alternative: Keep the .NET services running indefinitely with no replacement.** This fails the Q2 deadline (new clients cannot onboard on a system being decommissioned) and violates the organizational direction.

## What This Design Gets Wrong (honest self-critique)

1. **It underestimates the booking schema parser complexity.** The 500+ lines of dynamic field extraction with 20+ wildcard patterns, the bracket-notation reserve request serializer, and the edge cases (legacy DeOniBus layouts, PHP regex normalization, multi-passenger index reconstruction) are the hardest code in the entire system. Porting this to PHP with full fidelity will take longer than the "2-3 weeks" estimate suggests. The test fixtures help, but there will be edge cases that only surface in production.

2. **It assumes 12go's HTTP API is stable.** The system context notes that F3 restructuring may change the API surface. If 12go changes their internal API during the transition, the new service must be updated simultaneously -- and the developer may be the one making the F3 changes that break their own translation layer.

3. **It treats station ID mapping as "out of scope" but it is the elephant in the room.** Clients send Fuji CMS IDs (8-char alphanumeric). 12go expects integer station IDs. The new service must do this translation for Search and Booking endpoints. The mapping data exists in Fuji's DynamoDB tables. Even though station ID migration is out of scope, the new service needs read access to this mapping. This either means keeping Fuji running (defeating the purpose of decommissioning) or exporting the mapping to a format accessible from 12go's infrastructure.

4. **The F3 local development friction is real.** The Search POC revealed setup difficulties. If the service is embedded in F3, every development session requires the full F3 Docker environment running. This is a daily productivity tax. A standalone service would be faster to develop against -- but slower to deploy and maintain.

5. **Solo developer risk is not addressable by architecture.** No matter how simple the design, one person implementing 13 endpoints with complex transformation logic, managing per-client migration, handling webhook routing, and adding F3 features simultaneously is a high-risk plan. This design minimizes the work but cannot eliminate the resourcing risk.

6. **Monitoring and observability are handwaved.** The current .NET services have extensive custom metrics (40+ counters with client_id/integration_id/contract_code dimensions). The design says "use Datadog" but does not specify which metrics must be preserved. The data team coordination (25+ Kafka events) is similarly unaddressed -- when the .NET services stop, those events stop, and dashboards break.

7. **The "just use 12go" data strategy may not work for all endpoints.** GetBookingDetails currently reads from PostgreSQL and returns data that may not all be available from 12go's `/booking/{bid}` endpoint. For example, cancellation policies are returned on search/get itinerary but NOT on get booking details from 12go. Some data might require additional API calls or may simply not be available without F3 changes.

8. **Per-client rollout requires gateway changes that have not been investigated.** The exact AWS API Gateway configuration, Lambda authorizer setup, and routing mechanism are "not yet investigated -- needs DevOps input." The design assumes this is simple, but gateway configuration issues could be a significant blocker.
