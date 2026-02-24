# B2B Transition: Two Decisions

**Meeting** | Feb 25, 2026 | 30 min
**Attendees** | Team Lead, R&D, Architect, Veteran 12go Developer

---

## Context

We have 7 .NET services that act as an HTTP proxy layer between B2B clients and 12go. All data originates from 12go. Every piece of local storage we maintain (DynamoDB, PostgreSQL, HybridCache) is a copy of what 12go already has.

```mermaid
flowchart LR
    Client["B2B Clients"] -->|"13 endpoints"| NET[".NET Services\n(Etna, Denali, Fuji, SI)\n7 services, 340+ projects"]
    NET -->|"HTTP proxy"| TG["12go\n(PHP/Symfony)\nsource of truth"]
    NET -.->|"can be\neliminated"| NET
```

**Goal**: Replace these services with something simple that preserves the client API contract, removes our local storage, and fits into 12go's infrastructure.

---

## Decision 1: Monolith or Microservice?

> **Where does the new B2B API layer live?**

```mermaid
flowchart LR
    Q["Where does B2B\nAPI layer live?"]
    Q -->|"Option A"| A["Inside 12go monolith\n(frontend3 / PHP)"]
    Q -->|"Option B"| B["Separate microservice\n(language TBD)"]
```

### Side-by-Side

| | **A: Monolith** | **B: Microservice** |
|---|---|---|
| **What it means** | New Symfony controllers inside frontend3 calling 12go service classes in-process | Standalone HTTP proxy service(s) deployed on 12go infra, calling 12go's HTTP API |
| **Performance** | Zero network hop -- in-process calls | Negligible added latency -- services are co-located in the same cloud. B2B clients already tolerate the HTTP hop latency in the current architecture. |
| **Coupling** | Deep -- tied to 25+ internal 12go classes (`BookingProcessor`, `SearchService`, `CartHandler`). Breaks when they refactor. | Loose -- depends only on 12go's public HTTP API contract |
| **Deployment** | Ships with the monolith -- same release cycle as all of 12go | Independent deploy, independent rollback |
| **Team impact** | Must write PHP/Symfony from day 1 | Can choose a language the team is productive in |
| **12go team impact** | They own our code -- it lives in their repo, their CI, their review process | They host our Docker container -- standard infra, no code ownership |
| **Failure isolation** | A bug in our B2B code can affect the entire monolith | Our service fails independently -- 12go core is unaffected |

### Why Monolith Has Hidden Complexity

The monolith option initially seems simpler (call services directly, no HTTP hop), but our analysis uncovered concrete risks:

| Monolith Concern | Detail |
|---|---|
| **BookingProcessor coupling** | Has ~25 injected dependencies. Our B2B code would inherit all of them -- payment flow, seller fallback, duplicate detection, Redis locking. We need to understand which ones apply to B2B and which don't. |
| **Refund path is opaque** | The monolith's `RefundController` doesn't call a refund service class directly. Instead it makes HTTP self-calls to an internal `/api/v1/secure/refund-options/{bid}` endpoint. The service classes behind that endpoint haven't been identified yet. Building CancelBooking in the monolith means either replicating this HTTP self-call pattern (losing the in-process benefit) or reverse-engineering the internal flow. With a microservice, we just call 12go's public refund API -- which is what our current .NET system already does successfully. |
| **Webhook gap** | `WebhookController` in frontend3 currently accepts 12go webhooks and does nothing. All notification transformation and delivery to B2B clients is brand new code either way. |
| **Cart TTL unknown** | The monolith uses Redis cart hashes as booking tokens. If Redis evicts the cart before the client calls CreateBooking, the token is invalid. TTL needs to be confirmed with the 12go team. |

**With a microservice**: 12go's HTTP API is a stable, documented contract. We already call it today. The microservice simply removes the 6 layers of abstraction (.NET framework, SI Host, MediatR pipeline, DynamoDB caching, Kafka events) between us and that API.

### We Evaluated This From 3 Angles

To avoid bias, we scored all options using three different weighting frameworks. Each one shifts priorities to stress-test whether the winner changes:

- **v1** -- weights favor execution speed and team productivity
- **v2** -- balanced weights across execution, infrastructure, and strategy
- **v3** -- weights heavily favor infrastructure fit and strategic alignment (deliberately designed to give the monolith/PHP the best possible chance)

All three reached the same conclusion on this decision:

| Analysis | Monolith (A)? | Microservice (B)? |
|:---|:---:|:---:|
| v1 (execution-focused) | -- | **B** |
| v2 (balanced) | -- | **B** |
| v3 (strategic-focused) | -- | **B** |

**Consensus is unanimous.** Microservice wins because the coupling cost of the monolith outweighs the in-process performance benefit, and the latency overhead is negligible when co-located.

---

## What Does the Microservice Actually Do?

Before choosing a language, it helps to understand what we're building. Most of the service is straightforward HTTP proxying. But there are a few areas with real complexity:

### Complexity Map

| Component | Complexity | Why |
|---|:---:|---|
| **Booking schema parser** | **High** | 12go's checkout endpoint returns a flat JSON object with 20+ dynamic field names matched by wildcard patterns (`selected_seats_*`, `points*[pickup]`, `delivery*address`). The parser must classify each field, build the client-facing schema, and later reverse-map client passenger data back into the exact flat bracket-notation format (`passenger[0][first_name]`) for the reserve request. This is ~500 lines of battle-tested C# logic that encodes years of production edge cases. **Highest test priority in any language.** |
| **Station ID translation** | **Medium** | Bidirectional mapping: clients send Fuji station IDs, 12go expects province IDs for search and internal IDs for other calls. Responses must reverse-map back. The mapping data itself is static-ish (loaded from a file), but it touches every search request and every booking response. |
| **Cancellation policy mapping** | **Medium** | 12go returns integer policy codes + free-text message. Clients expect structured time-windowed penalty rules with ISO 8601 durations. Requires a mapping table ported from existing .NET logic. |
| **Notification transformer** | **Medium** | 12go sends `{bid}` with no client context. Must call 12go to get booking details, resolve which B2B client owns it, transform the payload shape, and deliver to the client's webhook URL with retry logic. |
| **Everything else** | **Low** | Search, GetBookingDetails, GetTicket, Confirm -- these are straightforward request translation + response mapping. The proxy pattern is the same for each: authenticate, translate IDs, call 12go, map response, enforce money format. |

**Bottom line**: ~80% of the code is mechanical proxy logic. The booking schema parser is the one piece that demands careful porting and thorough testing regardless of language choice.

---

## Decision 2: Which Language?

> **If microservice, what do we build it in?**

```mermaid
flowchart LR
    L[Language?]
    L --> N[".NET"]
    L --> P["PHP/Symfony"]
    L --> G["Go"]
    L --> T["TypeScript"]
    L -.->|"excluded"| Py["Python"]
```

### The Case for Each Language

**.NET** -- The team has 12+ years of .NET expertise. Zero ramp-up. The existing booking schema parser, station mapping logic, and reserve data serializer can be ported line-by-line from the current C# codebase. Ships as a standard Docker image. The risk: .NET is a foreign runtime in 12go's PHP/Go ecosystem. 12go's DevOps team would need to support new Microsoft base images, new CI/CD vulnerability scanning, and .NET-specific profiling tools (`dotnet-trace`, `dotnet-dump`) that nobody else in the organization uses. If the team that built it leaves, nobody at 12go can maintain it.

**PHP/Symfony** -- Native alignment with 12go's core stack. Same base images, same CI/CD pipeline, same debugging tools. If 12go engineers ever need to touch the service, it's familiar territory. The downside: our team has no PHP experience. Every line of code would be a learning exercise. The booking schema parser -- the most complex piece -- would need to be rewritten in an unfamiliar language. AI tools can help, but validating AI-generated PHP when you don't know the idioms is risky.

**Go** -- Go is potentially part of 12go's future technical direction (to be confirmed). It's statically typed and compiled like C#, making it the most natural transition for .NET developers among the non-.NET options. Go's standard library handles HTTP, JSON, and concurrency natively -- no framework needed. Compiles to a single binary, ships as a minimal Docker image. The learning curve is real but bounded: Go's surface area is deliberately small. Senior engineers typically become productive in 2-3 weeks. Whether Go is actually the strategic direction at 12go is an open question for this meeting.

**TypeScript/Node.js** -- Highest synergy with AI coding tools (largest training corpus). Familiar to most developers. Strong testing ecosystem. NestJS provides .NET-like dependency injection patterns. The gap: TypeScript has no strategic alignment with 12go's PHP/Go direction. It would be another "foreign" runtime on their infrastructure, similar to .NET but with a broader hiring pool.

**Python (excluded)** -- Python was excluded from evaluation. The GIL limits true concurrency, making it a poor fit for a high-throughput HTTP proxy. Python's weak runtime type system increases the risk of subtle bugs in the complex booking schema mapping logic where type safety matters. There's no strategic alignment with 12go (they don't use Python), and there's no team familiarity advantage over Go or TypeScript.

### How the 3 Analyses Scored Languages

The same three weighting frameworks introduced above were applied to the language decision. Here's how the weights shifted across versions:

```mermaid
flowchart TD
    subgraph v1["v1: Execution Focus"]
        direction LR
        V1H["HIGH (x3):\nImpl Effort, Team Match,\nPerformance, Infra Fit"]
        V1L["LOW (x1):\nFuture Extensibility"]
    end

    subgraph v2["v2: Balanced"]
        direction LR
        V2H["HIGH (x3):\nImpl Effort, Infra Fit,\nMaintainability, Velocity,\nMigration Risk, Extensibility"]
        V2L["LOW (x1):\nPerformance, AI"]
    end

    subgraph v3["v3: Strategic (PHP-favored weights)"]
        direction LR
        V3C["CRITICAL (x7):\nInfrastructure Fit"]
        V3S["STRATEGIC (x5):\nFuture Extensibility,\nOps Complexity, Velocity"]
        V3E["EXECUTION (x3):\nTeam Match, Effort"]
    end

    v1 -->|".NET wins"| R1[".NET: 118 pts"]
    v2 -->|".NET wins"| R2[".NET: 127 pts"]
    v3 -->|"Go wins"| R3["Go: 180 pts"]
```

### v3 Was Designed to Give PHP Every Advantage

In v3, we deliberately cranked up the weights that favor PHP:
- **Infrastructure Fit at x7** (PHP scores 5/5 here -- identical runtime to frontend3)
- **Future Extensibility at x5** (PHP scores 5/5 here)
- **Operational Complexity at x5** (PHP scores 4-5/5 here)
- **Team Competency Match dropped to x3** (where .NET dominates)

Even with these weights maximally favoring PHP, it came in second (178 pts). Go edged it out (180 pts) because Go matches PHP on future extensibility (if Go is indeed the strategic direction) while being more approachable for our .NET team in terms of velocity and code elegance.

### Score Comparison Across All 3 Analyses

| Language | v1 (of 140) | v2 (of 150) | v3 (of 235) | Pattern |
|:---|:---:|:---:|:---:|:---|
| **.NET** | **118** (1st) | **127** (1st) | 155 (4th) | Dominates when team execution is weighted highest |
| **TypeScript** | 113 (2nd) | 118 (2nd) | 154 (5th) | Consistent middle -- best AI synergy, no strategic fit |
| **Go** | 105 (3rd) | 112 (3rd) | **180** (1st) | Rises when strategic alignment is weighted highest |
| **PHP/Symfony** | 102 (4th) | 108 (4th) | 178 (2nd) | Strong only when infra fit matters most *and* we accept the productivity hit |
| **Monolith PHP** | 98 (5th) | 102 (5th) | 168 (3rd) | Best infra fit, but coupling + team impact drag it down |

### What Drives the Scores

The fundamental tension is **who will own this service long-term**:

- If **our .NET team** owns it indefinitely → **.NET** is the clear winner. Maximum productivity, minimum risk during build.
- If **12go's PHP team** takes over eventually → **PHP** or **Go** makes sense. They can maintain it with their existing skills and tools.
- If **ownership is uncertain** → this is where the decision gets hard. .NET optimizes for now but creates a maintenance orphan. PHP/Go optimize for later but slow us down now.

---

## The Core Question for This Room

```mermaid
flowchart TD
    Q1{"Who will own this\nservice long-term?"}
    Q1 -->|"Our team keeps it"| OUR["Optimize for our productivity\n→ .NET"]
    Q1 -->|"12go team takes over"| THEIR["Optimize for their ecosystem\n→ PHP or Go"]
    Q1 -->|"Uncertain / shared"| SHARED["Find the middle ground\n→ Go balances both\n(if Go is strategic at 12go)"]

    OUR -.->|"Trade-off"| T1["12go DevOps must support\na .NET container forever"]
    THEIR -.->|"Trade-off"| T2["Our team invests in\nlearning a new language"]
    SHARED -.->|"Depends on"| T3["Is Go actually the\nstrategic direction at 12go?"]
```

---

## What We Need From This Meeting

| # | Question | Who Can Answer |
|---|---|---|
| 1 | **Monolith or Microservice?** Analysis points to microservice. Do we agree? | Architect + R&D |
| 2 | **Language**: .NET (our team) vs Go (potential alignment) vs PHP (their ecosystem)? | All |
| 3 | **Will DevOps support a .NET container on 12go infra?** If not, .NET is off the table. | 12go Developer → DevOps |
| 4 | **Is Go the strategic direction for new services at 12go?** This changes Go's score significantly. | 12go Developer |
| 5 | **Who will own and maintain this service in 12+ months?** This is the deciding factor for language. | R&D + Team Lead |

---

## Appendix A: Target Architecture

Two services, deployed as Docker containers on 12go infra:

```mermaid
flowchart TB
    Client["B2B Clients"]
    GW["API Gateway"]

    Client --> GW

    subgraph services["Our Services (new)"]
        Search["Search & Master Data\n5 endpoints, stateless"]
        Booking["Booking Service\n8 endpoints, minimal state"]
    end

    subgraph twelvego["12go Platform (existing)"]
        API["12go HTTP API"]
        DB["MariaDB"]
        Redis["Redis"]
    end

    S3["S3\n(station snapshots)"]

    GW --> Search
    GW --> Booking
    Search -->|"HTTP"| API
    Booking -->|"HTTP"| API
    Search -->|"pre-signed URL"| S3
    API --> DB
    API --> Redis
```

**What gets eliminated**: Etna (2 services), Denali (3 services), Fuji (1 service), SI Framework, all DynamoDB tables, PostgreSQL, HybridCache, Kafka events, 340+ .NET projects.

**What remains**: ~5-8K lines of proxy logic, station ID mapping, booking schema parser.

---

## Appendix B: Key Risks Regardless of Language

| Risk | Detail | Mitigation |
|---|---|---|
| **Station ID mapping** | Clients have Fuji IDs embedded; 12go uses different IDs. Bidirectional translation needed on every request. | S3-backed mapping file, populated from Fuji data before cutover |
| **Booking schema parser** | 20+ dynamic fields with wildcard patterns. Most complex code in the entire service. | Port existing C# logic carefully. Highest test priority. |
| **Seat lock** | 12go doesn't support native seat lock yet | In-process store with TTL. Replace when 12go ships native support. |
| **Webhook security** | 12go's inbound webhooks are currently unauthenticated | IP allowlist immediately, HMAC signing when 12go supports it |
| **Client disruption** | Clients must not notice the switch | Hybrid strategy: transparent search switch + per-client booking rollout |
