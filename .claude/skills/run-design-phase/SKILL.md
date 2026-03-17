---
name: run-design-phase
description: Run all 6 Phase 2 design agents in parallel to generate architecture proposals
disable-model-invocation: true
---

# Run Design Phase (Phase 2)

Execute the full Phase 2 design generation pipeline. This launches all 6 design agents in parallel and synthesizes the results.

## Step 1: Archive and Prepare

Run the archive step from `runbooks/regenerate-phase2.md` Step 2:

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Archive previous designs
ARCHIVE_DATE=$(date +%Y-%m-%d)
mkdir -p design/archive/${ARCHIVE_DATE}
for agent in pragmatic-minimalist platform-engineer data-flow-architect team-first-developer disposable-architecture clean-slate-designer; do
  if [ -d "design/alternatives/${agent}" ]; then
    mv "design/alternatives/${agent}" "design/archive/${ARCHIVE_DATE}/${agent}"
    echo "Archived: design/alternatives/${agent} -> design/archive/${ARCHIVE_DATE}/${agent}"
  fi
done

# Archive legacy v1 outputs if present
for legacy in A-monolith B-microservice; do
  if [ -d "design/alternatives/${legacy}" ]; then
    mkdir -p design/archive/v1
    mv "design/alternatives/${legacy}" "design/archive/v1/${legacy}"
    echo "Archived legacy: design/alternatives/${legacy} -> design/archive/v1/${legacy}"
  fi
done

# Create fresh output directories
mkdir -p design/alternatives/pragmatic-minimalist
mkdir -p design/alternatives/platform-engineer
mkdir -p design/alternatives/data-flow-architect
mkdir -p design/alternatives/team-first-developer
mkdir -p design/alternatives/disposable-architecture
mkdir -p design/alternatives/clean-slate-designer
mkdir -p design/v4/analysis
```

## Step 2: Pre-Flight Check

Verify all required context files exist before launching agents:

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Required by all design agents
ls prompts/context/system-context.md
ls prompts/context/codebase-analysis.md
ls current-state/overview.md
ls current-state/integration/12go-api-surface.md

# Required by specific agents
ls current-state/cross-cutting/monitoring.md
ls current-state/cross-cutting/messaging.md
ls current-state/cross-cutting/authentication.md
ls current-state/cross-cutting/data-storage.md
ls current-state/endpoints/search.md
ls design/v4/evaluation-criteria.md

# Meeting context (required by all agents)
ls meetings/2026-02-25-microservice-vs-monolith-architecture-decision/meeting-record.md
ls meetings/2026-03-12-migration-problem-analysis/new-findings.md
ls meetings/2026-03-17-team-lead-sync/meeting-record.md
```

If any file is missing, stop and report before proceeding.

## Step 3: Launch All 6 Design Agents in Parallel

Launch all 6 design agents simultaneously using the Agent tool with `run_in_background: true`. Each agent has its full prompt in `.claude/agents/<name>/AGENT.md`.

For each agent, the instruction is:

> Read and follow the agent prompt at `.claude/agents/<name>/AGENT.md`. Your task is fully described there. Start by reading all required context files listed in the prompt, then produce your design.

Special instruction for **clean-slate-designer**: Do NOT read the Denali, Etna, or Fuji source code as design input. Start only from the client-facing API contract and the 12go API surface described in the context files.

Agents to launch:
1. `pragmatic-minimalist`
2. `platform-engineer`
3. `data-flow-architect`
4. `team-first-developer`
5. `disposable-architecture`
6. `clean-slate-designer`

## Step 4: Synthesize Decision Map

After all 6 design agents complete:

1. Read all 6 design docs in `design/alternatives/*/design.md`
2. Read the current `design/decision-map.md`
3. Update `design/decision-map.md` with:
   - Convergences: where multiple agents reached the same conclusion
   - Divergences: where agents disagree (these are the real design decisions)
   - New decision nodes for options proposed in the new designs
   - Clean Slate contrast: what the zero-legacy agent proposes vs. legacy-aware agents
4. Write a convergence/divergence summary at the top of the update section

## Step 5: Quality Checks

Verify after all designs complete:

- [ ] All 6 design docs exist at `design/alternatives/[agent]/design.md`
- [ ] Each design addresses all 13 client-facing endpoints
- [ ] Each design proposes a concrete language and framework (not "TBD")
- [ ] Clean Slate design does NOT cite Denali/Etna/Fuji structure as a design input
- [ ] The decision map has been updated with new options
