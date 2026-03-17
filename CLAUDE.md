# CLAUDE.md

This project is configured in [AGENTS.md](AGENTS.md). **Read it first** — it contains the project context, source repository paths, agent roles, document conventions, and decision log.

---

## Quick Start

Run the full design and evaluation pipeline using slash commands:

- **`/run-design-phase`** — Launch all 6 design agents in parallel, archive previous outputs, synthesize decision map
- **`/run-evaluation-phase`** — Launch all 4 analyzer agents in parallel, produce comparison matrix and recommendation

These skills handle archiving, pre-flight checks, agent dispatch, and quality verification automatically.

## Project Structure

- **Custom agents** are in `.claude/agents/` — each corresponds to a role defined in `AGENTS.md`
  - 6 design agents: `pragmatic-minimalist`, `platform-engineer`, `data-flow-architect`, `team-first-developer`, `disposable-architecture`, `clean-slate-designer`
  - 4 analyzer agents: `red-team`, `execution-realist`, `ai-friendliness`, `technical-merit`
- **Path-specific rules** in `.claude/rules/` enforce document templates (frontmatter, required sections, diagram standards)
- **Canonical prompts** remain in `prompts/design-agents/` and `prompts/analyzer-agents/` as reference — the AGENT.md files contain the full prompt content

## Running Multi-Agent Workflows

Agent roles in `AGENTS.md` map directly to Claude Code's **Agent tool**. To run a phase:

- Launch multiple agents in a **single message** to run them in parallel (no hard cap)
- Each agent reads its full prompt from `.claude/agents/<name>/AGENT.md`
- Each agent writes to its own output path — no file conflicts
- Use `run_in_background: true` for long-running agents so they don't block

**Phase 2 (Design):**
> "Run all 6 design agents in parallel. Each reads its prompt from `.claude/agents/<name>/AGENT.md` and writes to `design/alternatives/<name>/design.md`."

**Phase 3 (Evaluation):**
> "Run all 4 analyzer agents in parallel. Each reads its prompt from `.claude/agents/<name>/AGENT.md` and the 6 design docs, then writes to `design/v4/analysis/`."

All 6 design agents or all 4 analyzer agents can run simultaneously — Claude Code has no fixed parallel limit.
