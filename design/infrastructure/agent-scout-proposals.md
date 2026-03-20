# Agent Scout Proposals

## Current Agent Roster

### Design Agents (Phase 2) -- 6 agents
All use `model: opus` and tools `Read, Grep, Glob, Write`. Each reads system context + codebase analysis + meeting notes, and produces a design document at `design/alternatives/<name>/design.md`.

| Agent | Perspective | Core Differentiator |
|-------|-------------|---------------------|
| **pragmatic-minimalist** | Legacy migration consultant | Strangler fig, boring tech, minimum viable change |
| **platform-engineer** | DevOps engineer | Operational reality, "who operates this at 3am" |
| **data-flow-architect** | Data/event architect | Kafka events, ClickHouse, event correlation |
| **team-first-developer** | Developer experience advocate | AI tooling, team morale, onboarding cost |
| **disposable-architecture** | Replaceability architect | Ports and adapters, anti-corruption layer, feature flags |
| **clean-slate-designer** | Contract-first architect | Ignores existing code, designs from API contract only |

### Analyzer Agents (Phase 3) -- 4 agents
All use `model: opus` and tools `Read, Grep, Glob, Write`. Each reads all 6 design docs and produces analysis at `design/analysis/<name>.md`.

| Agent | Role | Scores? |
|-------|------|---------|
| **red-team** | Skeptical CTO finding failure modes | No -- produces failure mode analysis |
| **execution-realist** | Effort/feasibility evaluator | Yes -- C1, C2, C6, C12 |
| **ai-friendliness** | AI tooling evaluator | Yes -- C3, C7, C10 (partial) |
| **technical-merit** | Architecture quality evaluator | Yes -- C4, C5, C8, C9, C10 (authoritative), C11 |

### Meta Agents -- 2 agents
| Agent | Role |
|-------|------|
| **agent-scout** (this agent) | Proposes new agents |
| **skill-scout** | Proposes new skills |

### Skills -- 4 skills
| Skill | Purpose |
|-------|---------|
| `/run-design-phase` | Orchestrates Phase 2: archive, pre-flight, launch 6 agents, synthesize decision map |
| `/run-evaluation-phase` | Orchestrates Phase 3: launch 4 analyzers, synthesize matrix + recommendation |
| `/archive-design` | Moves current design iteration to `design/archive/v{N}/` |
| `/synthesize-decision-map` | Generates `design/decision-map.md` from current designs and evaluations |

---

## Workflow Analysis

### What Works Well
- **Phase 2 and Phase 3 are fully automated** via `/run-design-phase` and `/run-evaluation-phase`. Six design agents and four analyzers run in parallel with one command each.
- **Agent perspectives are well-differentiated.** The shift from language-based to perspective-based agents (v1 decision log) was correct -- the 6 agents produce genuinely diverse designs.
- **Separation of concerns is clean.** Design agents write, analyzer agents evaluate, orchestrator skills synthesize. No agent does double duty.

### Bottlenecks and Gaps

**1. The design-to-implementation gap is the largest hole.**
The project has 10 agents dedicated to producing and evaluating *design documents*. It has zero agents for the *implementation phase* that starts this week (week of Mar 23). AGENTS.md defines Phase 4 roles (POC Implementation, Implementation, Test) but none are built as Claude Code agents. The Q2 deliverables proposal commits to 10 endpoints in 11 working weeks. The agent infrastructure does not support this.

**2. Meeting preparation is manual and high-effort.**
Three meetings have required substantial preparation documents (`meeting-brief.md`, `q2-deliverables-proposal.md`, `meeting-brief.md` for Mar 25). Each was hand-crafted. With a Mar 25 meeting imminent and more stakeholder syncs expected, this is a recurring time sink for a solo developer.

**3. Meeting transcript processing is manual.**
Raw transcripts exist (`transcript.txt`) for at least two meetings. Processing them into structured `meeting-record.md` or `new-findings.md` files with decisions, action items, and context updates is done manually each time.

**4. No agent validates implementation against design decisions.**
The decision map contains 17 resolved decisions (D1-D17) and 14 convergences. As implementation proceeds, there is no automated check that code aligns with these decisions. Design drift is likely under deadline pressure.

**5. No agent handles the "context update" workflow.**
When a meeting produces new findings (e.g., Mar 12's new mapping dimensions, Mar 17's solo resourcing), `system-context.md` must be manually updated. This context is read by every agent -- stale context produces stale designs.

**6. No agent supports endpoint-by-endpoint implementation planning.**
The Q2 plan commits to building 10 endpoints in sequence. Each endpoint has a `current-state/endpoints/<name>.md` doc with flow diagrams, 12go equivalents, and open questions. There is no agent that reads this doc + the design recommendation + the F3 codebase and produces a concrete implementation plan for one specific endpoint.

**7. No code review or quality agent.**
As a solo developer using AI-assisted development, there is no "second pair of eyes" agent that reviews code changes for contract fidelity, security concerns, or adherence to the design decisions.

---

## Proposed New Agents

### Agent: implementation-planner
- **Role**: Produces a concrete implementation plan for a single endpoint, reading the current-state doc, design decisions, and F3 codebase structure.
- **Persona**: A senior PHP developer who has worked in F3 for 3 years. You know the service layer, the routing conventions, the Symfony bundle structure. You translate high-level design decisions into specific file paths, class names, and method signatures.
- **When to use**: Before starting implementation of each of the 10 endpoints. Invoke once per endpoint, passing the endpoint name as context.
- **Inputs**: `current-state/endpoints/<endpoint>.md`, `design/recommendation.md`, `design/decision-map.md` (convergences and resolved decisions), `current-state/integration/12go-api-surface.md`, F3 source code (route definitions, service layer structure, existing B2B/Search POC code)
- **Outputs**: `implementation/plans/<endpoint>.md` -- containing: Symfony route definition, controller skeleton, service classes needed, mapper class signatures, F3 internal services to call (with file paths), Redis cache usage (if any), test fixture list (from C# tests to port), estimated complexity, open questions specific to this endpoint.
- **Why not a skill?**: Each endpoint has unique complexity (booking schema parser for GetItinerary, bracket-notation for CreateBooking, cancellation policy mapping for CancelBooking). The agent needs to reason about the specific endpoint's data flow, not follow a template. It must read and understand F3 source code structure, which requires exploratory tool use.
- **Complexity**: Medium

### Agent: meeting-prep
- **Role**: Generates a meeting preparation document from agenda items, prior meeting records, and project state.
- **Persona**: A technical program manager who prepares engineering leaders for stakeholder meetings. You know what decisions are pending, what risks are active, and what progress has been made. You write concisely for mixed audiences (technical + management).
- **When to use**: Before any stakeholder meeting. Invoke with: meeting date, attendees, agenda topics, and what decisions are needed.
- **Inputs**: Recent meeting records in `meetings/`, `design/recommendation.md`, `design/decision-map.md` (open questions), `prompts/context/system-context.md`, implementation progress (if applicable), the Q2 deliverables proposal.
- **Outputs**: `meetings/<date>-<topic>/meeting-brief.md` -- containing: agenda with time estimates, per-topic talking points with supporting data, decisions needed (table), risks to surface, prior decisions to reference.
- **Why not a skill?**: Meeting prep requires reasoning about what is relevant to the specific audience and agenda. A skill could produce a template, but the value is in the agent selecting which project facts, risks, and decisions to highlight. Different meetings need different emphasis.
- **Complexity**: Low-Medium

### Agent: transcript-processor
- **Role**: Processes a raw meeting transcript into a structured meeting record with decisions, action items, and context updates.
- **Persona**: A meticulous note-taker who distinguishes between opinions, decisions, and action items. You understand the project domain well enough to flag when a statement contradicts a prior decision or introduces a new constraint.
- **When to use**: After any meeting where a transcript is available. Invoke with the transcript file path.
- **Inputs**: `meetings/<date>-<topic>/transcript.txt`, `prompts/context/system-context.md` (to detect new information), `design/decision-map.md` (to detect decision changes), previous meeting records (for continuity).
- **Outputs**: `meetings/<date>-<topic>/meeting-record.md` -- containing: attendees, key decisions (table), action items (with owners and deadlines), new constraints or findings, suggested updates to `system-context.md` (diff format, not applied automatically).
- **Why not a skill?**: Transcripts are messy -- overlapping speakers, tangents, implied decisions. The agent needs to reason about what constitutes a "decision" vs an "opinion" vs a "suggestion." It also needs project context to recognize when something said in the meeting changes a prior assumption.
- **Complexity**: Medium

### Agent: contract-guardian
- **Role**: Validates that implemented PHP code preserves the client-facing API contract exactly -- request/response shapes, status codes, headers, data formats.
- **Persona**: A QA engineer obsessed with backward compatibility. You have memorized every field name, every status code, every header convention in the B2B API contract. You find the subtle breaks: a field renamed from `snake_case` to `camelCase`, a money amount returned as a number instead of a string, a missing `206 Partial Content` status.
- **When to use**: After each endpoint is implemented, before merging. Invoke with the endpoint name and the implementation file paths.
- **Inputs**: `current-state/endpoints/<endpoint>.md` (the canonical contract), `current-state/cross-cutting/api-contract-conventions.md`, the implemented PHP controller and mapper code, C# test fixtures (if ported).
- **Outputs**: `implementation/reviews/<endpoint>-contract-review.md` -- containing: field-by-field comparison (expected vs actual), status code coverage, header handling, data format checks (money as strings, date formats), missing edge cases, pass/fail verdict per check.
- **Why not a skill?**: Contract validation requires reading and understanding both the specification (markdown docs with DTOs) and the implementation (PHP code with different naming conventions). It must reason about semantic equivalence, not just string matching. A field called `departure_station_id` in the spec might be `stationId` in PHP -- the agent must determine if the mapping is correct.
- **Complexity**: Medium

### Agent: design-drift-detector
- **Role**: Compares the current implementation against the 17 design decisions (D1-D17) and 14 convergences, flagging any drift.
- **Persona**: An architecture auditor who checks that what was decided is what was built. You are not judgmental about deviations -- sometimes drift is necessary -- but you make it visible so it is a conscious choice, not an accident.
- **When to use**: Periodically during implementation (every 2-3 weeks), or before major milestones. Also useful before stakeholder meetings to report "what we actually built vs what we said we'd build."
- **Inputs**: `design/decision-map.md`, `design/recommendation.md`, the implemented F3 code (B2B module), `implementation/plans/*.md` (if they exist).
- **Outputs**: `implementation/reviews/design-drift-report.md` -- containing: per-decision compliance status (aligned / deviated / not yet implemented), explanation for each deviation, risk assessment of deviations, suggested decision-map updates if a deviation should become the new decision.
- **Why not a skill?**: Requires reading both design documents and source code, then reasoning about whether the code implements the intent of the decision (not just the letter). A decision like "flat 3-layer architecture" requires understanding what the code structure actually looks like, not just checking for a folder named "layers."
- **Complexity**: Medium-High

### Agent: context-updater
- **Role**: Proposes updates to `system-context.md` based on new information sources (meeting records, implementation findings, external communications).
- **Persona**: A technical writer who maintains the single source of truth. You understand that every agent in the system reads `system-context.md`, so accuracy and completeness matter. You never add speculative information -- only verified facts and confirmed decisions.
- **When to use**: After meetings, after significant implementation discoveries, or when open questions are resolved.
- **Inputs**: The new information source (meeting record, implementation finding, email), current `prompts/context/system-context.md`, `design/decision-map.md` (to update open questions).
- **Outputs**: A proposed diff to `prompts/context/system-context.md` written to `prompts/context/system-context-proposed-update.md` -- containing: what to add, what to modify, what to remove, rationale for each change. The human reviews and applies.
- **Why not a skill?**: Updating context requires judgment about what is significant enough to include, what level of detail is appropriate, and what existing content is now outdated. A meeting might produce 20 statements but only 3 are context-worthy. The agent must filter.
- **Complexity**: Low-Medium

---

## Proposed Agent Compositions

### Composition 1: Post-Meeting Pipeline
**Trigger**: A meeting transcript is available.
**Agents**: `transcript-processor` -> `context-updater`
**Flow**:
1. `transcript-processor` reads the transcript and produces a structured meeting record.
2. `context-updater` reads the meeting record and proposes updates to `system-context.md`.
3. Human reviews both outputs, applies context updates, and commits.

**Value**: Reduces a 30-60 minute manual task to a 5-minute review. Ensures context stays current for all agents.

### Composition 2: Endpoint Implementation Cycle
**Trigger**: Starting work on a new endpoint.
**Agents**: `implementation-planner` -> [human implements] -> `contract-guardian`
**Flow**:
1. `implementation-planner` produces the implementation plan for the endpoint.
2. Human (with AI coding assistance) implements the endpoint following the plan.
3. `contract-guardian` validates the implementation against the API contract.
4. Human fixes any contract violations flagged.

**Value**: Bookends the implementation with planning and validation. The planner reduces "staring at the codebase wondering where to start" time. The guardian catches contract breaks before they reach QA.

### Composition 3: Milestone Checkpoint
**Trigger**: Before a stakeholder meeting or at a milestone boundary (every 2-3 weeks).
**Agents**: `design-drift-detector` + `meeting-prep` (parallel)
**Flow**:
1. `design-drift-detector` produces a drift report showing what was built vs what was planned.
2. `meeting-prep` uses the drift report + project state to generate the meeting brief.
3. Human reviews and adjusts before the meeting.

**Value**: Combines technical accountability with stakeholder communication. The drift report keeps the project honest; the meeting prep communicates it effectively.

### Composition 4: Full Design Regeneration (existing, enhanced)
**Trigger**: Major constraint change (e.g., resourcing changes, new meeting outcomes).
**Agents**: `context-updater` -> `/run-design-phase` -> `/run-evaluation-phase`
**Flow**:
1. `context-updater` proposes updates to `system-context.md` based on new information.
2. Human applies updates.
3. `/run-design-phase` regenerates all 6 designs with updated context.
4. `/run-evaluation-phase` re-evaluates.

**Value**: Makes the full regeneration cycle explicit. Ensures context is updated before agents re-read it.

---

## Priority Ranking

| Priority | Agent | Justification |
|----------|-------|---------------|
| **1 (build now)** | `implementation-planner` | Implementation starts this week (Mar 23). The first endpoint after Search (GetItinerary) is the hardest one (booking schema parser). A concrete plan with F3 file paths and service class names saves hours of exploration. Directly supports the Q2 timeline. |
| **2 (build now)** | `contract-guardian` | With no QA resource confirmed yet and a solo developer, contract breaks are the highest-probability defect. This agent acts as an automated first-pass QA. Directly supports the "new client onboarding" Q2 deliverable -- a contract break means the client cannot integrate. |
| **3 (build this week)** | `transcript-processor` | The Mar 25 meeting will produce a transcript. The Mar 18 transcript already exists unprocessed. This agent pays for itself immediately. |
| **4 (build week 2)** | `meeting-prep` | Stakeholder meetings are a recurring obligation. The Mar 25 meeting brief is already being prepared manually. After that, there will be regular syncs. Low complexity, high time savings. |
| **5 (build week 3)** | `context-updater` | Becomes valuable once implementation is producing new findings that affect the shared context. Less urgent than the implementation-support agents. |
| **6 (build when needed)** | `design-drift-detector` | Most valuable at the first milestone checkpoint (around week 4-5). Not urgent in week 1 when there is nothing to drift from yet. |

### Not Proposed (and why)

- **POC Implementation Agent** (from AGENTS.md Phase 4): The Search POC is already complete and merged. This agent's purpose is fulfilled. No need to build it.
- **Implementation Agent** (from AGENTS.md Phase 4): Too broad. The `implementation-planner` + human + `contract-guardian` composition is more practical than a single agent that "implements an endpoint." Actual code generation is better handled by Claude Code's inline coding capabilities than by a structured agent.
- **Test Agent** (from AGENTS.md Phase 4): Partially absorbed by `contract-guardian`. Full test generation is better handled as a coding task than as a document-producing agent. The `implementation-planner` already lists test fixtures to port.
- **A "PHP tutor" agent**: Considered and rejected. Soso has PHP buddy sessions scheduled with a human expert. An agent pretending to know F3 internals would be less reliable than the actual F3 developer. AI coding assistants already provide language help inline.
- **A "scope negotiator" agent**: Considered and rejected. Scope decisions are organizational/political, not technical. An agent cannot negotiate with a Team Lead.
