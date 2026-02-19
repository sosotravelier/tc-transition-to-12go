# Prompt Library

Reusable, composable prompts for the transition design exploration. Run this process multiple times to refine designs.

## Structure

```
prompts/
├── context/                    # Shared context blocks (inject into all agents)
│   ├── system-context.md       # Current state, team, scale, constraints
│   └── codebase-analysis.md    # What exists, what to keep/discard
├── design-agents/              # One prompt per architectural alternative
│   ├── dotnet-design.md
│   ├── php-design.md
│   ├── golang-design.md
│   ├── hybrid-bff-design.md
│   └── typescript-design.md
├── reviewer-agents/            # One prompt per reviewer persona
│   ├── systems-architect.md
│   ├── ai-augmented-architect.md
│   ├── business-risk-assessor.md
│   ├── scale-engineer.md
│   ├── devops-architect.md
│   └── dx-advocate.md
└── synthesis/                  # Aggregation and comparison prompts
    ├── comparison-prompt.md
    └── recommendation-prompt.md
```

## How to Use

### Full Run (All Phases)
1. Run all 5 design agents (can run 4 in parallel, then 1)
2. Run all 6 reviewer agents in parallel (each reviews all 5 designs)
3. Run synthesis agents to produce comparison matrix and recommendation

### Iterative Refinement
- Re-run individual design agents after getting new information
- Re-run reviewers after design updates
- Re-run synthesis after any changes

### Adding a New Alternative
1. Create `prompts/design-agents/new-alternative-design.md` following the template
2. Create `design/alternatives/0X-new-alternative/` directory with `reviews/` subdirectory
3. Run the new design agent
4. Re-run all reviewers (they read all designs)
5. Re-run synthesis

## Prompt Template

Every prompt follows this structure:
```markdown
# [Agent Role/Name]
## Persona
## Context Files to Read
## Task
## Research Directives
## Output Format
## Constraints
```
