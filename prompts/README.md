# Prompt Library

Reusable, composable prompts for the transition design exploration.

## Structure

```
prompts/
├── context/                    # Shared context blocks (inject into all agents)
│   ├── system-context.md       # Current state, team, scale, constraints
│   └── codebase-analysis.md    # What exists, what to keep/discard
├── design-agents/              # Perspective-based design proposals (Phase 2)
│   ├── pragmatic-minimalist.md # Strangler fig, simplify in-place
│   ├── platform-engineer.md    # Infrastructure-first, operational burden
│   ├── data-flow-architect.md  # Event/data flow, Kafka, ClickHouse
│   ├── team-first-developer.md # Developer experience, AI tooling, team dynamics
│   ├── disposable-architecture.md # Designed for replaceability
│   └── clean-slate-designer.md # Contract-first, zero legacy anchoring
├── analyzer-agents/            # Scoring and analysis (Phase 3)
│   ├── red-team.md             # Failure mode analysis (does not score)
│   ├── execution-realist.md    # Effort, velocity, team match, migration risk
│   ├── ai-friendliness.md      # AI tooling, test generation, code navigability
│   └── technical-merit.md      # Performance, simplicity, infra fit, elegance
├── synthesis/                  # Recommendation and matrix (Phase 3 synthesis)
│   ├── comparison-prompt.md
│   └── recommendation-prompt.md
└── archive/                    # Superseded prompts (v1 language-specific + old personas)
    ├── v1/                     # v1: one agent per language (replaced by perspective-based)
    └── reviewer-agents/        # Pre-v4 6-persona reviewer structure
```

## How to Use

1. **Phase 1 (Complete)**: Document current state — see `current-state/`.
2. **Phase 2**: Run 6 design agents in parallel. Each reads its prompt + context files.
3. **Phase 3**: Run 4 analyzer agents in parallel on all 6 designs. Then synthesize.

See `runbooks/regenerate-phase2.md` for the full step-by-step process.
