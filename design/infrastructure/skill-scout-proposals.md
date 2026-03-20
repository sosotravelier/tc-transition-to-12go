# Skill Scout Proposals

## Current Skills Inventory

| Skill | What It Does | Complexity |
|-------|-------------|------------|
| `/run-design-phase` | Archives previous iteration, runs pre-flight checks, launches all 6 design agents in parallel, synthesizes decision map, runs quality checks. The most sophisticated skill -- full Phase 2 orchestration. | High |
| `/run-evaluation-phase` | Verifies all 6 designs exist, launches all 4 analyzer agents in parallel, synthesizes comparison matrix and recommendation with arithmetic verification. Full Phase 3 orchestration. | High |
| `/archive-design` | Moves the current working set (alternatives, analysis, top-level design files) into `design/archive/v{N}/` with sequential version numbering. Standalone utility used by other skills. | Low |
| `/synthesize-decision-map` | Reads all 6 designs and 4 analyses, produces `design/decision-map.md` with convergences, decision trees, and open questions. Called as a sub-step of `/run-design-phase`. | Medium |

**Observations:**
- The pipeline is well-automated for the design-then-evaluate loop (Phase 2 and 3).
- Nothing exists for Phase 4 (implementation), meeting preparation, or cross-phase tasks like updating system context or managing the prompt log.
- The `scripts/` directory contains one Node.js utility (`export-user-messages.mjs`) for exporting Cursor chat history -- a one-off migration tool, not a reusable skill.

## Identified Gaps

### 1. Meeting Preparation Is Manual and Repetitive
The `meetings/` directory contains 7 meeting folders, each with a mix of transcripts, notes, briefs, and records. There is no standard skill to scaffold a new meeting folder, and no automation to extract decisions from transcripts into the decision log in `AGENTS.md`. Currently the user must: create the folder, name it correctly (YYYY-MM-DD-slug), create the brief from scratch, and after the meeting manually update `AGENTS.md` Decision Log and `prompts/context/system-context.md`.

### 2. No System Context Update Workflow
`prompts/context/system-context.md` is a critical input to every design and analyzer agent. It must be updated after meetings, after decisions, and after new findings. Currently this is a manual edit with no checklist or verification that downstream documents are stale.

### 3. No Prompt Log Maintenance Skill
`AGENTS.md` specifies a Prompt Log Convention ("When adding new prompts, sessions, or significant contextual inputs, append new entries chronologically to `prompt-log.md`"). There is no skill to help maintain this. It is easy to forget.

### 4. No Quality Check for Stale Documents
After running `/run-design-phase`, documents reference `system-context.md`, meeting records, and evaluation criteria. If any of these change, the designs are stale but nothing flags this. The archive versions have no way to record what context they were generated from.

### 5. No Diff or Changelog Between Design Iterations
There are 8+ archived iterations. When presenting to stakeholders, the user needs to explain what changed between iterations (e.g., v7 to v8). Currently this requires manually diffing archived files.

### 6. No Meeting Transcript Processing
Meeting transcripts (`.txt` files) exist in multiple meeting folders. Extracting action items, decisions, and key quotes from these transcripts is a recurring manual task.

### 7. No Single-Agent Re-Run Capability
`/run-design-phase` regenerates all 6 designs. If only one agent's design needs updating (e.g., after new context), there is no targeted skill -- you must either run the full pipeline or manually invoke the agent with the right instructions.

### 8. No Implementation Phase Skills
Phase 4 (POC and Implementation) has agent roles defined in `AGENTS.md` but zero skills. The Search POC is already complete. As Q2 implementation begins, there will be a need for endpoint-by-endpoint implementation orchestration.

## Proposed New Skills

### Skill: /prep-meeting
- **Trigger**: When preparing for an upcoming meeting (happens roughly weekly based on the meeting cadence observed).
- **What it does**:
  1. Creates the meeting directory: `meetings/YYYY-MM-DD-slug/`
  2. Scaffolds a `meeting-brief.md` from a template (title, date, duration, presenter, audience, purpose, agenda sections)
  3. Reads the latest `design/recommendation.md`, `design/decision-map.md`, and the most recent meeting record to pre-populate the "Context" section with current project status
  4. Creates an empty `transcript.txt` placeholder
  5. Lists open questions from `design/decision-map.md` that could be agenda items
- **Why it matters**: Eliminates 15-20 minutes of copy-paste and context-gathering before each meeting. Ensures meeting briefs reference the latest project state rather than stale information.
- **Complexity**: Medium

### Skill: /process-transcript
- **Trigger**: After a meeting, when a transcript has been placed in the meeting folder.
- **What it does**:
  1. Reads the transcript file from the specified meeting folder
  2. Extracts: decisions made, action items with owners, key quotes, open questions raised
  3. Writes a structured `meeting-record.md` in the same folder
  4. Drafts updates for `AGENTS.md` Decision Log (new rows to append)
  5. Drafts updates for `prompts/context/system-context.md` (new meeting outcomes section)
  6. Presents the drafts for user approval before writing
- **Why it matters**: The transcript-to-decisions pipeline is the most time-consuming post-meeting task. It currently requires reading the entire transcript, cross-referencing with existing documents, and updating multiple files. Automating this prevents decisions from being lost between meetings.
- **Complexity**: Medium

### Skill: /update-system-context
- **Trigger**: After a meeting, after a design decision, or when the user realizes system context is stale.
- **What it does**:
  1. Reads the current `prompts/context/system-context.md`
  2. Reads the latest meeting record and any recent decision log entries
  3. Identifies what is new since the last `last_updated` date
  4. Proposes specific additions/changes (showing a diff preview)
  5. After approval, updates the file and bumps the date
  6. Warns if active design documents were generated before this update (staleness flag)
- **Why it matters**: System context is the single most important input to all agents. Stale context produces stale designs. This skill makes updates deliberate and traceable.
- **Complexity**: Low

### Skill: /run-single-agent
- **Trigger**: When one design or analyzer agent needs to be re-run without regenerating everything.
- **What it does**:
  1. Takes an agent name as argument (e.g., `/run-single-agent pragmatic-minimalist`)
  2. Validates the agent exists in `.claude/agents/<name>/AGENT.md`
  3. Backs up the existing output file (if any) with a timestamp suffix
  4. Launches the single agent with the same instructions used by the phase skills
  5. Runs the quality checks relevant to that agent's output
- **Why it matters**: After updating system context or getting new meeting outcomes, often only one or two designs need refreshing. Running the full Phase 2 pipeline takes significant time and burns tokens unnecessarily. This provides surgical precision.
- **Complexity**: Low

### Skill: /diff-iterations
- **Trigger**: Before stakeholder meetings, when preparing changelogs, or when the user wants to understand what changed.
- **What it does**:
  1. Takes two version numbers as arguments (e.g., `/diff-iterations v7 v8`)
  2. For each design agent, compares the two archived versions and summarizes: what changed in the architecture, language choice, key trade-offs
  3. For each analyzer, compares scores and highlights shifts
  4. Compares the recommendation files
  5. Outputs a structured changelog to stdout (not a file, since it is ephemeral analysis)
- **Why it matters**: With 8+ archived iterations, understanding the evolution of the design is critical for stakeholder communication and for the user's own decision-making. Manual diffing of 10+ markdown files is tedious.
- **Complexity**: Medium

### Skill: /run-implementation-phase
- **Trigger**: When starting implementation of a specific endpoint in F3 (Phase 4 work beginning Q2).
- **What it does**:
  1. Takes an endpoint name as argument (e.g., `/run-implementation-phase search`)
  2. Reads the endpoint doc from `current-state/endpoints/<endpoint>.md`
  3. Reads the final recommendation and relevant design doc
  4. Reads `runbooks/run-f3-locally.md` for local dev setup
  5. Launches the POC Implementation Agent or Implementation Agent (as appropriate)
  6. Creates an implementation tracking file at `design/implementation/<endpoint>/status.md`
- **Why it matters**: Phase 4 is the next major phase. Having a skill ready when Q2 implementation begins prevents the scramble of figuring out the workflow from scratch each time. Each endpoint migration follows the same pattern: read the contract, read the design, implement in F3, test.
- **Complexity**: High

### Skill: /check-staleness
- **Trigger**: Before running a design or evaluation phase, or on demand.
- **What it does**:
  1. Reads `last_updated` frontmatter from all active design documents
  2. Reads `last_updated` from system context and evaluation criteria
  3. Compares dates: flags any design doc that was generated before the latest context update
  4. Checks if meeting records exist that post-date the current designs
  5. Reports which documents are potentially stale and which agents should be re-run
- **Why it matters**: Prevents running evaluation on stale designs, or presenting outdated recommendations. The project has had 8+ iterations precisely because context keeps evolving -- catching staleness early saves a full regeneration cycle.
- **Complexity**: Low

## Priority Ranking

| Priority | Skill | Rationale |
|----------|-------|-----------|
| 1 | `/process-transcript` | Highest time savings per use. Meeting-to-document pipeline is the bottleneck that delays all downstream work. Every meeting generates 30-60 min of manual processing. |
| 2 | `/run-single-agent` | Low complexity, high utility. Prevents wasteful full-pipeline runs when only one agent needs updating. Directly reduces iteration cost. |
| 3 | `/update-system-context` | Low complexity, high correctness impact. Stale system context is the root cause of needing to re-run entire phases. Making updates deliberate prevents cascading staleness. |
| 4 | `/prep-meeting` | Medium complexity, consistent time savings. Meetings happen weekly. The scaffolding and context-gathering are repetitive. |
| 5 | `/check-staleness` | Low complexity, preventive value. Best built alongside `/update-system-context` since they share the same date-comparison logic. |
| 6 | `/diff-iterations` | Medium complexity, episodic need. Most valuable before stakeholder meetings. Not needed every day, but very valuable when needed. |
| 7 | `/run-implementation-phase` | High complexity, but not needed until Q2 implementation begins in earnest. Should be designed now but built when the first non-POC endpoint is ready for implementation. |
