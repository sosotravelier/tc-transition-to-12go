---
status: draft
last_updated: 2026-03-02
---

# POC Plan: Search Endpoint in F3

## Purpose

Implement the **Search** endpoint inside frontend3 (F3) to evaluate the friction of writing B2B API code in the PHP/Symfony monolith. The POC outcome will inform the architecture decision (D1: monolith vs microservice) before committing to a full implementation path.

**Context**: Team lead proposed GetItinerary; Soso proposed Search; the group settled on Search first. See [presentation/meeting-record.md](../presentation/meeting-record.md).

---

## Why Search (Not GetItinerary)

| Criterion | Search | GetItinerary |
|-----------|--------|--------------|
| **Volume** | Highest-traffic endpoint | Lower volume |
| **Complexity** | Stateless, single 12go call path | 3 sequential 12go calls, booking schema parser, cart management |
| **Scope** | Clean test of F3 dev experience | Adds booking-specific complexity (CartHandler, BookingFormManager) |
| **Station ID translation** | Yes — Fuji IDs → province IDs for search | Minimal (itinerary ID contains trip key) |
| **Response mapping** | Yes — trips, operators, segments, money format | Yes — plus schema parsing |
| **Time to implement** | Shorter — good for initial POC | Longer — better as second POC if Search goes well |

Search is the right first POC: it exercises the core translation layer (station IDs, response mapping, money format) without the booking schema parser and cart logic. If Search POC goes well, GetItinerary could follow as a second POC to validate the higher-complexity path.

---

## Scope

Implement `GET /v1/{client_id}/itineraries` inside F3 with:

1. **Auth** — Resolve `client_id` + `x-api-key` to `ApiAgent` (or equivalent)
2. **Station ID translation** — Fuji station IDs → 12go province IDs for search
3. **Search** — Call `SearchService` / `SearchFilterBuilder` / `TripPoolRepository` (or equivalent in-process)
4. **Response mapping** — Map 12go search results to B2B client contract (itineraries, segments, vehicles, money as strings)
5. **Contract conventions** — `Travelier-Version`, `x-correlation-id`, 206 Partial Content for recheck

**Out of scope for this POC**: Stations, Operators, POIs, booking funnel, deployment to staging/prod.

---

## Success Criteria (Measurable)

| Criterion | Target | How to Measure |
|-----------|--------|----------------|
| **Time to implement** | Document actual hours | Log effort; compare to estimated 2 weeks (Oleksandr's estimate for "another API version") |
| **Lines of code** | Document | Count new PHP files and LOC |
| **Test coverage** | At least one integration test | Search request → response shape matches contract |
| **Deployment** | Runs in F3 local Docker | Can execute search against staging 12go data |
| **F3 refactor simulation** | Document impact | If `SearchService` or `SearchFilterBuilder` were extracted to a new microservice, what would break? How much would need to change? |

---

## What to Observe

Capture qualitative feedback during implementation:

1. **PHP learning curve** — How much time spent on Symfony DI, attribute routing, repository patterns?
2. **Symfony service discovery** — How easy to find and use `SearchService`, `SearchFilterBuilder`, `TripPoolRepository`?
3. **Debugging experience** — Xdebug, Datadog, log correlation — what works, what doesn't?
4. **Datadog/tracing integration** — Is it automatic, or does B2B code need explicit wiring?
5. **Station mapping** — Where does the Fuji→12go mapping live? How is it loaded?
6. **Versioning** — How does `Travelier-Version` map to `VersionedApiBundle`? What configuration is needed?
7. **206 Partial Content** — How does 12go's `recheck` array flow through? Is there existing support?

---

## F3 Demolition Consideration

**Question**: What happens to this code when F3 is eventually broken into microservices?

- If search logic is extracted to a new "Search Service" microservice, the B2B Search controller would need to call it via HTTP instead of in-process. That is equivalent to the microservice design — the B2B layer would become an HTTP client to the new search service.
- Document: How coupled is the POC code to F3 internals? Which classes would need to change if `SearchService` moved to a separate deployable unit?

---

## Deliverables

1. **Code** — New B2B Search controller + mapper + station translator in F3 repo
2. **POC report** — Document effort, friction points, success criteria results, and recommendation (proceed with monolith vs. revisit microservice)
3. **Updated decision** — Revisit D1 with evidence from the POC

---

## References

- [Search endpoint contract](../current-state/endpoints/search.md)
- [Monolith Search flow](alternatives/A-monolith/design.md#search-flow)
- [12go API surface](../current-state/integration/12go-api-surface.md)
- [Meeting record](../presentation/meeting-record.md)
