# Task: Prepare transition-design repo for Claude Code Phase 2 regeneration

You are working in the `transition-design` repo. Read these files first to understand the project:

1. `AGENTS.md` — master project context, agent roles, source repos, decision log
2. `CLAUDE.md` — current Claude Code instructions (minimal, needs updating)
3. `runbooks/regenerate-phase2.md` — existing runbook for Phase 2 execution
4. `meetings/2026-03-17-claude-code-concepts/claude-code-knowledge-base.md` — reference doc explaining Claude Code concepts and the conversion plan

## What to do

### 1. Create custom subagents from existing prompts

For each of the 6 design agent prompts in `prompts/design-agents/`, create a corresponding `.claude/agents/<name>/AGENT.md` file. Each AGENT.md should:

- Have YAML frontmatter with: name, description, tools (Read, Grep, Glob, Write), model (opus)
- Contain the full prompt content from the original file (copy it, don't reference it)
- Keep the original prompts in place — they serve as the canonical reference

Design agents to convert:
- `prompts/design-agents/pragmatic-minimalist.md` → `.claude/agents/pragmatic-minimalist/AGENT.md`
- `prompts/design-agents/platform-engineer.md` → `.claude/agents/platform-engineer/AGENT.md`
- `prompts/design-agents/data-flow-architect.md` → `.claude/agents/data-flow-architect/AGENT.md`
- `prompts/design-agents/team-first-developer.md` → `.claude/agents/team-first-developer/AGENT.md`
- `prompts/design-agents/disposable-architecture.md` → `.claude/agents/disposable-architecture/AGENT.md`
- `prompts/design-agents/clean-slate-designer.md` → `.claude/agents/clean-slate-designer/AGENT.md`

Do the same for the 4 analyzer agents in `prompts/analyzer-agents/`:
- `red-team` → `.claude/agents/red-team/AGENT.md`
- `execution-realist` → `.claude/agents/execution-realist/AGENT.md`
- `ai-friendliness` → `.claude/agents/ai-friendliness/AGENT.md`
- `technical-merit` → `.claude/agents/technical-merit/AGENT.md`

### 2. Create orchestration skills (slash commands)

Create `.claude/skills/run-design-phase/SKILL.md`:
- name: run-design-phase
- description: Run all 6 Phase 2 design agents in parallel to generate architecture proposals
- disable-model-invocation: true
- Instructions should tell Claude to:
  1. Run the archive step from `runbooks/regenerate-phase2.md` Step 2 (archive previous designs, create fresh output dirs)
  2. Launch all 6 design agents in parallel using the Agent tool with `run_in_background: true`
  3. After all complete, read all 6 outputs and update `design/decision-map.md` with convergences/divergences
  4. Run quality checks from the runbook

Create `.claude/skills/run-evaluation-phase/SKILL.md`:
- name: run-evaluation-phase
- description: Run all 4 Phase 3 analyzer agents in parallel to evaluate design proposals
- disable-model-invocation: true
- Instructions should tell Claude to:
  1. Launch all 4 analyzer agents in parallel
  2. After all complete, synthesize into `design/v4/comparison-matrix.md` and `design/v4/recommendation.md`
  3. Verify arithmetic on weighted scores
  4. Run quality checks from the runbook

### 3. Create path-specific rules

Create `.claude/rules/design-docs.md` with a `paths` frontmatter scoped to `design/**/*.md`. Enforce:
- YAML frontmatter with `status`, `last_updated`, and `agent` fields required
- `## Security` section required (Key Finding #10 from AGENTS.md)
- Mermaid diagrams must use `sequenceDiagram` or `flowchart TD`
- Cross-references must use relative links

### 4. Update CLAUDE.md

Update the root `CLAUDE.md` to reference the new skills and agent structure. Keep the reference to AGENTS.md. Add:
- Quick Start section listing the available slash commands (`/run-design-phase`, `/run-evaluation-phase`)
- Note that custom agents are in `.claude/agents/` and correspond to roles in AGENTS.md
- Note that path-specific rules in `.claude/rules/` enforce document templates
- Remove or update any Cursor-specific notes (like the "Cursor supports up to 4" note) since we're using Claude Code now

### 5. Update the runbook

Update `runbooks/regenerate-phase2.md`:
- Replace manual agent dispatch instructions (Step 3 waves) with references to `/run-design-phase` and `/run-evaluation-phase` skills
- Remove the Cursor 4-agent limit workaround (Wave 1a/1b split) — Claude Code runs all 6 in parallel
- Keep the pre-flight check, archive step, quality checks, and partial re-run guide

### 6. Pre-flight check

After all files are created, run the pre-flight check from the runbook to verify all context files exist. Report any missing files.

## Important constraints

- Do NOT modify any files in `prompts/` — those are the canonical prompt sources
- Do NOT modify any files in `current-state/` — those are Phase 1 outputs
- Do NOT modify any files in `design/` — those are Phase 2/3 outputs
- Do NOT modify any files in `meetings/` — those are historical records
- Do NOT modify any files in `questions/` — those are compiled from Phase 1
- Do NOT modify any files in `client-onboarding-docs/` or `scripts/`
- Do NOT update `prompts/context/system-context.md` — context updates are a separate task
- Do NOT run the actual Phase 2 agents — this task is prep work only
- Commit all changes when done with a descriptive message

## Summary of files to create or modify

**Create:**
- `.claude/agents/pragmatic-minimalist/AGENT.md`
- `.claude/agents/platform-engineer/AGENT.md`
- `.claude/agents/data-flow-architect/AGENT.md`
- `.claude/agents/team-first-developer/AGENT.md`
- `.claude/agents/disposable-architecture/AGENT.md`
- `.claude/agents/clean-slate-designer/AGENT.md`
- `.claude/agents/red-team/AGENT.md`
- `.claude/agents/execution-realist/AGENT.md`
- `.claude/agents/ai-friendliness/AGENT.md`
- `.claude/agents/technical-merit/AGENT.md`
- `.claude/skills/run-design-phase/SKILL.md`
- `.claude/skills/run-evaluation-phase/SKILL.md`
- `.claude/rules/design-docs.md`

**Modify:**
- `CLAUDE.md`
- `runbooks/regenerate-phase2.md`
