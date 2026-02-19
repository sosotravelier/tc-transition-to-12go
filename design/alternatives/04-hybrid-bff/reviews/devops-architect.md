# DevOps & Infrastructure Review: Hybrid BFF / Thin Proxy (TypeScript/Bun)

## Overall Infrastructure Assessment

This design proposes the thinnest possible service — ~2,850 LOC in TypeScript on Bun. From a DevOps perspective, the simplicity is appealing but the runtime choice raises flags. Bun is a 2-year-old runtime that 12go's DevOps has never deployed. Introducing an exotic runtime during a critical migration is exactly the kind of decision that looks elegant on paper and generates 3 AM pages. The design acknowledges this with a Node.js fallback, but the primary recommendation remains Bun.

## Deployment Strategy

Single Docker container on EC2, routed via Nginx. Standard and clean. The deployment itself is straightforward — same pattern as any containerized service. However, Bun's Docker ecosystem is less mature: no official `bun:alpine` image with LTS guarantees, no well-established base image patching cadence, and limited community experience with production Bun containers. If the team switches to Node.js (the acknowledged fallback), this concern evaporates, but then this alternative loses its performance differentiation over Alternative 5.

## CI/CD Pipeline Assessment

Bun's build pipeline is fast: `bun install` → `bun test` → `docker build`. No TypeScript compilation step (Bun runs TS natively). Build time is seconds. Artifact is a Docker image (~50MB claimed, likely 80-100MB with dependencies in practice). The pipeline is simple, but CI runners need Bun installed — it's not a standard tool in most CI environments. With Node.js fallback: `npm ci` → `npm test` → `tsc` → `docker build` is equally simple and uses standard CI tooling. Either way, the pipeline fits 12go's promotion flow without issues.

## Container Analysis

Bun claims ~50MB image and 15-30ms cold start. In practice with `node_modules` and the Bun runtime, expect 80-120MB. This is lighter than .NET (~250MB) but heavier than Go (~15MB). Startup time is genuinely fast. Memory baseline is ~50-100MB — reasonable for a proxy service. The concern: Bun's memory behavior under sustained load is less well-characterized than Node.js or .NET. Memory leak patterns in Bun are not well-documented, and the team has zero JavaScript runtime debugging experience. If a memory issue surfaces in production, diagnosis will be challenging.

## Monitoring Integration

The design specifies `dd-trace` npm package for Datadog. Here's the problem: **Datadog's `dd-trace` does not officially support Bun**. The library relies on Node.js-specific APIs (V8 bindings, `async_hooks`, `node:diagnostics_channel`) that Bun implements partially. Auto-instrumentation for HTTP, DNS, and frameworks may work partially or not at all. This is a significant gap. With Node.js, `dd-trace-js` is mature and well-supported — auto-instrumentation for `undici`, Express/Fastify, and `pino` works out of the box. The monitoring story is strong on Node.js but uncertain on Bun.

## Configuration Management

Environment variables plus a JSON config file. Simple and aligned with 12go's `.env` convention. `dotenv` loads `.env` files locally. Per-client configuration in a JSON file is adequate for current scale. No hot-reload mechanism mentioned — a restart applies config changes. With fast startup times, this is acceptable. Secrets come from environment variables. Standard and clean.

## Local Development Experience

Bun provides a fast local dev experience: `bun run src/index.ts` starts the service in milliseconds with native TypeScript support. Hot reload via `bun --watch`. No compilation step. This is a genuinely good DX. However, the .NET team needs to install Bun locally, learn its CLI, and understand its debugging model. VS Code debugging with Bun is supported but less polished than Node.js debugging. With Node.js fallback: `tsx` or `ts-node` provides similar DX with broader tooling support.

## Operational Burden

The service itself is operationally simple — one container, one process, stateless. The notification transformer introduces the only stateful concern (in-memory booking-to-client mapping, lost on restart). The operational risk is the runtime: if Bun exhibits unexpected behavior in production (memory growth, event loop stalls, compatibility issues), the team has no Bun expertise and limited community resources to draw from. Node.js has 15 years of production battle-testing and extensive troubleshooting documentation.

## Infrastructure Risks

- **Bun production maturity**: The biggest risk. Bun 1.2 is production-capable for many workloads, but deploying a novel runtime for a business-critical B2B API during a high-stakes migration is risk stacking. 12go's DevOps has never managed a Bun process.
- **Datadog instrumentation gaps**: `dd-trace` Bun support is experimental. This could mean missing traces, incomplete metrics, or broken auto-instrumentation — exactly when monitoring matters most (during migration).
- **Container security scanning**: Security scanners may not fully understand Bun's runtime dependencies, leading to false negatives in vulnerability detection.
- **Notification state loss**: In-memory booking-to-client mapping is lost on restart. The design acknowledges this but doesn't solve it for MVP. In practice, containers restart during deployments, and every deployment loses notification routing for in-flight bookings.

## Recommendations

1. **Switch to Node.js 22 LTS instead of Bun.** The performance difference is irrelevant (12go is the bottleneck), and Node.js eliminates the Datadog instrumentation risk, the runtime maturity risk, and the DevOps unfamiliarity risk. This single change dramatically improves the infrastructure story.
2. Use `pino` for logging (native Fastify integration) with JSON output to Datadog.
3. Address the notification state problem before production — at minimum, use Redis for booking-to-client mapping.
4. Set explicit `--max-old-space-size` for Node.js to prevent unbounded heap growth.
5. Include a `healthcheck` instruction in the Dockerfile for Docker's native health monitoring.

## Score Adjustments

| Criterion | Design Self-Score | My Adjustment | Rationale |
|-----------|------------------|---------------|-----------|
| Infrastructure Fit | 4 | **3** (lower) | Bun is an exotic runtime for 12go's infrastructure. DevOps has never deployed it, Datadog support is experimental. With Node.js: 4 would be fair. |
| Operational Complexity | 4 | **3** (lower) | The combination of a novel runtime + experimental monitoring + in-memory notification state creates more operational unknowns than the design acknowledges. |
| Monitoring/Observability | 4 | **3** (lower) | `dd-trace` on Bun is not officially supported. Auto-instrumentation may be incomplete. This is a dealbreaker for production monitoring during migration. |

The design's self-assessment doesn't adequately account for the operational risk of deploying Bun. If the runtime were switched to Node.js 22 LTS, I would restore all three scores to their self-assessed levels. The code architecture is sound — the runtime choice is the issue.
