---
status: complete
last_updated: 2026-03-18
---

# Meeting Record: Team Lead Sync — Q2 Scope & Planning

**Date** | Mar 18, 2026
**Participants** | Soso, Shauly
**Purpose** | Confirm Q2 scope, discuss resourcing, resolve open questions from transition design

---

## Key Topics

### 1. Q2 Scope Confirmation — New Clients Only

- Confirmed: Q2 scope is "ability to onboard new clients" — no backward compatibility required
- New clients will use 12go native IDs everywhere (stations, operators, bookings)
- The design must not require a redesign when migrating existing clients later
- If an existing client refuses to change IDs, a static mapping layer can be added on top (Q3+)
- Shauly: "I don't need to do [special things for migration] right now. What I do need is to plan how I'm going to migrate the clients and see that everything we build supports that."

### 2. PHP Developer Buddy Sessions

- Approved: Soso gets a dedicated 12go developer for pairing sessions
- Schedule: 2x/week for first 2 weeks → 1x/week for a month → as-needed
- Shauly agreed immediately: "You kind of want a buddy. I totally agree."
- The team is "the only team that doesn't have in-house buddy"
- No specific person assigned yet

### 3. gRPC Out of Scope for Q2

- Confirmed out of scope, can be pushed to later phase
- New context: Shauly and Levan discovered 12go already has a partner/agent entity type for gRPC clients (e.g., Google)
- Special fees and association logic involved — more complex than initially thought
- Migration responsibility likely falls on someone else at 12go

### 4. Monitoring & Metrics — Co-Owned

- Discovery is Shauly's responsibility; implementation is Soso's
- Coincidental timing: Eliran asked all team leads to inventory monitoring
- Current state: ~300 production alerts that need narrowing to 10-20 meaningful ones
- Soso's scope: per-API call counts, success/failure rates, response times per client
- Shauly wants to understand how 12go monitors their own APIs

### 5. Kafka/Data Events — Needs Research

- Soso will implement event emission but needs pairing with data team to define requirements
- COA (current publisher) runs on a different cloud — unclear how to publish
- 12go's data is "floating somewhere" in some unified system
- Topic needs research: which events, what format, where they go

### 6. Notifications/Webhooks — Potentially Offloadable

- Soso proposed offloading webhook implementation to another developer
- Shauly didn't commit but is open to it depending on estimation
- Options: extend timeline, offload to another developer, or defer until client onboarding
- Key quote: "Maybe booking notification [can wait] until the client will be about to onboard"

### 7. Q2 Committed Deliverables

- Master data endpoints (stations, operators, etc.)
- Full booking funnel: Search, GetItinerary, seat schema, Reserve
- Post-booking: GetBookingDetails, GetTicket
- Booking notifications (potentially offloaded)
- SeatLock — in scope but lowest priority, after booking funnel

### 8. Booking IDs — Decision Deferred

- Open question: use raw 12go IDs or encrypt them?
- Needs validation with Sana
- Booking token (contains cart_id) might need encryption to avoid confusion
- Not blocking Q2 start, but needs decision before booking endpoint implementation

### 9. Incomplete Results / Recheck — Lower Priority

- Clients find "pending" naming confusing; most don't implement it
- AWS now has a timeout override parameter (Tal discovered this)
- Some clients close HTTP connections after 30 seconds anyway
- Shauly ranks this lower priority for Q2

### 10. Cancellation Policy — Search vs GetItinerary

- New structured cancellation policy will NOT go into search (too slow)
- Will be added to GetItinerary only
- Current system has simple `full_refund_until` field — sufficient for Q2
- Full tiered policy exists in 12go but was "never exposed in a structured way"

### 11. Presentation for Eliran — Mar 25

- Shauly wants a presentation covering: endpoints + challenges for each, F3 learnings, task list
- Should emphasize: local environment instability, communication needs, pipeline quality
- Audience: Sana, Vlad, Eliran, Shauly (same as previous presentation)
- Target date: next Wednesday (Mar 25)

### 12. Feature Flags for Merged Code

- When Search POC is merged, need to protect with feature flag
- Action: ask Sana about best approach for feature flagging in F3

### 13. Separate DB Schema for B2B

- Soso proposed: B2B module gets its own DB schema, not dependent on years of F3 migration scripts
- Shauly acknowledged but treated as implementation detail

### 14. Resourcing Update

- Q2 load is light — "half of people" might be available to help
- Jerko (from another team) available for blackbox QA testing — doesn't need to know 12go internals
- Need to plan utilization in advance

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | Q2 scope: new client onboarding only, no backward compatibility | Shauly |
| 2 | PHP buddy sessions approved (2x/week → 1x/week → as-needed) | Shauly |
| 3 | gRPC out of Q2 scope | Shauly, Soso |
| 4 | Monitoring discovery co-owned by Shauly; implementation by Soso | Shauly, Soso |
| 5 | Cancellation policy: basic handling for Q2, structured policy later, GetItinerary only | Shauly (based on Sana's input) |
| 6 | SeatLock: in scope but lowest priority, after booking funnel | Shauly |
| 7 | Incomplete results/recheck: lower priority for Q2 | Shauly |
| 8 | Presentation for Eliran scheduled for Mar 25 | Shauly, Soso |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| Soso | Prepare endpoint-by-endpoint presentation for Eliran (challenges, F3 learnings, task list) | Mar 25, 2026 |
| Soso | Finalize Search POC changes and ping Shauly for review | Mar 19, 2026 |
| Shauly | Assign PHP buddy for pairing sessions | TBD |
| Shauly | Arrange pairing session with data team for Kafka event requirements | TBD |
| Soso | Ask Sana about feature flag approach for merged F3 code | TBD |
| Shauly | Validate with Sana: can we use raw 12go booking IDs? | TBD |
| Shauly | Check if Jerko can be available for QA | TBD |
| Soso | Deploy migration so David's new DB field reaches production | ASAP |

---

## Key Quotes

> "I don't need to do [special things for migration] right now. Or part of this scope. What I do need to do is plan how I'm going to migrate the clients and see that everything we build supports that." — Shauly

> "You kind of want a buddy. I totally agree with you. We are the only team that doesn't have in-house buddy." — Shauly

> "If we said that it's not feasible then we need to say what is feasible. I don't want you to push something that is not realistic." — Shauly

> "Let's estimate it. If it will be more than one quarter, either we extend it or we're forced to put another people on." — Shauly

> "This new cancellation policy is something that [Sana] doesn't want to add to the search because it will consume a lot of time, will increase the response dramatically." — Shauly

> "We need to take decision based on how it progresses and who is going to do what." — Shauly

---

## Open Questions (Carried Forward)

- **Booking ID encryption** — use raw 12go IDs or encrypt? Needs validation with Sana, blocks booking endpoint implementation
- **Kafka event topology** — which topics, what format, which cloud? Needs research + data team pairing
- **Feature flagging in F3** — how to protect merged code from public access? Ask Sana
- **Who is the first new client?** — not discussed, affects validation approach
- **F3 refactoring impact** — Sana's microservices migration starts Q2, overlap with B2B work unknown
- **Integration vs production environment** — for client onboarding, Shauly prefers production but no decision made
