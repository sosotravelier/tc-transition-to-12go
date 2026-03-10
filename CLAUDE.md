# CLAUDE.md

This project is configured in [AGENTS.md](AGENTS.md). **Read it first** — it contains the project context, source repository paths, agent roles, document conventions, and decision log.

---

## Claude Code Notes

### Running Multi-Agent Workflows

Your agent roles in `AGENTS.md` map directly to Claude Code's **Agent tool**. To run a phase:

- Launch multiple agents in a **single message** to run them in parallel (no hard cap)
- Each agent should be told to read its prompt file from `prompts/design-agents/` or `prompts/analyzer-agents/` plus the required input docs listed in `AGENTS.md`
- Each agent writes to its own output path — no file conflicts
- Use `run_in_background: true` for long-running agents so they don't block

**Wave example (Phase 2):**
> "Run all 5 design agents in parallel. Each reads its prompt from `prompts/design-agents/` and writes to `design/alternatives/[agent-name]/design.md`."

**Wave example (Phase 3):**
> "Run the 4 analyzer agents in parallel. Each reads its prompt from `prompts/analyzer-agents/` and the 5 design docs, then writes to `design/v4/analysis/`."

### Cursor vs Claude Code Parallel Limits

Cursor supports up to 4 subagents per wave. Claude Code has no fixed limit — all 5 design agents or all 4 analyzer agents can run simultaneously.
