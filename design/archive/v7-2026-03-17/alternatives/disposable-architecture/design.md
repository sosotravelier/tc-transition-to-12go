# Disposable Architecture Design

## The Temporary Constraint

F3 (frontend3) will be decomposed. Planning starts Q2 2026. No timeline, no target language, no milestones -- "beginning of the beginning of planning." The estimate is "a couple of quarters, not one." This is not a theoretical risk; it is a scheduled event with uncertain timing.

What this means for us:

1. **The 12go HTTP API surface we call today will change.** When F3 is broken apart, the endpoints at `/search/`, `/cart/`, `/reserve/`, `/confirm/`, `/booking/` may be split across multiple services, versioned differently, or replaced entirely.
2. **The client-facing contract will not change.** The 13 endpoints, the `Travelier-Version` header, the money-as-strings format, the net/gross pricing structure -- these are permanent. Clients are locked in.
3. **Code written today will live through the transition.** Team Lead confirmed (Mar 17) this is not throwaway. New clients onboard on the new system; old clients migrate gradually. The design must be solid enough to operate in production for an extended period, while being structured so that the 12go-specific parts can be surgically replaced.

The design problem is therefore: **build a system where the permanent parts (client contract) are expensive and well-tested, and the temporary parts (12go integration) are cheap and isolated.**

This is textbook ports and adapters. The twist is that it is a solo developer building it, with AI assistance, under Q2 deadline pressure. The architecture must be simple enough for one person to hold in their head, while maintaining the adapter boundary discipline that makes future replacement possible.

---

## Boundary Analysis

### Boundary 1: Client Contract (permanent)

This is the durable surface. Every design decision should protect it.

**The 13 endpoints:**

| # | Verb | Path | Key Headers | Response Codes |
|---|------|------|-------------|----------------|
| 1 | GET | `/v1/{client_id}/itineraries` | `Travelier-Version`, `x-correlation-id`, `x-api-experiment` | 200, 206 |
| 2 | GET | `/{client_id}/itineraries/{id}` | same | 200, 404 |
| 3 | POST | `/{client_id}/bookings` | same | 200, 400, 422 |
| 4 | POST | `/{client_id}/bookings/{id}/confirm` | same | 200, 400, 404 |
| 5 | POST | `/{client_id}/bookings/lock_seats` | same | 200 (stub) |
| 6 | GET | `/{client_id}/bookings/{id}` | same | 200, 404 |
| 7 | GET | `/{client_id}/bookings/{id}/ticket` | same | 200, 404 |
| 8 | POST | `/{client_id}/bookings/{id}/cancel` | same | 200, 400, 404 |
| 9 | GET | `/{client_id}/incomplete_results/{id}` | same | 200, 404 |
| 10 | GET | `/v1/{client_id}/stations` | same | 200 |
| 11 | GET | `/v1/{client_id}/operating_carriers` | same | 200 |
| 12 | GET | `/v1/{client_id}/pois` | same | 200 |
| 13 | POST | (webhook receiver) | none (unauthenticated) | 200 |

**Contract characteristics that must be preserved exactly:**

- `Travelier-Version` header in YYYY-MM-DD format, with `Deprecation` response header for outdated versions
- Money as strings: `{ "currency": "USD", "amount": "14.60" }`
- Pricing triple: `net_price`, `gross_price` (with `price_type`: Max/Min/Exact/Recommended), `taxes_and_fees`
- `206 Partial Content` for incomplete search results (ODF pattern)
- Confirmation types: Instant vs Pending
- Ticket types: Paper Ticket, Show On Screen, Pick Up
- Cancellation policies as time-windowed penalty arrays with ISO 8601 durations
- `x-correlation-id` and `x-api-experiment` propagated and returned
- `{client_id}` as URL path parameter on every endpoint
- `x-api-key` header (validated at gateway, not at service level today)

**Version negotiation:**

The `Travelier-Version` header drives response shaping. Current latest: `2023-07-01`. The version handler must be a middleware concern in the inbound adapter -- it reads the header, determines the contract version, and passes it as context to the response mapper. When 12go is replaced, the version handling logic does not change because it operates on the client-facing response shape, not on the backend data source.

### Boundary 2: 12go API Contract (temporary)

This is the disposable surface. The design isolates it so replacement is mechanical.

**Current API surface (11 endpoints):**

| Operation | Method | Path | Notes |
|-----------|--------|------|-------|
| Search | GET | `/search/{from}p/{to}p/{date}?seats={n}&direct=true` | Province or station suffix |
| GetTripDetails | GET | `/trip/{tripId}/{datetime}?seats={n}` | Detailed trip info |
| AddToCart (trip ID) | POST | `/cart/{tripId}/{datetime}?seats={n}` | Returns cart ID |
| AddToCart (body) | POST | `/cart?seats={n}&lang=en` | For internal itineraries |
| GetCartDetails | GET | `/cart/{cartId}` | Cart items |
| GetBookingSchema | GET | `/checkout/{cartId}?people=1` | Dynamic form fields |
| Reserve | POST | `/reserve/{bookingId}` | Custom flat key-value body |
| Confirm | POST | `/confirm/{bookingId}` | Empty body |
| GetBookingDetails | GET | `/booking/{bookingId}` | Status, pricing, ticket URL |
| GetRefundOptions | GET | `/booking/{bookingId}/refund-options` | Refund options with hash |
| Refund | POST | `/booking/{bookingId}/refund` | Execute with hash |

**Authentication:** API key as query parameter `?k=<api_key>` on every call.

**What will change when F3 is decomposed:**

- The base URL(s) -- a single monolith becomes multiple services
- The cart-based booking flow -- the cart/checkout abstraction is F3-specific and may not survive decomposition
- Authentication mechanism -- may move from query parameter to header-based or OAuth
- Error response structure -- currently returns `ErrorResponse` with `fields`, `messages`, `data.reasons`; new services will likely have different error shapes
- The booking schema's dynamic form field system (20+ wildcard patterns) -- this is deeply coupled to F3's checkout flow

**How the outbound adapter hides 12go details:**

The outbound adapter exposes an interface defined in domain terms, not 12go terms. The rest of the service never sees a `cartId`, never constructs a `/search/{from}p/{to}p/{date}` URL, never parses a `FormField` with `ExtensionData`. It sees:

```
interface SupplierGateway {
    searchTrips(from, to, date, seats) -> list<Trip>
    getItinerary(itineraryId, seats) -> ItineraryDetail
    createBooking(itineraryId, passengers, contact) -> BookingReference
    confirmBooking(bookingId) -> BookingConfirmation
    getBookingDetails(bookingId) -> BookingDetails
    getTicketUrl(bookingId) -> string
    cancelBooking(bookingId, refundOptionHash) -> CancellationResult
    getRefundOptions(bookingId) -> list<RefundOption>
    lockSeats(itineraryId, seats) -> SeatLockResult
}
```

Everything 12go-specific -- the cart flow, the reserve data serialization, the booking schema parsing -- lives behind this interface. When F3 is decomposed, a new implementation of `SupplierGateway` is written. The HTTP controllers, the response mappers, the contract tests, the feature flags -- none of them change.

---

## Anti-Corruption Layer Design

### Translation Model

The ACL translates between two conceptual models:

| Client World | 12go World | Translation |
|---|---|---|
| Fuji station IDs | 12go station IDs | Static mapping table (bidirectional) |
| Fuji operator IDs | 12go operator IDs | Static mapping table |
| Seat class names | 12go class IDs | Static mapping table |
| Vehicle types | 12go vehicle IDs | Static mapping table (operator + type concatenation) |
| Money as `{ currency, amount: string }` | `Price { value: decimal, fxcode: string }` | Format conversion |
| Net/gross/taxes pricing structure | price/netprice/agfee/sysfee | Pricing normalization |
| Booking token (encrypted?) | 12go cart ID / booking ID | ID translation + optional encryption |
| Itinerary ID (composite) | Trip ID + datetime | Encoding/decoding |
| `Travelier-Version` | (not applicable) | Version-specific response shaping |
| Cancellation policies (ISO 8601 durations) | `cancellation` code + `cancellation_message` | Policy interpretation |
| Confirmation type (Instant/Pending) | `confirmation_time` field | Threshold mapping |

### Implementation

The ACL is organized as three distinct translation layers within the codebase:

```
src/
  domain/               # Domain types -- the language of the service
    types.ts            # Trip, Booking, Station, Money, etc.
    ports.ts            # SupplierGateway interface, ClientRepository interface

  adapters/
    inbound/
      http/             # HTTP controllers, request parsing, response formatting
      middleware/        # Travelier-Version, correlation ID, auth passthrough
      mappers/          # Domain -> client response shape (version-aware)

    outbound/
      twelveGo/         # THE DISPOSABLE PART
        client.ts       # HTTP client for 12go endpoints
        mapper.ts       # 12go response -> domain types
        serializer.ts   # Reserve request flat key-value serialization
        schemaParser.ts # Booking schema dynamic field extraction
        errors.ts       # 12go error -> domain error translation

  mapping/              # Static data mapping (survives replacement)
    stations.ts         # Fuji ID <-> 12go station ID
    operators.ts        # Fuji operator ID <-> 12go operator ID
    classes.ts          # Seat class mapping
    vehicles.ts         # Vehicle type mapping

  config/               # Feature flags, client config, API key mapping
    flags.ts
    clients.ts
```

The key structural rule: **nothing in `domain/` or `adapters/inbound/` imports from `adapters/outbound/twelveGo/`**. The dependency arrow points inward. The outbound adapter depends on domain types; domain types do not know that 12go exists.

### Testing Strategy

The ACL is tested at three levels:

1. **Mapping unit tests** -- Pure functions. Given a 12go search response JSON fixture, does the mapper produce the correct domain `Trip` objects? Given a domain `BookingRequest`, does the serializer produce the correct flat key-value body? These tests are fast, deterministic, and numerous. They cover:
   - Station ID translation (bidirectional)
   - Price format conversion (12go `Price` -> client money format)
   - Booking schema dynamic field extraction (all 20+ patterns)
   - Reserve data flat serialization (bracket notation)
   - Error response parsing and classification

2. **Adapter integration tests** -- The outbound adapter is tested against recorded HTTP fixtures (see Contract Testing Strategy below). These verify that the full adapter flow (HTTP call -> parse response -> map to domain) works correctly.

3. **ACL boundary tests** -- Given a `SupplierGateway` mock returning domain types, the inbound adapter produces the correct client response. This tests the inbound side of the ACL independently of 12go.

**When 12go's API changes**, only the tests in category 1 (mapping unit tests) and category 2 (adapter integration tests) need to change. Category 3 tests and all inbound contract tests remain untouched.

---

## Feature Flag Architecture

### Requirements

- Per-client routing: some clients on old backend (current .NET services), some on new proxy
- Must survive deployments (not in-process state)
- Changeable without deployment by Team Lead or DevOps
- Simple enough for a solo developer to implement and maintain

### Design

A database-backed flag table. No external feature flag service (no Flagsmith, no LaunchDarkly -- one more dependency to manage as a solo developer is not worth it).

**Storage:** A single table in a lightweight persistent store. Given the "no local persistence" constraint and 12go's existing MariaDB, two options:

- **Option A (preferred): A small configuration table in 12go's MariaDB.** This aligns with the "one system" vision. The table is simple (`client_id VARCHAR, backend ENUM('legacy', 'proxy'), updated_at TIMESTAMP`). 12go veterans can help set it up. DevOps or Team Lead can update it via SQL or a simple admin endpoint.

- **Option B: Redis key-value pairs.** 12go already runs Redis. Store flags as `flag:routing:{client_id} = legacy|proxy`. Survives restarts, fast reads, changeable via `redis-cli` or a thin admin endpoint.

**Flag structure:**

```sql
CREATE TABLE b2b_client_routing (
    client_id VARCHAR(64) PRIMARY KEY,
    backend ENUM('legacy', 'proxy') NOT NULL DEFAULT 'legacy',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(64)
);
```

**Flag evaluation flow:**

1. Request arrives at API Gateway
2. Gateway routes to the proxy service (all traffic, once proxy is deployed)
3. Proxy reads `client_id` from URL path
4. Proxy looks up `b2b_client_routing` for this `client_id`
5. If `backend = 'proxy'`: handle the request through the new adapter
6. If `backend = 'legacy'` or not found: forward the request to the old .NET service unchanged

This means the proxy itself acts as a router during migration. It is both the new backend and the traffic splitter. This is simpler than configuring per-client routing in AWS API Gateway (which does not natively support it).

**Cache:** The routing table is small (tens of rows) and changes infrequently. Load it into memory on startup, refresh on a timer (every 60 seconds) or via a simple refresh endpoint. No need for a cache invalidation protocol.

**Who can change flags:** Anyone with database access or access to the admin endpoint. No deployment required. Team Lead, DevOps, or Soso can flip a client from `legacy` to `proxy` in under a minute.

### Rollback

If a client on the new proxy has issues, flip the flag back to `legacy`. The old .NET services are still running. Rollback is a one-row database update with sub-minute propagation.

---

## Contract Testing Strategy

### Inbound Contract Tests

**What:** Tests that verify the client-facing HTTP contract is correct. These are the most durable artifact of the entire project. They define what "correct" means for the external API, independent of implementation language or backend.

**Tool:** Language-agnostic HTTP-based tests. Two complementary approaches:

1. **Golden file tests (primary):** For each of the 13 endpoints, maintain a set of request/response pairs as JSON files:

```
tests/contracts/inbound/
  search/
    request-basic.http          # GET /v1/test_client/itineraries?from=...&to=...&date=...
    response-basic.json         # Expected 200 response shape
    request-partial.http        # Same but expecting 206
    response-partial.json
  get-itinerary/
    request.http
    response.json
  create-booking/
    request.http
    response-instant.json
    response-pending.json
  ...
```

Each test sends the HTTP request to the running service, receives the response, and validates it against the golden file using structural matching (not exact byte comparison -- allows for dynamic values like timestamps and IDs while enforcing shape, field names, types, and pricing format).

2. **Schema validation tests (secondary):** OpenAPI/JSON Schema definitions for each endpoint's request and response. Every response is validated against the schema. This catches structural regressions even when golden files do not cover a specific edge case.

**How they run:**

- As part of CI, against a running instance of the proxy with a mock `SupplierGateway` implementation that returns canned domain responses
- The mock is configured per test case to return specific domain objects
- The tests verify that the HTTP layer correctly maps domain objects to the client-facing JSON shape
- These tests are independent of 12go -- they test the inbound adapter in isolation

**Version-specific tests:** For each `Travelier-Version` value that changes response shape, maintain a separate golden file set. The test sends the request with the version header and validates against the version-specific response.

### Outbound Contract Tests

**What:** Tests that verify the 12go API adapter correctly calls 12go and maps responses to domain types.

**Approach:** Recorded HTTP fixture tests (not consumer-driven contracts -- Pact adds tooling overhead that is not justified for a solo developer with a single outbound dependency).

**Implementation:**

1. **Record phase (one-time, refreshable):** Make real calls to 12go's staging API and record the request/response pairs as HTTP archive files:

```
tests/contracts/outbound/
  search/
    fixture-basic.json          # Recorded 12go response for a basic search
    fixture-multi-segment.json  # Multi-segment trip
    fixture-no-results.json     # Empty results
  add-to-cart/
    fixture-success.json
    fixture-trip-unavailable.json
  booking-schema/
    fixture-basic.json          # Simple schema (name, email, phone)
    fixture-with-seats.json     # Schema with seat selection
    fixture-with-pickup.json    # Schema with pickup/dropoff points
  reserve/
    fixture-success.json
    fixture-validation-error.json
  ...
```

2. **Test phase (runs in CI):** The outbound adapter is tested against these fixtures using an HTTP mock that replays recorded responses. The test verifies:
   - The adapter sends the correct HTTP request (method, path, query params, body)
   - The adapter correctly maps the 12go response to domain types
   - Error responses are correctly classified (400 -> validation error, 404 -> not found, etc.)

3. **Refresh protocol:** Once a month (or when 12go reports API changes), re-record fixtures from staging. If any outbound contract test fails after refresh, it means 12go's API changed and the adapter needs updating. The test failure message points directly to the fixture and the mapping function that broke.

**When 12go's API changes:** The outbound contract tests fail. The developer:
1. Re-records fixtures from staging
2. Sees which fixtures changed
3. Updates the mapper functions in `adapters/outbound/twelveGo/`
4. Re-runs outbound tests until green
5. Inbound contract tests remain green because the domain types did not change

**When F3 is fully decomposed:** The entire `tests/contracts/outbound/` directory and `adapters/outbound/twelveGo/` directory are replaced. A new `adapters/outbound/newBackend/` is created with its own fixtures and mappers. The inbound contract tests are never touched.

---

## Survivability Analysis

| Artifact | Survives F3 decomposition? | Cost to replace | Notes |
|---|---|---|---|
| **Client contract tests (inbound golden files + schemas)** | Yes | -- | Language-agnostic HTTP tests. The single most valuable artifact. |
| **Domain types (Trip, Booking, Money, etc.)** | Yes | -- | These define the service's internal language. They outlive any backend. |
| **Inbound HTTP adapter (controllers + response mappers)** | Yes | -- | Client contract is permanent. Version handling is permanent. |
| **Station ID mapping data** | Yes | Low | Static data table. May need new columns for new backend IDs. |
| **Operator ID mapping data** | Yes | Low | Same. |
| **Seat class / vehicle mapping data** | Yes | Low | Same. |
| **API key mapping (client -> backend key)** | Yes | Low | Configuration table. New backend may use different auth, but the mapping concept persists. |
| **Feature flag table + routing logic** | Yes | Low | Per-client routing is needed during any migration, regardless of backend. |
| **Correlation ID / version header middleware** | Yes | -- | Cross-cutting HTTP concerns. Backend-independent. |
| **SupplierGateway interface definition** | Probably yes | Low | The interface may need minor method signature changes, but the concept survives. |
| **12go HTTP client** | No | Medium | Replaced entirely. New backend = new HTTP client. |
| **12go response mappers** | No | High | The most complex code (booking schema parsing, search response normalization). Thrown away. |
| **Reserve data serializer** | No | Medium | Custom flat key-value format is 12go-specific. |
| **12go error handling** | No | Low | Error classification is backend-specific. |
| **Outbound contract tests (12go fixtures)** | No | Medium | New fixtures recorded against new backend. Structure of the test harness survives; fixtures do not. |
| **Webhook receiver (12go notification format)** | No | Medium | New backend will have different notification format. The transformer concept survives; the transformation logic does not. |

**Summary:** Approximately 60-70% of the codebase (by value, not by lines) survives F3 decomposition. The parts that die are concentrated in `adapters/outbound/twelveGo/` and its tests. The parts that survive are the client-facing HTTP layer, the domain model, the mapping data, and the inbound contract tests.

---

## Language and Framework

The language choice for a disposable-by-design service should be evaluated on three criteria: (1) how well it enforces adapter boundary discipline, (2) how easy it is to test adapters in isolation, and (3) pragmatic constraints (solo developer, AI assistance, Q2 deadline, team ecosystem).

### Evaluation

| Criterion | PHP (Symfony) | TypeScript | Go | .NET (C#) |
|---|---|---|---|---|
| **Interface expressiveness** | Weak. PHP interfaces exist but loose typing makes boundary violations easy to miss at compile time. | Good. TypeScript interfaces + strict mode enforce shapes at compile time. Discriminated unions for error handling. | Excellent. Explicit interfaces, no implicit implementation. Compile-time boundary enforcement. | Excellent. Interfaces, strong typing, discriminated unions (with recent C# features). |
| **Adapter isolation in tests** | Adequate. PHPUnit with mocks. Symfony's kernel testing is heavyweight for adapter tests. | Good. Jest/Vitest with easy mocking. HTTP mocking libraries (msw, nock) are mature. | Good. Table-driven tests, `httptest` package for HTTP mocking. No DI framework needed -- interfaces are passed explicitly. | Good. xUnit/NUnit, Moq/NSubstitute, `HttpMessageHandler` mocking. Mature ecosystem. |
| **Boundary discipline** | Risky. PHP's dynamic nature makes it easy to reach across boundaries without the compiler complaining. | Moderate. TypeScript's structural typing enforces shapes but does not prevent runtime boundary violations. Import restrictions need lint rules. | Strong. Package-level visibility + explicit interface implementation. If the adapter package does not export 12go types, the domain cannot accidentally depend on them. | Strong. Assembly-level visibility + interface-based DI. Similar to Go but with more ceremony. |
| **Solo developer + AI** | Possible. AI generates PHP well. But Soso has no PHP production experience -- ramp-up cost is real. 12go veterans available for review. | Possible. AI generates TypeScript very well. Soso has some exposure. Lightweight runtime, fast iteration. | Possible. AI generates Go well. Soso has no Go production experience. Go's simplicity reduces ramp-up. | Natural. 12 years of .NET experience. AI generates C# very well. No ramp-up. |
| **"One system" alignment** | Best. F3 is PHP/Symfony. Monolith option means code lives inside F3. | Poor. Would be a standalone microservice in a non-12go language. | Moderate. 12go is "considering Go" but nothing decided. | Poor for long-term. .NET is the language being deprecated in the organization. |
| **Replacement cost** | If built in F3, replacement requires extracting from the monolith. If standalone, same as other languages. | Low. Small TypeScript service is quick to rewrite. | Low. Go services are typically small and replaceable. | Low as a microservice. But risks the "write .NET, then rewrite PHP, then rewrite something else" triple migration. |

### Recommendation

**For the disposable architecture pattern, the language matters less than the boundary discipline.** Any of these languages can implement clean adapter boundaries. The real risk is not the language -- it is a solo developer under deadline pressure cutting corners on the boundary.

That said, two practical factors dominate:

1. **Solo developer with .NET expertise.** Soso has 12 years of C# experience. A .NET microservice has zero ramp-up cost, and AI assistance for C# is excellent. Building in PHP means learning a new ecosystem while under deadline pressure.

2. **"One system" organizational constraint.** Management wants convergence toward 12go's stack. Code inside F3 aligns with this. A .NET microservice works against it.

The disposable architecture pattern resolves this tension: **if the outbound adapter is the only part that is 12go-specific, then the language of the service matters less for the F3 decomposition scenario.** When F3 is decomposed:
- If the service is in PHP inside F3: the outbound adapter (which calls F3 internal APIs) is replaced with one calling new services. The inbound adapter stays.
- If the service is a .NET microservice: the outbound adapter (which calls F3 HTTP API) is replaced with one calling new services. The inbound adapter stays.
- In both cases, the replacement is the same work: rewrite the outbound adapter.

The disposable architecture pattern is **language-agnostic by design**. Choose based on practical constraints (developer expertise, deadline, organizational alignment), not on architectural purity.

**If PHP/Symfony (monolith in F3):** The adapter boundary must be enforced by directory structure and code review, not by the compiler. Use Symfony bundles to create physical separation. The risk is boundary erosion over time.

**If .NET (microservice):** The adapter boundary is enforced by assembly separation. The risk is the triple-migration concern (current .NET -> new .NET proxy -> eventually something else).

**If either:** The inbound contract tests, domain types, mapping data, and feature flag infrastructure survive. The outbound adapter is replaced.

---

## Architecture Diagram

```
                         PERMANENT                           TEMPORARY
                    (survives F3 decomp)              (replaced when F3 changes)
                    ====================              =========================

    Clients
      |
      | HTTP (13 endpoints, Travelier-Version, x-correlation-id)
      v
+------------------------------------------------------------------+
|                    INBOUND ADAPTER                                |
|                                                                  |
|  [API Gateway] --> [HTTP Controllers] --> [Request Validators]   |
|                         |                                        |
|  [Travelier-Version Middleware]  [Correlation ID Middleware]      |
|                         |                                        |
|  [Response Mappers] (version-aware, domain -> client JSON)       |
|                                                                  |
+------------------------------------------------------------------+
      |
      | Domain Types (Trip, Booking, Money, Station, etc.)
      v
+------------------------------------------------------------------+
|                    DOMAIN CORE                                    |
|                                                                  |
|  [SupplierGateway Interface]  [Mapping Data: Station/Operator]   |
|  [Feature Flag Router]        [Client Config / API Key Mapping]  |
|                                                                  |
+------------------------------------------------------------------+
      |
      | SupplierGateway interface
      v
+------------------------------------------------------------------+
|                    OUTBOUND ADAPTER  <-- THIS GETS REPLACED      |
|                                                                  |
|  [12go HTTP Client]                                              |
|  [12go Response Mapper] (12go JSON -> domain types)              |
|  [Reserve Data Serializer] (domain -> flat key-value)            |
|  [Booking Schema Parser] (dynamic form fields)                   |
|  [12go Error Handler] (HTTP status -> domain errors)             |
|  [12go Auth] (?k=<api_key> query param injection)                |
|                                                                  |
+------------------------------------------------------------------+
      |
      | HTTP (11 endpoints, ?k=<api_key>)
      v
    12go (F3)


+------------------------------------------------------------------+
|                 WEBHOOK ADAPTER  <-- ALSO GETS REPLACED          |
|                                                                  |
|  [Webhook Receiver] (POST from 12go, { "bid": <long> })         |
|  [IP/Auth Verification] (see Security section)                   |
|  [Notification Transformer] (12go format -> client format)       |
|  [Client Webhook Dispatcher] (forward to client's URL)           |
|                                                                  |
+------------------------------------------------------------------+
```

**The bold line:** The `SupplierGateway` interface is the seam. Everything above it survives. Everything below it is disposable.

---

## Security

### Key Finding #10: Webhook Notifications from 12go Have Zero Authentication

This is a known vulnerability. The current `OneTwoGo.PostBookingNotifications.NotificationAuthenticator` returns `ValueTask.CompletedTask` -- it is a no-op. Anyone who discovers the webhook URL can send fake booking notifications.

### The Boundary Perspective

Webhook authentication is an inbound adapter concern, not a domain concern. The domain receives a "booking status changed" event; it does not care how the webhook was verified. This means verification strategy can change without touching domain logic.

### Current State (pre-transition)

- **Authentication:** None. Any HTTP POST to the webhook endpoint is accepted.
- **Payload:** `{ "bid": <long> }` -- minimal, but a valid booking ID is enough to trigger downstream processing.
- **Risk:** An attacker who knows the endpoint URL and a valid booking ID can trigger fake status change events, potentially corrupting booking state for downstream consumers.

### Transition Design (what to build now)

Since 12go does not currently support signed webhooks, we implement defense-in-depth at the adapter boundary:

1. **IP allowlist (immediate).** 12go's infrastructure runs on known EC2 instances. The webhook receiver should only accept requests from 12go's IP range. Implementation: a middleware that checks `Request.RemoteAddr` (or the appropriate header if behind a load balancer) against a configured allowlist. This is configured in the inbound adapter, not in domain logic.

2. **Shared secret header (request from 12go team).** Ask the 12go team to add a configurable `X-Webhook-Secret` header to outgoing notifications. This is a simple change on their side (add a header from config). The webhook receiver validates this header before processing. If 12go cannot do this immediately, the IP allowlist is the fallback.

3. **Idempotency guard.** Even with authentication, process each `bid` notification at most once per status transition. This prevents replay attacks and duplicate processing. Track `(bid, status)` tuples in a lightweight store (Redis TTL key or in-memory with expiry).

### Adapter Boundary Design for Swappable Verification

The webhook receiver has a verification interface:

```
interface WebhookVerifier {
    verify(request: HttpRequest): Result<void, AuthError>
}
```

Current implementation: `IpAllowlistVerifier` (checks source IP) + optional `SharedSecretVerifier` (checks header).

When 12go eventually adds signed webhooks (e.g., HMAC-SHA256 signatures like Distribusion already uses), a new `HmacSignatureVerifier` implementation replaces the current one. The webhook controller does not change. The domain notification handler does not change. Only the verifier implementation changes.

### After F3 Decomposition

When F3 is decomposed, the new backend services will likely have a different notification mechanism -- possibly event-driven (Kafka consumer) rather than webhook-based. In that case:

- The webhook adapter is retired entirely
- A new event consumer adapter is created
- The domain notification handler (which transforms supplier events to client format) remains unchanged
- The `WebhookVerifier` interface becomes irrelevant -- the new adapter has its own security model (Kafka ACLs, TLS, etc.)

The boundary design ensures this is a clean swap, not a refactor.

---

## What Gets Built First

Prioritized for a solo developer under Q2 deadline, optimizing for early validation and incremental migration:

### Phase 1: Foundation (Week 1-2)

1. **Domain types.** Define the domain model: `Trip`, `Booking`, `Money`, `Station`, `Operator`, `ItineraryDetail`, `BookingRequest`, `CancellationResult`. These are small, well-typed data structures. They are the language of the service.

2. **SupplierGateway interface.** Define the outbound port. This is the contract between the domain and the adapter. Get this right early -- everything depends on it.

3. **Inbound contract test harness.** Set up the test infrastructure for golden file tests. Record current responses from the existing .NET services as the golden files. These are the authoritative definition of "correct."

4. **Station/operator mapping data.** Load the static mapping tables. These exist in SI host already; extract and persist as data files or database rows.

### Phase 2: Search (Week 2-3)

5. **Search outbound adapter.** Implement the 12go search call, response mapping, and station ID translation. This is the simplest endpoint and the one where the POC was already done.

6. **Search inbound adapter.** HTTP controller, response mapper (domain -> client JSON), `Travelier-Version` handling, `206 Partial Content` for incomplete results.

7. **Search contract tests (both sides).** Inbound: golden file test against recorded current-service response. Outbound: recorded 12go fixture test.

8. **Feature flag router.** Implement per-client routing so one client can be pointed at the new proxy while others stay on legacy.

### Phase 3: Booking Funnel (Week 3-5)

9. **GetItinerary adapter.** Three 12go calls (trip details + add to cart + checkout schema). The booking schema parser is the highest-complexity piece -- build and test it thoroughly.

10. **CreateBooking adapter.** Reserve request serialization (custom flat key-value format). This is the second-highest complexity piece.

11. **ConfirmBooking adapter.** Relatively straightforward -- POST to confirm + get booking details.

12. **Contract tests for booking funnel.** Both inbound and outbound.

### Phase 4: Post-Booking (Week 5-6)

13. **GetBookingDetails, GetTicket, CancelBooking adapters.** These are simpler -- mostly direct mapping from 12go responses.

14. **IncompleteResults.** Polling endpoint for async operations.

15. **SeatLock.** Stub or real implementation depending on 12go endpoint availability.

### Phase 5: Webhook + Static Data (Week 6-7)

16. **Webhook receiver** with IP allowlist verification and notification transformer.

17. **Stations, Operators, POIs** endpoints (pre-signed S3 URLs -- may be largely pass-through from existing Fuji data).

### Phase 6: Migration (Week 7+)

18. **First client migration.** Flip one client to the new proxy. Monitor. Fix issues.

19. **Gradual rollout.** Flip additional clients one by one.

---

## Unconventional Idea (considered and partially adopted)

### The "Strangler Router" Pattern

Instead of building a new service and cutting over, make the proxy service a transparent HTTP forwarder from day one. Deploy it in front of the existing .NET services. Initially, it forwards 100% of traffic unmodified. Then, endpoint by endpoint, it starts handling requests itself instead of forwarding.

**How it works:**

1. Deploy the proxy. Configure API Gateway to route all B2B traffic to it.
2. The proxy reads the path, checks a routing table: `{ endpoint: "search", backend: "legacy" }`. All endpoints start as `legacy`.
3. For `legacy` endpoints, the proxy forwards the request to the old .NET service and returns the response untouched.
4. Implement the Search endpoint in the proxy. Change the routing table: `{ endpoint: "search", backend: "proxy" }`.
5. Repeat for each endpoint.
6. When all 13 endpoints are `backend: "proxy"`, the old .NET services can be decommissioned.

**Why this is interesting:** It combines the feature flag architecture with the migration strategy. There is no "big cutover" -- not even per client. You can migrate one endpoint for one client at a time. If Search is broken for client X, flip it back. The routing table has two dimensions: `(client_id, endpoint) -> legacy|proxy`.

**Why it is partially adopted:** The per-client routing flag described in the Feature Flag Architecture section already captures this pattern. The per-endpoint dimension adds granularity but also complexity (13 endpoints x N clients = many flags). For a solo developer, per-client routing is probably sufficient granularity. Per-endpoint routing is a refinement that can be added if needed.

**What was rejected:** Full strangler-fig with per-endpoint routing from day one. The overhead of maintaining a transparent forwarder for endpoints not yet migrated is real (header propagation, body forwarding, timeout handling, error passthrough). It is simpler to migrate client by client with all endpoints at once, tested as a unit.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for

- **Replacement cost.** When F3 is decomposed, the work is: write a new outbound adapter, record new fixtures, re-run existing inbound contract tests. The permanent parts (client HTTP layer, domain model, mapping data, feature flags) are untouched. Estimated replacement effort: 2-3 weeks for a single developer, versus 6-8 weeks for a design without clean boundaries.

- **Confidence during replacement.** The inbound contract tests are the safety net. When the outbound adapter is swapped, the contract tests verify that clients see exactly the same responses. No regression guessing.

- **Solo developer sustainability.** The codebase is small and has clear "zones." The 12go-specific zone can be understood and modified without understanding the client-facing zone, and vice versa. AI code generation is effective when the boundaries are explicit and the interfaces are well-typed.

- **Incremental migration.** Per-client feature flags allow gradual rollout. If something breaks for one client, it does not affect others. Rollback is a database update.

### Sacrifices

- **Initial build speed.** Defining interfaces, writing contract tests, maintaining golden files, separating adapters -- all of this takes more time upfront than a "just proxy it" approach. Estimated overhead: 1-2 weeks over a naive implementation.

- **Code volume in the outbound adapter.** The adapter does not just forward HTTP calls; it translates between two models. The booking schema parser alone is ~500 lines of transformation logic. This code is explicitly disposable, but it still needs to be written and tested.

- **Performance optimization opportunities.** The strict adapter boundary prevents shortcuts like caching 12go responses in a shared layer or short-circuiting domain translation for simple pass-through cases. Every request goes through the full adapter pipeline. In practice, the overhead is negligible for a proxy service (microseconds of mapping vs. hundreds of milliseconds of HTTP latency to 12go).

- **Monolith alignment.** This design is structurally a microservice -- it has its own deployment, its own HTTP server, its own adapter boundaries. It does not live inside F3. This works against the "one system" vision. The counterargument: the adapter boundary discipline is what matters, not the deployment topology. The same boundary structure could be implemented inside F3 as a Symfony bundle, but the physical separation of a standalone service makes the boundary harder to violate accidentally.
