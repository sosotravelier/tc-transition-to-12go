# SeatLock

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- Complete booking funnel (CreateBooking, ConfirmBooking)
- 12go native seat lock availability (David implementing TC-to-12go connection)

**Priority**: Lowest — after complete booking funnel.

---

## Description

Implement the SeatLock endpoint (`POST /v{version}/{client_id}/seats`) that allows clients to pre-lock specific seats between GetItinerary and CreateBooking. 12go is actively developing native seat lock support; by the time this story is reached, it should be available.

Currently in TC (Denali), 12go does not support native seat locking. The fallback path validates requested seats against the booking schema and stores them in cache — no actual supplier-side lock occurs. The locked seats are later picked up during CreateBooking to override seat selection.

All calls to 12go booking logic are **in-process PHP service calls** inside the F3 monolith, not HTTP calls.

---

## Acceptance Criteria

- [ ] Implement seat lock using 12go's internal seat lock service (once available — 12go deploying native lock)
- [ ] 12go deploying native lock (David implementing TC-to-12go connection). By the time Soso reaches this, should be available.
- [ ] Validate before implementing — Eliran cautioned: "Just to make sure we're not doing some temporary solution for a solution that will be solved anyway."

---

## Open Questions (For Grooming)

1. **Native lock availability** — Will 12go's native seat lock be ready by the time this story is picked up? If not, defer the story.
