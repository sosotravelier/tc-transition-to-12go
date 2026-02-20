# Architectural Comparison of 5 B2B API Approaches

This document provides a visual, side-by-side architectural comparison of the five proposed alternatives for replacing the B2B API layer. It focuses on where key components live, what data stores and services each approach calls, and whether scaling is independent.

---

## High-Level Topology

All five approaches replace 4 .NET repositories (~342 projects, 200-400K LOC) with a single, dramatically smaller codebase. Four of them are standalone services that proxy to the 12go REST API over HTTP. One (PHP) embeds directly into 12go's existing monolith.

```mermaid
flowchart TD
    Client["B2B Clients\n(13 endpoints)"]

    subgraph standalone ["Standalone Services"]
        direction TB
        subgraph alt01 ["01: .NET 8 Minimal API"]
            n_mw["Middleware Pipeline"]
            n_features["Features / Vertical Slices"]
            n_client["TwelveGoApiClient\n(Typed HttpClient + Polly)"]
            n_notif["Webhook Transformer\n(in-memory retry)"]
        end

        subgraph alt03 ["03: Go / Chi Router"]
            g_mw["Middleware Stack"]
            g_handlers["Handlers / Services"]
            g_client["TwelveGoClient\n(retryablehttp + gobreaker)"]
            g_notif["Notification Worker Pool\n(goroutine channels)"]
        end

        subgraph alt04 ["04: TypeScript / Bun"]
            b_router["Router + Auth"]
            b_transforms["Transform Functions"]
            b_client["12go HTTP Client"]
            b_notif["Notification Handler\n(in-memory retry)"]
        end

        subgraph alt05 ["05: TypeScript / Node.js 22 + Fastify"]
            ts_plugins["Fastify Plugins\n(correlation, auth, errors)"]
            ts_features["Features / Vertical Slices"]
            ts_client["TwelveGoClient\n(undici Pool + retry)"]
            ts_notif["Webhook Transformer\n(in-memory retry)"]
        end
    end

    subgraph embedded ["Monolith Integration"]
        direction TB
        subgraph alt02 ["02: PHP / Symfony 6.4 inside f3"]
            p_ctrl["B2bApi Controllers"]
            p_handlers["Handlers + Mappers"]
            p_f3["f3 Internal Services\n(Search, Booking, Cart, Ticket)"]
            p_notif["Event Listener\n(Symfony Messenger retry)"]
        end
    end

    TGoAPI["12go REST API"]
    TGoDB[("12go MariaDB")]
    TGoRedis[("12go Redis")]

    Client --> alt01 & alt03 & alt04 & alt05
    Client --> alt02

    n_client -->|"HTTP"| TGoAPI
    g_client -->|"HTTP"| TGoAPI
    b_client -->|"HTTP"| TGoAPI
    ts_client -->|"HTTP"| TGoAPI

    p_f3 -->|"Direct PHP call"| TGoDB
    p_f3 -->|"Direct PHP call"| TGoRedis

    TGoAPI --> TGoDB
    TGoAPI --> TGoRedis
```

---

## Per-Approach Architecture Diagrams

### 01: Trimmed .NET Service

```mermaid
flowchart LR
    Client["B2B Client"]

    subgraph DotNet ["b2b-api  (.NET 8 Minimal API)"]
        direction TB
        MW["Middleware\n- CorrelationId\n- ApiVersion\n- ClientAuth\n- ErrorHandling"]
        Search["Search Endpoint"]
        Booking["Booking Funnel\n(Create, Confirm, SeatLock)"]
        PostBook["Post-Booking\n(Details, Ticket, Cancel)"]
        MasterData["Stations / Operators / POIs"]
        Notif["Webhook Receiver\n+ NotificationTransformer"]
        TGClient["TwelveGoApiClient\n(Typed HttpClient\n+ Polly resilience)"]
    end

    TGoAPI["12go REST API"]

    Client --> MW --> Search & Booking & PostBook & MasterData & Notif
    Search & Booking & PostBook & MasterData --> TGClient --> TGoAPI
    TGoAPI -.->|"Webhook POST"| Notif
    Notif -->|"Forward to client webhook"| Client

    style DotNet fill:#1a1a2e,color:#e0e0e0
```

| Aspect | Detail |
|--------|--------|
| **Runtime** | .NET 8, single Docker container (~250MB image) |
| **Databases** | None (fully stateless) |
| **External calls** | 12go REST API via HTTP |
| **Webhook** | Receives HTTP webhook from 12go, transforms, forwards to clients |
| **Scaling** | Independent horizontal scaling via Docker replicas |
| **Observability** | dd-trace-dotnet auto-instrumentation, Serilog JSON, DogStatsD |
| **LOC** | ~6K |
| **MVP Timeline** | 3 weeks (no ramp-up) |

---

### 02: PHP Integration (Inside f3 Monolith)

```mermaid
flowchart LR
    Client["B2B Client"]

    subgraph F3 ["frontend3 Symfony 6.4 (8 EC2 instances)"]
        direction TB
        Ctrl["B2bApi Controllers\n(13 endpoints)"]
        Handlers["Handlers + Mappers"]
        F3Svc["f3 Internal Services\n(Search, Booking, Cart, Ticket)"]
        EventDispatcher["Symfony Event Dispatcher"]
        Listener["BookingNotificationListener"]
        Messenger["Symfony Messenger\n(retry queue)"]
    end

    MariaDB[("MariaDB")]
    Redis[("Redis")]

    Client --> Ctrl --> Handlers --> F3Svc
    F3Svc --> MariaDB
    F3Svc --> Redis
    EventDispatcher -->|"booking.status_changed"| Listener
    Listener --> Messenger -->|"HTTP POST"| Client

    style F3 fill:#1a1a2e,color:#e0e0e0
```

| Aspect | Detail |
|--------|--------|
| **Runtime** | PHP 8.3 / Symfony 6.4, runs on existing f3 EC2 fleet |
| **Databases** | f3's existing MariaDB (direct queries) + Redis (shared cache) |
| **External calls** | Internal PHP function calls to f3 services (no HTTP round-trip) |
| **Webhook** | Listens to internal Symfony events, not external HTTP webhooks |
| **Scaling** | Tied to f3 monolith scaling (cannot scale B2B independently) |
| **Observability** | dd-trace-php (already in f3), Monolog, shared Datadog dashboards |
| **LOC** | ~3-4K |
| **MVP Timeline** | 6-8 weeks (includes PHP ramp-up + f3 orientation) |

---

### 03: Go Service

```mermaid
flowchart LR
    Client["B2B Client"]

    subgraph GoSvc ["b2b-api (Go single binary, ~10MB image)"]
        direction TB
        Router["Chi Router\n+ Middleware"]
        Handlers["HTTP Handlers"]
        Services["Service Layer\n(orchestration)"]
        Transform["Transformers\n(booking schema, reserve)"]
        TGClient["TwelveGoClient\n(retryablehttp\n+ circuit breaker)"]
        NotifPool["Notification Worker Pool\n(goroutine channels)"]
    end

    TGoAPI["12go REST API"]

    Client --> Router --> Handlers --> Services --> TGClient --> TGoAPI
    Services --> Transform
    TGoAPI -.->|"Webhook POST"| NotifPool
    NotifPool -->|"Forward"| Client

    style GoSvc fill:#1a1a2e,color:#e0e0e0
```

| Aspect | Detail |
|--------|--------|
| **Runtime** | Go 1.23, distroless container (~10-15MB image) |
| **Databases** | None (fully stateless) |
| **External calls** | 12go REST API via HTTP |
| **Webhook** | Goroutine worker pool with in-memory retry channels |
| **Scaling** | Independent, near-instant startup (<100ms), ~20MB RAM |
| **Observability** | dd-trace-go v2, slog JSON, DogStatsD |
| **LOC** | ~3-5K |
| **MVP Timeline** | 4-6 weeks (includes 2-week Go ramp-up) |

---

### 04: Hybrid BFF (TypeScript / Bun)

```mermaid
flowchart LR
    Client["B2B Client"]

    subgraph BFF ["Thin BFF (Bun + TypeScript)"]
        direction TB
        Router["Router + Auth Resolver"]
        SimpleTx["Simple Transforms\n(7 endpoints, 1:1 mapping)"]
        OrchestratedTx["Orchestrated Handlers\n(4 endpoints, multi-call)"]
        SchemaMapper["Booking Schema Mapper\n(~500 LOC, 20+ patterns)"]
        NotifHandler["Notification Handler\n(in-memory map + retry)"]
        TGClient["12go HTTP Client"]
    end

    TGoAPI["12go REST API"]

    Client --> Router --> SimpleTx & OrchestratedTx & SchemaMapper
    SimpleTx & OrchestratedTx & SchemaMapper --> TGClient --> TGoAPI
    TGoAPI -.->|"Webhook"| NotifHandler
    NotifHandler -->|"Forward"| Client

    style BFF fill:#1a1a2e,color:#e0e0e0
```

| Aspect | Detail |
|--------|--------|
| **Runtime** | Bun 1.2+ (Node.js-compatible), single container (~50MB image) |
| **Databases** | None (fully stateless; in-memory booking-to-client map for webhooks) |
| **External calls** | 12go REST API via HTTP |
| **Webhook** | In-memory booking-to-client map (lost on restart), in-process retry |
| **Scaling** | Independent horizontal scaling |
| **Observability** | dd-trace (experimental Bun support), JSON stdout logging |
| **LOC** | ~2.8K (smallest of all) |
| **MVP Timeline** | 4-5 weeks |
| **Reviewer concern** | All 6 reviewers recommended switching to Node.js 22 LTS over Bun |

---

### 05: TypeScript / Node.js 22 + Fastify

```mermaid
flowchart LR
    Client["B2B Client"]

    subgraph NodeSvc ["b2b-api (Fastify + Node.js 22 LTS)"]
        direction TB
        Plugins["Fastify Plugins\n- correlationId\n- apiVersion\n- clientAuth\n- errorHandler"]
        Features["Features / Vertical Slices"]
        TGClient["TwelveGoClient\n(undici Pool + retry)"]
        ZodSchemas["Zod Schemas\n(single source of truth:\ntypes + validation)"]
        NotifTx["Webhook Transformer\n(in-memory retry)"]
    end

    TGoAPI["12go REST API"]

    Client --> Plugins --> Features --> TGClient --> TGoAPI
    Features --> ZodSchemas
    TGoAPI -.->|"Webhook"| NotifTx
    NotifTx -->|"Forward"| Client

    style NodeSvc fill:#1a1a2e,color:#e0e0e0
```

| Aspect | Detail |
|--------|--------|
| **Runtime** | Node.js 22 LTS, Docker container (~150MB image) |
| **Databases** | None (fully stateless) |
| **External calls** | 12go REST API via HTTP |
| **Webhook** | Same-process webhook receiver with in-memory retry (outbox upgrade path) |
| **Scaling** | Independent horizontal scaling |
| **Observability** | dd-trace (first-class Node.js support), Pino JSON logging, DogStatsD |
| **LOC** | ~5K |
| **MVP Timeline** | 4-5 weeks (includes 1-week TS ramp-up) |

---

## Side-by-Side Comparison Matrix

| Dimension | .NET (01) | PHP (02) | Go (03) | BFF/Bun (04) | Node/TS (05) |
|-----------|-----------|----------|---------|--------------|--------------|
| **Service topology** | Standalone | Inside f3 monolith | Standalone | Standalone | Standalone |
| **Search lives in** | Proxy service | f3 module | Proxy service | Proxy service | Proxy service |
| **Booking funnel lives in** | Proxy service | f3 module | Proxy service | Proxy service | Proxy service |
| **Webhook transformer** | Same service (HTTP receiver) | Event listener (internal events) | Same service (goroutine pool) | Same service (in-memory) | Same service (HTTP receiver) |
| **Database dependencies** | None | MariaDB + Redis (f3's) | None | None | None |
| **How it reaches 12go** | HTTP proxy | Direct PHP service calls | HTTP proxy | HTTP proxy | HTTP proxy |
| **Search latency overhead** | +2-5ms (HTTP hop) | ~0ms (direct DB) | +2-5ms (HTTP hop) | +1-3ms (HTTP hop) | +2-5ms (HTTP hop) |
| **Scales independently** | Yes | No (coupled to f3) | Yes | Yes | Yes |
| **Docker image size** | ~250MB | N/A (f3 infra) | ~10-15MB | ~50MB | ~150MB |
| **Memory footprint** | ~150-200MB | Shared with f3 | ~20-30MB | ~50-100MB | ~100-150MB |
| **Startup time** | <2s | N/A (f3 process) | <100ms | ~15-30ms | ~60-120ms |
| **LOC estimate** | ~6K | ~3-4K | ~3-5K | ~2.8K | ~5K |
| **Team ramp-up** | 0 weeks | 1-2 weeks (PHP) + 3-4 weeks (f3) | 2-4 weeks | 1-2 weeks | 1 week |
| **MVP timeline** | 3 weeks | 6-8 weeks | 4-6 weeks | 4-5 weeks | 4-5 weeks |
| **Total migration** | 7-8 weeks | 13-21 weeks | 10-12 weeks | 8-10 weeks | 8-9 weeks |
| **Weighted score** | **123/140 (#1)** | **93/140 (#5)** | **108/140 (#3)** | **107/140 (#4)** | **113/140 (#2)** |

---

## Data Flow Comparison

The fundamental architectural split is between "proxy via HTTP" (01, 03, 04, 05) and "direct integration" (02):

```mermaid
flowchart LR
    subgraph proxy ["Proxy Pattern (01, 03, 04, 05)"]
        direction LR
        PC["B2B Client"]
        PS["Proxy Service"]
        PA["12go REST API"]
        PD[("MariaDB")]
        PC -->|"HTTP"| PS -->|"HTTP (+2-5ms)"| PA -->|"SQL"| PD
    end

    subgraph direct ["Direct Pattern (02 - PHP)"]
        direction LR
        DC["B2B Client"]
        DF["f3 B2bApi Module"]
        DS["f3 Internal Service"]
        DD[("MariaDB")]
        DC -->|"HTTP"| DF -->|"PHP call (0ms)"| DS -->|"SQL"| DD
    end
```

---

## Webhook / Notification Flow Comparison

```mermaid
flowchart TD
    subgraph proxyWebhook ["Standalone Services (01, 03, 04, 05)"]
        direction LR
        TG1["12go Platform"]
        WH1["Service Webhook Endpoint\n(POST /webhooks/booking-notifications)"]
        TX1["Notification Transformer"]
        CL1["B2B Client Webhook"]
        TG1 -->|"HTTP POST\n(no auth)"| WH1 --> TX1 -->|"HTTP POST\n(HMAC signed)"| CL1
    end

    subgraph phpWebhook ["PHP Inside f3 (02)"]
        direction LR
        ED["Symfony EventDispatcher"]
        LI["BookingNotificationListener"]
        TX2["NotificationTransformer"]
        MS["Symfony Messenger\n(retry queue)"]
        CL2["B2B Client Webhook"]
        ED -->|"Internal event\n(no HTTP)"| LI --> TX2 --> MS -->|"HTTP POST"| CL2
    end
```

Key difference: The PHP approach (02) avoids the unauthenticated webhook problem entirely by subscribing to internal Symfony events rather than receiving external HTTP calls.

---

## Scaling Characteristics

```mermaid
flowchart TD
    subgraph independentScale ["Independent Scaling (01, 03, 04, 05)"]
        LB1["Load Balancer"]
        LB1 --> R1["Replica 1"]
        LB1 --> R2["Replica 2"]
        LB1 --> R3["Replica N"]
    end

    subgraph coupledScale ["Coupled Scaling (02 - PHP in f3)"]
        LB2["Load Balancer"]
        LB2 --> F1["f3 Instance 1\n(consumer + B2B)"]
        LB2 --> F2["f3 Instance 2\n(consumer + B2B)"]
        LB2 --> F8["f3 Instance 8\n(consumer + B2B)"]
    end
```

For the standalone approaches, B2B traffic can be scaled independently of consumer traffic. For the PHP approach, adding B2B capacity means adding f3 instances, which also increases consumer capacity (potentially wasted resources).

---

## Reviewer Consensus Summary

### All 6 reviewers agreed on:
- **.NET is the lowest-risk, fastest-to-deliver option.** No reviewer disputed the team competency advantage.
- **PHP's dominant risk is human, not technical.** Every reviewer flagged team satisfaction and stack alignment.
- **Go's strategic alignment is speculative.** "Considering Go" is not a commitment.
- **BFF should use Node.js 22 LTS, not Bun.** Bun's experimental Datadog support is a production risk.
- **The booking schema parser is the highest-risk component regardless of language.**
- **All alternatives correctly identify the system as a stateless proxy.** Zero local databases is the right default.

### Risk Heat Map

| Risk Category | .NET (01) | PHP (02) | Go (03) | BFF (04) | TS (05) |
|---------------|-----------|----------|---------|----------|---------|
| Migration Timeline | LOW | HIGH | MEDIUM | MEDIUM | LOW-MEDIUM |
| Team Retention | LOW | HIGH | MEDIUM-HIGH | MEDIUM | MEDIUM |
| Client Disruption | LOW | MEDIUM | LOW | LOW | LOW |
| Knowledge Transfer | MEDIUM | LOW | MEDIUM | MEDIUM | LOW-MEDIUM |
| Operational | LOW | MEDIUM | LOW | MEDIUM-HIGH | LOW-MEDIUM |

### DX Advocate Highlights

- **01 (.NET)**: "The team wakes up, opens Rider, and writes code in the language they are experts in. During a transition where many factors are changing, the codebase itself being familiar is a profound stabilizing force."
- **02 (PHP)**: "A team writing code under significant stack friction produces brittle, poorly-tested software. Do not choose this option unless the team genuinely consents."
- **03 (Go)**: "The resulting codebase would be beautiful: 25 files, single binary, sub-millisecond GC. But getting there requires the team to unlearn 12 years of C# idioms while shipping production code under a deadline."
- **04 (BFF/Bun)**: "Choosing Bun over Node.js is optimizing the wrong variable at the cost of ecosystem maturity."
- **05 (Node/TS)**: "The booking schema parser -- the hardest piece of code in the entire system -- is more natural in TypeScript than in any other option. The AI story amplifies the joy."
