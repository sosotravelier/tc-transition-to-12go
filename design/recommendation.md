---
status: draft
last_updated: 2026-03-17
---

# Recommendation

## Previous Recommendation

No Phase 3 evaluation was run prior to this version. The decision map noted all decisions as "Pending Phase 3."

---

## Recommendation: Team-First Developer (PHP/Symfony inside F3) with Platform Engineer and Disposable Architecture overlays

**Total score: 84.5 / 130** (3rd by raw score, 1st among viable designs)

### Why Not the Highest-Scoring Design?

Clean Slate Designer (Go) scored highest at 90/130 on pure technical merit. However, the Red Team identified **conditional fatal flaws** that make it unselectable without explicit organizational prerequisites that do not currently exist:

1. **Nobody in the organization writes Go.** Soso has zero Go experience. 12go's DevOps has never operated a Go container. After Soso's departure, the service becomes an orphan in a PHP ecosystem.
2. **The "one system" directive is directly violated.** Team Lead explicitly stated (Mar 17) that separation between 12go core and B2B should not be permanent. A Go microservice is a permanent separation.
3. **DevOps has not confirmed willingness to support Go.** This is an unresolved hard dependency.

If all three prerequisites were met (DevOps approval, management approval, identified co-maintainer), Go would be the correct technical choice. They are not met today.

### Why Team-First Developer Over the Other PHP Designs?

The three PHP-in-F3 designs (PM, TF, DA overlay) score within 3.5 points of each other (81, 84.5, 68). The differentiation is in the details:

| Factor | PM (81) | TF (84.5) | PE (86.5) |
|---|---|---|---|
| Testing approach | "Port tests" (generic) | **Fixture-driven AI translation from C# tests** (specific, actionable) | Not specified |
| AI optimization | None | **AGENTS.md, naming conventions, file structure** | None |
| Disposability (C9) | 2/5 | **3/5** (namespace separation, mapper isolation) | 2/5 |
| Testing Ease (C7) | 3/5 | **4/5** (fixture pairs, explicit test structure) | 3.5/5 |
| F3 monolith alignment | Yes | Yes | **No** (standalone -- conflicts with Team Lead's co-location preference) |

**Platform Engineer** scores 2 points higher (86.5) but recommends a standalone service, which Team Lead explicitly argued against on Mar 17. Its strongest contribution (observability) is adoptable as an overlay.

**Team-First Developer** wins on:
- Best testing strategy (fixture-driven AI translation)
- Best AI tooling story (AGENTS.md, naming conventions, explicit structure)
- Best alignment with organizational constraints (PHP, inside F3, maintainable post-departure)
- Highest medium-weight score (32/40) -- strongest on Testing Ease, Infrastructure Fit, and Disposability among PHP-in-F3 designs

### Required Overlays

The recommended design is Team-First Developer enhanced with:

1. **Platform Engineer's observability specification** -- Adopt the 10 DogStatsD metrics, 3 alerting rules, structured JSON logging format, and health check design. This addresses TF's C11 gap (3/5 → target 4-5/5).

2. **Data Flow Architect's event schemas** -- Adopt structured log event emission for the 14 critical events. Start with 5 minimum viable events (search.completed, booking.created, booking.confirmed, booking.cancelled, notification.received). This addresses the "dashboards go dark" risk.

3. **Disposable Architecture's adapter boundary (lightweight)** -- Adopt namespace separation and mapper service isolation (already in TF's design). Add a single outbound interface (`TwelveGoClientInterface`) as the seam for future replacement. Do NOT adopt the full three-type-hierarchy domain model -- it adds too much overhead for a solo developer. This is a pragmatic compromise: one interface instead of three, preserving the most valuable 20% of the adapter pattern at 20% of the cost.

---

## Decision Impact on Open Questions

| Decision (from decision-map) | Resolved? | Value |
|---|---|---|
| D1: Language choice | **Resolved: PHP** | Organizational alignment, post-departure maintainability, infrastructure fit |
| D2: Deployment model | **Resolved: Inside F3 monolith** | Team Lead preference, one codebase, no new infrastructure |
| D3: Architectural layering | **Resolved: Flat with lightweight interface** | TF's 3-layer + one outbound interface from DI |
| D5: Per-client rollout mechanism | Still open -- investigate gateway routing this week | App-level feature flag (TF's approach) as fallback |
| D6: Booking schema caching | **Resolved: Redis** | PHP-FPM per-request model requires external cache. Use APCu for ID mapping tables (persistent within worker). |
| D7: ID mapping table storage | **Resolved: APCu + MariaDB fallback** | Static data loaded per-worker via APCu, sourced from MariaDB table. Avoids per-request Redis lookups on search hot path. |
| D8: Event emission strategy | **Resolved: Structured logs (DA approach)** | Pending data team confirmation; structured logs as default, Kafka upgrade path if needed. |

---

## Red Team Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| F3 local dev friction | High/High | Invest 2 days resolving setup issues before coding. If unresolvable after 2 days, fall back to PE's standalone PHP approach. |
| Booking schema parser port | High/Medium | Port parser FIRST (weeks 1-2) using C# test fixtures. If not code-complete with passing tests by week 3, reassess timeline. |
| PHP learning curve | High/Medium | Schedule daily 1-hour pairing with 12go PHP veteran for first 2 weeks. Not "available for consultation" -- scheduled sessions. |
| Gateway routing unresolved | Medium/Medium | Investigate this week. TF's app-level feature flag is the fallback (no DevOps dependency). |
| Event pipeline gap | High/High | Adopt DA's structured log events. Have data team call before implementation starts. |
| Solo developer SPOF | High/High | Organizational: reduce scope (drop notifications, gRPC), add QA resource, maintain AGENTS.md for handoff. |
| PHP-FPM ID mapping latency | Medium/High | Use APCu (per-worker persistent cache) for station/operator/seat-class mappings. Test search latency in week 3. |

---

## Recommended Execution Plan

Based on Execution Realist's timeline assessment (11 weeks realistic):

| Week | Deliverable | Validation |
|---|---|---|
| 1 | F3 environment setup, B2B module structure, AGENTS.md, station ID mapping data extracted | Environment stable, first route registered |
| 2-3 | Search + GetItinerary + booking schema parser | Search shadow traffic comparison, parser tests pass against C# fixtures |
| 4-5 | CreateBooking + ConfirmBooking + GetBookingDetails | Booking funnel end-to-end test against 12go staging |
| 6-7 | GetTicket + CancelBooking + SeatLock (stub) | Post-booking operations tested |
| 8 | Master data endpoints (Stations, Operators, POIs) + structured event emission | Events visible in Datadog |
| 9-10 | Shadow traffic for search, first client cutover (internal test), monitoring | Metrics baseline established |
| 11+ | Per-client rollout, notification transformer (if not offloaded) | Clients migrated |

**Scope reduction safety valve**: Core Q2 deliverable is 7 endpoints (Search, GetItinerary, CreateBooking, ConfirmBooking, GetBookingDetails, GetTicket, CancelBooking). Notifications and master data endpoints can follow. gRPC is scoped out.

---

## Confidence Level

**Medium-High.** The recommendation is the best available choice given the constraints (solo developer, PHP organization, Q2 deadline, Team Lead's co-location preference). The gap between #1 (CS at 90) and the recommended design (TF at 84.5) is 5.5 points -- driven entirely by Go's technical advantages in Performance (C4) and Simplicity (C5) that are offset by organizational reality.

The strongest risk is that the PHP learning curve is worse than estimated. The early warning signal is clear: if the first complete endpoint takes more than 5 working days, the timeline must be adjusted. The fallback is aggressive scope reduction, not a language change.
