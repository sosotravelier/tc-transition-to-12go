# DevOps & Infrastructure Review: TypeScript/Node.js Service

## Overall Infrastructure Assessment

This is Alternative 4 done right from an infrastructure perspective. Node.js 22 LTS is a mature, well-understood runtime with first-class Datadog support, established Docker images, and 15 years of production operational knowledge. The single Fastify service deploys as one Docker container on EC2 with standard monitoring integration. DevOps can manage this with their existing skills — Node.js containers are ubiquitous in modern infrastructure. It's not as lightweight as Go, but it's significantly simpler to operate than maintaining 6+ .NET services.

## Deployment Strategy

Single Docker container deploys alongside the PHP monolith on 12go's EC2 instances. Rolling deployments work well — Node.js startup time (~60-120ms cold start, ~2s to fully warm) is fast enough for seamless transitions. The `node:22-alpine` base image is well-maintained with regular security patches. The stateless design means any instance handles any request. Docker Compose for local development mirrors the production topology. Standard, predictable, no surprises.

## CI/CD Pipeline Assessment

Pipeline: `npm ci` → `tsc` (type check) → `vitest run` → `docker build` → `docker push`. The TypeScript compilation step adds ~5 seconds. Total CI time is well under 2 minutes for a project this size. `npm ci` uses the lockfile for deterministic installs — important for reproducible builds. Docker image is ~150MB (node:22-alpine + production dependencies). The pipeline is standard and fits 12go's promotion flow. GitHub Actions handles everything with standard `actions/setup-node`. No exotic tooling needed.

## Container Analysis

`node:22-alpine` base image is ~180MB. With production dependencies (`npm ci --omit=dev`), the final image is ~150MB — lighter than .NET (~250MB) but heavier than Go (~15MB). Node.js runs as a single process inside Docker with graceful shutdown handling via `SIGTERM`. Memory footprint is ~80-150MB under typical proxy workload. V8's garbage collector is well-tuned for server workloads with predictable pause times. The `--enable-source-maps` flag in the entrypoint is a good practice for production stack traces. Consider adding `--max-old-space-size=512` as a safety valve.

## Monitoring Integration

Strong. `dd-trace` for Node.js is Datadog's most mature JavaScript tracer with extensive auto-instrumentation: Fastify routes, undici HTTP calls, DNS lookups, and JSON parsing are all traced automatically. `logInjection: true` correlates logs with traces — a feature that works reliably in the Node.js tracer. Pino's JSON output goes directly to Datadog Logs with zero parsing configuration. Runtime metrics (event loop lag, GC pauses, heap usage) are reported automatically via `runtimeMetrics: true`. Custom business metrics through dd-trace's metrics API complete the picture. This monitoring integration is production-grade.

## Configuration Management

Environment variables with Zod-validated config at startup. If a required config value is missing, the service fails fast at startup with a clear error message — this is better than the .NET pattern of runtime `IOptions<T>` failures. Docker Compose maps `.env` files for local development, matching 12go's convention. Per-client configuration in environment variables or a JSON config file. Secrets stay in environment variables. Hot-reload is not built-in but with ~2s startup, restart-based config updates are practical.

## Local Development Experience

`npm run dev` with `tsx` watch mode provides hot-reload with TypeScript support. No Docker required for basic development. Fastify's `inject()` method allows testing routes without starting a server, which accelerates the development loop. Docker Compose provides the full-stack experience with Datadog agent. VS Code debugging with Node.js is excellent — breakpoints, variable inspection, and async stack traces work out of the box. This is a good DX, though the .NET team needs to adjust from Rider/Visual Studio to VS Code Node.js debugging.

## Operational Burden

Low. Single process, single container, stateless proxy. Node.js process management is handled by Docker's restart policy — no PM2 needed. The graceful shutdown hook ensures in-flight requests complete before the process exits. Diagnostics are well-supported: heap snapshots, CPU profiles, and event loop metrics are available via Datadog's continuous profiling. The notification transformer uses in-memory retry — same limitation as other alternatives, lost on restart. The on-call surface is one container with well-understood failure modes.

## Infrastructure Risks

- **npm supply chain risk**: The JavaScript ecosystem has a larger attack surface than Go or .NET. `npm audit` in CI catches known vulnerabilities, but zero-day supply chain attacks are a real concern. Mitigate with lockfile pinning, `npm ci` for deterministic installs, and conservative dependency choices.
- **Node.js single-threaded model**: A synchronous operation blocking the event loop stalls all requests. For a pure I/O proxy this shouldn't occur, but a bug in a mapper function that accidentally processes a large object synchronously could cause issues. Monitor event loop lag in Datadog.
- **New runtime for DevOps**: While Node.js is well-known industry-wide, 12go's DevOps team may not have Node.js-specific operational experience. Memory profiling, heap dump analysis, and V8 debugging are different from PHP or .NET. However, this is a much smaller learning curve than introducing Go or Bun.
- **Container image larger than Go**: 150MB vs 15MB. More time to pull during deployments, more storage on EC2 instances. Not a dealbreaker but a real difference for rapid scaling scenarios.

## Recommendations

1. Run `npm audit` in CI and fail the build on high/critical vulnerabilities.
2. Set `--max-old-space-size=512` in the Docker CMD to prevent unbounded heap growth.
3. Enable Datadog's continuous profiling (`profiling: true`) from day one — it's free diagnostics.
4. Monitor event loop lag and set a Datadog alert for sustained lag > 100ms.
5. Use the multi-stage Docker build (already proposed) and ensure `npm ci --omit=dev` removes test/development dependencies from the production image.
6. Address the notification in-memory state before production — Redis key-value store for booking-to-client mapping is trivial with Node.js Redis client.

## Score Adjustments

| Criterion | Design Self-Score | My Adjustment | Rationale |
|-----------|------------------|---------------|-----------|
| Infrastructure Fit | 4 | **4** (agree) | Node.js is a well-understood runtime. Not native to 12go's stack, but standard in the industry. Docker deployment is clean. Fair score. |
| Operational Complexity | 4 | **4** (agree) | Single container, good diagnostics, well-known failure modes. The -1 from perfect for introducing a new runtime to DevOps is appropriate. |
| Monitoring/Observability | 4 | **4** (agree) | dd-trace Node.js is mature and full-featured. Pino + Datadog Logs is clean. Not quite .NET's auto-profiling level but very close. |

No score adjustments needed. The self-assessment is honest and accurately reflects the infrastructure story. This is a solid deployment target — not as operationally optimal as Go (heavier image, more memory) and not as frictionless as .NET (team's native runtime), but a well-balanced middle ground with excellent monitoring support and a battle-tested runtime.
