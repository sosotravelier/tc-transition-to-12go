---
name: implement-endpoint
description: End-to-end workflow for implementing a B2B transition endpoint — loads context, explores F3 patterns, brainstorms approach, executes with TDD, and updates project state
---

# Implement Endpoint

Workflow for porting a .NET endpoint to PHP in the F3 codebase. Combines project context loading with research, Superpowers' TDD, and brainstorming patterns.

## Prerequisites

- `project-context.md` exists and is current (< 7 days old)
- Endpoint doc exists in `current-state/endpoints/`
- F3 repo is available locally

## Phase 1: Load Context

1. Read `project-context.md` from transition-design repo
2. Read the specific endpoint doc from `current-state/endpoints/<endpoint-name>.md`
3. Read `prompts/context/codebase-analysis.md` for .NET patterns and mapping
4. If endpoint has cross-cutting concerns, read relevant docs from `current-state/cross-cutting/`

## Phase 1.5: Explore F3 Patterns

Before brainstorming, understand how F3 does things. This prevents inventing new patterns when existing ones exist.

**Search F3 for similar endpoints:**
- Find existing controllers that handle similar operations (auth, validation, response formatting)
- Identify the standard patterns: how do routes, controllers, services, and repositories connect?
- Note any existing middleware, helpers, or base classes you should extend

**Assess what's unfamiliar:**

| Situation | Research Depth |
|---|---|
| F3 has existing similar endpoints to follow | Light — read the example, note the patterns, move on |
| First endpoint of this type in F3 (no prior examples) | Medium — search F3 more broadly, check PHP testing patterns |
| Endpoint uses unfamiliar PHP libraries/tools | Heavy — verify current best practices via Context7 or web search |
| Simple CRUD with clear F3 examples | Minimal — just confirm the pattern and proceed |

**Output:** 3-5 bullet "patterns to follow" list. Not a full research doc — just enough to inform the brainstorm:
- Controller pattern: `[which existing controller to model after]`
- Service layer: `[how existing services handle business logic]`
- Testing: `[test framework used, example test file to follow]`
- Auth/validation: `[existing middleware or pattern]`
- Response format: `[how existing endpoints format responses]`

<HARD-GATE>
Do NOT proceed to Phase 2 until you have explored F3 patterns. Implementing without understanding the target codebase wastes time on approaches that don't fit.
</HARD-GATE>

## Phase 2: Brainstorm Approach

Use `superpowers:brainstorming` skill adapted for endpoint work:

1. **Understand the endpoint** — what does it do, what are the inputs/outputs, what business logic is involved?
2. **Identify unknowns** — what parts of the .NET logic are unclear? What F3 patterns should this follow?
3. **Propose approach** — how to structure the PHP implementation. Consider:
   - Which existing F3 patterns to follow (from Phase 1.5 research)
   - Data mapping between .NET models and PHP
   - Authentication/authorization requirements
   - Response format compatibility (must match existing .NET responses)
4. **Get approval** before proceeding to implementation

<HARD-GATE>
Do NOT proceed to Phase 3 until the approach is approved by the user. Implementation without approval is waste.
</HARD-GATE>

## Phase 3: Write Implementation Plan

Use `superpowers:writing-plans` skill:

1. Break the endpoint into bite-sized tasks (2-5 min each)
2. Each task follows RED-GREEN-REFACTOR:
   - Write failing test
   - Verify it fails
   - Write minimal code to pass
   - Verify it passes
   - Refactor if needed
   - Commit
3. Include exact file paths in F3 repo
4. Include exact test commands
5. Self-review the plan: check spec coverage, no placeholders, type consistency

## Phase 4: Execute with TDD

Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`:

1. Set up git worktree in F3 repo (use `superpowers:using-git-worktrees`)
2. Execute plan task by task
3. Each task uses `superpowers:test-driven-development`
4. If bugs encountered, use `superpowers:systematic-debugging`
5. Before claiming any task done, use `superpowers:verification-before-completion`

## Phase 5: Verify and Update

<HARD-GATE>
Do NOT claim the endpoint is complete until ALL verification passes.
</HARD-GATE>

**Verify the endpoint works:**

- [ ] All tests passing (RED-GREEN-REFACTOR verified for each)
- [ ] Response format matches .NET endpoint exactly (compare field names, types, structure)
- [ ] Authentication/authorization gates work (test: unauthenticated, authenticated, wrong role)
- [ ] Error handling matches expected behavior (test 3-5 error cases)
- [ ] `git diff` shows ONLY intended changes (no accidental modifications to unrelated files)

**Update project state:**

1. Run `/update-project-context milestone <endpoint-name>` in transition-design repo
2. Verify endpoint status updated in `project-context.md`
3. If any design decisions were made during implementation, log them in section 4

## When to STOP and Ask

STOP implementation and ask for help if:

| Situation | Why |
|---|---|
| Endpoint behavior doesn't match .NET docs | May indicate stale/incorrect endpoint doc |
| F3 test environment isn't working | Can't verify anything without running tests |
| Auth/authorization logic is unclear | Security bugs are the worst kind |
| Response format has fields not in the endpoint doc | Missing documentation — need to check .NET source |
| 3+ failed fix attempts on the same issue | Likely architectural, not a bug — use `superpowers:systematic-debugging` Phase 4.5 |

Do NOT push through blockers. Each one risks compounding into larger problems.

## Endpoint Checklist

- [ ] Context loaded (project-context + endpoint doc + codebase-analysis)
- [ ] F3 patterns explored (Phase 1.5 — know which patterns to follow)
- [ ] Approach brainstormed and approved by user
- [ ] Implementation plan written with TDD steps
- [ ] All tests passing (RED-GREEN-REFACTOR verified for each)
- [ ] Response format matches .NET endpoint exactly
- [ ] Authentication/authorization working
- [ ] Error handling matches expected behavior
- [ ] Git diff shows only intended changes
- [ ] Project context updated with completion status
