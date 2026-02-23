# Recommendation: 12go Transition System Design

## TL;DR
We recommend the **.NET 8 Microservice (Alternative B1)** as the primary path for the transition. Despite the long-term strategic benefits of Go or PHP, the zero learning curve for the existing team and the 8-12 week timeline to feature parity make it the only realistic choice for a small team navigating a high-stakes migration. To mitigate strategic risk, we recommend a **TypeScript/Node.js** fallback if infrastructure alignment becomes a hard blocker.

---

## Primary Recommendation: .NET 8 Microservice (B1)

### Why This Approach
- **Immediate Productivity**: The team's 12+ years of .NET expertise allows them to port complex logic (booking schema parser, reserve data serialization) directly without translation errors.
- **Lowest Execution Risk**: Eliminates the "ramp-up period" (estimated at 4-6 weeks for other languages), which is critical for meeting transition deadlines.
- **AI Synergy**: .NET 8 has excellent support in Cursor/Claude, and the team's deep knowledge allows them to guide AI tools with precision.
- **Modern Infrastructure**: Leveraging .NET 8 AOT (Ahead-of-Time) compilation provides container sizes (~90MB) and startup times competitive with Go and PHP.

### Key Strengths
- Fast development velocity (10 weeks to full parity).
- Robust error handling and retry patterns (Polly + Refit).
- Familiar testing ecosystem (xUnit + Moq).
- Clean separation from 12go internals via HTTP contract.

### Known Trade-offs
- **Language Diversity**: Adds a new runtime (.NET) to a primarily PHP/Go platform.
- **Orphaned Tech Risk**: Future maintenance by 12go's core team will require specialized hiring or cross-training.

### When This Could Fail
- If 12go's DevOps team refuses to support a .NET deployment pipeline.
- If the team is unable to resist the urge to recreate the complexity of the old 340-project system (mitigated by a 10K LOC hard limit).

---

## Runner-Up: TypeScript/Node.js Microservice (B4)
TypeScript is the strongest alternative. Its syntax is highly familiar to .NET developers, and it offers the best synergy with AI coding tools. If infrastructure alignment with 12go's PHP/Go stack is prioritized over immediate velocity, TS/Node provides a modern, fast, and highly maintainable middle ground.

---

## Hybrid Approach: Monolith-Search + Microservice-Booking
While not fully explored as a standalone alternative, we recommend considering **A-monolith** specifically for the **Search** endpoint to achieve sub-10ms performance, while keeping the complex **Booking funnel** in a **.NET Microservice** for better isolation and development speed.

---

## Phased Migration Plan

### Phase 1: Foundation (Week 1-2)
- Set up .NET 8 Minimal API scaffolding with AOT support.
- Implement the "Authentication Bridge" (clientId + apiKey → 12go apiKey).
- Implement the Station Snapshot Pipeline (MariaDB → S3 artifact).

### Phase 2: Search MVP (Week 3-4)
- Port `OneTwoGoApi` search logic and models.
- Implement station ID translation (Fuji ↔ 12go).
- Enable shadow traffic validation for search.

### Phase 3: Booking Funnel (Week 5-10)
- Port the Booking Schema Parser (~20 wildcard patterns).
- Implement Create, Confirm, and Cancel endpoints.
- Set up the Notification Transformer (webhook receiver + async retry).

### Phase 4: Full Migration (Week 11-12)
- Gradual client migration via API Gateway routing.
- Decommissioning of Denali, Etna, Fuji, and SI Host services.

---

## Risk Mitigation Strategy

1. **The "10K LOC" Rule**: Enforce a strict limit on codebase size to prevent the re-introduction of "enterprise" over-engineering found in the current system.
2. **AI-First Logic Porting**: Use Cursor's @file references to port existing C# logic from `supply-integration` directly into the new Minimal API structure, ensuring logic parity.
3. **Shadow Validation**: Run the Search endpoint in parallel with the old system for 2 weeks before cutover to ensure price and inventory accuracy.

---

## Decision Criteria for Stakeholders
If choosing between .NET and TS/PHP:
- **Choose .NET if**: The priority is **speed** and **team retention**.
- **Choose TS/Go if**: The priority is **platform unification** and long-term **strategic alignment** with 12go.

---

## What We're NOT Recommending (and Why)
- **A: Monolith (PHP)**: Too much coupling to 12go internals and too high a learning curve for the current team. Retention risk is high.
- **B2: Microservice (PHP)**: Offers platform alignment but lacks the velocity of .NET or the AI synergy of TypeScript.
- **B3: Microservice (Go)**: Excellent tech, but the mental model shift (error handling, goroutines) creates too much timeline risk for this specific team.

---

## Next Steps
1. **DevOps Review**: Present the .NET 8 AOT Docker strategy to 12go DevOps for approval.
2. **Mapping Audit**: Begin formalizing the Fuji-to-12go station ID mapping table.
3. **Prototype**: Implement a 1-day prototype of the Search endpoint in .NET 8 Minimal API to prove the performance and image size claims.
