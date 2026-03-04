---
status: draft
last_updated: 2026-03-02
---

# F3 Demolition Compatibility

## Context

The 2026-02-25 meeting revealed that **F3 will be broken into microservices eventually**. The plan is at "the beginning of the beginning" — no timeline, no target language, estimated "a couple of quarters." This raises a criterion that was not explicitly scored in v1, v2, or v3:

**How well does each architecture option survive F3 being broken apart?**

---

## The Criterion: F3 Demolition Compatibility

| Score | Meaning | Example |
|-------|---------|---------|
| **5** | Code survives F3 breakdown with minimal change | Only configuration or API target changes |
| **4** | Minor refactoring required | Update import paths, swap in-process calls for HTTP |
| **3** | Moderate migration effort | Significant code moves, new service boundaries |
| **2** | Major refactoring | Rewrite of integration points |
| **1** | Code must be migrated/split from scratch | Effectively a second migration |

---

## Scoring by Option

### Option A: Monolith (B2B code inside F3)

**Score: 1–2**

When F3 is broken into microservices:

- B2B Search controller calls `SearchService`, `SearchFilterBuilder`, `TripPoolRepository` **in-process**
- If search logic is extracted to a new "Search Service" microservice, the B2B controller must be updated to call it via HTTP instead
- The B2B controller itself may need to move — does it stay in the "B2C API" service or move to a new "B2B API" service?
- **Result**: B2B code written today requires a second migration. It is tied to F3's internal structure. When F3 changes, B2B code changes.

### Option B: Microservice (B2B as separate service(s))

**Score: 4–5**

When F3 is broken into microservices:

- The B2B microservice already calls 12go via HTTP
- Today: HTTP to F3 monolith (`GET /search/{from}p/{to}p/{date}`)
- After F3 breakdown: HTTP to the new Search microservice — same contract, different host
- **Change required**: Update the 12go API base URL in config. No code changes to the B2B service logic.
- **Result**: The B2B microservice is decoupled from F3's internal structure. F3 breakdown is an upstream change; we update our HTTP client config.

---

## Implication for the Architecture Decision

This criterion was the **unspoken counter** to RnD's "coupled anyway" argument. Yes, every request to the B2B microservice also hits F3 — but the *nature* of the coupling differs:

| Coupling type | Monolith | Microservice |
|---------------|----------|--------------|
| **Today** | In-process: 25+ class dependencies | HTTP: versioned API contract |
| **When F3 breaks** | B2B code must be migrated/split | Config change: point to new search service URL |
| **Refactor impact** | Compile-time breakage when internal classes move | No impact if API contract is preserved |

If F3 breakdown happens in 2–3 quarters, code written inside F3 today has a high probability of requiring a second migration. Code in a separate microservice has a high probability of surviving with a config change only.

---

## Recommendation

When revisiting D1 after the Search POC, include **F3 Demolition Compatibility** in the evaluation. If F3 breakdown is a near-term certainty (even without a fixed date), this criterion favors the microservice option.

---

## References

- [Meeting record](../presentation/meeting-record.md)
- [System context meeting outcomes](../prompts/context/system-context.md#meeting-outcomes-2026-02-25)
- [B-microservice assumption risks](alternatives/B-microservice/design.md#assumption-risks-post-meeting-2026-02-25)
