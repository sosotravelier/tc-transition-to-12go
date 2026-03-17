---
name: run-evaluation-phase
description: Run all 4 Phase 3 analyzer agents in parallel to evaluate design proposals
disable-model-invocation: true
---

# Run Evaluation Phase (Phase 3)

Execute the full Phase 3 evaluation pipeline. This launches all 4 analyzer agents in parallel and synthesizes the results into the comparison matrix and recommendation.

File structure is defined in `.claude/rules/design-file-structure.md` — all paths below follow that convention.

## Pre-Condition

All 6 design docs must exist in `design/alternatives/*/design.md` before running this phase. Verify:

```bash
cd /Users/sosotughushi/RiderProjects/transition-design
for agent in pragmatic-minimalist platform-engineer data-flow-architect team-first-developer disposable-architecture clean-slate-designer; do
  ls "design/alternatives/${agent}/design.md"
done
ls design/evaluation-criteria.md
```

If any design doc is missing, run `/run-design-phase` first.

## Step 1: Launch All 4 Analyzer Agents in Parallel

Launch all 4 analyzer agents simultaneously using the Agent tool with `run_in_background: true`. Each agent has its full prompt in `.claude/agents/<name>/AGENT.md`.

For each agent, the instruction is:

> Read and follow the agent prompt at `.claude/agents/<name>/AGENT.md`. Your task is fully described there. Read ALL 6 design docs in `design/alternatives/*/design.md` before producing your analysis.

Agents to launch:
1. `red-team` — finds failure modes, does NOT score
2. `execution-realist` — scores C1 Implementation Effort, C2 Solo Developer Fit, C6 Migration Risk, C12 Development Velocity
3. `ai-friendliness` — scores C3 AI-Friendliness, C7 Testing Ease, C10 Elegance (partial)
4. `technical-merit` — scores C4 Search Performance, C5 Simplicity, C8 Infrastructure Fit, C9 Disposability, C10 Elegance (authoritative), C11 Monitoring/Observability

## Step 2: Synthesize Comparison Matrix and Recommendation

After all 4 analyzer agents complete:

1. Read all 4 analysis docs in `design/analysis/`
2. Read `design/evaluation-criteria.md` for the scoring formula
3. **Verify arithmetic**: Double-check every weighted total manually. AI arithmetic errors in comparison matrices have occurred before. The scores may be right; the sums may not be.
4. Apply Red Team findings: if Red Team identified a fatal flaw for a design, add a note to that design's row in the matrix
5. Use Technical Merit's Elegance score as the authoritative C10 value. AI Friendliness's C10 sub-score is supplementary context only.
6. Write:
   - `design/comparison-matrix.md` — full scoring table with per-criterion scores from each agent
   - `design/recommendation.md` — the recommendation with justification, including what changes from the previous recommendation and why

## Step 3: Quality Checks

Verify after synthesis:

- [ ] `design/analysis/red-team.md` exists with failure modes per design
- [ ] `design/analysis/execution-realist.md` exists with scores and timeline estimates
- [ ] `design/analysis/ai-friendliness.md` exists with scores
- [ ] `design/analysis/technical-merit.md` exists with scores
- [ ] No design was scored by more than one agent on the same criterion (check against evaluation-criteria.md coverage table)
- [ ] Weighted totals verified arithmetically
- [ ] Red Team fatal flaws are reflected in the matrix
- [ ] Recommendation clearly states what changed from the previous version and why
