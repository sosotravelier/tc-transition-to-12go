# Disposable Architecture Design

## The Temporary Constraint

F3 (frontend3, the PHP 8.3/Symfony 6.4 monolith) will be decomposed. Planning starts Q2 2026, but no timeline, no target language, and no milestones exist. The Team Lead estimates "a couple of quarters, not one." This means:

1. **The 12go HTTP API surface we call today will change.** The 11 endpoints (search, trip, cart, checkout, reserve, confirm, booking, refund-options, refund) are internal to the F3 monolith. When F3 is broken apart, these endpoints will move, be renamed, or be replaced by new service boundaries.

2. **Code written inside F3 today requires a second migration.** If we embed B2B logic in the monolith, it will be caught in the blast radius of the decomposition. The Team Lead argues "easier to refactor when everything is together." The counter-argument: rewriting .NET to PHP to something-else is two migrations instead of one.

3. **The client-facing contract is permanent.** 13 endpoints, `Travelier-Version` header, money-as-strings, net/gross pricing, correlation headers. Clients are locked in. This contract outlives any backend change.

4. **The transition design is NOT throwaway** (Team Lead, Mar 17). New clients onboard on the new system. Old clients migrate gradually. The design will live for a significant time. But its internals -- specifically the 12go adapter -- are disposable.

**Design principle**: Build so that the expensive parts (client contract, contract tests, ID mappings, authentication bridge) survive F3 decomposition, and the cheap parts (12go HTTP client, response mappers, booking schema parser) can be replaced surgically.

---

## Boundary Analysis

### Boundary 1: Client Contract (permanent)

This boundary is the most valuable artifact. It must be defined with enough precision that the implementation behind it can be swapped without any client noticing.

**Exact contract (13 endpoints):**

| # | Verb | Path | Key Headers | Key Response Conventions |
|---|------|------|-------------|--------------------------|
| 1 | GET | `/v1/{client_id}/itineraries` | `Travelier-Version`, `x-correlation-id`, `x-api-experiment` | 200/206, money as strings, net/gross pricing |
| 2 | GET | `/{client_id}/itineraries/{id}` | same | Booking schema with dynamic fields |
| 3 | POST | `/{client_id}/bookings` | same | Booking ID, pricing, confirmation type |
| 4 | POST | `/{client_id}/bookings/{id}/confirm` | same | Confirmed booking details |
| 5 | POST | `/{client_id}/bookings/lock_seats` | same | Seat lock result |
| 6 | GET | `/{client_id}/bookings/{id}` | same | Full booking details |
| 7 | GET | `/{client_id}/bookings/{id}/ticket` | same | Ticket URL |
| 8 | POST | `/{client_id}/bookings/{id}/cancel` | same | Refund options and result |
| 9 | GET | `/{client_id}/incomplete_results/{id}` | same | Polling result |
| 10 | GET | `/v1/{client_id}/stations` | `x-api-key` | Pre-signed S3 URL |
| 11 | GET | `/v1/{client_id}/operating_carriers` | `x-api-key` | Pre-signed S3 URL |
| 12 | GET | `/v1/{client_id}/pois` | `x-api-key` | Province-based search |
| 13 | POST | (webhook receiver) | none (unauthenticated) | 200 OK |

**Version negotiation:**
- `Travelier-Version` header in YYYY-MM-DD format.
- Missing header: default behavior (current version).
- Deprecated version: response includes `Deprecation: YYYY-MM-DD` header.
- Removed version: `400 Bad Request`.
- Current latest: `2023-07-01`.

Version negotiation must live at the inbound adapter layer, NOT in business logic. It is a request/response transformation concern. When a new version is added, the inbound adapter gains a new transformer; the outbound adapter and domain logic are untouched.

**How it is tested:** Contract tests (see Contract Testing Strategy below). These tests define request/response pairs and validate them against the running service. They are the single most durable artifact of this project.

### Boundary 2: 12go API Contract (temporary)

**Current surface:**
11 endpoints, all HTTP REST, API key as `?k=<key>` query parameter. Cart-based booking flow: Search -> GetTripDetails -> AddToCart -> GetCartDetails -> GetBookingSchema (checkout) -> Reserve -> Confirm. Post-booking: GetBookingDetails, GetRefundOptions, Refund.

**What changes when F3 is decomposed:**
- Endpoint URLs will change (the monolith's routes are monolith-internal).
- The cart-based flow may be restructured (cart is a monolith concept; a decomposed system might expose booking as a single operation or use a different orchestration pattern).
- Authentication may change (currently a single API key; a decomposed system might use service-to-service auth, OAuth, or per-service keys).
- Response shapes may change (fields that are denormalized today may come from different services).
- New capabilities (cancellation policies, seat lock) may arrive as new endpoints on new services.

**What is unlikely to change:**
- The concept of searching, booking, confirming, and canceling.
- The concept of booking IDs and ticket retrieval.
- The need for station/operator/class mappings.

**How the outbound adapter hides 12go details:**
The adapter exposes a domain-level interface (see Anti-Corruption Layer below). The rest of the service calls `IBookingGateway.Search(...)` and receives domain objects. It never sees 12go URLs, cart IDs, checkout schemas, or the `?k=` authentication pattern. When F3 is decomposed, only the adapter implementation behind `IBookingGateway` changes.

---

## Anti-Corruption Layer Design

### Translation Model

Two translation boundaries, each with distinct responsibilities:

**Inbound translation (client world -> domain):**
- Fuji station IDs -> domain station IDs (lookup table)
- `Travelier-Version` header -> version context (determines response shape)
- Client booking token -> domain booking reference
- Money-as-strings -> domain money type
- `x-correlation-id` / `x-api-experiment` -> context propagation

**Outbound translation (domain -> 12go world):**
- Domain station IDs -> 12go station IDs (lookup table)
- Domain booking request -> 12go cart flow (AddToCart + GetBookingSchema + Reserve)
- 12go search response -> domain search result (trips, segments, pricing normalization)
- 12go booking schema -> domain booking form (20+ dynamic field patterns)
- Domain money type -> 12go Price objects

### Implementation

The ACL is organized as three layers in the codebase:

```
src/
  Contracts/               # Client-facing request/response types (PERMANENT)
    SearchResponse.cs
    BookingResponse.cs
    ...
  Domain/                  # Domain types, interfaces (PERMANENT)
    IBookingGateway.cs     # Port: outbound
    ITripSearcher.cs       # Port: outbound
    INotificationSender.cs # Port: outbound
    Models/
      Trip.cs
      Booking.cs
      Money.cs
      StationId.cs
  Adapters/
    Inbound/               # HTTP controllers (SEMI-PERMANENT, boilerplate)
      SearchController.cs
      BookingController.cs
      ...
      Middleware/
        VersionNegotiationMiddleware.cs
        CorrelationMiddleware.cs
    Outbound/
      TwelveGo/            # 12go adapter (DISPOSABLE)
        TwelveGoBookingGateway.cs   # Implements IBookingGateway
        TwelveGoTripSearcher.cs     # Implements ITripSearcher
        TwelveGoClient.cs           # Raw HTTP calls to 12go
        Models/                     # 12go-specific request/response types
          OneTwoGoSearchResponse.cs
          OneTwoGoBookingSchemaResponse.cs
          ...
        Mappers/
          SearchResponseMapper.cs
          BookingSchemaMapper.cs
          ReserveRequestMapper.cs
          PricingMapper.cs
  Mapping/                 # ID mapping data (PERMANENT)
    StationIdMap.cs
    ClassIdMap.cs
    VehicleIdMap.cs
  Config/                  # Feature flags, client config (PERMANENT)
    FeatureFlagStore.cs
    ClientConfigStore.cs
```

**Key interface -- the outbound port:**

```csharp
public interface IBookingGateway
{
    Task<SearchResult> Search(StationId from, StationId to, DateOnly date, int seats);
    Task<ItineraryDetail> GetItinerary(string itineraryId, int seats);
    Task<BookingResult> CreateBooking(BookingRequest request);
    Task<BookingResult> ConfirmBooking(string bookingId);
    Task<BookingDetail> GetBookingDetails(string bookingId);
    Task<TicketInfo> GetTicket(string bookingId);
    Task<CancelResult> CancelBooking(string bookingId, RefundOption option);
    Task<RefundOptions> GetRefundOptions(string bookingId);
}
```

This interface uses domain types only. No 12go concepts leak through. When 12go's API changes, a new implementation of `IBookingGateway` is written. The controllers, contract tests, mapping tables, and domain types are untouched.

**The complex bits inside the disposable adapter:**
1. **BookingSchemaMapper** (~500 lines): Parses 12go's dynamic checkout form (20+ wildcard field patterns). This is the most complex single component. It is 12go-specific and will need rewriting when F3 changes.
2. **ReserveRequestMapper**: Serializes domain booking request into 12go's flat bracket-notation key-value format. 12go-specific.
3. **SearchResponseMapper**: Normalizes 12go's trips/segments/travel_options into domain search results. 12go-specific.
4. **Cart flow orchestration**: The 3-call GetItinerary flow (GetTripDetails + AddToCart + GetBookingSchema) is a 12go implementation detail. In domain terms it is just "get itinerary details."

### Testing Strategy

**ACL testing is done at three levels:**

1. **Mapper unit tests** (fast, isolated): Each mapper has pure function tests.
   - Input: recorded 12go API responses (JSON fixtures).
   - Output: domain objects.
   - These tests break when 12go's response shape changes -- they are the canary.

2. **Adapter integration tests** (medium, uses HTTP recording): The `TwelveGoBookingGateway` is tested against recorded HTTP interactions.
   - Uses WireMock or similar to replay recorded 12go responses.
   - Verifies the full adapter pipeline: HTTP call -> deserialization -> mapping -> domain object.
   - When 12go's API changes, the recordings are updated and the tests show which mappers need adjustment.

3. **Contract tests at the boundary** (see Contract Testing Strategy below).

**When 12go's API changes, what breaks:**
- Mapper unit tests fail (wrong field names, missing fields, changed shapes).
- Adapter integration tests fail (HTTP recordings no longer match reality).
- Nothing else breaks. Controllers, domain logic, client contract tests -- all green.
- A developer knows to look in `Adapters/Outbound/TwelveGo/` and only there.

---

## Feature Flag Architecture

The migration happens client by client. Some clients talk to the old system, some to the new. F3's API may change during the migration window.

### Flag Structure

```
flags:
  client_routing:
    <client_id>:
      backend: "legacy" | "new"         # Which backend handles this client
      enabled_endpoints:                 # Granular per-endpoint rollout
        search: true
        get_itinerary: true
        create_booking: false            # Still on legacy for booking
        ...
```

This allows:
- Per-client routing (client A on new, client B on legacy).
- Per-endpoint rollout within a client (search on new, booking on legacy).
- Emergency rollback: flip `backend` to `"legacy"` for any client.

### Storage

Flags are stored in a **database table** (MariaDB, since that is what 12go uses and is already available):

```sql
CREATE TABLE feature_flags (
    client_id VARCHAR(64) NOT NULL,
    flag_key VARCHAR(128) NOT NULL,
    flag_value VARCHAR(512) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(128),
    PRIMARY KEY (client_id, flag_key)
);
```

**Why database, not in-process or file-based:**
- Survives deployments.
- Can be changed without a deployment (direct DB update or simple admin endpoint).
- No external dependency (no Flagsmith, no LaunchDarkly -- the constraint was explicitly "no external dependencies").
- MariaDB is already in the stack.

**Read pattern:** Flags are loaded into memory at startup and refreshed on a configurable interval (e.g., every 30 seconds). This avoids per-request DB queries while keeping flags reasonably fresh. A cache-aside pattern with TTL.

**Who can change flags without a deployment:** Anyone with DB access or access to a minimal admin API endpoint (`POST /admin/flags`). No code change or deployment required. For safety, the admin endpoint is behind internal network access only.

### Routing Implementation

At the API Gateway level (or at the proxy service's entry point if the gateway cannot do per-client routing -- which is the case with AWS API Gateway as documented):

```
1. Request arrives at proxy service.
2. Extract client_id from URL path.
3. Look up feature flags for client_id.
4. If backend = "legacy": forward to old system (Etna/Denali).
5. If backend = "new": handle locally.
6. If per-endpoint flag is false for this specific endpoint: forward to legacy.
```

This means the proxy service acts as a **router** during migration. After migration completes, the routing logic is removed -- the proxy handles all requests directly.

---

## Contract Testing Strategy

### Inbound Contract Tests

**What they test:** The client-facing HTTP contract -- request/response shapes, status codes, headers, versioning behavior.

**Tool:** Language-agnostic HTTP contract tests using recorded request/response pairs. Concretely:

- **Format:** Each endpoint has a directory of test cases. Each test case is a YAML/JSON file specifying: HTTP method, path, headers, request body (if any), expected status code, expected response headers, expected response body (or JSON schema).
- **Runner:** A simple test harness that sends HTTP requests to the running service and validates responses. Can be written in any language (bash + curl, Python requests, .NET xUnit with HttpClient, or a purpose-built tool like Dredd or Hurl).
- **Recommended tool: [Hurl](https://hurl.dev/)** -- a plain-text HTTP test runner. Tests are `.hurl` files: human-readable, language-agnostic, version-controllable. Example:

```hurl
# Search endpoint contract test
GET http://{{host}}/v1/test_client/itineraries
Travelier-Version: 2023-07-01
x-api-key: {{api_key}}
x-correlation-id: test-correlation-123

HTTP 200
[Asserts]
header "x-correlation-id" == "test-correlation-123"
jsonpath "$.itineraries" isCollection
jsonpath "$.itineraries[0].segments" isCollection
jsonpath "$.itineraries[0].pricing.net_price.amount" isString
jsonpath "$.itineraries[0].pricing.net_price.currency" isString
```

**Why Hurl over Pact:**
- Pact is designed for consumer-driven contracts between two services that both run Pact. Our "consumer" is external clients who will never run Pact.
- Hurl tests are plain text files. They survive a language change, a framework change, a complete rewrite. They test the HTTP boundary, not the code.
- Maintenance cost is near zero -- the files are declarative and need updates only when the contract changes (which it should not).

**How they are run:**
- Against local development server (developer workflow).
- Against staging after deployment (CI/CD gate).
- Against production after migration (smoke test).

**Version-specific tests:**
- Separate test files per `Travelier-Version` value.
- `tests/contract/v2023-07-01/search.hurl`, etc.
- When a new version is added, a new directory is created with the version-specific response expectations.

### Outbound Contract Tests

**What they test:** That the 12go adapter correctly calls 12go's API and correctly transforms responses.

**Strategy: Recorded fixtures + WireMock stubs.**

1. **Record phase:** During initial development, record actual 12go API responses for each endpoint (search, trip details, cart, checkout, reserve, confirm, booking details, refund options, refund). Store these as JSON fixtures in `tests/fixtures/12go/`.

2. **Replay phase:** In CI, WireMock serves these fixtures. The adapter integration tests call the adapter, which calls WireMock instead of real 12go. Tests verify that:
   - The adapter sends the correct HTTP requests (method, path, query params, body).
   - The adapter correctly transforms 12go responses into domain objects.
   - Error handling works (400, 401, 404, 500 responses from 12go are handled correctly).

3. **Drift detection:** Periodically (weekly or on-demand), run the adapter against real 12go staging. Compare actual responses to recorded fixtures. If shapes differ, the fixtures are stale and tests may be giving false confidence. This is a manual/scheduled step, not a CI gate.

**When 12go's API changes:**
- Drift detection catches it first.
- Adapter integration tests are updated: new fixtures, updated WireMock stubs.
- Mapper unit tests are updated.
- The developer knows exactly which files to touch: everything in `Adapters/Outbound/TwelveGo/` and `tests/fixtures/12go/`.
- Nothing outside the adapter boundary changes.

**Why not consumer-driven contracts (Pact) for the outbound side:**
- We do not control 12go's API. They will not run a Pact provider verification.
- Pact's value is in the bilateral contract. Without provider participation, it is just fixture-based testing with extra tooling overhead.
- Fixture-based testing with WireMock is simpler, well-understood, and sufficient for a temporary adapter.

---

## Survivability Analysis

| Artifact | Survives F3 decomposition? | Cost to replace | Notes |
|---|---|---|---|
| **Client contract tests (Hurl files)** | Yes | -- | Language-agnostic, test HTTP boundary. Most durable artifact. |
| **Domain interfaces (`IBookingGateway`, etc.)** | Yes | -- | Define what the system does, not how. Stable unless client contract changes. |
| **Domain model types (`Trip`, `Booking`, `Money`)** | Yes | -- | Represent the client-world concepts that do not change. |
| **Inbound HTTP controllers** | Yes | Low | Standard boilerplate mapping HTTP to domain calls. Framework-dependent but trivial. |
| **Version negotiation middleware** | Yes | Low | Client-facing concern, independent of backend. |
| **Station/class/vehicle ID mapping tables** | Yes | Low | Data, not code. Survives any backend change. |
| **Authentication bridge (client API key -> 12go key)** | Yes | Low | Config table. May need updating if 12go auth changes, but the concept persists. |
| **Feature flag infrastructure** | Yes | Low | DB table + cache. Backend-agnostic. |
| **Correlation/experiment header propagation** | Yes | Low | Inbound adapter concern. |
| **12go HTTP client (`TwelveGoClient`)** | No | Medium | New API surface requires new HTTP calls. |
| **Search response mapper** | No | Medium | 12go search response shape will change. |
| **Booking schema mapper** | No | High | Most complex component (~500 lines of 12go-specific pattern matching). |
| **Reserve request serializer** | No | Medium | 12go's bracket-notation format is 12go-specific. |
| **Cart flow orchestration** | No | Medium | The 3-call GetItinerary flow is a 12go monolith artifact. |
| **12go error handling/classification** | No | Low | Status code mapping is 12go-specific. |

**Summary:** Roughly 60% of the codebase (by value, not by lines) survives. The parts that do not survive are concentrated in a single directory (`Adapters/Outbound/TwelveGo/`) and can be replaced without touching anything else. The most expensive single replacement is the booking schema mapper.

---

## Language and Framework

### Evaluation Criteria

For a disposable-by-design service, the language choice is evaluated on:

1. **Interface/type expressiveness**: Can we define clean ports (interfaces/traits) that the adapter implements? Strong typing catches adapter boundary violations at compile time.
2. **Test isolation**: Can we test the adapter in isolation without starting the whole service? Can we mock/stub the outbound HTTP calls?
3. **Adapter boundary enforcement**: Does the language make it easy to keep 12go types from leaking into domain code? (Modules, namespaces, visibility modifiers.)
4. **Solo developer productivity with AI assistance**: Can one developer with Claude Code/Copilot produce this quickly?

### Language Comparison

| Criterion | C# / .NET 8 | PHP 8.3 / Symfony | Go |
|-----------|-------------|-------------------|-----|
| Interface expressiveness | Excellent. `interface`, generics, `record` types. | Good. Interfaces, typed properties, enums (8.1+). | Excellent. Implicit interfaces, strong typing. |
| Test isolation | Excellent. xUnit + Moq/NSubstitute + WebApplicationFactory. | Good. PHPUnit + Mockery + Symfony test kernel. | Good. Standard library testing + testify. |
| Adapter boundary enforcement | Good. Namespaces, `internal` visibility, project references. | Moderate. Namespaces exist but no visibility between namespaces (no `internal`). | Good. Package-level visibility, `internal` by default. |
| Solo dev productivity with AI | Excellent. AI tools trained extensively on C#/.NET. Soso has 12 years experience. | Moderate. AI support good. Soso would need ramp-up. 12go veterans available. | Moderate. AI support good. Neither Soso nor 12go team has Go production experience. |
| Team alignment | Current team expertise. | 12go stack alignment. Long-term operational simplicity. | 12go is "considering" Go. No production experience on either side. |
| Operational fit on 12go infra | Requires separate deployment, runtime. DevOps would need to support .NET. | Deploys alongside F3. Same runtime, same infra, same monitoring. | Requires separate deployment, runtime. |

### Recommendation

This design is language-agnostic by construction -- the adapter boundary pattern works in any typed language. However:

**For a solo developer on Q2 deadline:**
- **.NET** maximizes initial velocity (Soso's 12 years of experience, excellent AI tooling, existing code to port from).
- **PHP** maximizes operational alignment (same infra, same monitoring, same team long-term) but costs ramp-up time.

**For disposability:**
- The adapter boundary pattern means the language of the adapter does not affect replacement cost. Whether the 12go adapter is in C# or PHP, it gets replaced when F3 changes.
- However, if the whole service is in PHP and lives inside or alongside F3, it may get caught in F3's decomposition blast radius.
- If the service is a separate deployable (regardless of language), its adapter can be replaced without touching anything else.

**The language question is secondary to the deployment boundary question.** A separate deployable (microservice) in any language provides the isolation that makes disposability real. A module inside F3 in PHP may be "easier to refactor together" (Team Lead's argument) but it is also harder to isolate from F3's decomposition.

---

## Architecture Diagram

```
                                    PERMANENT
                          +--------------------------+
                          |   Client Contract Tests  |
                          |       (Hurl files)       |
                          +-----------+--------------+
                                      |
                                      | validates
                                      v
+----------+        +--------------------------------------------------+
|          |  HTTP  |              Proxy Service                        |
| Clients  +------->+                                                  |
|          |        |  +--------------------------------------------+  |
+----------+        |  |        Inbound Adapter (semi-permanent)    |  |
                    |  |                                            |  |
                    |  |  Controllers (13 endpoints)                |  |
                    |  |  Version Negotiation Middleware            |  |
                    |  |  Correlation Header Middleware             |  |
                    |  |  Feature Flag Router                      |  |
                    |  +--------------------+-----------------------+  |
                    |                       |                          |
                    |                       | Domain interfaces        |
                    |                       | (IBookingGateway, etc.)  |
                    |                       |                          |
                    |  +--------------------v-----------------------+  |
                    |  |           Domain Layer (permanent)         |  |
                    |  |                                            |  |
                    |  |  Domain models (Trip, Booking, Money)      |  |
                    |  |  ID Mapping tables (station, class, vehicle)|  |
                    |  |  Auth bridge (client key -> 12go key)      |  |
                    |  +--------------------+-----------------------+  |
                    |                       |                          |
                    |                       | IBookingGateway impl     |
                    |                       |                          |
                    |  +--------------------v-----------------------+  |
                    |  |    Outbound Adapter: 12go (DISPOSABLE)     |  |
                    |  |                                            |  |
                    |  |  TwelveGoClient (HTTP calls)               |  |
                    |  |  SearchResponseMapper                     |  |
                    |  |  BookingSchemaMapper (~500 lines)          |  |
                    |  |  ReserveRequestMapper                     |  |
                    |  |  Cart flow orchestration                   |  |
                    |  |  Error classification                     |  |
                    |  +--------------------+-----------------------+  |
                    |                       |                          |
                    +--------------------------------------------------+
                                            |
                                            | HTTP (12go API, ?k=<key>)
                                            v
                              +----------------------------+
                              |  12go F3 (PHP monolith)    |
                              |  11 endpoints              |
                              |  WILL BE DECOMPOSED        |
                              +----------------------------+

   +-------------------------------------------------------+
   |                WHEN F3 IS DECOMPOSED:                  |
   |                                                        |
   |  1. Replace Outbound Adapter (one directory).          |
   |  2. Update outbound fixtures/WireMock stubs.           |
   |  3. Run client contract tests. If green, done.         |
   |  4. Everything else is untouched.                      |
   +-------------------------------------------------------+
```

### Notification Flow (separate concern)

```
+----------------------------+       +---------------------+       +-----------+
| 12go                       |  HTTP | Notification        |  HTTP | Client    |
| (booking status change)    +------>+ Transformer         +------>+ Webhook   |
|                            |       | (Inbound adapter)   |       | Endpoint  |
+----------------------------+       +---------------------+       +-----------+
                                     |
                                     | Transforms 12go notification format
                                     | to client-expected format.
                                     | Looks up client webhook URL.
                                     | Maps 12go bid -> client booking ID.
                                     |
                                     | DISPOSABLE: 12go notification shape
                                     | will change when F3 decomposes.
```

---

## Security

### Key Finding #10: Webhook Notifications Have Zero Authentication

This is a known vulnerability, not an open question. The current `OneTwoGo.PostBookingNotifications.NotificationAuthenticator` is a no-op (`ValueTask.CompletedTask`). Any HTTP POST to the webhook endpoint is accepted without validation.

**From a replaceability perspective:**

Webhook signature verification is a **boundary concern**. It belongs at the inbound adapter for notifications, not in business logic. The adapter boundary design makes it straightforward to swap verification strategies.

**Current state (no authentication):**

```
12go POST -> Notification Endpoint -> Accept all -> Process
```

**Immediate mitigation (deploy with the proxy service):**

1. **IP allowlisting:** Restrict the webhook endpoint to 12go's known IP ranges at the network/gateway level. This is the cheapest effective mitigation. DevOps can configure this without code changes.

2. **Shared secret validation:** Add a secret token as a query parameter or header in the webhook URL registered with 12go. The notification adapter checks for this token. If 12go supports configuring a webhook URL with query parameters (confirmed: client ID can be embedded as query param), then a shared secret can be embedded similarly: `https://our-service/webhooks/12go?client_id=X&secret=Y`. The adapter validates `secret` before processing.

3. **Request body validation:** The webhook payload is `{ "bid": <long> }`. Before processing, validate that the `bid` corresponds to a known booking (call 12go's GetBookingDetails to verify the booking exists and belongs to a known client). This prevents fabricated notifications but adds latency.

**Design for future (when 12go adds signed webhooks):**

The notification inbound adapter has a single interface:

```csharp
public interface IWebhookAuthenticator
{
    Task<bool> Authenticate(HttpRequest request);
}
```

Current implementation: `SharedSecretWebhookAuthenticator` (checks query param secret).
Future implementation: `HmacSignatureWebhookAuthenticator` (checks `x-12go-signature` header against HMAC-SHA256 of body).

Swapping implementations is a one-line DI registration change. No business logic touched.

**After F3 decomposition:**

The notification source may change (different service, different format, different auth mechanism). The entire notification inbound adapter is replaceable. The security contract at the boundary is: "the adapter authenticates the caller before passing the notification to domain logic." How it authenticates is an adapter implementation detail.

**Recommendation:** Implement IP allowlisting (DevOps, zero code) + shared secret validation (trivial code) before go-live. Do not defer security to "when 12go adds signing."

---

## What Gets Built First

Prioritized by: (1) validates the architecture, (2) enables client migration, (3) maximizes learning early.

### Phase 1: Skeleton + Search (Week 1-2)

1. **Project skeleton** with the three-layer structure (Inbound/Domain/Outbound).
2. **Search endpoint** (endpoint #1) -- end to end.
   - Inbound: HTTP controller, version negotiation, correlation headers.
   - Domain: `ITripSearcher` interface, `SearchResult` domain model.
   - Outbound: `TwelveGoTripSearcher` adapter, `SearchResponseMapper`.
   - Contract test: First Hurl file for search.
3. **Authentication bridge** -- client API key to 12go API key mapping.
4. **Feature flag table** + reader (even if only one flag: `backend=new`).

**Why search first:** It is the highest-traffic endpoint, the simplest flow (1 12go call), and it validates the entire adapter boundary pattern. If the pattern does not work for search, it will not work for anything.

### Phase 2: Booking Funnel (Week 3-5)

5. **GetItinerary** (endpoint #2) -- the 3-call flow (trip + cart + checkout).
   - This is where the booking schema mapper (~500 lines) lives. Most complex single component.
6. **CreateBooking** (endpoint #3) -- reserve request serializer.
7. **ConfirmBooking** (endpoint #4).
8. Contract tests for each.

### Phase 3: Post-Booking (Week 5-6)

9. **GetBookingDetails** (endpoint #6).
10. **GetTicket** (endpoint #7).
11. **CancelBooking** (endpoint #8) -- two-step refund flow.
12. **IncompleteResults** (endpoint #9).
13. **SeatLock** (endpoint #5) -- depends on 12go's new endpoint availability.

### Phase 4: Master Data + Notifications (Week 6-7)

14. **Stations, Operators, POIs** (endpoints #10-12) -- these may be simple proxies or S3 URL generators.
15. **Notification transformer** (endpoint #13) -- with shared secret authentication.

### Phase 5: Migration Tooling (Week 7-8)

16. **Per-client routing** via feature flags.
17. **Booking ID mapping table** for legacy bookings.
18. **Client migration runbook** (not code, but a documented process).

### Phase 6: Hardening (Ongoing)

19. **Drift detection** for 12go API changes.
20. **Performance testing** against staging.
21. **Monitoring integration** (Datadog, since 12go uses it).

---

## Unconventional Idea (considered and partially adopted)

### The "Two Services" Pattern: One Permanent, One Disposable

Instead of one service with adapter boundaries, deploy two separate services:

1. **Permanent service ("Contract Keeper")**: Owns the client-facing HTTP contract, version negotiation, feature flags, ID mappings, authentication bridge. Contains no 12go-specific code. Calls the disposable service via a well-defined internal API.

2. **Disposable service ("12go Adapter")**: Implements the internal API. Contains all 12go-specific logic. Can be replaced by a new adapter service when F3 decomposes. Or by a direct integration when 12go eventually provides a stable B2B API.

**Why this was partially adopted:**
The clean separation is appealing. But for a solo developer, deploying and operating two services doubles the infrastructure overhead (two CI pipelines, two deployment configs, two monitoring dashboards). The adapter-boundary pattern within a single service achieves the same conceptual separation with half the operational cost.

**What was adopted from this idea:**
The internal interface design (`IBookingGateway`) is designed as if it were an inter-service contract. If the team grows or the operational cost becomes justified, the outbound adapter can be extracted into a separate service with minimal code changes -- the interface already exists.

**What was rejected:**
Two deployables for a solo developer on a Q2 deadline. Not yet.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

- **Replacement cost of the 12go adapter.** When F3 is decomposed, the blast radius is one directory. The most expensive replacement is the booking schema mapper (~500 lines). Everything else in the adapter is straightforward HTTP client code.

- **Client contract durability.** The contract tests (Hurl files) are the most permanent artifact. They can validate any future implementation -- in any language, on any framework, against any backend.

- **Solo developer feasibility.** One service, one deployment, clear boundaries. No microservice coordination overhead. AI-friendly structure (each adapter mapper is an isolated, well-defined transformation function).

- **Gradual migration.** Per-client feature flags allow migrating one client at a time. Per-endpoint flags allow migrating one endpoint at a time within a client.

### Sacrifices

- **Initial build speed.** The adapter boundary pattern requires more upfront design than a simple pass-through proxy. Defining domain interfaces, mapper functions, and contract tests takes longer than just forwarding HTTP requests. The payoff comes at replacement time, not build time.

- **Operational simplicity during the "both systems running" phase.** The feature flag router adds complexity. Some clients on old, some on new, some partially migrated. This is unavoidable for any gradual migration but the routing logic is a real source of bugs.

- **Monolith alignment.** This design explicitly avoids embedding in F3. The Team Lead's argument ("easier to refactor when everything is together") is valid for the F3 refactoring project. But it means the B2B proxy is a separate concern that the F3 team must account for rather than simply owning. This is a tradeoff between isolation (our adapter is safe from F3 blast radius) and cohesion (F3 team cannot refactor B2B code as part of their monolith refactoring).

- **PHP ecosystem benefits.** By not being in PHP/Symfony, we lose: F3's built-in `VersionedApiBundle`, `ApiAgent` partner identity, Datadog APM tracing integration, Redis cache access, Kafka producer access. All of these must be wired explicitly in the proxy service. This is real work, but it is one-time setup work, not ongoing maintenance.
