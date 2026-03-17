---
paths:
  - "design/**"
  - ".claude/skills/**"
  - ".claude/agents/**"
---

# Design File Structure

All design artifacts follow a canonical folder structure. Skills and agents MUST use these paths.

## Current Working Set

The active iteration lives directly under `design/`:

```
design/
  alternatives/                    # Phase 2 — one subfolder per design agent
    pragmatic-minimalist/design.md
    platform-engineer/design.md
    data-flow-architect/design.md
    team-first-developer/design.md
    disposable-architecture/design.md
    clean-slate-designer/design.md
  analysis/                        # Phase 3 — one file per analyzer agent
    red-team.md
    execution-realist.md
    ai-friendliness.md
    technical-merit.md
  evaluation-criteria.md           # scoring rubric
  decision-map.md                  # synthesized decision tree
  comparison-matrix.md             # weighted scores
  recommendation.md                # final recommendation
```

## Archive

Completed iterations are archived with the same internal structure:

```
design/archive/v{N}/
  alternatives/
  analysis/
  evaluation-criteria.md
  decision-map.md
  comparison-matrix.md
  recommendation.md
```

## Rules

- **Current paths have no version prefix** — always `design/alternatives/`, `design/analysis/`, etc.
- **Archive on new iteration** — before regenerating, move the current set to `design/archive/v{N}/` where N is the next sequential version number.
- **Version numbers are sequential integers** — v1, v2, v3, etc.
- **Same structure everywhere** — archive folders mirror the current working set exactly.
- **No date-based archive folders** — use version numbers only. If a date is relevant, record it in the archived files' frontmatter.
