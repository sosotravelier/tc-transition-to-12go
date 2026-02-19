# DevOps & Infrastructure Review: Trimmed .NET Service

## Overall Infrastructure Assessment

This is the most operationally straightforward alternative. A single .NET 8 Docker container with Datadog native tracing, zero databases, and standard environment-variable configuration slots cleanly into 12go's EC2/Docker infrastructure. DevOps adds one container to their fleet instead of managing 6+ services. The operational simplification alone justifies serious consideration.

## Deployment Strategy

Single Docker image deploys alongside the PHP monolith on 12go's 8 EC2 instances. No new infrastructure required beyond adding the container to the existing Docker Compose or orchestration. Rolling deployments are straightforward — start new container, health check passes, drain old container. The stateless design means zero coordination during deploys; any instance can handle any request. This is the easiest thing DevOps can be asked to deploy.

## CI/CD Pipeline Assessment

The pipeline is clean: `dotnet restore` → `dotnet build` → `dotnet test` → `docker build` → `docker push`. Build time under 30 seconds for this project size. The single `.sln` with 2 `.csproj` files means no multi-project dependency chains or NuGet package versioning headaches. Artifact is a single Docker image. Fits directly into 12go's dev → staging → preprod → prod promotion flow. No special tooling needed — GitHub Actions handles everything.

## Container Analysis

.NET 8 `aspnet` base image is ~220MB. With the Datadog tracer installed, expect ~250-280MB. Startup time is ~2-5 seconds (JIT warm-up), which is acceptable but not instant — rolling deploys need to account for this. Memory footprint will be ~150-250MB under load. These numbers are well within EC2 instance capacity but notably heavier than Go or Node alternatives. The Datadog tracer installation in the Dockerfile (downloading `.deb` at build time) adds build complexity; consider pinning the tracer version to avoid surprises.

## Monitoring Integration

Excellent. `dd-trace-dotnet` auto-instruments ASP.NET Core and `HttpClient` with zero code changes — just Docker environment variables. Structured JSON logging via Serilog with Datadog enricher feeds directly into Datadog Logs. Custom business metrics via DogStatsD are standard. Correlation IDs propagate through the entire request chain. This gives DevOps full visibility: traces, logs, and metrics correlated in Datadog from day one. The monitoring setup is production-grade out of the box.

## Configuration Management

Standard .NET configuration: `appsettings.json` for defaults, environment variables for per-environment overrides. Docker Compose maps `.env` files to environment variables, aligning with 12go's convention. Per-client configuration lives in a JSON section — good for the current scale but may need a database-backed solution if client count grows significantly. Secrets (API keys) come from environment variables, no secrets in code. Hot-reload for configuration is supported via `IOptionsMonitor`. Clean and familiar to anyone who has deployed .NET.

## Local Development Experience

Developers run `docker-compose up` and have the full service locally. Hot reload works with `dotnet watch`. The `docker-compose.yml` provided includes the Datadog agent sidecar for local tracing. No external dependencies (no databases, no Redis, no Kafka). This is the simplest local dev story possible — clone, docker-compose, go. Debugging attaches directly via Rider or VS Code.

## Operational Burden

Minimal. One container to monitor, one log stream to watch, one health endpoint to check. No database migrations, no cache invalidation issues, no message queue lag alerts. The on-call runbook is essentially: "Is the container running? Is 12go reachable? Restart if needed." Log volume is proportional to request traffic — no background processing generating noise. If something breaks, there's exactly one place to look.

## Infrastructure Risks

- **Image size is the largest** of all alternatives (~250MB vs ~15MB for Go). Not a dealbreaker on EC2 but affects pull time during deployments.
- **.NET startup time (~2-5s)** means health check probes need appropriate initial delay. During rapid scaling or restarts, there's a brief window where the instance isn't serving traffic.
- **The Datadog tracer `.deb` installation** is an external download at Docker build time. Pin the version and consider caching the artifact to avoid build failures from network issues.
- **Memory footprint** is adequate but less efficient than Go or Node for a stateless proxy workload.

## Recommendations

1. Pin the `dd-trace-dotnet` version in the Dockerfile and cache the `.deb` artifact in CI.
2. Set readiness probe `initialDelaySeconds` to 8-10s to account for .NET startup + Datadog tracer initialization.
3. Use multi-stage Docker build (already proposed) and consider `PublishTrimmed` to reduce image size.
4. Set explicit container memory limits (~512MB) and CPU limits to prevent noisy-neighbor issues on shared EC2 instances.
5. Implement structured health checks that 12go's load balancer can consume.

## Score Adjustments

| Criterion | Design Self-Score | My Adjustment | Rationale |
|-----------|------------------|---------------|-----------|
| Infrastructure Fit | 5 | **5** (agree) | Drops in seamlessly. One container, Datadog native, env-var config. |
| Operational Complexity | 5 | **5** (agree) | Genuinely the simplest operational profile. One service replaces 6+. |
| Monitoring/Observability | 5 | **5** (agree) | dd-trace-dotnet auto-instrumentation is best-in-class for Datadog. |

No score adjustments warranted. From a DevOps perspective, this is the safest, most predictable deployment target. The only concern is the .NET container size and startup time, but these are well-understood characteristics, not risks.
