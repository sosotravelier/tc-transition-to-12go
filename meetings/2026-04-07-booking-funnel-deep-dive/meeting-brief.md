# Booking Funnel Deep-Dive + Parallel Flow Proposal

**Meeting** | Apr 7, 2026 | ~2.5 hours (1:00–3:30 PM)
**Presenter** | Soso
**Audience** | Shauly (+ Eliran if parallel flow proposal is discussed)

---

## Purpose

Deep-dive into the booking funnel implementation approach — endpoint by endpoint, covering the booking schema parser, state management (Redis cart), validations, and the transformation layer between TC contract and 12go's internal business logic. Additionally, discuss Eliran's parallel flow proposal for routing existing client traffic through F3's new B2B endpoints for gradual validation.

---

## Current Project Status

**Architecture**: PHP/Symfony inside F3 monolith (Team-First Developer design with Platform Engineer and Disposable Architecture overlays). Flat 3-layer: handler / mapper / 12go client.

**Search POC**: Complete. Validated that the approach works — calling 12go's internal services from within F3, translating response to TC contract format.

**Recent decisions** (Mar 25/30 meetings):
- Use 12go native booking IDs for new clients
- Keep `client_id` in URL path
- Proceed with F3 internal service calls (same as search POC); explore optimization for booking schema
- Recheck/206 is product + search team responsibility
- Notifications deferred — not needed for new client onboarding
- Follow 12go conventions wherever possible
- Get Itinerary is next implementation priority (without schema)
- Schema split into separate task, prerequisite for Create Booking

**Biggest risk**: Booking schema parser port (~1,180 lines of C#, 20+ wildcard field patterns, bracket-notation serialization, cross-request state). Every design agent and the Red Team identified this as the make-or-break deliverable.

---

## Part 1: Booking Funnel — Endpoint Deep-Dive

### 1.1 GetItinerary

**Current TC flow**: Search returns itinerary IDs → client calls GetItinerary → TC calls 12go API → receives itinerary details + booking schema → caches schema in DynamoDB → returns itinerary to client with booking token.

**Key questions**:
- How does F3's internal cart/itinerary creation work? Can we call the business logic directly rather than the B2B API?
- What state needs to persist between GetItinerary and CreateBooking? (Redis cart with schema mapping)
- Booking token format — what should it contain?
- How to handle the itinerary ID format? (Deferred from Mar 25 meeting — Avikhai: "let's take it off now")

**Endpoint doc**: `current-state/endpoints/get-itinerary.md`

### 1.2 Booking Schema Parser

**The hardest piece**. ~1,180 lines of C# that:
- Parses 12go's dynamic form schema (field definitions, validation rules, conditional visibility)
- Maps TC field names to 12go field names (wildcard patterns like `pax_*_firstname`)
- Serializes using bracket-notation (`pax[0][firstname]`) for 12go's API
- Maintains field mapping between GetItinerary (present schema) and CreateBooking (submit values)

**Key questions**:
- Can we bypass the schema translation entirely by calling F3's internal method? (Eyal suggested this at Mar 25 meeting — "get the object model from the business logic and translate it to a different API")
- If not, what's the porting strategy? Port C# → PHP line-by-line, or redesign?
- What test fixtures exist in TC's C# codebase for the schema parser?
- What does 12go's internal handling of booking forms look like? Is there a simpler internal representation?

**Red Team warning**: "Port parser FIRST (weeks 1-2) using C# test fixtures. If not code-complete with passing tests by week 3, reassess timeline."

### 1.3 CreateBooking

**Current TC flow**: Client submits booking form → TC validates against cached schema → translates field names (TC → 12go format) → calls 12go reserve API → stores booking in DynamoDB → returns booking ID + status.

**Key questions**:
- What validations does TC apply before sending to 12go? Are they all schema-driven?
- Can we rely on 12go's internal validations instead? (Shauly: "when we have good validations at the beginning we get better results")
- What state from GetItinerary is needed? (Cart ID, schema mapping, passenger count?)
- Error handling: what error codes does 12go return and how does TC translate them?

**Endpoint doc**: `current-state/endpoints/create-booking.md`

### 1.4 ConfirmBooking

**Current TC flow**: Client confirms → TC calls 12go confirm → updates booking status → triggers post-booking events (Kafka).

**Key questions**:
- Is this a thin pass-through or does TC add significant logic?
- What Kafka events are emitted on confirmation? (ReservationConfirmationSucceeded?)
- Payment handling — does TC touch payment or is it purely 12go-side?

**Endpoint doc**: `current-state/endpoints/confirm-booking.md`

### 1.5 CancelBooking

**Current TC flow**: Client cancels → TC calls 12go cancel/refund → returns refund amount.

**Key questions**:
- Refund amount calculation — TC or 12go?
- Vlad's revenue changes — how do they affect this?
- Two-step cancellation flow?

**Endpoint doc**: `current-state/endpoints/cancel-booking.md`

### 1.6 GetBookingDetails

**Decision from Mar 25**: Low difficulty — runtime API call to 12go replaces local DB read.

**Key questions**:
- What fields does TC add from its own DB that won't be in 12go's response?
- Booking ID format translation for legacy bookings?

**Endpoint doc**: `current-state/endpoints/get-booking-details.md`

### 1.7 GetTicket

**Decision from Mar 25**: Eyal: "If clients get a URL, it doesn't matter if it's S3 or 12go." Avikhai on branding: "This is what we get today. We don't do anything."

**Key questions**:
- Is it just a URL passthrough?
- Branding on PDFs — product decision needed?

**Endpoint doc**: `current-state/endpoints/get-ticket.md`

---

## Part 2: Eliran's Parallel Flow Proposal

Eliran proposed (via Slack, post Mar 25 meeting) that existing clients could be routed through F3's new B2B endpoints for gradual validation — avoiding a waterfall approach.

**Analysis document**: `meetings/2026-03-25-q2-implementation-plan/eliran-parallel-flow-analysis.md`

### Summary of Approaches

| Approach | Description | Extra Effort | Risk |
|----------|-------------|-------------|------|
| **A: Shadow search** | TC sends async copy to F3, compares responses, client unaffected | +4-6 days | Near-zero |
| **B: Live reroute search** | TC routes search to F3 per-client, with fallback | +3-5 more days | Low |
| **C: Shadow GetItinerary** | Response comparison only (no cart creation) | +3-4 days | Low |
| **D: Live reroute booking** | Full booking funnel through F3 per-client | +10-15 days | Medium-High |

### Key Constraints from Analysis

- **Search is stateless** — ideal for shadow traffic and live reroute
- **Booking funnel is stateful with financial side effects** — shadow traffic = double-booking
- **All-or-nothing constraint**: once GetItinerary routes to F3, CreateBooking must follow (cart state in F3's Redis)
- **TC limitation**: can only configure integration per-client for ALL endpoints, not per-endpoint (workaround exists)
- **ID translation**: TC already translates Fuji → 12go IDs; for live reroute, TC must also reverse-map F3's response

### Slack Context Summary

- **Eliran**: Wants gradual rollout, clear milestones reaching production, willing to extend team
- **Soso**: Confirmed feasible. TC has per-client integration config. Limitation: can't mix endpoints between old and new integration per client (workaround: new TC integration module calls mix of B2B and existing endpoints)
- **Shauly**: Agrees it has huge benefit, concerned about TC-side adaptation effort and state management complexity

### Questions for Discussion

1. **Is this Q2 or Q3 scope?** Shadow search (Phase A) could be Q2 if effort is available
2. **Who implements TC-side changes?** Same developer building F3 endpoints would need to modify TC .NET codebase
3. **Should we start with Phase A (shadow) or Phase B (live reroute)?**
4. **Team extension**: Eliran mentioned extending the team — is this confirmed?
5. **Can we decouple the booking funnel reroute from search reroute?** (Phasing suggests yes)

---

## Decisions Needed

| # | Decision | Who Decides |
|---|----------|-------------|
| 1 | Booking schema approach: port C# parser vs. use F3 internal method vs. hybrid | Shauly + Soso |
| 2 | GetItinerary: what to persist in Redis between GetItinerary and CreateBooking | Soso (technical) |
| 3 | Itinerary ID format for new clients | Shauly (deferred from Mar 25) |
| 4 | Parallel flow: which phase(s) to include in Q2 scope | Shauly + Eliran |
| 5 | Parallel flow: who implements TC-side changes | Shauly + Eliran |
| 6 | Logging/error handling approach for booking endpoints | Soso + Shauly |

---

## Prior Context

- [Q2 Implementation Plan — Meeting Record](../2026-03-25-q2-implementation-plan/meeting-record.md)
- [Parallel Flow Analysis](../2026-03-25-q2-implementation-plan/eliran-parallel-flow-analysis.md)
- [Team Lead Sync Before Holidays — Meeting Record](../2026-03-30-team-lead-sync-before-holidays/meeting-record.md)
- [Decision Map](../../design/decision-map.md)
- [Booking Schema Parser (Red Team Risk #3)](../../design/decision-map.md#7-red-team-warnings)

### Endpoint Documentation

- [GetItinerary](../../current-state/endpoints/get-itinerary.md)
- [CreateBooking](../../current-state/endpoints/create-booking.md)
- [ConfirmBooking](../../current-state/endpoints/confirm-booking.md)
- [CancelBooking](../../current-state/endpoints/cancel-booking.md)
- [GetBookingDetails](../../current-state/endpoints/get-booking-details.md)
- [GetTicket](../../current-state/endpoints/get-ticket.md)
