# Claude Code Knowledge Base for Multi-Agent Workflows

**Created**: 2026-03-17
**Purpose**: Concepts, terminology, and recommendations for converting the transition-design repo to a Claude Code-native workflow.

---

## Part 1: Key Claude Code Concepts

### 1. Custom Slash Commands / Skills

**What**: Reusable prompt-based extensions stored as Markdown files. They become `/slash-commands` that you or Claude can invoke.

**Where they live**:
- Personal: `~/.claude/skills/<skill-name>/SKILL.md`
- Project: `.claude/skills/<skill-name>/SKILL.md`

**File format**:
```yaml
---
name: my-skill
description: When to use this skill (Claude reads this to decide auto-invocation)
---

Prompt instructions here...
```

**Key config fields**:
| Field | Purpose |
|-------|---------|
| `disable-model-invocation` | `true` = manual-only (e.g., `/deploy`) |
| `user-invocable` | `false` = Claude-only, hidden from menu |
| `allowed-tools` | Tools Claude can use without permission |
| `context: fork` | Run in isolated subagent context |
| `agent` | Subagent type to use (`Explore`, `Plan`, etc.) |

**Dynamic context injection** — skills can embed shell output:
```yaml
---
name: pr-summary
---
PR diff: !`gh pr diff`
```

**Docs**: https://code.claude.com/docs/en/skills.md

---

### 2. Subagents (Agent Tool)

**What**: Specialized workers Claude spawns for focused tasks. Each gets its own context window and can run in parallel.

**Built-in subagent types**:
| Type | Model | Tools | Use Case |
|------|-------|-------|----------|
| `Explore` | Haiku (fast) | Read, Grep, Glob | Codebase search/exploration |
| `Plan` | Inherits | Read-only | Research for planning |
| General-purpose | Inherits | All | Complex multi-step tasks |

**Custom subagents** — `.claude/agents/<name>/AGENT.md`:
```yaml
---
name: code-reviewer
description: Expert code review specialist
tools: Read, Grep, Glob, Bash
model: sonnet
---
You are a senior code reviewer...
```

**Key features**:
- `isolation: worktree` — runs in isolated git worktree (no file conflicts)
- `run_in_background: true` — non-blocking execution
- `maxTurns` — limit agent's reasoning turns
- No parallel limit in Claude Code (Cursor caps at 4)

**Docs**: https://code.claude.com/docs/en/sub-agents.md

---

### 3. Agent Teams (Experimental — the "multi-agent" concept you're looking for)

**What**: Multiple Claude instances working in parallel with **direct inter-agent communication**, not just reporting back to a parent. This is fundamentally different from subagents.

**Enable**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

| Feature | Subagents | Agent Teams |
|---------|-----------|-------------|
| Context | Shares parent's context | Own independent context |
| Communication | Reports results to parent | Direct messaging between teammates |
| Coordination | Parent manages work | Shared task list, self-coordination |
| Best for | Focused read-only tasks | Parallel design, reviews, competing hypotheses |

**How it works**:
- **Lead**: Main session coordinates
- **Teammates**: Independent Claude instances
- **Shared task list**: Work items with dependencies
- **Mailbox**: Inter-agent messaging

**Docs**: https://code.claude.com/docs/en/agent-teams.md

---

### 4. Hooks

**What**: User-defined shell commands that execute at specific lifecycle points. Deterministic — not AI-decided.

**Key hook events**:
| Event | When | Example Use |
|-------|------|-------------|
| `PreToolUse` | Before a tool runs | Block dangerous commands |
| `PostToolUse` | After tool succeeds | Auto-format edited files |
| `Stop` | Claude finishes responding | Verify all tasks complete |
| `SessionStart` | Session begins | Inject context |

**Three hook types**:
1. **Command** — shell script (exit 0 = proceed, exit 2 = block)
2. **Prompt** — LLM judgment check
3. **Agent** — full agent verification

**Config locations**: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`

**Docs**: https://code.claude.com/docs/en/hooks.md

---

### 5. CLAUDE.md & Rules

**What**: Persistent instructions loaded at session start. The "system prompt" for your project.

**Locations (by precedence)**:
| Location | Scope |
|----------|-------|
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project (git-shared) |
| `~/.claude/CLAUDE.md` | All your projects |
| Managed (org-level) | IT-deployed |

**Path-specific rules** — `.claude/rules/<name>.md`:
```yaml
---
paths:
  - "prompts/**/*.md"
---
When writing agent prompts, always include a ## Persona section...
```

**Docs**: https://code.claude.com/docs/en/memory.md

---

### 6. MCP (Model Context Protocol)

**What**: Open standard for connecting Claude to external tools and APIs. You already have Jira, Notion, and Confluence MCP servers configured.

**Install**:
```bash
claude mcp add --transport http notion https://mcp.notion.com/mcp
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
```

**Scopes**: `local` (project), `project` (shared via `.mcp.json`), `user` (all projects)

**Docs**: https://code.claude.com/docs/en/mcp.md

---

### 7. Claude Agent SDK

**What**: The programmatic runtime that powers Claude Code, exposed as a Python/TypeScript library. Use it to build custom agent orchestrators outside of Claude Code.

**When to use**: When you need repeatable, code-driven agent pipelines (CI/CD, batch processing, custom UIs). For interactive design work, Claude Code is the right tool.

**Docs**: https://platform.claude.com/docs/en/agent-sdk/overview

---

### 8. The "REPL Loop" / Iterative Patterns

There's no officially documented "RALPH loop" — you may be thinking of the **REPL-style iterative pattern** or the general agentic loop concept. The recommended patterns are:

- **Explore → Plan → Implement**: Use `/plan` mode first, then execute
- **Checkpoint & Rewind**: `/checkpoint`, `/rewind` for safe experimentation
- **Batch mode**: `/batch migrate src/` for large-scale parallel changes across worktrees

---

## Part 2: How Your Repo Maps to Claude Code

### Current State (Cursor-oriented)

Your repo has a well-designed multi-agent workflow defined in `AGENTS.md` with prompts in `prompts/`. Currently:
- Agents are **plain markdown prompts** that must be manually orchestrated
- The orchestrator (you or Cursor) reads AGENTS.md, spawns subagents, passes prompts
- No formal skill definitions, hooks, or agent configs exist

### What You Already Have That Maps Directly

| Your Current Asset | Claude Code Equivalent |
|-------------------|----------------------|
| `prompts/design-agents/*.md` | Custom subagents (`.claude/agents/`) |
| `prompts/analyzer-agents/*.md` | Custom subagents (`.claude/agents/`) |
| `AGENTS.md` orchestration instructions | CLAUDE.md + skills for phase execution |
| `prompts/context/*.md` | Shared context (referenced by agents) |
| Manual "run all 5 design agents" | Skill: `/run-design-phase` |
| Manual "run all 4 analyzers" | Skill: `/run-evaluation-phase` |

---

## Part 3: Recommended Conversion

### A. Convert Agent Prompts → Custom Subagents

Move each agent prompt to `.claude/agents/<name>/AGENT.md` with proper frontmatter.

**Example** — `.claude/agents/pragmatic-minimalist/AGENT.md`:
```yaml
---
name: pragmatic-minimalist
description: Legacy migration consultant - evaluates strangler fig vs rewrite. Use for Phase 2 design generation.
tools: Read, Grep, Glob, Write
model: opus
maxTurns: 50
---

# Design Agent: Pragmatic Minimalist ("Migration Survivor")

## Persona
You are a legacy migration consultant with 15 years of experience...

## Context Files to Read
[same content as your current prompt]

## Task
[same content]

## Output
Write your design to `design/alternatives/pragmatic-minimalist/design.md`
```

**Do this for all 10 agents**:
- `pragmatic-minimalist`
- `platform-engineer`
- `data-flow-architect`
- `team-first-developer`
- `disposable-architecture`
- `clean-slate-designer`
- `red-team`
- `execution-realist`
- `ai-friendliness`
- `technical-merit`

### B. Create Phase Orchestration Skills

These are the `/slash-commands` that replace manual orchestration.

**`.claude/skills/run-design-phase/SKILL.md`**:
```yaml
---
name: run-design-phase
description: Run all Phase 2 design agents in parallel to generate architecture proposals
disable-model-invocation: true
---

# Phase 2: Design Generation

Run all 6 design agents in parallel. Each agent:
1. Reads its context files (listed in its own prompt)
2. Reads shared context from `prompts/context/`
3. Writes to `design/alternatives/<agent-name>/design.md`

Launch these agents simultaneously using the Agent tool with `run_in_background: true`:
- pragmatic-minimalist
- platform-engineer
- data-flow-architect
- team-first-developer
- disposable-architecture
- clean-slate-designer

After all complete, run the Design Synthesizer to consolidate into `design/decision-map.md`.
```

**`.claude/skills/run-evaluation-phase/SKILL.md`**:
```yaml
---
name: run-evaluation-phase
description: Run all Phase 3 analyzer agents in parallel to evaluate design proposals
disable-model-invocation: true
---

# Phase 3: Design Evaluation

Run all 4 analyzer agents in parallel:
- red-team (failure modes, no scoring)
- execution-realist (effort, velocity, migration risk)
- ai-friendliness (AI tooling, testing, navigability)
- technical-merit (performance, simplicity, infra fit)

Each reads:
- All design proposals in `design/alternatives/*/design.md`
- `design/v4/evaluation-criteria.md`
- Shared context from `prompts/context/`

Each writes to `design/v4/analysis/<agent-name>.md`.

After all complete, run the Comparison Matrix Synthesizer to produce:
- `design/v4/comparison-matrix.md`
- `design/v4/recommendation.md`
```

**`.claude/skills/run-synthesis/SKILL.md`**:
```yaml
---
name: run-synthesis
description: Synthesize design or evaluation results into final deliverables
disable-model-invocation: true
---

Read all outputs from the most recent phase run and consolidate:
- For design: update `design/decision-map.md`
- For evaluation: produce `design/v4/comparison-matrix.md` and `design/v4/recommendation.md`
```

### C. Add Quality Hooks

**`.claude/settings.json`** — add hooks for consistency:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if the written file has YAML frontmatter with status and last_updated fields. If not, flag it."
          }
        ]
      }
    ],
    "Stop": [
      {
        "type": "prompt",
        "prompt": "If you just wrote a design or analysis document, verify it follows the template in AGENTS.md."
      }
    ]
  }
}
```

### D. Add Path-Specific Rules

**`.claude/rules/design-docs.md`**:
```yaml
---
paths:
  - "design/**/*.md"
---

All design documents must include:
- YAML frontmatter with `status`, `last_updated`, and `agent` fields
- A `## Security` section (addresses Key Finding #10: webhook notifications have zero authentication)
- Mermaid diagrams using sequenceDiagram or flowchart TD (not LR with many nodes)
- Relative cross-references to other docs
```

**`.claude/rules/agent-prompts.md`**:
```yaml
---
paths:
  - "prompts/**/*.md"
---

Agent prompt files must include:
- ## Persona section with specific expertise framing
- ## Context Files to Read with Required and Recommended subsections
- ## Task with concrete deliverables
- ## Output Format specifying exact file path for output
```

### E. Update CLAUDE.md

Your current CLAUDE.md is minimal and delegates to AGENTS.md. With the new structure, update it to reference the skills:

```markdown
# CLAUDE.md

## Quick Start
- `/run-design-phase` — Run all 6 design agents in parallel
- `/run-evaluation-phase` — Run all 4 analyzer agents in parallel
- `/run-synthesis` — Consolidate results into decision map or comparison matrix

## Project Context
See [AGENTS.md](AGENTS.md) for full project context, source repos, and agent roles.

## Agent Configuration
Custom agents are defined in `.claude/agents/`. Each corresponds to an agent role in AGENTS.md.

## Rules
- Path-specific rules in `.claude/rules/` enforce document templates automatically.
- Hooks in `.claude/settings.json` validate frontmatter and template compliance.
```

---

## Part 4: What You're Missing / What's New

### 1. Agent Teams (biggest gap)

Your current design uses **subagents** (map-reduce: dispatch → collect → synthesize). Agent Teams would let your design agents **communicate with each other** during the design phase — e.g., the Pragmatic Minimalist could challenge the Clean Slate Designer's assumptions in real-time.

**When to use**: Phase 3 evaluation is a great candidate. The Red Team could send findings to the other analyzers mid-analysis, rather than waiting for the synthesis step.

**Trade-off**: Higher token cost (each teammate is a full Claude instance). For your use case, subagents are probably sufficient for Phase 2, but Agent Teams could improve Phase 3 quality.

### 2. Worktree Isolation

When agents write to the same repo, use `isolation: worktree` to give each agent its own git branch. This prevents file conflicts entirely and lets you review each agent's output as a separate PR.

### 3. `/batch` for Large-Scale Execution

If you ever need to run the same analysis across multiple repos (e.g., documenting endpoints across denali, etna, fuji simultaneously), `/batch` orchestrates parallel agents in isolated worktrees automatically.

### 4. MCP Integration for Workflow

You already have Jira and Notion MCP. Consider adding hooks that:
- Auto-create Jira tickets from Red Team findings
- Publish final recommendations to Confluence
- Update Notion project tracking after each phase completes

### 5. Auto-Memory

Claude Code's memory system (what you're seeing now) can remember decisions across sessions. Key memories to establish:
- Which phases are complete
- Which decisions are still open
- Team composition and constraints

---

## Part 5: Recommended Directory Structure

```
transition-design/
├── CLAUDE.md                              # Updated with skill references
├── AGENTS.md                              # Keep as-is (project context)
│
├── .claude/
│   ├── settings.json                      # Hooks for quality enforcement
│   ├── agents/                            # NEW: Custom subagent definitions
│   │   ├── pragmatic-minimalist/AGENT.md
│   │   ├── platform-engineer/AGENT.md
│   │   ├── data-flow-architect/AGENT.md
│   │   ├── team-first-developer/AGENT.md
│   │   ├── disposable-architecture/AGENT.md
│   │   ├── clean-slate-designer/AGENT.md
│   │   ├── red-team/AGENT.md
│   │   ├── execution-realist/AGENT.md
│   │   ├── ai-friendliness/AGENT.md
│   │   └── technical-merit/AGENT.md
│   ├── skills/                            # NEW: Phase orchestration commands
│   │   ├── run-design-phase/SKILL.md
│   │   ├── run-evaluation-phase/SKILL.md
│   │   └── run-synthesis/SKILL.md
│   └── rules/                             # NEW: Path-specific conventions
│       ├── design-docs.md
│       └── agent-prompts.md
│
├── prompts/                               # KEEP: Original prompts as reference
│   ├── context/                           # Shared context (referenced by agents)
│   ├── design-agents/                     # Source for .claude/agents/ conversion
│   └── analyzer-agents/                   # Source for .claude/agents/ conversion
│
├── current-state/                         # Phase 1 output (complete)
├── design/                                # Phase 2-3 output
└── ...
```

---

## Part 6: Comparison — Your AI Methodology vs Current State of the Art

| Your Methodology (Mar 2026 doc) | Current Claude Code Reality |
|--------------------------------|---------------------------|
| "Room full of specialists" metaphor | Still valid — this is how persona-based prompts work |
| Cursor subagents with 4-agent limit | Claude Code: unlimited parallel agents + Agent Teams |
| Manual map-reduce orchestration | Skills automate the dispatch; hooks enforce quality |
| Prompts as plain markdown files | Convert to AGENT.md with frontmatter for tool/model control |
| No inter-agent communication | Agent Teams enable direct messaging between agents |
| Manual verification of outputs | Hooks (PostToolUse, Stop) can auto-verify templates |
| Context as files agents "should read" | Agent frontmatter + rules enforce what gets read |
| No iterative loops | Checkpoint/rewind, `/batch`, background agents |

Your methodology document is actually quite solid conceptually. The main gaps are:
1. **Tooling has caught up** — what you did manually (orchestrating waves) is now built-in
2. **Agent Teams** — a paradigm you anticipated ("fleet dispatcher") but didn't have access to
3. **Hooks** — deterministic quality gates you were doing manually
4. **Skills** — the orchestration commands that make your workflow repeatable without re-explaining it each session
