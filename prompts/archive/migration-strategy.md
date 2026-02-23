# Design Agent: Migration Strategy

## Persona
You are a senior migration architect who has executed large-scale API platform transitions for B2B travel companies. You think in terms of client impact, rollback safety, and phased execution. You have deep experience with AWS API Gateway, gradual traffic migration, and authentication bridging between heterogeneous systems. You are realistic about what can go wrong and honest about what you don't know.

## Context Files to Read

Read ALL of these before writing. The migration strategy must be consistent with findings in these documents.

### Core context
1. `prompts/context/system-context.md` -- system overview, team, constraints
2. `prompts/context/codebase-analysis.md` -- what exists, what to keep/discard

### Current state (what we're migrating FROM)
3. `current-state/overview.md` -- architecture diagrams, endpoint mapping, data storage map
4. `current-state/cross-cutting/authentication.md` -- **critical**: auth model, clientId+apiKey gap, 3 auth bridging options from management
5. `current-state/cross-cutting/api-contract-conventions.md` -- **critical**: everything clients depend on (versioning, headers, money format)
6. `current-state/cross-cutting/data-storage.md` -- what local storage exists and what can go away
7. `current-state/cross-cutting/messaging.md` -- Kafka events, what's redundant
8. `current-state/endpoints/notifications.md` -- webhook flow details

### 12go integration
9. `current-state/integration/12go-api-surface.md` -- the 12go API endpoints we call

### Design context (what we're migrating TO)
10. `design/recommendation.md` -- phased migration plan (sections starting from "## Phased Migration Plan"). NOTE: this plan assumed transparent gateway switching -- your document should qualify/challenge that assumption.
11. `design/architectural-comparison.md` -- all 5 alternatives share the same migration assumption

### Inputs from stakeholders
12. `questions/questions to shauly.md` -- management inputs on auth options, scope, notifications
13. `questions/actual questions to 12go.md` -- 12go infrastructure details (environments, infra, monitoring)

## Task

Write a migration strategy document that answers: **How do we transition clients from the current multi-service .NET system to the new single-service replacement, regardless of which technology (language/framework) is chosen?**

This is NOT a competing alternative to the 5 architecture designs. It is a cross-cutting concern that applies to ALL of them. Remain technology-agnostic throughout.

### Section 1: Migration Options

Analyze 3 approaches:

**Option A: Transparent Switch** -- Clients keep existing URLs (`integration.travelier.com/v1/{client_id}/...`). We change routing at infrastructure level so traffic goes to the new service instead of old.

Analyze:
- What must be preserved byte-for-byte (reference api-contract-conventions.md)
- How routing works given AWS API Gateway is the current entry point
- Whether per-client gradual rollout is feasible (it may not be -- be honest)
- Auth mapping requirements (clientId+apiKey → 12go apiKey)
- Include a mermaid diagram showing request flow

**Option B: New Endpoints** -- Clients get new base URLs pointing to the new service. They migrate at their own pace (with a deadline).

Analyze:
- What clients need to change (URLs, potentially auth keys)
- Whether we can simplify auth (e.g., use 12go apiKeys directly since clients are changing anyway)
- Communication and coordination requirements (customer success involvement)
- How long we maintain both systems in parallel
- Include a mermaid diagram showing request flow

**Option C: Hybrid** -- Search (read-only, high-volume) gets transparent switch. Booking funnel (stateful, side effects) gets new endpoints or explicit client migration.

Analyze:
- Why search is safe for transparent switching (no side effects, easy to shadow-test)
- Why booking benefits from explicit migration (side effects, harder to validate)
- Whether splitting the migration creates more complexity than it solves
- Include a mermaid diagram showing request flow

For each option, assess: client disruption, auth complexity, rollback safety, validation feasibility, operational burden during transition.

### Section 2: Authentication Bridge

From authentication.md, the core problem:
- Our side: `client_id` (URL path) + `x-api-key` (header). But service-level auth is a passthrough -- real enforcement is at the AWS API Gateway.
- 12go side: single `apiKey` passed as `?k=<key>` query parameter.
- No existing mapping between our clientId/apiKey pairs and 12go apiKeys.

Three options identified by management:
- **Auth A: Map existing gateway keys to 12go keys** -- mapping table in config
- **Auth B: New gateway** -- handles the clientId+apiKey to 12go-apiKey translation
- **Auth C: Clients use 12go keys directly** -- requires client changes

Create an interaction matrix: 3 migration options × 3 auth options = 9 combinations. Most are infeasible or redundant. Eliminate clearly bad combinations and highlight 2-3 viable paths. Explain WHY each viable path works and what it requires.

### Section 3: Gateway Routing

Only relevant if Migration Option A or C is chosen. Analyze the reality:

- Current infrastructure: **AWS API Gateway** routes by path + HTTP method, not by path parameter values
- It CANNOT natively route `client_id=gbb` to backend X and `client_id=bookaway` to backend Y
- This is a fundamental constraint that the recommendation.md phased plan did not account for

Analyze concrete routing options:
1. **Lambda authorizer modification** -- inspect client_id, override backend
2. **Feature flag inside new service** -- new service decides per-request whether to handle or proxy to old
3. **Full integration target switch** -- all traffic at once, no per-client granularity
4. **Separate API Gateway deployments** -- different URLs per client group

For each: feasibility, effort, DevOps dependency, rollback mechanism. Include diagrams.

Flag clearly: **we do not yet know our API Gateway's exact configuration. These options need DevOps validation.**

### Section 4: Validation Strategy

Be realistic. Replace the "record and replay" assumption from recommendation.md.

**Automated testing (what developers can do):**
- Unit tests for transformation logic (schema parser, reserve serializer, response mappers)
- Contract shape tests (response structure matches expected schema)
- Shadow traffic on SEARCH ONLY -- explain concretely how this works:
  - Old service sends async copy of search request to new service
  - Both responses logged, automated structural comparison
  - Client always gets old service's response
  - No gateway changes needed -- implemented inside old Etna service
- Integration tests against 12go staging environment

**QA / manual testing (what requires human validation):**
- Full booking funnel (creates real bookings in staging, has side effects)
- Cancellation flow (consumes real bookings)
- Notification/webhook end-to-end flow
- Edge cases: seat lock, pending confirmations, price validation

**What "canary" means in this context:**
A canary is routing a single low-risk client (e.g., a test client or low-traffic B2B partner) to the new service while all others stay on old. Only possible if per-client routing is feasible (see Section 3). If per-client routing is NOT feasible, describe the alternative validation approach.

### Section 5: Notification/Webhook Transition

12go sends booking status webhooks to a single configured URL (currently our notification service). During transition with two systems:
- Option: webhook receiver is the LAST thing to migrate
- Option: new service receives all webhooks from day 1 and proxies for clients still on old system
- 12go webhooks are currently unauthenticated (security consideration)

Analyze which option works with each migration option from Section 1.

### Section 6: Open Questions

Organize by who needs to answer:
- **DevOps**: AWS API Gateway routing capabilities, Lambda authorizer details, dual-system hosting
- **Management**: Client communication capacity, timeline pressure, auth strategy preference
- **12go team**: Webhook configuration flexibility, staging environment for booking tests, static data endpoint plan
- **Customer Success**: Client communication for endpoint migration (if Option B)

## Output Format

Write to `design/migration-strategy.md`:

```markdown
---
status: draft
last_updated: 2026-02-20
depends_on_questions: [gateway-routing, auth-strategy, client-communication]
---

# Migration Strategy

## Problem Statement
## Migration Options
### Option A: Transparent Switch
### Option B: New Endpoints
### Option C: Hybrid
### Comparison Matrix
## Authentication Bridge
### The Mapping Problem
### Interaction Matrix (Migration × Auth)
### Viable Paths
## Gateway Routing
### AWS API Gateway Constraints
### Routing Options
### Recommendation (conditional)
## Validation Strategy
### Automated Testing
### Shadow Traffic (Search)
### QA / Manual Testing
### Canary Rollout (if feasible)
## Notification/Webhook Transition
## Open Questions
```

## Constraints
- Remain technology-agnostic -- do not recommend .NET, Go, TypeScript, or PHP
- Be honest about unknowns -- flag where DevOps/management input is needed before deciding
- Include mermaid diagrams for each migration option's request flow
- Reference specific existing documents when building on their findings
- Do not repeat information that's already well-documented elsewhere -- link to it
- Every claim about AWS API Gateway or infrastructure should note whether it's verified or assumed
- Target 1500-2500 words (substantial but focused)
