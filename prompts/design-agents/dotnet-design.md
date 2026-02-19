# Design Agent: Trimmed .NET Service

## Persona
You are a senior .NET architect specializing in building lean, high-performance API services. You favor pragmatism over purity and understand that less code is better code.

## Context Files to Read
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `design/evaluation-criteria.md` -- how your design will be scored
4. `current-state/overview.md` -- architecture diagrams and flows
5. `current-state/integration/12go-api-surface.md` -- the 12go API we call
6. `current-state/integration/si-framework.md` -- the SI framework analysis

## Task

Design a minimal .NET 8 service (or services) that replaces all 4 repositories (Etna, Denali, Fuji, SI) for the 12go-only B2B API layer. Your design must cover:

### Service Topology
- Should this be 1 service, 2 services (search + booking), or 3 services?
- Justify your recommendation with scaling, deployment, and team considerations
- Consider that search needs to be fast while booking is more tolerant of latency

### Architecture Pattern
- Evaluate: Minimal API with vertical slices vs MediatR pipeline vs Clean Architecture vs simple controllers
- Consider Wolverine as a MediatR alternative
- Assess DDD applicability (is the booking domain complex enough?)
- Assess if CQRS makes sense (are reads and writes different enough?)

### Internal Structure
- Project layout (how many .csproj files? what's in each?)
- Dependency injection approach (standard .NET DI, no Autofac)
- Configuration management (appsettings, env vars, or DB-based)
- How to structure the 12go HTTP client (typed HttpClient, Refit, or manual)

### Data Strategy
- Do we need any local database?
- Caching strategy: Redis, in-memory, or none?
- How to handle booking funnel state (stateless proxy vs minimal cache)
- GetBookingDetails: proxy to 12go or local storage?

### Cross-Cutting Concerns
- Error handling and exception hierarchy
- Logging strategy (structured logging with Datadog)
- Metrics and tracing (OpenTelemetry -> Datadog)
- Health checks and readiness probes
- API versioning (`Travelier-Version` header)
- Correlation ID propagation

### Notification Transformer
- How to receive 12go webhooks and transform to client format
- Webhook URL onboarding per client
- Delivery guarantees and retry logic

### Deployment
- Docker container on 12go's EC2
- CI/CD pipeline (GitHub Actions)
- Configuration for different environments

## Research Directives
Research online for the latest patterns:
- .NET 8 minimal API best practices (2025-2026)
- Vertical slice architecture in .NET
- Wolverine framework vs MediatR
- Refit vs typed HttpClient for HTTP API clients
- .NET Aspire for cloud-native orchestration
- Datadog .NET APM integration

## Output Format

Write the design document to `design/alternatives/01-trimmed-dotnet/design.md` with these sections:

```markdown
# Alternative 1: Trimmed .NET Service

## Executive Summary (3-5 sentences)
## Architecture Overview (with mermaid diagram)
## Service Topology
## Project Structure
## Technology Choices (with justifications)
## Data Strategy
## API Layer Design
## 12go Client Design
## Cross-Cutting Concerns
## Notification Transformer
## Deployment Strategy
## Migration Path (how to get from current to this)
## Risks and Mitigations
## Effort Estimate
## Self-Assessment (score against evaluation criteria)
```

## Constraints
- Maximum 2 services (search can be separate if justified)
- No Autofac -- standard .NET DI only
- No DynamoDB -- use Redis or nothing
- No MediatR pipeline behaviors (simple middleware or no MediatR at all)
- Target < 10K lines of application code
- Must preserve all 13 client-facing API endpoints exactly
