# AGENTS.md - AI Agent Coordination for System Transition Design

> **Start here.** This file defines everything an AI agent needs to pick up work on the 12go transition project from any phase.

## Quick Orientation

1. Read this file (you're here)
2. Read [README.md](README.md) for project overview and document index
3. Read [current-state/overview.md](current-state/overview.md) for architecture diagrams and endpoint-to-12go mapping
4. Read the specific docs relevant to your task (linked below)

**Live project tracking** (sprint status, gaps, next steps): [Notion page](https://www.notion.so/bookaway/Transfer-TC-functionality-into-12Go-s-system-3053459fb0c681938b4dd6591341e42d)

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

### Design Document Template (Phase 2)

Each file in `design/alternatives/[agent-name]/` must include YAML frontmatter and a `## Security` section (required by all agents -- addresses Key Finding #10: webhook notifications have zero authentication):

```markdown
---
status: draft
last_updated: YYYY-MM-DD
agent: [agent name, e.g. pragmatic-minimalist]
---

# [Design Name]

## [Agent-specific framing question]
## Proposed Design
## Architecture Diagram
## Language and Framework
## Data Strategy
## Security
## Migration Path
## Unconventional Idea (optional)
## What This Design Optimizes For (and what it sacrifices)
```

**Each agent prompt specifies its own output format** -- the above is a summary baseline only. See `prompts/design-agents/[agent].md` for the complete section list for each agent.

**Exception**: The Clean Slate Designer (`prompts/design-agents/clean-slate-designer.md`) must NOT use Denali/Etna/Fuji source code as design input. It reads only the client-facing API contract and 12go API surface.

## Prompt Log Convention

**When to update**: When adding new prompts, sessions, or significant contextual inputs that shape the project direction.

**Where**: `prompt-log.md`

**What to add**: A new section with date, description of the prompt or session, and any decisions or outputs. Preserve the Initial Prompt and prior sessions; append new entries chronologically.

**Why**: The prompt log preserves historic context and the original task description. Design agents, reviewers, and future sessions rely on this to understand *why* we are doing this transition.

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

### Phase 2 Roles (Design)

Phase 2 uses 5 **perspective-based** design agents. Each starts from fundamentally different first principles. The language/framework choice falls out of the worldview, not the other way around. Prompts are at `prompts/design-agents/`.

#### Pragmatic Minimalist
- **Prompt**: `prompts/design-agents/pragmatic-minimalist.md`
- **Perspective**: Legacy migration consultant skeptical of rewrites. Evaluates whether the existing .NET services can be simplified in-place (strangler fig) rather than replaced.
- **Activates**: Strangler fig pattern, second-system effect, boring technology, incremental migration
- **Output**: `design/alternatives/pragmatic-minimalist/design.md`

#### Platform Engineer
- **Prompt**: `prompts/design-agents/platform-engineer.md`
- **Perspective**: DevOps engineer who has managed 12go's EC2/Docker/PHP stack. Starts from "who operates this at 3am" and works backward to a design.
- **Activates**: Docker operational patterns, PHP-FPM, Datadog APM native integrations, runtime footprint
- **Output**: `design/alternatives/platform-engineer/design.md`

#### Data Flow Architect
- **Prompt**: `prompts/design-agents/data-flow-architect.md`
- **Perspective**: Data/event architect who sees every service as a node in a data flow graph. Addresses the Feb 25 finding: sunsetting SI Host loses event correlation for ClickHouse.
- **Activates**: Kafka producer patterns, ClickHouse ingestion, event-driven design, correlation ID strategy
- **Output**: `design/alternatives/data-flow-architect/design.md`

#### Team-First Developer
- **Prompt**: `prompts/design-agents/team-first-developer.md`
- **Perspective**: Developer experience advocate who starts from the humans (and AI tools) building and maintaining the system.
- **Activates**: AI code generation quality by language, inner loop development speed, team morale and retention, onboarding cost
- **Output**: `design/alternatives/team-first-developer/design.md`

#### Disposable Architecture Designer
- **Prompt**: `prompts/design-agents/disposable-architecture.md`
- **Perspective**: Architect designing explicitly for replaceability. Given F3 will be decomposed (no timeline), optimizes for maximum value now and minimum cost to throw away later.
- **Activates**: Anti-corruption layer, hexagonal architecture, ports and adapters, contract testing, feature flags
- **Output**: `design/alternatives/disposable-architecture/design.md`

#### Clean Slate Designer
- **Prompt**: `prompts/design-agents/clean-slate-designer.md`
- **Perspective**: Contract-first architect who ignores the existing implementation entirely. Starts only from the client-facing API contract and the 12go API surface, designs the simplest possible proxy with zero legacy anchoring.
- **Activates**: API gateway patterns, BFF design, OpenAPI-first tooling, language fitness for HTTP proxy workloads, irreducible complexity analysis
- **Output**: `design/alternatives/clean-slate-designer/design.md`
- **Run order**: Wave 1b alongside Disposable Architecture (Cursor supports up to 4 parallel; run this as agent 5 or 6 sequentially if wave is full)

#### Design Synthesizer (Orchestrator)
- **Purpose**: After all 5 design agents complete, consolidate proposals into an updated decision map
- **Input**: All 5 design docs + `design/decision-map.md`
- **Output**: Updated `design/decision-map.md` with new options and recommendations; summary of design convergences and divergences

### Phase 3 Roles (Evaluation)

Phase 3 uses 4 analyzer agents. Each reads all 5 design proposals and scores or analyzes them from a distinct angle. Prompts are at `prompts/analyzer-agents/`. Scoring rubric is at `design/v4/evaluation-criteria.md`.

#### Red Team
- **Prompt**: `prompts/analyzer-agents/red-team.md`
- **Does NOT score** -- produces structured failure mode analysis per design
- **Purpose**: Catch hidden assumptions and fatal flaws before the final recommendation. The "12go is a black box" assumption that distorted v1 is exactly the kind of error this agent finds.
- **Output**: `design/v4/analysis/red-team.md`

#### Execution Realist
- **Prompt**: `prompts/analyzer-agents/execution-realist.md`
- **Scores**: Implementation Effort (x3), Development Velocity (x3), Team Competency Match (x3), Migration Risk (x2)
- **Purpose**: Anchor evaluation in "can these 3-4 people actually build this in the available time?"
- **Output**: `design/v4/analysis/execution-realist.md`

#### AI Friendliness
- **Prompt**: `prompts/analyzer-agents/ai-friendliness.md`
- **Scores**: AI-Friendliness (x3), Testing Ease (x2), Elegance (x1, partial -- AI navigability lens only; Technical Merit scores Elegance independently)
- **Purpose**: Evaluate each design on how well it works with Cursor/Claude for initial build, maintenance, debugging, and test generation
- **Output**: `design/v4/analysis/ai-friendliness.md`

#### Technical Merit
- **Prompt**: `prompts/analyzer-agents/technical-merit.md`
- **Scores**: Search Performance (x3), Simplicity (x2), Infrastructure Fit (x2), Elegance (x1, authoritative), Monitoring/Observability (x1), Disposability (x1)
- **Purpose**: Pure technical evaluation -- architecture quality, latency overhead, resilience, observability, and adapter boundary cleanliness for future replaceability
- **Output**: `design/v4/analysis/technical-merit.md`

#### Comparison Matrix Synthesizer (Orchestrator)
- **Purpose**: Consolidate scores from all 3 scoring agents, apply the Red Team findings as a filter, and produce the final weighted comparison matrix and recommendation
- **Input**: All 4 analysis docs + `design/v4/evaluation-criteria.md`
- **Note on C10**: Use Technical Merit's Elegance score as the authoritative C10 value. AI Friendliness's C10 sub-score is supplementary context only.
- **Output**: `design/v4/comparison-matrix.md`, `design/v4/recommendation.md`

### Phase 4 Roles (POC and Implementation)

#### POC Implementation Agent
- **Purpose**: Implement the Search endpoint inside F3 (frontend3 PHP/Symfony) as a POC to evaluate friction
- **Input**: Read `design/decision-map.md` (D0 decision), `current-state/endpoints/search.md`, `current-state/integration/12go-api-surface.md`, `runbooks/run-f3-locally.md`
- **Output**: Code changes in the `frontend3` repository, POC friction report
- **Must**: Document friction points encountered -- these feed back into the design decision

#### Implementation Agent
- **Purpose**: Implement the migration for a specific endpoint/service after architecture decision is finalized
- **Input**: Read `design/v4/recommendation.md` and the relevant endpoint doc in `current-state/endpoints/`
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
| 2026-02-20 | .NET 8 Microservice Architecture recommended | Maximizes team velocity, minimizes transition risk, allows porting existing SI logic |
| 2026-02-23 | Sensitive data scrub (Phase 1-2 docs) | Removed personal names and verified gitignore coverage before potential public/internal commit |
| 2026-02-25 | Architecture decision deferred — POC inside F3 requested | Meeting with Team Lead, RnD, Architect, Oleksandr; agreed to implement Search endpoint in F3 first to evaluate friction before committing |
| 2026-02-25 | Post-meeting: .NET microservice confirmed still an option | RnD clarified in follow-up call; F3 redesign not this quarter |
| 2026-02-25 | F3 breakdown planned but no timeline | "Beginning of the beginning of planning"; no target language, no milestones; estimated a couple of quarters |
| 2026-02-25 | Event/data correlation identified as new requirement | B2B-specific events must be preserved or created for ClickHouse; data team to provide requirements |
| 2026-03-09 | v1 language-based design agents archived; replaced with perspective-based agents | Language axis produced convergent designs; perspective axis (minimalist/infra/data/DX/disposable) activates more diverse LLM knowledge regions |
| 2026-03-09 | v1 concern-based analyzer agents archived; replaced with Red Team + Execution Realist + AI Friendliness + Technical Merit | Strategic Alignment removed (unknowable), Client Impact made a hard constraint, AI Friendliness elevated to first-class criterion |
| 2026-03-09 | Evaluation criteria updated to v4 | AI-Friendliness elevated to High weight (x3), Disposability added, Future Extensibility removed, Testing Ease elevated to Medium weight |
