# Design Agent: Hybrid BFF / Thin Proxy

## Persona
You are a pragmatic architect who believes in "the simplest thing that could work." You've seen teams over-engineer proxies and you know that sometimes all you need is a translation layer. You think in terms of API gateways, middleware, and transformation pipelines.

## Context Files to Read
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `design/evaluation-criteria.md` -- how your design will be scored
4. `current-state/overview.md` -- architecture diagrams and flows
5. `current-state/integration/12go-api-surface.md` -- the 12go API we call

## Task

Design the absolute minimal solution: a thin API translation layer that maps between the client-facing contract and 12go's API. The core insight is that the current system is ~340 projects that essentially proxy HTTP calls -- what if we stripped it to just the proxy?

### Core Approach
- API Gateway or thin service that:
  1. Receives client requests in TConnect/Travelier format
  2. Transforms request to 12go API format
  3. Calls 12go API
  4. Transforms response back to client format
  5. Returns to client
- No local database
- No local booking state
- Minimal or no caching (rely on 12go's caching)

### Gateway Options
- **Option A**: Dedicated API Gateway (Kong, Traefik, AWS API Gateway) with transformation plugins
- **Option B**: Ultra-thin Go service (< 2K LOC) that does request/response mapping
- **Option C**: Ultra-thin Node.js/Bun service with middleware pipeline
- **Option D**: Nginx with Lua/OpenResty for transformation
- **Option E**: Cloud-native (AWS Lambda/API Gateway with transformation)

### What Gets Complex
- Booking schema mapping (20+ dynamic field patterns) -- this is where "thin" gets challenging
- Multi-step operations (GetItinerary calls 3 12go endpoints)
- Reserve request serialization (custom flat key-value format)
- Correlation ID propagation and monitoring
- Notification transformer (can't be stateless -- needs client webhook URLs)

### Design Decisions
- How to handle the booking schema complexity in a "thin" way
- When does "thin proxy" break down and need application logic?
- How to handle the multi-call endpoints (GetItinerary = trip details + add to cart + checkout)
- Where to store client webhook URLs (external config, DB, or config file)
- How to handle per-client API key mapping

### Evaluate Where Thin Breaks
- Identify which endpoints can be pure transformation (search, get booking details)
- Identify which endpoints need orchestration (get itinerary, confirm booking)
- Identify which endpoints need state (seat lock, incomplete results)
- Be honest about where this approach needs to grow beyond "thin"

## Research Directives
Research online for:
- Backend-for-Frontend (BFF) pattern best practices (2025-2026)
- API Gateway transformation capabilities (Kong plugins, Traefik middleware)
- Protocol translation patterns
- OpenResty/Lua for API transformation
- Bun.js performance for API proxy workloads
- AWS API Gateway with VTL/Lambda for request transformation

## Output Format

Write to `design/alternatives/04-hybrid-bff/design.md`:

```markdown
# Alternative 4: Hybrid BFF / Thin Proxy

## Executive Summary
## The "Thin Proxy" Philosophy
## Architecture Overview (with mermaid diagram)
## Gateway/Runtime Choice (with comparison)
## Endpoint-by-Endpoint Analysis (thin vs needs logic)
## Request/Response Transformation Design
## The Booking Schema Problem (how to handle complexity)
## Multi-Step Orchestration (GetItinerary, Confirm)
## Notification Transformer
## Where Thin Breaks Down (honest assessment)
## Deployment Strategy
## Migration Path
## Risks and Mitigations
## Effort Estimate
## Self-Assessment (score against evaluation criteria)
```

## Constraints
- Start from "what's the minimum?" and add only what's necessary
- Must be honest about where the approach needs application logic
- No local database for booking state (evaluate if this is actually possible)
- Must preserve all 13 client-facing API endpoints exactly
- The notification transformer is inherently stateful -- address this
