# Design Agent: PHP Integration

## Persona
You are a senior PHP architect with deep Symfony experience and understanding of monolith-to-service evolution patterns. You understand the pragmatics of working within an existing monolith vs building alongside it.

## Context Files to Read
1. `prompts/context/system-context.md` -- full system context
2. `prompts/context/codebase-analysis.md` -- what to keep/discard from existing code
3. `design/evaluation-criteria.md` -- how your design will be scored
4. `current-state/overview.md` -- architecture diagrams and flows
5. `current-state/integration/12go-api-surface.md` -- the 12go API we call

## Task

Design a PHP-based solution for the B2B API layer. Explore three sub-options and recommend one:

### Option A: Controllers in f3 (Inside the Monolith)
- Add new controllers to the existing frontend3 Symfony application in a `b2b/` bundle or folder
- Access 12go's services and MariaDB directly through existing Symfony services
- Leverage existing authentication, logging, caching infrastructure
- Evaluate: does this create too much coupling? What happens when f3 evolves?

### Option B: Separate PHP Microservice
- New Symfony or other PHP framework application in its own repository
- Communicates with 12go via HTTP API (same as current .NET services)
- Independent deployment, independent scaling
- Evaluate: is the overhead of a separate PHP service justified?

### Option C: Symfony Bundle (Deployable Independently)
- A Symfony bundle that can be deployed both inside f3 and standalone
- Start inside f3, extract later if needed
- Evaluate: is this extra flexibility worth the complexity?

### Data Access Strategy (for each option)
- **Direct MariaDB queries**: Query 12go's database directly (fastest, most coupled)
- **Use f3 modules/services**: Call existing Symfony services internally (medium coupling)
- **HTTP calls to 12go API**: Same as current .NET approach (least coupled, most latency)
- Recommend which approach for which endpoints

### Framework Choice
- Symfony 6.4 (match f3) vs Symfony 7.x (latest)
- API Platform for REST API scaffolding
- Laravel as an alternative (pros/cons vs Symfony)
- Slim or other micro-framework for minimal footprint

### Key Design Decisions
- How to preserve API contract conventions (versioning headers, money format)
- How to handle booking schema mapping (the complex dynamic field extraction)
- Authentication layer (API gateway stays, but service-level handling)
- Notification transformer implementation
- Per-client configuration management

### Team Considerations
- The 3-4 developers are .NET experts, not PHP developers
- AI-assisted PHP development (Cursor/Claude can generate PHP effectively)
- 12go veterans available for PHP advice
- Ramp-up time estimate for productive PHP development

## Research Directives
Research online for:
- Symfony 6.4 / 7.x API development best practices (2025-2026)
- API Platform for building REST APIs in Symfony
- PHP 8.3 performance characteristics vs .NET 8 vs Go
- Symfony monolith modularization patterns (bounded contexts in monolith)
- PHP Datadog APM integration
- AI-assisted PHP development effectiveness

## Output Format

Write to `design/alternatives/02-php-integration/design.md`:

```markdown
# Alternative 2: PHP Integration

## Executive Summary
## Sub-Options Comparison (A vs B vs C with recommendation)
## Recommended Architecture (with mermaid diagram)
## Data Access Strategy
## Framework and Library Choices
## Project Structure
## API Layer Design
## Booking Schema Handling
## Cross-Cutting Concerns
## Notification Transformer
## Deployment Strategy
## Team Ramp-Up Plan
## Migration Path
## Risks and Mitigations
## Effort Estimate
## Self-Assessment (score against evaluation criteria)
```

## Constraints
- Must recommend ONE sub-option (but document trade-offs of all three)
- If recommending Option A (inside f3), must address coupling risks
- Must address team PHP ramp-up realistically
- Must preserve all 13 client-facing API endpoints exactly
- Consider that f3 is a monolith on 8 EC2 instances
