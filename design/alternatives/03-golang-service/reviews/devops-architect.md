# DevOps & Infrastructure Review: Go Service

## Overall Infrastructure Assessment

From a DevOps perspective, Go produces the most operationally efficient artifact of any alternative. A 10-15MB static binary in a distroless container, sub-100ms startup, 20-30MB memory footprint, and native Datadog integration. If I were designing the ideal deployment target for a stateless HTTP proxy on EC2, this is close to what I'd spec. The concern is not the artifact — it's whether the team can produce a reliable artifact in a language they've never used.

## Deployment Strategy

Single Docker container deploys alongside the PHP monolith on 12go's EC2 instances. Rolling deployments are trivially fast — the container starts in under 100ms, so the gap between "new version deployed" and "new version serving traffic" is nearly zero. No warm-up period, no JIT compilation delay, no assembly loading. Health checks pass immediately. This is the fastest deployment cycle of all alternatives and enables truly seamless rolling updates with zero-downtime guarantees.

## CI/CD Pipeline Assessment

Go's build pipeline is the simplest: `go test ./...` → `go build` → `docker build` → `docker push`. Full build completes in under 10 seconds. No dependency restore step (modules are cached). No complex build configuration (no `.csproj`, no `tsconfig.json`). The `go.mod` file is the single dependency manifest. CI runs are fast, artifact creation is fast, and the Docker image push is fast (10-15MB vs 200MB+). Fits cleanly into 12go's promotion flow. The only caveat is that 12go's DevOps may need to install the Go toolchain in CI runners, but this is a one-time setup.

## Container Analysis

This is Go's strongest selling point for DevOps. The distroless base image (`gcr.io/distroless/static-debian12`) contains only the binary — no shell, no package manager, no libc (CGO disabled). This means: smallest possible attack surface for container security scanning, no OS-level CVEs to patch, and a 10-15MB image that pulls in seconds. Memory footprint of 20-30MB means you can run many more replicas per EC2 instance compared to .NET (~200MB) or Node (~150MB). Sub-millisecond GC pauses mean no latency spikes during garbage collection.

## Monitoring Integration

`dd-trace-go` v2 (GA since June 2025) provides native Chi integration for automatic request tracing and `httptrace.WrapClient()` for outgoing 12go calls. `slog` JSON output is ingested directly by Datadog. DogStatsD handles custom metrics. The integration is solid but slightly less automatic than .NET's `dd-trace-dotnet` — Go requires explicit `chitrace.Middleware()` registration and `httptrace.WrapClient()` wrapping, whereas .NET auto-instruments everything via CLR profiler. This is a minor difference — a few lines of setup code — but worth noting. Log-trace correlation is automatic via `dd-trace-go`'s `slog` hook.

## Configuration Management

Environment variables parsed into a config struct via `caarlos0/env`. This is the simplest possible configuration approach and aligns perfectly with 12go's `.env` convention. No YAML files, no complex config providers, no `IOptions<T>` pattern. For local development, `joho/godotenv` loads `.env` files. Per-client configuration would be a JSON file or environment variable. Dynamic config updates require a restart (no hot-reload), but for a service that starts in 100ms, restart-based config updates are a non-issue.

## Local Development Experience

`go run ./cmd/server` starts the service in under a second. No Docker required for basic development. Hot reload via `air` or `watchexec` provides instant feedback. The local dev experience is lightweight — no heavy IDE required (VS Code with Go extension works well), no runtime to install beyond the Go toolchain. Docker Compose is available for full-stack local testing with Datadog agent. The challenge is that the .NET team's muscle memory (Rider, Visual Studio, `dotnet watch`) doesn't transfer — they need new tooling setup.

## Operational Burden

Extremely low. One binary, one container, one process. No runtime dependencies, no framework middleware to debug, no DI container resolution issues. If the service crashes, it restarts in 100ms — users likely don't notice. The `pprof` profiler is built into the Go runtime and accessible via HTTP endpoint, giving DevOps a powerful diagnostic tool without additional instrumentation. Goroutine dumps provide instant insight into hung requests. Log volume is proportional to traffic with no background noise. The on-call runbook is simple: check health endpoint, check Datadog traces, restart if needed.

## Infrastructure Risks

- **Team inexperience with Go** could produce subtle bugs that are hard to diagnose — race conditions, goroutine leaks, or improper context cancellation. Go's `go vet` and `race detector` catch many of these, but they require the team to know to use them.
- **Distroless images have no shell** — you cannot `docker exec` into the container for debugging. This is a security feature but an operational constraint. Include a debug image variant for non-production environments.
- **Go module proxy** (`proxy.golang.org`) is an external dependency for CI builds. Cache modules in CI to avoid build failures from proxy outages.
- **No equivalent to .NET's structured diagnostics** — debugging production issues relies more heavily on logs and traces than interactive debugging.

## Recommendations

1. Create a debug Docker image variant (based on `alpine`) for staging/preprod that includes a shell for troubleshooting.
2. Enable Go's race detector (`-race` flag) in CI tests to catch concurrency bugs before they reach production.
3. Expose `pprof` endpoints on a separate port (not the public API port) for production diagnostics.
4. Cache Go modules in CI to eliminate dependency on `proxy.golang.org` during builds.
5. Set container memory limits conservatively (~128MB) — Go's low footprint means you can pack more replicas per instance.

## Score Adjustments

| Criterion | Design Self-Score | My Adjustment | Rationale |
|-----------|------------------|---------------|-----------|
| Infrastructure Fit | 5 | **5** (agree) | Objectively the best container profile: smallest image, fastest startup, lowest memory. |
| Operational Complexity | 5 | **5** (agree) | Single binary with built-in profiling. Restarts in 100ms. Can't get simpler. |
| Monitoring/Observability | 4 | **4** (agree) | dd-trace-go v2 is solid. Slightly more manual setup than .NET auto-instrumentation, but the result is equivalent. |

No score adjustments needed. From a pure infrastructure/DevOps standpoint, Go is the strongest alternative. The 10MB image, instant startup, and minimal memory footprint are genuine operational advantages. The risk lies entirely in the team's ability to produce reliable Go code, which is outside my scoring domain but affects my confidence level.
