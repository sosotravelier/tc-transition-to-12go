---
name: prep-meeting
description: Scaffold a meeting folder with brief, transcript placeholder, and record template pre-populated with project context
---

# Prepare Meeting

Scaffold a new meeting folder with a pre-populated meeting brief, empty transcript, and meeting record template.

The user invokes this with free-text arguments describing the meeting, e.g.:

```
/prep-meeting Meeting with Shauly next Wednesday about API key transition
/prep-meeting Sync with Sana and Eyal on March 30 — booking ID encryption decision
/prep-meeting Team lead sync tomorrow to discuss QA resourcing
```

## Step 1: Parse the User Input

The args string is: `$ARGS`

Extract the following from the free-text input:

- **Participants**: Names of people mentioned (e.g., "Shauly", "Sana and Eyal", "team lead"). If no names are found, leave as TBD.
- **Date**: Resolve any relative date expression to an absolute date. Today is the current date. Examples:
  - "next Wednesday" = the Wednesday of the following week
  - "tomorrow" = the day after today
  - "March 30" = 2026-03-30
  - If no date is mentioned, ask the user before proceeding.
- **Topic/Purpose**: The subject of the meeting — everything that describes what the meeting is about.
- **Slug**: Derive a kebab-case slug from the topic, maximum 4 words (e.g., "api-key-transition", "booking-id-encryption", "qa-resourcing-sync").

The meeting directory will be: `meetings/YYYY-MM-DD-slug/`

Before creating any files, print the parsed values and the directory name so the user can confirm:

```
Parsed meeting details:
  Date:         2026-03-25
  Participants: Shauly
  Topic:        API key transition
  Directory:    meetings/2026-03-25-api-key-transition/
```

If anything looks wrong, ask the user to correct it. Otherwise proceed.

## Step 2: Read Project Context

Read the following files to gather current project state for the meeting brief. If a file does not exist, skip it — do not fail.

1. `design/decision-map.md` — for open questions and current decision state
2. `design/recommendation.md` — for the current recommended approach
3. `AGENTS.md` — scroll to the **Decision Log** section for recent decisions

Also identify the most recent meeting record by looking at the `meetings/` directory, finding the folder with the latest date, and reading any `meeting-record.md` or equivalent file inside it. This provides continuity between meetings.

## Step 3: Create Meeting Directory

```bash
cd /Users/sosotughushi/RiderProjects/transition-design
mkdir -p meetings/YYYY-MM-DD-slug
```

Replace `YYYY-MM-DD-slug` with the actual values from Step 1.

## Step 4: Create meeting-brief.md

Write `meetings/YYYY-MM-DD-slug/meeting-brief.md` with the following structure:

```markdown
# [Title derived from topic]

**Meeting** | [Full date, e.g., Mar 25, 2026] | ~30 min
**Presenter** | Soso
**Audience** | [Participants from Step 1]

---

## Purpose

[1-2 sentences describing the meeting goal, derived from the user's topic input.]

---

## Current Project Status

[Summarize from the files read in Step 2. Include:]
- Current recommended architecture approach (from recommendation.md)
- Key recent decisions (from AGENTS.md Decision Log)
- What happened in the last meeting (from the most recent meeting record)

## Open Questions for Discussion

[Extract open/unresolved questions from decision-map.md that are relevant to this meeting's topic. Format as a numbered list. If none are relevant, note that and suggest the user add agenda items.]

## Agenda

1. [Derive from topic — the main subject]
2. Open questions (listed above)
3. Decisions needed (if any)
4. Action items and next steps

---

## Decisions Needed

| # | Decision | Who Decides |
|---|----------|-------------|
| 1 | [Fill if obvious from topic, otherwise leave as placeholder] | TBD |

---

## Prior Context

[Links to relevant prior meetings using relative paths, e.g.:]
- [Previous meeting title](../YYYY-MM-DD-slug/meeting-record.md)
```

Adapt the content based on what was actually found in Step 2. Do not include sections that have no content — for example, if `decision-map.md` does not exist, omit the "Open Questions for Discussion" section rather than leaving it empty.

## Step 5: Create transcript.txt

Write an empty `meetings/YYYY-MM-DD-slug/transcript.txt` file. This is a placeholder for the meeting transcript to be added later.

## Step 6: Create meeting-record.md

Write `meetings/YYYY-MM-DD-slug/meeting-record.md` with the standard template headers, ready to be filled in after the meeting:

```markdown
---
status: draft
last_updated: YYYY-MM-DD
---

# Meeting Record: [Title]

**Date** | [Full date]
**Participants** | [Participants]
**Purpose** | [Purpose from brief]

---

## Key Topics

### 1. [Topic placeholder]

-

---

## Decisions Made

| # | Decision | Decided By |
|---|----------|------------|
| 1 |          |            |

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
|       |        |     |

---

## Open Questions (Carried Forward)

-
```

## Step 7: Report

Print a summary of what was created:

```
Meeting prep complete:
  meetings/YYYY-MM-DD-slug/
    meeting-brief.md    — pre-populated with project context
    transcript.txt      — empty placeholder
    meeting-record.md   — template ready for post-meeting notes

Next steps:
  1. Review and edit the meeting brief
  2. After the meeting, paste the transcript into transcript.txt
  3. Use /process-transcript to generate the meeting record (if available)
```

## Important Notes

- Use the existing meeting folder naming convention: `YYYY-MM-DD-slug` with kebab-case slug, max 4 words.
- The presenter is always "Soso" unless the user says otherwise.
- Default meeting duration is 30 minutes. If the user specifies a duration, use that instead.
- Do NOT hardcode project context into the brief — always read it fresh from the files listed in Step 2.
- Do NOT create any files outside the meeting directory.
- If the meeting directory already exists, warn the user and ask before overwriting.
