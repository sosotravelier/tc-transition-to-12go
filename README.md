# 12go System Transition Design

> **AI Agents**: Start with [AGENTS.md](AGENTS.md) for orientation, key findings, source file paths, and role definitions.

Design documentation for migrating the Travelier Connect API from the current multi-service .NET architecture (Denali, Etna, Fuji, Supply-Integration) to use 12go (One Two Go) as the core system while preserving all client-facing API contracts.

## Scope

- **In scope**: All B2B client-facing endpoints (static data, search, booking funnel, post-booking)
- **Out of scope**: Distribution service, Ushba (pricing -- being sunset), station mapping ID migration, client onboarding

## Team

3-4 .NET developers (2 senior, 1-2 mid/junior) + team lead + 2 DevOps. Go is being considered on 12go's side but not decided. All our expertise is .NET.

## Timeline

| Day | Milestone | Status |
|-----|-----------|--------|
| **Tuesday (Feb 17)** | Phase 1: Document current state | DONE |
| **Wednesday (Feb 18)** | Questions for 12go representative + integrate clarifications | DONE |
| **Thursday (Feb 19)** | Draft design with proposed solutions | Pending |

## Context

We are transitioning from a multi-service .NET architecture (branded "Travelier Connect API") to using 12go (One Two Go, PHP/Symfony) as the core system. The challenge is that existing clients depend on our API contracts (Denali for booking, Etna for search, Fuji for master data), which are vastly different from 12go's APIs. We need to maintain backward compatibility while simplifying the architecture. 12go infrastructure is managed by their DevOps team.

## Key Findings

1. **Station ID mapping is the hardest problem** -- clients have Fuji IDs, 12go uses different IDs
2. **Most local storage (DynamoDB) can be eliminated** -- 12go already stores the data
3. **SI framework abstraction is unnecessary** -- only the OneTwoGoApi call logic matters
4. **Authentication has a mapping gap** -- our API uses clientId + apiKey, 12go only has apiKey
5. **Seat lock is being developed by 12go** -- we currently fake it, but native support is coming
6. **Pricing/Ushba goes away** -- use 12go prices directly (confirmed by management)
7. **Search pipeline is massively over-engineered** -- only direct 12go call path survives
8. **Most Kafka events are redundant** -- no trip lake, no data team consuming them
9. **Client notifications need a transformer** -- 12go has notifications but different data shape
10. **API versioning and correlation headers must be preserved** -- `Travelier-Version`, `x-correlation-id`, `x-api-experiment`

See [AGENTS.md](AGENTS.md) for the full list of 12 key findings with details.

## Phase 1: Current State Documentation

### Client-Facing Endpoints

| Endpoint | Service | Document | Status |
|----------|---------|----------|--------|
| Search Itineraries | Etna | [search.md](current-state/endpoints/search.md) | complete |
| GetItinerary | Denali | [get-itinerary.md](current-state/endpoints/get-itinerary.md) | complete |
| CreateBooking | Denali | [create-booking.md](current-state/endpoints/create-booking.md) | complete |
| ConfirmBooking | Denali | [confirm-booking.md](current-state/endpoints/confirm-booking.md) | complete |
| SeatLock | Denali | [seat-lock.md](current-state/endpoints/seat-lock.md) | complete |
| GetBookingDetails | Denali | [get-booking-details.md](current-state/endpoints/get-booking-details.md) | complete |
| GetTicket | Denali | [get-ticket.md](current-state/endpoints/get-ticket.md) | complete |
| CancelBooking | Denali | [cancel-booking.md](current-state/endpoints/cancel-booking.md) | complete |
| IncompleteResults | Denali | [incomplete-results.md](current-state/endpoints/incomplete-results.md) | complete |
| GetStations | Fuji | [stations.md](current-state/endpoints/stations.md) | complete |
| GetOperators | Fuji | [operators.md](current-state/endpoints/operators.md) | complete |
| POIs | Fuji | [pois.md](current-state/endpoints/pois.md) | complete |
| Booking Notifications | Denali | [notifications.md](current-state/endpoints/notifications.md) | complete |

### Cross-Cutting Concerns

| Topic | Document | Status |
|-------|----------|--------|
| Authentication | [authentication.md](current-state/cross-cutting/authentication.md) | updated |
| Monitoring | [monitoring.md](current-state/cross-cutting/monitoring.md) | updated |
| Data Storage | [data-storage.md](current-state/cross-cutting/data-storage.md) | complete |
| Messaging | [messaging.md](current-state/cross-cutting/messaging.md) | updated |
| API Contract Conventions | [api-contract-conventions.md](current-state/cross-cutting/api-contract-conventions.md) | new |

### Integration Analysis

| Topic | Document | Status |
|-------|----------|--------|
| 12go API Surface | [12go-api-surface.md](current-state/integration/12go-api-surface.md) | complete |
| SI Framework | [si-framework.md](current-state/integration/si-framework.md) | complete |
| Caching Strategy | [caching-strategy.md](current-state/integration/caching-strategy.md) | complete |

## Phase 2: Questions for 12go

[Questions for 12go representative](questions/for-12go.md)

## Phase 3: Design (Thursday)

- [Proposed Architecture](design/proposed-architecture.md)
- [Migration Plan](design/migration-plan.md)

## Architecture Overview

See [current-state/overview.md](current-state/overview.md) for detailed diagrams.

### High-Level Current Flow

```
Clients
  |
  +-- GET /stations, /operators --> Fuji (master data)
  |
  +-- GET /itineraries (search) --> Etna Search --> Etna SI Host --> SI Framework --> 12go API
  |
  +-- GET /itineraries/{id} -----> Denali booking-service --> Etna SI Host --> SI --> 12go API
  +-- POST /bookings ------------> Denali booking-service --> SI Framework --> 12go API
  +-- POST /bookings/{id}/confirm > Denali booking-service --> SI Framework --> 12go API
  +-- GET /bookings/{id} --------> Denali post-booking-service --> DynamoDB (+ SI for tickets)
  +-- GET /bookings/{id}/ticket --> Denali post-booking-service --> SI --> 12go API
```

### What 12go Provides

12go (One Two Go, frontend3) is a PHP 8.3/Symfony 6.4 system that:
- Manages trips, operators, stations internally
- Provides search, cart, booking, confirmation APIs
- Handles ticket generation and notifications
- Uses MariaDB (MySQL-compatible), Redis, Kafka (business events), ClickHouse (analytics)
- Logs on Datadog; basic CPU/memory monitoring
- Infrastructure fully managed by their DevOps team
- Is developing native seat lock functionality
