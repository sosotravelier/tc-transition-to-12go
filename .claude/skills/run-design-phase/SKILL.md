---
name: run-design-phase
description: Run all 6 Phase 2 design agents in parallel to generate architecture proposals
---

# Run Design Phase (Phase 2)

Execute the full Phase 2 design generation pipeline. This launches all 6 design agents in parallel and synthesizes the results.

File structure is defined in `.claude/rules/design-file-structure.md` — all paths below follow that convention.

## Step 1: Archive and Prepare

Archive the current working set before regenerating:

```bash
cd /Users/sosotughushi/RiderProjects/transition-design

# Determine next archive version number
LAST_VERSION=$(ls -d design/archive/v* 2>/dev/null | sed 's/.*\/v//' | sort -n | tail -1)
NEXT_VERSION=$((${LAST_VERSION:-0} + 1))

# Archive current alternatives and analysis if they exist
if [ -d "design/alternatives" ] && [ "$(ls -A design/alternatives 2>/dev/null)" ]; then
  mkdir -p "design/archive/v${NEXT_VERSION}/alternatives"
  mv design/alternatives/* "design/archive/v${NEXT_VERSION}/alternatives/"
  echo "Archived alternatives -> design/archive/v${NEXT_VERSION}/alternatives/"
fi

if [ -d "design/analysis" ] && [ "$(ls -A design/analysis 2>/dev/null)" ]; then
  mkdir -p "design/archive/v${NEXT_VERSION}/analysis"
  mv design/analysis/* "design/archive/v${NEXT_VERSION}/analysis/"
  echo "Archived analysis -> design/archive/v${NEXT_VERSION}/analysis/"
fi

for f in evaluation-criteria.md decision-map.md comparison-matrix.md recommendation.md; do
  if [ -f "design/${f}" ]; then
    mkdir -p "design/archive/v${NEXT_VERSION}"
    mv "design/${f}" "design/archive/v${NEXT_VERSION}/${f}"
    echo "Archived ${f} -> design/archive/v${NEXT_VERSION}/${f}"
  fi
done

# Create fresh output directories
mkdir -p design/alternatives/pragmatic-minimalist
mkdir -p design/alternatives/platform-engineer
mkdir -p design/alternatives/data-flow-architect
mkdir -p design/alternatives/team-first-developer
mkdir -p design/alternatives/disposable-architecture
mkdir -p design/alternatives/clean-slate-designer
mkdir -p design/analysis
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

# Meeting context (required by all agents)
ls meetings/2026-02-25-microservice-vs-monolith-architecture-decision/meeting-record.md
ls meetings/2026-03-12-migration-problem-analysis/new-findings.md
ls meetings/2026-03-17-team-lead-sync/meeting-record.md
```

If any file is missing, stop and report before proceeding.

## Step 3: Copy Evaluation Criteria

If `design/evaluation-criteria.md` does not exist after archiving, copy it from the latest archive version so agents can reference it:

```bash
if [ ! -f "design/evaluation-criteria.md" ]; then
  LATEST=$(ls -d design/archive/v* 2>/dev/null | sort -V | tail -1)
  if [ -f "${LATEST}/evaluation-criteria.md" ]; then
    cp "${LATEST}/evaluation-criteria.md" design/evaluation-criteria.md
    echo "Copied evaluation-criteria.md from ${LATEST}"
  fi
fi
```

## Step 4: Launch All 6 Design Agents in Parallel

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

<HARD-GATE>
Do NOT proceed to synthesis until ALL 6 design docs exist and are substantive:

```bash
for agent in pragmatic-minimalist platform-engineer data-flow-architect team-first-developer disposable-architecture clean-slate-designer; do
  FILE="design/alternatives/${agent}/design.md"
  if [ ! -f "$FILE" ]; then
    echo "MISSING: ${agent}"
  elif [ $(wc -w < "$FILE") -lt 500 ]; then
    echo "TOO SHORT: ${agent} ($(wc -w < "$FILE") words — may be incomplete)"
  else
    echo "OK: ${agent} ($(wc -w < "$FILE") words)"
  fi
done
```

If any agent is MISSING: re-dispatch that agent.
If any agent is TOO SHORT: review the output — if incomplete, re-dispatch with more context.
</HARD-GATE>

## Step 4b: Handle Agent Failures

| Agent Status | Action |
|---|---|
| Design exists, >500 words | Proceed |
| Design exists, <500 words | Review — may be intentionally minimal. If incomplete, re-dispatch with full context |
| Design missing (agent produced no output) | Re-dispatch with same prompt + all required files explicitly listed |
| Agent references Denali/Etna/Fuji source (clean-slate only) | Violates instructions — re-dispatch with explicit warning |

## Step 5: Synthesize Decision Map

After all 6 design agents complete, run the synthesize-decision-map skill to generate `design/decision-map.md`.

## Step 6: Quality Checks

Verify after all designs complete:

- [ ] All 6 design docs exist at `design/alternatives/[agent]/design.md`
- [ ] Each design addresses all 13 client-facing endpoints
- [ ] Each design proposes a concrete language and framework (not "TBD")
- [ ] Clean Slate design does NOT cite Denali/Etna/Fuji structure as a design input
- [ ] `design/decision-map.md` has been generated
