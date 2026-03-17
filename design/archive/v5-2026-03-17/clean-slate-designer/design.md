# Clean Slate Design

## The Irreducible Problem

Strip away DynamoDB, MediatR, the Supply-Integration framework, the multi-supplier abstraction, the cache pipeline, the experiment executor, Kafka, and every other inherited decision. What remains is this:

**A stateless HTTP translation layer between two fixed API surfaces.**

Inbound: 13 client-facing endpoints with fixed URL paths, header conventions, request/response shapes, and money formats. These cannot change.

Outbound: 11 12go HTTP API endpoints (search, trip details, cart operations, checkout schema, reserve, confirm, booking details, refund options, refund). This is the only data source.

The proxy must:
1. Accept requests in the client contract format (Fuji CMS IDs, string money amounts, specific header conventions)
2. Translate identifiers (station IDs, operator IDs, seat class IDs, vehicle IDs, POI IDs, booking IDs)
3. Call the appropriate 12go endpoint(s) with their expected parameters and authentication
4. Transform the 12go response into the client contract format (denormalized segments/vehicles/itineraries, pricing structure, cancellation policies)
5. Return the response with correct status codes (200, 206 for partial results) and headers

That is the entire problem. Everything else is optional.

---

## API Contract Analysis

### Operation Types

Analyzing the 13 endpoints from first principles, there are **four distinct operation types**:

**Type 1: Read-only search proxy (2 endpoints)**
- `GET /v1/{client_id}/itineraries` (Search) -- 1 call to 12go, heavy response transformation
- `GET /{client_id}/itineraries/{id}` (GetItinerary) -- 3 calls to 12go (trip details + add to cart + checkout schema), complex booking schema parsing

These are the most complex endpoints. Search has the heaviest transformation (12go trips/travel_options flat structure to client's itineraries/segments/vehicles denormalized structure). GetItinerary must parse the dynamic checkout schema and store field name mappings for later use.

**Type 2: Stateful booking flow (3 endpoints)**
- `POST /{client_id}/bookings` (CreateBooking) -- 2 calls (reserve + get booking details)
- `POST /{client_id}/bookings/{id}/confirm` (ConfirmBooking) -- 2 calls (confirm + get booking details)
- `POST /{client_id}/bookings/lock_seats` (SeatLock) -- pending 12go endpoint, no call yet

These require reconstructing the 12go reserve body from the client's booking request, which means looking up the cached field name mappings from GetItinerary.

**Type 3: Post-booking queries and actions (4 endpoints)**
- `GET /{client_id}/bookings/{id}` (GetBookingDetails) -- 1 call to 12go
- `GET /{client_id}/bookings/{id}/ticket` (GetTicket) -- 1 call to 12go (extracts ticket_url)
- `POST /{client_id}/bookings/{id}/cancel` (CancelBooking) -- 2 calls (refund options + refund)
- `GET /{client_id}/incomplete_results/{id}` (IncompleteResults) -- polling endpoint

These are relatively simple transformations. The main complexity is booking ID translation (client booking ID to 12go bid).

**Type 4: Master data delivery (3 endpoints)**
- `GET /v1/{client_id}/stations` -- serves pre-signed S3 URL or station list
- `GET /v1/{client_id}/operating_carriers` -- serves operator list
- `GET /v1/{client_id}/pois` -- province-based search

These are fundamentally different from the rest: they serve cached/static data, not proxied 12go calls. The data source is the station/operator/POI mapping table itself.

**Type 5: Webhook receiver (1 endpoint)**
- `POST /v1/notifications/{integration}` -- receives booking status changes from 12go, transforms format, forwards to client

This has a different data flow direction: 12go pushes to us, we transform and push to the client.

### Non-Trivial Transformations

| Transformation | Complexity | Where it applies |
|---|---|---|
| **Station ID mapping** (Fuji CMS ID <-> 12go integer) | Bidirectional lookup on every search request/response, booking response | Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, master data |
| **Operator ID mapping** (Fuji CMS ID <-> 12go integer) | Same pattern as stations | Search, GetItinerary, GetBookingDetails |
| **Seat class ID mapping** | Translation via master data mapping SDK | Search, GetItinerary |
| **Vehicle ID construction** | Concatenation of operator + vehicle type | Search |
| **Search response restructuring** | 12go flat trips/travel_options -> client's itineraries/segments/vehicles denormalized format | Search |
| **Pricing normalization** | 12go `Price { value, fxcode }` -> client `Money { currency, amount: string }` with gross/net/taxes structure | All endpoints returning prices |
| **Booking schema parsing** | 12go's dynamic bracket-notation checkout fields -> normalized schema + cached field name map | GetItinerary |
| **Reserve request assembly** | Client booking request + cached field name map -> 12go bracket-notation reserve body | CreateBooking |
| **Itinerary ID encoding/decoding** | Composite SearchItineraryId with URL encoding | Search (encode), GetItinerary (decode) |
| **Booking ID translation** | Client booking ID (encrypted or short) <-> 12go bid | All post-booking endpoints, notifications |
| **Cancellation policy formatting** | 12go cancellation code/message -> client ISO 8601 duration-based penalty array | Search, GetItinerary |
| **Confirmation type mapping** | 12go confirmation_time -> Instant vs Pending | Search, GetItinerary |
| **Ticket type mapping** | 12go ticket_type string -> client enum | Search, GetItinerary |
| **Date/time format conversion** | 12go custom formats -> client ISO formats | All endpoints |
| **206 partial content** | 12go recheck array non-empty -> HTTP 206 with partial results | Search |
| **Webhook payload transformation** | 12go `{ bid, type, stamp, new_data, previous_data }` -> client format with translated booking_id | Notifications |

### Required State

The proxy is **almost** stateless, but not entirely. State that must persist across HTTP requests:

| State | Lifetime | Why |
|---|---|---|
| **Booking schema field name map** | From GetItinerary until CreateBooking (minutes to hours) | The dynamic field names (e.g., `selected_seats_TH013r...`) from the checkout response must be stored so the reserve request can reconstruct the bracket-notation keys. This is the bridge between two separate HTTP requests. |
| **Station/operator/POI ID mapping table** | Long-lived (days to weeks, refreshed periodically) | ~10K+ station mappings, loaded at startup or on first use. Read-only after load. |
| **Seat class mapping** | Long-lived, cached | Operator-specific class ID translations. |
| **Booking ID mapping (legacy)** | Transition period only | Old TC booking IDs -> 12go bids for post-booking operations on pre-migration bookings. |
| **API key mapping** | Long-lived | Client API key -> 12go API key translation. |

The **booking schema field name map** is the only state that is truly cross-request and cannot be derived from 12go at reserve time (because you would need to call checkout again, which requires a valid cart, which may have expired). In the current system, this is cached in-memory (supply-integration, 3-hour TTL) or in DynamoDB (Denali). For a single-instance service, in-memory with TTL is sufficient. For multi-instance, a shared cache (Redis) is needed.

Everything else is either static configuration loaded at startup or can be re-fetched.

### Error Surface

| 12go Error | Client Contract Response | Notes |
|---|---|---|
| 400 Bad Request (field errors) | 400 with field-level error messages translated from supplier field names to client field names | Field names must be reverse-mapped using the cached name-to-supplier-name dictionary |
| 401 Unauthorized | 401 | Authentication failure against 12go |
| 404 Not Found | 404 | Trip/booking not found |
| 422 with "Trip is no longer available" | 404 or specific availability error | Semantic translation needed |
| 405-499 (various) | Varies by endpoint | Some map to specific client error types |
| 500+ | 502 Bad Gateway (upstream failure) | Proxy convention: upstream errors become 502 |
| Timeout | 504 Gateway Timeout | |
| Recheck array non-empty | 206 Partial Content | Search-specific |

---

## Language Evaluation (First Principles)

Evaluating purely on fitness for this specific problem: an HTTP proxy that accepts requests in one format, calls an upstream HTTP API, transforms the response, and returns it in a different format.

| Language | HTTP server simplicity | HTTP client quality | JSON transform ergonomics | Type safety for mappings | Startup / cold path | Notes |
|---|---|---|---|---|---|---|
| **Go** | Excellent. `net/http` + stdlib or chi/echo. Single binary, no framework overhead. | Excellent. `net/http` client is production-grade. | **Weak.** No generics for JSON transforms until recently. `encoding/json` requires struct tags or manual map manipulation. Deeply nested JSON transforms are verbose. Dynamic JSON (booking schema) is painful. | Good for static types. Poor for dynamic/schema-less JSON. | Instant. No runtime warm-up. | Go excels at HTTP proxying and is the language of choice for API gateways. But the JSON transformation ergonomics are a significant weakness for this problem -- the booking schema parsing with dynamic keys and the search response restructuring involve heavy JSON manipulation that Go makes verbose. |
| **TypeScript** (Node.js, e.g. Fastify or Hono) | Excellent. Fastify/Hono are mature, minimal. | Good. `fetch` is native in Node 18+. `undici` for advanced use. | **Excellent.** JSON is native. Spread operators, destructuring, optional chaining make transforms concise. Dynamic key handling is trivial. | Moderate with strict TypeScript. Zod/io-ts for runtime validation. | Fast (seconds). | Best JSON transform ergonomics of any language. The booking schema dynamic field parsing that takes 400+ lines in C# could be ~80 lines in TypeScript. However, TypeScript's type safety for complex mappings requires discipline (Zod schemas, strict mode). Runtime type errors are possible. |
| **PHP/Symfony** | Good. Symfony HttpKernel is mature. | Good. Symfony HttpClient or Guzzle. | Good. PHP arrays are flexible for JSON manipulation. | Weak. PHP 8.3 has better typing but still weaker than Go/.NET. | Moderate. FPM model has per-request overhead. | PHP is the 12go platform language. Writing the proxy in PHP/Symfony means it could eventually be merged into F3 with minimal friction. The translation layer aligns with F3's existing patterns. However, PHP's per-request model (FPM) adds overhead vs. long-running processes, and in-memory caching (station ID maps) requires external cache (Redis/APCu). |
| **.NET** (ASP.NET Core Minimal APIs) | Good. Minimal APIs reduce ceremony. | Excellent. `HttpClient` + `IHttpClientFactory`. | Good. `System.Text.Json` is fast but verbose for dynamic JSON. `JsonElement` manipulation is clunky. Newtonsoft is more flexible but slower. | Excellent. Strongest type system of the four for complex domain mappings. | Moderate. ~1-2s startup. | The strongest type safety, but the JSON transform verbosity is a real cost for this problem. The existing codebase proves this: the booking schema parser alone is 1,180+ lines in the supply-integration project. Minimal APIs in .NET 8+ reduce the ceremony significantly, but JSON manipulation remains the weak point. |

### Language Recommendation: Go

Despite the JSON transform weakness, **Go** is the best fit for this specific problem, for these reasons:

1. **This is fundamentally an HTTP proxy.** Go is the language HTTP proxies are written in. The stdlib `net/http` is the foundation of Envoy, Traefik, Caddy, and every major API gateway. The HTTP server and client are best-in-class.

2. **Single binary deployment.** No runtime, no dependency management at deploy time. A single Docker image under 20MB. This matters for a service that runs on 12go's infrastructure.

3. **Performance characteristics match the problem.** The proxy is I/O-bound (waiting on 12go). Go's goroutine model handles concurrent upstream calls (GetItinerary makes 3 calls) naturally.

4. **The JSON weakness is manageable.** The transformations are well-defined and finite. There are 13 endpoints. Each has a known request/response shape on both sides. The booking schema dynamic field parsing is the hardest part, but it is one component, not the entire system. Using `encoding/json` with well-defined structs for the known parts and `json.RawMessage` / `map[string]interface{}` for the dynamic parts is workable. Libraries like `gjson`/`sjson` or `mapstructure` make the dynamic parts less painful.

5. **12go is considering Go for their future.** While this is not a deciding factor, it means Go expertise will exist in the broader organization.

6. **AI-assisted development neutralizes the learning curve.** The developer (Soso) is a .NET expert using Claude Code heavily. Go's simplicity (25 keywords, no inheritance, explicit error handling) makes it one of the most AI-friendly languages. Claude Code generates idiomatic Go with high accuracy.

**The runner-up is TypeScript** (specifically with Hono or Fastify). TypeScript has genuinely better JSON ergonomics, and for a solo developer using AI tools, it would also work well. The reason Go wins over TypeScript: the service will live for "a significant time" on 12go's infrastructure alongside PHP services. A Go binary is operationally simpler than a Node.js process (no `node_modules`, no `npm`, no `package-lock.json` drift, no memory management surprises under load).

**Why not PHP?** PHP would be the natural choice if the proxy were being built inside F3. As a standalone service, PHP/Symfony adds framework overhead, requires FPM process management, and makes in-memory caching (for the station ID map) harder. If the decision is to build inside F3, PHP is the only answer -- but that is a different design (monolith, not proxy).

**Why not .NET?** .NET would work. It has the best type safety and the team knows it. But for a thin HTTP proxy, .NET brings ceremony that Go does not need. The existing system proves this: ~340 projects to do what is fundamentally a 13-endpoint proxy. .NET's strength (rich type system, DI, middleware pipeline) becomes a weakness when the goal is simplicity.

---

## Irreducible Complexity Analysis

These are the pieces of complexity that exist in **any** correct implementation of this proxy, regardless of language, framework, or architecture.

| Complexity | Why it cannot be eliminated | Best-known solution pattern |
|---|---|---|
| **Station ID bidirectional mapping** | Clients send/receive Fuji CMS IDs (8-char alpha). 12go uses integer station_id. Every search, booking, and response needs translation. ~10K+ mappings. | In-memory hash map, loaded at startup from a static mapping file or 12go database query. Two maps: CMS->12go and 12go->CMS. Refresh daily or on signal. |
| **Operator ID bidirectional mapping** | Same as stations. Clients use Fuji operator CMS IDs, 12go uses integer operator_id. | Same pattern. Smaller dataset (~hundreds). |
| **Seat class ID mapping** | 12go class IDs differ from the standardized IDs clients expect. Per-operator mapping. | Lookup table per (operator_id, 12go_class_id) -> client_class_id. Can be in-memory. |
| **Vehicle ID construction** | Clients expect a vehicle ID that encodes operator + vehicle type. 12go returns these separately. | Deterministic function: vehicleID = f(operator_id, vehclass). No state needed. |
| **Search response restructuring** | 12go returns flat trips with travel_options. Client expects denormalized itineraries/segments/vehicles with cross-references by ID. | Pure function. Input: 12go search response. Output: client search response. ~200-300 lines of mapping code. |
| **Pricing normalization** | 12go: `{ value: decimal, fxcode: string }`. Client: `{ currency: string, amount: "string" }` with gross/net/taxes structure. Gross price types (Max/Min/Exact/Recommended). | Pure function per price field. Straightforward field rename + decimal-to-string conversion. |
| **Booking schema dynamic field parsing** | 12go `/checkout` returns dynamic bracket-notation keys embedding cart-specific IDs. Client expects a normalized schema. The dynamic keys must be remembered for the reserve call. | Parse response, extract dynamic keys by pattern matching (StartsWith/EndsWith/Contains), build normalized schema, store key mapping in cache with TTL. ~150-200 lines. |
| **Reserve request reconstruction** | Client sends a structured booking request. 12go expects flat bracket-notation JSON with the exact dynamic keys from the checkout. | Retrieve cached key mapping, reconstruct bracket-notation body. ~100 lines. |
| **Itinerary ID codec** | The SearchItineraryId is a composite encoding trip details. Must encode on search, decode on GetItinerary. | Deterministic encode/decode functions. ~30 lines. |
| **Booking ID translation (legacy)** | Pre-migration bookings have TC booking IDs (encrypted or short format). Post-booking operations need the 12go bid. | Static mapping table loaded at startup. For new bookings, use 12go bid directly. |
| **API key translation** | Client API key (in `x-api-key` header) -> 12go API key (in `?k=` query param). Per-client mapping. | Config map loaded at startup. ~10-20 entries. |
| **Header propagation** | `Travelier-Version`, `x-correlation-id`, `x-api-experiment`, `X-REQUEST-Id` must be forwarded and returned. | Middleware/interceptor that copies specified headers. ~20 lines. |
| **Error translation** | 12go HTTP errors -> client contract errors with correct status codes and field name reverse-mapping. | Per-endpoint error handler. Field name reverse-mapping uses the cached schema key mapping. |
| **Webhook format transformation** | 12go sends `{ bid, type, ... }`. Client expects TC format with translated booking_id. | Pure function. ~30 lines. |
| **Master data serving** | Stations/operators/POIs must be served in Fuji CMS ID format. Data comes from the mapping table. | Periodic export of mapping table to JSON. Serve via pre-signed URL or direct response. |
| **206 partial content** | When 12go's recheck array is non-empty, response must be 206 not 200. | Conditional status code. 1 line. |

**Total irreducible code estimate**: ~1,500-2,000 lines of Go (excluding tests), split roughly as:
- HTTP routing + middleware: ~200 lines
- 12go HTTP client: ~200 lines
- ID mapping infrastructure: ~150 lines
- Search transformer: ~300 lines
- Booking schema parser + reserve assembler: ~300 lines
- Other endpoint transformers: ~200 lines
- Pricing/money normalization: ~50 lines
- Error handling: ~100 lines
- Master data serving: ~100 lines
- Webhook handler: ~50 lines
- Configuration + startup: ~100 lines

---

## Proposed Architecture

### Single Service or Two?

**Decision: Single service.**

Simpler alternative considered: splitting into search+master-data and booking+post-booking. Rejected because:
- There are only 13 endpoints. A single service with 13 route handlers is not complex.
- The ID mapping tables are shared across all endpoints. Splitting means either duplicating them or adding a shared dependency.
- A single binary is simpler to deploy, monitor, and debug than two.
- The booking schema cache (field name map from GetItinerary used by CreateBooking) must be accessible to both the "search" and "booking" handlers. In a single service, this is just an in-memory map.

The only argument for splitting would be independent scaling, but search and booking are 1:1 coupled through 12go anyway (as RnD correctly noted in the Feb 25 meeting).

### Layer Count (request to 12go call)

**Three layers:**

```
HTTP Handler (route-specific)
  -> Transformer (request/response mapping, pure functions)
    -> 12go Client (HTTP calls with auth injection)
```

No MediatR. No pipeline behaviors. No middleware chain beyond global concerns (logging, correlation headers, panic recovery). No DI container -- Go uses explicit dependency passing.

A request flows:
1. **Router** dispatches to the correct handler by path + method
2. **Handler** validates request, calls transformer to build 12go request, calls 12go client, calls transformer to build client response
3. **Transformer** is a pure function: input shape -> output shape, using ID maps
4. **12go Client** adds auth (`?k=<key>`), makes HTTP call, returns response

That is it. There are no intermediate services, no message buses, no event publishers, no cache pipelines, no feature flags.

### State Management

| State | Storage | Justification |
|---|---|---|
| Station/operator/POI ID maps | In-memory (Go map), loaded at startup | Small dataset (~10K stations), read-only, fast lookup. Refresh periodically or on signal. |
| Seat class mapping | In-memory, loaded at startup | Small, per-operator. |
| Booking schema field name cache | In-memory (Go map with TTL) or Redis | For a single instance, in-memory with 3-hour TTL is sufficient. For multi-instance, use Redis. Start with in-memory. |
| API key mapping | In-memory, loaded from config | ~10-20 client entries. |
| Booking ID mapping (legacy) | In-memory, loaded from static file | One-time load of pre-migration booking ID -> 12go bid mapping. Static, never changes. |

**No database needed.** No DynamoDB, no PostgreSQL, no external cache (initially). If the service scales to multiple instances, the booking schema cache moves to Redis. Everything else is either static config or can be loaded independently per instance.

### Decision Log

| Decision | Simpler alternative considered | Why chosen/rejected |
|---|---|---|
| Single service | Two services (search + booking) | Single is simpler: 13 endpoints, shared ID maps, shared schema cache. No benefit to splitting. |
| Go | TypeScript (simpler JSON), PHP (F3 alignment) | Go: best HTTP proxy ergonomics, single binary, goroutine concurrency. See Language Evaluation. |
| 3 layers (handler/transformer/client) | 2 layers (handler directly calls 12go) | Transformers as pure functions are testable independently. Worth the minimal added structure. |
| In-memory state | Redis, DynamoDB | All state is either static config or short-lived cache. In-memory is sufficient for single instance. Add Redis only if scaling requires it. |
| Static mapping file for IDs | Database query on startup | A JSON/CSV file checked into the repo or loaded from S3 is simpler than connecting to Fuji's DynamoDB. The mapping is a one-time export from the existing system. Can be refreshed by redeploying or via config reload endpoint. |
| No DI container | Wire/fx/dig | Go convention: construct dependencies in main(), pass explicitly. 13 endpoints do not need a DI container. |
| No middleware pipeline | Chi/echo middleware chain | Global middleware for logging + correlation headers + panic recovery. No per-route middleware. 3 global middlewares, not a pipeline. |
| Synchronous proxy only | Async event emission (Kafka) | The core proxy problem is synchronous: client sends request, gets response. Events for ClickHouse/data team are a separate concern (see "What This Design Ignores"). |

---

## Security

### Webhook Authentication (Key Finding #10)

The current system has **zero authentication** on the 12go webhook endpoint. Any HTTP POST to `/v1/notifications/OneTwoGo` triggers a full booking status refresh cycle. This is a security vulnerability that must be fixed, not inherited.

**Evaluation of options from first principles:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **HMAC signature verification** | Industry standard (GitHub, Stripe, Shopify all use it). Cryptographically verifiable. Does not require network restrictions. | Requires 12go to implement signing on their side. Shared secret management needed. | **Best option if 12go will implement it.** |
| **IP allowlist** | Simple to implement. No changes needed on 12go side. | Fragile: 12go's IP addresses may change. Breaks in environments with proxies/NAT. Does not protect against compromised networks. | **Acceptable as a defense-in-depth layer, not as sole protection.** |
| **mTLS** | Strongest authentication. Mutual certificate verification. | Complex to set up and manage certificates. Overkill for a webhook between two known systems. 12go may not support it. | **Too complex for this use case.** |
| **Shared secret header** | Simple: 12go sends a secret in a custom header (e.g., `X-Webhook-Secret`), proxy validates it. Easy for 12go to implement. | Not cryptographically bound to the payload (replay attacks possible). But for a notification that just says "booking X changed," replay is low-risk. | **Good pragmatic option if HMAC is too complex for 12go.** |
| **Bearer token** | Standard auth pattern. | Same as shared secret header but with `Authorization: Bearer <token>`. | Equivalent to shared secret header. |

**Recommended approach (layered):**

1. **Primary: Shared secret header** -- Ask 12go to include a pre-shared secret in a custom header on webhook calls. The proxy validates this header before processing. This is the minimum viable security fix and is trivial for 12go to implement (one config value, one header addition).

2. **Secondary: IP allowlist** -- At the infrastructure level (API Gateway or security group), restrict the webhook endpoint to 12go's known IP ranges. This is defense-in-depth, not the primary mechanism.

3. **Future: HMAC signature** -- If 12go implements webhook signing (as many platforms do), upgrade to HMAC-SHA256 signature verification. This is the gold standard but requires 12go development effort.

### API Key Propagation

```
Client -> [x-api-key header] -> API Gateway -> Proxy -> [?k=12go_api_key] -> 12go
```

The proxy maintains a mapping table: `client_api_key -> 12go_api_key`. On each request:
1. API Gateway validates `x-api-key` (existing behavior, no change)
2. Proxy extracts `client_id` from URL path
3. Proxy looks up the corresponding 12go API key from its config
4. Proxy appends `?k=<12go_api_key>` to all outbound 12go calls

This mapping table is loaded from configuration (environment variables, config file, or fetched from a config endpoint at startup). It is small (~10-20 entries) and rarely changes.

### Attack Surface Analysis

The proxy introduces a new attack surface compared to direct 12go access:

| Surface | Risk | Mitigation |
|---|---|---|
| Proxy exposes 12go API keys in config | If proxy is compromised, 12go keys are exposed | Store keys in secrets manager (Datadog Secrets, AWS Secrets Manager, or 12go's env config). Do not log them. |
| Proxy becomes a single point of failure | If proxy is down, all B2B traffic stops | Health checks, auto-restart, minimal dependencies (no database to go down). |
| Webhook endpoint accepts unauthenticated traffic | Spoofed booking notifications | Fix with shared secret header + IP allowlist (see above). |
| Station ID mapping table is trusted | If the mapping file is tampered with, wrong stations are returned | Mapping file is read-only config. Validate at startup (count, spot-check known entries). |

---

## Project Structure

```
b2b-proxy/
  cmd/
    proxy/
      main.go                    # Entry point: load config, build dependencies, start server

  internal/
    config/
      config.go                  # Configuration loading (env vars, config file)

    server/
      server.go                  # HTTP server setup, global middleware
      routes.go                  # Route registration (all 13 endpoints)

    middleware/
      correlation.go             # x-correlation-id, x-api-experiment header propagation
      logging.go                 # Request/response logging
      recovery.go                # Panic recovery
      version.go                 # Travelier-Version header handling

    handler/                     # HTTP handlers (one file per endpoint or group)
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
      notifications.go           # POST /v1/notifications/{integration}

    transform/                   # Pure transformation functions (no I/O)
      search.go                  # 12go search response -> client search response
      search_test.go
      itinerary.go               # 12go trip+cart+schema -> client itinerary response
      itinerary_test.go
      booking.go                 # Client booking request -> 12go reserve body
      booking_test.go
      booking_details.go         # 12go booking details -> client format
      booking_details_test.go
      pricing.go                 # Price normalization (12go Price -> client Money)
      pricing_test.go
      cancellation.go            # Cancellation policy formatting
      cancellation_test.go
      notification.go            # 12go webhook -> client notification format
      notification_test.go
      schema/
        parser.go                # Booking schema dynamic field parsing
        parser_test.go
        assembler.go             # Reserve request bracket-notation assembly
        assembler_test.go

    twelvego/                    # 12go HTTP client
      client.go                  # HTTP client with auth injection (?k=<key>)
      types.go                   # 12go request/response types (Go structs)
      errors.go                  # 12go error response parsing

    mapping/                     # ID mapping infrastructure
      station.go                 # Station ID bidirectional map (CMS <-> 12go)
      operator.go                # Operator ID bidirectional map
      seatclass.go               # Seat class mapping
      vehicle.go                 # Vehicle ID construction
      poi.go                     # POI ID mapping
      booking_id.go              # Booking ID translation (legacy)
      loader.go                  # Load all mappings from files/config at startup

    cache/
      schema_cache.go            # In-memory TTL cache for booking schema field maps

    auth/
      apikey.go                  # Client API key -> 12go API key resolution
      webhook.go                 # Webhook authentication (shared secret validation)

  api/
    client_types.go              # Client-facing request/response types (Go structs)

  data/
    station_mapping.json         # Static mapping: Fuji CMS ID <-> 12go station ID
    operator_mapping.json        # Static mapping: Fuji CMS operator ID <-> 12go operator ID
    seatclass_mapping.json       # Static mapping: seat class translations
    booking_id_mapping.json      # Legacy booking ID -> 12go bid (transition period)
    api_keys.json                # Client API key -> 12go API key mapping (or from env/secrets)

  Dockerfile                     # Multi-stage build, ~15MB final image
  go.mod
  go.sum
  Makefile                       # build, test, lint, run targets
```

### File count estimate: ~40 Go files, ~2,000-2,500 lines of Go code (excluding tests), ~1,500 lines of tests.

### Key design principles in the structure:

1. **`handler/`** files are thin: validate request, call transform, call 12go client, call transform, return response. No business logic in handlers.

2. **`transform/`** files are pure functions with no I/O dependencies. They take 12go types and mapping tables as input and return client types. This makes them trivially testable.

3. **`twelvego/`** is a dumb HTTP client. It knows how to inject auth and parse errors. It does not transform data.

4. **`mapping/`** holds the ID translation tables. Loaded once at startup. Passed into handlers and transformers by reference.

5. **`data/`** contains static mapping files. These are the one-time exports from the existing Fuji DynamoDB tables. They can be updated by redeploying or via a config reload endpoint.

---

## What This Design Ignores

### Team learning curve (Team-First Developer's concern)

This design proposes Go for a team whose production experience is entirely in .NET. The mitigation (AI-assisted development, Go's simplicity) is stated but not deeply evaluated. A production version would need:
- A concrete Go onboarding plan
- Fallback strategy if Go adoption fails
- Decision criteria for when to abandon Go and fall back to .NET

### Infrastructure operational burden (Platform Engineer's concern)

This design says "single binary, simple to deploy" but does not address:
- How the service runs on 12go's EC2 infrastructure
- Service discovery and load balancing
- Health check endpoints and readiness probes
- Log aggregation (Datadog integration)
- Metric emission (request latency, error rates, 12go call durations)
- Configuration management (how are mapping files and API keys deployed?)
- Blue/green or canary deployment strategy
- Certificate management for HTTPS

A production version would need all of these, adding ~200-300 lines of observability and operational code.

### Event correlation for ClickHouse (Data Flow Architect's concern)

This design is a synchronous proxy. It does not emit events. The data team needs:
- Per-client search counts
- Per-client booking counts
- Conversion funnel metrics (search -> itinerary -> booking -> confirmation)
- Error rates by client and endpoint

A production version would need to either:
- Emit structured logs that are ingested into ClickHouse (simplest)
- Publish Kafka events for each operation (matches 12go's existing Kafka infrastructure)
- Or both

This adds ~100-200 lines of event emission code.

### Replaceability when F3 is decomposed (Disposable Architecture's concern)

This design is a standalone Go service. When F3 is eventually refactored (planned Q2+ 2026 planning phase), this service may need to be:
- Absorbed into the new F3
- Rewritten in whatever language F3 targets
- Kept as-is if F3 exposes the same B2B API natively

The design is deliberately thin (13 endpoints, ~2K lines) so that rewriting it is cheap. But the mapping tables and transformation logic are the intellectual property -- those need to be ported regardless of language. A production version should document the transformation rules in a language-agnostic format (e.g., as test fixtures with input/output pairs) so they can be ported to any language.

---

## Unconventional Idea: OpenAPI-First Code Generation

An approach this design considered but ultimately did not pursue:

**Idea**: Define both the client-facing API and the 12go API as OpenAPI 3.1 specs. Use code generation (oapi-codegen for Go, or openapi-generator) to generate both the server stubs and the client types. The developer writes only the transformation functions between the two generated type sets.

**Why it is attractive**:
- The client-facing API contract is fixed. An OpenAPI spec IS the contract.
- The 12go API is documented in the api-surface.md. It could be captured as an OpenAPI spec.
- Generated types eliminate hand-written struct definitions and serialization bugs.
- Contract changes are caught at generation time, not at runtime.

**Why it was not pursued**:
- The 12go booking schema response (`/checkout`) has dynamic keys that cannot be captured in a static OpenAPI spec. The `[JsonExtensionData]` pattern does not map cleanly to OpenAPI.
- The client-facing response shapes (e.g., search with denormalized itineraries/segments/vehicles) are complex enough that generated code may be harder to work with than hand-written structs.
- For 13 endpoints, the overhead of maintaining two OpenAPI specs and a code generation pipeline may exceed the overhead of just writing the types.

**Partial adoption**: Generate the client-facing server types from an OpenAPI spec (to guarantee contract compliance), but hand-write the 12go client types (to handle dynamic fields). This hybrid approach is worth considering.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for:
- **Simplicity**: 13 endpoints, ~40 files, ~2K lines of Go. A developer can read the entire codebase in an afternoon.
- **Correctness**: Transformers are pure functions. Test coverage is straightforward: input 12go response, assert client response matches expected output. The existing test fixtures (3 real checkout payloads in the Denali test suite) can be used directly.
- **Operational simplicity**: Single binary, no database, no message broker, no external cache (initially). Deploy a Docker container and it works.
- **Performance**: Go's HTTP performance is more than sufficient for a proxy. No framework overhead. In-memory ID maps mean lookups are nanoseconds, not network round-trips.
- **Maintainability**: Each endpoint is self-contained. Changing one endpoint does not affect others. The transformation logic is isolated from the HTTP plumbing.

### Sacrifices:
- **Team familiarity**: The team knows .NET, not Go. There is a real learning curve.
- **F3 alignment**: If the long-term goal is "one system" in PHP, a Go service is another technology to maintain.
- **Event emission**: This design does not emit events for the data team. That must be added.
- **Multi-instance state sharing**: The in-memory booking schema cache does not work across multiple instances. Redis must be added if the service scales beyond one instance.
- **Observability**: This design does not include metrics, tracing, or structured logging. Those must be added for production.
- **Rich type safety for dynamic JSON**: Go's JSON handling for the booking schema dynamic fields will be more verbose than TypeScript or even .NET. This is the concrete cost of choosing Go.
