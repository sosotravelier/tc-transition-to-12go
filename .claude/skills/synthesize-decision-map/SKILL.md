---
name: synthesize-decision-map
description: Generate a fresh decision map from Phase 2 designs and Phase 3 evaluations
disable-model-invocation: true
---

# Generate Decision Map

Build a decision map from scratch based on the current Phase 2 design proposals and Phase 3 evaluation results.

File structure is defined in `.claude/rules/design-file-structure.md` — all paths below follow that convention.

## Input files to read

**Phase 2 — Design proposals (read all 6):**
- `design/alternatives/pragmatic-minimalist/design.md`
- `design/alternatives/platform-engineer/design.md`
- `design/alternatives/data-flow-architect/design.md`
- `design/alternatives/team-first-developer/design.md`
- `design/alternatives/disposable-architecture/design.md`
- `design/alternatives/clean-slate-designer/design.md`

**Phase 3 — Evaluation results:**
- `design/evaluation-criteria.md` — scoring rubric
- `design/comparison-matrix.md` — weighted scores
- `design/recommendation.md` — final recommendation
- `design/analysis/red-team.md` — failure modes
- `design/analysis/execution-realist.md` — effort and feasibility scores
- `design/analysis/ai-friendliness.md` — AI tooling scores
- `design/analysis/technical-merit.md` — architecture quality scores

**Context:**
- `prompts/context/system-context.md` — constraints, team composition, open questions

Do NOT read any file in `design/archive/` — you are building from current state only.

<HARD-GATE>
Do NOT generate decision-map.md until all inputs exist:

```bash
for agent in pragmatic-minimalist platform-engineer data-flow-architect team-first-developer disposable-architecture clean-slate-designer; do
  [ -f "design/alternatives/${agent}/design.md" ] && echo "OK: ${agent}" || echo "MISSING design: ${agent}"
done
for analyzer in red-team execution-realist ai-friendliness technical-merit; do
  [ -f "design/analysis/${analyzer}.md" ] && echo "OK: ${analyzer}" || echo "MISSING analysis: ${analyzer}"
done
[ -f "design/evaluation-criteria.md" ] && echo "OK: evaluation-criteria" || echo "MISSING: evaluation-criteria.md"
```

If anything is MISSING, synthesis cannot proceed.
</HARD-GATE>

## Pre-Synthesis Completeness Check

Before generating, scan all inputs:

- [ ] All 6 designs propose concrete options (not TBD)
- [ ] All 4 analyses provide evaluation results
- [ ] Count convergences (6/6 or 5/6 agreement) — expect >5
- [ ] Count divergences (agents split) — expect 5-15

If convergences < 5 or divergences > 20, flag for user review before proceeding.

## What to produce

Write a new `design/decision-map.md` with the following structure:

### Frontmatter

```yaml
---
status: draft
last_updated: YYYY-MM-DD
---
```

### 1. Executive Summary

A brief (5-10 lines) summary answering:
- What is the recommended approach?
- What scored highest and by what margin?
- What did the Red Team flag as the biggest risks?
- What is the runner-up and why was it not chosen?

### 2. How to Read This Map

Explain the symbols used in the document:

| Symbol | Meaning |
|:---:|:---|
| ✅ | All 6 design agents converged on this (consensus) |
| ⭐ | Recommended by Phase 3 evaluation (highest score) |
| Each agent abbreviation (PM, PE, DA, DF, TF, CS) | Which agent proposed this option |

### 3. Convergences

A table of decisions where most or all design agents agreed. These are effectively settled — no real debate.

For each convergence, list:
- The decision question
- What the agents converged on
- How many agreed (e.g., 6/6, 5/6)

### 4. Decision Tree

Mermaid flowcharts showing every major fork discovered across the 6 designs. Each fork is a decision point, each branch is an option. Mark which agents proposed which option, and which option the evaluation recommends (⭐).

Organize the tree by topic:
- **Architecture & Language** — where does the service live, what language, what framework
- **Migration & Routing** — how clients are migrated, per-client routing, authentication bridge
- **Data & Storage** — station mapping, seat lock, booking schema state, local persistence
- **Notifications & Events** — webhook handling, analytics events, data team requirements
- **Testing & Quality** — contract testing strategy, monitoring approach

Use `flowchart LR` (not TD — renders as tall vertical chains). Keep each topic in its own mermaid block.

### 5. Decision Summary Table

A table listing every decision with:
- Decision ID and question
- Available options (brief)
- Which agents proposed which option
- Evaluation recommendation (⭐) with brief justification
- Status: resolved / open / blocked (and by what)

### 6. Open Questions

Decisions that cannot be resolved without external input. For each:
- What is the question?
- Who needs to answer it?
- What decision does it block?
- What is the default/fallback if no answer comes?

### 7. Red Team Warnings

Top risks from the Red Team analysis that apply regardless of which option is chosen. These are cross-cutting concerns, not option-specific.

## Format guidelines

### Mermaid diagram rules

- **One decision question per mermaid block.** NEVER combine multiple independent decision questions into a single diagram — they render as disconnected clusters with huge whitespace gaps. Each `{decision?}` node gets its own ` ```mermaid ` block.
- Use `flowchart LR` (left-to-right). Do NOT use `flowchart TD` — it renders as tall vertical chains, hard to read.
- Keep labels short (2-3 lines max). Move details into a bullet list below the diagram instead of cramming them into node labels.
- Node IDs: camelCase, no spaces.
- Wrap labels containing special characters in double quotes.
- No HTML tags or colors in diagrams.
- Maximum 6-8 nodes per diagram. If a decision tree is larger, split it into multiple diagrams with a connecting narrative.

### General formatting

- Use tables for structured comparisons
- Use relative links when referencing other docs (e.g., `[design](alternatives/pragmatic-minimalist/design.md)`)

## Quality Checklist (Before Finalizing)

Before writing decision-map.md, verify:

- [ ] Executive Summary recommends one design, explains why, mentions runner-up
- [ ] Convergences table has >5 rows, each shows agent agreement count
- [ ] Each mermaid diagram has one decision question per block (no multi-decision clusters)
- [ ] All mermaid diagrams use `flowchart LR` (not TD)
- [ ] All nodes are concrete — no "TBD" in any diagram
- [ ] Labels are 2-3 lines max; details in bullets below the diagram
- [ ] Decision summary table references all 12 evaluation criteria
- [ ] Open questions each have an owner and note what they block
- [ ] Red team warnings list top 3-5 cross-cutting risks
- [ ] All 6 designs are referenced at least once

If any checkbox fails, fix before writing the file.

## Important constraints

- Build from scratch — do NOT read files in `design/archive/`
- Only reference Phase 2 designs and Phase 3 evaluations as listed above
- Do NOT modify any other files
- Extract decisions from what the agents actually proposed — do not invent decisions that no agent addressed
