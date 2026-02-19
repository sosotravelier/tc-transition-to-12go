# System Context

> Inject this context block into every design and reviewer agent prompt.

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

| Role | Count | Notes |
|------|-------|-------|
| Senior .NET Developers | 2 | 12 years experience each, 2 years at company |
| Mid/Junior .NET Developer | 1-2 | Recently onboarded |
| Team Lead | 1 | Deep system knowledge, less current on coding/AI |
| DevOps | 2 | Transitioning to 12go infra but supporting us |
| 12go Veterans | available | PHP experts for advice/clarification |
| Customer Success | 1 | |
| Product | 1 | |

## Key Constraints
- All development expertise is in .NET
- PHP is not preferred by the team, feasible with AI assistance
- Go is being considered by 12go but nothing is decided
- Developer experience is a priority -- team focus and stability are prioritized during major system changes
- AI-augmented development is heavily used (Cursor, Claude)
- Near-term team focus is prioritized
- Infrastructure is DevOps-managed -- we don't manage servers
- Configurations: 12go uses .env files + DB-stored integration configs

## Critical Open Questions
1. **API key mapping**: Our API uses clientId + apiKey; 12go only has apiKey
2. **Monitoring unification**: We use Coralogix/Grafana; 12go uses Datadog
3. **Multi-client configuration**: How does 12go handle per-client pricing/markup?
4. **Notification transformation**: 12go notifications have different shape than what clients expect
5. **Static data (stations/operators)**: Current system uses Fuji IDs; 12go uses different IDs (out of scope but affects design)
6. **Credit line**: Does 12go have equivalent functionality?
7. **Seat lock**: Being developed on 12go side -- timeline unknown
