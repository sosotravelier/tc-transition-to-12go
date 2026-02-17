# AGENTS.md - AI Agent Coordination for System Transition Design

> This file defines conventions, templates, and roles for AI agents working on the 12go transition design documentation.

## Source Repositories

| Alias | Path | Description |
|-------|------|-------------|
| **denali** | `/Users/sosotughushi/RiderProjects/denali` | Booking funnel (GetItinerary, CreateBooking, Confirm, etc.) |
| **etna** | `/Users/sosotughushi/RiderProjects/etna` | Search service (itinerary search, SI host) |
| **supply-integration** | `/Users/sosotughushi/RiderProjects/supply-integration` | Supplier integration framework + OneTwoGo integration |
| **fuji** | `/Users/sosotughushi/RiderProjects/fuji` | Master data (stations, operators, POIs) |
| **frontend3** | `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3` | 12go PHP system (Symfony) |

## Document Status Convention

Every document in `current-state/` must have YAML frontmatter:

```yaml
---
status: draft | review | complete
last_updated: YYYY-MM-DD
---
```

## Endpoint Document Template

Each file in `current-state/endpoints/` must follow this structure:

```markdown
---
status: draft
last_updated: YYYY-MM-DD
---

# [Endpoint Name]

## HTTP Contract

- **Method**: GET/POST
- **Path**: `/{client_id}/...`
- **Headers**: (list required headers)
- **Query Parameters**: (if any)

### Request Body (if POST)

(Field-level detail with types)

### Response

(Field-level detail with types, including HTTP status codes)

## Client Usage

How clients call this endpoint and what they depend on.

## Internal Flow

(Mermaid sequence diagram showing the call chain from controller to 12go)

## 12go Equivalent

Which 12go API endpoint(s) this maps to, with differences noted.

## Data Dependencies

- Database reads/writes
- Cache reads/writes
- External service calls

## What Can Go Away

What is generic SI framework overhead vs essential business logic.

## Open Questions

Things that need verification or decisions.
```

## Cross-Cutting Document Template

Files in `current-state/cross-cutting/` follow a simpler structure:

```markdown
---
status: draft
last_updated: YYYY-MM-DD
---

# [Topic]

## Current State

How it works today across all services.

## Per-Service Details

### Denali
### Etna
### Fuji
### Supply-Integration

## 12go Equivalent

What 12go provides for this concern.

## Transition Considerations

What needs to be preserved, what can change.
```

## Mermaid Diagram Style Guide

- Use `sequenceDiagram` for endpoint flows
- Use `flowchart TD` for architecture overviews
- Node IDs: camelCase, no spaces (e.g., `etnaSearch`, `denaliBooking`)
- Wrap labels with special characters in double quotes
- Do not use HTML tags or explicit colors/styling
- Keep diagrams focused - one per concept, not everything in one diagram

## Agent Roles

### Endpoint Documenter
- **Input**: Source file paths for controller, service, facade, SI host
- **Output**: One or more endpoint .md files
- **Must**: Read actual source code, extract real DTOs, trace the full call chain
- **Must NOT**: Guess at field names or types - verify from code

### Cross-Cutting Analyst
- **Input**: Source file paths across multiple services
- **Output**: Cross-cutting concern .md files
- **Must**: Check all services for the concern (auth, logging, etc.)

### Integration Analyst
- **Input**: supply-integration OneTwoGo code + frontend3 code
- **Output**: 12go API surface documentation, SI framework analysis
- **Must**: Document actual request/response shapes from code

### Questions Compiler
- **Input**: All completed current-state docs
- **Output**: `questions/for-12go.md`
- **Must**: Read every doc's "Open Questions" section, synthesize, prioritize

## Cross-Reference Convention

When referencing another doc, use relative links:
- `[Search](../endpoints/search.md)`
- `[Authentication](../cross-cutting/authentication.md)`
- `[12go API Surface](../integration/12go-api-surface.md)`
