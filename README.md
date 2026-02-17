# 12go System Transition Design

> **AI Agents**: Start with [AGENTS.md](AGENTS.md) for orientation, key findings, source file paths, and role definitions.

Design documentation for migrating from the current multi-service architecture (Denali, Etna, Fuji, Supply-Integration) to 12go as the core system while preserving all client-facing API contracts.

## Timeline

| Day | Milestone | Status |
|-----|-----------|--------|
| **Tuesday (Feb 17)** | Phase 1: Document current state | DONE |
| **Wednesday (Feb 18)** | Questions for 12go representative | Ready for review |
| **Thursday (Feb 19)** | Draft design with proposed solutions | Pending |

## Context

We are transitioning from a multi-service .NET architecture to using 12go (PHP/Symfony) as the core system. The challenge is that existing clients depend on our API contracts (Denali for booking, Etna for search, Fuji for master data), which are vastly different from 12go's APIs. We need to maintain backward compatibility while simplifying the architecture.

## Key Findings (from Phase 1)

1. **Station ID mapping is the hardest problem** -- clients have Fuji IDs, 12go uses different IDs
2. **Most local storage (DynamoDB) can be eliminated** -- 12go already stores the data
3. **SI framework abstraction is unnecessary** -- only the OneTwoGoApi call logic matters
4. **Authentication is decorative** -- real auth is at the API gateway
5. **Seat locking is faked** -- 12go doesn't support it; we validate locally
6. **Refund calculations diverge** between our system and 12go's
7. **Search pipeline is massively over-engineered** -- only direct 12go call path survives

See [AGENTS.md](AGENTS.md) for the full list of 10 key findings with details.

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
| Authentication | [authentication.md](current-state/cross-cutting/authentication.md) | complete |
| Monitoring | [monitoring.md](current-state/cross-cutting/monitoring.md) | complete |
| Data Storage | [data-storage.md](current-state/cross-cutting/data-storage.md) | complete |
| Messaging | [messaging.md](current-state/cross-cutting/messaging.md) | complete |

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

12go (frontend3) is a PHP/Symfony system that:
- Manages trips, operators, stations internally
- Provides search, cart, booking, confirmation APIs
- Handles ticket generation
- Uses MySQL, Redis, Kafka
- Has its own monitoring (OpenTelemetry compatible)
