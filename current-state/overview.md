---
status: complete
last_updated: 2026-02-17
---

# Current System Architecture Overview

## Services Summary

| Service | Language | Purpose | Repository |
|---------|----------|---------|------------|
| **Etna Search** | .NET 8 | Itinerary search for clients | `etna` |
| **Etna SI Host** | .NET 8 | Internal: proxies search to SI framework | `etna` |
| **Denali booking-service** | .NET 8 | Booking funnel (GetItinerary, Reserve, Confirm, SeatLock) | `denali` |
| **Denali post-booking-service** | .NET 8 | Post-booking (GetBookingDetails, GetTicket, Cancel) | `denali` |
| **Denali booking-notification-service** | .NET 8 | Webhook receiver for supplier notifications | `denali` |
| **Fuji** | .NET 8 | Master data (stations, operators, POIs) | `fuji` |
| **Supply-Integration framework** | .NET 8 | Multi-supplier integration abstraction layer | `supply-integration` |
| **12go (frontend3)** | PHP 8.3 / Symfony 6.4 | Core travel platform (search, booking, ticketing) | `frontend3` |

## High-Level Architecture

```mermaid
flowchart TD
    Client["External Clients"]

    subgraph OurServices ["Our Services (.NET)"]
        Fuji["Fuji\n(Master Data)"]
        EtnaSearch["Etna Search\n(Search API)"]
        EtnaSiHost["Etna SI Host\n(Internal)"]
        DenaliBooking["Denali\nbooking-service"]
        DenaliPostBooking["Denali\npost-booking-service"]
        DenaliNotifications["Denali\nnotification-service"]
        SIFramework["Supply-Integration\nFramework"]
    end

    subgraph Storage ["Storage"]
        DynamoDB["DynamoDB\n(Booking cache)"]
        HybridCache["HybridCache\n(SI layer)"]
    end

    subgraph TwelveGo ["12go Platform (PHP)"]
        Frontend3["frontend3\n(Symfony API)"]
        MySQL["MySQL"]
        Redis["Redis"]
        Kafka12go["Kafka"]
    end

    Client -->|"GET /stations\nGET /operators"| Fuji
    Client -->|"GET /itineraries\n(search)"| EtnaSearch
    Client -->|"GET /itineraries/{id}\nPOST /bookings\nPOST /confirm\nPOST /lock_seats"| DenaliBooking
    Client -->|"GET /bookings/{id}\nGET /ticket\nPOST /cancel"| DenaliPostBooking

    EtnaSearch -->|"POST /itineraries"| EtnaSiHost
    DenaliBooking -->|"GET /itinerary/{id}"| EtnaSiHost
    EtnaSiHost --> SIFramework
    DenaliBooking --> SIFramework
    DenaliPostBooking --> SIFramework
    DenaliNotifications -->|"Kafka events"| DenaliPostBooking

    SIFramework -->|"HTTP calls"| Frontend3
    Fuji -->|"Periodic sync"| Frontend3

    DenaliBooking --> DynamoDB
    DenaliPostBooking --> DynamoDB
    SIFramework --> HybridCache

    Frontend3 --> MySQL
    Frontend3 --> Redis
    Frontend3 --> Kafka12go

    Frontend3 -->|"Webhooks"| DenaliNotifications
```

## Client Journey (End-to-End Flow)

This is the complete flow a client follows from first contact to ticket retrieval:

```mermaid
sequenceDiagram
    participant Client
    participant Fuji
    participant EtnaSearch as Etna Search
    participant EtnaSI as Etna SI Host
    participant Denali as Denali Booking
    participant PostBooking as Denali Post-Booking
    participant SI as SI Framework
    participant TwelveGo as 12go API

    Note over Client,Fuji: Phase 1: Setup
    Client->>Fuji: GET /v1/{client_id}/stations
    Fuji-->>Client: Station list (IDs, names, coords)
    Client->>Fuji: GET /v1/{client_id}/operators
    Fuji-->>Client: Operator list

    Note over Client,TwelveGo: Phase 2: Search
    Client->>EtnaSearch: GET /v1/{client_id}/itineraries?departures=X&arrivals=Y&date=Z
    EtnaSearch->>EtnaSI: POST /itineraries (integrationId, routes, date, pax)
    EtnaSI->>SI: ISearchSupplier.Search()
    SI->>TwelveGo: GET /search/{from}p/{to}p/{date}
    TwelveGo-->>SI: Trips + operators + stations
    SI-->>EtnaSI: Itineraries (mapped)
    EtnaSI-->>EtnaSearch: Itineraries
    EtnaSearch-->>Client: SearchResponse (itineraries with IDs)

    Note over Client,TwelveGo: Phase 3: Checkout (GetItinerary)
    Client->>Denali: GET /{client_id}/itineraries/{itinerary_id}
    Denali->>EtnaSI: GET /itinerary/{itineraryId}
    EtnaSI->>SI: ISearchSupplier.GetItinerary()
    SI->>TwelveGo: GET /trip/{tripId}/{date}
    SI->>TwelveGo: POST /cart/{tripId}/{date} (AddToCart)
    TwelveGo-->>SI: cartId
    SI->>TwelveGo: GET /checkout/{cartId} (GetBookingSchema)
    TwelveGo-->>SI: Booking form fields
    SI-->>Denali: Itinerary + Schema + cartId
    Denali-->>Client: PreBookingSchema + BookingToken

    Note over Client,TwelveGo: Phase 3b: Seat Lock (optional)
    Client->>Denali: POST /{client_id}/bookings/lock_seats
    Denali->>SI: IBookingFunnel.LockSeats()
    SI-->>Denali: Locked seats
    Denali-->>Client: Updated booking with locked seats

    Note over Client,TwelveGo: Phase 4: Create Booking
    Client->>Denali: POST /{client_id}/bookings (BookingToken + passenger data)
    Denali->>SI: IBookingFunnel.Reserve()
    SI->>TwelveGo: POST /reserve/{bookingId}
    TwelveGo-->>SI: Reservation result
    SI-->>Denali: Reservation
    Denali-->>Client: Booking (with bookingId)

    Note over Client,TwelveGo: Phase 5: Confirm
    Client->>Denali: POST /{client_id}/bookings/{booking_id}/confirm
    Denali->>SI: IBookingFunnel.Book()
    SI->>TwelveGo: POST /confirm/{bookingId}
    TwelveGo-->>SI: Confirmation result
    SI-->>Denali: Confirmed reservation
    Denali-->>Client: Confirmed booking

    Note over Client,TwelveGo: Phase 6: Post-Booking
    Client->>PostBooking: GET /{client_id}/bookings/{booking_id}
    PostBooking-->>Client: Booking details (from DynamoDB)

    Client->>PostBooking: GET /{client_id}/bookings/{booking_id}/ticket
    PostBooking->>SI: GetTicket (if needed)
    SI->>TwelveGo: GET /booking/{bookingId}
    TwelveGo-->>SI: Ticket URL
    PostBooking-->>Client: Ticket (PDF or URL)
```

## Search Flow Detail

Etna Search has a complex MediatR pipeline that will be mostly eliminated. Today:

```mermaid
flowchart TD
    Request["Client Search Request"]
    Controller["ItinerariesController"]
    Processor["EtnaSearchProcessorService"]
    Engine["SearchEngine (MediatR)"]

    subgraph Pipeline ["MediatR Pipeline (most can go away)"]
        B1["SearchEventsBehavior"]
        B2["DistributionRulesBehavior"]
        B3["SourceAvailabilityBehavior"]
        B4["MarkupBehavior"]
        B5["ExecutionPlanBuilderBehavior"]
        B6["CacheDirectSupportBehaviour"]
        B7["ManualProductBehavior"]
        B8["ContractResolutionBehavior"]
        B9["OperatorHealthBehaviour"]
        B10["RoutesDiscoveryBehavior"]
    end

    subgraph Execution ["Execution"]
        IndexSearch["IndexSearchBehaviour\n(cache/trip lake)"]
        DirectAdapter["DirectAdapter\n(direct supplier call)"]
    end

    SIHost["Etna SI Host"]
    SILib["SI Library"]
    TwelveGoAPI["12go API"]

    Request --> Controller --> Processor --> Engine --> Pipeline
    Pipeline --> Execution
    IndexSearch -.->|"GOES AWAY"| IndexSearch
    DirectAdapter --> SIHost --> SILib --> TwelveGoAPI
```

**What survives**: Only the direct call path (DirectAdapter -> 12go). Everything else (trip lake, index cache, operator health, distribution rules, experiments, manual products) is framework overhead for multi-supplier support.

**What might need to stay**: MarkupBehavior (price markup for clients), RoutesDiscovery (station-to-route mapping).

## Booking Flow Detail

```mermaid
flowchart TD
    subgraph DenaliBooking ["Denali booking-service"]
        BC["BookingController"]
        SFA["SiFacade"]
        BSH["BookingSiHost"]
        ICS["ItineraryCacheService\n(DynamoDB)"]
        PCS["PreBookingCacheService\n(DynamoDB)"]
        BCS["BookingCacheService\n(DynamoDB)"]
        PS["PriceService / MarkupService"]
        CL["CreditLine Check"]
        KP["Kafka Publisher"]
    end

    subgraph SILayer ["SI Framework"]
        ISP["ISiServiceProvider"]
        BF["IBookingFunnel"]
        BS["IBookingSchema"]
        SS["ISearchSupplier"]
    end

    TwelveGoAPI["12go API"]

    BC --> SFA
    SFA --> BSH
    SFA --> ICS
    SFA --> PCS
    SFA --> BCS
    SFA --> PS
    SFA --> CL
    SFA --> KP
    BSH --> ISP --> BF
    BSH --> ISP --> BS
    BSH --> ISP --> SS
    BF --> TwelveGoAPI
    BS --> TwelveGoAPI
    SS --> TwelveGoAPI
```

**Key orchestration in SiFacade**:
1. Resolves integrationId and contractCode
2. Manages DynamoDB caching at each step
3. Applies pricing/markup
4. Checks credit line balance
5. Publishes Kafka events
6. Handles encryption of IDs (Caesar cipher for itinerary IDs, booking tokens)

**What can go away**: DynamoDB caching (12go stores bookings), SI framework abstraction (only one integration). Credit line and markup may need to stay.

## Data Storage Map

| Store | Service | Purpose | Can It Go? |
|-------|---------|---------|------------|
| DynamoDB - ItineraryCache | Denali booking-service | Cache itinerary between search and booking | Yes - can re-fetch from 12go |
| DynamoDB - PreBookingCache | Denali booking-service | Cache booking schema + locked seats | Yes - can re-fetch from 12go |
| DynamoDB - BookingCache | Denali booking-service | Store active bookings | Yes - 12go stores bookings |
| DynamoDB - BookingEntity | Denali post-booking-service | Store confirmed bookings | Yes - proxy to 12go |
| HybridCache | Supply-Integration | Cache trip data (price, operator) between search and checkout | Likely yes - re-fetch from 12go |
| MemoryCache | Etna Search | Cache index search results, station mappings | Yes - no index search needed |
| MySQL | Fuji (via OneTwoGoDbWrapper) | Station/operator master data from 12go | Keep - still need station mapping |
| MySQL | 12go (frontend3) | Core data store | Keep - this is the source of truth |
| Redis | 12go (frontend3) | Caching layer | Keep - 12go internal |

## Communication Map

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| Client | Etna Search | HTTP REST | Search itineraries |
| Client | Denali booking-service | HTTP REST | Booking funnel |
| Client | Denali post-booking-service | HTTP REST | Post-booking operations |
| Client | Fuji Exposure API | HTTP REST | Stations, operators |
| Etna Search | Etna SI Host | HTTP REST | Proxy search to SI |
| Denali | Etna SI Host | HTTP REST | Get itinerary details |
| Denali | SI Framework | In-process | Booking operations |
| SI Framework | 12go (frontend3) | HTTP REST | All supplier operations |
| Fuji | 12go (OneTwoGoDbWrapper) | HTTP REST + MySQL | Station sync |
| 12go | Denali notification-service | HTTP Webhook | Booking status changes |
| Denali services | Kafka | Async messaging | Internal events |
