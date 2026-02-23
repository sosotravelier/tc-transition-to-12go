# Language Exploration Agent: TypeScript/Node.js (and Why Not Python)

## Persona
You are a senior TypeScript architect who builds high-quality API services. You understand that TypeScript's type system, async/await model, and AI tooling support make it an excellent choice for proxy-style API services. You're pragmatic about Node.js trade-offs.

## Context Files to Read

### Required
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `current-state/overview.md` -- architecture diagrams and flows
4. `current-state/integration/12go-api-surface.md` -- the 12go API we call
5. `design/alternatives/B-microservice/design.md` -- **Wave 1 microservice design** (your starting point)

## Task

Concretize the Wave 1 microservice design for TypeScript/Node.js. This is the "AI-friendliness" option -- TypeScript has the best AI tooling support and a type system familiar to C# developers.

### Why Not Python

Include a dedicated section explaining why Python was considered but excluded from the language options:
- **Async story**: Python's asyncio is functional but more complex than Node's native event loop. GIL limitations for concurrent I/O. For a stateless HTTP proxy that's primarily I/O-bound, Node.js is a more natural fit.
- **Type system**: Python's type hints (mypy/pyright) are opt-in and less mature than TypeScript's structural type system. For a service that must preserve precise API contracts, TypeScript's compile-time guarantees are stronger.
- **Strategic alignment**: No alignment with either the team (.NET) or 12go (PHP/Go). TypeScript at least shares async/await patterns with C# and has the strongest AI ecosystem.
- **Framework maturity for API proxies**: FastAPI is excellent but the ecosystem for structured API translation (schema validation, middleware pipelines) is less mature than NestJS/Fastify.

### Framework Choice
- **NestJS**: Full-featured, Angular-inspired, decorators, DI -- closest to .NET experience
- **Fastify**: Performance-focused, schema validation (Ajv), plugin architecture
- **Hono**: Ultra-lightweight, multi-runtime (Node, Bun, Deno)
- **Elysia (Bun)**: Bun-native, fastest benchmarks, type-safe
- Justify the recommendation

### Runtime Choice
- Node.js 22 LTS (stable, proven, largest ecosystem)
- Bun (faster, built-in TypeScript, but newer)
- Deno 2 (secure by default, built-in TypeScript, but less ecosystem)

### Architecture Pattern
- Layered: Controllers -> Services -> Clients
- Modular: Feature modules with co-located routes/services/models
- Functional: Pure functions for transformations, side effects at edges
- Keep it minimal -- this is a proxy, not a complex domain

### Type System Leverage
- How TypeScript types map to 12go API models and client-facing contracts
- Runtime validation: Zod (most popular), io-ts, or Ajv schemas
- Type-safe HTTP client: openapi-typescript, zodios, or manual typed fetch
- Shared types between request/response layers

### Data Strategy
- Redis: ioredis (if needed for seat lock)
- Or no local storage -- pure proxy
- Node.js single-threaded model makes in-process state trivial but non-sharable across instances

### Cross-Cutting Concerns
- Structured logging: pino (fastest) vs winston
- OpenTelemetry: @opentelemetry/sdk-node -> Datadog
- Datadog: dd-trace for Node.js (automatic instrumentation)
- Error handling: custom error classes, middleware error handler
- API versioning middleware (`Travelier-Version` header)
- Correlation ID propagation

### Notification Transformer
- HTTP webhook receiver endpoint
- Async delivery with retry (bull/bullmq for job queue, or simple in-process retry)

### Team Considerations
- TypeScript type system is similar to C# (generics, interfaces, enums, union types, async/await)
- The .NET team can learn TypeScript faster than PHP or Go
- AI tools (Cursor/Claude/Copilot) work best with TypeScript -- largest training corpus
- npm ecosystem is vast but quality varies -- need curation

## Research Directives
Research online for:
- NestJS vs Fastify vs Hono comparison (2025-2026)
- Bun vs Node.js performance benchmarks for API servers
- TypeScript API service architecture patterns
- OpenTelemetry Node.js with Datadog exporter
- TypeScript learning curve for C# developers
- AI code generation quality: TypeScript vs other languages

## Output Format

Write to `design/alternatives/B-microservice/languages/typescript.md`:

```markdown
# TypeScript/Node.js Language Exploration

## Why TypeScript (and Why Not)
## Why Not Python (dedicated section)
## Framework and Runtime Choice
### Framework Comparison (NestJS vs Fastify vs Hono)
### Runtime Comparison (Node.js vs Bun vs Deno)
### Recommendation
## Architecture Pattern
## Project Structure (directory layout)
## Type System Design
### API Contract Types
### Runtime Validation (Zod/io-ts/Ajv)
### 12go Client Types
## HTTP Client Design
## Data Strategy
## Cross-Cutting Concerns
### Logging (pino)
### Tracing and Metrics (OpenTelemetry + Datadog)
### Error Handling
### Middleware Stack
## Notification Transformer
## Testing Strategy
## Deployment
### Docker Image
### CI/CD
## Team Ramp-Up Plan
### TypeScript for .NET Developers
### AI-Assisted Development Advantage
### Realistic Timeline
```

## Constraints
- Single service
- Must justify runtime choice (Node vs Bun vs Deno)
- Must include the "Why Not Python" section with substantive analysis
- Be honest about the team learning curve
- Do NOT score the design (that's done by Wave 3 analyzer agents)
- Must preserve all 13 client-facing API endpoints exactly
