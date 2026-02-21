# Client Impact & Risk Review: Migration Strategy

## Overall Risk Assessment

**Overall risk level: MEDIUM-HIGH.** The strategy identifies main risks but underestimates operational reality. With 35+ clients and 1 CS person, Option B is infeasible without resourcing. Option A's "zero disruption" is misleading—clients experience disruption when things break, with no advance warning. Validation leaves booking flows under-tested relative to financial impact.

## Client Disruption Analysis

The matrix is partially fair but understates Option B's burden. Option A minimizes planned disruption but maximizes unplanned—if cutover fails, every client fails at once. Option C is most balanced. The matrix notes "significant" CS effort but does not quantify: 35+ clients × (outreach, docs, staging, cutover) with 1 person = 6–12 month program, not 4–12 weeks.

## Authentication Risk

Blast radius is client-wide. Wrong or missing clientId→12goApiKey mapping causes all that client's requests to fail. The doc does not address: failure mode when key is missing (401? 500?); whether wrong mapping could route Client A to Client B's 12go account (data leakage). Auth doc notes service handlers are passthroughs—a mapping bug could silently send bookings under the wrong key. Define explicit failure modes and add mapping validation to pre-cutover checks.

## Contract Preservation Gaps

The strategy lists conventions but does not confirm they are testable. Gaps: Travelier-Version; 206 Partial Content; cancellation policies; gross price variants; correlation headers. Validation mentions "diff byte-by-byte" but not coverage of all variants. Subtle regressions could reach production.

## In-Flight Booking Risk

Critical and under-addressed. Scenario: Client searches on old system, gets itinerary ID. Before Confirm, we switch to new system. Client calls CreateBooking with that ID—new system may not have it. Result: booking fails, revenue loss. Option C (search→new, booking→old) is safe only if client never switches booking URL mid-session. Require: no switch during active reservation; session/timeout rules before allowing booking migration.

## Rollback Reality Check

Option A claims are optimistic—gateway config is unverified. Option B: client reverts URL—realistically 1–5 days per client. Option C: search rollback fast; booking requires each client to revert. Produce a rollback runbook with procedures and owners.

## Validation Gaps

Shadow traffic is search-only—correct. Booking relies on contract tests + staging + manual QA. Gaps: staging keys for all clients; who owns manual QA with 1 CS person; version matrix; 206 test cases; webhook transformation validation. Regressions that could slip through: money precision, edge-case cancellation policies, ticket type mapping, Instant vs Pending confirmation.

## Communication & Coordination Risk

Underestimated. Option B with 35+ clients and 1 CS person: outreach alone is 2–4 weeks; many clients have slow change cycles; "hard deadline with consequences" is vague. 4–12 weeks realistic only if most clients are low-touch; if hand-holding needed, 6–12 months. Add a client readiness assessment.

## Top 3 Risks (ranked by severity)

1. **Auth mapping failure** — Wrong/missing mapping causes total or cross-client failure. Blast radius: one or all clients.
2. **In-flight booking breakage** — User mid-checkout when backend switches; itinerary invalid. Revenue loss, churn.
3. **Option B coordination collapse** — 1 CS person cannot manage 35+ migrations. Missed deadlines, forced cutover without validation.

## Recommendations

1. **Auth:** Pre-cutover validation for every active clientId; define explicit failure behavior (reject vs. fallback).
2. **In-flight booking:** Enforce "no switch during active booking session"; add timeout for Option C.
3. **Contract preservation:** Extend validation checklist to cover every convention in api-contract-conventions.md.
4. **Option B feasibility:** Secure additional CS support or narrow to 5–10 clients; revisit 4–12 week timeline.
5. **Rollback:** Produce runbook with concrete steps and owners before cutover.
6. **Webhook:** Validate notification transformer before any switch; consider 12go webhook signing.
