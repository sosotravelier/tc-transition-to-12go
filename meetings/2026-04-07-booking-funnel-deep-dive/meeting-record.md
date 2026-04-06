---
status: complete
last_updated: 2026-04-07
---

# Meeting Record: Booking Funnel Deep-Dive

**Date** | Apr 7, 2026
**Participants** | Soso, Shauly, Eliran (Sana was invited but unavailable — follow-up needed)
**Purpose** | Deep-dive into the booking funnel implementation approach — booking schema, state management, transformation layer — plus discussion of parallel flow proposal for routing existing clients through new F3 endpoints.

---

## Key Topics

### 1. Booking Schema — Dynamic Form Fields

Soso walked through the 12go booking schema response structure. Key points:

- 12go returns a dynamic form schema per operator — field definitions, validation rules (PHP-style regex), and options (e.g., available seats, baggage tiers)
- **Static fields** (mobile, email, first name, country ID) are mapped one-to-one to TC contract format
- **Dynamic fields** (selected seats, baggage) are placed in a dictionary (additional fields)
- The schema parsing/transformation is ~1,000 lines of C# in TC
- Unknown fields: if required → error returned; if not required → skipped
- Eliran raised concern: if 12go adds a new mandatory field, existing clients could break silently

### 2. Approach: Internal Methods vs. JSON Parsing

Two options for implementing the booking funnel in F3:

1. **Parse the 12go API JSON** and transform it (mirrors current TC approach)
2. **Call F3's internal PHP methods** directly, bypassing the API/JSON layer

- Eliran strongly prefers option 2 — it aligns with the future unified API vision and avoids creating another translation layer
- Shauly: agrees in principle but wants to verify with Sana that the internal methods (get trip details, add to cart) are the same ones 12go uses in their own B2C flows
- Soso: for the search POC, he already called internal methods but the PHP objects still reflect the 12go API format — going deeper (e.g., to the database layer) opens more boxes
- Shauly: "get trip details is a good starting point" — don't go deeper than the existing internal method layer

### 3. Unified API Vision

- Eliran: "12go is not different from any other consumer of the API. There is no rational basis for having a 12go API and TC API." Sana agrees with this direction.
- Shauly: don't mix the API unification effort with what Soso is building now — keep the scope contained
- Eliran: agrees on scope, but the new B2B API should be designed as "the right API" so it can serve as the future unified API
- Both agree the new endpoints should be built with this direction in mind, without blocking on it

### 4. State Management — Cart vs. Redis vs. DynamoDB

Current TC flow: GetItinerary stores booking schema in DynamoDB; CreateBooking reads it back.

- Eliran proposed making the flow stateless by reusing 12go's existing **cart** for state management instead of creating new state (Redis/DynamoDB)
- Shauly: "let's try to utilize whatever we have, and if we don't have, let's use Redis for the addition"
- Soso: the cart approach needs investigation — needs to understand what the cart stores and whether it covers the schema mapping needs
- Decision: investigate cart-based approach first; Redis as fallback for anything the cart doesn't cover

### 5. Parallel Flow — Routing Existing Clients Through F3

Extended discussion on Eliran's proposal to route existing clients through the new F3 endpoints:

- **Two integration points considered:**
  - SI Framework level: swap integration ID to load new F3-based implementation (lower effort, but response goes through unnecessary TC pipeline transformations)
  - TC controller level (Denali/Etna): fork early, call F3 endpoint directly, return JSON with minimal ID translation (Shauly's preferred approach — less pipeline waste)
- **Rollout milestones:**
  - Search can be rolled out independently (stateless, easy to validate)
  - Booking funnel (GetItinerary + CreateBooking + ConfirmBooking) must roll out together due to shared cart/state
  - Eliran: "If we need to roll out search first, then three or four APIs together, I think it's fine"
- **Scope expansion:** this approach means existing clients also go through F3 — not just new clients. Eliran considers this a major win for validation.

### 6. QA and Shadow Testing Strategy

- Schema responses and GetItinerary are ideal for shadow comparison (stateless, idempotent)
- **CreateBooking cannot be shadow tested** — would create duplicate bookings
- Shauly: for CreateBooking, can test in parallel with same itinerary and compare data quality (price, no errors)
- Shauly: challenges include ID differences between old and new paths, and needing diverse routes/operators for coverage
- Eliran: define QA strategy per endpoint as part of implementation

### 7. Resourcing and Collaboration

- **More people after holidays:** Eliran committed to adding resources — "it's a strategic project and we need to treat it as one"
- **Soso needs 2x/week meetings with Sana** (Tuesday + Thursday, 30 min) for investigation support. Weekly is not enough — needs iteration cycle within the week.
- **Valeri** (PHP buddy) — should be involved, possibly for implementation support. Soso: "I would assume we'd involve him in implementation phase, not planning"
- **Sana is critical** — Eliran: "when Sana is on vacation, 12go stops." Shauly + Eliran will discuss with Sana today about availability.
- **Slack channel:** Eliran wants a dedicated project channel with him and Sana added. Shauly believes one already exists — needs to find it.

### 8. AI Workflow Discussion

- Eliran impressed by Soso's AI-driven research workflow (meeting briefs, transcript processing, project context, Jira story generation via MCP)
- Soso: "without AI I would not be able to do any of it... velocity is like 3x or 5x"
- Eliran wants Soso to present the approach to the broader team (engineers + product)

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | Existing clients should also route through new F3 endpoints (preserving their IDs) — priority #1 for the parallel flow | Eliran |
| 2 | Booking funnel endpoints (GetItinerary + CreateBooking + ConfirmBooking) must roll out together as one milestone | Eliran + Shauly |
| 3 | State management: investigate using 12go's existing cart; Redis as fallback for anything the cart doesn't cover | Shauly |
| 4 | Use internal F3 methods (get trip details, add to cart) as the data source — don't go deeper than the existing method layer | Shauly |
| 5 | More resources will be added to the project after holidays | Eliran |
| 6 | Set up 2x/week meetings with Sana (Tue + Thu, 30 min) for investigation support | Eliran |
| 7 | Create/activate dedicated Slack channel for the project with Eliran and Sana added | Eliran |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| Shauly + Eliran | Discuss with Sana today about being more involved and available for the project | Apr 7, 2026 |
| Shauly | Find/activate the dedicated Slack channel, add Eliran and Sana | Apr 7, 2026 |
| Shauly | Verify with Sana that internal methods (get trip details, add to cart) are the same used by 12go's own B2C flows | TBD |
| Soso | Investigate using 12go's existing cart for booking state management (instead of new Redis/DynamoDB state) | TBD |
| Eliran | Arrange additional resources for the project after holidays | After holidays |
| Soso | Present AI workflow approach to the broader team (engineers + product) | TBD |

---

## Key Quotes

> "12go is not different than any other consumer of the API. There is no rational in having a 12go API and TC API." — Eliran

> "I don't want to mix what Soso is doing with our things like aligning the API. I think it will make the context bigger." — Shauly

> "If you can make sure that all the state is using the existing 12go databases and objects, just manipulate it from the outside, it will be better even if it's a bit more work and more complex." — Eliran

> "Let's try to utilize whatever we have and if we don't have, let's use Redis for the addition." — Shauly

> "Number one priority needs to be that also existing clients will go through the new flow just preserving their IDs." — Eliran

> "It's a strategic project and we need to treat it as one. So probably after the holidays we have more people on this project." — Eliran

> "Without AI I would not be able to do any of it. Velocity is like 3x or 5x." — Soso

---

## Open Questions (Carried Forward)

- **Can 12go's cart be used for booking state?** — Soso to investigate with Sana's help. Blocks the CreateBooking implementation approach.
- **Are internal methods identical to 12go's own B2C flow?** — Shauly to verify with Sana. Affects confidence in the approach.
- **Where to fork in TC pipeline for parallel flow?** — Controller level (Shauly's preference) vs. SI framework level — needs detailed investigation.
- **QA strategy for CreateBooking** — Cannot shadow test (double booking risk). Need alternative validation approach per endpoint.
- **What does Valeri's involvement look like?** — Implementation phase helper, but scope and timing unclear.
- **Sana's availability for 2x/week meetings** — Depends on today's discussion with Sana.
