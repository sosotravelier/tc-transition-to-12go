---
status: complete
last_updated: 2026-03-17
depends_on: design/v4/comparison-matrix.md
---

# Architecture Recommendation (v4)

## Executive Summary

**Recommended: Disposable Architecture, implemented in .NET (C#).**

Score: **94.5 / 130** — 9 points clear of the next alternative.

Soso should build a standalone .NET 8 microservice using the Disposable Architecture's adapter boundary pattern. The service implements all 13 B2B endpoints as a thin translation layer between B2B clients and the 12go API. The outbound 12go adapter is explicitly labelled disposable and sits behind an `IBookingGateway` interface. Contract tests (Hurl files) validate the permanent client boundary.

This is achievable in Q2. Nothing else is.

---

## What Changed from v3

The v3 recommendation was **Go microservice** (scored 180/235 under v3 criteria).

Four things changed between v3 and v4 that reverse this recommendation:

**1. Team size dropped from 3-4 to 1.** v3 criteria assumed a development team. v4 criteria were built from scratch for one AI-augmented developer. Go's score on Solo Developer Fit drops to 1/5 — nobody on the team or at 12go has Go production experience. There is no one to ask for help, no one to debug a goroutine leak at 3am, no one to review Go code. v3 scored Go highly for "strategic alignment"; v4 scores it 2/5 on Implementation Effort because the language learning curve plus dynamic JSON friction puts MVP at 13-14 weeks realistic — past Q2.

**2. The Q2 deadline is concrete.** v3 treated timeline as one factor among many. v4 treats it as a near-hard constraint: if the proxy is not ready, clients cannot onboard and the organization's Q2 commitments fail. The only design where Soso can realistically ship MVP in 5-7 weeks is Disposable Architecture in .NET — because Soso can port existing C# code on day 1.

**3. Simplicity was underweighted in v3.** v3 weighted Simplicity at ×2. v4 elevates it to ×3 with the explicit rationale that "a solo developer who cannot hold the entire system in their head will drown." The Disposable Architecture does not score highest on Simplicity (3/5, due to its three-layer structure), but its adapter boundary is offset by .NET's familiarity to Soso — the structural complexity does not translate to cognitive overhead.

**4. Disposability became concrete.** v3 treated F3 decomposition as speculative. v4 criteria note that Q2 planning for F3 refactoring has started, making the double-migration risk real. Disposable Architecture scores 5/5 on Disposability (highest of any design) because its `IBookingGateway` interface means only the outbound adapter changes when F3 decomposes.

---

## Why Disposable Architecture in .NET

### The central argument

Soso has 12 years of .NET expertise. He can port the existing `OneTwoGoApi` class, booking schema parser, and reserve request serializer on day 1 — not in week 3 after a language ramp-up. Every PHP design costs 2-4 additional weeks. Every Go design costs more. With a Q2 deadline and ~9-10 effectively available weeks, a 2-4 week tax is the difference between shipping and not.

### What makes this design worth the .NET choice

The Disposable Architecture is not just "build it in .NET." It proposes a specific structure that survives F3 decomposition:

- **Permanent layer**: HTTP controllers, version negotiation, correlation headers. These do not change when 12go's API changes.
- **Domain interface boundary**: `IBookingGateway`, `ITripSearcher`. Client code and domain logic reference these interfaces only — zero 12go concepts leak through.
- **Disposable layer**: `TwelveGoBookingGateway`, `TwelveGoTripSearcher`, all mappers in `Adapters/Outbound/TwelveGo/`. When F3 is decomposed, only this directory changes.
- **Contract tests (Hurl)**: Language-agnostic tests that validate the permanent client boundary and survive any future rewrite.

This means the service is not a permanent .NET orphan — it is a .NET service with a documented replacement plan. The contract tests and domain interfaces are portable to PHP or any other language when the 12go team eventually takes ownership.

### Score breakdown

| Criterion | Score | Note |
|---|---|---|
| C1 Implementation Effort | 4/5 | MVP in 5-7 weeks in .NET; Soso ports existing C# code |
| C2 Solo Developer Fit | 4/5 | 12 years .NET experience; debug production issues alone |
| C3 AI-Friendliness | 3.5/5 | .NET scores 4/5 for this task; adapter boundary adds ~10% indirection |
| C4 Search Performance | 3/5 | Language-agnostic design; .NET async/await is fast |
| C5 Simplicity | 3/5 | Three layers; more complex than pure proxy, less complex than alternatives |
| C6 Migration Risk | 4/5 | Feature flags enable per-client and per-endpoint cutover with easy rollback |
| C7 Testing Ease | 4/5 | xUnit + Moq (AI-excellent), Hurl contract tests, WireMock fixtures |
| C8 Infrastructure Fit | 3/5 | Standalone container; .NET runtime is new for 12go DevOps |
| C9 Disposability | 5/5 | Best of any design; ~60% of codebase survives F3 decomposition |
| C10 Elegance | 4/5 | Permanent/disposable labeling is a clear organizing principle |
| C11 Monitoring/Observability | 2/5 | Design leaves this underspecified; must be filled in during implementation |
| C12 Development Velocity | 4/5 | Endpoint changes in hours after MVP; adapter boundary helps AI navigate |
| **Total** | **94.5 / 130** | |

---

## Red Team Caveats — Eyes Open

The Red Team identified two real risks with Disposable Architecture that should be mitigated before committing:

**Risk 1: The design does not choose a language.**
The design is language-agnostic "by construction." If Team Lead mandates PHP, the C1 score drops from 4→3 and C2 drops from 4→2, reducing the weighted total to ~79.5. At that score, Team-First Developer (PHP standalone) becomes competitive. **Mitigation: Make the language choice explicit and get Team Lead sign-off before implementation starts.**

**Risk 2: The three-layer boundary has upfront design cost.**
The adapter interfaces, domain types, and two sets of mappers must be designed before any endpoint is functional. Red Team estimates 3-4 weeks for skeleton + Search endpoint if built carefully. **Mitigation: Scope the domain layer aggressively. Do not over-abstract. The `IBookingGateway` interface should have 8 methods max. Domain types should be thin wrappers. If upfront cost exceeds 1 week, simplify.**

**Risk 3 (cross-cutting): G4 is unresolved.**
Will 12go DevOps support a standalone container that is not F3? If no, only the F3 monolith option remains viable. **Mitigation: Have this conversation with DevOps before writing any code. It is a 1-hour conversation that determines the entire architecture.**

---

## Scope for Q2

To fit the 9-10 effective weeks available:

| Item | Decision |
|---|---|
| gRPC module | **Out** — Team Lead approved scoping out |
| Booking notifications | **Out** (Phase 1) — offload to 12go or implement post-MVP |
| Event emission (Data Flow Architect) | **Deferred** — add structured logs after core proxy works |
| Hurl contract tests | **Deferred** — add after MVP works; do PHPUnit mapper tests first |
| WireMock fixtures | **Keep** — record real 12go responses as day-1 artifacts; they double as test inputs |
| Feature flag router | **Simplify** — start with gateway-only routing; add in-proxy flags if needed |

Core deliverable: **10-11 endpoints** (all booking funnel + master data + incomplete results) running behind the adapter boundary, with mapper unit tests and migration tooling.

---

## If-Then Alternatives

These are the conditions under which the primary recommendation does not apply and the fallback should be used:

### IF Team Lead mandates PHP: Team-First Developer (PHP standalone)

Score: **85.5** (second-highest overall).

Build a standalone PHP 8.3/Symfony service — not inside F3. The Team-First Developer design's AGENTS.md specification, flat project structure, and fixture-based testing make it the most AI-effective PHP option. Avoid F3 embedding (the Pragmatic Minimalist's primary recommendation): the Search POC documented 16 infrastructure issues and ongoing F3 local dev friction costs ~1 week of velocity penalty over a 10-week project.

**Realistic timeline**: 10 weeks. If Q2 is firm, this is viable only with reduced scope (gRPC out, notifications out, events deferred). Start the booking schema mapper in the first week — if AI-generated PHP produces clean output for this specific component, proceed. If not, escalate the language decision.

### IF DevOps will not support standalone containers: Pragmatic Minimalist (PHP in F3)

Score: **85.0** (third).

If DevOps says "PHP only inside F3," then the only viable option is the Pragmatic Minimalist's approach. Accept the F3 local dev friction as a known cost. Use the standalone PHP Symfony fallback described in that design as soon as F3 friction exceeds 2 days of lost velocity.

### DO NOT choose under current conditions

| Design | Condition that blocks it |
|---|---|
| **Clean Slate (Go)** | Nobody on the team or at 12go has Go production experience; booking schema mapper in Go is a 2-week effort with real bug risk |
| **Data Flow Architect** | Data team call has not happened (Mar 17); do not build 17 event types against unverified requirements |
| **Platform Engineer** | Use its observability and infrastructure specifications as input to whichever design is chosen, not as a standalone proposal |

---

## Implementation Sequence

Regardless of which design is chosen, the first two weeks determine feasibility:

**Week 1**: Implement the booking schema parser. This is the hardest component. If it works in the chosen language with acceptable quality, the rest of the endpoints are manageable. If it does not, escalate the language decision immediately.

**Week 1**: Record real 12go API responses as test fixtures. Every endpoint, every error case. These become both test inputs and AI context for the entire project.

**Week 2**: Search endpoint end-to-end. This is the latency-sensitive hot path and the integration test for the entire pipeline. If Search works, the architecture is validated.

**Week 3-4**: GetItinerary (3 12go calls, schema mapper integration) and CreateBooking/ConfirmBooking (booking funnel).

**Week 5-6**: Post-booking endpoints (CancelBooking, GetBookingDetails, etc.) and master data.

**Week 7+**: Hardening, migration tooling, monitoring, and any deferred scope items.

---

## Before Any Code Is Written

These questions must be answered. A wrong assumption discovered at month 3 causes more rework than taking 2 days to answer them now:

| # | Question | Who Answers | Why It Blocks |
|---|---|---|---|
| **G4** | Will 12go DevOps support a standalone container (non-F3)? | DevOps lead | 5 of 6 designs require this; if no, only F3 monolith is viable |
| **G5** | Does a `clientId → 12go apiKey` mapping exist anywhere? | 12go team | All designs need this; if it must be created, add 2-3 days to scope |
| **Language** | Does Team Lead approve .NET for the B2B proxy? | Team Lead | Determines whether to proceed with primary or fallback |
| **Data team** | Schedule the outstanding data team call | RnD | Event schema cannot be finalized without this; blocks Data Flow Architect scope |
