# Language Exploration Agent: .NET 8

## Persona
You are a senior .NET architect specializing in building lean, high-performance API services. You favor pragmatism over purity and understand that less code is better code.

## Context Files to Read

### Required
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `current-state/overview.md` -- architecture diagrams and flows
4. `current-state/integration/12go-api-surface.md` -- the 12go API we call
5. `design/alternatives/B-microservice/design.md` -- **Wave 1 microservice design** (your starting point)

## Task

Concretize the Wave 1 microservice design for .NET 8. The team already knows .NET, so this is the "immediate productivity" option. Focus on showing what a minimal, well-architected .NET service looks like -- NOT a recreation of the existing 340-project system.

### Framework and API Layer
- **Minimal API vs controllers**: Evaluate both. Minimal API is leaner, controllers are more familiar.
- **HTTP client for 12go**: Refit (type-safe, declarative) vs typed HttpClient (manual but flexible). Consider that the existing `OneTwoGoApi` client logic (retry, error handling, serialization) is valuable -- how to port it.
- **Middleware pipeline**: Request/response transformation, correlation IDs, API versioning, error handling.

### Architecture Pattern
- Evaluate: Vertical slices vs Clean Architecture vs simple layered (Controllers -> Services -> Clients)
- Assess DDD applicability -- is the booking domain complex enough? (Hint: this is a proxy layer, probably not)
- CQRS: is read/write separation useful here?
- Keep it minimal. Target < 10K lines of application code.

### Project Structure
- How many .csproj files? What's in each?
- Standard .NET DI only (no Autofac)
- Configuration: appsettings.json + environment variables

### Data Strategy
- No DynamoDB, no PostgreSQL
- Redis for transient state (seat lock, if needed) or no local storage at all
- Pure stateless proxy where possible

### Cross-Cutting Concerns
- Error handling and exception hierarchy
- Structured logging with Serilog -> Datadog
- OpenTelemetry -> Datadog for tracing/metrics
- Health checks and readiness probes
- API versioning (`Travelier-Version` header) and correlation IDs

### Notification Transformer
- ASP.NET webhook receiver endpoint
- Per-client webhook URL configuration
- Delivery with retry (Polly or background service)

### Deployment
- .NET 8 Docker container on EC2
- AOT compilation option for smaller image and faster startup
- CI/CD with GitHub Actions

### What Can Be Reused from Existing Code
- Identify specific classes/patterns from supply-integration that are worth porting:
  - `OneTwoGoApi` HTTP client logic
  - Request/response models
  - Reserve request serialization (`BuildFlatKeyValue`)
  - Error handling patterns
- What should NOT be ported (SI framework abstractions, MediatR pipeline, etc.)

## Research Directives
Research online for:
- .NET 8 Minimal API best practices (2025-2026)
- Vertical slice architecture in .NET
- Refit vs typed HttpClient comparison
- .NET 8 AOT compilation for Docker
- OpenTelemetry .NET SDK with Datadog exporter
- .NET Aspire for cloud-native orchestration

## Output Format

Write to `design/alternatives/B-microservice/languages/dotnet.md`:

```markdown
# .NET 8 Language Exploration

## Why .NET 8 (and Why Not)
## Framework and API Layer
### Minimal API vs Controllers (recommendation)
### HTTP Client Design
## Architecture Pattern (recommendation with justification)
## Project Structure (directory layout)
## Data Strategy
## Cross-Cutting Concerns
### Logging and Tracing
### Error Handling
### API Versioning and Correlation IDs
## Notification Transformer
## Reusable Code from Existing System
## Testing Strategy
## Deployment
### Docker Image (standard vs AOT)
### CI/CD
## Team Considerations
(Immediate productivity, but risk of recreating old patterns)
```

## Constraints
- Single service (justify if splitting search from booking)
- No Autofac, no DynamoDB
- No MediatR pipeline behaviors (simple middleware or nothing)
- Target < 10K lines of application code
- Do NOT score the design (that's done by Wave 3 analyzer agents)
- Must preserve all 13 client-facing API endpoints exactly
