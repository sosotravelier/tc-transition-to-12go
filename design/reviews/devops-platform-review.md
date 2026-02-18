---
status: draft
last_updated: 2026-02-17
agent: V4-devops-platform-engineer
---

# DevOps & Platform Engineering Review

## 1. Executive Summary

**Bottom line: Option B (PHP Native Bundle) is the easiest to run in production.** It has the smallest infrastructure footprint, eliminates the polyglot tax, integrates into an existing CI/CD pipeline, and requires the fewest moving parts for the on-call engineer to worry about at 3 AM.

Option C (Thin Gateway) is a close second — operationally simple as a standalone service, but it's still .NET, which means two language stacks in production. Option A (Trimmed .NET) preserves the status quo's operational complexity in a smaller package but doesn't solve the fundamental polyglot problem.

From a pure "keep it running in production" perspective:

| Criterion | Option A | Option B | Option C |
|-----------|:--------:|:--------:|:--------:|
| Things I deploy | 2 containers + Redis + Kafka | 1 pod group (same image as frontend3) + Kafka | 1 container + Redis |
| Things that page me at 3 AM | .NET OOM, Redis, Kafka, 12go, polyglot debugging | frontend3 (already paged for), Kafka, 12go | Redis, 12go, .NET container health |
| Time to onboard new SRE | 2-3 weeks (must learn .NET + PHP stack) | 1 week (PHP only, same as existing) | 2 weeks (must understand .NET proxy) |
| Blast radius of bad deploy | Unified API down = all partner traffic dead | Partner pod group only; main frontend3 unaffected | Gateway down = all partner traffic dead |

---

## 2. Per-Option Infrastructure Assessment

### 2.1 Option A: Trimmed .NET

#### Container/Pod Specification

| Container | Image Base | Image Size | CPU Request/Limit | Memory Request/Limit | Min Replicas | Max Replicas |
|-----------|-----------|------------|-------------------|---------------------|-------------|-------------|
| `travel-api` | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | ~90 MB | 250m / 1000m | 256Mi / 512Mi | 2 | 15 |
| `fuji` | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | ~85 MB | 100m / 500m | 128Mi / 256Mi | 2 | 4 |
| OTel Collector sidecar | `otel/opentelemetry-collector` | ~60 MB | 50m / 200m | 64Mi / 128Mi | 1 per pod | — |

**Steady-state footprint** (3 travel-api + 2 fuji + sidecars):
- CPU: ~1.25 cores requested, ~4.5 cores limit
- Memory: ~1.2 GiB requested, ~2.7 GiB limit

#### Networking

- **Ingress**: Shared 12go ingress controller (nginx or ALB). New path rules for `/v1/{client_id}/*` and `/{client_id}/bookings/*` routed to `travel-api` ClusterIP service.
- **Internal**: `travel-api` → `frontend3.{namespace}.svc.cluster.local` over HTTP. Kubernetes DNS resolution. No service mesh required initially.
- **Egress**: Credit Line Service (HTTP), Ushba Revenue SDK (HTTP), Fuji Exchange Rates (HTTP). All internal to VPC.
- **Service mesh**: Not required unless 12go mandates mTLS between .NET and PHP pods. If required, Istio/Linkerd adds ~100m CPU per sidecar — budget accordingly.
- **Concern**: .NET `HttpClient` default connection pooling vs PHP-FPM's ephemeral connections create different load patterns on 12go's backend. Tune `SocketsHttpHandler.MaxConnectionsPerServer` carefully.

#### Storage

| Store | Type | Purpose | Size Estimate | Persistence |
|-------|------|---------|---------------|-------------|
| Redis | ElastiCache or in-cluster | Booking tokens, seat locks, search cache, rate limits | 512 MB max | None (volatile, all data ephemeral) |
| Kafka | Shared 12go cluster or MSK | 5 topics, 22 partitions total | ~10 GB retention | 7-day retention |

DynamoDB is **eliminated**. No persistent database required for Option A.

#### CI/CD Pipeline Design

```
Git push (.NET repo)
  → dotnet restore + build + test          (~3 min)
  → Docker build (multi-stage, alpine)      (~2 min)
  → Push to ECR                             (~1 min)
  → Deploy to staging (K8s apply)           (~2 min)
  → Run contract tests (Pact verification)  (~3 min)
  → Canary deploy (5% traffic)              (~1 min)
  → Monitor 15 min (automated gate)
  → Promote to 100%                         (~1 min)
─────────────────────────────────────────────
Estimated total: ~28 min (plus 15 min canary soak)
```

**Concern**: This is a **second CI/CD pipeline** separate from frontend3's PHP pipeline. The 12go ops team must maintain both. Two sets of build agents (or shared agents with both .NET SDK and PHP installed), two image registries, two deployment manifests.

#### Scaling Design

```yaml
# HPA for travel-api
scaleTargetRef: travel-api
minReplicas: 2
maxReplicas: 15
metrics:
  - cpu: averageUtilization: 60
```

- .NET is efficient for I/O-bound proxy workloads. Expect 1 pod to handle ~200-400 RPS for search (the dominant workload).
- Connection pooling to 12go: 50-100 persistent connections per pod via `SocketsHttpHandler`. At 15 pods max = 750-1500 concurrent connections to 12go. **Coordinate with 12go team — this is a real load concern.**
- Redis connection pooling: `StackExchange.Redis` multiplexes over 1-2 connections per pod. No concern.
- Kafka: 1 producer per pod, async batching. Negligible connection overhead.

#### Monitoring Stack

**What to monitor:**

| Signal | Tool | What |
|--------|------|------|
| Request RED metrics | Grafana (Prometheus) | Rate, errors, duration per endpoint per client |
| Upstream 12go health | Grafana | 12go response time, error rate, circuit breaker state |
| Booking funnel | Grafana | Conversion rates: search → checkout → reserve → confirm |
| Distributed traces | Coralogix | End-to-end request flow across .NET → 12go |
| Structured logs | Coralogix | Business-dimension-enriched logs (client_id, booking_id) |
| Infrastructure | Grafana | Pod CPU/memory, Redis memory, Kafka consumer lag |

**Alerting rules:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| Partner API error rate > 5% | 5 min window | Warning |
| Partner API error rate > 15% | 5 min window | Critical (page) |
| Booking error rate > 2% | 5 min window | Critical (page) |
| Search p95 > 3s | 10 min window | Warning |
| Redis unreachable | 30s | Critical (page) |
| Zero traffic during business hours | 5 min | Critical (page) |
| Circuit breaker open | 30s | Critical (page) |

**Strength**: Existing Grafana dashboards and Coralogix queries carry over with minimal changes. Same meter names, same tag keys. This is a real operational win.

#### Security

- **Secrets**: K8s Secrets or AWS Secrets Manager. Redis connection string, Kafka SASL credentials, API keys, AES encryption key for booking tokens.
- **Secret rotation**: Redis password rotation requires pod restart (or use AWS Secrets Manager + sidecar injector). Kafka SASL credentials rotated via JAAS config reload.
- **Network policies**: Restrict `travel-api` egress to: `frontend3` service, Redis, Kafka, credit-line service, OTel collector. Deny all other egress.
- **TLS**: All external traffic via TLS (ingress termination). Internal traffic plain HTTP unless service mesh is deployed.
- **Authentication**: API key validation in middleware. Keys stored in ConfigMap or K8s Secret.
- **Image security**: .NET Alpine base images need regular patching. **Two base image supply chains** (.NET + PHP) doubles the CVE scanning surface.
- **Attack surface**: Moderate. Standard REST API. Encrypted booking tokens (AES-256-GCM) protect against token tampering.

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Deployment Complexity | 3/5 | 2 containers + Redis + Kafka. Not complex, but it's a second stack on 12go's infra. |
| CI/CD Pipeline | 3/5 | Separate .NET pipeline required alongside PHP. Two build systems to maintain. |
| Scaling Characteristics | 4/5 | .NET scales well horizontally. Stateless design. Good auto-scaling triggers defined. |
| Resource Utilization | 4/5 | .NET is efficient for proxy workloads. ~1.2 GiB steady-state memory is reasonable. |
| Monitoring & Alerting | 5/5 | Best observability story. Existing dashboards carry over. Mature .NET OTel SDK. |
| Security | 3/5 | Two image supply chains. Two CVE scanning pipelines. Otherwise standard K8s security. |
| Disaster Recovery | 4/5 | Stateless design. Redis loss = temporary inconvenience (re-fetch booking tokens). 12go is source of truth. |
| Operational Overhead | 2/5 | Polyglot tax is real. Two language stacks, two mental models, two expertise requirements. |

---

### 2.2 Option B: PHP Native (Frontend3 Internal Bundle)

#### Container/Pod Specification

| Container | Image Base | Image Size | CPU Request/Limit | Memory Request/Limit | Min Replicas | Max Replicas |
|-----------|-----------|------------|-------------------|---------------------|-------------|-------------|
| `frontend3-partner` | Same as `frontend3` (PHP-FPM + Nginx) | ~30-50 MB (PHP) | 200m / 800m | 256Mi / 512Mi | 2 | 8 |
| `fuji` | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | ~85 MB | 100m / 500m | 128Mi / 256Mi | 2 | 4 |

**Key insight**: The partner pod group uses the **exact same Docker image** as the main frontend3 pods. Different Nginx config at runtime routes only `/partner/v1/*` traffic. This means:
- **Zero additional images to build** for the partner API
- **Zero additional base images to patch**
- **Zero additional CI pipelines** (ships with frontend3)

**Steady-state footprint** (2 partner pods + 2 fuji pods):
- CPU: ~0.6 cores requested, ~2.6 cores limit
- Memory: ~0.77 GiB requested, ~1.5 GiB limit

This is the **smallest footprint** of all three options.

**Fuji caveat**: Fuji remains .NET. If we truly want zero polyglot tax, Fuji's station/operator mapping would need to be absorbed into the PHP bundle (reading from 12go's MySQL directly). This is feasible and would eliminate the last .NET dependency, but adds ~1 week of work.

#### Networking

- **Ingress**: 12go's existing ingress controller. New hostname or path prefix (`partner-api.12go.com/*`) routes to `frontend3-partner` service.
- **Internal**: No inter-service HTTP calls for the partner API. All business logic is **in-process** (Symfony service calls). This eliminates an entire class of failure modes (network timeouts, DNS resolution, connection pooling between services).
- **External**: Credit Line Service (HTTP). The only external call from the partner bundle.
- **Service mesh**: Not needed. Same-process communication eliminates the need for mTLS between our code and frontend3.

**This is the simplest networking story.** One ingress rule. No inter-service communication. No service mesh. No connection pooling concerns.

#### Storage

| Store | Type | Purpose | Size Estimate | Persistence |
|-------|------|---------|---------------|-------------|
| MySQL | Shared with frontend3 | Bookings, trips, stations, operators, FX rates | Already provisioned | frontend3 manages |
| Redis | Shared with frontend3 | Cart state, seat locks, rate limiting | Already provisioned | frontend3 manages |
| Memcached | Shared with frontend3 | Query cache | Already provisioned | frontend3 manages |
| Kafka | Shared 12go cluster | 4-5 topics for booking events | ~10 GB retention | 7-day retention |

**No new data stores required.** The partner bundle uses frontend3's existing MySQL, Redis, and Memcached. This is a massive operational win — no new databases to provision, back up, monitor, or scale.

#### CI/CD Pipeline Design

```
Git push (frontend3 repo, includes PartnerApiBundle)
  → composer install + PHPUnit + PHPStan     (~4 min)
  → Docker build (same as frontend3)          (~3 min)
  → Push to ECR                               (~1 min)
  → Deploy frontend3-partner pods             (~2 min)
  → Run contract tests                        (~3 min)
  → Canary deploy (5% partner traffic)        (~1 min)
  → Monitor 15 min
  → Promote to 100%                           (~1 min)
─────────────────────────────────────────────
Estimated total: ~30 min (plus 15 min canary soak)
```

**The critical advantage**: This is **not a new pipeline**. The partner bundle's tests run inside frontend3's existing CI pipeline. The Docker image is the same. The deployment is a variant of the same Helm chart (or K8s manifests). The ops team maintains **one pipeline**, not two.

**Concern**: Deployment coupling. A bad frontend3 deploy could affect partner API pods. Mitigation: separate pod group with independent rollback. But the image is shared, so a broken image breaks both.

#### Scaling Design

- Partner pod group has its own HPA, independent of main frontend3 pods.
- PHP-FPM workers: Tune `pm.max_children` per partner pod. Expect 30-50 workers per pod. Each worker handles 1 concurrent request.
- At 2 pods × 40 workers = 80 concurrent requests capacity. At peak, scale to 8 pods × 40 = 320 concurrent.
- **No connection pooling concern to 12go** — there are no HTTP calls to 12go. The bundle calls frontend3 services in-process, which use the existing MySQL/Redis connections.
- Kafka: `php-rdkafka` producer initializes per FPM worker. Messages flushed on `kernel.terminate` (after response sent). Zero latency impact.

#### Monitoring Stack

**What to monitor:**

| Signal | Tool | What |
|--------|------|------|
| Request RED metrics | Grafana (Prometheus) | Rate, errors, duration per endpoint per client |
| Booking funnel | Grafana | Conversion rates per stage |
| PHP-FPM pool | Grafana | Active/idle workers, listen queue length, slow requests |
| Distributed traces | Coralogix | In-process spans (no inter-service hops to debug) |
| Structured logs | Coralogix | Monolog with business context |
| Infrastructure | Grafana | Pod CPU/memory, MySQL connections, Redis memory |

**Alerting rules**: Same as Option A, plus PHP-FPM-specific alerts:

| Alert | Condition | Severity |
|-------|-----------|----------|
| FPM listen queue > 10 | 1 min window | Warning (scale up) |
| FPM active workers > 90% of max | 2 min window | Warning (scale up) |
| FPM slow requests > 5/min | 5 min window | Warning |

**Weakness**: Existing .NET Grafana dashboards **do not carry over**. All dashboards, alerting rules, and Coralogix queries must be recreated for PHP metrics. This is a one-time cost but it's real — estimate 1-2 weeks of ops work.

#### Security

- **Secrets**: Same mechanism as frontend3 (K8s Secrets, env vars). No new secret stores.
- **Secret rotation**: Same process as frontend3. One rotation process, not two.
- **Network policies**: Partner pods have the same network profile as frontend3. No new egress rules needed (except credit line service).
- **TLS**: Handled by ingress. Internal traffic is in-process (no network).
- **Authentication**: API key validation in Symfony middleware.
- **Image security**: **One base image supply chain** (PHP). Half the CVE scanning surface of Option A/C.
- **Attack surface**: Smallest of all options. No inter-service network. In-process calls can't be intercepted.

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Deployment Complexity | 5/5 | Same image as frontend3. One pod group. No new infra. Simplest possible deployment. |
| CI/CD Pipeline | 5/5 | Ships with frontend3's existing pipeline. No new pipeline to maintain. |
| Scaling Characteristics | 3/5 | PHP-FPM is less efficient per-request than .NET. But adequate for expected traffic. Separate HPA. |
| Resource Utilization | 4/5 | Smallest footprint. Shares existing MySQL/Redis/Memcached. No new databases. |
| Monitoring & Alerting | 3/5 | Must rebuild all dashboards. PHP OTel is mature but existing .NET dashboards are lost. |
| Security | 5/5 | Single image supply chain. No inter-service network. Smallest attack surface. |
| Disaster Recovery | 5/5 | No new data stores. 12go's existing backup/recovery covers everything. Partner bundle failure = restart pods. |
| Operational Overhead | 5/5 | One language. One CI pipeline. One team. One mental model. Lowest ongoing ops cost. |

---

### 2.3 Option C: Thin Stateless API Gateway

#### Container/Pod Specification

| Container | Image Base | Image Size | CPU Request/Limit | Memory Request/Limit | Min Replicas | Max Replicas |
|-----------|-----------|------------|-------------------|---------------------|-------------|-------------|
| `gateway` | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | ~90 MB | 200m / 800m | 192Mi / 384Mi | 2 | 10 |
| `fuji` | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | ~85 MB | 100m / 500m | 128Mi / 256Mi | 2 | 4 |
| OTel Collector sidecar | `otel/opentelemetry-collector` | ~60 MB | 50m / 200m | 64Mi / 128Mi | 1 per pod | — |

**Steady-state footprint** (3 gateway + 2 fuji + sidecars):
- CPU: ~1.0 cores requested, ~3.8 cores limit
- Memory: ~1.0 GiB requested, ~2.2 GiB limit

Slightly smaller than Option A because the gateway has less business logic (no Kafka producer, simpler service layer), but same language stack and similar infrastructure pattern.

#### Networking

- **Ingress**: Same as Option A. 12go ingress routes partner API paths to `gateway` service.
- **Internal**: `gateway` → `frontend3` over HTTP (same as Option A). All the same connection pooling concerns apply.
- **External**: Credit Line Service (HTTP), Fuji (HTTP for station mapping).
- **Service mesh**: Same considerations as Option A.

#### Storage

| Store | Type | Purpose | Size Estimate | Persistence |
|-------|------|---------|---------------|-------------|
| Redis | ElastiCache or in-cluster | Seat locks, idempotency keys, search cache, pricing config | <100 MB | None (all TTL-based) |

**No Kafka** (or optional minimal Kafka for analytics). This is the most storage-minimal option. However, the "no Kafka" decision means:
- No durable event stream for booking lifecycle events
- Analytics/reconciliation systems lose their event feed
- If downstream systems depend on booking events, they need an alternative data source

**Concern**: The architecture doc says "No Kafka" but then lists optional Kafka for analytics. In practice, you'll need Kafka for booking events — reconciliation, analytics, and audit trails all depend on them. Budget for it.

#### CI/CD Pipeline Design

```
Git push (gateway repo)
  → dotnet restore + build + test          (~2 min, smaller project)
  → Docker build (multi-stage, alpine)      (~2 min)
  → Push to ECR                             (~1 min)
  → Deploy to staging (K8s apply)           (~2 min)
  → Run contract tests                      (~3 min)
  → Canary deploy (5% traffic)              (~1 min)
  → Monitor 15 min
  → Promote to 100%                         (~1 min)
─────────────────────────────────────────────
Estimated total: ~27 min (plus 15 min canary soak)
```

Same polyglot pipeline problem as Option A: a separate .NET CI/CD pipeline alongside frontend3's PHP pipeline.

#### Scaling Design

- Nearly identical to Option A. Horizontal scaling is trivial because the gateway is almost stateless.
- The self-contained encrypted BookingToken means no server-side state for the booking flow (except seat locks and idempotency).
- Connection pooling to 12go: Same concerns as Option A. 50-100 connections per pod.
- **Key difference from Option A**: No Kafka producer overhead. Slightly faster cold starts. Slightly smaller memory footprint.

#### Monitoring Stack

Similar to Option A but with fewer business metrics (no Kafka lag, no DynamoDB metrics). The gateway's observability is focused on:
- Request RED metrics per endpoint
- 12go upstream health
- Redis health (seat locks, idempotency)
- Booking funnel conversion

**Weakness vs Option A**: Fewer historical data points. Without Kafka events and a local data store, diagnosing "what happened to booking X last Tuesday" relies entirely on log and trace retention in Coralogix.

#### Security

- Same as Option A: two image supply chains, two CVE scanning pipelines.
- **Additional concern**: Self-contained encrypted BookingTokens are a clever stateless pattern, but they create a new security surface:
  - AES-256-GCM key rotation requires coordinated deployment (old tokens must remain valid during rotation window)
  - Token replay attacks — expiration check is the only defense
  - If the encryption key is compromised, all booking tokens are exposed (contains cartId, prices, client config)

#### Scores

| Criterion | Score | Rationale |
|-----------|:-----:|-----------|
| Deployment Complexity | 4/5 | Fewer containers than Option A (no Kafka producer complexity). But still a .NET container on PHP infra. |
| CI/CD Pipeline | 3/5 | Same polyglot pipeline problem as Option A. Separate .NET build. |
| Scaling Characteristics | 4/5 | Most stateless design. Scales trivially. Self-contained tokens eliminate Redis as scaling bottleneck. |
| Resource Utilization | 4/5 | Smallest .NET footprint. <100 MB Redis. No database. |
| Monitoring & Alerting | 4/5 | Simple single-service traces. But limited historical data without Kafka event stream. |
| Security | 3/5 | Two image supply chains. BookingToken encryption adds a key management concern. |
| Disaster Recovery | 3/5 | Redis loss = seat locks lost (recoverable) + idempotency lost (risk of double-booking on retries). No local booking data means if 12go is down, you're blind. |
| Operational Overhead | 3/5 | Simpler than Option A (fewer components), but still polyglot. Gateway is "thin" today but scope creep is a real risk. |

---

## 3. Comparison Matrix

| Criterion | Option A (Trimmed .NET) | Option B (PHP Native) | Option C (Thin Gateway) |
|-----------|:-----------------------:|:---------------------:|:-----------------------:|
| **Deployment Complexity** | 3 | **5** | 4 |
| **CI/CD Pipeline** | 3 | **5** | 3 |
| **Scaling Characteristics** | 4 | 3 | **4** |
| **Resource Utilization** | 4 | **4** | 4 |
| **Monitoring & Alerting** | **5** | 3 | 4 |
| **Security** | 3 | **5** | 3 |
| **Disaster Recovery** | 4 | **5** | 3 |
| **Operational Overhead** | 2 | **5** | 3 |
| **Total** | **28** | **35** | **28** |

Option B leads by 7 points. The gap is driven entirely by the elimination of the polyglot tax (CI/CD, security, operational overhead, deployment complexity).

---

## 4. Infrastructure Cost Estimate

Rough monthly cost estimates assuming AWS EKS, us-east-1 pricing, production + staging environments.

### Option A: Trimmed .NET

| Component | Specification | Monthly Cost (est.) |
|-----------|-------------|-------------------|
| **Compute (travel-api)** | 3 pods × (250m CPU, 256Mi) steady-state, burst to 15 pods | $80–$250 |
| **Compute (fuji)** | 2 pods × (100m CPU, 128Mi) | $30–$50 |
| **Redis (ElastiCache)** | cache.t4g.small (512 MB), single node | $25 |
| **Kafka** | Shared cluster (proportional share of 5 topics, 22 partitions) | $50–$100 |
| **Monitoring (Coralogix)** | ~50 GB logs/month + traces | $150–$300 |
| **Monitoring (Grafana Cloud)** | Metrics (included in existing plan likely) | $0–$50 |
| **ECR** | 2 images, ~10 versions retained | $5 |
| **Load balancer** | Shared ALB (proportional) | $20 |
| **Data transfer** | Internal VPC, minimal | $10 |
| **Total** | | **$370–$810/month** |

### Option B: PHP Native

| Component | Specification | Monthly Cost (est.) |
|-----------|-------------|-------------------|
| **Compute (partner pods)** | 2 pods × (200m CPU, 256Mi) steady-state, burst to 8 | $50–$150 |
| **Compute (fuji)** | 2 pods × (100m CPU, 128Mi) — can potentially eliminate | $30–$50 |
| **MySQL** | Shared with frontend3 — **no additional cost** | $0 |
| **Redis** | Shared with frontend3 — **no additional cost** | $0 |
| **Memcached** | Shared with frontend3 — **no additional cost** | $0 |
| **Kafka** | Shared cluster (4 topics) | $40–$80 |
| **Monitoring (Coralogix)** | ~30 GB logs/month + traces | $100–$200 |
| **Monitoring (Grafana Cloud)** | Metrics | $0–$50 |
| **ECR** | 0 additional images (same as frontend3) | $0 |
| **Load balancer** | Shared ALB (proportional) | $20 |
| **Data transfer** | Minimal (in-process calls) | $5 |
| **Total** | | **$245–$555/month** |

### Option C: Thin Gateway

| Component | Specification | Monthly Cost (est.) |
|-----------|-------------|-------------------|
| **Compute (gateway)** | 3 pods × (200m CPU, 192Mi) steady-state, burst to 10 | $60–$200 |
| **Compute (fuji)** | 2 pods × (100m CPU, 128Mi) | $30–$50 |
| **Redis (ElastiCache)** | cache.t4g.micro (100 MB), single node | $15 |
| **Kafka** | None or minimal (optional analytics) | $0–$50 |
| **Monitoring (Coralogix)** | ~40 GB logs/month + traces | $120–$250 |
| **Monitoring (Grafana Cloud)** | Metrics | $0–$50 |
| **ECR** | 2 images | $5 |
| **Load balancer** | Shared ALB (proportional) | $20 |
| **Data transfer** | Internal VPC + 12go API calls | $15 |
| **Total** | | **$265–$640/month** |

### Cost Comparison Summary

| | Option A | Option B | Option C |
|---|:---:|:---:|:---:|
| Monthly infra cost | $370–$810 | **$245–$555** | $265–$640 |
| New infra to provision | Redis, .NET CI agents | None (or minimal) | Redis |
| Shared infra reuse | Kafka only | MySQL, Redis, Memcached, Kafka, CI/CD | Kafka (optional) |

Option B wins on cost because it **reuses all of frontend3's existing infrastructure**. No new databases, no new caches, no new CI pipelines.

---

## 5. The Polyglot Tax

This is the single most important operational consideration. Let me quantify it.

### What "Running .NET alongside PHP" Actually Costs

| Tax Item | Annual Cost Estimate | Applies To |
|----------|---------------------|-----------|
| **Two base image supply chains** — .NET Alpine + PHP-FPM. Each needs: CVE scanning, base image updates (monthly), Dockerfile maintenance, runtime config tuning | 2-4 weeks/year ops time | Option A, C |
| **Two CI/CD pipeline templates** — .NET (`dotnet build/test/publish`) + PHP (`composer install/phpunit/phpstan`). Different caching strategies, different artifact formats, different build agents or multi-runtime agents | 1-2 weeks/year maintenance | Option A, C |
| **Two dependency management systems** — NuGet + Composer. Different vulnerability databases, different update tools (Dependabot configs), different lock file formats | 1 week/year maintenance | Option A, C |
| **Two security scanning pipelines** — Snyk/Trivy for .NET packages + PHP packages. Different vulnerability databases, different remediation workflows | 1 week/year security eng time | Option A, C |
| **Team expertise split** — On-call engineers must debug both .NET GC pauses and PHP-FPM pool exhaustion. Different profiling tools (dotnet-dump vs. Xdebug). Different log formats. Different error patterns. | 2-4 weeks/year in slower incident response | Option A, C |
| **Knowledge silos** — "Only Soso knows the .NET services" or "Only the 12go team knows PHP." Bus factor of 1 for each stack. | Unquantifiable but real | Option A, C |

**Conservative estimate: 8-12 weeks/year of additional operational overhead for polyglot.**

### The "Temporary" Bridge Trap

Option A's architecture doc explicitly calls .NET a "medium-term (12-18 month) bridge." In my 10 years of production ops, I have never seen a "temporary" bridge actually get decommissioned on schedule. Here's how it usually plays out:

```
Month 1-4:   Build and deploy .NET bridge. "We'll rewrite in PHP next quarter."
Month 5-8:   .NET bridge works great. New features added directly. "No rush to rewrite."
Month 9-12:  Team turnover. New engineers learn .NET. Rewrite deprioritized.
Month 13-18: .NET bridge is now "the system." Rewrite effort estimated at 3 months.
Month 19-24: Product priorities take precedence. Rewrite pushed to next year.
Year 3+:     .NET bridge is permanent. You're paying the polyglot tax forever.
```

**Option B eliminates this trap entirely.** There is no bridge. There is no "temporary" code. It's PHP from day one.

### Cost of Rewriting in PHP vs. Paying the Tax

| | One-time rewrite cost | Ongoing polyglot tax (annual) | Break-even |
|---|:---:|:---:|:---:|
| Option A → PHP rewrite later | 15-20 person-weeks | 8-12 weeks/year | Year 1-2 |
| Option B (PHP from start) | 17 person-weeks (includes 2w ramp-up) | $0 | Immediate |
| Option C → PHP rewrite later | 10-15 person-weeks | 8-12 weeks/year | Year 1 |

**The math is clear**: Paying 2 extra weeks now (Option B vs Option A) saves 8-12 weeks every year going forward.

---

## 6. Kafka Migration Strategy

This applies to all three options. The plan is to consolidate 30+ topics down to ~5.

### Phase 1: Audit (Week 1)

Before touching anything, determine who is consuming what:

```bash
# For each topic, list consumer groups
kafka-consumer-groups --bootstrap-server $KAFKA_BROKER --list

# For each consumer group, check which topics they consume and their lag
kafka-consumer-groups --bootstrap-server $KAFKA_BROKER \
  --group $GROUP --describe
```

**Critical question**: Does 12go consume any of our topics (`BookSucceeded`, `ReservationChanged`)? If yes, those topics cannot be deleted until 12go migrates their consumers.

### Phase 2: Create New Topics (Week 2)

```bash
# Create consolidated topics with proper partitioning
kafka-topics --create --topic booking.lifecycle \
  --partitions 6 --replication-factor 3 --config retention.ms=604800000

kafka-topics --create --topic booking.status_change \
  --partitions 6 --replication-factor 3 --config retention.ms=604800000

kafka-topics --create --topic booking.notification \
  --partitions 3 --replication-factor 3 --config retention.ms=259200000

kafka-topics --create --topic content.entity_sync \
  --partitions 3 --replication-factor 3 --config retention.ms=259200000

kafka-topics --create --topic integration.config \
  --partitions 1 --replication-factor 3 --config retention.ms=604800000
```

### Phase 3: Dual-Write (Weeks 3-4)

Producers write to **both** old and new topics simultaneously. This ensures:
- Old consumers continue working on old topics
- New consumers can start reading from new topics
- Zero data loss during migration

**Monitor**: Consumer lag on old topics should remain stable. Consumer lag on new topics should be near zero (new consumers just started).

### Phase 4: Consumer Migration (Weeks 5-6)

Migrate each consumer group from old topic → new topic:

1. Deploy new consumer reading from `booking.lifecycle` (new schema with `eventType` discriminator)
2. Verify new consumer processes events correctly
3. Stop old consumer reading from `BookSucceeded`
4. Monitor lag on old topic → should stop increasing
5. Repeat for each consumer

### Phase 5: Topic Cleanup (Week 7-8)

1. Stop dual-writing to old topics
2. Wait for retention period to expire (7 days)
3. Delete old topics
4. Remove old producer code

### Kafka Health Monitoring During Transition

| Metric | Alert Condition | Action |
|--------|----------------|--------|
| Consumer lag (new topics) | > 1000 messages for 5 min | Check consumer health, scale consumers |
| Consumer lag (old topics) | Increasing after consumer migration | Consumer not fully migrated |
| Producer error rate | > 1% | Check Kafka broker health |
| Under-replicated partitions | > 0 for 5 min | Broker issue — check disk/network |
| Topic message rate (old) | > 0 after dual-write stopped | Rogue producer still writing |

### Topic Retention and Cleanup

| Topic | Retention | Cleanup Policy | Compaction |
|-------|-----------|---------------|------------|
| `booking.lifecycle` | 7 days | delete | No |
| `booking.status_change` | 7 days | delete | No |
| `booking.notification` | 3 days | delete | No |
| `content.entity_sync` | 3 days | delete | No |
| `integration.config` | 7 days | compact | Yes (latest config per key) |

---

## 7. Database Migration Plan

### DynamoDB → Elimination (Options A & C)

Both Option A and C eliminate DynamoDB entirely. 12go is the source of truth for bookings, and Redis handles ephemeral state.

**Migration steps:**

1. **Identify all DynamoDB table access patterns** — ItineraryCache, PreBookingCache, BookingCache, BookingEntity.
2. **Map each to new storage** — All 4 tables map to either Redis (TTL-based) or "no storage needed" (proxy to 12go).
3. **Dual-read period (2 weeks)** — New service reads from both DynamoDB and new storage. Log any discrepancies.
4. **Cut over reads** — Stop reading from DynamoDB.
5. **Stop writes** — Stop writing to DynamoDB.
6. **Retain DynamoDB for 30 days** — Safety net. Data is accessible if rollback needed.
7. **Delete DynamoDB tables** — After 30 days of stable operation.

**Data loss risk**: None. DynamoDB data is all cache/ephemeral. 12go is the source of truth for bookings.

### DynamoDB → MySQL (Option B)

Option B doesn't need a separate migration — frontend3 already stores bookings in MySQL. The partner bundle reads directly from the same tables. No data migration required.

### Validation

For all options:
- Compare booking details from new path vs. old path for the same booking IDs
- Run for at least 1 week of parallel operation
- Track: field-level match rate, latency comparison, error rate comparison

---

## 8. Day-2 Operations Runbook (Option B — Recommended)

This runbook is for the on-call engineer at 3 AM.

### How to Deploy a New Version

```bash
# 1. Check current status
kubectl get deployment frontend3-partner -n 12go
kubectl rollout status deployment/frontend3-partner -n 12go

# 2. Deploy new version (same image as frontend3 main)
kubectl set image deployment/frontend3-partner \
  frontend3=ECR_REPO/frontend3:$NEW_TAG -n 12go

# 3. Watch rollout
kubectl rollout status deployment/frontend3-partner -n 12go --timeout=300s

# 4. Verify health
kubectl get pods -l app=frontend3-partner -n 12go
curl -s https://partner-api.12go.com/health | jq .
```

### How to Roll Back

```bash
# Immediate rollback to previous revision
kubectl rollout undo deployment/frontend3-partner -n 12go

# Verify rollback
kubectl rollout status deployment/frontend3-partner -n 12go
kubectl get pods -l app=frontend3-partner -n 12go

# Check that traffic is healthy
# (watch Grafana dashboard: Partner API Health)
```

**RTO**: < 2 minutes. Kubernetes rollback is instant.

### How to Scale Up/Down

```bash
# Manual scale (for emergencies)
kubectl scale deployment/frontend3-partner --replicas=6 -n 12go

# Check HPA status
kubectl get hpa frontend3-partner-hpa -n 12go

# Adjust HPA limits
kubectl patch hpa frontend3-partner-hpa -n 12go \
  --patch '{"spec":{"maxReplicas":12}}'
```

### How to Rotate Secrets

```bash
# 1. Update K8s secret
kubectl create secret generic partner-api-secrets \
  --from-literal=API_KEY_HASH_ACME=$NEW_HASH \
  --from-literal=CREDIT_LINE_API_KEY=$NEW_KEY \
  --dry-run=client -o yaml | kubectl apply -n 12go -f -

# 2. Restart pods to pick up new secrets
kubectl rollout restart deployment/frontend3-partner -n 12go

# 3. Verify
kubectl rollout status deployment/frontend3-partner -n 12go
curl -H "x-api-key: $NEW_CLIENT_KEY" \
  https://partner-api.12go.com/partner/v1/test/stations | head -c 200
```

### How to Debug a Failed Booking

**Step 1: Get the booking ID and client ID from the alert or client report.**

**Step 2: Search Coralogix logs.**

```
client_id:"acme" AND booking_id:"BK-12345"
```

This returns all log entries for that booking, in chronological order, with trace IDs.

**Step 3: Click through to the trace.**

In Coralogix, click the `trace_id` from any log entry. You'll see the full request trace:
- `partner.booking.reserve` span (our code)
  - `BookingProcessor.createBookingsAndSetIds` span (frontend3 internal)
  - `BookingProcessor.reserveBookings` span (frontend3 → 12go suppliers)

**Step 4: Check common failure reasons.**

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| 409 Conflict on reserve | Trip sold out / cart expired | Check cart TTL vs. client booking speed |
| 402 Payment Required | Credit line exhausted | Check credit line balance for client |
| 500 Internal Server Error | Frontend3 bug or MySQL issue | Check frontend3 error logs, MySQL connection pool |
| 504 Gateway Timeout | 12go upstream supplier slow | Check upstream latency dashboard |
| Price mismatch logged | 12go price changed between search and book | Check `partner_api.booking.price_mismatch` metric |

**Step 5: If the booking is stuck in "reserved" (not confirmed):**

```bash
# Check booking status in 12go's MySQL
kubectl exec -it $(kubectl get pods -l app=frontend3-partner -n 12go -o name | head -1) \
  -n 12go -- php bin/console app:check-booking --id=BK-12345
```

### How to Handle a 12go Outage

**If 12go is completely down (all API endpoints returning 5xx or timeout):**

1. **Confirm the outage**: Check the "Upstream (12go) Health" dashboard. Circuit breaker state should be "open."

2. **There is nothing we can do.** The partner API is a proxy/adapter — if the backend is down, we're down. This is by design (12go is the source of truth).

3. **What clients will see**:
   - Search: 502 Bad Gateway (or cached results if search cache is enabled)
   - Booking: 502 Bad Gateway
   - GetBookingDetails: 502 (reads from MySQL directly, but if MySQL is also down...)
   - Stations/Operators: Cached (should still work from Fuji cache)

4. **Actions**:
   - Notify affected clients via status page / Slack
   - Monitor 12go's recovery via circuit breaker dashboard
   - When circuit breaker transitions to "half-open," watch for the first successful requests
   - Once stable, verify: booking funnel conversion rate returns to baseline

5. **Post-incident**: Check for in-flight bookings that may have partially completed during the outage. Query Coralogix for `status_code:502 AND endpoint:booking` during the outage window.

**If 12go is degraded (some endpoints slow, intermittent errors):**

1. Check per-endpoint error rates on the 12go Health dashboard
2. If search is slow but booking works → acceptable degradation, monitor
3. If booking is failing → **alert clients**, especially for confirm failures (risk of money taken but booking not confirmed)
4. Consider temporarily increasing timeouts for affected endpoints
5. Never automatically retry booking write operations — only the client should decide to retry

---

## 9. Recommendation

**Option B (PHP Native Bundle) is the best choice from a DevOps/platform perspective.**

### Why

1. **Smallest operational footprint**: Same Docker image as frontend3. No new databases. No new caches. No new CI pipelines. The incremental infrastructure cost is near zero.

2. **Eliminates the polyglot tax**: One language, one CI/CD system, one dependency management system, one security scanning pipeline, one team expertise. This saves 8-12 weeks/year in operational overhead.

3. **Best disaster recovery**: No new data stores to lose. Frontend3's existing MySQL backup covers everything. Pod failure = restart pod. Image failure = rollback to previous tag. That's it.

4. **Lowest blast radius**: Separate pod group means partner traffic issues don't affect main 12go traffic. But since it's the same image, the partner pods benefit from frontend3's battle-tested infrastructure.

5. **12go team can own it**: PHP is their language. They can debug, patch, and scale it without learning a new stack. This matters at 3 AM.

### Caveats

- **Depends on 12go accepting the bundle approach** (Q1). If they refuse code contributions to frontend3, fall back to Option C.
- **Dashboard rebuild required**: Existing .NET Grafana dashboards don't carry over. Budget 1-2 weeks of ops work.
- **Fuji remains .NET**: To truly eliminate the polyglot tax, Fuji's station mapping needs to be absorbed into PHP. This is a follow-up task, not a blocker.
- **Deployment coupling**: A bad frontend3 deploy can affect partner pods (same image). Mitigation: independent rollback per pod group, canary deploys, contract tests in CI.

### If Not Option B

If Option B is rejected by 12go, my second choice is **Option C (Thin Gateway)** — but only if the team commits to a strict scope boundary. The moment the gateway exceeds ~150 source files, stop and reevaluate whether you're just building a worse version of Option A.

Option A is my last choice. It works, it's the fastest to build, and it preserves observability. But it institutionalizes the polyglot tax, and in my experience, "temporary" polyglot architectures become permanent ones.
