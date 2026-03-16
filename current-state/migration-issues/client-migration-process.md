# Migration Issue: Client Migration Process

This topic emerged from the 2026-03-12 meeting between Soso and Shauly. It was not previously documented as a standalone migration issue but was identified as "the first thing we'll face" during the transition.

---

## Problem Statement

When migrating from the current TC multi-service architecture to 12go as the core platform, each B2B client will need to make changes on their side. There is no defined process for what a client migration looks like — what changes they must make, in what order, and what the cutover mechanism is.

Shauly: "we need to see what does it mean to migrate a client."

---

## What Changes Might Each Client Face?

Based on the migration issues discussed, a client migration could involve some or all of the following:

### 1. API Key Change
- **Current**: Clients use a TC-issued `x-api-key` header
- **Post-migration**: Clients may need to switch to a 12go API key (Approach B — Shauly's preferred "easy solution"), or TC maintains a transparent mapping (Approach A)
- **Impact**: If Approach B, every client must update their API key configuration
- See: [api-key-transition.md](api-key-transition.md)

### 2. Base URL Change
- Clients currently call TC endpoints (e.g., `/v{version}/{client_id}/...`)
- Post-migration endpoints may have different base URLs
- **Impact**: Every client must update their integration endpoint configuration

### 3. Booking ID Format Change
- **New bookings**: Will use 12go booking IDs (integer `bid`) instead of TC's encrypted KLV or short format
- **Existing bookings**: Clients with in-flight bookings will still hold old TC booking IDs that need to work through the transition period
- **Impact**: Clients may need to handle a new booking ID format
- See: [booking-id-transition.md](booking-id-transition.md)

### 4. Station/Operator ID Changes
- Clients with hardcoded Fuji CMS IDs may face breaking changes if 12go doesn't accept those IDs
- **Impact**: Depends on whether a translation layer is maintained
- See: [station-id-mapping.md](station-id-mapping.md)

---

## Open Questions

1. **Can we migrate clients one at a time**, or must it be a big-bang cutover?
2. **What is the minimum viable change** a client needs to make? (Just API key? Or full endpoint migration?)
3. **How do we handle the transition period** where some clients are on the old system and some on the new?
4. **Who communicates with clients** about required changes? What is the timeline per client?
5. **Which clients cooperate quickly** and which will take time? (Shauly noted: "you have like 40 clients, they will need to do some changes, each one of them it will take time, some of them cooperate immediately, some will take time")

---

## Next Steps (from meeting)

1. Create a flow diagram for a specific API call (e.g., search) to walk through the full client experience and identify additional issues
2. Define the step-by-step client migration process
3. Determine what each client will need to change
4. Follow-up discussion: Monday/Tuesday 2026-03-16/17
