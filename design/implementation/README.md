# Implementation Tracking (Phase 4)

Per-endpoint implementation status, plans, and notes for the Q2 transition.

## Structure

Each endpoint gets its own directory when implementation begins:

```
implementation/
├── search/              # First endpoint (POC complete)
│   ├── plan.md          # Implementation plan, decisions, dependencies
│   ├── status.md        # Current status, blockers, progress
│   └── notes.md         # Dev notes, gotchas, learnings
├── get-itinerary/       # Next endpoint
│   └── ...
└── README.md            # This file
```

## Endpoint Priority (from Mar 18 meeting)

| Priority | Endpoint | Status | Notes |
|----------|----------|--------|-------|
| 1 | Search | POC complete | Needs feature flag, merge decision pending |
| 2 | GetItinerary | Not started | Includes booking schema parser |
| 3 | Stations / Operators / POIs | Not started | Master data — required for client onboarding |
| 4 | CreateBooking | Not started | Core booking funnel |
| 5 | ConfirmBooking | Not started | Core booking funnel |
| 6 | GetBookingDetails | Not started | Post-booking |
| 7 | GetTicket | Not started | Post-booking |
| 8 | CancelBooking | Not started | Post-booking |
| 9 | SeatLock | Not started | Lowest priority — after full booking funnel |
| 10 | Notifications | Not started | May be offloaded to another developer |

## Cross-Cutting Concerns

Track these alongside endpoint work:

- [ ] Feature flagging approach (ask Sana)
- [ ] Booking ID format decision (validate with Sana)
- [ ] Monitoring/metrics implementation (per-API counts, response times)
- [ ] Separate DB schema for B2B tables
- [ ] Kafka event emission (pending data team pairing)
