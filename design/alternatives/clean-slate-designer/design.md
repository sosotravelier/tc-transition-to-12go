# Clean Slate Design

## The Irreducible Problem

Strip away every inherited decision -- DynamoDB, MediatR, Supply-Integration framework, Kafka, multi-supplier abstractions, cache pipelines, experiment executors -- and what remains is this:

**13 HTTP endpoints must accept requests in the Travelier Connect API contract and produce responses by calling 12go's 11 HTTP endpoints, translating identifiers and data shapes in both directions.**

The system is a stateless HTTP proxy with data transformation. It has:

- **Inbound surface**: 13 endpoints with fixed URL paths, headers (`Travelier-Version`, `x-correlation-id`, `x-api-experiment`), request shapes, and response shapes (money as string amounts, specific pricing structure, specific segment/itinerary/vehicle nesting)
- **Outbound surface**: 12go's 11 REST endpoints with API key auth via `?k=<key>`
- **Translation gap**: Different ID spaces (Fuji CMS 8-char strings vs 12go integers), different data shapes (flat trips+travel_options vs nested itineraries+segments+vehicles), different money formats (`{value, fxcode}` vs `{amount, currency}`), dynamic booking schema fields with trip-specific key names
- **One piece of state**: Booking schema field-name mappings must survive between GetItinerary and CreateBooking calls (the checkout schema contains dynamic keys like `selected_seats_TH013r...` that must be preserved for the reserve call)

That is the entire problem. Everything else in the current system is either multi-supplier abstraction (eliminated), caching infrastructure (eliminated), or operational concerns (monitoring, events -- important but not architectural).

---

## API Contract Analysis

### Operation Types

Analyzing the 13 endpoints by what they actually do:

| Type | Endpoints | Nature |
|------|-----------|--------|
| **Read-only proxy** (transform request, call 12go, transform response) | Search, GetBookingDetails, GetTicket, CancelBooking (fetch refund options phase), Stations, Operators, POIs | 7 endpoints |
| **Stateful booking flow** (multi-step with cross-request state) | GetItinerary (3 calls: trip details + add to cart + checkout schema), CreateBooking (reserve + get details), ConfirmBooking (confirm + get details) | 3 endpoints |
| **Write proxy** (transform request, call 12go, transform response) | CancelBooking (execute refund phase) | 1 endpoint (combined with read above) |
| **Async polling** | IncompleteResults | 1 endpoint |
| **Webhook receiver + transformer** | Booking Notifications | 1 endpoint |
| **Pending/stub** | SeatLock (12go endpoint being developed) | 1 endpoint |

**Key insight**: Only 3 endpoints require cross-request state (the booking flow: GetItinerary -> CreateBooking -> ConfirmBooking). The rest are pure request-response proxies.

### Non-Trivial Transformations

| Transformation | Complexity | Where it applies |
|---|---|---|
| **Station ID mapping** (Fuji CMS `ILTLVTLV` <-> 12go integer `1234`) | Bidirectional lookup table, ~thousands of entries. Every search request and response, every booking response, every segment. | Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, Stations |
| **Operator ID mapping** (Fuji CMS <-> 12go integer) | Same pattern as stations, smaller table. | Search, GetItinerary, Operators |
| **Seat class ID mapping** (Fuji CMS <-> 12go integer) | Same pattern, uses external SDK currently. Smaller table. | Search, GetItinerary |
| **Vehicle ID construction** (operator + vehicle type concatenation) | Deterministic construction, not a lookup. | Search, GetItinerary |
| **POI ID mapping** (Fuji CMS <-> 12go province ID) | Same pattern as stations. Used for POI-based search. | Search, POIs |
| **Search response restructuring** (12go flat `trips[]` + `travel_options[]` -> TC nested `itineraries[]` + `segments[]` + `vehicles[]`) | The most complex single transformation. Must denormalize 12go's trip structure into TC's three-array reference model. | Search, GetItinerary |
| **Money format conversion** (12go `{value: decimal, fxcode: string}` -> TC `{amount: "string", currency: "string"}`) | Trivial per-field, but applied everywhere. Must preserve string formatting. | All pricing fields |
| **Booking schema parsing** (12go dynamic `selected_seats_{cartId}` keys -> normalized field names -> stored mapping -> reconstructed keys for reserve) | The most complex stateful transformation. Dynamic key pattern matching, cross-request caching of field name mappings. ~1200 lines in current system. | GetItinerary, CreateBooking |
| **Itinerary ID encoding** (composite ID containing trip details, possibly Caesar-cipher encrypted) | Must produce IDs that GetItinerary can decode back to 12go trip parameters. | Search (produce), GetItinerary (consume) |
| **Booking ID mapping** (TC encrypted/short IDs <-> 12go `bid`) | For new bookings: use 12go bid directly. For legacy: static lookup table. | CreateBooking, ConfirmBooking, GetBookingDetails, GetTicket, CancelBooking, Notifications |
| **Notification format transformation** (12go `{bid, type, stamp, new_data, previous_data}` -> TC notification format) | Shape transformation + booking ID translation. | Notifications |
| **Cancellation policy formatting** (12go `cancellation` code + `cancellation_message` + `full_refund_until` -> TC `cancellation_policies[]` with ISO 8601 durations and penalty objects) | Moderate complexity. | Search, GetItinerary |
| **API key resolution** (client_id in URL path -> 12go API key as `?k=<key>`) | Config lookup per client. | All endpoints |

### Required State

| State | Lifetime | Why |
|---|---|---|
| **Booking schema field-name mapping** (dynamic keys from checkout -> needed at reserve time) | Minutes to hours (between GetItinerary and CreateBooking calls) | 12go's checkout response has trip-specific dynamic keys (`selected_seats_TH013r...`) that must be replayed exactly in the reserve request. Cannot be re-derived without re-calling checkout. |
| **Incomplete results** (async booking results) | Minutes (polling window, ~15 min TTL) | When booking/confirm takes too long, client polls for result. Needs to store the eventual response. |
| **ID mapping tables** (station, operator, POI, seat class) | Long-lived, loaded at startup, refreshed periodically | ~Thousands of entries. Read-only during request processing. |
| **API key mapping** (client_id -> 12go API key) | Long-lived configuration | Small table, tens of entries. |
| **Legacy booking ID mapping** (old TC booking ID -> 12go bid) | Transition period only, static table | One-time load, read-only. Shrinks to zero as old bookings expire. |

**Key insight**: The only truly stateful piece is the booking schema field-name mapping. Everything else is either configuration (loaded at startup) or a short-lived polling cache.

### Error Surface

| 12go Error | TC Client Expectation | Translation needed |
|---|---|---|
| 400 with `ErrorResponse.fields` | Validation error with field-level details | Reverse-translate supplier field names back to TC field names |
| 400 with "Trip is no longer available" | Product not found / availability changed | Map to appropriate HTTP status (404 or specific error) |
| 401 | Auth error (should never happen if keys are correct) | 500 or passthrough |
| 404 | Booking/trip not found | Passthrough as 404 |
| 422 with `reason_code: "bad_trip_details"` | Booking ID not found | Map to 404 |
| 500+ | Server error | 502 Bad Gateway |
| Timeout | Supplier timeout | 504 Gateway Timeout or trigger IncompleteResults (202) flow |
| `recheck[]` non-empty in search | Partial results | 206 Partial Content |

---

## Language Evaluation (First Principles)

The problem is: receive HTTP request, transform JSON, make HTTP request(s) to 12go, transform JSON response, return HTTP response. Evaluate each language purely on fitness for this workload.

| Criterion | Go | TypeScript (Node) | PHP/Symfony | .NET (C#) |
|---|---|---|---|---|
| **HTTP server simplicity** | Excellent. `net/http` stdlib is production-grade. Zero framework needed for simple routing. | Good. Express/Fastify are mature and minimal. | Good. Symfony HttpKernel is mature but heavier setup. | Good. ASP.NET Core minimal APIs are concise. More ceremony than Go. |
| **HTTP client quality** | Excellent. `net/http` client is simple, connection pooling built-in. | Good. `fetch` / `undici` are solid. Connection management is less transparent. | Good. Symfony HttpClient or Guzzle are mature. | Good. `HttpClient` with `IHttpClientFactory` is well-designed but verbose. |
| **JSON transform ergonomics** | Moderate. `encoding/json` works but struct tag mapping is verbose for complex transformations. No built-in partial/dynamic JSON ergonomics. The booking schema parser's dynamic key handling would be awkward. | Excellent. JSON is native. Dynamic key iteration, partial parsing, spread operators -- all natural. The booking schema's dynamic field patterns are trivially handled with object iteration. | Good. PHP arrays are naturally JSON-like. `json_decode` produces associative arrays. Dynamic key handling is natural. | Good. `System.Text.Json` is fast but rigid. Dynamic JSON requires `JsonElement` or `JsonNode`. `[JsonExtensionData]` exists but is clunky for the booking schema pattern. |
| **Type safety for ID mappings** | Good. Structs with named types prevent mixing station IDs with operator IDs. No generics needed. | Moderate. TypeScript types are compile-time only. Runtime mistakes possible. Branded types help but are awkward. | Weak. No compile-time type safety for ID spaces. Runtime errors only. | Excellent. Strong typing, newtype pattern with `readonly record struct`. Best type safety of the four. |
| **Concurrency model for multi-call endpoints** | Excellent. Goroutines for GetItinerary's 3 parallel calls are trivial (`go` + `errgroup`). | Good. `Promise.all()` for parallel calls is natural. Single-threaded event loop is fine for I/O-bound proxy work. | Moderate. Symfony's async HTTP client works for parallel calls but PHP's request-per-process model means no shared in-memory state between requests. ID mapping tables must be loaded per-request or cached externally. | Good. `Task.WhenAll()` for parallel calls. Async/await is mature. |
| **Startup/memory for ID mapping tables** | Excellent. Load mapping tables into memory at startup. They persist across requests. Low memory overhead for hash maps. | Good. Same approach works. V8 hash maps are efficient. | Poor for this pattern. PHP reloads per request (unless using Swoole/RoadRunner, which changes the deployment model significantly). Mapping tables must go in Redis/shared memory or be loaded per-request. With Symfony's standard model, loading thousands of mapping entries per request adds latency. | Good. Same approach works. ConcurrentDictionary is efficient. |
| **Deployment simplicity** | Excellent. Single static binary. No runtime dependencies. Docker image is ~10MB. | Good. Node.js runtime needed. Docker image ~100MB. | Moderate. PHP-FPM + Nginx or Swoole. More moving parts. Docker image ~200MB. | Moderate. .NET runtime needed. Docker image ~100-200MB. |
| **AI-assisted development** | Excellent. Go's simplicity means AI generates correct code more often. Less framework magic to get wrong. | Good. AI handles TypeScript well. Framework ecosystem is fragmented (Express vs Fastify vs Hono) which can confuse. | Good. AI handles PHP/Symfony well. Symfony conventions are well-known. | Good. AI handles C# well. ASP.NET Core patterns are well-established. |
| **Maintenance by solo developer** | Excellent. Go's simplicity, `gofmt`, no framework churn, explicit error handling. Easy to read 6 months later. | Moderate. npm ecosystem churn, runtime version management, type definitions can rot. | Good within Symfony. Framework is stable. PHP ecosystem is mature. | Good. .NET is stable. But solution/project structure tends toward over-engineering. |

### Language Recommendation

**Go** is the best fit for this specific problem from first principles.

The core argument: this is an I/O-bound HTTP proxy where the hardest parts are (a) loading mapping tables into memory and keeping them there across requests, (b) making parallel HTTP calls for multi-step endpoints, and (c) transforming JSON between two known schemas. Go excels at all three. Its HTTP stdlib is production-grade, goroutines make parallel calls trivial, and in-memory maps persist across requests with zero infrastructure.

PHP/Symfony is the runner-up given the "one system" vision with 12go's PHP stack, but the per-request memory model is a genuine disadvantage for a service that needs thousands of ID mappings in memory. This can be solved with Swoole/RoadRunner (persistent workers), but that changes PHP's deployment model significantly.

TypeScript would be the best choice if the booking schema parsing were the dominant concern (JSON manipulation is most natural in JS/TS), but it is only one of 13 endpoints.

.NET is a fine choice but brings more ceremony than needed for what is fundamentally a thin proxy layer.

**The one weakness of Go for this problem** is the booking schema parser's dynamic JSON key handling. Go's `encoding/json` requires either pre-defined structs or manual `map[string]interface{}` traversal. This is solvable (use `json.RawMessage` for the checkout response and iterate the map) but less ergonomic than TypeScript or PHP. However, this complexity exists in exactly one endpoint (GetItinerary/CreateBooking) and does not justify choosing a different language for the other 12.

---

## Irreducible Complexity Analysis

| Complexity | Why it cannot be eliminated | Best-known solution pattern | Estimated effort |
|---|---|---|---|
| **Station ID mapping** (Fuji CMS <-> 12go integer) | Clients send/receive Fuji CMS IDs. 12go uses integers. Every search, booking, and master data endpoint needs this. | Bidirectional hash map loaded at startup from a static export (CSV/JSON) of the Fuji DynamoDB mapping table. Refreshed on a timer (hourly). | Small: load a JSON file, build two maps. |
| **Operator ID mapping** | Same reason as stations, different entity. | Same pattern: bidirectional hash map from static export. | Small. |
| **POI ID mapping** | Clients use Fuji POI IDs for province-based search. 12go uses province integers. | Same pattern. | Small. |
| **Seat class ID mapping** | Search responses include seat class IDs in Fuji format. 12go returns integer class IDs. | Same pattern, but may require the Fuji mapping SDK data to be exported. | Small-medium: need to extract the mapping data. |
| **Search response restructuring** | 12go returns `trips[]` with embedded `travel_options[]` and reference dictionaries (`stations{}`, `operators{}`, `classes{}`). TC contract requires `itineraries[]` + `segments[]` + `vehicles[]` with cross-references by ID. | Pure function: `transform12goSearchToTCSearch(12goResponse, idMaps) -> TCSearchResponse`. Hardest part is building the segment/vehicle/itinerary reference graph. ~200-300 lines of transformation code. | Medium: careful mapping, good test coverage needed. |
| **Money format conversion** | 12go uses `{value: decimal?, fxcode: string}`. TC uses `{amount: "string", currency: "string"}`. | Helper function: `convertPrice(12goPrice) -> TCPrice`. Applied everywhere. 10 lines. | Trivial per-field, but must be applied consistently. |
| **Booking schema dynamic key parsing** | 12go's `/checkout/{cartId}` response has keys like `selected_seats_{cartId}`, `passenger[0][baggage_{cartId}]` that embed a trip-specific identifier. These exact keys must be replayed in the `/reserve` POST body. The internal TC booking schema normalizes these to abstract names. | Parse checkout response keys with pattern matching (StartsWith/regex). Build a `map[normalizedName]actualSupplierKey`. Store this map in a short-lived cache (keyed by cart ID). On reserve, look up the map and reconstruct the supplier keys. ~300-400 lines. | Medium-high: the single most complex transformation. Port the existing pattern-matching logic carefully. |
| **Booking schema to reserve request assembly** | Client submits passenger data in TC format. Must be reassembled into 12go's flat bracket-notation JSON (`passenger[0][first_name]`, `contact[email]`, etc.) using the stored field-name mapping. | Build flat JSON object from TC booking request + stored mapping. ~150 lines. | Medium. |
| **Itinerary ID encoding/decoding** | Search produces an ID that GetItinerary must decode back to 12go trip parameters (trip ID, departure datetime, seats). | Encode trip parameters into a URL-safe composite string (base64 of JSON, or delimited format). Decode on GetItinerary. Must be backward-compatible with existing client-stored IDs during transition. | Small-medium. |
| **API key resolution** (client_id -> 12go API key) | Clients authenticate via gateway with their own API key. Proxy must resolve to the correct 12go API key for outbound calls. | Config map: `client_id -> 12go_api_key`. Loaded from env/config file at startup. | Trivial. |
| **Webhook notification transformation** | 12go sends `{bid, type, stamp, new_data, previous_data}`. Clients expect TC notification format with `booking_id` in TC's ID space. | Transform function + booking ID lookup (for legacy bookings). Forward HTTP POST to client's webhook URL. | Small-medium. |
| **Incomplete results (async polling)** | CreateBooking/ConfirmBooking may timeout. Client polls for result. | In-memory map with TTL: `incomplete_id -> result`. Background goroutine completes the booking call and stores result. Expire after 15 minutes. | Small-medium. |
| **Correlation header propagation** | `x-correlation-id`, `x-api-experiment`, `Travelier-Version` must be forwarded and returned. | Middleware: extract from inbound request, attach to outbound 12go calls, include in response. | Trivial. |
| **206 Partial Content for recheck** | When 12go search returns non-empty `recheck[]`, response should be 206 instead of 200. | Check `recheck` field in 12go response, set status code accordingly. | Trivial. |

**Total estimated transformation code**: ~1500-2000 lines of Go (excluding tests, HTTP boilerplate, and configuration). This is a small service.

---

## Proposed Architecture

### Single Service or Two?

**Decision: Single service.**

Considered alternative: Split into (a) search + master data service (stateless, read-only) and (b) booking flow service (stateful, writes). Rejected because:

1. Both services need the same ID mapping tables (station, operator, POI, seat class)
2. Both call the same 12go API with the same authentication
3. The total endpoint count is 13 -- this does not justify two deployment units, two Docker images, two health checks, two sets of configuration
4. Solo developer building and maintaining: one service = one deployment = one thing to debug at 2am

### Layer Count (request to 12go call)

**Three layers**:

1. **HTTP handler** (route matching, request parsing, response writing, correlation headers)
2. **Endpoint logic** (orchestrates 12go calls, manages state like booking schema mapping)
3. **12go client** (HTTP calls to 12go with API key injection, error mapping)

With a shared **transformer** package for all data shape conversions and a **mapper** package for ID lookups.

Considered alternative: Two layers (handler calls 12go client directly with inline transformation). Rejected because the search and GetItinerary transformations are complex enough to warrant separation from HTTP concerns.

Considered alternative: Four+ layers (separate service layer, repository layer, domain layer). Rejected -- this is a proxy, not a domain application. There is no business logic beyond data transformation.

### State Management

| State | Storage | Justification |
|---|---|---|
| ID mapping tables (station, operator, POI, seat class) | In-memory hash maps, loaded at startup from JSON files, refreshed on timer | Read-only, thousands of entries, needed on every request. In-memory is the only option that does not add latency. |
| API key mapping (client_id -> 12go key) | In-memory map from config/env | Tiny, static, config-level. |
| Booking schema field-name mapping | In-memory map with TTL (15-30 min), keyed by cart ID | Short-lived, needed only between GetItinerary and CreateBooking (typically seconds to minutes). In-memory with TTL is sufficient for a single-instance deployment. For multi-instance: use Redis or accept that GetItinerary and CreateBooking must hit the same instance (sticky sessions or re-fetch checkout on miss). |
| Incomplete results | In-memory map with TTL (15 min) | Same rationale as booking schema mapping. Short-lived polling cache. |
| Legacy booking ID mapping | In-memory map loaded from static file | One-time load, shrinks to zero over time. |

**For single-instance deployment** (likely given solo developer, moderate traffic): all state is in-memory. No Redis, no DynamoDB, no database.

**If horizontal scaling is needed later**: Add Redis for booking schema mappings and incomplete results. The ID mapping tables remain in-memory (read-only, loaded identically on every instance). This is a simple upgrade, not an architecture change.

### Decision Log

| Decision | Simpler alternative considered | Why chosen / rejected |
|---|---|---|
| Single service | Two services (search + booking) | Chosen: single. 13 endpoints sharing the same ID maps and 12go client do not justify two deployment units. |
| Three layers (handler / logic / client) | Two layers (handler + client) | Chosen: three. Search and GetItinerary transformations are too complex to inline in HTTP handlers. |
| In-memory state | Redis / DynamoDB | Chosen: in-memory. Single-instance deployment. Add Redis later if needed. |
| Go | TypeScript, PHP, .NET | Chosen: Go. Best fit for I/O-bound proxy with in-memory maps and parallel HTTP calls. See language evaluation. |
| Static mapping files | DynamoDB / API calls to Fuji | Chosen: static files. Export Fuji mappings once, load at startup. No dependency on Fuji infrastructure. Refresh via periodic re-export or config update. |
| No framework (stdlib + chi router) | Gin, Echo, Fiber | Chosen: stdlib + chi. Chi adds only routing on top of `net/http`. No framework magic, no dependency risk. |

---

## Project Structure

```
b2b-proxy/
  cmd/
    server/
      main.go                    # Entry point: load config, load mappings, start HTTP server

  internal/
    config/
      config.go                  # Configuration structs (env vars, file paths)

    middleware/
      correlation.go             # Extract/propagate x-correlation-id, x-api-experiment, Travelier-Version
      logging.go                 # Request/response logging
      recovery.go                # Panic recovery

    mapper/
      station.go                 # Bidirectional station ID mapping (Fuji CMS <-> 12go int)
      operator.go                # Bidirectional operator ID mapping
      poi.go                     # Bidirectional POI ID mapping
      seatclass.go               # Bidirectional seat class ID mapping
      vehicle.go                 # Vehicle ID construction (operator + type)
      loader.go                  # Load all mapping tables from JSON files at startup
      mapper_test.go

    twelvego/                    # 12go HTTP client
      client.go                  # Base HTTP client with API key injection, error handling
      search.go                  # GET /search/{from}/{to}/{date}
      trip.go                    # GET /trip/{tripId}/{datetime}
      cart.go                    # POST /cart/... and GET /cart/{cartId}
      checkout.go                # GET /checkout/{cartId}
      reserve.go                 # POST /reserve/{bookingId}
      confirm.go                 # POST /confirm/{bookingId}
      booking.go                 # GET /booking/{bookingId}
      refund.go                  # GET /booking/{id}/refund-options, POST /booking/{id}/refund
      models.go                  # 12go request/response types
      errors.go                  # 12go error response parsing and mapping
      client_test.go

    transform/                   # Data shape transformations (pure functions)
      search.go                  # 12go search response -> TC SearchResponse
      itinerary.go               # 12go trip+cart+checkout -> TC PreBookingSchema
      booking.go                 # TC booking request -> 12go reserve request (with schema mapping)
      booking_details.go         # 12go booking details -> TC booking response
      cancel.go                  # 12go refund options/result -> TC cancel response
      ticket.go                  # 12go booking details -> TC ticket response
      notification.go            # 12go webhook payload -> TC notification format
      money.go                   # Price format conversion helpers
      schema_parser.go           # Checkout dynamic key parser (the complex one)
      itinerary_id.go            # Encode/decode composite itinerary IDs
      transform_test.go          # Extensive tests for all transformations
      schema_parser_test.go      # Dedicated tests for booking schema parsing

    handler/                     # HTTP handlers (one file per endpoint or group)
      search.go                  # GET /v1/{client_id}/itineraries
      get_itinerary.go           # GET /v1/{client_id}/itineraries/{id}
      create_booking.go          # POST /v1/{client_id}/bookings
      confirm_booking.go         # POST /v1/{client_id}/bookings/{id}/confirm
      seat_lock.go               # POST /v1/{client_id}/bookings/lock_seats
      get_booking_details.go     # GET /v1/{client_id}/bookings/{id}
      get_ticket.go              # GET /v1/{client_id}/bookings/{id}/ticket
      cancel_booking.go          # POST /v1/{client_id}/bookings/{id}/cancel
      incomplete_results.go      # GET /v1/{client_id}/incomplete_results/{id}
      stations.go                # GET /v1/{client_id}/stations
      operators.go               # GET /v1/{client_id}/operating_carriers
      pois.go                    # GET /v1/{client_id}/pois
      notification.go            # POST /v1/notifications/{integration}
      router.go                  # Wire all routes with chi router

    apikey/
      resolver.go                # client_id -> 12go API key mapping

    store/
      schema_cache.go            # In-memory TTL cache for booking schema field-name mappings
      incomplete_cache.go        # In-memory TTL cache for incomplete results

  data/                          # Static mapping data (loaded at startup)
    stations.json                # Exported Fuji station mappings {fuji_cms_id: 12go_station_id, ...}
    operators.json
    pois.json
    seatclasses.json
    legacy_bookings.json         # Old TC booking ID -> 12go bid (transition period)
    api_keys.json                # client_id -> 12go API key (or from env vars)

  Dockerfile
  go.mod
  go.sum
```

### File count: ~35 Go files + tests + data files

This is deliberately small. A solo developer can hold the entire codebase in their head.

### Where each endpoint lives

| # | Endpoint | Handler | Transform | 12go Client |
|---|----------|---------|-----------|-------------|
| 1 | Search | handler/search.go | transform/search.go | twelvego/search.go |
| 2 | GetItinerary | handler/get_itinerary.go | transform/itinerary.go + transform/schema_parser.go | twelvego/trip.go + cart.go + checkout.go |
| 3 | CreateBooking | handler/create_booking.go | transform/booking.go | twelvego/reserve.go + booking.go |
| 4 | ConfirmBooking | handler/confirm_booking.go | transform/booking_details.go | twelvego/confirm.go + booking.go |
| 5 | SeatLock | handler/seat_lock.go | (pending 12go endpoint) | (pending) |
| 6 | GetBookingDetails | handler/get_booking_details.go | transform/booking_details.go | twelvego/booking.go |
| 7 | GetTicket | handler/get_ticket.go | transform/ticket.go | twelvego/booking.go |
| 8 | CancelBooking | handler/cancel_booking.go | transform/cancel.go | twelvego/refund.go |
| 9 | IncompleteResults | handler/incomplete_results.go | (returns cached result) | (none -- reads from cache) |
| 10 | Stations | handler/stations.go | (serve pre-built mapping file or S3 redirect) | (none -- serves static data) |
| 11 | Operators | handler/operators.go | (same pattern as stations) | (none) |
| 12 | POIs | handler/pois.go | (same pattern as stations) | (none) |
| 13 | Notifications | handler/notification.go | transform/notification.go | (none -- receives, transforms, forwards) |

---

## Security

### Webhook Authentication (Key Finding #10)

The current system has zero authentication on 12go webhook notifications. This is a known vulnerability: anyone who discovers the webhook URL can send fake booking status notifications, triggering booking record updates and potentially incorrect client notifications.

**Evaluation of options from first principles:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **HMAC signature verification** | Industry standard for webhooks (Stripe, GitHub, Slack all use it). Cryptographically verifiable. No network dependency. | Requires 12go to implement signing on their side. If 12go does not support it, we cannot use it. | **Best option if 12go cooperates.** Request that 12go add HMAC-SHA256 signing to webhook payloads with a shared secret per subscriber. |
| **IP allowlist** | Simple to implement. No changes needed on 12go side. | Fragile: 12go's IP addresses can change. Breaks if 12go adds load balancers or CDN. Requires ongoing maintenance. | **Acceptable as defense-in-depth, not as sole authentication.** |
| **mTLS (mutual TLS)** | Strongest authentication. Both sides verified. | Complex to set up and maintain. Certificate rotation is operational burden. Overkill for a webhook endpoint. | **Rejected: disproportionate complexity.** |
| **Shared secret in header** (API key) | Simple. 12go already has an API key per subscriber in their webhook table. Could send it as a header. | Weaker than HMAC (key is transmitted in every request, not derived). But practical. | **Good fallback if HMAC is not feasible.** Request 12go to send the subscriber's API key as a header; validate it on receipt. |
| **Webhook URL with embedded token** (e.g., `/notifications?token=<secret>`) | Zero changes on 12go side if they already store the URL. Token is part of the URL. | Token in URL can leak in logs, referrer headers. Less secure than header-based. | **Acceptable as quick fix, not long-term.** |

**Recommended approach:**

1. **Primary**: Request 12go implement HMAC-SHA256 signing on webhook payloads. Validate signature on receipt. Shared secret stored per subscriber.
2. **Fallback** (if HMAC is not available): Validate that 12go sends the subscriber's API key in a request header. This is already partially supported by 12go's webhook table which stores an API key per subscriber.
3. **Defense-in-depth**: IP allowlist of 12go's known egress IPs at the network/gateway level. Not sole authentication.

### API Key Propagation

```
Client --> [x-api-key header] --> API Gateway --> [validates] --> Proxy Service --> [?k=<12go-key>] --> 12go
```

- **Client -> Gateway**: Client sends `x-api-key` header. Gateway validates it (existing behavior, no change).
- **Gateway -> Proxy**: Gateway forwards request. Proxy extracts `client_id` from URL path.
- **Proxy -> 12go**: Proxy looks up `client_id -> 12go_api_key` in its config map. Appends `?k=<12go_api_key>` to every outbound 12go request.

The proxy service itself does not validate client API keys -- the gateway does that. The proxy trusts that if a request reached it, the gateway has already authenticated the client. This matches the current architecture.

**12go API key storage**: The mapping of `client_id -> 12go_api_key` should be stored in environment variables or a secrets manager (not in the JSON data files). In Go: read from env vars at startup, e.g., `APIKEY_BOOKAWAY=abc123`.

### New Attack Surface

The proxy introduces one new attack surface compared to direct 12go access:

- **The proxy itself becomes a target.** If compromised, an attacker gets access to all client-12go API key mappings. Mitigation: minimal dependencies, no unnecessary ports, no admin endpoints, run as non-root in Docker, limit network egress to 12go's API host only.
- **The booking schema cache could be poisoned** if an attacker can call GetItinerary with crafted data. Mitigation: cache keys are derived from cart IDs returned by 12go (not from client input), so this requires a compromised 12go API to exploit.

---

## What This Design Ignores

This design optimizes purely for the simplest correct proxy implementation. It explicitly does not address:

### Team Learning Curve (Team-First Developer's concern)
- Go is not the team's language. The team has 12 years of .NET experience.
- Counter-argument from this design's perspective: the service is ~35 files, ~2000 lines of application code. Go's syntax can be learned in days. The hard part is understanding the 12go API and the transformation logic, not the language.
- **What production would need**: A Go onboarding plan, or acceptance that this is Soso's service maintained by Soso (with AI assistance).

### Infrastructure Operational Burden (Platform Engineer's concern)
- This design assumes a single instance. No discussion of load balancing, auto-scaling, health checks, graceful shutdown, metrics exposition.
- **What production would need**: Prometheus `/metrics` endpoint, structured logging (JSON), health check endpoint, graceful shutdown handler, Docker health check, deployment manifests (ECS task definition or K8s manifest).

### Event Correlation for ClickHouse (Data Flow Architect's concern)
- This design emits no events. No Kafka, no ClickHouse writes, no per-client performance metrics.
- **What production would need**: Structured request/response logging that can be ingested by the data pipeline. At minimum: log every search (client_id, departure, arrival, result count, latency), every booking (client_id, booking_id, status), every error. These logs can be shipped to ClickHouse via Datadog or a log aggregator.

### Replaceability When F3 Is Decomposed (Disposable Architecture's concern)
- This design does not consider what happens when F3 is eventually refactored. The Go proxy would need to be either absorbed into the refactored system or maintained alongside it.
- **What production would need**: Clear API contracts (OpenAPI spec for both inbound and outbound), so the proxy can be replaced endpoint-by-endpoint when F3's decomposition happens.

### "One System" Vision (Organizational constraint)
- This design explicitly creates a separate service, which works against the stated organizational goal of "one cohesive system."
- Counter-argument: the proxy's entire purpose is to be a temporary translation layer. It should be designed to be deleted, not to be permanent. Its simplicity is what makes it deletable.

---

## Unconventional Idea: OpenAPI-First Code Generation

Considered and partially adopted:

The Travelier Connect API has a defined OpenAPI spec. The 12go API surface is well-documented. An unconventional approach would be to:

1. Write a complete OpenAPI 3.1 spec for the TC B2B API (this may already exist from the `shared-booking-service-open-api` repo)
2. Write an OpenAPI spec for the 12go API (from the documented endpoints)
3. Use `oapi-codegen` (Go) to generate request/response types and routing boilerplate from both specs
4. Write only the transformation logic by hand

This approach was **partially adopted** in the design: the project structure separates types (in `twelvego/models.go` and implicitly in handler response types) from transformation logic. Full code generation was not adopted because:

- The 12go booking schema response is too dynamic for OpenAPI to describe accurately (dynamic keys with embedded cart IDs)
- The transformation logic is the actual work -- generating types saves time but does not reduce the core complexity
- For a solo developer, writing 35 files by hand with AI assistance is likely faster than configuring and debugging code generators

However, writing the TC API OpenAPI spec first (before any code) is strongly recommended. It serves as the contract test: every handler must produce responses that validate against the spec.

---

## What This Design Optimizes For (and What It Sacrifices)

### Optimizes For

- **Simplicity**: ~35 files, ~2000 lines of application code, one binary, one deployment
- **Correctness**: Every transformation is a pure function that can be unit-tested in isolation. The transformation layer is the largest part of the codebase and gets the most test coverage.
- **Speed of implementation**: A solo developer with AI assistance can build this in 4-6 weeks (13 endpoints at ~2 endpoints per week, plus testing and deployment)
- **Debuggability**: Three layers, no framework magic, explicit error handling. When something breaks, `grep` the logs and read the handler.
- **Deletability**: When 12go eventually exposes a B2B API that matches the TC contract directly, this service can be deleted with zero collateral damage

### Sacrifices

- **Team familiarity**: Go is new to the team. Risk: if Soso leaves, someone must learn Go or rewrite
- **Organizational alignment**: Creates a separate service when "one system" is the stated goal
- **Event emission**: No built-in Kafka/ClickHouse integration. Relies on log-based observability
- **Multi-instance state**: Booking schema cache and incomplete results cache are in-memory only. Horizontal scaling requires adding Redis
- **PHP ecosystem alignment**: Does not contribute to 12go's PHP ecosystem. A PHP proxy would be easier for 12go veterans to maintain
