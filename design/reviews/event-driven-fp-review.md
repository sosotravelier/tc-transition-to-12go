---
status: draft
last_updated: 2026-02-17
agent: V1-event-driven-fp-architect
---

# Architecture Review: Event-Driven / Functional Programming Perspective

## 1. Executive Summary

All three options model the booking pipeline as imperative, sequential procedure calls — none of them treat data flow, state transitions, or error propagation as first-class architectural concerns. Option C (Thin Gateway) comes closest to a functional ideal: data flows through a pipeline, state is carried in self-contained tokens rather than hidden in databases, and side effects are concentrated at the boundary. Option A is a competent but unimaginative consolidation of existing procedural code. Option B trades all architectural autonomy for the convenience of calling frontend3's internal services, inheriting their mutable-state-heavy, OOP-centric design — the worst outcome from an FP perspective. None of the three options model the booking lifecycle as an explicit state machine, none use Result types for error propagation, and none separate pure business logic from side effects at the architectural level. There is significant untapped potential in all three.

---

## 2. Per-Option Review

### 2.1 Option A: Trimmed .NET

#### Strengths (Event-Driven / FP Perspective)

- **Clear data pipeline for search**: The `SearchService.SearchAsync` method reads almost like a function pipeline — `ResolveRoutes |> SearchAsync |> ApplyMarkup |> ToSearchResponse`. This is the closest any option gets to showing pipeline composition, even if it's expressed as sequential `await` calls rather than composed functions.
- **Strong type system**: .NET 8 with nullable reference types, Mapperly source-generated mappers, and dedicated `IdTypes` (BookingId, ItineraryId, BookingToken) encode domain concepts into the type system. CaesarCypher for ID encryption is typed, not stringly-typed.
- **Explicit Kafka event schema**: The `booking.lifecycle` event schema with typed `eventType` enum and structured payload is a reasonable event model. The topic consolidation from 30+ to 5 shows good event hygiene.
- **Stateless recheck pass-through**: The recheck loop is correctly modeled as a stateless relay — no server-side session, no hidden mutable state. The gateway simply forwards 12go's signal.

#### Weaknesses (Event-Driven / FP Perspective)

- **SiFacade is a God Object in new clothes**: The current system's SiFacade "resolves integrationId, manages DynamoDB caching, applies pricing, checks credit line, publishes Kafka events, handles ID encryption" — six responsibilities. The proposed replacement (BookingService + PricingService + CreditLineProvider + KafkaPublisher + RedisStateStore) is better decomposed, but the orchestration still lives in imperative service methods that mix pure logic with side effects. `BookingService.CreateBooking()` will inevitably interleave HTTP calls, Redis reads, pricing math, validation, and Kafka publishes in a single method body.
- **No explicit state machine for booking lifecycle**: A booking transitions through states (token_created → seats_locked → reserved → confirmed → cancelled). This is a textbook state machine, but it's modeled as sequential API calls with implicit state transitions. There's no type-level guarantee that you can't confirm a booking that hasn't been reserved.
- **Side effects are not separated from pure logic**: Pricing markup is pure math. Contract translation is a pure function. ID encryption is a pure function. But all of these are called inside service methods that also do HTTP I/O, Redis reads, and Kafka publishes. The architecture makes no structural distinction between `f(x) -> y` (pure) and `f(x) -> IO y` (effectful).
- **Error handling via exceptions**: The error handling table maps exceptions to HTTP status codes. This is the standard .NET approach but it's the antithesis of functional error handling. A `TwelveGoTimeoutException` that propagates up the call stack is a hidden control flow path. Result types (`Result<SearchResponse, SearchError>`) would make error paths explicit and composable.
- **Redis as implicit shared state**: Booking tokens stored in Redis with 25-minute TTL create temporal coupling between GetItinerary and CreateBooking. If the Redis entry disappears (eviction, pod restart, TTL expiry), the booking flow fails silently. The state is hidden from the type system.

#### Scores

| Criterion | Score | Justification |
|-----------|:-----:|---------------|
| Event Flow Clarity | 3/5 | Sequence diagrams are detailed and honest. But the actual code will be procedural method calls, not a traceable event flow. Side effects (Redis, Kafka, credit line) are interleaved with pure logic. You can trace it on paper; you can't trace it in the type system. |
| Composability | 3/5 | The search pipeline (`ResolveRoutes → Search → ApplyMarkup → Map`) shows composability. But booking flow is hard-coded orchestration. Adding a new step (e.g., fraud check) means editing `BookingService.CreateBooking()` — not composing a new function into a pipeline. |
| State Management | 3/5 | Redis with TTLs is reasonable for ephemeral state. But booking lifecycle state transitions are implicit. No typed state model. The distinction between "booking token exists" and "booking is reserved" is encoded in Redis key presence, not in the type system. |
| Async Pattern Handling | 3/5 | Recheck is a clean pass-through. Incomplete results (async confirm) use polling with a Redis-backed token. Functional but not elegant — no explicit representation of "pending computation" or "deferred result." |
| Error Handling | 3/5 | Comprehensive error mapping table. Polly for resilience (retry, circuit breaker). But exception-based flow control hides error paths. No Result types. The `fail-open for search, fail-closed for booking` policy is sound but encoded in ad-hoc if/catch blocks, not in types. |
| Testability | 3/5 | Three-layer architecture allows mocking infrastructure. But testing BookingService requires mocking TwelveGoClient, Redis, CreditLineClient, KafkaPublisher, PricingService — five mocks minimum. Pure logic (pricing, mapping, validation) is not structurally separated for isolated testing. |
| Side Effect Management | 2/5 | The weakest aspect. Infrastructure layer encapsulates external calls, but service layer methods freely mix pure computation (markup math, ID decryption, validation) with effectful operations (HTTP, Redis, Kafka). No architectural boundary between the two. |
| Type Safety | 4/5 | Best type safety of all three options. .NET 8 nullable references, Mapperly source-gen mappers, typed IDs. Types document intent reasonably well. Loses a point because booking lifecycle states are not encoded in the type system. |

#### Improvement Suggestions

1. **Extract pure functions**: Create a `BookingPipeline` module containing only pure functions — `DecryptToken(string) -> BookingContext`, `ValidatePassengers(BookingContext, PassengerData) -> Result<ValidatedBooking, ValidationError>`, `CalculateMarkup(NetPrice, MarkupRules) -> SellPrice`. Test these without any mocks.
2. **Model booking state explicitly**: Define `BookingState` as a discriminated union: `TokenCreated | SeatsLocked | Reserved | Confirmed | Cancelled`. Each state carries only the data relevant to that state. State transitions become functions: `Reserve(TokenCreated) -> Result<Reserved, ReservationError>`.
3. **Use Result types for the booking pipeline**: Instead of exceptions, return `Result<T, BookingError>` from each pipeline step. Chain them with `Bind`/`Map` (railway-oriented programming). The error path becomes visible in the type signature.
4. **Separate effectful orchestration**: Use an "interpreter" pattern — the pipeline produces a description of what to do (a list of commands: CallTwelveGo, CheckCreditLine, PublishEvent), and a separate interpreter executes them. This makes the pipeline testable as a pure function.

---

### 2.2 Option B: PHP Native (Internal Bundle)

#### Strengths (Event-Driven / FP Perspective)

- **Eliminates the most infrastructure side effects**: No DynamoDB, no SI Framework abstraction, no inter-service HTTP. The bundle calls frontend3 services in-process, which eliminates an entire class of network side effects and failure modes. From a pure function perspective, an in-process function call is closer to a pure function call than an HTTP request.
- **Stateless booking token design**: The AES-256-GCM encrypted token approach (Section 7.2) is the most functionally pure state management of all options. State flows *through* the pipeline in the token itself rather than being stored in a side-effectful external store. This is closer to how FP languages handle state — passing it as an argument.
- **Symfony event listeners for cross-cutting concerns**: The middleware stack (RateLimitListener → ApiKeyAuthenticator → BusinessContextListener → Controller → ExceptionListener) is a composed pipeline of concerns. Each listener is a function from `(Request, Context) -> (Request, Context)`. This is the most pipeline-like cross-cutting implementation.
- **In-process access to truth**: Frontend3's MySQL/Redis is the source of truth for bookings. Instead of maintaining a separate cache (DynamoDB) that can drift from the truth, the bundle reads truth directly. No eventual consistency problems.

#### Weaknesses (Event-Driven / FP Perspective)

- **Inherits frontend3's mutable-state architecture**: This is the fundamental problem. Frontend3 is a large Symfony application (~968 PHP files) built with OOP patterns — service objects with mutable internal state, Doctrine entities backed by MySQL, CartHandler that mutates Redis, BookingProcessor with a complex internal state machine. By coupling to these services, we inherit their architectural characteristics. The PartnerApiBundle becomes a thin FP veneer over a deeply imperative, mutable-state core.
- **Opaque booking state machine**: `BookingProcessor::createBookingsAndSetIds()` → `BookingProcessor::reserveBookings()` → `BookingProcessor::confirmBooking()` — the booking lifecycle is managed by frontend3's internal state machine, which we cannot inspect, test, or reason about from our bundle. We call methods and hope they work. The state transitions are hidden inside a PHP class we don't control.
- **Tightest coupling of all options**: The bundle calls 10+ frontend3 services directly (SearchService, TripFinder, CartHandler, BookingProcessor, BookingManager, BookingFormManager, RefundFactory, StationManager, OperatorManager, IntegrationApiProxy, CurrencyRepository). Any internal API change breaks our code. This is the opposite of composability — it's dependency spaghetti.
- **PHP type system limitations**: PHP 8.3 has union types and enums, but lacks discriminated unions, pattern matching, immutable records (without readonly hacks), and true generics. The type system cannot express `Result<T, E>` ergonomically. Error handling will be exception-based by necessity. DTO mapping is runtime-verified, not compile-time-verified.
- **Side effects everywhere**: The adapter methods (SearchAdapter, BookingAdapter, etc.) call frontend3 services that internally execute MySQL queries, Redis operations, HTTP calls to integrations, and Memcached lookups. There's no separation between pure logic and side effects — the entire call chain is effectful, and we can't isolate the pure parts because they're inside frontend3.
- **"We don't own the pipeline"**: In Options A and C, we own the booking pipeline end-to-end and can refactor it. In Option B, the pipeline is frontend3's BookingProcessor. We can wrap it, but we can't compose it differently. If we want to add a fraud check between reserve and confirm, we need frontend3 to add it — or we add it outside the transaction boundary, which is fragile.

#### Scores

| Criterion | Score | Justification |
|-----------|:-----:|---------------|
| Event Flow Clarity | 2/5 | From the bundle's perspective, the flow is clear (Controller → Adapter → frontend3 service). But the actual execution flow dives into frontend3's internals — TripPoolRepository binary search, CartHandler Redis serialization, BookingProcessor multi-table MySQL transactions — which are opaque. You cannot trace a booking request end-to-end without understanding frontend3's codebase. |
| Composability | 2/5 | The adapters compose frontend3 service calls, but the composition is rigid. ItineraryAdapter calls TripFinder → CartHandler → BookingFormManager in a fixed sequence. You can't reorder, skip, or replace steps without modifying the adapter. The frontend3 services are not designed to be composed — they're designed to be called. |
| State Management | 3/5 | The stateless encrypted booking token is excellent — a genuine FP win. But the bundle relies on frontend3's internal state management (MySQL bookings, Redis carts, Memcached search cache), which is heavily mutable and implicit. The bundle doesn't control state transitions; frontend3 does. |
| Async Pattern Handling | 3/5 | Recheck is handled as client-driven polling with max retries and timeout. Adequate but not modeled as a state machine or an event stream. The 3-retry-with-2-second-interval approach is hard-coded, not configurable or composable. |
| Error Handling | 3/5 | The ExceptionListener provides clean mapping from frontend3 exceptions to client HTTP errors. Categorization is thoughtful (CartExpiredException → 410). But error handling is exception-based throughout. PHP doesn't support Result types ergonomically. Frontend3's internal errors propagate as exceptions we must catch and translate. |
| Testability | 2/5 | The bundle's adapters can be unit-tested by mocking frontend3 services. But: (a) the mocks must faithfully reproduce frontend3's behavior, which is complex (BookingProcessor state machine), (b) integration tests require booting the Symfony kernel with frontend3's full dependency tree, (c) the pricing golden file tests are a good idea but require extracting test data from the .NET system — a cross-language testing challenge. The pure logic we can test (pricing math, DTO transformation) is small relative to the total. |
| Side Effect Management | 2/5 | The bundle's adapter layer is a thin shell around deeply effectful frontend3 services. Every adapter method triggers MySQL queries, Redis operations, and potentially HTTP calls inside frontend3. There's no structural separation between pure computation and side effects. The bundle cannot isolate side effects because it doesn't own the implementation. |
| Type Safety | 2/5 | PHP 8.3 is better than PHP 7, but still lacks compile-time contract verification, discriminated unions, and expression-based error handling. DTOs in `Contract/Request/` and `Contract/Response/` help, but the mapping between frontend3's internal types and client types is verified at runtime, not build time. PHPStan helps but is not a substitute for a real type system. |

#### Improvement Suggestions

1. **Define explicit interfaces for frontend3 dependencies**: Instead of calling frontend3 services directly, define PHP interfaces (`SearchPort`, `BookingPort`, `CartPort`) that declare what we need. Implement them as adapters to frontend3 services. This creates a seam for testing and reduces coupling.
2. **Extract pure logic into value objects**: Pricing calculation, ID encryption, DTO mapping — make these pure static methods or readonly value object methods. Test them independently of any framework.
3. **Use the stateless token pattern more aggressively**: The booking token design is the best idea in this option. Extend it — carry more state in tokens, less in Redis. If PHP had better type support, you could encode the booking lifecycle state in the token type.
4. **Push for frontend3 to expose a service contract**: Instead of calling 10 internal services, negotiate a `PartnerBookingService` interface inside frontend3 that encapsulates the booking lifecycle. This would give us a single, stable dependency point instead of 10 fragile ones.

---

### 2.3 Option C: Thin Stateless API Gateway

#### Strengths (Event-Driven / FP Perspective)

- **Closest to a pure function pipeline**: Each endpoint follows `Validate → Transform → Call12go → Transform → Price → Return`. This is a linear function pipeline where each step has a clear input and output. The architecture naturally separates pure steps (Transform, Price, Validate) from effectful steps (Call12go, Redis). This is the best structural foundation for FP.
- **Self-contained tokens are functionally pure state**: The BookingToken design (Appendix A) is elegant. State flows through the pipeline as an immutable, encrypted value — not stored in a mutable external store. The token IS the state. This is how FP languages handle state: pass it as data, don't mutate it in place. Key rotation via key ID prefix shows maturity in the design.
- **Explicit state categorization**: The "State Summary" diagram (Section 5) cleanly categorizes what's stateless, what's token-based, and what's Redis-based. This is the kind of explicit state reasoning that FP demands. The architecture acknowledges exactly where purity breaks down (seat lock) and isolates it.
- **Best testability architecture**: Contract translation is pure data mapping — `TranslateSearchResponse(TwelveGoTrip[]) -> ClientItinerary[]` is a pure function. Pricing is pure math. Token encryption/decryption is a pure function. These can all be tested without mocking HTTP, databases, or message queues. The effectful shell (HTTP to 12go, Redis for seat lock) is thin.
- **Honest about its limitations**: Section 15 ("When This Option Breaks Down") and the "Creep Warning" show architectural self-awareness. The authors understand that a thin gateway can grow into a thick one, and they set explicit guardrails (~150 files, ~3 Redis data types). This discipline is more valuable than any pattern.
- **Async incomplete results via stateless tokens**: The polling pattern for async confirms uses encrypted tokens containing the bookingId. Each poll call is stateless — decrypt token, fetch from 12go, return status. No server-side session. This is the cleanest async pattern of all three options.
- **Minimal side effect surface**: No Kafka producer. No database. No background workers. Side effects are limited to: (1) HTTP calls to 12go, (2) Redis for seat lock and idempotency, (3) HTTP call to credit line service. This is the smallest side effect surface area by far.

#### Weaknesses (Event-Driven / FP Perspective)

- **Pricing makes the gateway impure**: The architecture claims to be a "translator with a price calculator," but the pricing engine is business logic — markup rules, exchange rate conversion, minimum margin floors, currency rounding. This is the kind of complex pure computation that should be composable and extensible, but it's described as "inline" (Section 7, Option A). At minimum, the pricing engine should be a separate, independently testable module with its own types and functions.
- **No event model at all**: Option C explicitly eliminates Kafka. This means: no booking lifecycle events for analytics, no event-driven communication, no audit trail, no event sourcing capability. From an event-driven architecture perspective, this is a step backward. The argument that "OTel replaces events" conflates observability (what happened for debugging) with business events (what happened for domain logic).
- **Error handling is still exception-based**: The error mapping tables (per endpoint) are detailed, but error propagation through the pipeline is not modeled. When `Call12go` fails, how does that error compose with `ApplyPricing`? With Result types, you'd short-circuit the pipeline. With exceptions, you rely on catch blocks at the controller level.
- **No explicit state machine for booking lifecycle**: Same problem as all options. The booking goes through states (token → locked → reserved → confirmed), but this is implicit in the API call sequence, not explicit in the type system. A client could theoretically call `ConfirmBooking` without calling `CreateBooking` — the architecture relies on 12go to reject this, not on our own state model.
- **Cart expiration creates a hidden temporal dependency**: The BookingToken carries a `cartId` that references a cart in 12go's Redis. If the cart expires before `CreateBooking` is called, the entire token is useless. This is a temporal side effect that breaks the "stateless" illusion. The token carries a reference to mutable external state (12go's cart), which makes it effectively stateful.
- **Idempotency via Redis is state in disguise**: The idempotency key store (24h TTL) with cached responses is a database by another name. It stores responses, has a TTL-based lifecycle, and affects application behavior. Calling this "minimal state" is accurate in degree but not in kind.

#### Scores

| Criterion | Score | Justification |
|-----------|:-----:|---------------|
| Event Flow Clarity | 4/5 | Clearest flow of all three. Each endpoint has a documented pipeline: `Validate → Transform → Call → Transform → Price → Return`. Side effects are explicitly identified and isolated. The State Summary diagram categorizes all state. Loses a point because the actual code-level flow is still described imperatively, not as a composed pipeline. |
| Composability | 3/5 | The linear pipeline pattern is inherently composable — in theory. In practice, each endpoint's pipeline is hard-coded. Adding a fraud check step means editing the endpoint handler, not composing a new function into the pipeline. The pricing engine is reusable across endpoints, which is good. But there's no pipeline abstraction that would let you declare `Search = Validate >> ResolveRoutes >> CallSearch >> ApplyMarkup >> Encrypt`. |
| State Management | 4/5 | Best of all three. Self-contained tokens carry state through the pipeline. Redis is used only for unavoidable cases (seat lock, idempotency). State categories are explicit. Loses a point for: (a) cart expiration creates hidden temporal coupling to 12go's mutable state, (b) booking lifecycle states are not modeled as explicit types. |
| Async Pattern Handling | 4/5 | Cleanest async implementation. Recheck is a stateless pass-through. Incomplete results use self-contained tokens for polling. Each poll is a fresh, stateless call. The backoff pattern (2s, 3s, 5s) is documented. Loses a point because the async pattern is not modeled as a first-class concept (e.g., `Deferred<BookingResult>` or a state machine). |
| Error Handling | 3/5 | Detailed per-endpoint error mapping. Idempotency prevents duplicate bookings (a form of error recovery). But still exception-based, not Result-type-based. Error propagation through the pipeline is not modeled explicitly. The "price mismatch → 409" pattern is good domain error modeling. |
| Testability | 4/5 | Best testability. Contract translation, pricing math, token encryption/decryption, validation — all pure functions testable without mocks. The effectful shell (HTTP client, Redis) is thin and mockable. The architecture's separation naturally creates a large body of pure, independently testable code. Loses a point because integration testing the full pipeline still requires HTTP mocking. |
| Side Effect Management | 3/5 | Best separation of all three. Pure steps (transform, price, validate) are structurally distinct from effectful steps (call 12go, Redis). But it's not enforced by the architecture — a developer could add a Redis call inside the pricing engine, and nothing in the architecture would prevent it. Needs an explicit boundary (e.g., ports and adapters, or an effect type). |
| Type Safety | 4/5 | Assuming .NET implementation (recommended): strong typing, source-gen mappers, typed IDs. The BookingToken specification (Appendix A) is well-typed with versioning. Loses a point because booking lifecycle states are not encoded in types, and the self-contained token approach means some state validation happens at runtime (decrypt and check expiry) rather than at compile time. |

#### Improvement Suggestions

1. **Define a pipeline abstraction**: Create a `Pipeline<TIn, TOut>` type that composes steps: `SearchPipeline = Validate >> ResolveRoutes >> CallSearch >> ApplyMarkup >> EncryptIds`. Each step is a function `Step<TIn, TOut>` that can be pure or effectful. This makes the pipeline composable and testable at the step level.
2. **Add a minimal event producer**: Eliminate 25 of the 30 Kafka topics, yes. But keep `booking.lifecycle` events. They're essential for audit trails, analytics, and future event-driven features. An event is not overhead — it's a first-class domain concept. A booking confirmation *is* an event.
3. **Model the token as a typed state machine**: Instead of a single `BookingToken` type, define `CheckoutToken` (cartId + prices) → `LockedToken` (adds seat selections) → `ReservedToken` (adds bookingId). Each state transition produces a new token type. The type system enforces that `CreateBooking` requires a `CheckoutToken` or `LockedToken`, not a `ReservedToken`.
4. **Use Result types throughout the pipeline**: `TranslateRequest(input) -> Result<TwelveGoRequest, ValidationError>`, `CallSearch(request) -> Result<TwelveGoResponse, UpstreamError>`, etc. Compose with `Bind`. Short-circuit on first error. The error path becomes visible, testable, and composable.

---

## 3. Comparison Matrix

| Criterion | Option A | Option B | Option C |
|-----------|:--------:|:--------:|:--------:|
| Event Flow Clarity | 3 | 2 | **4** |
| Composability | 3 | 2 | **3** |
| State Management | 3 | 3 | **4** |
| Async Pattern Handling | 3 | 3 | **4** |
| Error Handling | 3 | 3 | 3 |
| Testability | 3 | 2 | **4** |
| Side Effect Management | 2 | 2 | **3** |
| Type Safety | **4** | 2 | **4** |
| **Total** | **24/40** | **19/40** | **29/40** |

**Score distribution insight**: Option C leads in 6 of 8 categories and ties in 2. Option A is the runner-up, consistently scoring 3/5 — competent but uninspired. Option B is the weakest from an FP perspective due to coupling to frontend3's imperative internals and PHP's type system limitations.

---

## 4. The Recheck Pattern: Deep Dive

### How Each Option Handles It

| Aspect | Option A | Option B | Option C |
|--------|----------|----------|----------|
| Mechanism | Pass-through 12go flag | Client-driven polling, max 3 retries | Pass-through, stateless tokens for async |
| Server state | None | Redis (search:{token}) with 60s TTL | None |
| Client contract | `recheck: true/false` in response | Same | Same |
| Error on timeout | Return partial results | Return best available after max attempts | Return partial results with `recheck: false` |

### FP Ideal: Recheck as a Lazy Stream

From a functional perspective, the recheck pattern is a **lazy evaluation** problem. The search returns a stream of results that may not be fully evaluated yet. The ideal model:

```
type SearchResult =
  | Complete of Itinerary[]
  | Partial of Itinerary[] * ContinuationToken

search : SearchQuery -> Async<SearchResult>

-- Client-side:
let rec fetchAll query =
  match! search query with
  | Complete results -> results
  | Partial (results, continuation) ->
      let! more = fetchAll (withContinuation continuation query)
      results @ more
```

This models recheck as what it actually is: **a stream of results that may require continuation**. The `ContinuationToken` is opaque and carries whatever state the server needs to resume.

### What's Actually Happening

In practice, 12go's recheck is a polling pattern: call the same endpoint, get more results. There's no continuation token — the client re-sends the same query. This means the "stream" is not a real stream — it's a side-effectful retry.

The most honest model is a **state machine**:

```
SearchState =
  | Initial
  | Searching(query)
  | PartialResults(results, retryCount)
  | Complete(results)
  | TimedOut(bestResults)

transition : SearchState -> SearchEvent -> SearchState
```

Option C comes closest to this by keeping recheck stateless (no server-side session) and carrying state in the client's retry loop. But none of the options model it as an explicit state machine.

### Recommendation

Model recheck as a **recursive function with bounded retries**:

```
searchWithRecheck : SearchQuery -> RetryPolicy -> Async<Result<SearchResponse, SearchError>>

let searchWithRecheck query policy = async {
  let! result = callTwelveGo query
  match result.recheck, policy.remainingAttempts with
  | false, _  -> return Ok (translate result)
  | true, 0   -> return Ok (translate result)  // best effort
  | true, n   ->
      do! Async.Sleep policy.backoffMs
      return! searchWithRecheck query { policy with remainingAttempts = n - 1 }
}
```

This is pure, testable, and makes the retry logic explicit. The decision of whether to retry on the server or the client is a deployment concern, not a logic concern.

---

## 5. Booking Pipeline as a Function Pipeline

### The Ideal Model

The booking flow (GetItinerary → SeatLock → Reserve → Confirm) is a classic **multi-step pipeline with intermediate state**. In FP, this would be modeled as:

```
type BookingPipeline =
  getItinerary  : ItineraryRequest  -> Async<Result<CheckoutContext, BookingError>>
  lockSeats     : CheckoutContext    -> SeatSelection -> Async<Result<LockedContext, BookingError>>
  reserve       : LockedContext      -> PassengerData -> Async<Result<Reservation, BookingError>>
  confirm       : Reservation        -> Async<Result<ConfirmedBooking, BookingError>>
```

Key properties of this model:
- **Each step takes the output of the previous step** — no hidden shared state
- **State flows through the pipeline as typed data** — CheckoutContext → LockedContext → Reservation → ConfirmedBooking
- **Each step returns Result** — error paths are explicit, no exceptions
- **Each step is independently testable** — give it input, check output
- **Steps cannot be called out of order** — the type system prevents calling `confirm` with a `CheckoutContext`

### How Each Option Compares

**Option A** models this as imperative service methods:
```csharp
// Pseudo-code of what Option A will likely look like
var token = await _bookingService.GetItinerary(request);  // Returns BookingToken
await _seatLockService.LockSeats(token, seats);           // Mutates token in Redis
var booking = await _bookingService.CreateBooking(token, passengers);  // Returns BookingId
var confirmed = await _bookingService.ConfirmBooking(booking.Id);      // Returns status
```

Problem: `token` is a string ID referencing mutable Redis state. `LockSeats` mutates state as a side effect. The pipeline is connected by shared mutable state (Redis), not by data flow.

**Option B** delegates to frontend3:
```php
// Pseudo-code of what Option B will look like
$trip = $this->tripFinder->findFullResult($tripId, $date);
$cartId = $this->cartHandler->handleAddTrip($tripId, $date, $pax);
$form = $this->bookingFormManager->getProductsDetailsFromCart($cartId);
// ... later ...
$this->bookingProcessor->createBookingsAndSetIds($cartId, $passengers);
$this->bookingProcessor->reserveBookings();
$this->bookingProcessor->confirmBooking($bookingId);
```

Problem: The pipeline is not ours. We call frontend3's methods which internally orchestrate MySQL transactions, Redis cart mutations, and integration API calls. The pipeline's shape is dictated by frontend3's architecture, not by our domain model.

**Option C** comes closest:
```
Client sends: encrypted token containing {cartId, tripId, prices}
Gateway decrypts token → gets context
Gateway validates passengers → calls 12go → applies markup → returns result
```

The self-contained token acts as the pipeline's intermediate state carrier. Each API call receives the token (context from previous step) and produces a result. This is the closest to the FP ideal, but it's spread across HTTP requests rather than composed in a single pipeline.

### Which Option Comes Closest?

**Option C**, by a meaningful margin. The self-contained token pattern is essentially passing state through a pipeline as immutable data. The pipeline steps happen to be separated by HTTP request boundaries (because they're separate client calls), but the data flow is the cleanest.

Option A could achieve this if it adopted the self-contained token pattern from Option C instead of Redis-stored tokens, and structured the booking service as a pipeline of pure functions that produce commands (call 12go, check credit, publish event) rather than executing them directly.

---

## 6. Missed Opportunities

### 6.1 Railway-Oriented Programming for Error Handling

None of the options use Result types. All three rely on exceptions. This is a fundamental missed opportunity.

In .NET (Options A and C), this is straightforward:

```csharp
// Railway-oriented booking pipeline
public async Task<Result<ConfirmedBooking, BookingError>> ProcessBooking(
    BookingRequest request)
{
    return await DecryptToken(request.Token)
        .BindAsync(context => ValidatePassengers(context, request.Passengers))
        .BindAsync(validated => CheckCreditLine(validated))
        .BindAsync(approved => ReserveWithTwelveGo(approved))
        .BindAsync(reserved => ConfirmWithTwelveGo(reserved))
        .MapAsync(confirmed => ApplyMarkup(confirmed));
}
```

Each step either succeeds (passes to the next) or fails (short-circuits to error). The error path is visible in the type signature. Testing is trivial — inject a failure at any step and verify the pipeline short-circuits correctly.

Libraries like `OneOf` or `LanguageExt` for .NET, or custom `Result<T, E>` types, make this practical.

### 6.2 State Machine for Booking Lifecycle

The booking lifecycle is a state machine. None of the options model it as one.

```
                    ┌──────────────┐
                    │ TokenCreated │
                    └──────┬───────┘
                           │ lockSeats (optional)
                    ┌──────▼───────┐
                    │ SeatsLocked  │
                    └──────┬───────┘
                           │ reserve
              ┌────────────▼────────────┐
              │      Reserved           │
              └─────┬──────────┬────────┘
                    │ confirm  │ timeout/cancel
              ┌─────▼────┐ ┌──▼───────┐
              │ Confirmed │ │ Cancelled│
              └──────────┘ └──────────┘
```

In code:

```csharp
public abstract record BookingState;
public record TokenCreated(CheckoutContext Context) : BookingState;
public record SeatsLocked(CheckoutContext Context, SeatSelection Seats) : BookingState;
public record Reserved(string BookingId, ReservationDetails Details) : BookingState;
public record Confirmed(string BookingId, ConfirmationDetails Details) : BookingState;
public record Cancelled(string BookingId, CancellationDetails Details) : BookingState;

// State transitions are functions:
public Result<Reserved, BookingError> Reserve(TokenCreated state, PassengerData passengers) { ... }
public Result<Confirmed, BookingError> Confirm(Reserved state) { ... }
// Type system prevents: Confirm(TokenCreated) — won't compile!
```

This gives you:
- **Compile-time safety**: Can't confirm a booking that hasn't been reserved
- **Exhaustive handling**: Pattern matching forces you to handle every state
- **Auditable transitions**: Each transition is a function with input/output
- **Testable**: Test each transition independently

### 6.3 Event Sourcing for Audit Trail

The booking funnel is a natural fit for event sourcing. Every state transition produces an event:

```
BookingTokenCreated { clientId, tripId, cartId, prices, timestamp }
SeatsLocked { tripId, seats, timestamp }
BookingReserved { bookingId, passengers, netPrice, timestamp }
BookingConfirmed { bookingId, sellPrice, ticketUrl, timestamp }
```

Benefits:
- **Complete audit trail**: Every booking decision is recorded
- **Debugging**: Replay events to reproduce any booking state
- **Analytics**: Aggregate events for conversion funnels
- **Compensation**: If confirm fails, you have the full event history for manual recovery

Option A partially does this with Kafka events but doesn't store them as the source of truth. Option C explicitly eliminates events. This is a missed opportunity for both.

### 6.4 Ports and Adapters (Hexagonal Architecture)

None of the options enforce a boundary between business logic and infrastructure. A hexagonal architecture would define:

**Ports** (interfaces — what the domain needs):
- `SearchPort`: `search(query) -> Result<Itinerary[], SearchError>`
- `BookingPort`: `reserve(context, passengers) -> Result<Reservation, BookingError>`
- `PricingPort`: `applyMarkup(netPrice, clientRules) -> SellPrice`
- `CreditLinePort`: `checkBalance(clientId, amount) -> Result<Approved, Insufficient>`

**Adapters** (implementations — how the ports are fulfilled):
- `TwelveGoSearchAdapter implements SearchPort` (calls 12go HTTP)
- `InlinePricingAdapter implements PricingPort` (pure math)
- `RedisSeatLockAdapter implements SeatLockPort` (Redis)

**Core domain** (pure functions, no dependencies):
- `BookingPipeline.Process(ports, request) -> Result<Booking, Error>`

This makes the core domain testable with fake ports, and swappable — changing from 12go HTTP to direct PHP calls would be an adapter change, not a rewrite.

### 6.5 Functional Core, Imperative Shell

This is the meta-pattern that encompasses all the above. The idea: separate your codebase into:

1. **Functional core**: Pure functions for business logic (pricing, validation, contract translation, state machine transitions). No I/O, no side effects. Easy to test, easy to reason about.
2. **Imperative shell**: Thin layer that orchestrates I/O — calls HTTP, reads Redis, publishes events. The shell feeds data into the core and executes the core's decisions.

```
┌─────────────────────────────────────────┐
│            Imperative Shell              │
│  HTTP handlers, Redis, 12go client,     │
│  Kafka publisher, credit line client    │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │        Functional Core            │  │
│  │  Pricing, Validation, Mapping,    │  │
│  │  State Machine, Token Crypto,     │  │
│  │  Error Types, Domain Types        │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

None of the three options structurally enforce this separation. All three mix pure and effectful code in service methods. This is the single biggest improvement any of them could make.

---

## 7. Overall Recommendation

### From an Event-Driven / FP Perspective: Option C (Thin Gateway)

**Option C provides the best foundation for functional architecture**, not because it's already functional (it isn't), but because its constraints — minimal state, self-contained tokens, linear pipeline per endpoint, thin side-effect surface — naturally lead toward FP patterns.

The reasoning:

1. **State minimalism forces purity**: By refusing to store state in databases, Option C is forced to carry state in data (tokens) and push side effects to the boundaries. This is exactly the FP discipline of "push effects to the edges."

2. **Linear pipeline structure invites composition**: The `Validate → Transform → Call → Transform → Price → Return` pattern per endpoint is one refactoring step away from a composed function pipeline with Result types.

3. **Thin side-effect surface enables testing**: With only HTTP calls and Redis (vs. HTTP + DynamoDB + Kafka + Redis in Option A, or HTTP + MySQL + Redis + Memcached in Option B), the effectful boundary is small and mockable. The vast majority of logic (translation, pricing, validation, encryption) is pure.

4. **Self-contained tokens are the most functional state model**: Passing state as immutable data through the system is fundamentally more functional than storing mutable state in Redis/DynamoDB and referencing it by key.

5. **Smallest blast radius for scope creep**: The explicit guardrails (~150 files, ~3 Redis data types) and the "Creep Warning" section show awareness that a gateway can grow. The discipline of keeping it thin is the discipline of keeping it functional.

### Caveats

- **Option C should add `booking.lifecycle` Kafka events**. Eliminating events entirely is wrong. Events are domain concepts, not telemetry overhead. At minimum, `BookingReserved`, `BookingConfirmed`, `BookingCancelled` events should be published for audit trails and analytics.

- **Option A is the pragmatic choice if the team is not willing to adopt FP patterns**. It's a competent, if uninspired, consolidation of existing code. It works. It's low-risk. But it will never become more than an imperative proxy.

- **Option B should only be chosen if 12go mandates it** (Q1 = internal bundle). From an FP/event-driven perspective, coupling to frontend3's mutable-state internals is the worst outcome. If forced into Option B, invest heavily in defining clean interfaces between the bundle and frontend3, and extract all pure logic into standalone, independently testable modules.

### If I Were Designing This

I would take Option C's architecture and add:

1. **Railway-oriented error handling** (`Result<T, BookingError>` throughout the pipeline)
2. **Typed booking state machine** (compile-time enforcement of state transitions)
3. **Functional core / imperative shell** separation (pure functions in a core module, I/O in a shell module)
4. **Minimal event publishing** (3-4 booking lifecycle events to Kafka for audit and analytics)
5. **Pipeline composition** (declare each endpoint as a composed pipeline of typed steps)

This would produce a system that is not just a thin gateway, but a *well-typed, testable, auditable, composable* thin gateway — one that makes illegal states unrepresentable and error paths visible.

The total additional effort for these improvements over baseline Option C: approximately 2-3 person-weeks, mostly in defining types and refactoring the pipeline structure. A small investment for a dramatically better architecture.
