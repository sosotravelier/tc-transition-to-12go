# Meeting Questions & Answers — Mar 18, 2026

Transcript will be available for review.

---

## 1. Confirm scope: "ready for new clients" = no backward compatibility?

New clients get 12go native IDs everywhere (stations, operators, bookings). No Fuji CMS ID mapping, no KLV booking ID decoding, no legacy support. Existing client migration is Q3+.

**If answer is NO (backward compatibility required)**: This changes the scope significantly — adds station ID mapping (P1), booking ID transition (P5), and in-flight safety (P6). Timeline extends.

**Answer**: **Yes — confirmed with nuance.** New clients use 12go native IDs. Backward compatibility is NOT in Q2 scope. However, Shauly emphasized that the design must ensure what we build doesn't require a redesign when we migrate existing clients later. Specifically: "I don't need to do [special things for migration] right now. Or part of this scope. What I do need to do is plan how I'm going to migrate the clients and see that everything we build supports that." If a client later refuses to change IDs, a static ID mapping layer could be added on top (Q3+), or the client may be dropped. The Q2 deliverable should use 12go IDs but the architecture should not paint us into a corner.

---

## 2. I need PHP developer sessions

1hr, 2x/week for first 2 weeks. I prepare questions, we resolve together. Includes F3 local dev/Docker issues. Then 1x/week for a month. Then as-needed.

**Who is this person?**:

**Answer**: **Approved.** Shauly agreed immediately: "You kind of want a buddy. I totally agree." Acknowledged that the team is "the only team that doesn't have in-house buddy." No specific person named yet — to be assigned. The schedule (2x/week → 1x/week → as-needed) was accepted without pushback.

---

## 3. gRPC is out of scope for Q2

You agreed on Mar 17. Confirming. Entirely different protocol, not needed for new client onboarding.

**Answer**: **Confirmed — can be pushed to later phase.** Shauly also shared new context: he and Levan discovered that 12go already has a partner/agent entity type that handles gRPC-style clients (e.g., Google). There are special fees and association logic involved. This is more complex than initially thought but is "a responsibility of somebody else in 12go" during migration. Does not affect Q2.

---

## 4. Monitoring/metrics discovery — not my task

I need you to own this in cooperation with PHP-side people. What metrics exist in .NET, what PHP platform tracks, what gaps remain. This is a management/operational concern.

**Answer**: **Agreed — co-owned.** Shauly said Eliran asked all team leads to inventory their monitoring (coincidental timing). Current state: ~300 production alerts that need to be narrowed to 10-20 meaningful ones. Shauly will co-own the discovery. Soso's responsibility: implement the metrics as part of API development (per-API call counts, success/failure rates, response times per client). Shauly wants to understand how 12go does metrics on their APIs — "it should be something very similar." Discovery is Shauly's task; implementation is Soso's.

---

## 5. Kafka event requirements — pair me with someone

I'll implement the event emission. But I need to be paired with someone from data team (or architect/BA) to define: which events, what data, where it comes from. Spec needed by ~week 6 (early May).

**Answer**: **Agreed — needs research.** Shauly acknowledged he doesn't know which topics to use or whether the current ones apply. Mentioned that COA (current event publisher) runs on a different cloud. 12go's data is "floating somewhere" in some unified system. This is a topic that "we need to research and understand exactly what we need and how." Pairing session to be arranged. No specific person from data team named yet.

---

## 6. Dedicated QA for staging

My workflow: I build & test locally → deploy to staging → QA signs off. I need a QA resource assigned by ~week 4 (late April).

**Answer**: **Unclear.** Shauly mentioned **Jerko** as a potential QA resource — he's from another team and could do blackbox testing (doesn't need to know 12go internals). Also mentioned that the team has light Q2 load, so "half of people" might be available. However, no firm commitment or assignment date. To be determined.

---

## 7. Do we need encrypted booking IDs for new clients?

Current system uses Caesar cipher on KLV-encoded IDs. For new clients I'd just expose 12go `bid` directly. Is that OK or do we need obfuscation?

**Answer**: **Decision deferred — needs validation with Sana.** Shauly said: "It's a decision that we need to take." He's open to using 12go IDs directly but wants to validate with Sana that everything works with raw 12go IDs. Nuance: booking ID might stay as raw `bid`, but the booking token (which includes cart_id) might need encryption to avoid confusion. Itinerary ID is also an open question. Not blocking Q2 start, but needs a decision before booking endpoint implementation.

---

## Additional Questions

### 8. SeatLock endpoint — in or out for Q2?

Current system has `POST /seats` for pre-reservation seat selection. 12go is developing native support. Needed for new clients?

**Answer**: **In scope but lowest priority — after booking funnel.** Shauly confirmed 12go deployed seatlock to production today (Mar 18). He'd rank it lower: "After I finish all the booking funnel. It's like an add-on that we need to have there." Include in Q2 if time permits, otherwise early Q3.

---

### 9. Notification/webhook service — can this go to another developer?

Different topology (inbound webhook → client resolution → outbound delivery). Entirely separate from the request-response booking funnel. I want this offloaded.

**Answer**: **Open — depends on estimation.** Shauly did not commit to offloading but also didn't reject it. His position: "Let's estimate it. If it will be more than one quarter, either we extend it to more than one quarter or we forced to put another people on." He's open to: (a) pushing it out of Q2 scope, (b) offloading to another developer, or (c) deferring until client is actually about to onboard. Key quote: "Maybe booking notification [can wait] until the client will be about to onboard."

---

### 10. Who is the first new client?

Is there an actual client lined up, or are we building for a hypothetical? Affects how we validate in weeks 11-12.

**Answer**: **Not discussed in this meeting.** Question was not raised during the conversation. Still needs an answer — affects validation approach in weeks 11-12.

---

### 11. F3 refactoring in Q2 — will it disrupt my work?

You said planning starts Q2. Will it touch code the B2B module depends on?

**Answer**: **Partially addressed.** Shauly mentioned that Sana's microservices migration "will start to create somewhere in Q2." He discussed this with Eliran. No specifics on whether it touches code the B2B module depends on, but it's something "we'll need to decide how and when we are doing that." Risk acknowledged but not mitigated — follow up with Sana directly.

---

### 12. Cancellation policies — any new requirements?

On Mar 17 you mentioned needing to expose more cancellation policy details. Is this extra Q2 scope or is basic handling sufficient?

**Answer**: **New cancellation policy will NOT go into search — only get_itinerary.** Shauly spoke with Sana earlier that day. Sana said adding detailed cancellation policy to search "will consume a lot of time, will increase the response dramatically." It will be added to get_itinerary only. Current system has a simple `full_refund_until` field (nullable — null means non-refundable, date means full refund until that date). The new structured policy (tiered: e.g., free until 2 weeks, 50% until 1 week, 100% in last week) exists in 12go but was "never exposed in a structured way." For Q2: basic `full_refund_until` handling is sufficient. Structured cancellation policy is an enhancement that will come later.

---

### 13. If timeline slips, end date moves — not scope. Agreed?

All 10 endpoints (3 master data + 7 booking) are committed. If parser or other work takes longer, we push delivery date, not cut endpoints.

**Answer**: **Not a firm yes.** Shauly's position is more nuanced: he wants estimation first, then will decide between (a) extending the timeline, (b) offloading work to another developer, or (c) pushing items to a later phase. Key quote: "We need to put like some estimation on how much it will take and we'll decide if we squeeze it or we stretch it or doing that in the second phase." He's flexible but not pre-committing to "scope is sacred."

---

## Additional Topics Raised During Meeting (Not Pre-Planned)

### 14. Presentation for Eliran — next Wednesday (Mar 25)

Shauly wants Soso to prepare a presentation showing: (a) which endpoints and the challenges for each, (b) what was learned about working in F3 (local environment instability, communication needs, pipeline quality), (c) the list of tasks. Audience: **Sana, Eyal, Eliran, Shauly**. Focus on "what are the main challenges in each API" not just listing endpoints.

### 15. Feature flags for merged code

Shauly raised: when Search POC is merged, does it become publicly accessible? May need feature flag protection. Action: ask Sana about best approach for feature flagging in F3.

### 16. Incomplete results / recheck mechanism — lower priority

Extended discussion. Shauly shared: (a) clients find the "pending" naming confusing, (b) most clients don't implement it, (c) AWS now supports a timeout override parameter (Tal discovered this), (d) some clients close HTTP connections after 30 seconds anyway. Shauly would rank this lower priority. For Q2: 206 Partial Content on search is committed; the polling endpoint is secondary.

### 17. Separate database schema for B2B tables

Soso proposed: B2B module should have its own DB schema, not depend on years of F3 migration scripts. Shauly acknowledged but treated it as an implementation detail — not something he needs to decide on.

### 18. Integration environment vs production

Shauly mentioned someone asked about integration environment for client onboarding. 12go theoretically has one but Shauly prefers production because "it's much more stable and has full capabilities." Decision pending.

### 19. David's DB migration not deployed to production

Unrelated to transition: David reported that a new database field isn't in production — likely needs a deployment to run the migration. Soso confirmed he enabled 12go but not "the bus" and Aia integrations.
