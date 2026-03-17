# Clean Slate Design

## The Irreducible Problem

Forget Denali, Etna, Fuji, Supply-Integration. Forget DynamoDB, MediatR, Kafka, hybrid caches. Here is what actually has to exist:

**A single HTTP service that accepts 13 client-facing endpoints, translates each request into 1-3 calls to 12go's HTTP API, transforms the responses into the client-expected shape, and returns them.**

That is the entire problem. Every other piece of complexity in the current system -- multi-supplier abstraction, cache pipelines, experiment executors, integration mappers, Kafka event chains -- exists because the old system served multiple suppliers and had architectural ambitions beyond proxying. With only 12go as the backend, the problem reduces to an HTTP-in, HTTP-out translator.

The irreducible complexity that survives this simplification:

1. **ID translation** -- Clients send Fuji CMS IDs (8-char alphanumeric like `ILTLVTLV`); 12go uses integer station/operator/class IDs. Every request and response must translate between these two ID spaces. This mapping is a static lookup table (~thousands of entries).

2. **Booking schema parsing** -- 12go's `/checkout` endpoint returns a flat JSON object with dynamic keys embedding trip-specific cart IDs (e.g., `selected_seats_TH013r013800Cb00603SPY6d`). The proxy must normalize these into a stable `booking_schema` JSON Schema object, then reconstruct the original dynamic keys when assembling the `/reserve` POST body. This requires storing a key-mapping between the two HTTP calls (GetItinerary and CreateBooking).

3. **Response shape transformation** -- 12go returns `{trips, operators, stations, classes, travel_options}`. Clients expect `{itineraries, segments, vehicles}` with different nesting, different field names, money-as-strings, ISO 8601 durations, cancellation policy arrays, and confidence scores. This is the core translation logic.

4. **Multi-call orchestration** -- Some client endpoints require multiple sequential 12go calls: GetItinerary needs trip details + add-to-cart + checkout schema. CreateBooking needs reserve + get-booking-details. CancelBooking needs refund-options + refund. The proxy must orchestrate these sequences.

5. **Webhook notification transformation** -- 12go sends `{ "bid": <int> }` when booking status changes. Clients expect a different notification format with TC-format booking IDs. The proxy must transform and forward.

6. **Pricing passthrough** -- With Ushba (markup) being sunset, prices from 12go pass through with format conversion (12go's `{value, fxcode}` to client's `{amount: "string", currency}`). Gross price, net price, taxes_and_fees structure must be assembled.

Everything else is accidental complexity.

---

## API Contract Analysis

### Operation Types

The 13 endpoints fall into four distinct categories:

**Category 1: Stateless read-only proxy (5 endpoints)**
- `GET /v1/{client_id}/itineraries` -- Search. 1 call to 12go `/search`. Heaviest transformation (trips+travel_options to itineraries+segments+vehicles).
- `GET /{client_id}/bookings/{id}` -- GetBookingDetails. 1 call to 12go `/booking/{bid}`.
- `GET /{client_id}/bookings/{id}/ticket` -- GetTicket. 1 call to 12go `/booking/{bid}`, extract ticket_url.
- `GET /v1/{client_id}/stations` -- Stations master data. Can serve a pre-built static file or redirect.
- `GET /v1/{client_id}/operating_carriers` -- Operators master data. Same pattern.

**Category 2: Multi-call orchestrated operations (4 endpoints)**
- `GET /{client_id}/itineraries/{id}` -- GetItinerary. 3 sequential calls: trip details, add-to-cart, checkout schema. Returns booking_schema + pricing. **Requires storing checkout key-mapping for later reserve call.**
- `POST /{client_id}/bookings` -- CreateBooking. Reconstruct dynamic keys from stored mapping, call reserve, then get-booking-details.
- `POST /{client_id}/bookings/{id}/confirm` -- ConfirmBooking. Call confirm, then get-booking-details.
- `POST /{client_id}/bookings/{id}/cancel` -- CancelBooking. Call refund-options, select option, call refund.

**Category 3: Stateful / pending (2 endpoints)**
- `POST /{client_id}/bookings/lock_seats` -- SeatLock. 12go endpoint under development. Will be a simple proxy once available.
- `GET /{client_id}/incomplete_results/{id}` -- Polling for async results. May need local state or can re-query 12go.

**Category 4: Inbound webhook (1 endpoint)**
- `POST /v1/notifications/onetwogo` -- Receives booking status change from 12go, transforms format, forwards to client webhook URL.

**Category 5: Static/reference data (1 endpoint)**
- `GET /v1/{client_id}/pois` -- POI data. Province-based search. Can be served from a static dataset.

### Non-Trivial Transformations

| Transformation | Complexity | Where it applies |
|---|---|---|
| **Station ID mapping** (Fuji CMS <-> 12go int) | Medium -- ~5000 entries, bidirectional lookup, used in nearly every endpoint | Search request/response, GetItinerary, booking responses, master data |
| **Operator ID mapping** (Fuji CMS <-> 12go int) | Low -- same pattern as stations, smaller set | Search response, segments |
| **Seat class ID mapping** | Low -- small set, may have discrepancies between operators | Search response, segments |
| **Vehicle ID construction** | Low -- concatenation of operator + vehicle type | Search response |
| **Search response reshaping** | High -- 12go's flat `{trips[], travel_options[]}` to TC's normalized `{itineraries[], segments[], vehicles[]}` | Search |
| **Money format conversion** | Low but pervasive -- 12go `{value: decimal, fxcode: string}` to TC `{amount: "string", currency: "string"}` | Every endpoint with pricing |
| **Booking schema normalization** | High -- parse dynamic checkout keys, build JSON Schema, store key mapping | GetItinerary |
| **Reserve request assembly** | High -- reconstruct dynamic bracket-notation keys from stored mapping | CreateBooking |
| **Cancellation policy construction** | Medium -- derive time-windowed penalty array from 12go's cancellation fields | Search, GetItinerary |
| **SearchItineraryId encoding** | Medium -- composite ID that must be URL-safe, decodable, and contain trip+datetime+class info | Search response, GetItinerary request |
| **Booking ID transition** | Low -- for new bookings, use 12go bid directly; for legacy, static mapping table | Post-booking endpoints |
| **Webhook payload transformation** | Low -- `{bid}` to TC notification format with correct booking ID | Notifications |

### Required State

The proxy is designed to be **nearly stateless**, but two pieces of state are unavoidable:

1. **Checkout key mapping** (between GetItinerary and CreateBooking) -- When GetItinerary calls 12go's `/checkout/{cartId}`, the response contains dynamic field keys (e.g., `selected_seats_TH013r...`). These must be stored so that CreateBooking can reconstruct them. Lifetime: minutes (the booking flow). Storage: in-memory cache with TTL (3 hours is generous). Size: ~1KB per active checkout.

2. **ID mapping tables** (stations, operators, seat classes) -- Static reference data loaded at startup. Changes infrequently. Can be refreshed periodically. Storage: in-memory. Size: ~1-5MB.

3. **Legacy booking ID mapping** (transitional) -- Static table mapping old TC booking IDs to 12go bids. Only needed for post-booking operations on pre-migration bookings. Can be loaded as a config file or small database table. Finite and shrinking.

**What does NOT need state:**
- Booking details -- 12go is the source of truth (confirmed no-persistence design)
- Search results -- no caching needed; 12go handles its own Redis caching
- Session/cart state -- ephemeral, contained within the multi-call orchestration of a single endpoint handler

### Error Surface

| 12go Error | Client-Facing Mapping | Complexity |
|---|---|---|
| 400 with field errors | Map field names back through checkout key mapping; return structured validation errors | Medium -- field name reverse translation |
| 400 with "Trip is no longer available" | 404 Not Found or specific error code | Low -- string matching |
| 401 Unauthorized | 500 Internal Server Error (auth is our responsibility, not client's) | Low |
| 404 Not Found | 404 Not Found | Direct |
| 422 with reason codes (e.g., `bad_trip_details`) | Map to appropriate client error (404, 400) | Medium -- reason code mapping |
| 500+ | 502 Bad Gateway | Low |
| Timeout | 504 Gateway Timeout | Low |
| `recheck` array non-empty in search | 206 Partial Content | Low -- just check array and set status code |

---

## Language Evaluation (First Principles)

The problem is: receive HTTP, transform JSON, send HTTP, transform JSON, return HTTP. Evaluated purely on fitness:

| Criterion | Go | TypeScript (Node) | PHP/Symfony | .NET (C#) |
|---|---|---|---|---|
| **HTTP server simplicity** | Excellent. `net/http` or Chi/Echo -- minimal boilerplate, routing is trivial for 13 endpoints | Good. Express/Fastify -- very simple | Good. Symfony has more ceremony but well-understood | Good. ASP.NET Minimal APIs are clean |
| **HTTP client quality** | Good. `net/http` is low-level but reliable. No built-in retry/circuit-breaker. | Good. `fetch` or `axios` -- simple and well-tested | Good. Symfony HttpClient or Guzzle | Good. `HttpClient` with built-in DI, Polly for resilience |
| **JSON transform ergonomics** | Poor. Structs with tags for every field. Nested transformations are verbose. No optional types natively. Dynamic JSON parsing is painful. | Excellent. JSON is native. Destructuring, spread, optional chaining. Dynamic key handling is trivial. Object reshaping is the language's sweet spot. | Good. PHP arrays are flexible for JSON manipulation. `json_decode` to associative arrays makes reshaping easy. Less type safety. | Good. `System.Text.Json` or `Newtonsoft.Json`. Strong typed models but verbose for dynamic schemas. `JsonExtensionData` exists but is clunky (as the current codebase demonstrates). |
| **Type safety for mappings** | Good. Structs enforce shape. But lack of generics expressiveness and optional types make mapping code verbose. | Good with TypeScript. Interfaces, discriminated unions, mapped types. Excellent for defining API contract types. | Poor. No compile-time type safety for JSON shapes. Runtime errors only. | Excellent. Strong types, nullable reference types, pattern matching. |
| **Dynamic JSON handling** (critical for booking schema) | Poor. `map[string]interface{}` is the escape hatch. Type assertions everywhere. The booking schema parser would be painful to write. | Excellent. `Object.keys()`, `Object.entries()`, regex on keys, dynamic property access. The booking schema parser would be ~50 lines. | Good. Associative arrays handle dynamic keys naturally. `preg_match` on keys is idiomatic. | Poor-to-medium. `JsonExtensionData` exists but as we see from the current 600-line implementation, it is not ergonomic. |
| **Startup time** | Excellent. Compiled binary, <50ms cold start. | Good. ~200ms. | Poor for Symfony (1-2s with container compilation). Fast for slim frameworks. | Medium. ~500ms for ASP.NET. |
| **Single binary deployment** | Excellent. One binary, no runtime. | Poor. Needs Node.js runtime. | Poor. Needs PHP runtime + web server. | Medium. Self-contained publish possible but large. |
| **AI-assisted development** | Excellent. Claude/Copilot produce high-quality Go. Simple patterns. | Excellent. Best AI code generation support. | Good. Well-supported by AI tools. | Excellent. Well-supported by AI tools. |
| **Concurrency for multi-call orchestration** | Excellent. Goroutines make parallel 12go calls trivial. | Good. `Promise.all()` for parallel calls. | Poor. Synchronous by default. Requires async extensions or Swoole. | Good. `Task.WhenAll()` for parallel calls. |

### Recommendation: Go

**Why Go wins for this specific problem:**

1. **The problem is a proxy.** Go was designed for exactly this: network services that receive requests, make outbound calls, and return responses. The standard library alone covers 80% of the need.

2. **13 endpoints is small.** Go's verbosity is a liability in large applications but a non-issue for 13 route handlers. Each handler is a self-contained function.

3. **Single binary deployment.** One Docker image, no runtime dependencies, minimal attack surface. Deploys to 12go's infrastructure trivially.

4. **Concurrent multi-call orchestration.** GetItinerary's 3 sequential calls, with potential parallel calls, are natural with goroutines and channels.

5. **Memory efficiency.** ID mapping tables loaded in-memory at startup are efficient in Go's memory model. No GC pressure from millions of short-lived request objects.

**Why Go's weaknesses are manageable:**

- **Dynamic JSON for booking schema**: This is the hardest part. Go's `json.RawMessage` and `map[string]interface{}` are less ergonomic than TypeScript's native objects. But the booking schema parser is ~300-400 lines in any language. It is a one-time implementation, not ongoing development pain. Using a library like `gjson`/`sjson` helps significantly.

- **Verbosity in transformations**: Each response transformer will be longer in Go than in TypeScript. But with 13 endpoints, this is ~1500 lines of transformation code total. Manageable.

**Why not TypeScript (the runner-up):**

TypeScript would be the best choice if the problem were primarily JSON transformation with complex nesting. And for the booking schema parser specifically, TypeScript is superior. But the overall problem is a network proxy, and Go's strengths in deployment simplicity, performance, and concurrency outweigh TypeScript's JSON ergonomics advantage. Additionally, Go aligns with 12go's stated future direction.

**Why not PHP/Symfony:**

PHP would provide organizational alignment with 12go's existing stack, which is a real operational benefit. For pure proxy fitness, PHP is adequate but not distinguished. Symfony's ceremony (service containers, configuration, bundles) is overhead for 13 endpoints. If organizational alignment were the primary constraint, PHP would be the choice -- but this design evaluates language fitness, not organizational fit.

**Why not .NET:**

.NET is a perfectly capable choice. The current system proves it can do the job. But it carries more deployment weight than Go, and its JSON transformation ergonomics are demonstrably poor for this problem (the current 600-line booking schema parser with `JsonExtensionData` and 20+ `[JsonIgnore]` properties is evidence). For a clean slate, there is no reason to choose .NET over Go for an HTTP proxy.

---

## Irreducible Complexity Analysis

| Complexity | Why it cannot be eliminated | Best-known solution pattern | Estimated size |
|---|---|---|---|
| **Station ID mapping** (Fuji CMS <-> 12go int) | Clients send Fuji IDs. 12go expects integers. Every search, booking, and master data endpoint needs this. | Bidirectional hash map loaded at startup from a config file (exported from Fuji DynamoDB once). Refreshed on a timer or SIGHUP. | ~200 lines + config file |
| **Operator ID mapping** | Same as stations but for operators. | Same pattern. Can share the mapping infrastructure. | ~50 lines (reuses station pattern) |
| **Seat class ID mapping** | Different ID spaces between systems. Discrepancies exist (12go "express" vs DeOniBus "sleeper"). | Same bidirectional map. Requires manual curation of the mapping. | ~50 lines + config |
| **Search response transformation** | 12go returns trips+travel_options; clients expect itineraries+segments+vehicles. The nesting, field names, money format, duration format, and cancellation policy structure are all different. | Pure function: `transform12goSearchToClientResponse(12goResponse, idMaps) -> ClientResponse`. One file, ~300-400 lines. | ~400 lines |
| **Booking schema parsing** | 12go's checkout returns dynamic keys with embedded cart IDs. Client expects a normalized JSON Schema. The key mapping must survive across HTTP requests (GetItinerary -> CreateBooking). | Parse dynamic keys with regex/prefix matching, normalize to stable names, store name-to-supplier-name map in cache (keyed by cart/booking ID, 3hr TTL). | ~300 lines |
| **Reserve request assembly** | Must reconstruct 12go's bracket-notation dynamic keys from the stored name mapping + client's booking request data. | Reverse the parsing: look up stored mapping, substitute normalized names with original supplier keys, build flat JSON object. | ~200 lines |
| **Money format conversion** | 12go: `{value: decimal, fxcode: string}`. Client: `{amount: "14.60", currency: "USD"}`. | Helper function: `convertPrice(12goPrice) -> ClientPrice`. Applied everywhere. | ~20 lines |
| **SearchItineraryId codec** | Composite ID encoding trip key + datetime + class info. Must be URL-safe and decodable. | Encode: base64url(JSON({tripId, datetime, seats, classId})). Decode: reverse. Keep it simple. | ~50 lines |
| **API key resolution** | Client sends `x-api-key` header. 12go expects `?k=<key>` query param. Must map client identity to 12go API key. | Config map: `clientId -> 12goApiKey`. Loaded at startup. Eventually clients migrate to 12go keys directly. | ~30 lines |
| **Header propagation** | `Travelier-Version`, `x-correlation-id`, `x-api-experiment` must be preserved/forwarded. | Middleware that reads headers from inbound request and attaches to context. | ~40 lines |
| **Webhook transformation** | 12go sends `{bid}`. Client expects TC notification format. Must resolve client from booking, transform payload, forward. | Receive -> transform payload -> HTTP POST to client URL. Client ID from query param in webhook URL. | ~100 lines |
| **Webhook security** | 12go sends unauthenticated webhooks. Must prevent spoofing. | IP allowlist + HMAC if 12go supports it. See Security section. | ~50 lines |
| **Legacy booking ID mapping** | Old TC booking IDs must resolve to 12go bids for post-booking operations on pre-migration bookings. | Static JSON/CSV file loaded at startup. Finite, shrinking set. | ~30 lines + config file |

**Total estimated transformation code: ~1500-1800 lines**, plus ~500 lines of HTTP routing, middleware, and configuration. A complete implementation in Go would be approximately **2000-2500 lines of application code** (excluding tests).

---

## Proposed Architecture

### Single Service or Two?

**Decision: Single service.**

Simpler alternative considered: splitting into search+master-data (read-only, stateless) and booking+notifications (stateful booking flow). Rejected because:

- 13 endpoints is too few to justify two services. The operational cost of two deployments, two configs, two health checks, two log streams exceeds the architectural benefit.
- The shared infrastructure (ID mapping tables, 12go HTTP client, API key resolution) would need to be duplicated or extracted into a shared library -- adding complexity without benefit.
- A single Go binary serving 13 routes is a trivially small service. There is no scaling argument: every request hits 12go regardless, so the proxy is never the bottleneck.

### Layer Count (request to 12go call)

**Three layers. No more.**

```
HTTP Handler (route-specific) -> Transformer (request/response shaping) -> 12go Client (HTTP calls)
```

- **Handler**: Parses the inbound HTTP request, validates, calls the transformer, writes the HTTP response. One function per endpoint.
- **Transformer**: Contains the business logic -- ID mapping, response reshaping, booking schema parsing. One file per endpoint or group. Pure functions where possible.
- **12go Client**: A thin HTTP client wrapper that knows 12go's URL patterns, adds the API key, handles errors consistently. One struct with a method per 12go endpoint.

No MediatR. No pipeline behaviors. No DI containers. No service locators. Go functions calling Go functions.

### State Management

| State | Storage | Justification |
|---|---|---|
| ID mapping tables (stations, operators, classes) | In-memory, loaded at startup | Static data. ~5MB. Refreshed every 6 hours or on signal. No external store needed. |
| Checkout key mapping (GetItinerary -> CreateBooking) | In-memory cache (Go `sync.Map` or `groupcache`) with 3hr TTL | Short-lived, small (~1KB per active checkout). Single instance handles this fine. If multiple instances needed, use Redis -- but start without it. |
| Legacy booking ID mapping | In-memory, loaded at startup from config file | Static, finite, shrinking. Will be empty within months. |
| API key mapping (clientId -> 12go key) | In-memory, loaded from config | Small, static. Reload on config change. |

**No database.** No DynamoDB. No PostgreSQL. No Redis (initially). The service is stateless enough that a single instance with in-memory state is correct for the expected load. If horizontal scaling is needed later, only the checkout key mapping needs external storage (Redis), and that is a single-line change from `sync.Map` to a Redis client.

### Decision Log

| Decision | Simpler alternative considered | Why chosen / rejected |
|---|---|---|
| Single service | Two services (search vs booking) | 13 endpoints too few to split. Shared infrastructure (ID maps, client) argues for co-location. |
| In-memory state | No state (re-fetch checkout on CreateBooking) | Re-fetching checkout would add latency and an extra 12go call per booking. Cache is simpler. |
| Go standard library + Chi router | Framework (Gin, Echo, Fiber) | Chi adds minimal routing ergonomics (path params, middleware chaining) without framework lock-in. Could also use stdlib only. |
| Config files for ID mappings | Database or API call for mappings | Mappings are static. A JSON file is simpler than any database. Export once from Fuji DynamoDB. |
| No message broker | Kafka for webhook forwarding | Webhook is synchronous: receive from 12go, transform, POST to client. No async queue needed. If delivery fails, return error to 12go (which will retry). |
| Flat project structure | Domain-driven or hexagonal | 13 endpoints do not warrant architectural patterns designed for 100+ entity systems. Flat is honest. |
| No ORM / no database | SQLite for checkout cache | In-memory cache is sufficient. Adding a database for a 3hr TTL cache of 1KB blobs is over-engineering. |

---

## Project Structure

```
b2b-proxy/
  cmd/
    server/
      main.go                    # Entry point: load config, start HTTP server
  internal/
    config/
      config.go                  # Config loading (env vars, config files)
    server/
      server.go                  # HTTP server setup, middleware registration
      routes.go                  # All 13 route registrations in one place
    middleware/
      headers.go                 # Travelier-Version, correlation-id, experiment propagation
      auth.go                    # API key validation (client -> proxy)
      logging.go                 # Request/response logging with correlation
    handler/
      search.go                  # GET /v1/{client_id}/itineraries
      get_itinerary.go           # GET /{client_id}/itineraries/{id}
      create_booking.go          # POST /{client_id}/bookings
      confirm_booking.go         # POST /{client_id}/bookings/{id}/confirm
      seat_lock.go               # POST /{client_id}/bookings/lock_seats
      get_booking_details.go     # GET /{client_id}/bookings/{id}
      get_ticket.go              # GET /{client_id}/bookings/{id}/ticket
      cancel_booking.go          # POST /{client_id}/bookings/{id}/cancel
      incomplete_results.go      # GET /{client_id}/incomplete_results/{id}
      stations.go                # GET /v1/{client_id}/stations
      operators.go               # GET /v1/{client_id}/operating_carriers
      pois.go                    # GET /v1/{client_id}/pois
      webhook.go                 # POST /v1/notifications/onetwogo
    transform/
      search.go                  # 12go search response -> client search response
      itinerary.go               # 12go trip+cart+checkout -> client pre-booking schema
      booking.go                 # Client booking request -> 12go reserve request
      booking_details.go         # 12go booking details -> client booking details
      cancel.go                  # 12go refund options/response -> client cancel response
      notification.go            # 12go webhook payload -> client notification format
      money.go                   # Price format conversion (decimal -> string, fxcode -> currency)
      duration.go                # Duration conversions (minutes -> ISO 8601)
      cancellation_policy.go     # Build cancellation policy array from 12go fields
    schema/
      parser.go                  # Checkout response dynamic key parser
      assembler.go               # Reserve request dynamic key assembler
      cache.go                   # In-memory cache for checkout key mappings (cart_id -> key_map)
    mapping/
      loader.go                  # Load mapping files at startup
      station.go                 # Bidirectional station ID mapping (Fuji CMS <-> 12go int)
      operator.go                # Operator ID mapping
      seat_class.go              # Seat class ID mapping
      vehicle.go                 # Vehicle ID construction
      booking_id.go              # Legacy booking ID -> 12go bid mapping
    client/
      twelgo.go                  # 12go HTTP client: methods for all 11 12go endpoints
      errors.go                  # 12go error response parsing and classification
      auth.go                    # API key injection (?k=<key>)
    model/
      client_api.go              # Client-facing request/response types (the contract)
      twelgo_api.go              # 12go API request/response types
      itinerary_id.go            # SearchItineraryId encode/decode
  mappings/
    stations.json                # Fuji CMS ID <-> 12go station ID
    operators.json               # Fuji CMS ID <-> 12go operator ID
    seat_classes.json            # Seat class mappings
    booking_ids.json             # Legacy TC booking ID -> 12go bid (transitional)
    api_keys.json                # client_id -> 12go API key
  Dockerfile                     # Multi-stage build: compile Go, copy binary to scratch/alpine
  go.mod
  go.sum
```

**File count: ~35 Go files.** Each handler file is 50-150 lines. Each transform file is 100-400 lines. The 12go client is ~300 lines. Total: ~2000-2500 lines of Go.

**Key structural decisions:**
- `handler/` has one file per endpoint. No abstractions, no interfaces, no generics. Each handler is a standalone function that reads the request, calls the appropriate transform+client functions, and writes the response.
- `transform/` is pure logic. No HTTP, no I/O. Takes 12go types + mapping tables, returns client types. Trivially unit-testable.
- `client/` is the only place that makes outbound HTTP calls. One method per 12go endpoint. Handles auth, timeout, error parsing.
- `mapping/` loads static data once. No database queries, no API calls. Just `json.Unmarshal` from files.
- `schema/` isolates the booking schema complexity (the hardest part of the system) into two files: parse and assemble.

---

## Security

### Webhook Authentication (Key Finding #10)

The current system has zero authentication on 12go webhook notifications. This is a known vulnerability. Starting from clean slate:

**Evaluation of options:**

| Option | Feasibility | Security | Complexity |
|---|---|---|---|
| **HMAC signature verification** | Requires 12go to sign payloads with a shared secret and send signature in header. If 12go supports it: best option. If not: requires 12go-side development. | Strong -- proves payload integrity and sender identity. | Low once implemented. |
| **IP allowlist** | 12go's infrastructure sends from known IP ranges. Can be enforced at proxy or load balancer level. | Medium -- IPs can be spoofed in theory, but sufficient for webhooks. Protects against casual attackers and accidental exposure. | Very low. One config entry. |
| **mTLS** | Mutual TLS with 12go presenting a client certificate. | Very strong. | High -- certificate management, rotation, 12go infrastructure changes. Overkill for webhooks. |
| **Shared secret in header** | 12go sends a pre-shared API key in a header (e.g., `X-Webhook-Secret`). Proxy validates. | Medium -- no payload integrity, but proves sender has the secret. | Very low. |
| **No authentication** (current) | No changes needed. | None. Anyone who knows the URL can trigger booking status refresh cycles. | Zero. |

**Recommended approach: IP allowlist + shared secret header.**

- **IP allowlist** at the load balancer or proxy level. 12go's infrastructure sends from a known set of IPs. This is the first line of defense and requires zero 12go-side code changes.
- **Shared secret in header** as a second factor. Configure a random secret in both 12go's webhook subscriber table (which already has an API key field per subscriber) and in the proxy's config. Validate on every webhook request.
- **HMAC signature verification** as a future upgrade if/when 12go adds signing support to their webhook system.

This layered approach provides adequate security with minimal implementation effort and no dependency on 12go-side development.

### API Key Propagation

```
Client -> [x-api-key header] -> API Gateway -> Proxy -> [?k=<12go_api_key>] -> 12go
```

- **Client to proxy**: API Gateway validates the client's `x-api-key` (existing behavior, no change).
- **Proxy to 12go**: Proxy looks up the 12go API key for the authenticated client from its config map (`clientId -> 12goApiKey`), appends as `?k=<key>` query parameter.
- **Client identity resolution**: The `client_id` path parameter identifies the client. The proxy maps this to the correct 12go API key.

The proxy never exposes 12go API keys to clients. The mapping is server-side only.

### New Attack Surface

The proxy introduces a new network hop. Attack surface changes:

| Risk | Mitigation |
|---|---|
| Proxy itself becomes a target | Standard hardening: no debug endpoints in prod, rate limiting, TLS termination at load balancer. |
| 12go API keys stored in proxy config | Encrypt at rest, restrict file permissions, use environment variables or secrets manager. |
| Proxy logging may capture sensitive data | Redact API keys, booking tokens, and PII from logs. Log correlation IDs and status codes only. |
| SSRF via manipulated station IDs | Validate all client-provided IDs against the mapping table before constructing 12go URLs. Reject unknown IDs. |

---

## What This Design Ignores

### Team Learning Curve (Team-First Developer's concern)
- This design recommends Go. The development team has .NET expertise, not Go.
- A production version would need to account for: Go training time (1-2 weeks for an experienced developer), tooling setup, CI/CD pipeline for Go, code review practices for Go.
- **Mitigating factor**: The codebase is ~2500 lines with no complex patterns. AI-assisted development (Claude Code) is highly effective for Go.

### Infrastructure Operational Burden (Platform Engineer's concern)
- This design assumes the Go binary is deployed as a single Docker container on 12go's EC2 infrastructure.
- A production version would need: health check endpoint, readiness probe, graceful shutdown, log aggregation (Datadog integration), deployment pipeline, environment configuration (dev/staging/preprod/prod), blue-green or canary deployment strategy.
- **Missing**: How the mapping files are distributed and updated. A production system might need an admin endpoint to refresh mappings without restart.

### Event Correlation for ClickHouse (Data Flow Architect's concern)
- This design emits no events. It is a synchronous proxy.
- A production version would need to: emit structured events for search, checkout, booking, and cancellation to ClickHouse (or Kafka for ClickHouse consumption). These events enable per-client performance dashboards.
- **Addition needed**: A lightweight event emission layer -- either structured log lines that are parsed by Datadog/ClickHouse, or direct Kafka messages.

### Replaceability when F3 is decomposed (Disposable Architecture's concern)
- This design creates a standalone service that must be analyzed, understood, and potentially migrated when F3 is refactored.
- A production version should: keep the codebase small enough that re-implementing in any language is a 2-week effort, maintain an OpenAPI spec as the canonical contract, avoid accumulated business logic that is hard to extract.
- **The design's small size is its best defense against lock-in.** 2500 lines of Go can be rewritten in PHP, TypeScript, or the next language in 1-2 weeks.

---

## Unconventional Idea: OpenAPI-First Code Generation

**Considered and partially recommended.**

Since both the client-facing API contract and the 12go API are well-defined HTTP APIs, an OpenAPI-first approach could generate:
- Client-facing request/response types from the existing Travelier Connect API OpenAPI spec
- 12go API client code from their API documentation
- Server stubs for all 13 endpoints

This would reduce the hand-written code to **only the transformation logic** -- the pure functions that bridge between the two generated type systems.

**Tools**: `oapi-codegen` (Go), which generates server interfaces + types from OpenAPI specs.

**Why partially**: The 12go API does not have a published OpenAPI spec. The client-facing API has OpenAPI definitions in the denali/etna repos, but they may not be complete. Code generation is only as good as the spec. For 13 endpoints, hand-writing the types is fast enough that incomplete specs may not justify the tooling investment.

**Recommendation**: Use `oapi-codegen` for the client-facing types if a complete OpenAPI spec exists. Hand-write the 12go client types from the API surface documentation. The transformation layer is always hand-written.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

- **Simplicity**: 2500 lines. One binary. No databases. No message brokers. No framework. A developer can read the entire codebase in an afternoon.
- **Correctness**: Three clean layers (handler/transform/client) make it easy to verify that each transformation preserves the contract. Pure transformation functions are trivially unit-testable.
- **Deployment speed**: Docker build -> push -> deploy. No dependencies except the Go binary itself. Cold start <50ms.
- **Debuggability**: A request enters, makes 1-3 12go calls, transforms, returns. No async pipelines, no event chains, no cache layers. When something goes wrong, the call stack is 3-4 frames deep.
- **AI-assisted development**: Simple patterns, small files, well-defined interfaces between layers. Ideal for Claude Code to implement endpoint by endpoint.

### Sacrifices

- **Team familiarity**: Go is not the team's language. The ramp-up cost is real but bounded by the codebase's simplicity.
- **Organizational alignment**: 12go uses PHP. A PHP implementation would be operationally simpler to integrate into their infrastructure and maintenance workflows.
- **Event correlation**: No built-in event emission. Must be added for ClickHouse dashboards.
- **Horizontal scaling of checkout cache**: In-memory checkout key mapping limits to a single instance or requires sticky sessions. For the expected load, this is fine. For higher scale, add Redis.
- **F3 co-location**: This is a separate service. When F3 is refactored, the proxy must be analyzed independently. The counter-argument: 2500 lines is small enough to rewrite in any language in 1-2 weeks.
