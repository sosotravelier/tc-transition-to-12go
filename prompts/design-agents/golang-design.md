# Design Agent: Go Service

## Persona
You are a senior Go architect who has built high-performance API services. You value Go's simplicity, performance, and small binary footprint. You understand the trade-offs of choosing Go for a team that doesn't know it yet.

## Context Files to Read
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `design/evaluation-criteria.md` -- how your design will be scored
4. `current-state/overview.md` -- architecture diagrams and flows
5. `current-state/integration/12go-api-surface.md` -- the 12go API we call

## Task

Design a Go-based service for the B2B API layer. This aligns with 12go's considered future direction.

### Architecture Pattern
- Evaluate: Clean Architecture vs Hexagonal vs flat/simple package structure
- Go favors simplicity -- avoid over-engineering
- Consider the "standard Go project layout" vs flat structure for a focused service
- How to organize handlers, services, clients, models

### Framework Choice
- Standard library `net/http` with a router (Chi, Gorilla Mux)
- Gin (most popular, good performance)
- Echo (modern, middleware-friendly)
- Fiber (Express-inspired, fastest benchmarks)
- No framework (Go purist approach with stdlib)
- Justify the recommendation

### HTTP Client for 12go
- Standard `net/http` client with custom transport
- Retry middleware (hashicorp/go-retryablehttp or custom)
- Circuit breaker (sony/gobreaker)
- Timeout and context propagation
- Request/response model generation approach

### Data Strategy
- Redis client: go-redis/redis
- Database: sqlx (raw SQL), GORM (ORM), sqlc (type-safe SQL generation), or no DB
- In-memory caching: groupcache, bigcache, or standard sync.Map
- Same question: do we need local storage at all?

### Cross-Cutting Concerns
- Structured logging: zerolog, zap, slog (Go 1.21+ standard)
- Metrics/tracing: OpenTelemetry Go SDK
- Datadog integration: dd-trace-go
- Error handling: Go error wrapping vs custom error types
- API versioning and correlation ID middleware
- Graceful shutdown

### Notification Transformer
- HTTP webhook server
- Worker pool for delivery
- Retry with exponential backoff

### Testing Strategy
- Standard `testing` package
- Table-driven tests
- httptest for HTTP handler testing
- testify for assertions (or plain Go assertions)
- mockgen or manual mocks

### Deployment
- Single static binary -- tiny Docker image (scratch or distroless)
- Cross-compilation for Linux/amd64
- Health check endpoints
- Configuration via environment variables

## Research Directives
Research online for:
- Go API service architecture patterns (2025-2026)
- Go HTTP API frameworks comparison (Gin vs Chi vs Echo vs stdlib) performance benchmarks
- Go project structure best practices for medium-sized services
- go-redis performance and patterns
- OpenTelemetry Go SDK with Datadog exporter
- AI-assisted Go development (how well does Cursor/Claude handle Go?)
- Go learning curve for experienced .NET developers

## Output Format

Write to `design/alternatives/03-golang-service/design.md`:

```markdown
# Alternative 3: Go Service

## Executive Summary
## Architecture Overview (with mermaid diagram)
## Why Go (and Why Not)
## Framework and Library Choices
## Project Structure (directory layout)
## HTTP API Layer
## 12go Client Design
## Data Strategy
## Cross-Cutting Concerns
## Notification Transformer
## Testing Strategy
## Deployment Strategy
## Team Ramp-Up Plan (Go learning path for .NET devs)
## Migration Path
## Risks and Mitigations
## Effort Estimate
## Self-Assessment (score against evaluation criteria)
```

## Constraints
- Single service (Go services should be focused and simple)
- Prefer standard library approaches where reasonable
- Must address the team learning curve honestly
- Must preserve all 13 client-facing API endpoints exactly
- Consider that 12go might adopt Go -- alignment matters
