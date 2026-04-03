# Project Context

**Last Updated**: 2026-04-03 | **Last Verified**: 2026-04-03
**Status**: Q2 Implementation — Pre-coding (architecture resolved, scope confirmed, Jira epic created)

---

## 1. What This Project Is

Replacement of the B2B API layer between external clients and 12go's travel platform. Current: 4 .NET repos (~342 projects) proxying to 12go. New system preserves client API contracts inside F3 (PHP/Symfony monolith). Out of scope: Distribution, Ushba, station mapping, client onboarding process, gRPC.

## 2. Architecture Decision

**Resolved: PHP/Symfony inside F3 monolith** with overlays: PE observability (DogStatsD metrics, structured logging), DA events (5 MVP structured log events), DI adapter boundary (`TwelveGoClientInterface`). Flat 3-layer: handler / mapper / 12go client. Separate B2B DB schema. Redis for booking schema cache, APCu for ID mappings. **Persistence**: default is stateless (12go as source of truth), but local persistence may be needed for client migration scenarios, notifications, or if existing TC becomes first client of new endpoints.

## 3. What We're Building

**Q2: new clients only, 12go native IDs.** Migration plan is a Q2 documentation deliverable (not code).


| #   | Endpoint                | Status       | Difficulty | Notes                                                  |
| --- | ----------------------- | ------------ | ---------- | ------------------------------------------------------ |
| 1   | Search                  | POC complete | Low        | Recheck → search team, not Soso                        |
| 2   | GetItinerary            | Spec complete (ST-2484) | High       | Split from schema; **next priority**. Schema is separate task, prerequisite for CreateBooking |
| 3   | Stations/Operators/POIs | Specs created (ST-2486/87/88) | Medium     | 3 separate stories; ownership may move to catalog team; POI need questioned by Shauly |
| 4   | CreateBooking           | Not started  | High       | Core funnel; explore internal F3 method for schema     |
| 5   | ConfirmBooking          | Not started  | Medium     |                                                        |
| 6   | GetBookingDetails       | Not started  | Low        | Runtime 12go API call, no local DB                     |
| 7   | GetTicket               | Not started  | Low        | URL passthrough likely sufficient                      |
| 8   | CancelBooking           | Not started  | Low        | Use 12go refund_amount directly                        |
| 9   | SeatLock                | Not started  | Low        | Lowest priority; 12go developing native support        |
| 10  | Notifications           | Not started  | Medium     | **Deferred** — not needed for new client onboarding    |


## 4. Decided

- **Mar 12**: Default stateless (no local persistence); booking ID mapping for legacy only. Persistence TBD for migration/notifications.
- **Mar 17**: PHP/F3 monolith; solo developer; design not throwaway
- **Mar 18**: Q2 = new clients only; PHP buddy; gRPC out
- **Mar 23**: Separate B2B DB schema; no feature flag needed for search; F3 background jobs
- **Mar 25**: Use 12go native booking IDs for new clients
- **Mar 25**: Keep `client_id` in URL (don't remove); don't validate correspondence initially
- **Mar 25**: Recheck/206 is product + search team responsibility, not Soso
- **Mar 25**: Notifications deferred — not blocking new client onboarding
- **Mar 25**: Follow 12go conventions wherever possible (Eliran: "12go should become yet another brand")
- **Mar 25**: Migration plan added as Q2 documentation deliverable
- **Mar 25**: DNS routing investigation → Tal (DevOps)
- **Mar 25**: Valeri as PHP buddy; Soso added to F3 guild Slack
- **Mar 30**: GetItinerary split from booking schema — two separate tasks; itinerary (without schema) is next priority (Shauly)
- **Mar 30**: Migration plan: document full path, no Jira tickets for migration tasks yet (Shauly)
- **Mar 30**: Integration environment needs investigation — add as story (Shauly)
- **Apr 3**: Client identity managed via Stats Admin Portal (`/front/stats/`, Partners screen) — not a separate service. F3 is read-only for `apikey`/`usr` tables. New `client_id` field requires Stats portal modification. (Soso discovery)

## 5. Current Constraints

- **Solo developer** (Soso), AI-assisted, Valeri as PHP buddy
- Q2 deadline — new clients onboard on new system
- PHP 8.3/Symfony 6.4 inside F3, separate B2B schema
- Default stateless, but persistence needs may emerge (migration, notifications, TC-as-first-client)
- Booking schema parser is make-or-break (~1180 LOC C#)
- Jira epic **ST-2483** tracks all work in ST project; stories: ST-2484 (GetItinerary), ST-2485 (Client Identity), ST-2486 (Stations), ST-2487 (Operating Carriers), ST-2488 (POIs). Integration Environment story planned (not yet created). Possible Jira → Linear migration (company-wide)
- QA automation engineer gone — test ownership unresolved
- Cross-cutting AC for all endpoint stories: structured logging (request/response, errors, client context), meaningful error responses, correlation ID forwarding, structured events for Datadog→ClickHouse

## 6. Open Questions

- **Stations/operators ownership**: catalog team or Soso? (Eliran discussing)
- **Itinerary ID format**: deferred, needs decision before search goes to prod
- **Using 12go IDs**: Eyal flagged as product decision needing formal confirmation
- **Kafka events**: what does data team need? unified with 12go? no owner assigned
- **Booking schema optimization**: can internal F3 method reduce transformation?
- **Client identity table design**: add `client_code` to existing `usr` table vs new `b2b_clients` table? Stats Admin Portal change needed either way. (Soso + Sana — ST-2485)
- **Multi-transport operator splitting**: replicate TC logic (split per transport type) or use 12go native array? (Product/team — ST-2487)
- **Ticket branding**: 12go logo vs client branding on PDFs
- **E2E test ownership**: QA engineer gone
- **Existing TC as first client?** Discussion to have TC be the first consumer of new endpoints — would change scope (backward compat needed earlier)
- **Local persistence scope**: stateless default may not hold for notifications, client migration, or TC-as-first-client scenarios
- **Implementation sequence**: not finalized — depends on ownership decisions (catalog team) and scope evolution
- **Integration environment**: dedicated story planned — verify existence, connectivity, booking flow testability (Soso + Sana)
- **Logging approach**: codified as cross-cutting AC; F3 logging patterns still TBD — needs investigation before first endpoint goes to prod
- **12go test coverage**: what unit/E2E tests exist in F3 CI? Unknown

## 7. Key People


| Person  | Role                                         |
| ------- | -------------------------------------------- |
| Soso    | Sole developer, AI-assisted                  |
| Shauly  | Product owner, monitoring discovery          |
| Eliran  | Leadership, stakeholder alignment            |
| Eyal    | Architecture/product, booking flow expertise |
| Avikhai | Product, client perspective                  |
| Sana    | 12go tech lead, deploys to prod              |
| Valeri  | PHP buddy                                    |
| Tal     | DevOps, DNS routing investigation            |
| David   | DeOniBus migration, client identity          |


## 8. Implementation Sequence

**Tentative sequence** (not finalized — depends on ownership and scope decisions): Search (POC done) → GetItinerary without schema (next priority) → Booking schema parser (separate task, prerequisite for CreateBooking) → Master data (if not catalog team) → Booking funnel (CreateBooking, Confirm) → Post-booking (GetBookingDetails, GetTicket, Cancel) → SeatLock (lowest). Notifications deferred. Migration plan documented in Q2 (full path, no Jira tickets for migration tasks yet). **Integration environment investigation** needed early — prerequisite for booking flow testing. **Note**: if existing TC becomes first client, sequence and backward-compat requirements change significantly.

**Red Team risks**: (1) booking schema parser port, (2) solo developer SPOF, (3) PHP-FPM memory model for mappings, (4) F3 local dev friction.

## 9. Reference Index


| Document                                    | Description                                          |
| ------------------------------------------- | ---------------------------------------------------- |
| `current-state/overview.md`                 | Architecture, all endpoints, service map             |
| `prompts/context/codebase-analysis.md`      | .NET keep/discard analysis                           |
| `current-state/search-poc/`                 | POC results + local env friction doc                 |
| `design/decision-map.md`                    | 14 convergences, 17 decisions                        |
| `design/recommendation.md`                  | PHP/F3 + overlays, 84.5/130                          |
| `design/implementation/README.md`           | Endpoint priority and tracking                       |
| `meetings/2026-03-12-.../new-findings.md`   | Migration solutions: API keys, booking IDs, webhooks |
| `meetings/2026-03-17-.../meeting-record.md` | Solo dev, Q2 deadline, not throwaway                 |
| `meetings/2026-03-18-.../meeting-record.md` | Q2 scope, PHP buddy, gRPC out                        |
| `meetings/2026-03-23-.../meeting-record.md` | CI/CD flow, separate schema, background jobs         |
| `meetings/2026-03-25-.../meeting-record.md` | **MOST AUTHORITATIVE**: 9 decisions, scope changes   |
| `meetings/2026-03-30-.../meeting-record.md` | Pre-holiday sync: GetItinerary next, schema split, migration plan scope |
| Jira epic ST-2483 (ST project)              | Q2 B2B API Transition — all stories and dependencies                 |
| `meetings/2026-03-25-.../jira-items-draft.md` | Full story breakdown with ACs (23 active + 10 deferred)            |


