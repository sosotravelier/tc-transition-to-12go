---
name: update-project-context
description: Update the project context document with new information from a meeting record, implementation milestone, or weekly review
---

# Update Project Context

Update `project-context.md` with new information while preserving its compact structure.

The user invokes this with a source type and optional path:

```
/update-project-context meeting 2026-04-01
/update-project-context milestone search
/update-project-context review
```

Args: `$ARGS`

## Step 1: Parse Arguments

Parse `$ARGS` to determine the update type:

- **`meeting <date-or-folder>`** — Update from a meeting record
- **`milestone <endpoint-name>`** — Update after an implementation milestone
- **`review`** — Weekly staleness review

If no args provided, ask the user what type of update they want.

## Step 2: Read Current Project Context

Read `project-context.md` from the repo root. Note the current `Last Updated` and `Last Verified` dates.

## Step 3: Read Source Document

### For `meeting`:
Find the meeting folder in `meetings/` matching the date/name. Read `meeting-record.md` from that folder. If no meeting-record.md exists, tell the user to run `/process-transcript` first.

### For `milestone`:
Read the relevant endpoint doc from `design/implementation/<endpoint>/status.md` or ask the user what changed.

### For `review`:
No source document needed. Review the project context for staleness.

<HARD-GATE>
Do NOT propose changes until you have:
1. Read the current project-context.md completely
2. Read the source document completely
3. Compared them for all 8 change types below

Incomplete analysis = incorrect updates.
</HARD-GATE>

## Step 4: Identify Changes

Compare the source document against the current project context. Identify:

1. **New decisions** → add to section 4 (Decided)
2. **Changed constraints** → update section 5
3. **Resolved open questions** → remove from section 6, optionally add to section 4
4. **New open questions** → add to section 6
5. **Endpoint status changes** → update section 3 table
6. **People/ownership changes** → update section 7
7. **Implementation sequence changes** → update section 8
8. **New action items or blockers** → update section 8 if they affect sequence

## Step 5: Challenge Assumptions

Before proposing changes, scan the **current** project-context.md for statements that may be stated too definitively given the new information. Look for:

1. **"Decided" items that are actually still evolving** — e.g., scope that's being renegotiated, sequences that depend on unresolved ownership, persistence decisions that have edge cases
2. **Constraints stated as absolute that have known exceptions** — e.g., "no local DB" when notifications or migration may need one
3. **Missing nuance from the new source** — e.g., a meeting explored an alternative that softens a previous "resolved" decision

For each assumption you'd challenge, add it to your proposed changes as either:
- A **softening edit** (e.g., "No local persistence" → "Default stateless; persistence TBD for migration/notifications")
- A **new open question** (e.g., "Existing TC as first client? Would change backward-compat timeline")
- A **note on a decision** (e.g., append "— under discussion" or "— may evolve")

The goal is to prevent the project context from becoming a false source of certainty. Decisions that are genuinely settled should read as settled. Decisions that are still in flux should read as in flux.

## Step 6: Propose Changes

Show the user a summary of proposed changes as a diff-like list:

```
Proposed updates to project-context.md:

SECTION 3 (Endpoint Status):
  - Search: "POC complete" → "Merged to F3, feature flag off"

SECTION 4 (Decided):
  + 2026-04-01: [new decision] — [who decided]

SECTION 6 (Open Questions):
  - Removed: #3 (resolved in meeting)
  + Added: [new question] — [owner]
```

Ask the user to confirm before applying.

## Step 7: Apply Changes

Edit `project-context.md` with the confirmed changes. Update the `Last Updated` date to today. For `review` type, also update `Last Verified`.

## Step 8: Size Check

After editing, count words. If project-context.md exceeds 1,500 words (~6K tokens), warn the user that compression may be needed. The target is 800-1,500 words.

## Step 9: Git Verification

Before committing, run `git diff project-context.md` and confirm:

- [ ] ONLY project-context.md changed (no accidental edits to other files)
- [ ] Changes match the approved diff from Step 6
- [ ] No unintended sections modified
- [ ] Word count still 800-1,500 words (`wc -w project-context.md`)

## When NOT to Update

Do NOT use this skill when:
- A decision is contradicted but not resolved (e.g., "We said X, but maybe Y?") → Add to Open Questions instead
- Scope is actively negotiating in real-time → Wait for clarity, then update
- Information is speculative or unconfirmed → Only update with concrete decisions

## Quality Rules

- **Never expand prose** — the project context must stay compact. One line per decision, one row per endpoint.
- **Decisions need attribution** — always include who decided and the date.
- **Open questions must have owners** — if no owner, flag it.
- **Don't duplicate reference docs** — point to them, don't inline their content.
- **Preserve the 9-section structure** — don't add new sections.
