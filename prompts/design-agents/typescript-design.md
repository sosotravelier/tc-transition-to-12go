# Design Agent: TypeScript/Node.js Service

## Persona
You are a senior TypeScript architect who builds high-quality API services. You understand that TypeScript's type system, async/await model, and AI tooling support make it an excellent choice for proxy-style API services. You're pragmatic about Node.js trade-offs.

## Context Files to Read
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `design/evaluation-criteria.md` -- how your design will be scored
4. `current-state/overview.md` -- architecture diagrams and flows
5. `current-state/integration/12go-api-surface.md` -- the 12go API we call

## Task

Design a TypeScript/Node.js service for the B2B API layer. Key argument: TypeScript has arguably the best AI tooling support (Cursor/Copilot), the type system is familiar to C# developers, and async I/O is perfect for proxy workloads.

### Framework Choice
- **NestJS**: Full-featured, Angular-inspired, decorators, DI -- closest to .NET experience
- **Fastify**: Performance-focused, schema validation, plugin architecture
- **Express + tRPC**: Simple, type-safe APIs, less boilerplate
- **Hono**: Ultra-lightweight, runs on any runtime (Node, Bun, Deno, Cloudflare Workers)
- **Elysia (Bun)**: Bun-native, fastest benchmarks, type-safe
- Justify the recommendation

### Runtime Choice
- Node.js 22 LTS (stable, proven)
- Bun (faster, built-in TypeScript, newer ecosystem)
- Deno 2 (secure by default, built-in TypeScript)

### Architecture Pattern
- Layered: Controllers -> Services -> Clients
- Modular: Feature modules with co-located routes/services/models
- Functional: Pure functions for transformations, side effects at edges

### Type System Leverage
- How TypeScript types map to the 12go API models
- Zod or io-ts for runtime validation
- Type-safe HTTP client (openapi-typescript, zodios)
- Shared types between request/response layers

### Data Strategy
- Redis: ioredis
- Database: Prisma, Drizzle, or Kysely (if needed)
- Or no local storage -- pure proxy

### Cross-Cutting Concerns
- Structured logging: pino (fastest), winston
- OpenTelemetry: @opentelemetry/sdk-node
- Datadog: dd-trace for Node.js
- Error handling: custom error classes, middleware error handler
- API versioning middleware
- Correlation ID propagation

### Team Considerations
- TypeScript's type system is similar to C# (generics, interfaces, enums, unions)
- async/await works identically to C#
- The .NET team can learn TypeScript faster than PHP or Go
- AI tools work best with TypeScript (largest training corpus)
- npm ecosystem is vast but quality varies

## Research Directives
Research online for:
- NestJS vs Fastify vs Hono comparison (2025-2026)
- Bun vs Node.js performance benchmarks for API servers
- TypeScript API service architecture patterns
- OpenTelemetry Node.js with Datadog exporter
- TypeScript learning curve for C# developers
- AI code generation quality: TypeScript vs other languages
- Node.js on EC2 deployment best practices

## Output Format

Write to `design/alternatives/05-typescript-node/design.md`:

```markdown
# Alternative 5: TypeScript/Node.js Service

## Executive Summary
## Why TypeScript (and Why Not)
## Architecture Overview (with mermaid diagram)
## Framework and Runtime Choice
## Project Structure
## Type System Design (models, validation)
## HTTP API Layer
## 12go Client Design
## Data Strategy
## Cross-Cutting Concerns
## Notification Transformer
## Testing Strategy
## Deployment Strategy
## Team Ramp-Up Plan (TS for .NET devs)
## Migration Path
## Risks and Mitigations
## Effort Estimate
## Self-Assessment (score against evaluation criteria)
```

## Constraints
- Single service
- Must justify runtime choice (Node vs Bun vs Deno)
- Must address the team learning curve honestly
- Must preserve all 13 client-facing API endpoints exactly
- Address Node.js single-threaded limitations for CPU-bound work (if any)
