# CLAUDE.md

**If `project-context.md` exists**, read it first — it is the canonical project context. If it doesn't exist yet, run `/build-project-context` to construct it from project documents.

For agent roles, source repository paths, and document conventions, see [AGENTS.md](AGENTS.md).

---

## Context Architecture (Three-Tier)

| Tier | What | When Loaded |
|------|------|-------------|
| **Tier 1 (Hot)** | This file + `project-context.md` | Every session |
| **Tier 2 (Domain)** | Agent prompts in `.claude/agents/`, endpoint docs in `current-state/endpoints/`, `prompts/context/codebase-analysis.md` | Per task |
| **Tier 3 (Cold)** | `prompts/context/system-context.md` (historical), `design/archive/`, `meetings/`, full `current-state/` | On demand |

If `project-context.md` has `Last Verified` older than 7 days, flag it: "Project context may be stale — last verified on [date]."

## Implementation Discipline

- A task must fit in one context window. If it cannot, decompose it.
- RED-GREEN-REFACTOR: write a failing test, make it pass, then refactor. Use `superpowers:test-driven-development` skill.
- At 70% context usage, summarize progress and start a fresh session.
- Before coding any endpoint: read `project-context.md` → endpoint doc → `codebase-analysis.md`.
- Before claiming work is done, run verification. Use `superpowers:verification-before-completion` skill.

## For Implementation Work

1. Read `project-context.md` (always)
2. Read the specific endpoint doc in `current-state/endpoints/` for your task
3. Read `prompts/context/codebase-analysis.md` if porting .NET logic

## Project Context Maintenance

- **After processing a meeting**: `/update-project-context meeting <date>`
- **After completing an endpoint**: `/update-project-context milestone <endpoint>`
- **Weekly**: `/update-project-context review`

## Slash Commands

| Command | Purpose |
|---------|---------|
| **`/jira`** | Jira operations — sprint view, get/create/edit tickets, read/add comments, transitions. Use this for ANY Jira interaction. |
| **`/build-project-context`** | Build project-context.md from scratch by processing documents chronologically (16 steps) |
| **`/update-project-context`** | Update project-context.md with new decisions, status changes, or weekly review |
| **`/process-transcript`** | Extract decisions and action items from a meeting transcript |
| **`/run-design-phase`** | Launch all 6 design agents in parallel |
| **`/run-evaluation-phase`** | Launch all 4 analyzer agents in parallel |
| **`/prep-meeting`** | Scaffold a meeting folder with templates |
| **`/implement-endpoint`** | End-to-end endpoint implementation: context → brainstorm → TDD → update project state |

## Project Structure

- **Custom agents** in `.claude/agents/` — each has a single `AGENT.md` with the full prompt
  - 6 design agents: `pragmatic-minimalist`, `platform-engineer`, `data-flow-architect`, `team-first-developer`, `disposable-architecture`, `clean-slate-designer`
  - 4 analyzer agents: `red-team`, `execution-realist`, `ai-friendliness`, `technical-merit`
  - 2 meta agents: `agent-scout`, `skill-scout`
- **Shared context** in `prompts/context/` — `codebase-analysis.md` for implementation details
- **Path-specific rules** in `.claude/rules/` enforce document templates
- **Research** in `research/` — agent frameworks survey, context engineering patterns
- **Superpowers skills** in `skills/` — cherry-picked from [Superpowers](https://github.com/obra/superpowers) (TDD, brainstorming, debugging, verification, parallel agents, git worktrees)

## Running Multi-Agent Workflows

- Launch multiple agents in a **single message** to run them in parallel
- Each agent reads its prompt from `.claude/agents/<name>/AGENT.md`
- Each agent writes to its own output path — no file conflicts
- Use `run_in_background: true` for long-running agents

## Sidecar Usage

When working in other repos (F3, etc.), load `project-context.md` via absolute path for B2B transition context:

```
Read /Users/sosotughushi/RiderProjects/transition-design/project-context.md
```
