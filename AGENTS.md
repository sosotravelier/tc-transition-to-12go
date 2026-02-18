# AGENTS.md - AI Agent Coordination for System Transition Design

> **Start here.** This file defines everything an AI agent needs to pick up work on the 12go transition project from any phase.

## Quick Orientation

1. Read this file (you're here)
2. Read [README.md](README.md) for project overview and document index
3. Read [current-state/overview.md](current-state/overview.md) for architecture diagrams and endpoint-to-12go mapping
4. Read the specific docs relevant to your task (linked below)

## Project Context

We are transitioning from a multi-service .NET architecture to using 12go (PHP/Symfony) as the core system. Existing clients depend on our API contracts which are vastly different from 12go's APIs. We must maintain backward compatibility.

### Key Findings from Phase 1

1. **Station ID mapping is the hardest problem** -- clients have Fuji station IDs embedded in their systems, 12go uses different IDs. No matter what architecture we choose, a mapping layer is required.
2. **Most local storage can be eliminated** -- DynamoDB tables (ItineraryCache, PreBookingCache, BookingCache, BookingEntity) and HybridCache all store data that 12go already has. We can proxy to 12go instead.
3. **The SI framework abstraction is unnecessary** -- designed for multi-supplier support, but we only need 12go. The OneTwoGoApi call logic (endpoints, models, error handling) is the valuable part.
4. **Authentication is mostly decorative** -- API key checks in our services are no-ops; real auth is at the API gateway level.
5. **Seat locking is faked** -- 12go doesn't support it natively; Denali validates locally and stores in DynamoDB. The client-facing contract must be preserved.
6. **Refund calculation diverges** -- Denali computes its own refund amounts which may differ from 12go's. Need a decision on source of truth.
7. **Triple-caching exists** -- search results are cached in HybridCache, DynamoDB, and MemoryCache simultaneously. Can collapse to zero or one layer.
8. **The Etna search pipeline is massively over-engineered for our needs** -- 10+ MediatR behaviors, trip lake, index cache, operator health, experiments -- only the direct 12go call path survives.
9. **GetBookingDetails reads entirely from local DB** -- no 12go call at runtime. Transition means either keeping a local store or switching to proxy 12go's `/booking/{id}`.
10. **Webhook notifications from 12go have zero authentication** -- security concern that should be addressed in the new architecture.

## Source Repositories

| Alias | Path | Description |
|-------|------|-------------|
| **denali** | `/Users/sosotughushi/RiderProjects/denali` | Booking funnel (GetItinerary, CreateBooking, Confirm, etc.) |
| **etna** | `/Users/sosotughushi/RiderProjects/etna` | Search service (itinerary search, SI host) |
| **supply-integration** | `/Users/sosotughushi/RiderProjects/supply-integration` | Supplier integration framework + OneTwoGo integration |
| **fuji** | `/Users/sosotughushi/RiderProjects/fuji` | Master data (stations, operators, POIs) |
| **frontend3** | `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3` | 12go PHP system (Symfony) |

## Key Source Files by Feature

### Search (Etna)
| What | Path |
|------|------|
| Controller | `etna/api/Etna.Search.Api/Controllers/ItinerariesController.cs` |
| Request model | `etna/api/Etna.Search.ApiModels/Requests/Search/SearchRequest.cs` |
| Response model | `etna/api/Etna.Search.ApiModels/Responses/Search/SearchResponse.cs` |
| Search processor | `etna/api/Etna.Search.Api.Service/Services/Implementation/EtnaSearchProcessorService.cs` |
| Direct adapter | `etna/search-engine/etna.searchengine/Pipeline/Direct/Implementation/DirectAdapter.cs` |
| SI Host controller | `etna/supplier-integration/Etna.Search.SupplierIntegration.Host/Controllers/ItineraryController.cs` |
| Pipeline behaviors | `etna/search-engine/etna.searchengine/Pipeline/Behaviours/` |
| OneTwoGo search | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/OneTwoGoSearchSupplier.cs` |

### GetItinerary / Checkout (Denali)
| What | Path |
|------|------|
| Controller | `denali/booking-service/host/BookingService.Api/Controllers/BookingController.cs` |
| SiFacade | `denali/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Facade/SiFacade.cs` |
| BookingSiHost | `denali/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs` |
| OpenAPI spec | `denali/shared-booking-service-open-api/api/definitions/book.yaml` |
| API models | `denali/api/Denali.Booking.ApiModels/` |
| DynamoDB persistence | `denali/booking-service/persistency/BookingService.Persistency/` |
| SI integration config | `denali/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/ConfigureServices.cs` |

### Post-Booking (Denali)
| What | Path |
|------|------|
| Controller | `denali/post-booking-service/host/PostBookingService.Api/Controller/PostBookingApiController.cs` |
| PostBookingSiFacade | `denali/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiFacade.cs` |
| Persistence | `denali/post-booking-service/BookingPersistence/` |
| Ticket PDF service | Look in post-booking-service for `TicketPdfService` |

### Booking Notifications (Denali)
| What | Path |
|------|------|
| Program.cs | `denali/booking-notification-service/host/BookingNotificationService/Program.cs` |
| Controller | `denali/booking-notification-service/host/BookingNotificationService/Controllers/WebhookController.cs` |

### Master Data (Fuji)
| What | Path |
|------|------|
| Station controller | `fuji/exposure/api/Fuji.Exposure.Api/Controllers/StationController.cs` |
| OpenAPI spec | `fuji/exposure/openAPI/master_data.yml` |
| Station model | `fuji/exposure/openAPI/model/station.json` |
| Operator model | `fuji/exposure/openAPI/model/operating_carrier.json` |
| POI model | `fuji/exposure/openAPI/model/point_of_intrest.json` |
| OneTwoGo integration | `fuji/si/OneTwoGo/Integration/Fuji.SI.Integration.Services/OneTwoGo/OneTwoGoIntegrationApi.cs` |
| DB wrapper | `fuji/inventory_provider/OneTwoGoDbWrapper/src/OneTwoGoDbWrapper/Controllers/OneTwoGoApiController.cs` |
| Entity mapping | `fuji/entity_mapping/FujiDomainServices/Services/MappingServices.cs` |

### 12go API (Supply-Integration)
| What | Path |
|------|------|
| API client (all endpoints) | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/OneTwoGoApi.cs` |
| URI builder | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Tools/OneTwoGoUriBuilder.cs` |
| Search response | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Endpoints/Search/OneTwoGoSearchResponse.cs` |
| Booking funnel | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.BookingFunel/OneTwoGoBookingFunnel.cs` |
| Booking schema | Look in `supply-integration/integrations/onetwogo/` for `OneTwoGoBookingSchema` |
| Cache | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/OneTwoGoCache.cs` |
| Reserve request | `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Models/ReserveDataRequest.cs` |
| Framework abstractions | `supply-integration/abstractions/SupplyIntegration/Abstractions/` |

## Document Templates

### Endpoint Document Template

Each file in `current-state/endpoints/` follows this structure:

```markdown
---
status: draft
last_updated: YYYY-MM-DD
---

# [Endpoint Name]

## HTTP Contract
## Client Usage
## Internal Flow (mermaid sequence diagram)
## 12go Equivalent
## Data Dependencies
## What Can Go Away
## Open Questions
```

### Cross-Cutting Document Template

```markdown
---
status: draft
last_updated: YYYY-MM-DD
---

# [Topic]

## Current State
## Per-Service Details
## 12go Equivalent
## Transition Considerations
```

### Design Document Template (Phase 2-3)

```markdown
---
status: draft
last_updated: YYYY-MM-DD
depends_on_questions: [Q1, Q5, Q11]  # from questions/for-12go.md
---

# [Design Topic]

## Problem Statement
## Options
### Option A: [Name]
- Description
- Pros
- Cons
- Estimated effort
### Option B: [Name]
- ...
## Recommendation
## Architecture Diagram
## Migration Steps
## Risks
```

## Document Status Convention

Every document must have YAML frontmatter:

```yaml
---
status: draft | review | complete
last_updated: YYYY-MM-DD
---
```

## Mermaid Diagram Style Guide

- Use `sequenceDiagram` for endpoint flows and interaction patterns
- Use `flowchart TD` for architecture overviews
- Node IDs: camelCase, no spaces (e.g., `etnaSearch`, `denaliBooking`)
- Wrap labels with special characters in double quotes
- Do not use HTML tags or explicit colors/styling
- Keep diagrams focused -- one per concept
- Avoid `flowchart LR` with many nodes (renders poorly); use tables + sequence diagrams instead

## Cross-Reference Convention

When referencing another doc, use relative links:
- `[Search](../endpoints/search.md)`
- `[Authentication](../cross-cutting/authentication.md)`
- `[12go API Surface](../integration/12go-api-surface.md)`

---

## Agent Roles

### Phase 1 Roles (Complete)

#### Endpoint Documenter
- **Input**: Source file paths from the table above
- **Output**: One or more endpoint .md files in `current-state/endpoints/`
- **Must**: Read actual source code, extract real DTOs, trace the full call chain
- **Must NOT**: Guess at field names or types -- verify from code

#### Cross-Cutting Analyst
- **Input**: Source file paths across multiple services
- **Output**: Cross-cutting concern .md files in `current-state/cross-cutting/`
- **Must**: Check all services for the concern

#### Integration Analyst
- **Input**: supply-integration OneTwoGo code + frontend3 code
- **Output**: 12go API surface docs in `current-state/integration/`
- **Must**: Document actual request/response shapes from code

#### Questions Compiler
- **Input**: All completed current-state docs
- **Output**: `questions/for-12go.md`
- **Must**: Read every doc's "Open Questions" section, synthesize, prioritize

### Phase 2 Roles — Design Exploration (Complete — Trial Run)

> **Note**: Phase 2 was executed as a trial run with 12 parallel agents across 4 waves. All output is in `design/` and may be discarded after the Wednesday 12go meeting.

#### Research Agents (Wave 1)

| Agent | Purpose | Output |
|-------|---------|--------|
| **R1: .NET Trimming Analyst** | Analyze what to keep/trim/discard in all .NET services | `design/research/dotnet-trimming-analysis.md` |
| **R2: PHP/f3 Capability Analyst** | Map frontend3 capabilities to our endpoint needs | `design/research/php-capability-analysis.md` |
| **R3: Industry Patterns Researcher** | Research best practices (Strangler Fig, BFF, ACL, travel tech) | `design/research/industry-patterns.md` |
| **R4: Scale & Observability Researcher** | Research scaling, latency targets, observability patterns | `design/research/scale-observability.md` |

#### Design Agents (Wave 2)

| Agent | Purpose | Output |
|-------|---------|--------|
| **D1: Option A Architect** | Design trimmed .NET architecture on 12go infra | `design/option-a-trimmed-dotnet/architecture.md` |
| **D2: Option B Architect** | Design PHP native Symfony bundle architecture | `design/option-b-php-native/architecture.md` |
| **D3: Option C Architect** | Design thin stateless API gateway architecture | `design/option-c-thin-gateway/architecture.md` |

#### Review Agents (Wave 3)

| Agent | Persona | Output |
|-------|---------|--------|
| **V1: Event-Driven/FP Architect** | Values immutability, composability, explicit data flow | `design/reviews/event-driven-fp-review.md` |
| **V2: AI-First Development Architect** | Values AI-friendly code, navigability, type safety | `design/reviews/ai-first-review.md` |
| **V3: Business Risk Assessor** | Values risk mitigation, realistic timelines, rollback | `design/reviews/business-risk-review.md` |
| **V4: DevOps/Platform Engineer** | Values operational simplicity, resource efficiency | `design/reviews/devops-platform-review.md` |

#### Synthesis Agent (Wave 4)

| Agent | Purpose | Output |
|-------|---------|--------|
| **S1: Evaluation Matrix Builder** | Synthesize all designs + reviews into scored comparison | `design/evaluation-matrix.md` |

### Phase 2 Roles — Final Design (Pending Q1-Q20 Answers)

#### Solution Architect
- **Purpose**: Finalize architecture based on 12go meeting answers and Phase 2 exploration
- **Input**: `design/evaluation-matrix.md`, Q1-Q20 answers, selected option architecture doc
- **Output**: `design/final-architecture.md`

#### Migration Planner
- **Purpose**: Define step-by-step migration plan for the chosen architecture
- **Input**: Final architecture doc + all endpoint docs
- **Output**: `design/migration-plan.md` with phased steps, rollback points, parallel run strategy

#### Endpoint Designer
- **Purpose**: Design new implementation for each specific endpoint
- **Input**: `current-state/endpoints/{endpoint}.md` + final architecture
- **Output**: `design/endpoints/{endpoint}.md`
- **Must**: Show new call flow, contract preservation, code changes, tests

### Phase 3 Roles (Implementation)

#### Implementation Agent
- **Purpose**: Implement the migration for a specific endpoint/service
- **Input**: Read `design/endpoints/{endpoint}.md` for the detailed design
- **Output**: Code changes in the relevant repository
- **Must**: Follow the design doc, preserve API contracts, add tests, update monitoring

#### Test Agent
- **Purpose**: Validate that migrated endpoints maintain backward compatibility
- **Input**: Current endpoint contract docs + implementation
- **Output**: Integration tests, contract tests
- **Must**: Verify request/response shapes match the documented contracts exactly

---

## Decision Log

Decisions made during this project, for context in future sessions.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-17 | Documentation repo at `~/RiderProjects/transition-design/` | Spans multiple repos, shouldn't live inside any single project |
| 2026-02-17 | Standalone git repo (not inside denali/etna/etc.) | Independent version history for design docs |
| 2026-02-17 | Use Cursor subagents for parallel documentation | Faster than sequential; up to 4 subagents per wave |
| 2026-02-17 | Phase 1 first (document what exists), then Phase 2 (design), then Phase 3 (implement) | Need to know what we have before deciding what to build |
| 2026-02-17 | Each endpoint gets its own file | Enables parallel work by different agents without merge conflicts |
| 2026-02-17 | Questions for 12go compiled from all doc open questions | Centralized list prioritized by architecture impact |
| 2026-02-17 | Phase 2 as trial run with 3 options + 4 reviewer personas | Explore design space before Q1-Q20 answers constrain it |
| 2026-02-17 | 12 agents across 4 waves for design exploration | Research → Design → Review → Synthesize pipeline |
| 2026-02-17 | Design output is disposable | May regenerate after Wednesday 12go meeting |
| 2026-02-17 | Weighted evaluation: Option C (48.0) > A (44.5) > B (38.5) | But winner depends on Q1-Q3 answers; no final decision yet |
| 2026-02-17 | Reviewer disagreement captured: FP/AI prefer C, DevOps prefers B, Risk suggests A→B bridge | Multiple valid perspectives; decision tree in evaluation-matrix.md |
