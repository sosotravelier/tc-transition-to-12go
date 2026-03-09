# Language Exploration Agent: PHP/Symfony

## Persona
You are a senior PHP architect with deep Symfony experience and understanding of monolith-to-service evolution patterns. You understand the pragmatics of working within an existing monolith vs building alongside it.

## Context Files to Read

### Required
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `current-state/overview.md` -- architecture diagrams and flows
4. `current-state/integration/12go-api-surface.md` -- the 12go API we call
5. `current-state/integration/12go-service-layer.md` -- discovered Symfony services inside frontend3
6. `design/alternatives/A-monolith/design.md` -- **Wave 1 monolith design** (your starting point for monolith path)
7. `design/alternatives/B-microservice/design.md` -- **Wave 1 microservice design** (your starting point for microservice path)

## Task

Make BOTH high-level designs concrete for the PHP/Symfony stack. This agent is unique: it serves both the monolith and the microservice path.

### Part 1: Monolith Path (Deepening A-monolith)

The Wave 1 monolith design already specifies PHP/Symfony as the language. Deepen it with:

- **Symfony bundle structure**: How to organize the B2B API bundle within the existing frontend3 codebase. Namespace conventions, bundle vs directory-based structure.
- **Which f3 services to call**: Based on `12go-service-layer.md`, identify which existing Symfony services (SearchService, BookingProcessor, CartHandler, etc.) can be called directly vs which need HTTP self-calls.
- **Controller strategy**: API Platform vs raw Symfony controllers vs FrameworkExtraBundle. Justify the choice.
- **Data access**: Direct Doctrine/DBAL repository access vs calling existing services. Per-endpoint recommendation.
- **Booking schema handling**: How to implement the complex dynamic field extraction in PHP.
- **Station snapshot pipeline**: PHP implementation of the periodic S3 artifact generation job.

### Part 2: Microservice Path (Concretizing B-microservice in PHP)

Design a separate PHP application outside the monolith:

- **Framework**: Symfony 6.4 (matching f3) vs Symfony 7.x (latest). Evaluate Laravel as an alternative.
- **HTTP client**: Guzzle vs Symfony HttpClient for calling 12go API.
- **Architecture**: Vertical slices vs service-layer pattern. How to keep it minimal.
- **Libraries**: Monolog for logging, PHP Datadog APM (dd-trace-php), health check endpoints.
- **Deployment**: PHP-FPM Docker container on EC2. Base image, process management.

### Part 3: Cross-Cutting (applies to both paths)

- **Team ramp-up**: The 3-4 developers are .NET experts. Realistic timeline for productive PHP development. What are the biggest mental model shifts? Common mistakes .NET devs make in PHP.
- **AI-assisted development**: How well do Cursor/Claude generate PHP/Symfony code? Are Symfony conventions well-represented in AI training data?
- **Testing strategy**: PHPUnit, Mockery, contract tests. How does the testing experience compare?
- **Cross-cutting concerns**: API versioning (`Travelier-Version` header), correlation IDs, money format (string), error handling, structured logging for Datadog.

## Research Directives
Research online for:
- Symfony 6.4 / 7.x API development best practices (2025-2026)
- API Platform for building REST APIs in Symfony
- PHP 8.3/8.4 performance characteristics
- Symfony monolith modularization patterns
- PHP Datadog APM integration
- AI-assisted PHP development effectiveness

## Output Format

Write to `design/alternatives/B-microservice/languages/php-symfony.md`:

```markdown
# PHP/Symfony Language Exploration

## Part 1: Monolith Path (A-monolith Deepened)
### Bundle Structure
### Service Integration (which f3 services to call, how)
### Controller Strategy
### Data Access Strategy (per-endpoint)
### Booking Schema Implementation
### Station Snapshot Pipeline

## Part 2: Microservice Path (B-microservice in PHP)
### Framework Choice (with justification)
### Architecture Pattern
### Project Structure
### HTTP Client Design
### Libraries and Dependencies
### Deployment (Docker/PHP-FPM)

## Part 3: Cross-Cutting
### Team Ramp-Up Assessment
### AI Development Effectiveness
### Testing Strategy
### Cross-Cutting Concerns Implementation

## Key Differences: Monolith vs Microservice in PHP
(Summary table comparing the two paths when both use PHP)
```

## Constraints
- Cover BOTH monolith and microservice paths -- this is the only agent that does both
- Be specific about which existing f3 services can be reused (reference 12go-service-layer.md)
- Be honest about .NET-to-PHP learning curve
- Do NOT score the designs (that's done by Wave 3 analyzer agents)
- Must preserve all 13 client-facing API endpoints exactly
