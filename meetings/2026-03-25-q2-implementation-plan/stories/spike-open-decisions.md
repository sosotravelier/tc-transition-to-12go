# Spike: Q2 Open Decisions

**Type**: Spike
**Epic**: ST-2483 (Q2 B2B API Transition)
**Status**: Pending — Jira ticket not yet created
**Owner**: Shauly / Soso (facilitate), Product / Eyal / Eliran (decide)
**Prerequisites**: None

---

## Description

Resolve all open decisions that block or influence Q2 implementation. Each is a subtask/checklist item. Per Shauly: "Even for the open items... I want to have stories for that, that either will decide to postpone it maybe for next phase or it will let someone handle it."

---

## Acceptance Criteria

- [ ] **Itinerary ID format** — 12go native vs KLV-encoded. Metadata (search time, pax count) is currently embedded and used for events. Deferred from Mar 25 meeting. Needs decision before search goes to production.
- [ ] **Confirm product approval: use 12go native IDs** — Eyal flagged as product decision, "not set in stone."
- [ ] **Static data response format** — Keep TC shape or adopt 12go native format? Avikhai leans toward preserving TC format.
- [ ] **Static data ownership** — Soso or catalog team? Eliran to discuss with catalog. If catalog takes it, Soso's scope shrinks to 7 endpoints. Must enter someone's Q2 sprint.
- [ ] **Ticket PDF branding** — 12go logo vs client branding. Currently using 12go ticket as-is. Product decision.
- [ ] **Notification architecture** — Approach A (extend webhook table) / B (in-process F3) / C (keep .NET). Can defer entire feature but decision on approach is useful early.

---

## Open Questions (For Grooming)

None — the spike itself is the mechanism for resolving open questions.
