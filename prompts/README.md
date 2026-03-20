# Prompt Library

Shared context and synthesis prompts for the transition design exploration.

Agent prompts live in `.claude/agents/<name>/AGENT.md` — this directory holds only shared context and synthesis prompts.

## Structure

```
prompts/
├── context/                    # Shared context blocks (injected into all agent prompts)
│   ├── system-context.md       # Current state, team, scale, constraints, meeting outcomes
│   └── codebase-analysis.md    # What exists in the codebase, what to keep/discard
├── synthesis/                  # Recommendation and matrix (Phase 3 synthesis)
│   ├── comparison-prompt.md
│   └── recommendation-prompt.md
└── archive/                    # Superseded prompts (v1 language-specific + old personas)
    ├── v1/                     # v1: one agent per language (replaced by perspective-based)
    └── reviewer-agents/        # Pre-v4 6-persona reviewer structure
```

## How to Use

1. **Phase 1 (Complete)**: Document current state — see `current-state/`.
2. **Phase 2**: Run 6 design agents in parallel. Each reads from `.claude/agents/<name>/AGENT.md`.
3. **Phase 3**: Run 4 analyzer agents in parallel on all 6 designs. Then synthesize.

See `CLAUDE.md` for slash commands or `runbooks/regenerate-phase2.md` for the manual process.
