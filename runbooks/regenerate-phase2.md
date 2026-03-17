# Runbook: Regenerate Phase 2 Design

Use this runbook when the system context has changed -- after a meeting, after new information from 12go, after the POC surfaces findings -- and you want to re-run the full design proposal and evaluation pipeline.

**Current context version**: `prompts/context/system-context.md`
**Current evaluation criteria**: `design/v4/evaluation-criteria.md`
**Historical designs**: `design/alternatives/` and `design/v1-v3/` (preserved for comparison)

---

## When to Re-Run

Re-run Phase 2 when any of these conditions are met:

- A key assumption has been proven wrong (e.g., "12go can be modified" was discovered in the Feb 25 meeting)
- The POC produces concrete friction data about one of the design options
- 12go DevOps provides answers to the open questions (G1-G8 in `design/decision-map.md`)
- The team composition changes significantly
- A new constraint appears that none of the current designs address

Do NOT re-run just to get fresh output. The value is in the delta -- what changed in the context, and how does that change the proposals.

---

## Step 0: Verify What Changed

Before running anything, document what is new:

1. Read `prompts/context/system-context.md` -- what is currently documented
2. Write down specifically what new information you have
3. Check `design/decision-map.md` -- which open questions (G1-G8) are now answered?
4. Check `prompt-log.md` -- is this session's context already captured?

**Do not proceed until you can answer: "What changed, and why does it affect the design?"**

---

## Step 1: Update Context Documents

Update the relevant context files before running any agents. All design and analyzer agents read these files as their primary input.

### 1a. Update `prompts/context/system-context.md`

Add or update:
- New meeting outcomes (add to the "Meeting Outcomes" section with date)
- Resolved open questions (mark resolved, add the answer)
- New constraints discovered
- Changes to team composition or timeline

**Commit the update before proceeding.** The git diff preserves exactly what changed and why.

```bash
cd /Users/sosotughushi/RiderProjects/transition-design
git add prompts/context/system-context.md
git commit -m "context: update system-context with [brief description of what changed]"
```

### 1b. Optionally Update `design/v4/evaluation-criteria.md`

If the weights should change (e.g., a new constraint makes infrastructure fit more critical), update the criteria. If you do this, document why in the criteria file's header.

---

## Step 1.5: Pre-Flight Check

Before running any agents, verify all required context files exist. Design agents will silently skip missing context.

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Required by all design agents
ls prompts/context/system-context.md
ls prompts/context/codebase-analysis.md
ls current-state/overview.md
ls current-state/integration/12go-api-surface.md

# Required by specific agents
ls current-state/cross-cutting/monitoring.md      # Platform Engineer, Data Flow Architect
ls current-state/cross-cutting/messaging.md       # Data Flow Architect
ls current-state/cross-cutting/authentication.md  # Pragmatic Minimalist, Red Team
ls current-state/cross-cutting/data-storage.md    # Pragmatic Minimalist
ls design/decision-map.md                          # Pragmatic Minimalist, Disposable Architecture
ls current-state/endpoints/search.md              # Technical Merit
ls design/v4/evaluation-criteria.md               # All analyzer agents
```

If any file is missing, either create it before proceeding or note which agent will have incomplete context.

---

## Step 2: Archive Previous Designs and Create Output Directories

Before running new agents, preserve the previous run's outputs so the delta is visible.

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Archive previous designs (do not delete -- they are the comparison baseline)
# If design/alternatives/ already contains v4 agent folders, move them:
ARCHIVE_DATE=$(date +%Y-%m-%d)
mkdir -p design/archive/${ARCHIVE_DATE}
# Move any existing agent folders that will be overwritten:
for agent in pragmatic-minimalist platform-engineer data-flow-architect team-first-developer disposable-architecture clean-slate-designer; do
  if [ -d "design/alternatives/${agent}" ]; then
    mv "design/alternatives/${agent}" "design/archive/${ARCHIVE_DATE}/${agent}"
    echo "Archived: design/alternatives/${agent} -> design/archive/${ARCHIVE_DATE}/${agent}"
  fi
done

# If v1 outputs (A-monolith, B-microservice) are still in design/alternatives/, move them:
for legacy in A-monolith B-microservice; do
  if [ -d "design/alternatives/${legacy}" ]; then
    mkdir -p design/archive/v1
    mv "design/alternatives/${legacy}" "design/archive/v1/${legacy}"
    echo "Archived legacy: design/alternatives/${legacy} -> design/archive/v1/${legacy}"
  fi
done
```

Then create fresh output directories:

```bash
# Design alternatives go here
mkdir -p design/alternatives/pragmatic-minimalist
mkdir -p design/alternatives/platform-engineer
mkdir -p design/alternatives/data-flow-architect
mkdir -p design/alternatives/team-first-developer
mkdir -p design/alternatives/disposable-architecture
mkdir -p design/alternatives/clean-slate-designer

# Analysis goes in v{N}
mkdir -p design/v4/analysis
```

---

## Step 3: Run Phase 2 — Design Agents

Use the `/run-design-phase` skill to execute all 6 design agents in parallel.

This skill handles:
- Archiving previous designs (Step 2 above)
- Pre-flight checks (Step 1.5 above)
- Launching all 6 design agents simultaneously via `.claude/agents/<name>/AGENT.md`
- Synthesizing the decision map after all agents complete
- Running quality checks

Each agent's full prompt is in `.claude/agents/<name>/AGENT.md`. The canonical prompt sources remain in `prompts/design-agents/` for reference.

---

## Step 4: Run Phase 3 — Analyzer Agents

Use the `/run-evaluation-phase` skill to execute all 4 analyzer agents in parallel.

This skill handles:
- Verifying all 6 design docs exist
- Launching all 4 analyzer agents simultaneously via `.claude/agents/<name>/AGENT.md`
- Synthesizing the comparison matrix and recommendation
- Verifying arithmetic on weighted scores
- Running quality checks

Each agent's full prompt is in `.claude/agents/<name>/AGENT.md`. The canonical prompt sources remain in `prompts/analyzer-agents/` for reference.

---

## Step 5: Synthesize — Comparison Matrix and Recommendation

As the main agent (orchestrator), after all 4 analyzer agents complete:

1. Read all 4 analysis docs in `design/v4/analysis/`
2. Read `design/v4/evaluation-criteria.md` for the scoring formula
3. **Verify arithmetic**: the comparison matrix is where AI arithmetic errors occur. Double-check every weighted total manually before accepting it.
4. Apply Red Team findings: if Red Team identified a fatal flaw for a design, add a note to that design's row in the matrix
5. Write:
   - `design/v4/comparison-matrix.md` -- full scoring table with per-criterion scores from each agent
   - `design/v4/recommendation.md` -- the recommendation with justification, including what changes from the previous recommendation and why

---

## Step 6: Update Prompt Log

Add a session entry to `prompt-log.md`:

```markdown
## Session [N]: [Brief description] ([Date])

### What Changed
[What new information prompted this re-run]

### Outputs
- design/alternatives/[agent]/design.md (x5)
- design/v4/analysis/*.md (x4)
- design/v4/comparison-matrix.md
- design/v4/recommendation.md

### Key Differences from Previous Run
[How the recommendation changed, and why]
```

---

## Quality Checks

After each phase, verify:

**After Wave 1 (designs):**
- [ ] All 6 design docs exist at `design/alternatives/[agent]/design.md`
- [ ] Each design addresses all 13 client-facing endpoints
- [ ] Each design proposes a concrete language and framework (not "TBD")
- [ ] Clean Slate design does NOT cite Denali/Etna/Fuji structure as a design input (verify)
- [ ] The decision map has been updated with new options

**After Wave 2 (analysis):**
- [ ] `design/v4/analysis/red-team.md` exists with failure modes per design
- [ ] `design/v4/analysis/execution-realist.md` exists with scores and timeline estimates
- [ ] `design/v4/analysis/ai-friendliness.md` exists with scores
- [ ] `design/v4/analysis/technical-merit.md` exists with scores
- [ ] No design was scored by more than one agent on the same criterion (check for overlaps against evaluation-criteria.md coverage table)

**After Synthesis:**
- [ ] Weighted totals verified arithmetically (do the math yourself, don't trust the AI's sums)
- [ ] Red Team fatal flaws are reflected in the matrix
- [ ] Recommendation clearly states what changed from the previous version and why
- [ ] `prompt-log.md` updated

---

## Notes on Agent Diversity

The 6 design agents are deliberately diverse in *perspective*, not in language. This means:

- Multiple agents may propose the same language (e.g., both Platform Engineer and Disposable Architecture Designer might recommend PHP/Symfony)
- That convergence is signal, not redundancy -- it means multiple independent frames of analysis reached the same conclusion
- Divergence is equally valuable: if the Team-First Developer recommends .NET and the Platform Engineer recommends PHP, that tension is the real design decision
- The Clean Slate Designer is the only agent with zero legacy anchoring. Its language choice is the most "problem-pure" signal. If it proposes the same language as legacy-anchored agents, that strengthens the recommendation. If it diverges, that divergence deserves explicit discussion.

The 3 scoring agents cover different criteria (see `design/v4/evaluation-criteria.md` coverage table). Each criterion is scored by exactly one agent (C10 Elegance has a supplementary AI Friendliness sub-score but Technical Merit is authoritative). The Red Team does not score -- it filters.

---

## Partial Re-Run Guide

If only specific context changed, you do not need to re-run all 6 design agents. Use this table to determine the minimum re-run scope:

| What Changed | Minimum Design Agent Re-Run | Re-Run Analyzers? |
|---|---|---|
| POC friction data (F3 implementation difficulty) | Platform Engineer, Pragmatic Minimalist, Clean Slate | Yes -- all 4 analyzers read design docs |
| 12go DevOps answers (G3, G4: language preference, runtime support) | Platform Engineer | Yes |
| Event/data requirements from data team (G6) | Data Flow Architect | Yes |
| Station ID mapping resolved (G5) | All agents (this affects every design's complexity estimate) | Yes |
| Team composition changes | Team-First Developer | Yes |
| F3 decomposition timeline confirmed | Disposable Architecture, Platform Engineer | Yes |
| New security constraint | All agents (affects cross-cutting design) | Yes |

**Rule**: If you re-run any design agent, re-run all 4 analyzer agents on the updated design set. Partial analyzer re-runs are not recommended -- each analyzer reads all designs, so a stale analyzer with a new design set will produce an inconsistent comparison matrix.

---

## Common Pitfalls

- **Don't skip the Red Team.** In v1, the "12go is a black box" assumption propagated through Phase 2 unchallenged and distorted all evaluations. Red Team is specifically designed to catch this.
- **Verify arithmetic.** AI arithmetic errors in comparison matrices have occurred before. The scores may be right; the sums may not be.
- **Update context before running.** Running agents on stale context produces stale designs. The whole point of re-running is incorporating new information.
- **Don't run if nothing changed.** Re-running for its own sake dilutes the meaning of the versioned outputs.
- **Don't skip the archive step.** Without archiving the previous run, it is impossible to see how the recommendation changed and why.
- **Check that pre-flight context files exist before spawning agents.** A missing `messaging.md` or `decision-map.md` will cause silent context gaps in the design output.
