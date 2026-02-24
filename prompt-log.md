# Prompt Log

> This file preserves the original task description and context that initiated this transition design project.

## Initial Prompt (Feb 17, 2026)

We are right now in big transition.

We have denali and etna. denali is responsible for booking funnel and etna - for search of itineraries.
We have existing clients that are calling these apis.

We also have supply-integration project, which is essentially integration with supplier. When a client/user requests search by some route, etna I think figures out to which integration(s) these stations/pois belong to and they call etna search supplier integration with that integration id.
Then based on integration id etna si (si is supplier integration) host calls the framework of si, passing integrationId which figures out which implementation to call.

We had multiple integration but as part of the big transition that we are doing, we want to demolish all of these services and use 12go as the main core of the system. and 12go has capability to have integrations.
It would be easy to kill all of etna and denali services if not existing clients, to which we are providing api contracts that are vastly different then in 12go.

My current task is to come up with a design to this transition. to figure out what's the best design to make sure that client's don't break as well as it is easy to maintain.

I need to define now what are things that we need to keep. Which endpoints and what functionality internally. This includes:
* Keeping endpoint contracts intact.
* How we handle authentication.
* How do we monitor the system. Because both of the systems have this capability and if let's say finding all the logs related to certain booking is already supported in 12go, there's no need to keep this capability elsewhere.
* We will need to migrate our infrastructure to their cloud. This part is debatable if we need to copy all of our services (or minimum amount of them) vs writing it from scratch.
* Monitoring: we are using coralogics for logs and tracing. And grafana for metrics.

### Operations/Endpoints Used by Clients

**Master-data (Fuji)**
- Fuji - Get Stations
- Fuji - Get Operators
- POIs

**Denali**
- GetItinerary
- SeatLock
- Reserve
- Confirm
- IncompleteResults
- getBookingDetails
- GetTicket
- Booking Notifications
- Client notifications
- Supplier Owner Client Notifications - we might not need it anymore

**Etna**
- Etna Search
- Etna Search Supplier Integration

### Additional Considerations

- In SI we should look at how we integrate with 12go right now. So Etna and Denali would call that directly most likely without supply-integration framework in the middle.
- Programming language: Denali, Etna and others are .NET; 12go is PHP. Given maturity of 12go, we might need to switch. Unless 12go has another vision for new services.
- Integration method: Currently HTTP endpoints. Maybe reference their code directly? Access repositories? Access databases directly? Need to evaluate.
- We need to take all this into consideration.

### Service Details

**Denali**: Many projects inside. Most important: booking-service (GetItinerary/Checkout, calls Etna SI Host). Main 12go interaction through SupplyIntegration/OneTwoGo libraries. SiFacade orchestrates. BookingSiHost bridges to SI libraries. For GetItinerary: calls etna-si-host first, which calls si endpoint. Also has GetBookingSchema for booking form requirements. Post-booking-service for GetBookingDetails and ticket PDF. All written generically for multiple integrations - can simplify for 12go only. DynamoDB storage can potentially go away (proxy to 12go instead). Booking-notification-service handles webhooks.

**Fuji**: GetStations - clients call at start to get station IDs, find correspondence with their stations. GetOperators similar. Data comes from 12go via periodic sync jobs.

**Etna Search**: Designed for multiple sources (trip lake pre-fetch, direct integration, experiments). All goes away except direct search calling 12go API. Current flow: Etna.Search -> MediatR pipeline -> Etna.Search.SupplierIntegration (SI Host) -> SI Library -> 12go. Note: Search writes to HybridCache data needed later in booking funnel.

### Full Client Flow

1. Client searches -> gets Itineraries with IDs
2. GetItinerary by ID -> returns more detail (schema, seat layout) + BookingToken
3. CreateBooking with BookingToken + passenger data -> validates, books, stores in DB
4. ConfirmBooking with bookingId
5. GetBookingDetails retrieves from DB
6. GetTicket (may not be immediate)

### 12go Side

PHP system, frontend3 contains endpoints we call. Uses MySQL, Redis, PHP, Kafka. Own monitoring tools. OpenTelemetry for tracing/metrics (somewhat compatible). Station data pulled periodically to Fuji.

---

## Session 1 Decisions (Feb 17, 2026)

During the first working session, the following decisions were made through discussion:

1. **Folder location**: `~/RiderProjects/transition-design/` (outside all repo folders since it spans them)
2. **Git**: Standalone git repo initialized
3. **Agent strategy**: Single Cursor session with Task subagents for parallel work (up to 4 per wave), rather than multiple Cursor windows
4. **Execution approach**: 5 waves of subagents:
   - Wave 1: Scaffolding (main agent -- AGENTS.md, README, overview with diagrams)
   - Wave 2: Core booking flow endpoints (4 parallel -- search, get-itinerary, create-booking, confirm+seat-lock)
   - Wave 3: Post-booking + master data (4 parallel -- post-booking endpoints, Fuji endpoints, notifications+incomplete, 12go API+SI framework)
   - Wave 4: Cross-cutting concerns (4 parallel -- auth, monitoring, storage+caching, messaging)
   - Wave 5: Synthesis (main agent -- questions for 12go, README status update, git commit)
5. **Phase approach**: Phase 1 (document what exists) -> Phase 2 (design solutions) -> Phase 3 (implement)

## Session 1 Outputs

- 25 markdown files, 7,386 lines of documentation
- 13 endpoint docs, 4 cross-cutting docs, 3 integration analysis docs
- 1 overview with architecture diagrams
- 20 prioritized questions for 12go representative
- All committed as initial git history




## Session 2 Decisions (Feb 23, 2026) - Phase 2 Design Exploration

During this session, we explored specific architectural and language implementation options for the transition.

1. **Plan Splitting**: The design phase was split into two parts:
   - **Wave 1**: High-level designs (Monolith vs. Microservice).
   - **Waves 2-4**: Language exploration, detailed analysis, and synthesis.
2. **Architecture Refinement**: 
   - Focused on two primary paths: **A-monolith (PHP/Symfony)** and **B-microservice (Multiple Languages)**.
   - Clarified that **Stations/Operators** data must remain artifact-based (S3 pre-signed URL) to preserve client contracts.
   - Identified 12go's internal service layer (`SearchService`, `BookingProcessor`) for potential monolith integration.
3. **Language Exploration**: Concretized 4 microservice variants:
   - **.NET 8**: Immediate productivity, porting existing C# logic.
   - **TypeScript/Node.js (NestJS)**: Highest AI synergy, familiar async/await for .NET devs.
   - **Go**: Strategic alignment with 12go's future, highest performance.
   - **PHP/Symfony**: Natural infrastructure alignment with 12go.
4. **Scoring Model**: Consolidated 6 reviewer personas into 4 analyzer roles (Team/Velocity, Architecture/Performance, Operations/Infra, Risk/Migration) using a weighted 14-criterion rubric.

### Session 2 Outputs (Phase 2)

- **Detailed Design Docs**:
  - `design/alternatives/A-monolith/design.md`
  - `design/alternatives/B-microservice/design.md`
- **Language Exploration Docs**:
  - `design/alternatives/B-microservice/languages/dotnet.md`
  - `design/alternatives/B-microservice/languages/typescript.md`
  - `design/alternatives/B-microservice/languages/golang.md`
  - `design/alternatives/B-microservice/languages/php-symfony.md`
- **Analysis Reports**:
  - 4 specialized analyzer reports in `design/analysis/`
- **Final Synthesis**:
  - `design/comparison-matrix.md`
  - `design/recommendation.md` (Primary recommendation: **.NET 8 Microservice (B1)**)

### Core Strategy Decisions

- **Recommendation**: **.NET 8 Microservice** is the primary path due to zero learning curve and 10-week timeline.
- **Modernization**: Use **.NET 8 AOT** to achieve container sizes and performance comparable to Go/PHP.
- **Fallback**: **TypeScript/Node.js** is the preferred fallback if .NET is rejected by 12go DevOps.
- **Contract Preservation**: All alternatives must preserve all 13 client-facing endpoints exactly, including money as strings and Fuji station IDs.
- **Simplicity**: Enforce a **10K LOC hard limit** on the new service to prevent re-introduction of "enterprise" complexity.

### Reorganization (Feb 24, 2026)

Design evaluation docs were reorganized into versioned folders:
- **v1**: Original evaluation (design/v1/) — recommendation: .NET 8 Microservice
- **v2**: Refined criteria, 14 criteria (design/v2/)
- **v3**: Further refined, 15 criteria, emphasis on long-term platform alignment (design/v3/)

See [design/README.md](design/README.md) for the full index.
