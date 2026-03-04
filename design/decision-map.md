---
status: draft
last_updated: 2026-03-02
---

# Decision Map: 12go Transition

This document captures every major fork encountered during the design process, the options considered at each fork, and where applicable the current recommendation. It is meant as a navigational aid — all detail lives in the linked documents.

---

## Meeting Outcome (2026-02-25)

**D1 is deferred** pending a POC. The group agreed to implement the **Search** endpoint inside F3 first to evaluate friction, then revisit the architecture decision. Post-meeting: RnD confirmed the .NET microservice option is still viable; F3 redesign is not this quarter. See [presentation/meeting-record.md](../presentation/meeting-record.md).

---

## How to Read This Map

Each node is a **decision** (a question that must be answered). Each branch is an **option**. Nested sub-decisions only apply if the parent option is chosen.

| Symbol | Version | Reference |
| :---: | :--- | :--- |
| ★ | v1 | [v1/recommendation.md](v1/recommendation.md) |
| ◆ | v2 | [v2/recommendation.md](v2/recommendation.md) |
| ● | v3 | [v3/recommendation.md](v3/recommendation.md) |

When multiple symbols appear on an option, that option is preferred by each corresponding analysis. When versions disagree, each shows its preferred branch.

---

```mermaid
flowchart LR
    D0["D0: POC-first validation\n(deferred)"]
    D0 -->|"Implement Search in F3"| POC["POC: Search endpoint\ninside frontend3"]
    POC -->|"Evaluate friction"| D1

    D1["D1: Where does the B2B API layer live?\n(deferred pending POC)"]
    D1 -->|Option A| A["A: Inside 12go monolith\n(frontend3 / PHP/Symfony)"]
    D1 -->|★◆● Option B| B["B: Separate microservice(s)\n(language TBD)"]

    A --> DA1["DA1: Data access per endpoint"]
    DA1 -->|Sub-A| DA1a["In-process: call existing\nSymfony service classes directly"]
    DA1 -->|Sub-B| DA1b["HTTP self-call to 12go\nAPI (same as today)"]
    DA1 -->|Sub-C| DA1c["Direct MariaDB query\n(bypasses service layer)"]

    B --> DB1["DB1: Service topology"]
    DB1 -->|1 service| DB1a["Single service\n(all 13 endpoints)"]
    DB1 -->|★◆● 2 services| DB1b["Search + Master Data\nBooking (funnel + post-booking)"]
    DB1 -->|3+ services| DB1c["Further split\n(e.g., notifications separate)"]

    B --> DB2["DB2: Language / runtime"]
    DB2 -->|★◆| L1[".NET 8\n(zero learning curve)"]
    DB2 --> L2["TypeScript / Node.js\n(AI synergy, TS familiar)"]
    DB2 -->|●| L3["Go\n(strategic alignment)"]
    DB2 --> L4["PHP / Symfony\n(infra alignment)"]
    DB2 -.->|excluded| L5["Python\n(GIL, weak types, no alignment)"]

    L1 --> DL1["DL1: .NET framework"]
    DL1 -->|★◆| DL1a["Minimal API + Refit"]
    DL1 --> DL1b["MVC Controllers"]

    L2 --> DL2["DL2: TS framework"]
    DL2 -->|★◆| DL2a["NestJS\n(.NET-like DI)"]
    DL2 --> DL2b["Fastify\n(performance)"]
    DL2 --> DL2c["Hono\n(edge/lightweight)"]

    L3 --> DL3["DL3: Go router"]
    DL3 -->|★◆●| DL3a["Chi\n(idiomatic, minimal)"]
    DL3 --> DL3b["Gin / Echo"]

    L4 --> DL4["DL4: PHP framework"]
    DL4 -->|★◆| DL4a["Symfony 6.4\n(matches frontend3)"]
    DL4 --> DL4b["Symfony 7.x"]
    DL4 --> DL4c["Laravel"]
```

---

```mermaid
flowchart LR
    D2["D2: Client migration strategy"]
    D2 -->|Option A| MA["A: Transparent switch\n(same URLs, infra re-route)"]
    D2 -->|Option B| MB["B: New endpoints\n(clients update base URL)"]
    D2 -->|★◆● Option C| MC["C: Hybrid\n(search transparent, booking = new URL)"]

    MA --> MA1["Gateway routing mechanism"]
    MA1 -->|1| MA1a["Lambda authorizer\nmodification"]
    MA1 -->|2| MA1b["Feature flag inside\nnew service (proxy back)"]
    MA1 -->|3| MA1c["Full all-at-once cutover\n(no per-client granularity)"]
    MA1 -->|4| MA1d["Separate API Gateway\ndeployments per client group"]

    D2 --> D3["D3: Authentication bridge\n(our clientId+apiKey → 12go apiKey)"]
    D3 -->|Auth A| AuthA["Mapping table\n(clientId → 12go key)\nin config/DB"]
    D3 -->|Auth B| AuthB["New API gateway handles\ncredential translation"]
    D3 -->|Auth C| AuthC["Clients receive 12go keys directly\n(requires client changes)"]

    MA -.->|only viable| AuthA
    MA -.->|compatible| AuthB
    MA -.->|not viable| AuthC

    MB -.->|viable but suboptimal| AuthA
    MB -.->|viable| AuthB
    MB -.->|★ cleanest| AuthC

    MC -.->|search uses| AuthA
    MC -.->|booking can use| AuthA
    MC -.->|booking can use| AuthC
```

---

```mermaid
flowchart LR
    D4["D4: Where is the auth mapping table stored?"]
    D4 -->|1| S1["Config file / env vars\n(simple, redeploy to change)"]
    D4 -->|★◆● 2| S2["In-memory with file/S3 backing\n(hot-reload without restart)"]
    D4 -->|3| S3db["Database table\n(runtime updates, adds DB dep)"]
    D4 -->|4| S4["AWS Secrets Manager / Parameter Store\n(secure, but DevOps dependency)"]

    D5["D5: Station ID mapping storage"]
    D5 -->|1| SM1["Static JSON file bundled\nwith service (simple)"]
    D5 -->|★◆● 2| SM2["S3 artifact + periodic refresh\n(updated by snapshot job)"]
    D5 -->|3| SM3["Database table\n(flexible, adds DB dep)"]

    D6["D6: Seat lock implementation"]
    D6 -->|★◆● now| SL1["In-process store\n(ConcurrentDictionary / sync.Map / Map)\nper-instance TTL"]
    D6 -->|future| SL2["12go native seat lock\n(when 12go ships it)"]
    D6 -->|fallback| SL3["Redis\n(cross-instance sharing if needed)"]

    D7["D7: Station / Operator data delivery to clients"]
    D7 -->|★◆●| ST1["Periodic snapshot job → S3\n+ return pre-signed URL\n(preserves current client contract)"]
    D7 -->|not viable| ST2["Direct DB query at request time\n(violates current contract,\nexpensive at scale)"]
```

---

```mermaid
flowchart LR
    D8["D8: Booking schema complexity\n(20+ dynamic fields, wildcard patterns)"]
    D8 -->|A: Monolith| BSM1["Call BookingFormManager directly\n(in-process, already handles it)"]
    D8 -->|★◆● B: Microservice| BSM2["Port existing logic\n(C# or Go, ~500 lines, high test priority)"]

    D9["D9: Notification transformer\n(12go → client webhook)"]
    D9 -->|★◆● Co-located| NT1["Part of Booking Service\n(simpler, same deploy)"]
    D9 -->|Separate| NT2["Standalone Notification Service\n(independent scaling, more infra)"]

    D9 --> D9a["D9a: Webhook delivery guarantees"]
    D9a -->|★◆●| WD1["In-process retry queue\n(30s → 5min → 30min backoff)"]
    D9a --> WD2["External queue (SQS, Redis)\n(durable, adds infra)"]

    D9 --> D9b["D9b: 12go webhook security\n(currently unauthenticated)"]
    D9b -->|★◆● interim| WS1["IP allowlist only\n(minimal effort)"]
    D9b -->|future| WS2["HMAC-SHA256 signature\n(request from 12go team)"]

    D10["D10: GetBookingDetails source of truth"]
    D10 -->|current .NET| BD1["Local PostgreSQL store\n(synced from 12go)"]
    D10 -->|★◆● new design| BD2["Proxy to 12go /booking/{id}\n(no local store)"]
    D10 -->|hybrid| BD3["12go primary, local cache\nfor latency"]
```

---

## Decision Summary Table

| # | Decision | Options | v1 ★ | v2 ◆ | v3 ● | Reference |
|---|---|---|---|---|---|---|
| D0 | POC-first validation | Search in F3 → revisit D1 | **deferred** | — | — | [poc-plan](poc-plan.md), [meeting-record](../presentation/meeting-record.md) |
| D1 | Where does B2B API layer live? | A: Monolith / B: Microservice | ★ B | ◆ B | ● B | [A-monolith](alternatives/A-monolith/design.md), [B-microservice](alternatives/B-microservice/design.md) |
| DA1 | Monolith data access | In-process / HTTP self-call / Direct DB | (if A) | (if A) | (if A) | [A-monolith](alternatives/A-monolith/design.md) |
| DB1 | Service topology | 1 / **2** / 3+ | ★ 2 | ◆ 2 | ● 2 | [B-microservice](alternatives/B-microservice/design.md) |
| DB2 | Language | .NET / TS / Go / PHP | ★ .NET | ◆ .NET | ● **Go** | [v1](v1/comparison-matrix.md), [v2](v2/comparison-matrix.md), [v3](v3/comparison-matrix.md) |
| DL1 | .NET framework | Minimal API / MVC | ★ Minimal | ◆ Minimal | — | [dotnet](alternatives/B-microservice/languages/dotnet.md) |
| DL2 | TS framework | NestJS / Fastify / Hono | ★ NestJS | ◆ NestJS | — | [typescript](alternatives/B-microservice/languages/typescript.md) |
| DL3 | Go router | Chi / Gin / Echo | ★ Chi | ◆ Chi | ● Chi | [golang](alternatives/B-microservice/languages/golang.md) |
| DL4 | PHP framework | Symfony 6.4 / 7.x / Laravel | ★ Symfony | ◆ Symfony | — | [php-symfony](alternatives/B-microservice/languages/php-symfony.md) |
| D2 | Client migration strategy | A / B / C: Hybrid | ★ C | ◆ C | ● C | [migration-strategy](migration-strategy.md) |
| D3 | Authentication bridge | A: Mapping / B: Gateway / C: Direct keys | ★ A/C | ◆ A/C | ● A/C | [migration-strategy](migration-strategy.md) |
| D4 | Auth mapping storage | Config / **In-memory+S3** / DB / Secrets | ★ 2 | ◆ 2 | ● 2 | [B-microservice](alternatives/B-microservice/design.md) |
| D5 | Station ID mapping storage | Static / **S3 artifact** / DB | ★ 2 | ◆ 2 | ● 2 | [B-microservice](alternatives/B-microservice/design.md) |
| D6 | Seat lock | **In-process** / 12go native / Redis | ★ 1 | ◆ 1 | ● 1 | [B-microservice](alternatives/B-microservice/design.md) |
| D7 | Station data delivery | **Snapshot+S3** / Direct DB | ★ 1 | ◆ 1 | ● 1 | [stations](../current-state/endpoints/stations.md) |
| D8 | Booking schema handling | In-process / **Port mapper** | ★ B | ◆ B | ● B | [dotnet](alternatives/B-microservice/languages/dotnet.md) |
| D9 | Notification transformer | **Co-located** / Separate | ★ 1 | ◆ 1 | ● 1 | [B-microservice](alternatives/B-microservice/design.md) |
| D9a | Webhook delivery | **In-process retry** / External queue | ★ 1 | ◆ 1 | ● 1 | [B-microservice](alternatives/B-microservice/design.md) |
| D9b | 12go webhook security | **IP allowlist** / HMAC future | ★ 1 | ◆ 1 | ● 1 | [B-microservice](alternatives/B-microservice/design.md) |
| D10 | GetBookingDetails source | Local DB / **Proxy 12go** / Cache | ★ 2 | ◆ 2 | ● 2 | [B-microservice](alternatives/B-microservice/design.md) |

---

## Open / Unresolved Decisions

These decisions cannot be made without external input:

| # | Question | Blocking | Who answers |
|---|---|---|---|
| G1 | Can AWS API Gateway route by `client_id` path parameter? | D2-A, per-client gradual rollout | DevOps |
| G2 | Does a Lambda authorizer already exist? Can it be modified? | D2-A routing option 1 | DevOps |
| G3 | What is 12go's preferred language for new services? (Go confirmed?) | DB2 strategic alignment | 12go leadership |
| G4 | Will 12go DevOps support a .NET 8 Docker container on their infra? | DB2 final choice | 12go DevOps |
| G5 | Does a `clientId → 12go apiKey` mapping already exist anywhere? | D3, D4 | 12go / Management |
| G6 | Can 12go add HMAC signing to their webhooks? | D9b | 12go engineering |
| G7 | Will 12go ship a native seat lock API? ETA? | D6 | 12go engineering |
| G8 | Source for the periodic station snapshot job upstream feed (post-Fuji retirement)? | D7 | 12go / Management |
