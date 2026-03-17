# System Context

> Inject this context block into every design and reviewer agent prompt.

## Historic Context

We are in a big transition. As part of it, we want to **demolish all of our services** (Denali, Etna, Fuji, Supply-Integration) and use **12go as the main core of the system**. 12go has the capability to handle integrations. Without existing clients, it would be straightforward to kill all of Etna and Denali — but we have clients depending on API contracts that are vastly different from 12go's. We must preserve those contracts while simplifying the architecture.

**Infrastructure**: We will migrate our infrastructure to 12go's cloud. The exact approach (copy minimal services vs. write from scratch) is part of the design.

**Design goal**: Clients must not break, and the new system must be easy to maintain.

See `prompt-log.md` for the full initial prompt and session history.

## Meeting Outcomes (2026-02-25)

A meeting with Team Lead, RnD, Architect, and Oleksandr (12go veteran) surfaced the following:

- **F3 breakdown is planned but has no timeline** — "Beginning of the beginning of planning." No target language, no milestones. Estimated "a couple of quarters, not one." F3 redesign is not this quarter.
- **"One system" vision** — Management emphasized there is no permanent separation between 12go core and B2B. The long-term goal is one cohesive system, not a layer on top of F3.
- **Event/data correlation requirement** — Sunsetting SI Host would lose the ability to correlate supply-side and client-side events. B2B-specific events must be preserved or created for ClickHouse/data team. Requirements to be defined.
- **F3 capabilities discovered** — F3 already has `VersionedApiBundle` (API versioning), `ApiAgent` (partner identity), and Datadog APM tracing. These reduce implementation effort for monolith option.
- **POC-first approach agreed** — Implement the **Search** endpoint inside F3 to evaluate friction. (Team lead proposed GetItinerary; Soso proposed Search; settled on Search first.)
- **Post-meeting clarification**: RnD confirmed .NET microservice is still an option. Architecture decision deferred, not rejected.

## Meeting Outcomes (2026-03-12)

A migration problem analysis session with Soso and Shauly surfaced concrete solutions and new complexity for several migration issues:

- **API key transition clarified** — Shauly's preferred approach: clients switch to 12go API keys directly. Alternative: copy TC API keys into 12go's database (format appears compatible). A "client identity" SDK already loads client-API key pairs from a database at startup. 12go's client creation process will need to include TC's client ID.
- **Booking ID transition is manageable** — Need a one-time static mapping table (old booking ID → 12go bid) for post-booking operations only. KLV-format IDs contain the 12go `bid` embedded; short IDs do not. Legacy non-12go integrations (FlixBus shutting down, DeOniBus being migrated) will sunset naturally — very few bookings remain after June.
- **No-persistence design confirmed** — Eliminate local DB layer for booking details; rely entirely on 12go as source of truth. Some data (e.g., cancellation policy) will need additional API calls to fetch.
- **Data team coordination needed** — Performance dashboards (per-client searches, itineraries, checkouts) must be preserved. Need to verify if 12go's existing events cover TC requirements. Call with data team pending.
- **Monitoring gap confirmed** — 12go uses Datadog with traces and metrics, but unclear what they actively monitor. Recent 500 error incident highlighted the gap. Deeper dive needed.
- **Recheck mechanism is a known gap** — Current TC recheck is inadequate. Trip pool behavior unclear. Hope 12go provides a solution.
- **Seat lock in active development** — 12go side confirmed. David will integrate as part of DeOniBus migration. Simple outcome: just use new 12go endpoint once available.
- **NEW mapping dimensions discovered** — Seat classes (class ID) and vehicle IDs need mapping in addition to station IDs. SI host has existing mappers for these.
- **Webhook routing clarified** — 12go knows booking→client mapping. Can change webhook URL to point to client's actual URL. Format transformation still needed (12go format → TC format). Client ID can be embedded as query param in webhook URL.
- **Encryption decision open** — Should booking ID, itinerary ID, and booking token be encrypted in the new system?
- **Client migration process undefined** — What changes does each client face? (API key, URLs, booking ID format, station IDs). "First thing we'll face."

## Meeting Outcomes (2026-03-17)

Team Lead sync on transition planning, timeline, and resourcing:

- **F3 refactoring planned for Q2** — Major refactoring of F3 is planned, but planning starts in Q2. Scope and target language still unclear. Team Lead argues this favors monolith: easier to refactor when everything is together. Soso counter-argues: rewriting .NET→PHP→something else is wasteful.
- **Transition design is NOT throwaway** — Team Lead confirmed the design will live for a significant time. After transition, new clients onboard on the new system, old clients migrate gradually. The refactoring will be incremental, not big-bang. Design needs to be reasonably solid.
- **Solo developer resourcing** — Team Lead revealed Soso will be the only developer on this transition. Soso expected 4 .NET developers and pushed back. Team Lead is open to altering the plan but leaning toward solo.
- **Scope reduction possible** — gRPC module could be scoped out. Booking notification (different topology) could potentially be offloaded. Monitoring/metrics discovery is exploration work Soso does not want to own.
- **Q2 deliverable commitment needed** — New clients should be able to onboard on the new system in Q2. Architecture decision (monolith vs microservice) needed ASAP.
- **AI-assisted development is the plan** — Soso will heavily use Claude Code, multi-agent workflows to compensate for solo resourcing.
- **Additional F3 capabilities needed** — Cancellation policies and similar features will need to be exposed through F3, arguing for monolith approach (changes in 1 place).
- **F3 local development is painful** — Search POC revealed setup difficulties. Microservice would be more straightforward to develop against, but still needs 12go running locally for integration testing.
- **Performance testing likely needed** — Open question whether to test the new system or wait for refactored one.

## Development Workflow Constraints

These are not arguments in a debate — they are facts about how development will work during the transition period. Any proposed architecture must account for them.

**F3 feature development runs in parallel with the B2B transition.**
New capabilities need to be added to F3 during the transition — cancellation policies are a confirmed example, and more are expected. This means whoever is building the B2B layer will also be making changes to F3 at the same time. A standalone B2B service does not eliminate F3 local dev work; it adds a second codebase to maintain simultaneously.

**F3 must run locally regardless of B2B architecture choice.**
Integration testing and new F3 feature development both require a working F3 local environment. The question is not "F3 locally vs. not" — it is "F3 locally only, or F3 locally plus a second service locally."

**The "one system" vision is a hard organizational constraint.**
Management explicitly stated there is no permanent separation between 12go core and B2B. The long-term goal is one cohesive system. Designs that create a separate microservice are working against this direction and will require a second migration when F3 is refactored. Designs that embed within F3 align with it.

**Co-location reduces refactoring risk when F3 is decomposed.**
When F3 is eventually refactored, having B2B code co-located means the team can see all the invariants in one place. A separate service — especially in a different language — is an external dependency that must be analyzed, reverse-engineered, and migrated separately. Team Lead explicitly identified this as a reason to prefer the monolith.

---

## What We're Building

A replacement for the B2B API layer that currently sits between external clients and 12go's travel platform. The current system is 4 .NET repositories (~340 projects total) that essentially proxy HTTP calls to 12go. The new system must preserve the client-facing API contract while dramatically simplifying the architecture.

## Scope

- **In scope**: All B2B client-facing endpoints (static data, search, booking funnel, post-booking), notification transformer
- **Out of scope**: Distribution service, Ushba (pricing -- being sunset), station mapping ID migration, client onboarding

## Current Services Being Replaced

| Service | Repo | Purpose | Approx Size |
|---------|------|---------|-------------|
| Etna Search | etna | Itinerary search for clients | ~72 projects |
| Denali booking-service | denali | Booking funnel (GetItinerary, Reserve, Confirm, SeatLock) | ~46 projects |
| Denali post-booking-service | denali | Post-booking (GetBookingDetails, GetTicket, Cancel) | part of denali |
| Denali booking-notification-service | denali | Webhook receiver for supplier notifications | part of denali |
| Fuji | fuji | Master data (stations, operators, POIs) | ~108 projects |
| Supply-Integration framework | supply-integration | Multi-supplier abstraction layer | ~116 projects |

## 12go Platform (The Target Backend)

| Component | Technology |
|-----------|-----------|
| Application | PHP 8.3 / Symfony 6.4, monolith |
| Database | MariaDB (MySQL-compatible) |
| Cache | Redis |
| Messaging | Kafka (business events only) |
| Analytics | ClickHouse |
| Logs/Metrics | Datadog |
| Infrastructure | 8 EC2 instances, fully DevOps-managed |
| Environments | Local (Docker), Staging, PreProd (canary), Prod |
| Future direction | Considering Go, but nothing decided |

## Client-Facing API Contract (13 Endpoints)

### Search & Booking Funnel
1. **Search** `GET /v1/{client_id}/itineraries` -- 1 call to 12go (`GET /search/{from}p/{to}p/{date}`)
2. **GetItinerary** `GET /{client_id}/itineraries/{id}` -- 3 calls to 12go (trip details + add to cart + checkout schema)
3. **CreateBooking** `POST /{client_id}/bookings` -- 2 calls (reserve + get booking details)
4. **ConfirmBooking** `POST /{client_id}/bookings/{id}/confirm` -- 2 calls (confirm + get booking details)
5. **SeatLock** `POST /{client_id}/bookings/lock_seats` -- no 12go call yet (being developed on 12go side)

### Post-Booking
6. **GetBookingDetails** `GET /{client_id}/bookings/{id}` -- currently reads from local DB (could proxy to 12go)
7. **GetTicket** `GET /{client_id}/bookings/{id}/ticket` -- 1 call to 12go for ticket URL
8. **CancelBooking** `POST /{client_id}/bookings/{id}/cancel` -- 2 calls (refund options + refund)
9. **IncompleteResults** `GET /{client_id}/incomplete_results/{id}` -- polling for async operations

### Master Data
10. **Stations** `GET /v1/{client_id}/stations` -- pre-signed S3 URLs (Fuji station IDs)
11. **Operators** `GET /v1/{client_id}/operating_carriers` -- pre-signed S3 URLs
12. **POIs** `GET /v1/{client_id}/pois` -- province-based search

### Notifications
13. **Booking Notifications** -- webhook receiver from 12go (currently no authentication on 12go side)

## API Contract Conventions (Must Preserve)
- Versioning via `Travelier-Version` header (YYYY-MM-DD format)
- Correlation headers: `x-correlation-id`, `x-api-experiment`
- Money format: amounts as strings (`"amount": "14.60"`)
- Pricing structure: net price, gross price (with `price_type`), `taxes_and_fees`
- 206 Partial Content for incomplete supplier data
- Confirmation types: Instant vs Pending
- Ticket types: Paper Ticket, Show On Screen, Pick Up

## 12go API Surface (What We Call)

11 endpoints via HTTP REST with API key as query parameter (`k=<api-key>`):

| Operation | 12go Endpoint | Method |
|-----------|--------------|--------|
| Search | `/search/{from}p/{to}p/{date}?seats={n}&direct=true` | GET |
| Get trip details | `/trip/{tripId}/{datetime}?seats={n}` | GET |
| Add to cart (trip ID) | `/cart/{tripId}/{datetime}?seats={n}` | POST |
| Add to cart (body) | `/cart?seats={n}&lang=en` | POST |
| Get cart details | `/cart/{cartId}` | GET |
| Get booking schema | `/checkout/{cartId}?people=1` | GET |
| Reserve | `/reserve/{bookingId}` | POST |
| Confirm | `/confirm/{bookingId}` | POST |
| Get booking details | `/booking/{bookingId}` | GET |
| Get refund options | `/booking/{bookingId}/refund-options` | GET |
| Refund | `/booking/{bookingId}/refund` | POST |

## Scale Context

12go is one of the biggest travel tech companies in Southeast Asia and LATAM. They sell a high volume of tickets. Key performance requirements:
- **Search must be fast and responsive** -- this is the most latency-sensitive operation
- **Booking flow is less latency-critical** -- users accept slightly longer waits during checkout
- Search is backed by MariaDB in 12go; rechecks go to actual integrations and can take up to 1 minute
- 12go uses Redis for caching search results

## Team Composition

**UPDATE (2026-03-17)**: Team Lead confirmed Soso will likely be the **sole developer** on this transition. Original team composition below is the broader team; only Soso is allocated to this work.

| Role | Count | Allocated to Transition | Notes |
|------|-------|------------------------|-------|
| Senior .NET Developer (Soso) | 1 | **Yes — sole developer** | 12 years experience, 2 years at company. Heavily uses AI-assisted development (Claude Code, multi-agent workflows) |
| Senior .NET Developers (others) | 1-2 | No | Available for consultation but not assigned |
| Mid/Junior .NET Developer | 1-2 | No | Recently onboarded |
| Team Lead | 1 | Oversight only | Deep system knowledge, decision maker. Not available for coding |
| DevOps | 2 | Supporting | Transitioning to 12go infra |
| 12go Veterans | available | Advisory | PHP experts for advice/clarification |
| Customer Success | 1 | No | |
| Product | 1 | No | |

**Resourcing risks identified** (Mar 17 meeting):
- Monitoring/metrics discovery — exploration work, Soso does not want to own
- gRPC module — considered risky, Team Lead said it could be scoped out
- Booking notification — different topology, could potentially be offloaded
- Testing — "conveyor belt" approach (new endpoint every ~2 days) requires dedicated QA

## Current API Gateway

- **Technology**: AWS API Gateway -- sits in front of all B2B client-facing endpoints
- **Routing**: Routes by path + HTTP method. All requests to `/v1/{client_id}/itineraries` go to the same backend integration regardless of which `client_id` is in the URL.
- **Authentication**: Real API key enforcement happens at the gateway level. Service-level auth handlers are passthroughs (always succeed).
- **Per-client routing**: AWS API Gateway does NOT natively support routing to different backends based on path parameter values. This is a key constraint for gradual per-client migration.
- **Status**: Exact gateway configuration (Lambda authorizers, integration targets, stage setup) is **not yet investigated** -- needs DevOps input.

## Authentication Mapping Gap

This is one of the hardest operational problems in the transition:

- **Our API**: Clients call with `client_id` in URL path + `x-api-key` header. Gateway validates the key. Services receive the request with client identity resolved.
- **12go API**: Single `apiKey` passed as query parameter `?k=<api-key>`. No concept of `client_id`.
- **No existing mapping** between our clientId/apiKey pairs and 12go apiKeys.
- **Three options identified** (from management):
  - A: Map existing gateway keys to 12go keys (config table)
  - B: New gateway that handles the translation
  - C: Clients use 12go keys directly (requires client changes)

See `current-state/cross-cutting/authentication.md` for full analysis.

## Key Constraints
- All development expertise is in .NET
- **Solo developer** — Soso is the only developer allocated to the transition (as of Mar 17). Designs must be implementable by one person with heavy AI assistance. This is the single most important constraint for design feasibility.
- **Q2 2026 deadline** — New clients should be able to onboard on the new system in Q2. Architecture decision needed ASAP.
- **Not throwaway** — The transition design will live for a significant time. Old clients migrate gradually after transition. Design needs to be reasonably solid, not a quick hack.
- **12go HTTP API stability**: Previously assumed stable. Now **uncertain** — F3 restructuring may change the API surface. Design should account for this risk.
- **F3 refactoring planned** — Planning starts Q2 2026, but no plan exists yet (no timeline, no target language). Code written inside F3 today may require a second migration when F3 is demolished. Team Lead argues this favors monolith (everything together = easier to refactor). Soso argues rewriting .NET→PHP→something else is wasteful.
- **Technology choice**: The team's production experience is entirely in .NET. 12go's stack is PHP 8.3/Symfony 6.4. Business sees alignment with 12go's stack as reducing long-term operational risk. If the chosen language differs from the team's existing expertise, the solution must account for ramp-up cost and ensure maintainability (e.g., AI-augmented development, simple patterns, 12go veteran support).
- Go is being considered by 12go but nothing is decided
- Developer experience is a priority -- team focus and stability are prioritized during major system changes
- AI-augmented development is heavily used (Claude Code with multi-agent workflows)
- Near-term team focus is prioritized
- Infrastructure is DevOps-managed -- we don't manage servers
- Configurations: 12go uses .env files + DB-stored integration configs
- **Scope reduction possible** — gRPC module could be scoped out, booking notification could be offloaded, monitoring discovery could be owned by someone else
- **No local persistence** — Confirmed (Mar 12): eliminate local DB layer, rely on 12go as source of truth. Some data needs additional API calls.

## Critical Open Questions

### Partially Answered (Mar 12)
1. **API key mapping**: Preferred approach is clients switch to 12go API keys directly. Alternative: copy TC keys into 12go DB (format compatible). Still needs: 12go client creation to include TC client ID. See Authentication Mapping Gap above.
5. **Notification transformation**: Webhook routing clarified — 12go knows booking→client, can route directly. Format transformation still needed (12go→TC format). Client ID can be embedded in webhook URL.
8. **Seat lock**: Actively being developed on 12go side. David will integrate as part of DeOniBus migration. Simple: just use new endpoint once available.

### Still Open
2. **Gateway routing for migration**: Can AWS API Gateway be configured for per-client backend routing? Needs DevOps investigation.
3. **Monitoring unification**: We use Coralogix/Grafana; 12go uses Datadog. Gap confirmed (Mar 12) — unclear what 12go actively monitors. Deeper dive needed.
4. **Multi-client configuration**: How does 12go handle per-client pricing/markup?
6. **Static data (stations/operators)**: Current system uses Fuji IDs; 12go uses different IDs (out of scope but affects design). NEW: seat classes and vehicle IDs also need mapping.
7. **Credit line**: Does 12go have equivalent functionality?
9. **Data team event requirements**: Which TC events need preserving? Does 12go already cover some? Call with data team pending. (NEW from Mar 12)
10. **Encryption**: Should booking ID, itinerary ID, and booking token be encrypted in the new system? (NEW from Mar 12)
11. **Client migration process**: What exactly changes for each client? (API key, URLs, booking ID format, station IDs). Not yet defined. (NEW from Mar 12)
12. **Recheck mechanism**: Current TC recheck inadequate, trip pool behavior unclear. Hoping 12go provides solution. (NEW from Mar 12)
