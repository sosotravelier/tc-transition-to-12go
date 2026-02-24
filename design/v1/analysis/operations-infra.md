# Analysis: Operations and Infrastructure

## Executive Summary

This analysis evaluates all proposed designs and language variants from an operations, infrastructure, and observability perspective. The goal is to identify the solution that fits best with 12go's existing EC2/Docker infrastructure while minimizing operational burden and maximizing visibility.

**Key Findings:**
- **Design A (Monolith PHP)** offers the lowest operational overhead as it requires zero new infrastructure and leverages existing deployment pipelines.
- **Design B (Microservice PHP)** provides the best balance of independence and infrastructure alignment.
- **Design B (Microservice .NET 8)** is viable but adds language diversity to the platform, potentially complicating future maintenance by 12go's core team.
- **Design B (Microservice Go)** offers the most efficient resource footprint but introduces a new runtime to the ecosystem.
- **Design B (Microservice TypeScript)** has excellent modern observability support but is yet another runtime choice.

---

## Comparison by Design/Language

### A: Monolith (PHP/Symfony)
- **Infrastructure Fit (5/5)**: Perfect. Deploys as part of `frontend3` on 12go's 8 EC2 instances. No new containers or resource limits to manage.
- **Operational Complexity (5/5)**: Lowest. No new CI/CD pipelines. Uses existing `.env` and DB-stored configs.
- **Monitoring/Observability (5/5)**: Native. Injected into 12go's existing Datadog APM and log streams automatically.

### B: Microservice (PHP/Symfony)
- **Infrastructure Fit (5/5)**: Excellent. PHP-FPM on Alpine is well-understood by 12go DevOps. Fits naturally into their Docker/EC2 patterns.
- **Operational Complexity (4/5)**: Moderate. Requires a new repository and CI/CD pipeline, but the stack matches the platform.
- **Monitoring/Observability (5/5)**: Native. Uses `dd-trace-php` and Monolog Datadog handlers, identical to the monolith.

### B: Microservice (.NET 8)
- **Infrastructure Fit (4/5)**: Good. Using .NET 8 AOT reduces image size to ~90MB, making it competitive with Go/PHP.
- **Operational Complexity (3/5)**: Higher. Requires .NET-specific build agents and knowledge. 12go DevOps may find it harder to debug runtime issues.
- **Monitoring/Observability (4/5)**: Good. Requires `dd-trace-dotnet` and OpenTelemetry configuration.

### B: Microservice (Go)
- **Infrastructure Fit (5/5)**: Excellent. Single ~20MB static binary in a scratch container. Fastest startup and lowest resource footprint.
- **Operational Complexity (3/5)**: Higher. New language for the transition team and potentially for 12go's current DevOps workflows.
- **Monitoring/Observability (4/5)**: Good. Uses `dd-trace-go` and structured `slog` output.

### B: Microservice (TypeScript/Node.js)
- **Infrastructure Fit (4/5)**: Good. Moderate container size (~150MB). Node.js is widely used, but another runtime to manage.
- **Operational Complexity (4/5)**: Moderate. Mature build tools (npm/pnpm). Familiar to any full-stack dev.
- **Monitoring/Observability (5/5)**: Excellent. Most mature OpenTelemetry ecosystem. `dd-trace-js` provides automatic instrumentation.

---

## Infrastructure Fit & Resource Analysis

| Metric | Monolith-PHP | Micro-PHP | Micro-.NET (AOT) | Micro-Go | Micro-TS |
|---|---|---|---|---|---|
| Image Size | N/A | ~150MB | ~90MB | ~20MB | ~150MB |
| Startup Time | N/A | <1s | <1s | <0.1s | ~2s |
| Memory (idle) | N/A | ~50MB | ~40MB | ~10MB | ~60MB |
| Concurrency | FPM | FPM | ThreadPool | Goroutines | Event Loop |

**Analysis**: Go is the efficiency champion. Monolith is the overhead champion (zero new overhead).

---

## Monitoring & Observability Assessment

- **Unified Tracing**: All microservice options must propagate `x-correlation-id` to 12go calls. The Monolith does this in-process, which is more reliable.
- **Logging**: All designs support structured JSON logging for Datadog. Micro-PHP and Monolith-PHP share the exact same logging configuration.
- **Metrics**: .NET and TS provide the richest set of runtime metrics (GC, event loop, thread pool) out of the box via OpenTelemetry.

---

## Operational Burden & Deployment Complexity

- **Deployment**: Monolith B2B releases are tied to `frontend3`. This is simpler but lacks independence. Microservices allow B2B to deploy multiple times a day without risk to the main 12go site.
- **Config**: 12go's `.env` + DB config pattern is easily replicated in all microservice options.
- **Local Dev**: Monolith is easiest (just run `frontend3`). Microservices require adding more containers to 12go's `docker-compose.yml`, which increases local resource pressure.

---

## Comparative Scoring Matrix

| Criterion (Weight) | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
|---|---|---|---|---|---|
| Infrastructure Fit (x3) | 5 (15) | 4 (12) | 5 (15) | 5 (15) | 4 (12) |
| Operational Complexity (x2) | 5 (10) | 3 (6) | 4 (8) | 3 (6) | 4 (8) |
| Monitoring/Observability (x1) | 5 (5) | 4 (4) | 5 (5) | 4 (4) | 5 (5) |
| **Total Weighted Score** | **30** | **22** | **28** | **25** | **25** |
