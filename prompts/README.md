# Prompt Library

Reusable, composable prompts for the transition design exploration.

## Structure

```
prompts/
├── context/                    # Shared context blocks (inject into all agents)
│   ├── system-context.md       # Current state, team, scale, constraints
│   └── codebase-analysis.md    # What exists, what to keep/discard
├── design-agents/              # Language-specific exploration (Wave 2)
│   ├── php-symfony.md          # Monolith + Microservice PHP path
│   ├── dotnet.md               # Microservice .NET path
│   ├── golang.md               # Microservice Go path
│   └── typescript.md           # Microservice TS path (includes "Why Not Python")
├── analyzer-agents/            # Scoring and analysis (Wave 3)
│   ├── team-velocity.md        # DX + AI + Competency
│   ├── architecture-performance.md # Arch + Scale + Performance
│   ├── operations-infra.md     # DevOps + Monitoring + Infra
│   └── risk-migration.md       # Risk + Migration + Maintainability
├── synthesis/                  # Recommendation and matrix (Wave 4)
│   ├── comparison-prompt.md
│   └── recommendation-prompt.md
└── archive/                    # Obsolete prompts from previous versions
    ├── hybrid-bff-design.md
    ├── migration-strategy.md
    └── reviewer-agents/        # Old 6-persona structure
```

## How to Use

1. **Wave 1 (Complete)**: Produce high-level monolith and microservice designs.
2. **Wave 2**: Run design agents in parallel to concretize language choices.
3. **Wave 3**: Run analyzer agents in parallel to score all options.
4. **Wave 4**: Run synthesis agents to produce final comparison and recommendation.
