---
name: process-transcript
description: Extract decisions, action items, and key quotes from a meeting transcript and produce a structured meeting record
---

# Process Transcript

Read a meeting transcript, extract structured information, and produce a meeting record plus draft updates for the Decision Log and system context.

The user invokes this with a date or full folder name:

```
/process-transcript 2026-03-18
/process-transcript 2026-03-18-team-lead-sync
```

## Step 1: Find the Meeting Folder

The args string is: `$ARGS`

Search the `meetings/` directory for a matching folder.

```bash
cd /Users/sosotughushi/RiderProjects/transition-design
ls -d meetings/${ARGS}* 2>/dev/null
```

**If exactly one match**: use it.
**If multiple matches**: list them and ask the user to pick one.
**If no match**: tell the user no meeting folder was found for that input and stop.

Store the matched folder path for subsequent steps.

## Step 2: Read Name Corrections

Read the name corrections memory file to ensure correct spellings in the output:

```
~/.claude/projects/-Users-sosotughushi-RiderProjects-transition-design/memory/feedback_name_corrections.md
```

If it does not exist, skip this step. If it does exist, use the corrections when writing names throughout all outputs. Transcript software frequently garbles names (e.g., "want to go" = 12go, "Jericho" = Jerko, "Zana" = Sana). Fix all occurrences.

## Step 3: Read the Transcript

Look for a `.txt` file in the meeting folder:

```bash
cd /Users/sosotughushi/RiderProjects/transition-design
ls meetings/<folder>/*.txt
```

If no `.txt` file exists, tell the user: "No transcript found in `meetings/<folder>/`. Place a `.txt` transcript file in the folder and re-run." Then stop.

Read the full transcript file.

## Step 4: Read Existing Context

Read these files if they exist (skip any that are missing — do not fail):

1. **Meeting brief** — `meetings/<folder>/meeting-brief.md` — provides context on what the meeting was about
2. **Meeting questions** — `meetings/<folder>/meeting-questions.md` — pre-prepared questions, useful to check which ones were answered
3. **Previous meeting record** — find the most recent meeting folder before this one (by date), and read its `meeting-record.md` if it exists. This provides continuity.
4. **Decision Log** — the `## Decision Log` section in `AGENTS.md` — to know what decisions are already recorded
5. **System context** — `prompts/context/system-context.md` — to know what meeting outcomes are already recorded

## Step 5: Extract Information from the Transcript

Analyze the transcript and extract:

### Decisions Made
Concrete decisions where someone committed to a direction. For each:
- What was decided
- Who decided (use correct name spellings)
- Brief context/rationale

### Action Items
Tasks assigned during the meeting. For each:
- Owner (who)
- What they need to do
- Deadline (if mentioned, otherwise "TBD")

### Key Quotes
Verbatim quotes worth preserving — statements that capture important positions, constraints, or commitments. Include the speaker name and clean up obvious transcription artifacts (filler words, false starts) while keeping the substance intact. Aim for 3-8 quotes that would be useful in future documents or presentations.

### Open Questions
Questions raised but not answered. For each:
- The question
- Who needs to answer it
- What it blocks (if anything)

### Topics Discussed but Not Resolved
Broader topics that were discussed but where no clear decision or action was taken. These are candidates for follow-up in the next meeting.

## Step 6: Write meeting-record.md

Write `meetings/<folder>/meeting-record.md` with this structure:

```markdown
---
status: complete
last_updated: YYYY-MM-DD
---

# Meeting Record: [Title derived from folder name or brief]

**Date** | [Full date, e.g., Mar 18, 2026]
**Participants** | [Names extracted from transcript, correctly spelled]
**Purpose** | [From the meeting brief if available, otherwise inferred from transcript]

---

## Key Topics

### 1. [Topic Title]

- [Bullet points summarizing the discussion]
- [Include who said what when it matters for context]

### 2. [Topic Title]

- ...

[Continue for all major topics discussed]

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 | [Decision] | [Name] |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| [Name] | [Action] | [Date or TBD] |

---

## Key Quotes

> "[Quote]" — [Speaker]

> "[Quote]" — [Speaker]

---

## Open Questions (Carried Forward)

- [Question] — needs answer from [who], blocks [what]
```

If a `meeting-record.md` already exists in the folder, warn the user and ask before overwriting.

Use the `last_updated` date from the meeting date (from the folder name), not today's date.

## Step 7: Draft Decision Log Additions

Draft new rows for the `AGENTS.md` Decision Log table. Only include decisions that are NOT already in the existing Decision Log (checked in Step 4).

Present the draft to the user in this format:

```
=== Draft: Decision Log additions (AGENTS.md) ===

These rows would be appended to the Decision Log table:

| Date | Decision | Rationale |
|------|----------|-----------|
| YYYY-MM-DD | [Decision] | [Brief rationale from transcript] |
| YYYY-MM-DD | [Decision] | [Brief rationale from transcript] |

Shall I append these to AGENTS.md? (y/n)
```

**Do NOT write to AGENTS.md until the user approves.** If approved, append the rows to the existing table — do not overwrite or reformat existing rows.

## Step 8: Draft System Context Updates

Draft a new `## Meeting Outcomes (YYYY-MM-DD)` section for `prompts/context/system-context.md`. Follow the existing format in that file — each meeting outcome is a bullet starting with bold topic, then details.

Present the draft to the user:

```
=== Draft: System context update (prompts/context/system-context.md) ===

This section would be added after the last "## Meeting Outcomes" block:

## Meeting Outcomes (YYYY-MM-DD)

[Title or description of the meeting]:

- **[Topic]** — [What was decided/learned, in 1-2 sentences]
- **[Topic]** — [What was decided/learned]
- ...

Shall I add this to system-context.md? (y/n)
```

**Do NOT write to system-context.md until the user approves.** If approved, insert the new section after the last `## Meeting Outcomes (...)` block and before the next `##` section (typically `## Development Workflow Constraints` or similar).

## Step 9: Report

After all steps complete, print a summary:

```
Transcript processed: meetings/<folder>/

Written:
  meetings/<folder>/meeting-record.md

Pending approval:
  AGENTS.md Decision Log     — [N] new rows drafted
  system-context.md          — meeting outcomes section drafted

Review the meeting record and let me know if you'd like any changes.
```

## Important Notes

- **Name spellings**: Always apply the corrections from the memory file. The transcript software produces garbled names — this is expected. Common substitutions: "want to go" / "one to go" = 12go, "Jericho" = Jerko, "Zana" = Sana, "Eran" = Eliran. Check the memory file for the current list.
- **Do not leak personal information**: Never include personal plans, resignation references, or anything from the `personal_resignation_plan.md` memory file in any output.
- **Use unified team language**: Do not distinguish between "12go team" and "us" — use "we" / "the team" consistently.
- **Keep quotes clean but honest**: Remove filler words and false starts, but do not change the meaning. If someone said something important in rough language, preserve the substance.
- **Transcript timestamps**: The transcript may include timestamps (e.g., `00:05:12`). Use them to verify chronological order of topics but do not include them in the meeting record.
- **Meeting brief as guide**: If a meeting brief or questions document exists, use it as a lens — check which planned topics were actually discussed and which were skipped. Note skipped topics in the "Open Questions" section.
- **Do not create files outside the meeting folder** except for the approved edits to `AGENTS.md` and `system-context.md`.
