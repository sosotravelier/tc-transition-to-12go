# Task: Prepare evaluation criteria and analyzer agents for Phase 3

You are working in the `transition-design` repo. This task prepares everything needed to run `/run-evaluation-phase`.

## Context to read first

1. `AGENTS.md` — master project context, agent roles, Phase 3 role definitions
2. `prompts/context/system-context.md` — full system context including all meeting outcomes (Feb 25, Mar 12, Mar 17)
3. `design/v4/evaluation-criteria.md` — **current criteria (OUTDATED)** — read to understand the structure and intent, but DO NOT preserve the content as-is
4. All 6 design proposals in `design/alternatives/*/design.md` — skim these to understand what you're evaluating
5. `meetings/2026-03-17-team-lead-sync/meeting-record.md` — critical constraints that invalidate the current criteria
6. `meetings/2026-03-12-migration-problem-analysis/new-findings.md` — migration complexity findings

## What is wrong with the current evaluation criteria

The criteria at `design/v4/evaluation-criteria.md` were written on 2026-03-09, before the March 17 meeting. They assume:
- **3-4 .NET developers** — actually 1 developer (Soso)
- **Team velocity for a group** — actually solo developer velocity with heavy AI assistance
- **"Team Competency Match"** framed for a team — actually one person's skills matter

The scoring anchors ("What 5 Looks Like", "What 1 Looks Like") and scoring guidelines are calibrated for the wrong team size. If the analyzer agents score against these criteria, the scores will be meaningless.

## What to do

### 1. Rewrite evaluation criteria from scratch

Rewrite `design/v4/evaluation-criteria.md` completely. Use the current file's structure as inspiration (hard constraints, scoring system, criteria table, score calculation, analyzer coverage, scoring guidelines) but rebuild the content from the ground up based on what we now know.

**Current reality the criteria must reflect:**
- Solo developer (Soso) — senior .NET expert, 12 years experience
- Heavy AI-assisted development (Claude Code, multi-agent workflows) — this is a real force multiplier, not a footnote
- Q2 2026 deadline — new clients must onboard on the new system
- Design is NOT throwaway — will live for a significant time during gradual client migration
- F3 refactoring planned (Q2 planning starts) — code inside F3 may face a second migration
- F3 local development is painful — Search POC revealed 16 setup issues
- gRPC module could be scoped out, booking notification could be offloaded
- Team Lead argues for monolith, Soso counter-argues against double migration
- No local persistence — rely on 12go as source of truth

**Guidelines for criteria design:**
- Keep hard constraints (pass/fail) — all 13 endpoints, money format, headers, 206 behavior
- Recalibrate every criterion's anchors for 1 developer, not 3-4
- Reconsider which criteria deserve high/medium/low weight given solo developer + Q2 deadline
- "Implementation Effort" should be calibrated to what one person with AI can do in Q2
- "Team Competency Match" may need renaming — it's not a team anymore, it's one person's skill fit
- Simplicity matters MORE with solo developer — consider elevating weight
- Consider whether any criteria should be added or removed given the new constraints
- Keep the analyzer agent coverage table — each criterion scored by exactly one agent (except C10 Elegance dual-score rule)
- The Red Team still does not score — it produces failure mode analysis
- Preserve the v1-v3 comparison table at the bottom but update it to reflect v5 changes

**Important:** Think critically about the weights. The previous weights were designed for a team. With one developer:
- Can one person afford complexity? (Simplicity becomes more critical)
- Can one person ramp up on a new language? (Competency match becomes even more critical)
- Can one person maintain something they built with AI? (AI-Friendliness includes maintainability now)
- Is search performance still x3? (Yes — it's a system requirement, not team-dependent)

### 2. Update analyzer agent AGENT.md files

After rewriting the criteria, update all 4 analyzer agents in `.claude/agents/` to align with the new criteria:

- `.claude/agents/red-team/AGENT.md` — update if the criteria reference changes affect what the Red Team should look for
- `.claude/agents/execution-realist/AGENT.md` — update the criteria it scores to match the new criteria numbers and names
- `.claude/agents/ai-friendliness/AGENT.md` — update the criteria it scores to match the new criteria numbers and names
- `.claude/agents/technical-merit/AGENT.md` — update the criteria it scores to match the new criteria numbers and names

For each analyzer agent:
- Update any references to criterion numbers (C1, C2, etc.) if they changed
- Update any references to criterion names if they were renamed
- Update the scoring context in the prompt to reflect solo developer reality
- Ensure the "Scoring Guidelines" or equivalent section in each prompt matches the new evaluation criteria
- Do NOT change the agent's persona or fundamental approach — only align its scoring targets with the new rubric

### 3. Update the run-evaluation-phase skill

Review `.claude/skills/run-evaluation-phase/SKILL.md` and update if it references specific criterion numbers or names that changed.

### 4. Verify consistency

After all updates, verify:
- Every criterion in `evaluation-criteria.md` is assigned to exactly one analyzer agent (except C10 dual-score)
- The score calculation formula matches the actual criteria count and weights
- The maximum possible score is correctly computed
- The analyzer coverage table in evaluation-criteria.md matches what the AGENT.md files say they score
- No criterion is orphaned (in the criteria file but not assigned to any agent)
- No agent claims to score a criterion that doesn't exist in the criteria file

## Important constraints

- Do NOT modify any files in `prompts/` — canonical prompt sources
- Do NOT modify any files in `current-state/`, `meetings/`, `questions/`, `client-onboarding-docs/`, or `scripts/`
- Do NOT modify design proposals in `design/alternatives/` — those are Phase 2 outputs
- Do NOT modify `prompts/context/system-context.md` — already up to date
- Do NOT run the actual evaluation agents — this task is prep work only
- Commit all changes when done with a descriptive message

## Summary of files to modify

- `design/v4/evaluation-criteria.md` (rewrite)
- `.claude/agents/red-team/AGENT.md` (update criteria references)
- `.claude/agents/execution-realist/AGENT.md` (update criteria references)
- `.claude/agents/ai-friendliness/AGENT.md` (update criteria references)
- `.claude/agents/technical-merit/AGENT.md` (update criteria references)
- `.claude/skills/run-evaluation-phase/SKILL.md` (update if criteria references changed)
