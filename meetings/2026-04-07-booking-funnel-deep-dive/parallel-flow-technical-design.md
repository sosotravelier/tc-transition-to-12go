# Parallel Flow — Technical Design: New SI Integration for F3 B2B

**Prepared for** Apr 7 meeting | **Author** Soso
**Source of truth**: Slack conversation (Eliran, Soso, Shauly) post-Mar 25 meeting

---

## What We're Proposing

Create a **new integration module inside the existing TC Supply Integration framework** that calls F3's new B2B endpoints instead of 12go's B2B API directly. This plugs into the existing TC architecture at the supplier level — everything above it (MediatR pipeline, markup, caching, contract resolution) continues working unchanged.

Think of it as: today TC has an "OneTwoGo" supplier that talks to 12go's B2B API. We add a second supplier — call it "OneTwoGoF3" — that talks to F3's B2B API instead. Per-client configuration determines which supplier handles the request.

### Why This Approach

From the Slack conversation:

> **Eliran**: "I am trying to avoid waterfall, and having gradual rollout. So every endpoint will apply for both the existing and new customers."

> **Soso**: "TC has per-client integration config. Limitation: can't mix endpoints between old and new integration per client. Workaround: new TC integration module calls mix of B2B and existing endpoints."

> **Shauly**: Agrees it has huge benefit, concerned about TC-side adaptation effort.

The key insight: **we don't need to rip out TC or rebuild its pipeline.** We just swap what happens at the bottom — instead of calling 12go B2B API, call F3 B2B API. TC keeps doing markup, caching, ID translation, and everything else.

---

## Where the Fork Happens

### The Current Architecture (Layers)

```
┌──────────────────────────────────────────────────────────────┐
│                        B2B Client                            │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                  Denali (API Gateway)                         │
│  BookingController / SearchController                        │
│  - Decrypt IDs, build request, encrypt response              │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     SiFacade                                  │
│  - Contract resolution, integration resolution               │
│  - Kafka events                                              │
│  - DynamoDB caching (itinerary, pre-booking, booking)        │
│  - Markup / exchange rate                                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                  Etna SI Host (HTTP)                          │
│  - Hosts the SI Framework                                    │
│  - Routes to correct integration                             │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│              SI Framework (ISiServiceProvider)                │
│  - CreateScope(integrationId, contractCode)                  │
│  - Resolves which supplier implementation to use             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │        OneTwoGoSearchSupplier (ISearchSupplier)        │  │
│  │        OneTwoGoBookingSchema  (IBookingSchema)         │  │
│  │        OneTwoGoBookingFunnel  (IBookingFunnel)         │  │
│  │                                                        │  │
│  │  Calls 12go B2B API directly:                          │  │
│  │  - GET  /search                                        │  │
│  │  - GET  /trip-details                                  │  │
│  │  - POST /add-to-cart                                   │  │
│  │  - GET  /checkout/{cartId}                             │  │
│  │  - POST /reserve/{bookingId}                           │  │
│  │  - POST /confirm/{bookingId}                           │  │
│  │  - GET  /booking/{bookingId}                           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### The Proposed Fork

We add a **parallel supplier implementation** at the SI Framework level:

```
┌──────────────────────────────────────────────────────────────┐
│              SI Framework (ISiServiceProvider)                │
│                                                              │
│  CreateScope(integrationId, contractCode)                    │
│         │                                                    │
│         ├─── integrationId = "onetwogo"                      │
│         │           │                                        │
│         │    ┌──────▼─────────────────────────────────────┐  │
│         │    │  OneTwoGoSearchSupplier  (EXISTING)        │  │
│         │    │  Calls 12go B2B API directly               │  │
│         │    │                                            │  │
│         │    │  GET /search → 12go HTTP                   │  │
│         │    │  GET /trip-details → 12go HTTP             │  │
│         │    │  POST /add-to-cart → 12go HTTP             │  │
│         │    │  GET /checkout/{cartId} → 12go HTTP        │  │
│         │    └────────────────────────────────────────────┘  │
│         │                                                    │
│         └─── integrationId = "onetwogo-f3"                   │
│                     │                                        │
│              ┌──────▼─────────────────────────────────────┐  │
│              │  OneTwoGoF3Supplier  (NEW)                 │  │
│              │  Calls F3 B2B endpoints                    │  │
│              │                                            │  │
│              │  GET /search → F3 HTTP (internal)          │  │
│              │  GET /itineraries/{id} → F3 HTTP           │  │
│              │  POST /bookings → F3 HTTP                  │  │
│              │  POST /bookings/{id}/confirm → F3 HTTP     │  │
│              └────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Everything above the SI Framework stays unchanged.** Denali, SiFacade, MediatR pipeline, markup, caching — all identical. The only difference is which HTTP endpoints get called at the bottom.

---

## Search Flow — Current vs Proposed

### Current: Search via 12go B2B API

```
Client                  Denali              Etna/MediatR          SI Framework         12go B2B API
  │                       │                     │                      │                     │
  │── GET /search ──────>│                     │                      │                     │
  │                       │── MediatR Send() ─>│                      │                     │
  │                       │                     │                      │                     │
  │                       │                     │  Pipeline behaviors: │                     │
  │                       │                     │  - DistributionRules │                     │
  │                       │                     │  - SourceAvailability│                     │
  │                       │                     │  - ContractResolution│                     │
  │                       │                     │  - Markup            │                     │
  │                       │                     │                      │                     │
  │                       │                     │── CreateScope ──────>│                     │
  │                       │                     │   ("onetwogo")       │                     │
  │                       │                     │                      │                     │
  │                       │                     │                      │── GET /search ─────>│
  │                       │                     │                      │<── search results ──│
  │                       │                     │                      │                     │
  │                       │                     │<── mapped results ───│                     │
  │                       │                     │                      │                     │
  │                       │                     │  Pipeline continues: │                     │
  │                       │                     │  - Apply markup      │                     │
  │                       │                     │  - Cache results     │                     │
  │                       │                     │  - Build itinerary IDs│                    │
  │                       │                     │                      │                     │
  │                       │<── response ────────│                      │                     │
  │<── search results ────│                     │                      │                     │
```

### Proposed: Search via F3 B2B API

```
Client                  Denali              Etna/MediatR          SI Framework         F3 B2B API
  │                       │                     │                      │                     │
  │── GET /search ──────>│                     │                      │                     │
  │                       │── MediatR Send() ─>│                      │                     │
  │                       │                     │                      │                     │
  │                       │                     │  Same pipeline:      │                     │
  │                       │                     │  - DistributionRules │                     │
  │                       │                     │  - SourceAvailability│                     │
  │                       │                     │  - ContractResolution│                     │
  │                       │                     │  - Markup            │                     │
  │                       │                     │                      │                     │
  │                       │                     │── CreateScope ──────>│                     │
  │                       │                     │   ("onetwogo-f3")    │  <── ONLY CHANGE    │
  │                       │                     │                      │                     │
  │                       │                     │                      │── GET /search ─────>│
  │                       │                     │                      │   (F3 internal)      │
  │                       │                     │                      │<── search results ──│
  │                       │                     │                      │                     │
  │                       │                     │<── mapped results ───│                     │
  │                       │                     │                      │                     │
  │                       │                     │  Same pipeline:      │                     │
  │                       │                     │  - Apply markup      │                     │
  │                       │                     │  - Cache results     │                     │
  │                       │                     │  - Build itinerary IDs│                    │
  │                       │                     │                      │                     │
  │                       │<── response ────────│                      │                     │
  │<── search results ────│                     │                      │                     │
```

**The ONLY difference** is on one line: the `integrationId` passed to `CreateScope()` resolves to the F3 supplier instead of the 12go-direct supplier. Everything else — the entire MediatR pipeline, markup, caching, ID generation — runs identically.

### What the F3 Supplier Does Differently

| Step | OneTwoGoSearchSupplier (current) | OneTwoGoF3Supplier (proposed) |
|------|----------------------------------|-------------------------------|
| Search | Calls `GET /search` on 12go B2B HTTP API | Calls internal F3 search endpoint (same app, different route) |
| Response format | 12go B2B API response (JSON) | TC contract format (JSON) — F3 already returns this |
| Mapping | Maps 12go response → SI Itinerary model | Maps F3 response → SI Itinerary model (simpler, already in TC format) |
| IDs | 12go integer IDs | 12go integer IDs (F3 uses native IDs) |

---

## GetItinerary Flow — Current vs Proposed

### Current: GetItinerary via 12go B2B API

```
Client            Denali/SiFacade         Etna SI Host        SI Framework            12go B2B API
  │                     │                      │                    │                       │
  │── GET /itineraries ─>│                     │                    │                       │
  │   /{itinerary_id}   │                      │                    │                       │
  │                     │  Decrypt ID          │                    │                       │
  │                     │  Resolve contract    │                    │                       │
  │                     │  Resolve integration │                    │                       │
  │                     │                      │                    │                       │
  │                     │  PART 1: Get Itinerary                    │                       │
  │                     │── GET /itinerary ───>│                    │                       │
  │                     │                      │── CreateScope ────>│                       │
  │                     │                      │   ("onetwogo")     │                       │
  │                     │                      │                    │                       │
  │                     │                      │                    │── GetTripDetails ────>│
  │                     │                      │                    │<── trip data ─────────│
  │                     │                      │                    │                       │
  │                     │                      │                    │── AddToCart ─────────>│
  │                     │                      │                    │<── cartId ────────────│
  │                     │                      │                    │                       │
  │                     │<── itinerary ────────│<───────────────────│                       │
  │                     │                      │                    │                       │
  │                     │  Cache in DynamoDB   │                    │                       │
  │                     │  Generate BookingToken│                    │                       │
  │                     │  Apply markup        │                    │                       │
  │                     │                      │                    │                       │
  │                     │  PART 2: Get Booking Schema               │                       │
  │                     │── GetBookingSchema ─>│                    │                       │
  │                     │                      │── CreateScope ────>│                       │
  │                     │                      │                    │                       │
  │                     │                      │                    │── GET /checkout ─────>│
  │                     │                      │                    │   /{cartId}           │
  │                     │                      │                    │<── form fields ───────│
  │                     │                      │                    │                       │
  │                     │                      │                    │  Parse dynamic fields  │
  │                     │                      │                    │  Build name mapping    │
  │                     │                      │                    │  Cache in Redis        │
  │                     │                      │                    │                       │
  │                     │<── booking schema ───│<───────────────────│                       │
  │                     │                      │                    │                       │
  │                     │  Cache schema in     │                    │                       │
  │                     │  DynamoDB            │                    │                       │
  │                     │                      │                    │                       │
  │<── PreBookingSchema │                      │                    │                       │
  │  (itinerary +       │                      │                    │                       │
  │   schema + token)   │                      │                    │                       │
```

### Proposed: GetItinerary via F3 B2B API

```
Client            Denali/SiFacade         Etna SI Host        SI Framework            F3 B2B API
  │                     │                      │                    │                       │
  │── GET /itineraries ─>│                     │                    │                       │
  │   /{itinerary_id}   │                      │                    │                       │
  │                     │  Decrypt ID          │                    │                       │
  │                     │  Resolve contract    │                    │                       │
  │                     │  Resolve integration │                    │                       │
  │                     │                      │                    │                       │
  │                     │  PART 1: Get Itinerary                    │                       │
  │                     │── GET /itinerary ───>│                    │                       │
  │                     │                      │── CreateScope ────>│                       │
  │                     │                      │   ("onetwogo-f3")  │  <── ONLY CHANGE      │
  │                     │                      │                    │                       │
  │                     │                      │                    │── GET /itineraries ──>│
  │                     │                      │                    │   /{id}  (F3 endpoint) │
  │                     │                      │                    │                       │
  │                     │                      │                    │   F3 internally does:  │
  │                     │                      │                    │   - GetTripDetails     │
  │                     │                      │                    │   - AddToCart           │
  │                     │                      │                    │   - GetCheckout         │
  │                     │                      │                    │   - Parse schema        │
  │                     │                      │                    │   - Cache in Redis      │
  │                     │                      │                    │                       │
  │                     │                      │                    │<── itinerary +        │
  │                     │                      │                    │    booking_schema +    │
  │                     │                      │                    │    booking_token       │
  │                     │                      │                    │                       │
  │                     │<── mapped response ──│<───────────────────│                       │
  │                     │                      │                    │                       │
  │                     │  Cache in DynamoDB   │                    │                       │
  │                     │  Apply markup        │                    │                       │
  │                     │                      │                    │                       │
  │<── PreBookingSchema │                      │                    │                       │
  │  (itinerary +       │                      │                    │                       │
  │   schema + token)   │                      │                    │                       │
```

**Key difference**: The F3 endpoint does the 3 12go API calls + schema parsing internally. The F3 supplier in TC just makes **one HTTP call** to F3 and gets back the full response (itinerary + schema + token). TC's SiFacade still does its thing (caching, markup, token encryption) on top.

### What Simplifies for GetItinerary

| Current (3 calls + parsing in SI) | Proposed (1 call to F3) |
|---|---|
| SI calls GetTripDetails → 12go | F3 calls GetTripDetails internally |
| SI calls AddToCart → 12go | F3 calls AddToCart internally |
| SI calls GetCheckout → 12go | F3 calls GetCheckout internally |
| SI parses dynamic fields, builds schema | F3 parses (natively in PHP — PCRE regex, simpler JSON) |
| SI caches name mapping in HybridCache (3h TTL, in-memory only) | F3 caches in Redis (shared, persistent) |
| **3 external HTTP calls + complex parsing in C#** | **1 internal HTTP call to F3** |

---

## Per-Client Routing

The SI Framework already supports per-client integration configuration. Today:

```
Client "baolau"  → integrationId = "onetwogo"   → OneTwoGoSearchSupplier
Client "12go"    → integrationId = "onetwogo"   → OneTwoGoSearchSupplier
```

With the new integration:

```
Client "baolau"  → integrationId = "onetwogo"      → OneTwoGoSearchSupplier (unchanged)
Client "newcorp" → integrationId = "onetwogo-f3"   → OneTwoGoF3Supplier (new, via F3)
```

To gradually validate, flip existing clients one at a time:

```
Client "baolau"  → integrationId = "onetwogo-f3"   → Rerouted through F3
Client "12go"    → integrationId = "onetwogo"       → Still on old path
```

This is a config change — no code change needed per client.

---

## Incremental Rollout: The Hybrid Supplier

The critical question: what happens when we've built Search and GetItinerary in F3, but CreateBooking isn't ready yet? We can't leave a test client half-functional.

**Solution**: The `OneTwoGoF3Supplier` doesn't have to route everything to F3. For endpoints not yet implemented in F3, it **delegates to the existing OneTwoGo supplier** — calling 12go's B2B API directly, exactly as today. The test client sees a seamless experience. They don't know (or care) that search comes from F3 but booking still goes through the old path.

### Example: Search + GetItinerary done, booking not yet

```
                        OneTwoGoF3Supplier
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
   ISearchSupplier    IBookingSchema         IBookingFunnel
        │                     │                      │
   ┌────▼────┐          ┌─────▼─────┐         ┌─────▼──────┐
   │ Search  │          │GetItinerary│         │CreateBooking│
   │ via F3  │          │  via F3   │         │ConfirmBook. │
   │  (NEW)  │          │  (NEW)    │         │ CancelBook. │
   └─────────┘          └───────────┘         └─────┬──────┘
                                                    │
                                              DELEGATES TO
                                                    │
                                              ┌─────▼──────┐
                                              │  Existing   │
                                              │ OneTwoGo    │
                                              │ Supplier    │
                                              │(12go B2B API│
                                              │  directly)  │
                                              └─────────────┘
```

### How It Looks Over Time

As F3 endpoints are completed, the hybrid supplier progressively shifts traffic from old to new:

```
PHASE 1 — Search done
┌──────────────────────────────────────────────────────────────────┐
│  OneTwoGoF3Supplier                                              │
│                                                                  │
│  Search ──────────> F3 B2B API                  ✅ NEW           │
│  GetItinerary ────> OneTwoGo (12go B2B API)     ⬜ old path     │
│  GetBookingSchema > OneTwoGo (12go B2B API)     ⬜ old path     │
│  CreateBooking ───> OneTwoGo (12go B2B API)     ⬜ old path     │
│  ConfirmBooking ──> OneTwoGo (12go B2B API)     ⬜ old path     │
│  CancelBooking ──> OneTwoGo (12go B2B API)      ⬜ old path     │
│  GetBookingDetails> OneTwoGo (12go B2B API)     ⬜ old path     │
│  GetTicket ───────> OneTwoGo (12go B2B API)     ⬜ old path     │
└──────────────────────────────────────────────────────────────────┘

PHASE 2 — Search + GetItinerary done
┌──────────────────────────────────────────────────────────────────┐
│  OneTwoGoF3Supplier                                              │
│                                                                  │
│  Search ──────────> F3 B2B API                  ✅ NEW           │
│  GetItinerary ────> F3 B2B API                  ✅ NEW           │
│  GetBookingSchema > F3 B2B API                  ✅ NEW           │
│  CreateBooking ───> OneTwoGo (12go B2B API)     ⬜ old path     │
│  ConfirmBooking ──> OneTwoGo (12go B2B API)     ⬜ old path     │
│  CancelBooking ──> OneTwoGo (12go B2B API)      ⬜ old path     │
│  GetBookingDetails> OneTwoGo (12go B2B API)     ⬜ old path     │
│  GetTicket ───────> OneTwoGo (12go B2B API)     ⬜ old path     │
└──────────────────────────────────────────────────────────────────┘

PHASE 3 — Full booking funnel done (all switch together)
┌──────────────────────────────────────────────────────────────────┐
│  OneTwoGoF3Supplier                                              │
│                                                                  │
│  Search ──────────> F3 B2B API                  ✅ NEW           │
│  GetItinerary ────> F3 B2B API                  ✅ NEW           │
│  GetBookingSchema > F3 B2B API                  ✅ NEW           │
│  CreateBooking ───> F3 B2B API                  ✅ NEW           │
│  ConfirmBooking ──> F3 B2B API                  ✅ NEW           │
│  CancelBooking ──> F3 B2B API                   ✅ NEW           │
│  GetBookingDetails> F3 B2B API                  ✅ NEW           │
│  GetTicket ───────> F3 B2B API                  ✅ NEW           │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Works Seamlessly

The test client is configured to use `integrationId = "onetwogo-f3"`. From their perspective, every endpoint works — they make the same API calls, get the same response format, and the booking funnel completes normally. They never know that:

- Their search went through F3 (new PHP code)
- Their GetItinerary went through F3 (new PHP code)
- Their CreateBooking went through the old OneTwoGo supplier (existing C# code, 12go B2B API)

**The seam is invisible at the TC contract level.** Both paths produce the same response shape because they both go through TC's Denali layer (markup, caching, ID encryption) on the way out.

### The One Constraint

The booking funnel endpoints (GetItinerary → CreateBooking → ConfirmBooking) must switch as a group because of shared cart state. But search is independent — it can switch to F3 while booking stays on old path indefinitely.

```
SAFE to mix:                    NOT safe to mix:
┌──────────────────┐            ┌──────────────────┐
│ Search → F3      │            │ GetItinerary → F3│
│ Booking → old    │   ✅       │ CreateBooking →  │
│                  │            │   old path       │   ❌
│ (stateless,      │            │                  │
│  independent)    │            │ (cart state is   │
└──────────────────┘            │  in F3's Redis)  │
                                └──────────────────┘
```

### Implementation in Code (Pseudocode)

```csharp
// The hybrid supplier delegates per-method
public class OneTwoGoF3SearchSupplier : ISearchSupplier
{
    private readonly F3HttpClient _f3Client;
    private readonly OneTwoGoSearchSupplier _fallback; // existing supplier

    public async Task<SearchResult> Search(SearchRequest req)
    {
        // F3 endpoint is ready — use it
        return await _f3Client.Search(req);
    }
}

public class OneTwoGoF3BookingFunnel : IBookingFunnel
{
    private readonly F3HttpClient _f3Client;
    private readonly OneTwoGoBookingFunnel _fallback; // existing supplier

    public async Task<Reservation> Reserve(string productId, Cost cost, IBookingRequest req)
    {
        if (_f3Client.IsEndpointReady("createBooking"))
            return await _f3Client.Reserve(productId, cost, req);

        // Not ready yet — delegate to existing 12go-direct path
        return await _fallback.Reserve(productId, cost, req);
    }
}
```

The `IsEndpointReady()` check could be a simple config flag, a feature flag, or even just whether the method has been overridden. The simplest version: just don't override the method until the F3 endpoint is ready — inheritance handles the rest.

---

## What Needs to Be Built (TC Side)

### New SI Integration Module: `OneTwoGoF3`

| Component | Implements | What It Does |
|---|---|---|
| `OneTwoGoF3SearchSupplier` | `ISearchSupplier` | Calls F3's `GET /search` endpoint, maps response to SI model |
| `OneTwoGoF3ItinerarySupplier` | (itinerary interface) | Calls F3's `GET /itineraries/{id}`, maps response |
| `OneTwoGoF3BookingSchema` | `IBookingSchema` | Passes through F3's booking schema (already in TC format) |
| `OneTwoGoF3BookingFunnel` | `IBookingFunnel` | Calls F3's `POST /bookings`, `POST /confirm`, etc. |
| `F3HttpClient` | — | HTTP client configured for F3's base URL, with retry + circuit breaker |

### Estimated Size

Each supplier class is thin — it's just an HTTP call + response mapping. No business logic, no schema parsing, no bracket-notation serialization. Estimated ~50-100 lines per class.

**Total estimated effort**: 3-5 days for search + GetItinerary. Most of the work is response mapping and integration testing.

---

## Phasing

| Phase | What | Effort | When |
|---|---|---|---|
| **1. Shadow Search** | TC sends search to both old supplier + F3 supplier, compares responses, client gets old response | +4-6 days | After F3 search is stable |
| **2. Live Reroute Search** | Per-client config switch: `onetwogo` → `onetwogo-f3` | +1-2 days (already built in phase 1) | After shadow shows >99% match |
| **3. Shadow GetItinerary** | Same pattern — compare F3 response vs old, no cart side effects in shadow (response comparison only) | +3-4 days | After F3 GetItinerary is built |
| **4. Live Reroute Booking Funnel** | All booking endpoints routed to F3 per-client (all-or-nothing for booking) | +5-8 days | Q3 |

### Why Booking Funnel Is All-or-Nothing

```
GetItinerary  ──creates cart──>  F3 Redis (cart state lives here)
     │
CreateBooking ──reads cart──>    F3 Redis (must use same system)
     │
ConfirmBooking ──reads booking──> F3 / 12go (must follow same path)
```

If GetItinerary goes to F3, CreateBooking **must** also go to F3 — the cart state is in F3's Redis. You cannot mix old-path GetItinerary with F3-path CreateBooking or vice versa.

Search has no such constraint — it's stateless.

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WHAT STAYS THE SAME                             │
│                                                                     │
│  Client → Denali → MediatR → Markup → Caching → ID encryption      │
│                                                                     │
│  All of this is unchanged. 100% of TC's pipeline keeps working.     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     WHAT CHANGES                                    │
│                                                                     │
│  At the SI Framework level:                                         │
│                                                                     │
│  OLD:  SI Framework → OneTwoGoSupplier → 12go B2B API (HTTP)       │
│  NEW:  SI Framework → OneTwoGoF3Supplier → F3 B2B API (internal)   │
│                                                                     │
│  Per-client config determines which path.                           │
│  Gradual rollout. Instant rollback (flip config back).              │
└─────────────────────────────────────────────────────────────────────┘
```
