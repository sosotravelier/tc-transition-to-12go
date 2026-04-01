# Parallel Flow Analysis: Running Existing Clients Through F3

**Date**: Mar 30, 2026
**Context**: Post-meeting proposal from Eliran (Mar 25 Q2 implementation plan meeting)
**Purpose**: Analyze what it would take to route existing client traffic through F3's new B2B endpoints for gradual validation

---

## 1. The Proposal

> "I thought about it and I would like to see if we can have our existing customers running through the new flows (in F3). Can we do a flow that starts in TC current systems, and calls the new B2B endpoint instead of 12GO's B2B? I am trying to avoid waterfall, and having gradual rollout. So every endpoint will apply for both the existing and new customers, but new customers can go directly to the new flow. That way we can check performance, scale, QA gradually."
> — Eliran, Mar 25

This can be interpreted in two ways:

### Current Flow
```
Existing Client ──► TC (.NET) ──► 12go B2B API ──► Response
                    │
                    ├── Station ID translation (Fuji CMS → 12go)
                    ├── MediatR pipeline (markup, caching, filtering)
                    └── Response transformation (12go → TC contract)
```

### Interpretation A: Shadow Traffic (Compare Mode)
```
Existing Client ──► TC (.NET) ──► 12go B2B API ──► Response to client (unchanged)
                    │
                    └── async copy ──► F3 B2B endpoint ──► Log + compare
                                       (fire-and-forget)     (never served)
```
TC continues serving clients normally. In the background, a copy of the request also goes to F3. Both responses are compared and logged. The client always gets TC's response — zero risk.

### Interpretation B: Live Reroute
```
Existing Client ──► TC (.NET) ──► F3 B2B endpoint ──► Response to client
                    │               │
                    │               └── 12go (internal)
                    │
                    └── (old 12go-direct path disabled for this client)
```
TC calls F3 instead of calling 12go directly. F3's response is what the client actually receives. Per-client feature flag controls who is rerouted.

---

## 2. Approach A — Shadow Traffic for Search

The lowest-risk option. Already partially planned (Jira story #4 includes "shadow traffic comparison").

### How It Works

The TC search pipeline already translates Fuji CMS station IDs into 12go integer IDs early in the request lifecycle (during route discovery). At the layer where the actual 12go API call is made, the IDs are already in 12go format.

We insert a shadow call at this layer:
1. Normal flow proceeds as today — client gets TC's response
2. In parallel (async, fire-and-forget), the same request is sent to F3's search endpoint using the already-translated 12go IDs
3. When both responses arrive, a comparison runs and logs the diff
4. If F3 is slow or errors — silently ignored, no client impact

### What Changes

**In TC (.NET)**:
- New HTTP client configured for F3's base URL
- Shadow comparison service: constructs F3 request from already-translated IDs, fires async, compares responses, logs structured diffs
- Feature flag (per-client or global) with configurable sampling rate (e.g., 10% of traffic)
- Circuit breaker: stop shadow calls if F3 is unhealthy

**In F3 (PHP)**:
- Near-zero changes — the existing search POC already accepts 12go integer station IDs and returns the TC contract shape (vehicles, segments, itineraries)
- Add support for `x-shadow-request` header so shadow traffic can be filtered in Datadog
- Forward `x-correlation-id` for cross-system tracing

### ID Mapping

TC already translates Fuji CMS → 12go IDs before the shadow interception point. F3 receives native 12go IDs — no mapping needed in F3.

For response comparison: station/operator IDs will differ in format (Fuji CMS in TC response vs 12go integers in F3 response). The comparison should focus on **structural equivalence** — itinerary count, pricing, departure/arrival times, vehicle types — not ID matching.

### Authentication

Create a dedicated internal service API key in 12go's `usr` table for TC-to-F3 communication. F3's existing authentication validates it like any other key.

### Monitoring

- TC logs structured comparison events: `clientId`, `itineraryCountTC`, `itineraryCountF3`, `priceDiffPercent`, `matchRate`, `f3LatencyMs`, `tcLatencyMs`
- Both systems share `x-correlation-id` for cross-referencing between Coralogix (TC) and Datadog (F3)
- Dashboard showing match rate trend over time

### Effort & Risk

| | |
|---|---|
| **Extra effort** | +4-6 days (TC-side HTTP client, comparison service, feature flag, logging) |
| **F3 effort** | ~0.5 days (header support, correlation ID forwarding) |
| **Risk** | Near-zero — client traffic is completely unaffected |
| **Alignment** | Partially planned in Jira story #4 |

---

## 3. Approach B — Live Reroute for Search

After shadow comparison proves high match rate (>99%), flip the switch: TC serves F3's response to actual clients.

### How It Works

At the search controller level — before the request enters TC's processing pipeline — a feature flag check determines whether to route to F3:

```
Request arrives at TC search controller
  │
  ├── Feature flag ON for this client?
  │     YES → Call F3 search endpoint → Return F3's response directly
  │     (if F3 errors → fall through to normal flow)
  │
  └── Feature flag OFF (or F3 failed)?
        → Normal TC pipeline (12go direct) → Return TC's response
```

This bypasses TC's entire processing pipeline (markup, caching, filtering, supplier integration) because F3's response is already in TC contract format.

### What Changes

**In TC (.NET)**:
- Production-grade HTTP client (retries, circuit breaker, timeout matching TC's SLA)
- Routing logic at controller level with per-client feature flag
- Automatic fallback: if F3 returns error or times out, fall through to normal TC flow
- Metrics: F3 vs TC response times, error rates, fallback frequency

**In F3 (PHP)**:
- Production hardening of search endpoint (error handling, timeouts, structured logging)
- Potentially: markup/pricing logic (see key issue below)

### Key Issues

**Markup/Pricing**: TC applies revenue markup inside its pipeline (Ushba Revenue SDK). If we bypass the pipeline, F3 must apply equivalent markup — otherwise existing clients see different prices. This is a decision point:
- Option: Implement markup in F3 (significant work, but needed eventually for new clients anyway)
- Option: Accept that shadow comparison validates correctness and defer markup to the new-client implementation timeline
- Option: Keep the markup behavior running in TC even for rerouted requests (requires extracting it from the pipeline)

**Reverse ID Mapping**: F3 returns 12go integer station IDs in the response. Existing clients expect Fuji CMS IDs. TC must reverse-map the response before returning it to the client. The mapping data already exists in TC's station mapping cache — but the reverse-mapping code path may not exist today and would need to be built.

### Effort & Risk

| | |
|---|---|
| **Extra effort** | +3-5 days beyond Approach A (production HTTP client, fallback logic, reverse ID mapping) |
| **F3 effort** | +2-3 days (production hardening, potentially markup) |
| **Risk** | Low-medium — pricing discrepancy is main concern; automatic fallback limits blast radius |
| **Prerequisite** | Shadow comparison (Approach A) shows >99% structural match |

---

## 4. Approach C — Live Reroute for Booking Funnel

This is where the proposal gets materially harder. The booking funnel is fundamentally different from search.

### The Statefulness Problem

Search is **stateless and idempotent** — you can call it twice, compare results, discard one, and nothing bad happens.

The booking funnel is **stateful with financial side effects**:

| Step | Side Effect |
|------|-------------|
| GetItinerary | Creates a cart in 12go (real server-side state) |
| CreateBooking | Reserves real inventory (seats become unavailable) |
| ConfirmBooking | Charges real money |
| CancelBooking | Initiates real refund |

**Shadow traffic for booking = double-booking**. If TC processes a booking normally AND sends a shadow copy to F3, F3 would create a second real reservation for the same seats. This is not viable.

### The All-or-Nothing Constraint

The booking funnel is a multi-step session with state carried between requests:

```
GetItinerary → stores cart + schema in F3's Redis
     ↓
CreateBooking → reads cart from F3's Redis, calls 12go reserve
     ↓
ConfirmBooking → reads booking state, calls 12go confirm
```

If GetItinerary routes to F3, then CreateBooking **must** also route to F3 — because the cart state lives in F3's Redis, not in TC's DynamoDB. Similarly, if CreateBooking routes to F3, ConfirmBooking must follow.

**You cannot mix-and-match booking endpoints between TC and F3 for the same booking session.** All booking endpoints for a client must be routed together or not at all.

### Mid-Funnel Fallback Risk

If F3 handles GetItinerary (creating a cart in F3) but then fails on CreateBooking, TC cannot pick up where F3 left off — TC's DynamoDB has no record of the cart. The booking session is lost.

The fallback strategy for booking is coarser: per-client, not per-request. Once a client is on F3 for booking, they stay on F3. Rollback means switching the client back to TC entirely and accepting that any in-flight F3 bookings need manual resolution.

### Booking ID Format

Existing clients hold booking IDs in TC's encrypted KLV format. The new F3 endpoints use 12go's native booking ID. For live reroute:
- New bookings made through F3 would use 12go native IDs (decided in Mar 25 meeting)
- TC would need to handle the format difference when clients query post-booking endpoints — a booking made through F3 uses a different ID format than older bookings made through TC
- This is manageable but adds code to TC's post-booking controllers

### Effort & Risk

| | |
|---|---|
| **Extra effort** | +10-15 days beyond current plan (TC routing for all booking endpoints, state management, fallback, ID translation) |
| **F3 effort** | None beyond what's already planned — the F3 booking endpoints are Q2 deliverables |
| **Risk** | Medium-high — financial side effects, state management across systems, coarse rollback |
| **Prerequisite** | ALL F3 booking endpoints must be production-ready simultaneously |

---

## 5. Per-Endpoint Feasibility

| Endpoint | Shadow Traffic | Live Reroute | Key Constraint |
|----------|---------------|--------------|----------------|
| **Search** | Yes | Yes | Stateless — ideal candidate |
| **GetItinerary** | No — creates cart | Possible but complex | Cart state + itinerary ID format |
| **CreateBooking** | No — reserves inventory | Only with full funnel | All-or-nothing with GetItinerary |
| **ConfirmBooking** | No — charges money | Only with full funnel | All-or-nothing with CreateBooking |
| **GetBookingDetails** | Possible (read-only) | Yes | Booking ID format translation |
| **GetTicket** | Possible | Yes | URL passthrough |
| **CancelBooking** | No — real refund | Only with full funnel | Two-step flow, financial side effects |
| **Static Data** | Yes (low value) | Yes | Rarely changes; one-time comparison sufficient |

**Search is the clear first candidate.** It's stateless, high-volume (best validation signal), and the POC already works.

---

## 6. The ID Mapping Question

The current Q2 plan defers ID mapping by scoping to "new clients only, 12go native IDs." Eliran's proposal surfaces this earlier because existing clients use Fuji CMS IDs.

### Option 1: TC Keeps Doing Translation

TC already translates Fuji CMS → 12go IDs in its pipeline. For shadow/reroute, TC sends already-translated 12go IDs to F3. F3 stays native-ID-only.

- For **shadow traffic**: trivial — IDs are already translated before the interception point
- For **live reroute**: TC must also reverse-map F3's response (12go integers → Fuji CMS) before returning to the client. The mapping data exists in TC but the reverse path may need new code.
- **Pros**: F3 stays clean. No mapping work in PHP.
- **Cons**: TC's Fuji mapping cache must stay operational throughout the dual-running period.

### Option 2: F3 Learns Both ID Formats

Port the Fuji CMS ↔ 12go mapping into F3 (MariaDB table + APCu per-worker cache). F3 accepts either format, detects which, translates internally.

- **Pros**: F3 becomes self-contained. Enables direct client-to-F3 routing without TC as intermediary.
- **Cons**: ~1-2 weeks effort. Requires Fuji DynamoDB data export into MariaDB. Contradicts Q2 scope of "new clients only."
- **Note**: This work is needed eventually for Q3 existing-client migration. Doing it now is early investment, not wasted work.

### Option 3: Defer Parallel Flow to Q3

Keep Q2 focused on new-client endpoints. When Q3 migration work builds the ID mapping layer in F3, parallel flow for existing clients becomes natural.

- **Pros**: No scope change to Q2. ID mapping built once, used for both parallel flow and migration.
- **Cons**: No real-traffic validation until Q3. New client onboarding relies on contract test suite rather than production comparison.

---

## 7. Possible Phasing

| Phase | Scope | Timeline | Extra Effort | Risk |
|-------|-------|----------|-------------|------|
| **A** | Shadow traffic for search | April | +4-6 days | Near-zero |
| **B** | Live reroute for search (per-client) | May (after shadow validation) | +3-5 days | Low |
| **C** | Shadow comparison for GetItinerary (response only, no cart) | June (after endpoint built) | +3-4 days | Low |
| **D** | Live reroute for full booking funnel | Q3 | +10-15 days | Medium-High |

- Phase A aligns with existing Jira story #4
- Can skip A and go straight to B if confidence is high enough
- Phases C and D naturally align with Q3 migration timeline
- Each phase is independently valuable — can stop at any phase

---

## 8. What's Genuinely Good About This Idea

- **Real-traffic validation** catches response discrepancies that unit tests and contract tests miss — field ordering, edge-case pricing, timeout behavior under load
- **Builds organizational confidence** — stakeholders see real comparison dashboards, not just test reports
- **Natural migration path**: shadow → reroute search → reroute booking → decommission TC. Each step reduces TC's role incrementally
- **Aligns with per-client gradual rollout** — the design phase recommended exactly this pattern
- **De-risks new client onboarding** — by the time the first new client goes live, F3's search has already been validated against real production patterns

---

## 9. Open Questions for Discussion

1. **Which approach to start with?** Shadow comparison (A), or jump straight to live reroute (B)?
2. **Who implements the TC-side changes?** The solo developer building F3 endpoints would also need to modify TC's .NET codebase. These compete for the same person's time.
3. **Markup/pricing**: Should F3 apply identical markup to TC, or is structural comparison (same trips, same times, same net prices) sufficient for validation?
4. **Booking funnel timing**: Given the statefulness constraints, is booking reroute a Q2 expectation or Q3?
5. **ID mapping investment**: Should we build Fuji mapping in F3 now (Option 2, enables self-contained F3), or keep translation in TC (Option 1, simpler but keeps TC as intermediary)?

---

## Summary

| Approach | Effort | Risk | Value |
|----------|--------|------|-------|
| **A: Shadow search** | +4-6 days | Near-zero | High — validates F3 with real traffic |
| **B: Live reroute search** | +3-5 more days | Low | High — proves F3 can serve production traffic |
| **C: Shadow GetItinerary** | +3-4 days | Low | Medium — validates most complex endpoint |
| **D: Live reroute booking** | +10-15 days | Medium-High | High — but requires all booking endpoints ready |
