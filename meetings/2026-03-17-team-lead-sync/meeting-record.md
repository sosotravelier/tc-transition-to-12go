---

## status: complete

last_updated: 2026-03-17

# Meeting Record: Team Lead Sync — Transition Planning & Resourcing

**Date** | Mar 17, 2026
**Participants** | Soso (TC), Team Lead
**Purpose** | Align on transition approach, timeline, resourcing, and microservice vs monolith decision

---

## Key Topics

### 1. F3 Big Refactoring Planned (Q2 Planning)

- A major refactoring of 12go F3 is planned, but planning starts in Q2 — scope and target language are still unclear.
- Team Lead argues this is a reason **against** a separate .NET microservice: if F3 gets disassembled, it's easier to have everything together (including new B2B endpoints) rather than having to migrate a separate .NET service later.
- Team Lead also argues it's easier to refactor when everything is together — you can see what shouldn't break, whereas with a separate microservice it's harder to analyze dependencies and define contracts.
- **Soso's counter-argument**: rewriting from .NET to PHP, then from PHP to something else, is wasteful. A .NET microservice could potentially be kept or adapted more easily.

### 2. Additional Capabilities Needed in F3 (Cancellation Policies, etc.)

- We will need to expose more details about cancellation policies through F3, and more such needs are expected.
- Team Lead argues that doing it in F3 directly is a **pro for monolith**: changes happen in 1 place rather than in F3 + a separate microservice.

### 3. F3 Local Development Issues

- Search POC revealed that working with F3 locally is not straightforward — migration issues, setup problems (see search POC results docs).
- Soso argued that a .NET microservice would be more straightforward to develop against.
- Team Lead countered: even with .NET, we'd still need to run 12go locally for integration testing.
- Soso's rebuttal: we could treat 12go as a **black box** and call their API the same way the existing .NET service does. However, if we need to add new F3 capabilities, we'd still need to spin it up locally.

### 4. How Temporary Is the Transition Design?

- Soso asked whether we can take shortcuts given future refactoring.
- Team Lead's answer: **the transition design will live for a significant time**. After transition, new clients onboard on the new system, and old clients migrate gradually. The refactoring will likely be incremental, not a big-bang rewrite.
- **Implication**: we cannot treat this as throwaway — the design needs to be reasonably solid.

### 5. Performance Testing

- We will likely need performance tests on the new system to validate latency and throughput.
- Open question: whether to test the new system or wait for the refactored one.

---

## Timeline & Deliverables

- Team Lead needs to commit to Q2 deliverables.
- He asked if it's reasonable to assume new clients can onboard on the new system in Q2. Soso said **most likely yes**.
- Architecture decision (monolith vs microservice) needs to be made **as soon as possible**.
- Q2 commitment is required, but the exact scope and options remain unknown.
- Soso will feed new information into design agents and produce design proposals, then sync with Team Lead **tomorrow evening (Mar 18)**.

---

## Resourcing — Critical Discussion

- Team Lead revealed that **Soso will be the only developer** working on this transition.
- Soso expected 4 .NET developers and pushed back strongly.
- Soso identified the following risks and concerns:
  - **Monitoring/metrics discovery** — exploration work needed to understand what metrics to keep, 12go's monitoring capabilities vs ours. Soso does not want to own this.
  - **gRPC module** — considered risky, Soso wants to offload it. Team Lead said it **could be scoped out**.
  - **Booking notification** — different topology than other endpoints, Soso would prefer to offload this too.
  - **Testing** — Soso proposed a "conveyor belt" approach (new endpoint every ~2 days) but this requires a **dedicated QA** following along to be feasible.
  - **AI-assisted development** — Soso plans to heavily use Claude Code, multi-agent workflows, and modern AI techniques to automate and parallelize work.
- Team Lead is **open to altering the plan** and adding people, but is leaning toward Soso doing it solo.

---

## Action Items


| Owner     | Action                                                                                 |
| --------- | -------------------------------------------------------------------------------------- |
| Soso      | Run design agents with new constraints and produce updated proposals by Mar 18 evening |
| Soso      | Push for architecture decision (monolith vs microservice) in Mar 18 sync               |
| Team Lead | Consider adding resources to the transition (QA, monitoring, gRPC)                     |
| Both      | Align on Q2 deliverable commitments                                                    |


