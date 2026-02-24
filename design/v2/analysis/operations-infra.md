---
status: draft
last_updated: 2026-02-24
depends_on: design/v2/evaluation-criteria.md
---

# Analysis v2: Operations and Infrastructure

## Executive Summary

This analysis re-evaluates all five design options (A, B1, B2, B3, B4) against the refined criteria in [evaluation-criteria.md](../evaluation-criteria.md), focusing on the three operations-related dimensions: **Infrastructure Fit**, **Operational Complexity**, and **Monitoring/Observability**.

**Key Findings:**
- **Design A (Monolith PHP)** remains the strongest on all three criteria—zero new infrastructure, lowest operational overhead, and native Datadog integration.
- **Design B2 (Micro PHP)** is the best microservice option for operations: same stack as 12go, minimal DevOps learning curve.
- **Design B4 (Micro TypeScript)** offers excellent observability and moderate operational complexity; Node.js is widely understood.
- **Design B1 (Micro .NET)** and **Design B3 (Micro Go)** introduce new runtimes to 12go's PHP/Go ecosystem, increasing operational complexity for 12go's DevOps team.

**Reference:** Previous analysis at [v1 operations-infra](../../v1/analysis/operations-infra.md).

---

## Criteria Reference (from evaluation-criteria.md)

| Criterion | Weight | What 5 Looks Like | What 1 Looks Like |
|-----------|--------|-------------------|-------------------|
| **Infrastructure Fit** | x3 | Drops into existing infra seamlessly | Requires new infrastructure |
| **Operational Complexity** | x2 | Single deployment, Datadog integration | Multiple deployments, custom tooling |
| **Monitoring/Observability** | x1 | Native Datadog support, full tracing | Manual instrumentation needed |

---

## Detailed Scoring by Option

### A: Monolith (PHP/Symfony)

#### Infrastructure Fit: 5/5 (Weighted: 15)

**Rationale:** The B2B API is implemented as a Symfony bundle inside `frontend3`. It deploys as part of the existing application on 12go's 8 EC2 instances. No new containers, no new resource limits, no capacity planning. The solution literally *is* the existing infrastructure. 12go's DevOps team does not need to learn anything new—they already deploy PHP-FPM and manage the frontend3 release pipeline.

**What could lower this:** Nothing. This is the definition of "drops into existing infra seamlessly."

---

#### Operational Complexity: 5/5 (Weighted: 10)

**Rationale:** No new CI/CD pipelines. No new repositories to build or test. Configuration uses the existing `.env` and DB-stored configs. Deployment is a single `frontend3` release. On-call engineers already know how to debug PHP/Symfony—no new runtimes to troubleshoot. Local development is "run frontend3" with no additional containers.

**Trade-off:** B2B releases are coupled to the main 12go site. Deploying B2B changes requires a full frontend3 release. This is simpler operationally but less independent.

---

#### Monitoring/Observability: 5/5 (Weighted: 5)

**Rationale:** The B2B API runs in the same process as the rest of 12go. Datadog APM (`dd-trace-php`) and log streams are already configured. Correlation IDs propagate in-process—no cross-service header propagation needed. Tracing, logging, and metrics are identical to the existing 12go stack. Zero additional instrumentation.

---

**Subtotal (Operations criteria only):** 30

---

### B1: Microservice (.NET 8)

#### Infrastructure Fit: 4/5 (Weighted: 12)

**Rationale:** .NET 8 AOT produces a ~90MB container image, competitive with PHP and smaller than Node.js. It runs as a standard Docker container on EC2—no special infrastructure. However, 12go's platform is primarily PHP and Go. Adding a .NET runtime means:
- New base image to maintain (or reliance on Microsoft's official images)
- Different debugging tools (no `php -i`, no `go tool`)
- Potential resistance from 12go DevOps ("we don't run .NET here")

**What would make it 5:** If 12go already runs .NET services or has explicit buy-in to support it. The migration-strategy open question (G4) asks: "Will 12go DevOps support a .NET 8 Docker container on their infra?"

---

#### Operational Complexity: 3/5 (Weighted: 6)

**Rationale:** Requires .NET-specific build agents (or GitHub Actions with `setup-dotnet`). 12go's CI/CD may need new steps: `dotnet restore`, `dotnet publish`, Docker build with .NET SDK. Runtime debugging—stack traces, memory dumps, thread analysis—uses different tools than PHP/Go. On-call engineers unfamiliar with .NET will have a steeper learning curve. The transition team knows .NET, but the solution may need to be maintained by different people in 6+ months (per evaluation guidelines).

**Mitigating factors:** .NET 8 is mature; documentation and community support are strong. AOT reduces startup time and image size, making it "feel" more like Go.

---

#### Monitoring/Observability: 4/5 (Weighted: 4)

**Rationale:** Datadog provides `dd-trace-dotnet` with automatic instrumentation for HTTP, database, and outbound calls. OpenTelemetry is well-supported. Correlation ID propagation requires explicit middleware but is straightforward. Structured logging (e.g., Serilog) integrates with Datadog. The gap vs. 5: requires configuration (OTel setup, trace sampling, log enrichment) that PHP/Node get "for free" from their existing 12go setup.

---

**Subtotal (Operations criteria only):** 22

---

### B2: Microservice (PHP/Symfony)

#### Infrastructure Fit: 5/5 (Weighted: 15)

**Rationale:** PHP-FPM on Alpine is the same stack 12go already runs. The B2B microservice uses the same base image patterns, same process model, same resource profiles. 12go DevOps can add a new container to the EC2 fleet using the exact same playbook as frontend3. No new runtimes, no new base images. "Drops into existing infra seamlessly" applies fully.

---

#### Operational Complexity: 4/5 (Weighted: 8)

**Rationale:** Requires a new repository and CI/CD pipeline (build, test, push image, deploy). However, the stack is identical—PHP, Composer, Symfony. 12go's existing deployment tooling can be reused or cloned. Debugging uses the same tools (Xdebug, Monolog, `dd`). The -1 is for the additional moving part: one more service to deploy, monitor, and scale independently. Local dev needs another container in `docker-compose.yml`.

---

#### Monitoring/Observability: 5/5 (Weighted: 5)

**Rationale:** Uses `dd-trace-php` and Monolog Datadog handlers—identical to the monolith. Correlation IDs propagate via HTTP headers to 12go calls; the same patterns 12go uses for internal services. No new instrumentation stack. Full tracing out of the box.

---

**Subtotal (Operations criteria only):** 28

---

### B3: Microservice (Go)

#### Infrastructure Fit: 5/5 (Weighted: 15)

**Rationale:** Single ~20MB static binary in a scratch or distroless container. Smallest image, fastest startup (<100ms), lowest memory footprint (~10MB idle). Fits on any EC2 instance with headroom. 12go is reportedly considering Go for future work (per Future Extensibility criterion), so the runtime may already exist or be planned. From a pure infrastructure perspective, Go is the most efficient option.

**Caveat:** If 12go does not yet run Go services, this introduces a new runtime. The evaluation criteria note "12go's future direction (possibly Go)"—so infrastructure fit is strong either way.

---

#### Operational Complexity: 3/5 (Weighted: 6)

**Rationale:** New language for the transition team (3–4 .NET developers) and potentially for 12go's current DevOps. Build pipeline needs `go build` or multi-stage Docker. Debugging uses `pprof`, `delve`, or core dumps—different from PHP/.NET. On-call runbooks would need to be written from scratch. The evaluation guidelines state the solution may need to be maintained by different people in 6+ months; if those people are 12go's PHP-focused team, Go adds cognitive load.

---

#### Monitoring/Observability: 4/5 (Weighted: 4)

**Rationale:** `dd-trace-go` provides automatic instrumentation. Structured logging via `slog` (Go 1.21+) or `zerolog` integrates with Datadog. OpenTelemetry support exists. Correlation ID propagation is standard. The -1: slightly less "batteries included" than Node.js/PHP for observability; some manual span creation may be needed for custom business logic.

---

**Subtotal (Operations criteria only):** 25

---

### B4: Microservice (TypeScript/Node.js)

#### Infrastructure Fit: 4/5 (Weighted: 12)

**Rationale:** Node.js is widely used and well-understood. Container size ~150MB (Alpine + Node). Fits standard Docker/EC2 patterns. However, 12go's stack is PHP (and possibly Go)—Node.js is another runtime. No evidence that 12go currently runs Node services. Adding it means new base images, new process model (event loop vs. FPM/threads), and another language in the fleet. Good, but not seamless.

---

#### Operational Complexity: 4/5 (Weighted: 8)

**Rationale:** Mature build tools (npm/pnpm, `node --experimental-vm-modules`). CI/CD with Node is straightforward. Any full-stack developer can debug Node—stack traces, `console.log`, Chrome DevTools. Familiar to many. The -1: still a new service to deploy and operate; plus Node's event loop can cause subtle production issues (blocking the loop) that require some expertise to diagnose.

---

#### Monitoring/Observability: 5/5 (Weighted: 5)

**Rationale:** Node.js has the most mature OpenTelemetry ecosystem. `dd-trace-js` provides automatic instrumentation for HTTP, database drivers, and many frameworks. Correlation IDs, distributed tracing, and structured logging are first-class. Many teams use Node specifically for its observability story. Matches "Native Datadog support, full tracing."

---

**Subtotal (Operations criteria only):** 25

---

## Comparative Scoring Matrix

| Criterion (Weight) | A: Monolith-PHP | B1: Micro-.NET | B2: Micro-PHP | B3: Micro-Go | B4: Micro-TS |
|--------------------|-----------------|----------------|---------------|--------------|--------------|
| Infrastructure Fit (x3) | 5 (15) | 4 (12) | 5 (15) | 5 (15) | 4 (12) |
| Operational Complexity (x2) | 5 (10) | 3 (6) | 4 (8) | 3 (6) | 4 (8) |
| Monitoring/Observability (x1) | 5 (5) | 4 (4) | 5 (5) | 4 (4) | 5 (5) |
| **Total Weighted Score** | **30** | **22** | **28** | **25** | **25** |

---

## Infrastructure Fit & Resource Summary

| Metric | A: Monolith | B1: .NET | B2: PHP | B3: Go | B4: TS |
|--------|-------------|----------|---------|--------|--------|
| Image Size | N/A | ~90MB | ~150MB | ~20MB | ~150MB |
| Startup Time | N/A | <1s | <1s | <0.1s | ~2s |
| New Runtime for 12go? | No | Yes (.NET) | No | Possibly (Go) | Yes (Node) |
| DevOps Familiarity | Full | Low | Full | Medium | Medium |

---

## Summary by Operations Lens

- **Best for zero operational overhead:** A (Monolith PHP)
- **Best microservice for 12go alignment:** B2 (Micro PHP)
- **Best for observability among microservices:** B2 and B4 (tie)
- **Highest operational risk:** B1 and B3 (new runtimes, higher on-call burden)

The scores align with the original analysis. The v2 document adds explicit rationale tied to the evaluation-criteria definitions and the constraint that "12go's DevOps manages infrastructure—we don't."
