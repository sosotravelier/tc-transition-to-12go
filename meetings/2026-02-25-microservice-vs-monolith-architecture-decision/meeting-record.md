---

## status: complete
last_updated: 2026-03-02

# Meeting Record: B2B Transition Architecture Decision

**Date** | Feb 25, 2026  
**Duration** | ~63 minutes  
**Participants** | Soso (TC), Team Lead (Main HQ), RnD (Main HQ), Architect (Main HQ), Oleksandr (12go veteran developer)  
**Purpose** | Decide on monolith vs microservice architecture and language for B2B API layer

---

## Decisions Made

**None.** The architecture decision was explicitly deferred pending a Proof of Concept. The group agreed that more evidence was needed before committing.

---

## Action Items


| Owner           | Action                                                                                 |
| --------------- | -------------------------------------------------------------------------------------- |
| Soso            | Implement **Search** endpoint inside F3 as POC to evaluate friction and complexity     |
| Team Lead / RnD | Review Soso's detailed breakdown and all evaluation revisions                          |
| RnD             | Send list of event requirements from data side (what must be preserved for ClickHouse) |
| All             | Revisit architecture decision after POC and research review                            |


**POC scope**: Search was chosen (Soso proposed Search; Team Lead proposed GetItinerary; settled on Search first).

---

## Key Concerns Raised by Each Party

### Soso (TC)

- Microservice provides decoupling, failure isolation, and team ownership of B2B domain
- Evaluation criteria (v1, v2, v3) consistently favored microservice even when coefficients were adjusted to favor monolith
- If F3 is broken into microservices, a separate B2B microservice survives with a config change; code inside F3 requires a second migration
- KOA precedent: anti-corruption layer microservice already exists

### RnD (Main HQ)

- For a JSON transformer layer, a separate microservice adds operational overhead without real decoupling — "coupled anyway"
- Any new feature would require updates to both F3 and the microservice ("two deployments")
- F3 breakdown is planned but at "beginning of the beginning" — no timeline, no target language
- Microservice motivation appears to be "not writing in PHP" rather than architectural necessity
- F3 has built-in versioning, tracing, monitoring — microservice would need to wire these explicitly
- Scaling argument weak: every request to microservice also hits F3; 1:1 coupling

### Team Lead (Main HQ)

- Need to think long-term: "one system," not a layer on top of F3
- Wants to do POC inside F3 first to "see how complex the beast is"
- Research was "amazing and well-done" — decision needs examination from all angles
- Will collaborate to find the right solution; wants Soso to agree with the final decision

### Oleksandr (12go)

- Microservices are good when needed; not good when they add support cost without benefit
- Fastest path: add B2B API version to F3 (estimated ~2 weeks)
- If goal is speed and cost: implement in F3. If goal is flexibility: microservice is viable
- Each approach has pros and cons; no silver bullet

---

## Post-Meeting Clarification (from RnD)

- **.NET microservice is still an option** — not ruled out
- **F3 redesign is not this quarter** — they are thinking about how to redesign F3, but it is not in the current quarter's scope

---

## Topics Requiring Follow-Up

1. **Event/data correlation** — Define B2B-specific events that must be preserved or created for ClickHouse. Data team to provide requirements.
2. **ID manipulation/encryption** — Deep dive on booking ID encoding, itinerary ID handling, and what TC-specific features need to be preserved or adapted in 12go.
3. **F3 breakdown timeline** — No plan exists yet. When it happens, what happens to B2B code written inside F3 today?

---

## References

- [Meeting Brief](meeting-brief.md)
- [Transcript](transcript.txt)
- [Meeting Notes](meeting-notes.txt)

