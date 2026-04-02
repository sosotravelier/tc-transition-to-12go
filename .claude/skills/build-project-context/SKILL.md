---
name: build-project-context
description: Build the project-context.md document from scratch by processing project documents in chronological order, one sub-agent per step
---

# Build Project Context

Construct `project-context.md` by walking through project documents in chronological order. Each step spawns a sub-agent that reads ONLY the current project context + the next document(s), then writes an updated version.

This mimics how the project understanding actually formed — each event adds, corrects, or refines what came before.

<HARD-GATE>
Do NOT write project-context.md to the repo until:
- All 16 steps are complete
- User has reviewed the final document
- Word count is 800-1,500 words
- All 9 sections are populated (no "[Not yet populated]" remains)

Partial builds are not valid project contexts.
</HARD-GATE>

## Anti-Patterns

These will create a broken project context — STOP if you catch yourself doing any:

| Mistake | Why It Breaks Things |
|---------|---------------------|
| Skipping steps (jump from Step 5 to Step 10) | Later steps assume context from earlier ones — gaps compound |
| Waiting until end to fix size (exceeding 2,000 words) | Compression at the end loses nuance; compress incrementally |
| Summarizing instead of extracting | Prose paragraphs instead of bullet points inflate size and lose precision |
| Adding new sections beyond the 9-section template | Breaks the fixed structure that other skills depend on |
| Not waiting for user confirmation between steps | Errors propagate — one bad extraction corrupts all subsequent steps |

## Project Context Template

The project context uses this fixed structure. All sections start empty and get populated as documents are processed.

```markdown
# Project Context

**Last Updated**: YYYY-MM-DD | **Last Verified**: YYYY-MM-DD
**Status**: [phase descriptor]
**Build Step**: [N/total] — [document being processed]

---

## 1. What This Project Is
[Brief description of the project goal and scope]

## 2. Architecture Decision
[The settled architecture choice, rationale, and key technical details]

## 3. What We're Building
[Endpoint table with status, difficulty, notes]

## 4. Decided
[Chronological list of decisions with date, decision, who, one-line rationale]

## 5. Current Constraints
[Hard facts about development environment, resourcing, timeline]

## 6. Open Questions
[ONLY currently open questions with owner and status]

## 7. Key People
[Who owns what in the transition]

## 8. Implementation Sequence
[Current plan, blockers, next steps, early warning signals]

## 9. Reference Index
[Pointers to deep-dive docs — paths + one-line descriptions]
```

## Chronological Reading Sequence

Derived from git history analysis (commit dates, file creation order, document content dates). Each step represents a distinct event that shifted understanding. 16 steps total.

### Phase A: Genesis (Feb 17)

Everything started in a single Cursor session on Feb 17, 2026.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 1 | Feb 17 | `prompt-log/prompt-log.md` | Soso wrote the initial prompt describing the problem and launched 5 waves of sub-agents to document the current state. | Project goal, scope, the 4 repos being replaced, initial constraints, the phased approach decision (document → design → evaluate). Seeds sections 1, 5, 9. |
| 2 | Feb 17 | `current-state/overview.md` | Phase 1 output: system overview with architecture diagrams, endpoint-to-12go mapping table, sequence diagrams. | The 13 endpoints, how they map to 12go API calls, the current architecture picture. Seeds section 3. |

### Phase B: First Design Attempts (Feb 18-24)

Multiple design iterations happened before the first stakeholder meeting. These were all AI-generated explorations.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 3 | Feb 19 | `prompts/context/system-context.md` (initial version — use `git show 805b203:prompts/context/system-context.md`) + `prompts/context/codebase-analysis.md` | After integrating 12go clarifications and client onboarding docs, Soso created the first system context and codebase analysis. These became the shared context for all agents. | System context baseline, what to keep/discard from .NET repos, team composition, infrastructure facts. Updates sections 1, 5. |
| 4 | Feb 20-21 | `design/archive/migration-strategy-2026-02-20/migration-strategy.md` | First standalone design proposal: a migration strategy analysis. Predates the multi-alternative approach. | What was the first architecture proposal? What assumptions did it make? What was the recommended approach? Note for section 2 as "initial thinking." |
| 5 | Feb 23-24 | `design/archive/v1-2026-02-24/recommendation.md` | v1 evaluation round: 5 language-based alternatives (Trimmed .NET, PHP integration, Go, Hybrid BFF, TypeScript) evaluated by 4 concern-based analyzers (architecture-performance, operations-infra, risk-migration, team-velocity). Three evaluation rounds (v1/v2/v3) with different weight profiles. .NET microservice won all three. | The first scored recommendation. What won and why. What was the methodology. Note as "v1 recommendation" — will be superseded. |

### Phase C: First Stakeholder Meeting (Feb 25)

The first time designs were presented to stakeholders. Changed everything.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 6 | Feb 25 | `meetings/2026-02-25-microservice-vs-monolith-architecture-decision/meeting-record.md` | Meeting with Team Lead, RnD, Architect, Oleksandr. Presented monolith vs microservice. Key outcome: POC inside F3 requested, architecture decision deferred. Major new info: F3 breakdown planned (no timeline), "one system" vision, event/data correlation requirement. | Decisions, new constraints, POC approach. This SUPERSEDES the v1 .NET recommendation — architecture is now open. Updates sections 2, 4, 5, 6. |

### Phase D: Search POC & Agent Redesign (Mar 4-15)

After the Feb 25 meeting decided "do a POC in F3", Soso built it. Meanwhile, the v1 language-based agents were redesigned into perspective-based agents.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 7 | Mar 4 | `current-state/search-poc/poc-plan.md` | POC plan created after Feb 25 meeting decided to test Search inside F3. Defines what to implement, success criteria, and the technical approach. | What the POC aimed to prove, how it was scoped, what success looked like. Updates section 8. |
| 8 | Mar 9 | `design/archive/v4-2026-03-09/evaluation-criteria.md` | v4 agent redesign: language axis → perspective axis. New design agents (pragmatic-minimalist, platform-engineer, data-flow-architect, team-first-developer, disposable-architecture, clean-slate-designer). New analyzer agents (red-team, execution-realist, ai-friendliness, technical-merit). AI-Friendliness elevated to first-class criterion. | The methodology shift and why. Note the new agent set. Context for understanding the current designs. |
| 9 | Mar 15 | `current-state/search-poc/local-env-setup-issues.md` | POC built. Code took ~2 days with AI. Local F3 environment was the painful part — 2-day setup ordeal documented here. POC results (request/response pairs) validated. | What the POC proved, what friction was discovered (F3 local dev pain), what worked. This directly feeds the Mar 17 meeting. Updates sections 4 (POC complete), 5 (local dev constraint). |

### Phase E: Migration Deep-Dive & Resourcing Reality (Mar 12-18)

Three meetings in one week reshaped the entire project scope.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 10 | Mar 12 | `meetings/2026-03-12-migration-problem-analysis/new-findings.md` | Soso + Shauly deep-dive on migration problems. Concrete solutions found for API keys, booking IDs, webhooks. New complexity discovered (seat classes, vehicle IDs). No-persistence design confirmed. | Resolved questions, new migration issues, concrete technical solutions. Updates sections 4, 5, 6. |
| 11 | Mar 17 | `meetings/2026-03-17-team-lead-sync/meeting-record.md` | Team Lead sync. CRITICAL: Soso will be sole developer. Q2 deadline. "Not throwaway" — design must be solid. F3 refactoring planned for Q2 (planning, not execution). POC friction discussed. | Solo developer constraint (changes everything), timeline, scope expectations. Major updates to sections 5, 7. |
| 12 | Mar 18 | `meetings/2026-03-18-team-lead-sync/meeting-record.md` | Q2 scope confirmed: new clients only, no backward compatibility. PHP buddy approved. gRPC out of scope. Monitoring ownership split. Cancellation policy simplified. SeatLock lowest priority. | Scope crystallized. Multiple decisions that define what's in/out for Q2. Updates sections 3, 4, 5, 6. |

### Phase F: Current Design (Mar 17 evening — produced after meetings above)

On the same day as the Mar 17 meeting (evening session), the v4 perspective-based agents ran for the first time. The results were synthesized into the current recommendation.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 13 | Mar 17 | `design/decision-map.md` | 6 design agents produced alternatives. Synthesized into a decision map: 14 convergences (all 6 agents agreed), decision tree for language/deployment/layering, 17 decisions with options. | The convergences (what's settled), the decision tree, open vs resolved decisions. Major update to section 2. |
| 14 | Mar 17 | `design/recommendation.md` | Phase 3 evaluation: Team-First Developer (PHP/Symfony inside F3) at 84.5/130. Clean Slate (Go) scored highest at 90 but has fatal flaws. Required overlays: PE observability, DA events, DI adapter boundary. Red Team risks identified. | The architecture recommendation, why it won, risk mitigations, execution plan. Crystallizes section 2. Updates section 8. |

### Phase G: CI/CD Knowledge Transfer (Mar 23)

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 15 | Mar 23 | `meetings/2026-03-23-ci-flow-php-patterns/meeting-record.md` | Knowledge transfer with Sana. CI/CD pipeline, local env stability, separate DB schema, background jobs, feature flags. | Technical implementation details that affect how the work gets done. Updates sections 4, 5. |

### Phase H: Q2 Implementation Planning (Mar 25 + Mar 30)

The most recent and most authoritative source. Two-part meeting with full stakeholder group.

| Step | Date | Document(s) | What Happened | What to Extract |
|------|------|-------------|---------------|-----------------|
| 16 | Mar 25/30 | `meetings/2026-03-25-q2-implementation-plan/meeting-record.md` + `design/implementation/README.md` | Q2 implementation plan presented to Eliran, Eyal, Avikhai, Shauly. 9 decisions made. Static data ownership questioned. Recheck moved to search team. Notifications deferred. Booking flow approach confirmed. client_id kept in URL. 12go booking IDs for new clients. Migration plan added as Q2 deliverable. Implementation tracking established with endpoint priorities. | This is the MOST AUTHORITATIVE source. It can OVERRIDE anything from earlier steps. Updates all sections including section 3 (endpoint status) and section 8 (implementation sequence). |

## Execution Process

### Step 0: Create Empty Project Context

Write `project-context.md` to the repo root using the template above, with all sections containing `[Not yet populated]`.

### For Each Step (1-16):

1. **Spawn a sub-agent** with this prompt:

```
You are updating a project context document. You have two inputs:

INPUT 1 — Current project context:
[contents of project-context.md]

INPUT 2 — New document to process (Step N of 16):
[contents of the step's document]

CONTEXT: This document was created on [DATE] as part of [WHAT HAPPENED — from the table above].

TASK: Update the project context by incorporating information from the new document.

RULES:
- Only ADD or MODIFY information. Never remove something unless the new document explicitly contradicts or supersedes it.
- If the new document supersedes something from an earlier step, UPDATE the relevant section and note what changed (e.g., "Updated: was .NET microservice, now PHP/F3 monolith per Feb 25 meeting").
- Keep each section compact: 1 line per decision, 1 row per endpoint, no prose paragraphs longer than 3 lines.
- Decisions need: date, what was decided, who decided (or "AI analysis" if from design agents).
- Open questions: only include if CURRENTLY unresolved as of this document's date. If a later document might resolve it, keep it for now.
- Update the "Build Step" line in the header to "Step N/16 — [document name]".
- Do NOT add content to sections that the document doesn't inform. Leave them as-is.
- The Reference Index (section 9) should accumulate a row for each step's document.
- Target total size: under 1,500 words. If approaching this before step 10, compress earlier entries.

OUTPUT: Write the complete updated project-context.md to the repo root.
```

2. **After the sub-agent finishes**, display a brief summary to the user:
   - "Step N/16: Processed [document name] (DATE)"
   - Sections modified
   - Key additions or changes
   - Any superseded information

3. **Wait for user confirmation** before proceeding to the next step. The user may want to correct something before it propagates to subsequent steps.

### Step 17: Final Review

After all 16 steps:
1. Remove the "Build Step" line from the header
2. Set `Last Updated` and `Last Verified` to today's date
3. Set `Status` to the current project phase
4. Run `wc -w project-context.md` — target is 800-1,500 words
5. Present the final document to the user for review

### Step 18: Verification Checklist

Before committing project-context.md, verify ALL of these:

- [ ] `wc -w project-context.md` — confirm 800-1,500 words
- [ ] All 9 sections have content (no "[Not yet populated]" remains)
- [ ] No section exceeds 300 words
- [ ] Each decision in section 4 has date and attribution
- [ ] Open questions in section 6 have owners
- [ ] Endpoint table in section 3 has status for all endpoints
- [ ] Reference Index in section 9 has one row per step processed
- [ ] "Build Step" line has been removed from header
- [ ] `Last Updated` and `Last Verified` are set to today's date

If any checkbox fails, fix before committing.

## Special Handling

### Step 3 (Initial system-context.md)
The current `prompts/context/system-context.md` has been updated many times. For step 3, use the initial Feb 19 version:
```bash
git show 805b203:prompts/context/system-context.md
```
Later updates to system-context.md are captured by the meeting records in subsequent steps.

### Step 5 (v1 recommendation)
Read `design/archive/v1-2026-02-24/recommendation.md` — this is the ARCHIVED version. The current `design/recommendation.md` is from Mar 17 (step 14).

### Steps 13-14 (decision-map + recommendation)
These are the CURRENT files at `design/decision-map.md` and `design/recommendation.md`. They represent the latest design synthesis (Mar 17).

### Step 16 (Mar 25 meeting + implementation)
This is the most authoritative document. If it contradicts anything from earlier steps, the meeting record wins. Also reads `design/implementation/README.md` for current endpoint status — both files in one step since they represent the current state.

## Size Guardrails

- After each step, check word count with `wc -w project-context.md`
- If exceeding 1,200 words before step 10, instruct the next sub-agent to compress
- Sections 4 (Decided) and 6 (Open Questions) grow the most — compress by merging related decisions
- Section 9 (Reference Index) should be a compact table

## Resuming

If the process is interrupted, read `project-context.md` and check the "Build Step" line to see where it stopped. Resume from the next step.

## Post-Build: Rename system-context.md

After `project-context.md` is complete and verified, `prompts/context/system-context.md` should be understood as the historical uncompressed record. It is no longer the primary context injection — `project-context.md` replaces it for that role. Consider renaming to `prompts/context/system-context-history.md` or simply leaving it in place with a note at the top.
