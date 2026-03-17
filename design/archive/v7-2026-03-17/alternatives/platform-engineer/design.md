# Platform Engineer Design

## Infrastructure Reality Assessment

Let me start with what I know to be true about the infrastructure I would be deploying this to.

**The 12go production environment is:**
- 8 EC2 instances, fully managed by a DevOps team that speaks PHP
- Docker containers orchestrated by that same DevOps team
- PHP 8.3 / Symfony 6.4 everywhere -- the F3 monolith is the only application
- Datadog for logs, metrics, and (limited) APM -- `dd-trace-php` is the native agent
- `.env` files for configuration, database-stored integration configs
- Four environments: Local (Docker Compose), Staging, PreProd (canary with real external connections), Prod
- No OpenTelemetry, no Kubernetes, no container orchestration beyond Docker
- AWS API Gateway in front of client-facing endpoints, handling API key enforcement

**The developer situation:**
- One developer (Soso), senior .NET background, working solo with AI assistance
- The code must live for a significant time -- this is not throwaway
- Q2 2026 deadline for new client onboarding
- F3 refactoring is planned but undefined -- planning starts Q2, scope/language unknown

**What this service actually does:**
- 13 client-facing API endpoints that transform HTTP requests/responses between client format and 12go format
- 11 outbound HTTP calls to 12go's REST API
- 1 inbound webhook receiver (booking notifications from 12go)
- 3 static data endpoints (stations, operators, POIs) serving pre-generated S3 URLs
- Zero persistent state -- confirmed decision to eliminate local DB, 12go is source of truth
- The most complex logic is booking schema parsing (~500 lines of dynamic field extraction)

This is fundamentally an HTTP proxy with request/response transformation. The computational requirements are minimal. The operational requirements are: it must stay up, it must be observable, and it must be debuggable by whoever is on call.

## Language/Runtime Comparison (infrastructure lens only)

### PHP/Symfony: Operational Profile

**Docker image**: `php:8.3-fpm-alpine` base, ~150MB with extensions. Same as F3.
**Memory**: PHP-FPM worker processes, typically 30-50MB each. Configured via `pm.max_children`, `pm.start_servers`, etc. DevOps knows these knobs intimately.
**Startup time**: 2-5 seconds for PHP-FPM process manager. Warm, not cold -- workers are pre-forked.
**Datadog**: `dd-trace-php` auto-instruments Symfony HTTP kernel, Guzzle HTTP client, PDO, Redis. Out-of-the-box spans for incoming requests and outgoing HTTP calls with zero code changes. This is the same setup already running on every F3 instance.
**CI/CD**: `composer install`, copy code, restart PHP-FPM. Identical to F3 deployment pipeline.
**On-call**: The engineer already knows how to read PHP-FPM slow logs, check `php-fpm status` page, restart workers, tune pool size. Error messages are in PHP -- the language they debug every day.
**DevOps acceptance**: Zero friction. It is the same stack. No new base images, no new runtime documentation, no new monitoring plugins.

**Operational cost of choosing PHP**: Near zero incremental operational burden. The question is whether it makes sense for a .NET developer to write PHP, and whether the code will be maintainable. But from an infrastructure perspective, this is the lowest-risk choice.

### Go: Operational Profile

**Docker image**: `scratch` or `gcr.io/distroless/static-debian12`, ~10-20MB. Single statically-linked binary.
**Memory**: 10-30MB for an HTTP proxy workload. Go's garbage collector is predictable and low-latency.
**Startup time**: <100ms. Essentially instant.
**Datadog**: `dd-trace-go` provides auto-instrumentation for `net/http` handlers and clients via middleware wrappers. HTTP server spans are automatic if you use `httptrace.WrapHandler`. HTTP client spans require wrapping the `http.Client` with `httptrace.WrapClient`. Not zero-config like PHP-FPM, but straightforward.
**CI/CD**: `go build` produces a single binary. No runtime dependencies. Docker build is: copy binary, done. No package manager at runtime, no extension loading, no FPM configuration.
**On-call**: The engineer does not know Go. When a Go service panics, the stack trace is in Go syntax. When it leaks goroutines, the debugging tools are `pprof` and `runtime.NumGoroutine()`, not `php-fpm status`. This is a real gap.
**DevOps acceptance**: Mixed. The Docker image is simpler (smaller, no FPM config), but it is a new language. DevOps needs to understand how to configure the binary (flags vs env vars), how to check health, what a Go panic looks like. 12go is considering Go for future development, which creates some institutional interest -- but "considering" is not "decided."

**Operational cost of choosing Go**: Low runtime footprint, but introduces a new category of operational knowledge. The on-call gap is real. If 12go does adopt Go, this becomes a forward investment. If they do not, it becomes orphaned infrastructure.

### .NET: Operational Profile

**Docker image**: `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` ~90MB, or AOT-compiled in `mcr.io/dotnet/runtime-deps:8.0-alpine` ~80MB.
**Memory**: 80-150MB for ASP.NET Core with Kestrel. Higher baseline than Go, comparable to PHP-FPM with a few workers.
**Startup time**: 1-3 seconds JIT, <500ms AOT. Acceptable for a long-running service.
**Datadog**: `dd-trace-dotnet` auto-instruments ASP.NET Core, HttpClient, ADO.NET, etc. Installed as a NuGet package + environment variables (`DD_DOTNET_TRACER_HOME`, `CORECLR_ENABLE_PROFILING=1`, etc.). Works well but requires specific environment setup in the Dockerfile.
**CI/CD**: `dotnet publish`, copy output. Requires .NET SDK in build stage, .NET runtime in run stage. Multi-stage Docker build adds complexity but is well-documented.
**On-call**: Nobody at 12go knows .NET. When this service throws an `AggregateException` at 3am, the on-call engineer cannot read the stack trace, cannot attach a debugger they know, cannot even install the right tools without searching. This is not a theoretical concern -- it is the operational reality of running a .NET service on a PHP-native infrastructure team.
**DevOps acceptance**: This is the hardest sell. 12go DevOps has never deployed a .NET container. They need to learn: .NET environment variables for tracing, .NET-specific health check patterns, how `Kestrel` binding works, what `DOTNET_ENVIRONMENT` means, how to read .NET logs. Every one of these is a support request the first time something goes wrong.

**Operational cost of choosing .NET**: Highest of all options. The developer (Soso) is most productive in .NET, but the infrastructure team has zero .NET experience. This is the classic "developer comfort vs. operational sustainability" tradeoff. The developer ships faster; the platform team suffers longer.

### Node.js/TypeScript: Operational Profile

**Docker image**: `node:20-alpine` ~180MB, or `node:20-slim` ~200MB. Larger than PHP or Go.
**Memory**: 50-100MB for a basic HTTP server. V8 heap can grow unpredictably under load.
**Startup time**: 500ms-2s depending on module count. Acceptable.
**Datadog**: `dd-trace-js` (package `dd-trace`) auto-instruments Express/Fastify, `http`/`https` modules, common ORMs. Good coverage but requires `require('dd-trace').init()` at the very top of the entry file. HTTP client calls through `node-fetch` or `axios` are auto-traced.
**CI/CD**: `npm ci`, `npm run build` (TypeScript), `node dist/index.js`. Requires `node_modules` in the image or a multi-stage build. The `node_modules` directory can be large and brittle (dependency resolution issues, platform-specific native modules).
**On-call**: DevOps does not know Node.js either, but the error messages are JavaScript -- more widely recognizable than .NET CLR errors. Still a new runtime to support.
**DevOps acceptance**: Slightly better than .NET (JavaScript is more universally encountered), but still a new runtime. `npm` build issues are a known source of CI/CD flakiness.

**Operational cost of choosing Node.js**: Similar to .NET from an operational standpoint. New runtime, new debugging tools, new build pipeline. The image is larger than Go, the build is more complex (npm), and the runtime is less predictable under memory pressure than Go or PHP-FPM.

## Recommendation (with infrastructure justification)

**Recommended: PHP/Symfony, deployed as a Symfony bundle inside F3.**

Here is why, purely from infrastructure:

1. **Zero new infrastructure**. No new Docker base image. No new Datadog agent. No new deployment pipeline. No new monitoring configuration. No new on-call runbook category. The DevOps team deploys this the same way they deploy every other F3 change.

2. **On-call continuity**. When this breaks at 3am, the on-call engineer opens the same Datadog dashboard, reads the same PHP stack traces, checks the same PHP-FPM metrics, and uses the same debugging tools they use for every other F3 issue. They do not need to learn anything new.

3. **Single deployment unit**. One Docker image, one deployment pipeline, one rollback procedure. Adding a second service -- in any language -- means coordinating two deployments, two health checks, two scaling configurations, two log streams. For what is essentially an HTTP proxy, this coordination overhead is not justified.

4. **F3 refactoring alignment**. When F3 is eventually refactored, B2B code that lives inside F3 gets refactored with it. A separate service in any language becomes an external dependency that must be reverse-engineered and migrated separately. The "one system" organizational directive points to co-location.

5. **Configuration reuse**. `.env` files, database-stored configs, API key management -- all existing patterns apply directly. No new secrets management approach needed.

**What about the developer?** Soso is a .NET developer writing PHP. This is a real cost. But the question from infrastructure is: who maintains this after Soso? The answer is: the 12go PHP team. Writing it in PHP means it is maintainable by the team that will own it long-term. Writing it in .NET means it is maintainable only by Soso -- and Soso has indicated plans to move on.

**If the monolith approach is rejected** and a standalone microservice is required, the infrastructure recommendation changes to **Go**, for these reasons:
- Smallest container image (10-20MB vs. 90-150MB for .NET vs. 180MB for Node.js)
- Fastest startup, lowest memory, most predictable runtime behavior
- 12go is at least considering Go for future development
- Single binary deployment -- simpler than any runtime-dependent alternative
- `dd-trace-go` provides adequate HTTP instrumentation with minimal setup

Go's operational profile is the closest to "just a binary in a container" -- which is the simplest thing for DevOps to manage after PHP-FPM, because there is almost nothing to configure.

## Deployment Specification

The following specification covers both the recommended approach (Symfony bundle inside F3) and the fallback (standalone Go microservice). The primary specification is for the PHP/Symfony approach.

### Docker Image

**Primary (PHP/Symfony inside F3):**

No new Docker image. The B2B code deploys inside the existing F3 container.

- Base image: whatever F3 currently uses (likely `php:8.3-fpm-alpine` or a custom derivative)
- B2B code is a Symfony bundle registered in F3's kernel
- Routes are registered via Symfony routing configuration
- No separate container, no separate image build

**Fallback (Standalone Go microservice):**

```dockerfile
# Build stage
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /b2b-api ./cmd/server

# Runtime stage
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /b2b-api /b2b-api
EXPOSE 8080
ENTRYPOINT ["/b2b-api"]
```

- Final image: ~15-20MB
- No shell, no package manager, no attack surface
- Runs as non-root user (distroless `nonroot` tag)

### Resource Limits

**For the PHP/Symfony approach**, resource limits are inherited from F3's existing container configuration. The B2B endpoints add negligible CPU/memory overhead -- they are HTTP proxy calls with JSON transformation.

Estimated incremental load per B2B request:
- CPU: <5ms of transformation logic, remainder is waiting for 12go API response
- Memory: <2MB per concurrent request (JSON parsing + transformation)
- Expected concurrency: Low. B2B clients generate modest traffic compared to 12go's consumer traffic.

**For the standalone Go microservice:**

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "64Mi"
  limits:
    cpu: "500m"
    memory: "128Mi"
```

These are conservative estimates for an HTTP proxy that holds no state. The Go binary itself uses ~10MB; the rest is for goroutine stacks and HTTP client connection pools.

### Health Checks and Graceful Shutdown

**PHP/Symfony approach:**

Health check is a new Symfony controller route:

```
GET /b2b/health
```

Returns 200 with JSON body:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-17T12:00:00Z"
}
```

Optionally includes a connectivity check to 12go API (lightweight endpoint, like search with a known route, with a 3-second timeout). If the 12go API is unreachable, the health check still returns 200 (the service itself is healthy) but includes a `dependencies` field:

```json
{
  "status": "ok",
  "dependencies": {
    "12go_api": "unreachable"
  }
}
```

Graceful shutdown is handled by PHP-FPM's `process_control_timeout` directive (already configured for F3). When the container receives SIGTERM:
1. PHP-FPM stops accepting new connections
2. In-flight requests complete (up to `process_control_timeout`, typically 10-30 seconds)
3. Workers exit cleanly

No additional shutdown logic needed for B2B -- there is no persistent state, no queue to drain, no connections to close beyond HTTP client connections which are managed by PHP-FPM's lifecycle.

**Standalone Go microservice:**

```go
// SIGTERM handler with 15-second grace period
srv := &http.Server{Addr: ":8080", Handler: router}
go srv.ListenAndServe()

sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
<-sigCh

ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

Docker health check:
```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/b2b-api", "healthcheck"]
```

### CI/CD Pipeline

**PHP/Symfony approach (inside F3):**

The deployment is F3's existing pipeline. No new pipeline needed.

1. Developer pushes to F3 branch (B2B bundle changes)
2. CI runs `composer install` and PHPUnit tests (including B2B tests)
3. CI builds F3 Docker image (same Dockerfile as before, B2B code included)
4. Image pushed to registry
5. Staged rollout: Staging -> PreProd (canary) -> Prod
6. DevOps manages rollout via their existing process (release request)

Total new CI steps: zero. B2B tests run as part of F3's test suite.

**Standalone Go microservice:**

1. Developer pushes to `b2b-api` repository
2. CI runs `go test ./...`
3. CI runs `go build` (multi-stage Docker build)
4. Image pushed to registry (~20MB layer)
5. Staged rollout: Staging -> PreProd -> Prod
6. DevOps manages rollout (new pipeline to configure)

New DevOps work required:
- Docker Compose service definition for local dev
- EC2 deployment configuration (which instance, port mapping, reverse proxy config)
- Datadog agent configuration for the new container
- Log routing configuration
- Health check endpoint registration in whatever monitoring tool DevOps uses

This is approximately 1-2 days of DevOps setup, plus ongoing maintenance of a second deployment pipeline.

## Observability Design

### Datadog APM Integration

**PHP/Symfony approach:**

Library: `dd-trace-php` (already installed on every F3 instance)

Auto-instrumented (zero code changes):
- Symfony HTTP kernel request/response lifecycle
- Guzzle HTTP client calls (outbound to 12go API)
- PDO database queries (if any)
- Redis operations (if any)

This means every inbound B2B request and every outbound 12go API call gets a Datadog trace span automatically. The span includes: HTTP method, URL, status code, duration.

Manual instrumentation needed:
- Custom span tags for `client_id`, `booking_id`, `operation_type`
- Business-level error classification (12go returned 400 vs. 500 vs. timeout)
- Correlation ID propagation (see below)

```php
// Example: adding client_id to the active span
$span = \DDTrace\active_span();
if ($span) {
    $span->meta['client.id'] = $clientId;
    $span->meta['b2b.operation'] = 'search';
}
```

**Standalone Go microservice:**

Library: `gopkg.in/DataDog/dd-trace-go.v1`

Setup:
```go
import "gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"

tracer.Start(
    tracer.WithService("b2b-api"),
    tracer.WithEnv(os.Getenv("DD_ENV")),
)
defer tracer.Stop()
```

Auto-instrumented via middleware wrappers:
- HTTP server: `httptrace.WrapHandler(handler, "b2b-api", "request")`
- HTTP client: `httptrace.WrapClient(httpClient)`

Manual instrumentation needed:
- Same custom tags as PHP approach
- Correlation ID propagation

### Structured Logging

Log format: JSON, one line per log entry, parseable by Datadog log pipeline.

Standard fields (matching Datadog's default attribute conventions):

```json
{
  "timestamp": "2026-03-17T12:00:00.123Z",
  "level": "error",
  "message": "12go API returned 500 for booking confirm",
  "service": "b2b-api",
  "dd.trace_id": "1234567890",
  "dd.span_id": "9876543210",
  "client_id": "comport_abc",
  "operation": "confirm_booking",
  "booking_id": "12345",
  "12go_status_code": 500,
  "12go_response_time_ms": 2340,
  "correlation_id": "x-corr-uuid-here"
}
```

The `dd.trace_id` and `dd.span_id` fields enable Datadog to correlate logs with APM traces automatically.

**PHP/Symfony**: Use Monolog (already in F3) with a JSON formatter. Register a Monolog processor that adds `dd.trace_id`, `dd.span_id`, `client_id`, and `correlation_id` to every log entry.

**Go**: Use `slog` (standard library, Go 1.21+) with JSON handler. Add trace context via middleware that injects trace IDs into the logger context.

### Correlation ID Propagation

Inbound: Read `x-correlation-id` header from client request. If absent, generate a UUID.

Propagation: Pass the correlation ID to every outbound 12go API call as a custom header (or log it alongside the Datadog trace ID for cross-reference).

Flow:
```
Client -> [x-correlation-id: abc-123] -> B2B API -> [logs: correlation_id=abc-123, dd.trace_id=XYZ] -> 12go API
```

Since 12go does not propagate correlation IDs (no OpenTelemetry, no W3C Trace Context), the correlation stops at the B2B->12go boundary. The B2B service logs both the client's correlation ID and the Datadog trace ID, enabling engineers to search by either.

### Custom Metrics

Using Datadog's custom metrics (via `dd-trace-php` or `dogstatsd`):

| Metric | Type | Tags | Purpose |
|--------|------|------|---------|
| `b2b.request.count` | Counter | `client_id`, `operation`, `status_code` | Request volume per client per operation |
| `b2b.request.duration` | Histogram | `client_id`, `operation` | Latency distribution (p50, p95, p99) |
| `b2b.12go_api.error_rate` | Counter | `operation`, `status_code`, `error_type` | 12go API errors by type |
| `b2b.12go_api.duration` | Histogram | `operation` | 12go API response time |
| `b2b.webhook.received` | Counter | `client_id`, `status` | Webhook notifications received |
| `b2b.webhook.forwarded` | Counter | `client_id`, `success` | Webhooks successfully forwarded to clients |

**PHP implementation** (using DogStatsD, which is already available on F3 instances):

```php
$statsd = new \DataDog\DogStatsd(['host' => 'localhost', 'port' => 8125]);
$statsd->increment('b2b.request.count', 1, [
    'client_id' => $clientId,
    'operation' => 'search',
    'status_code' => '200'
]);
$statsd->timing('b2b.request.duration', $durationMs, [
    'client_id' => $clientId,
    'operation' => 'search'
]);
```

### Alerting

**First alert to configure:**

`b2b.12go_api.error_rate` -- alert when the 5xx error rate from 12go API exceeds 5% of total requests over a 5-minute window.

Why this first: if 12go's API is returning errors, every B2B client is affected. This is the highest-leverage alert because it catches the most common production incident (upstream API degradation) with the least configuration.

Threshold:
```
Alert: (count of b2b.12go_api.error_rate where status_code:5xx) / (count of b2b.request.count) > 0.05 over 5 minutes
Warning: same ratio > 0.02 over 5 minutes
```

**Second alert:**

`b2b.request.duration` p95 > 10 seconds over a 5-minute window. Search should complete in 2-5 seconds; if p95 exceeds 10 seconds, something is wrong (12go slow, network issue, resource exhaustion).

**Third alert:**

`b2b.webhook.received` drops to zero for 30 minutes (if normally non-zero). Indicates webhook delivery from 12go has stopped.

All alerts route to the existing on-call channel in Datadog.

## Local Development Setup

**PHP/Symfony approach (inside F3):**

The B2B code runs inside F3's existing `docker-compose` setup. No additional containers needed.

```yaml
# No changes to docker-compose.yml -- B2B is part of F3
# The developer works in F3's local environment
```

To develop B2B endpoints locally:
1. Clone F3 repository
2. Run `docker-compose up` (F3's existing setup)
3. B2B routes are available at `http://localhost:{F3_PORT}/v1/{client_id}/itineraries`
4. 12go API calls go to staging/dev environment (configured via `.env`)

Environment variable management:
- `.env.local` for local overrides (not committed)
- `.env` for defaults (committed)
- 12go API key for dev/staging in `.env.local`
- Same pattern as all other F3 development

**Standalone Go microservice:**

Add a service to F3's `docker-compose.yml`:

```yaml
services:
  b2b-api:
    build:
      context: ./b2b-api
      dockerfile: Dockerfile
    ports:
      - "8081:8080"
    env_file:
      - ./b2b-api/.env.local
    depends_on:
      - frontend3
    networks:
      - f3-network
```

The developer runs `docker-compose up` and gets both F3 and the B2B API. B2B API calls 12go's staging environment (or local F3 if testing internal API calls).

## Configuration Management

Follow F3's existing pattern exactly:

| Configuration | Source | Example |
|--------------|--------|---------|
| 12go API base URL | `.env` | `TWELVEGO_API_URL=https://api.12go.co` |
| 12go API key | `.env` (per environment) | `TWELVEGO_API_KEY=abc123` |
| Service port | `.env` | `B2B_PORT=8080` |
| Datadog agent host | `.env` | `DD_AGENT_HOST=localhost` |
| Log level | `.env` | `LOG_LEVEL=info` |
| Per-client configuration | Database table | Client ID -> 12go API key mapping, webhook URLs, markup rules |
| Feature flags | Database or `.env` | Per-client feature toggles (e.g., short booking IDs) |

Per-client configuration (API key mapping, webhook URLs) is stored in the database, loaded at startup or on first access, following the same pattern as the "client identity" SDK that Shauly described (loads client-API key pairs from database into memory at startup).

No AWS AppConfig, no Consul, no external config service. Just `.env` files and database tables. This is what F3 uses, and it works.

## Security Design

### Webhook Authentication (Key Finding #10)

**The problem**: 12go webhook notifications have zero authentication. The `OneTwoGo.PostBookingNotifications.NotificationAuthenticator` returns `ValueTask.CompletedTask`. Any HTTP POST to the webhook endpoint is accepted without validation. This is a known vulnerability.

**Infrastructure-level mitigation (immediate, no 12go changes required):**

1. **IP allowlisting at the reverse proxy / security group level.** Configure the EC2 security group (or the reverse proxy -- nginx, ALB, whatever sits in front) to only accept webhook traffic from 12go's known egress IP addresses. This is the simplest and most operationally sound approach because:
   - It requires no code changes to the webhook handler
   - It does not require 12go to change their webhook delivery
   - It is enforceable at the infrastructure layer, which is where DevOps operates
   - It fails closed (unknown IPs are rejected before reaching the application)

   Implementation: Ask DevOps for 12go's outbound IP ranges. Add them to a security group rule on the webhook port/path.

2. **Separate URL path for webhooks.** Do not serve webhook and client-facing endpoints on the same base path. Use a distinct path prefix:
   ```
   Client API: /v1/{client_id}/bookings/...
   Webhooks:   /webhooks/12go/notifications
   ```
   This makes IP allowlisting cleaner (can apply different security group rules to different paths via the reverse proxy) and makes log filtering easier.

3. **Webhook HMAC verification (application-level, requires 12go coordination).**
   If 12go can be convinced to sign webhook payloads (e.g., HMAC-SHA256 with a shared secret), implement verification:
   ```php
   $signature = $request->headers->get('X-12go-Signature');
   $expected = hash_hmac('sha256', $request->getContent(), $sharedSecret);
   if (!hash_equals($expected, $signature)) {
       return new Response('', 401);
   }
   ```
   This is the gold standard but requires 12go to implement signing on their end. Given that this is the same organization, it is worth requesting.

4. **Replay protection.** Include a timestamp in the webhook payload (12go likely already does) and reject payloads older than 5 minutes. This prevents replay attacks even if a valid webhook is captured.

**Recommended approach**: Implement IP allowlisting immediately (infrastructure-only, zero code changes). Request HMAC signing from 12go as a follow-up. The IP allowlist provides 90% of the security benefit with 0% application complexity.

### Network Exposure

- The B2B API (client-facing) is exposed through the existing AWS API Gateway. No new public endpoints.
- The webhook receiver should be on a separate path, protected by IP allowlisting as described above.
- No additional ports need to be opened on EC2 instances.

### API Key Storage

- 12go API keys (outbound) stored in `.env` files, one per environment. Same as F3's existing approach.
- Per-client API key mapping stored in the database (client identity table).
- No secrets management service (Vault, AWS Secrets Manager) -- this is not in 12go's operational model. `.env` files and database storage are the pattern.

### Secrets Rotation

- API key rotation requires updating `.env` file and redeploying (or updating database row for per-client keys).
- No automated rotation mechanism. This matches the current 12go operational model.
- If secrets management is added later (e.g., AWS Secrets Manager), the configuration can be migrated without code changes -- just change where the `.env` values come from.

## On-Call Runbook (brief: what does the engineer do when this breaks?)

### Alert: "B2B 12go API error rate > 5%"

1. Open Datadog APM. Filter traces by service `b2b-api`, status `error`.
2. Check if errors are concentrated on one operation (search, booking, etc.) or all operations.
3. Check 12go's status. If 12go API is returning 500s across all operations, this is an upstream issue. Escalate to 12go team.
4. If errors are on one operation only, check the error response body in the trace. Common causes:
   - 400: Client sending malformed request (check `client_id` in tags to identify which client)
   - 401: API key expired or invalid (check `.env` for the environment)
   - 500: 12go internal error (escalate)
5. If the error rate is climbing, consider enabling a circuit breaker (if implemented) or returning cached responses for search.

### Alert: "B2B request latency p95 > 10s"

1. Open Datadog APM. Check `b2b.12go_api.duration` -- is 12go itself slow?
2. If 12go response time is normal, check PHP-FPM worker pool. Run `php-fpm status` to see if workers are exhausted.
3. Check EC2 instance CPU and memory in Datadog infrastructure view.
4. If PHP-FPM workers are maxed, increase `pm.max_children` (temporary) or investigate what is consuming workers (long-running requests, connection pool exhaustion).

### Alert: "B2B webhook delivery stopped"

1. Check if 12go is still sending webhooks. Look at Datadog logs for `b2b.webhook.received` metric.
2. Check if the webhook endpoint is reachable. `curl -X POST https://<host>/webhooks/12go/notifications` from a 12go-allowed IP.
3. Check security group rules -- did something change that blocks 12go's IPs?
4. Check PHP-FPM error log for the webhook route.
5. If the endpoint is up but no webhooks arrive, escalate to 12go -- they may have changed webhook configuration.

### General Debugging

- **Logs**: Datadog Log Explorer, filter by `service:b2b-api`
- **Traces**: Datadog APM, filter by service
- **Correlation**: Search by `correlation_id` (from client) or `dd.trace_id` (from Datadog)
- **PHP-FPM**: `docker exec <container> php-fpm status` for worker pool health
- **Configuration**: Check `.env` file on the instance: `docker exec <container> env | grep TWELVEGO`
- **Restart**: `docker restart <container>` -- PHP-FPM restarts in 2-5 seconds

Everything in this runbook uses tools and patterns the on-call engineer already knows from operating F3.

## Unconventional Idea (optional)

### Considered: Dual-write deployment -- PHP bundle + Go sidecar

I briefly considered a hybrid where the B2B logic lives as a Symfony bundle (for DevOps compatibility and co-location with F3), but the webhook receiver runs as a separate Go sidecar container on the same EC2 instance.

The rationale was: the webhook receiver has different operational characteristics (inbound from external, needs IP allowlisting, different traffic pattern, different failure modes) and could benefit from being isolated. A Go binary would start instantly, use minimal resources, and could be independently health-checked.

**Rejected because**: the added operational complexity (two containers, two deployment pipelines, two monitoring configurations) is not justified for what is essentially a single HTTP endpoint that transforms JSON and forwards it. The webhook receiver processes maybe dozens of requests per day. A Symfony controller behind an IP allowlist is sufficient. Adding a Go sidecar for this would be over-engineering from an infrastructure perspective.

### Considered: Nginx-based request routing without code

I also considered whether the simpler B2B endpoints (stations, operators, POIs -- which just return pre-signed S3 URLs) could be handled entirely by nginx rewrite rules, eliminating application code for those routes.

**Rejected because**: while technically possible, it creates a split where some B2B endpoints are in nginx config and others are in PHP. This is confusing to operate and debug. When something goes wrong with the stations endpoint, the engineer needs to check nginx config instead of PHP code. Consistency is more valuable than the tiny performance gain.

## What This Design Optimizes For (and what it sacrifices)

### Optimizes For

- **Operational continuity**: Zero new operational knowledge required from DevOps or on-call engineers
- **Deployment simplicity**: One container, one pipeline, one rollback procedure
- **Observability out of the box**: `dd-trace-php` auto-instruments everything, no custom setup
- **Long-term maintainability**: PHP code maintained by the PHP team that will own it after transition
- **"One system" alignment**: B2B code lives where the organization wants it to live
- **Time to production**: No infrastructure setup, no new pipeline, no DevOps coordination beyond normal F3 deployment

### Sacrifices

- **Developer productivity during implementation**: Soso writes PHP instead of .NET. This is a real cost. AI-assisted development and 12go veteran support partially compensate, but the developer is slower than they would be in their native language.
- **Type safety and tooling**: PHP's type system is weaker than .NET's. Refactoring is riskier. The booking schema parser (500 lines of dynamic field extraction) will be more fragile in PHP than in C# with pattern matching.
- **Testing ergonomics**: PHPUnit is less sophisticated than xUnit/NUnit. Integration testing inside F3's docker-compose setup is more friction than a standalone service with mocked dependencies.
- **Independence from F3 release cycle**: B2B changes are coupled to F3 deployments. If F3 has a deployment freeze, B2B cannot deploy either. If F3 has a broken build, B2B is blocked.
- **Clean architecture boundaries**: Inside F3, the temptation to reach into F3's internal services (instead of going through the HTTP API) is strong. Discipline is needed to maintain the B2B bundle as a self-contained unit that only calls 12go's external API.

The fundamental trade is: developer comfort for operational sustainability. From an infrastructure perspective, this is the correct trade to make. The developer's discomfort is temporary (the implementation period). The operational burden of a foreign runtime is permanent (until someone migrates it back to PHP, which is what would eventually happen anyway).
