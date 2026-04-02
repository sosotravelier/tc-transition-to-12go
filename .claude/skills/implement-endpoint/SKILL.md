---
name: implement-endpoint
description: End-to-end workflow for implementing a B2B transition endpoint — loads context, brainstorms approach, executes with TDD, and updates project state
---

# Implement Endpoint

Workflow for porting a .NET endpoint to PHP in the F3 codebase. Combines project context loading with Superpowers' TDD and brainstorming patterns.

## Prerequisites

- `project-context.md` exists and is current (< 7 days old)
- Endpoint doc exists in `current-state/endpoints/`
- F3 repo is available locally

## Phase 1: Load Context

1. Read `project-context.md` from transition-design repo
2. Read the specific endpoint doc from `current-state/endpoints/<endpoint-name>.md`
3. Read `prompts/context/codebase-analysis.md` for .NET patterns and mapping
4. If endpoint has cross-cutting concerns, read relevant docs from `current-state/cross-cutting/`

## Phase 2: Brainstorm Approach

Use `superpowers:brainstorming` skill adapted for endpoint work:

1. **Understand the endpoint** — what does it do, what are the inputs/outputs, what business logic is involved?
2. **Identify unknowns** — what parts of the .NET logic are unclear? What F3 patterns should this follow?
3. **Propose approach** — how to structure the PHP implementation. Consider:
   - Which existing F3 patterns to follow (controllers, services, repositories)
   - Data mapping between .NET models and PHP
   - Authentication/authorization requirements
   - Response format compatibility (must match existing .NET responses)
4. **Get approval** before proceeding to implementation

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

## Phase 4: Execute with TDD

Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`:

1. Set up git worktree in F3 repo (use `superpowers:using-git-worktrees`)
2. Execute plan task by task
3. Each task uses `superpowers:test-driven-development`
4. If bugs encountered, use `superpowers:systematic-debugging`
5. Before claiming any task done, use `superpowers:verification-before-completion`

## Phase 5: Update Project State

After endpoint is complete:

1. Run `/update-project-context milestone <endpoint-name>` in transition-design repo
2. Update the endpoint status in `project-context.md`
3. If any design decisions were made during implementation, log them

## Endpoint Checklist

- [ ] Context loaded (project-context + endpoint doc + codebase-analysis)
- [ ] Approach brainstormed and approved
- [ ] Implementation plan written with TDD steps
- [ ] All tests passing (RED-GREEN-REFACTOR verified for each)
- [ ] Response format matches .NET endpoint exactly
- [ ] Authentication/authorization working
- [ ] Error handling matches expected behavior
- [ ] Project context updated with completion status
