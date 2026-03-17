# Platform Engineer Design

## Infrastructure Reality Assessment

The infrastructure I am designing for is not abstract. It is 8 EC2 instances running Docker containers managed by a DevOps team whose entire operational knowledge is PHP 8.3 / Symfony 6.4. Their monitoring is Datadog. Their configuration management is `.env` files and database-stored config. Their deployment process involves release requests, Docker image builds, and container restarts across four environments: Local (Docker), Staging, PreProd (canary), Prod.

This is the ground truth. Everything in this design starts from here.

### What the service actually does

This is an HTTP proxy layer. It receives requests from B2B clients in one shape, translates them, calls 12go's HTTP API, translates the response back, and returns it. There are 13 endpoints. The most complex transformation is the booking schema parser (~500 lines of logic). There is no local database. There is no message queue consumption (except webhook receipt). There is no background processing beyond potentially polling for incomplete results.

The workload profile is:
- **CPU**: Low. JSON serialization/deserialization, string manipulation, HTTP client calls. The service is I/O-bound, waiting on 12go API responses.
- **Memory**: Low. No large datasets in memory. Request-scoped allocations only.
- **Concurrency**: Moderate. Search is the hot path; booking funnel is lower volume.
- **Latency sensitivity**: Search must be fast (sub-second overhead). Booking flow is less critical.

### Who operates this at 3am

The on-call engineer knows PHP. They know how to read Symfony logs in Datadog. They know how to restart a PHP-FPM container. They know how to check `.env` files for misconfiguration. They know how to `docker exec` into a container and inspect the process.

They do not know how to debug a Go panic stack trace. They do not know what `dotnet-dump` is. They do not know how to interpret a Node.js heap snapshot.

This is not a theoretical concern. This is the single most important operational constraint.

---

## Language/Runtime Comparison (infrastructure lens only)

### PHP/Symfony: Operational Profile

**Docker image**: `php:8.3-fpm-alpine` base (~30MB) + Symfony dependencies + Composer install. Final image: ~80-120MB. Identical to every other service in the fleet.

**Deployment**: Zero new patterns. Same Dockerfile structure as F3. Same PHP-FPM process manager. Same nginx/caddy reverse proxy setup (if used). Same `docker-compose` configuration patterns. DevOps copies an existing Dockerfile, changes the `COPY` source, done.

**Datadog APM**: `dd-trace-php` is already installed on every PHP container in the fleet. Auto-instrumentation covers: all Symfony HTTP incoming requests, all `curl`/Guzzle outgoing HTTP calls, PDO (if used), Redis (if used). For this service (HTTP in, HTTP out), Datadog auto-instrumentation gives you full traces with zero manual code.

**PHP-FPM characteristics**: Request-scoped memory (no leaks across requests), process-based concurrency (predictable resource usage), configurable worker count. Well-understood failure modes: 502 if FPM is down, 504 if upstream (12go) times out, memory limit exceeded per-request (restart worker, next request succeeds).

**On-call burden**: The engineer already knows how to debug this. `docker logs`, Datadog traces, PHP error logs in standard locations. No new knowledge required.

**Startup time**: ~2-3 seconds (PHP-FPM worker pool initialization). Not relevant for this workload (no serverless cold starts; containers run continuously).

**Risk**: The developer (Soso) is a .NET expert, not a PHP expert. AI-assisted development can compensate, but PHP idioms and Symfony conventions will require learning. The Search POC inside F3 already demonstrated this is feasible but has friction (local dev setup issues documented in POC results).

### Go: Operational Profile

**Docker image**: Single static binary. `scratch` or `gcr.io/distroless/static-debian12` base. Final image: ~15-25MB. The smallest possible container.

**Deployment**: New pattern for DevOps. No interpreter, no runtime, no package manager inside the container. This is simpler in some ways (fewer moving parts) but alien to a PHP-centric team. `docker exec` into a scratch container gives you nothing -- no shell, no `ps`, no debugging tools. Distroless gives you slightly more, but no package manager to install tools on the fly.

**Datadog APM**: `dd-trace-go` requires explicit instrumentation. You must wrap your HTTP server mux, wrap your HTTP client, and manually create spans for business logic. Auto-instrumentation does not exist in Go the way it does in PHP or .NET. Every HTTP client call to 12go needs manual span creation or use of the instrumented `net/http` roundtripper. This is not hard, but it is not free.

**On-call burden**: High initial friction. Go panic stack traces look different from PHP fatal errors. Memory profiling uses `pprof`, not PHP's `memory_get_usage()`. The on-call engineer needs to learn new tools. However: Go services crash rarely (no null pointer exceptions in the PHP sense; the type system prevents many classes of errors), and when they do crash, they restart instantly (~50ms startup).

**Risk**: Neither the developer nor DevOps knows Go. 12go is "considering Go" but has not adopted it. This would make the B2B proxy the first Go service in the entire fleet -- a guinea pig for infrastructure, CI/CD, monitoring, and on-call procedures.

### .NET: Operational Profile

**Docker image**: Two options.
- **Framework-dependent**: `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` base (~50MB) + published app. Final: ~80-100MB.
- **AOT (Native)**: Self-contained binary on `mcr.microsoft.com/dotnet/runtime-deps:8.0-alpine` (~12MB base) + binary. Final: ~70-90MB. AOT has limited Reflection support, which affects JSON serialization and Datadog instrumentation.

**Deployment**: Completely new pattern for DevOps. New base image to maintain and update. New health check mechanisms (`/health` endpoint via ASP.NET middleware -- straightforward, but different from PHP's FPM status page). New process model (Kestrel, not FPM). New log format (unless explicitly configured to match). `.csproj` build system that DevOps has never seen.

**Datadog APM**: `dd-trace-dotnet` has good auto-instrumentation for ASP.NET Core (incoming requests) and `HttpClient` (outgoing requests). Comparable to PHP in coverage for this workload. However, the Datadog agent configuration for .NET containers is different from PHP: different environment variables (`DD_DOTNET_TRACER_HOME`, `CORECLR_ENABLE_PROFILING`, `CORECLR_PROFILER`), different binary to install in the Docker image.

**On-call burden**: High. The on-call engineer does not know .NET. `dotnet-dump`, `dotnet-counters`, `dotnet-trace` are completely foreign tools. Exception stack traces use C# syntax and .NET framework internals. Memory dumps are in a .NET-specific format. This is the worst-case scenario for a PHP-only on-call team.

**DevOps acceptance**: This is the hardest sell. 12go DevOps has zero .NET experience. They would need to learn: Docker multi-stage builds for .NET, .NET SDK vs runtime images, garbage collection tuning, Kestrel configuration, .NET-specific Datadog setup. For one service that is fundamentally an HTTP proxy, this is a disproportionate operational burden.

**Advantage**: The developer (Soso) is a .NET expert. Development velocity would be highest. AI-assisted development in a familiar language is more productive than in an unfamiliar one.

### Node.js/TypeScript: Operational Profile

**Docker image**: `node:20-alpine` base (~50MB) + `node_modules` + built JS. Final: ~100-150MB (node_modules bloat is real). Larger than PHP, larger than Go, comparable to .NET.

**Deployment**: npm/yarn/pnpm build step in CI. `node_modules` vendoring or layer caching required for reasonable build times. DevOps must understand `package.json` scripts, the Node.js process model (single-threaded event loop), and PM2 or similar process manager for production.

**Datadog APM**: `dd-trace-js` has good auto-instrumentation for Express/Fastify (incoming) and `http`/`https` modules (outgoing). Coverage is comparable to PHP. Setup: `require('dd-trace').init()` at the top of the entry file. Simpler than .NET's profiler injection.

**On-call burden**: Moderate. Node.js error messages are relatively readable. `docker logs` works the same way. However: the event loop model means that a single blocking operation can freeze the entire process (unlike PHP-FPM where one blocked worker does not affect others). Memory leaks in Node.js are notoriously hard to diagnose without experience. V8 heap dumps require specialized tooling.

**DevOps acceptance**: Better than .NET, worse than PHP. Many DevOps teams have some Node.js exposure (build tools, scripts). But 12go's DevOps specifically has PHP expertise, not Node.js.

---

## Recommendation (with infrastructure justification)

**PHP/Symfony is the only operationally responsible choice.**

The justification is not about developer preference. It is about these facts:

1. **DevOps acceptance**: Zero new tooling, zero new base images, zero new monitoring plugins, zero new deployment procedures. The DevOps team can deploy, monitor, debug, and operate this service on day one. Every other option requires a ramp-up period where the DevOps team is operating infrastructure they do not understand.

2. **Datadog integration**: `dd-trace-php` is already installed and configured in every container. Auto-instrumentation covers 100% of the spans this service needs (Symfony incoming requests + Guzzle/curl outgoing HTTP calls). No manual instrumentation code required.

3. **Operational footprint**: PHP-FPM has predictable, request-scoped memory usage. No GC pauses, no event loop blocking, no goroutine leaks. The failure modes are well-understood by the team. Container image is identical in structure to F3.

4. **On-call reality**: When this service fails at 3am, the engineer opens Datadog, sees PHP traces and logs in the same format as every other service, and diagnoses the issue using tools they already know. With any other language, the first 30 minutes of a 3am incident are spent figuring out how to even look at the problem.

5. **Solo developer mitigation**: Soso is a .NET expert, not a PHP expert. This is a real cost. However: the service is an HTTP proxy with well-defined inputs and outputs. The PHP/Symfony ecosystem has excellent HTTP client libraries (Guzzle, Symfony HttpClient). AI-assisted development (Claude Code) handles PHP as effectively as .NET for this type of code. The Search POC already proved that F3-level PHP development is feasible for Soso. A standalone Symfony service is simpler than modifying F3 internals.

6. **Future alignment**: When F3 is refactored (Q2+ planning), this service is already in the same language and framework. If F3 moves to Go in the future, the B2B proxy is a small, well-contained service that can be ported -- but that decision is years away and should not drive today's infrastructure choice.

### What this recommendation does NOT mean

This does not mean embedding the B2B proxy inside F3. The recommendation is a **standalone Symfony application** deployed as its own Docker container. This preserves:
- Independent deployment (no F3 release needed for B2B changes)
- Independent scaling (though the service is small enough that this is unlikely to matter)
- Clean separation of concerns (B2B proxy logic does not pollute F3 codebase)
- Avoidance of F3 local dev setup friction (documented in POC results)

The monolith-vs-microservice question is separate from the language question. From an infrastructure perspective, a standalone PHP service deployed in its own container is operationally identical to F3 -- same base image, same FPM config, same Datadog setup -- but without the coupling risks of embedding in F3.

---

## Deployment Specification

### Docker Image

```dockerfile
FROM php:8.3-fpm-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    libzip-dev \
    icu-dev \
    && docker-php-ext-install \
    zip \
    intl \
    opcache

# Install Datadog APM extension (same as F3 containers)
RUN curl -LO https://github.com/DataDog/dd-trace-php/releases/latest/download/datadog-setup.php \
    && php datadog-setup.php --php-bin=all \
    && rm datadog-setup.php

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Install dependencies first (layer caching)
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts

# Copy application code
COPY . .
RUN composer dump-autoload --optimize

# PHP-FPM configuration
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/www.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD php-fpm-healthcheck || exit 1
```

**Why this image**: `php:8.3-fpm-alpine` is the smallest official PHP-FPM image. Alpine-based images are ~30MB vs ~80MB for Debian-based. The final image will be ~80-120MB including Composer dependencies, OPcache, and the Datadog extension. This is identical to the base image used by F3.

**Note on reverse proxy**: PHP-FPM does not serve HTTP directly. The deployment will need nginx or Caddy as a reverse proxy in front of FPM. Options:
- Sidecar nginx container (standard pattern, used by F3)
- Single container with nginx + FPM using supervisord (simpler but less standard)
- Symfony's built-in development server is NOT for production

I recommend matching whatever pattern F3 uses. If F3 runs nginx + FPM as separate containers in the same pod/deployment, do the same.

### Resource Limits

Based on the workload profile (I/O-bound HTTP proxy, no local storage, request-scoped memory):

| Resource | Request | Limit | Rationale |
|----------|---------|-------|-----------|
| CPU | 0.25 vCPU | 0.5 vCPU | JSON transformation is not CPU-intensive. Most time is spent waiting on 12go API. |
| Memory | 128MB | 256MB | PHP-FPM workers use ~20-30MB each. 4-8 workers = 80-240MB. 256MB limit provides headroom. |

**PHP-FPM pool configuration** (`php-fpm.conf`):

```ini
[www]
pm = static
pm.max_children = 8
pm.max_requests = 1000

; Timeouts
request_terminate_timeout = 65s
```

**Rationale for `pm = static`**: For a container with fixed resource limits, static worker count is more predictable than dynamic. 8 workers at ~20MB each = ~160MB steady state, well within the 256MB limit. `pm.max_requests = 1000` recycles workers periodically to prevent any memory creep.

**Why 65s request timeout**: 12go search rechecks can take up to 60 seconds. The request timeout must exceed this. 65s gives a 5-second buffer.

### Health Checks and Graceful Shutdown

**Health check endpoint**: `GET /health`

```php
// src/Controller/HealthController.php
#[Route('/health', methods: ['GET'])]
public function health(): JsonResponse
{
    return new JsonResponse([
        'status' => 'ok',
        'timestamp' => time(),
        'version' => $_ENV['APP_VERSION'] ?? 'unknown',
    ]);
}
```

This endpoint does NOT check 12go API connectivity. Health checks must be fast and must not create cascading failures. If 12go is down, the service is still "healthy" -- it will return errors to callers, but it should not be killed and restarted (which would not fix the upstream issue).

**Readiness check** (optional, for more sophisticated orchestration): `GET /ready` -- could verify 12go API key is configured and a test call succeeds. Use only if the deployment system supports separate liveness vs readiness probes.

**Graceful shutdown**:

PHP-FPM handles SIGTERM gracefully by default:
1. Stops accepting new connections
2. Waits for in-flight requests to complete
3. Exits after `process_control_timeout` (configure to 30s)

```ini
; In php-fpm.conf
process_control_timeout = 30s
```

The deployment orchestration should:
1. Send SIGTERM to the container
2. Wait up to 30 seconds for graceful shutdown
3. Send SIGKILL if the container has not exited

This matches the standard PHP-FPM shutdown behavior that DevOps already operates.

### CI/CD Pipeline

The pipeline should mirror F3's deployment process as closely as possible. Steps:

```
1. [Code Push] → Git push to branch
2. [CI: Lint]  → PHP-CS-Fixer + PHPStan (static analysis)
3. [CI: Test]  → PHPUnit (unit tests, integration tests with mocked 12go responses)
4. [CI: Build] → Docker build (multi-stage: composer install → copy app → final image)
5. [CI: Push]  → Push Docker image to registry (same registry as F3)
6. [CD: Stage] → Deploy to Staging (automatic)
7. [CD: Test]  → Smoke tests against Staging (hit /health, hit search with test credentials)
8. [CD: PreProd] → Deploy to PreProd (manual approval or automatic)
9. [CD: Canary] → Route small % of traffic to new version (if supported by infrastructure)
10. [CD: Prod]  → Deploy to Prod (manual approval via release request)
```

**Total steps**: 10 (same as any other PHP service in the fleet).
**Who can do it**: Anyone who can deploy F3 can deploy this service. Same Docker registry, same deployment tooling, same release request process.
**Build time**: ~2-3 minutes (Composer install is fast; no compilation step like .NET or Go).

---

## Observability Design

### Datadog APM Integration

**Library**: `dd-trace-php` (same version installed in F3 containers).

**Environment variables** (set in `.env` or Docker environment):

```env
DD_AGENT_HOST=datadog-agent
DD_SERVICE=b2b-proxy
DD_ENV=production
DD_VERSION=1.0.0
DD_TRACE_ENABLED=true
DD_TRACE_SAMPLE_RATE=1.0
DD_LOGS_INJECTION=true
```

**Automatic instrumentation** (zero code required):

| What | Coverage | Notes |
|------|----------|-------|
| Incoming HTTP requests (Symfony) | Full | Route, status code, duration, parameters |
| Outgoing HTTP requests (Guzzle/Symfony HttpClient) | Full | URL, method, status code, duration |
| Redis (if used for caching) | Full | Command, key prefix, duration |
| PDO/MariaDB (if used) | Full | Query, duration |

For this service, the automatic instrumentation covers everything we need. The service receives HTTP requests and makes HTTP calls to 12go. Both directions are auto-traced.

**Manual instrumentation needed only for**:
- Business-level span names (e.g., `b2b.search`, `b2b.create_booking`) -- wrap controller methods with custom spans for cleaner Datadog service maps
- Custom span tags: `client_id`, `booking_id`, `itinerary_id` on relevant spans

```php
// Example: Adding business context to auto-instrumented spans
use DDTrace\GlobalTracer;

$span = GlobalTracer::get()->getActiveSpan();
$span->setTag('client_id', $clientId);
$span->setTag('booking_id', $bookingId);
```

### Correlation ID Propagation

The existing system uses `x-correlation-id` and `x-request-id` headers. The new service must:

1. **Read** `x-correlation-id` from incoming request headers
2. **Propagate** the same `x-correlation-id` to all outgoing 12go API calls
3. **Include** the correlation ID in all log entries
4. **Set** the Datadog trace ID as the correlation ID if none is provided

Implementation:

```php
// Middleware: CorrelationIdMiddleware
public function __invoke(Request $request, callable $next): Response
{
    $correlationId = $request->headers->get('x-correlation-id')
        ?? $request->headers->get('x-request-id')
        ?? \DDTrace\root_span()->getTraceId();

    // Store for use in HTTP client and logging
    $request->attributes->set('correlation_id', $correlationId);

    // Add to Datadog span
    $span = \DDTrace\GlobalTracer::get()->getActiveSpan();
    if ($span) {
        $span->setTag('correlation_id', $correlationId);
    }

    $response = $next($request);
    $response->headers->set('x-correlation-id', $correlationId);

    return $response;
}
```

The Guzzle/HttpClient middleware adds `x-correlation-id` to every outgoing request to 12go.

### Structured Logging

**Format**: JSON, one line per log entry. Datadog parses JSON logs natively.

**Symfony Monolog configuration** (`config/packages/monolog.yaml`):

```yaml
monolog:
    handlers:
        main:
            type: stream
            path: "php://stdout"
            level: info
            formatter: monolog.formatter.json
    processors:
        - monolog.processor.datadog
```

**Standard fields in every log entry**:

```json
{
    "timestamp": "2026-03-17T14:30:00.000Z",
    "level": "info",
    "message": "Search completed",
    "service": "b2b-proxy",
    "dd.trace_id": "1234567890",
    "dd.span_id": "9876543210",
    "client_id": "acme",
    "correlation_id": "abc-123-def",
    "endpoint": "search",
    "duration_ms": 245,
    "twelve_go_status": 200
}
```

The `dd.trace_id` and `dd.span_id` fields are injected automatically by `dd-trace-php` when `DD_LOGS_INJECTION=true`. This enables one-click navigation from a log entry to its full trace in Datadog.

### Custom Metrics

Using Datadog's `DogStatsD` client for PHP (or Datadog APM's built-in metric emission):

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `b2b.request.count` | Counter | `endpoint`, `client_id`, `status_code` | Total request count per endpoint |
| `b2b.request.duration` | Histogram | `endpoint`, `client_id` | Request latency (p50, p95, p99) |
| `b2b.twelvego.request.count` | Counter | `endpoint`, `status_code` | 12go API call count |
| `b2b.twelvego.request.duration` | Histogram | `endpoint` | 12go API call latency |
| `b2b.twelvego.error.rate` | Counter | `endpoint`, `error_type` | 12go API errors by type (400, 401, 404, 500+) |
| `b2b.search.empty_results` | Counter | `client_id` | Searches returning zero results |
| `b2b.booking.state_change` | Counter | `from_state`, `to_state`, `client_id` | Booking state transitions |

**Tag dimensions match** the required monitoring dimensions from the Team Lead: `client_id`, `operator` (where available from response), `action` (endpoint), `outcome` (status code), `booking_id`, `itinerary_id`, `trace_id`.

Most of these metrics can be derived from Datadog APM's auto-instrumented spans (request count, duration, status codes come free). Custom metrics are only needed for business-specific dimensions like `client_id` tagging and empty search results.

### Alerting

**First alert to configure**: 12go API error rate.

```
Alert: b2b.twelvego.error.rate > 10% over 5 minutes
Threshold: error_count / total_count > 0.10 for 5 consecutive minutes
Severity: P2 (page on-call)
Channel: Slack #b2b-alerts + PagerDuty
```

**Why this is first**: The most likely failure mode for this service is 12go API being down or returning errors. The service itself is stateless and simple -- it is unlikely to have its own bugs after initial deployment. The upstream dependency is the primary risk.

**Additional alerts** (in priority order):

| Alert | Threshold | Severity |
|-------|-----------|----------|
| Service health check failing | 3 consecutive failures | P1 |
| Request latency p95 > 5s | 5 minutes sustained | P2 |
| PHP-FPM worker pool exhausted | All workers busy for 30s | P2 |
| Error rate on client-facing endpoints > 5% | 5 minutes sustained | P2 |
| Memory usage > 80% of container limit | Sustained 10 minutes | P3 |
| Search empty result rate > 50% | 15 minutes (per client) | P3 (investigation) |

---

## Local Development Setup

### docker-compose Integration

The B2B proxy service fits into 12go's existing `docker-compose` setup as an additional service:

```yaml
# docker-compose.override.yml (or added to existing docker-compose.yml)
services:
  b2b-proxy:
    build:
      context: ./b2b-proxy
      dockerfile: Dockerfile
    ports:
      - "8081:80"
    environment:
      - APP_ENV=dev
      - APP_DEBUG=1
      - TWELVEGO_API_BASE_URL=http://frontend3:80
      - TWELVEGO_API_KEY=${TWELVEGO_DEV_API_KEY}
      - DD_AGENT_HOST=datadog-agent
      - DD_TRACE_ENABLED=false  # Disable APM locally unless testing traces
    volumes:
      - ./b2b-proxy/src:/app/src  # Hot reload for development
      - ./b2b-proxy/config:/app/config
    depends_on:
      - frontend3  # Only if testing against local F3
    networks:
      - default  # Same network as F3 and other services
```

### Environment Variable Management

Three `.env` files, matching the existing F3 convention:

| File | Purpose | Git-tracked? |
|------|---------|-------------|
| `.env` | Default values, shared across all environments | Yes |
| `.env.local` | Local developer overrides (API keys, debug flags) | No (gitignored) |
| `.env.{environment}` | Per-environment overrides (staging, preprod, prod) | Managed by DevOps |

Symfony's built-in `.env` cascade handles precedence: `.env` < `.env.local` < `.env.{APP_ENV}` < `.env.{APP_ENV}.local` < real environment variables.

**Key environment variables**:

```env
# .env (defaults)
APP_ENV=prod
APP_DEBUG=0
TWELVEGO_API_BASE_URL=https://12go.asia
TWELVEGO_API_KEY=  # Must be set per-environment
TWELVEGO_API_TIMEOUT=65
WEBHOOK_HMAC_SECRET=  # For webhook signature verification
LOG_LEVEL=info
```

### Running Locally Alongside F3

**Option A (recommended): B2B proxy calls 12go staging API directly**

The developer runs only the B2B proxy container locally. It calls 12go's staging API (`https://integration-dev.travelier.com`) using a staging API key. No need to run F3 locally at all.

```bash
# .env.local
TWELVEGO_API_BASE_URL=https://integration-dev.travelier.com
TWELVEGO_API_KEY=<staging-api-key>
```

This is the simplest setup and avoids all the F3 local dev friction documented in the Search POC results.

**Option B: Full local stack**

If testing against a local F3 instance is needed (e.g., testing new F3 capabilities like cancellation policies):

```bash
# Start the full local stack
docker-compose up -d frontend3 mariadb redis b2b-proxy
```

The B2B proxy's `TWELVEGO_API_BASE_URL` points to the local F3 container (`http://frontend3:80`).

---

## Configuration Management

All configuration follows 12go's existing patterns:

| Configuration | Storage | Access Pattern |
|---------------|---------|---------------|
| 12go API base URL | `.env` file | `$_ENV['TWELVEGO_API_BASE_URL']` |
| 12go API key (per-client) | Database table or `.env` | Loaded at request time from client config |
| Client ID to API key mapping | Database table (12go MariaDB) | Read at startup or per-request with cache |
| Webhook HMAC secret | `.env` file | `$_ENV['WEBHOOK_HMAC_SECRET']` |
| Timeouts and retry config | `.env` file | `$_ENV['TWELVEGO_API_TIMEOUT']` |
| Feature flags | `.env` or database | Per-feature toggle |

**Client configuration**: The mapping from `client_id` (URL path) to `12go API key` (query parameter) must live somewhere. Options:

1. **Database table** (recommended): A simple table in 12go's MariaDB: `b2b_clients(client_id, api_key, webhook_url, active)`. This aligns with the "client identity" SDK pattern already used by 12go (loads client-API key pairs from database at startup).

2. **`.env` file**: For a small number of clients, `CLIENT_ACME_API_KEY=xxx` pattern works. Does not scale, requires redeployment to add clients.

I recommend the database approach. It matches 12go's existing patterns, allows client onboarding without redeployment, and can be managed through 12go's admin UI.

---

## Security Design

### Webhook Authentication (Key Finding #10)

**The problem**: 12go webhook notifications to the booking-notification endpoint have zero authentication. The current `OneTwoGo NotificationAuthenticator.Authenticate()` returns `CompletedTask` -- any HTTP POST to the endpoint is accepted.

**The threat**: An attacker who discovers the webhook URL can send fake booking status change notifications, potentially causing clients to act on false booking cancellations or confirmations.

**Infrastructure-level mitigation (immediate, no 12go changes required)**:

1. **IP allowlist**: Configure the reverse proxy (nginx) or a firewall rule to only accept webhook requests from 12go's known IP ranges. This is the simplest network-level control and requires no application code changes.

```nginx
# nginx configuration for webhook endpoint
location /v1/notifications/ {
    allow 12go.ip.range.1/24;
    allow 12go.ip.range.2/24;
    deny all;

    fastcgi_pass b2b-proxy:9000;
    include fastcgi_params;
}
```

This is operationally simple: DevOps maintains the IP allowlist in nginx config. If 12go's IPs change, update the config and reload nginx.

2. **Separate port or path isolation**: Run the webhook receiver on a different port (e.g., 8082) or under a non-guessable path prefix. This reduces the attack surface by separating public-facing client API endpoints from internal webhook endpoints.

```yaml
# docker-compose
b2b-proxy-webhooks:
    build: ./b2b-proxy
    ports:
      - "8082:80"  # Internal port, not exposed through API Gateway
    environment:
      - WEBHOOK_MODE=true
```

However, separate containers for webhooks add operational complexity. Prefer the IP allowlist on a separate path within the same container.

**Application-level mitigation (implement alongside the service)**:

3. **HMAC signature verification**: Implement webhook signature verification in the B2B proxy. When 12go sends a webhook, it should include a signature header (e.g., `x-webhook-signature: sha256=<hex>`). The service verifies the signature against a shared secret.

```php
// Middleware: WebhookSignatureMiddleware
public function verify(Request $request): bool
{
    $signature = $request->headers->get('x-webhook-signature');
    if (!$signature) {
        // Fallback: allow if IP is in allowlist (transitional)
        return $this->isAllowedIp($request->getClientIp());
    }

    $payload = $request->getContent();
    $expected = 'sha256=' . hash_hmac('sha256', $payload, $this->secret);
    return hash_equals($expected, $signature);
}
```

**Important**: This requires 12go to add signature generation to their webhook delivery. If 12go cannot or will not add signing, the IP allowlist is the primary defense. The application code should support both modes (signature verification when available, IP allowlist as fallback).

**Recommendation**: Start with IP allowlist (day one, no 12go coordination needed). File a request with 12go to add HMAC signing to webhook delivery. When available, enable signature verification in the application and eventually remove the IP-only fallback.

### Network Exposure

The B2B proxy should be accessible only through the existing AWS API Gateway. It should NOT have a public IP or be directly accessible from the internet.

```
[Internet] → [AWS API Gateway] → [B2B Proxy Container] → [12go API]
                                        ↑
                            [12go Webhooks] (IP-restricted)
```

- **Client-facing endpoints** (13 API endpoints): Routed through API Gateway, which handles API key validation
- **Webhook endpoint**: Accessible from 12go's IP range only (nginx allowlist)
- **Health check**: Accessible from internal network only (Docker health check, load balancer health probe)
- **No other exposed ports**

### API Key Storage

- **12go API keys** (outbound, for calling 12go): Stored in the client configuration database table (`b2b_clients.api_key`). In the future, consider migrating to a secrets manager (AWS Secrets Manager, HashiCorp Vault) -- but for initial deployment, database storage matches 12go's existing pattern where API keys are stored in MariaDB.
- **Webhook HMAC secret** (inbound): Stored in `.env` file, injected as environment variable. One shared secret across all webhook deliveries (12go uses a single webhook configuration per subscriber).
- **No secrets in Docker images**: All secrets come from environment variables or database. Images are safe to store in any registry.

---

## On-Call Runbook (brief: what does the engineer do when this breaks?)

### Service is down (health check failing)

1. Check container status: `docker ps | grep b2b-proxy`
2. If container is not running: `docker logs b2b-proxy --tail 100` -- look for PHP fatal errors
3. If container is running but health check fails: `docker exec b2b-proxy php-fpm-healthcheck` -- check FPM status
4. Common cause: `.env` misconfiguration after deployment. Check `docker exec b2b-proxy env | grep TWELVEGO`
5. Restart: `docker restart b2b-proxy`

### High error rate on client-facing endpoints

1. Open Datadog APM: Service `b2b-proxy`, look at error traces
2. Check if errors are from B2B proxy or from 12go upstream:
   - If 12go is returning 500s: check 12go status, nothing to do on our side
   - If 12go is returning 400s: check request transformation logic, look at specific error messages
   - If B2B proxy itself is erroring: look at PHP error logs in Datadog, stack trace will point to the exact line
3. Check recent deployments: was a new version deployed? Rollback if needed

### Slow responses (latency alert)

1. Open Datadog APM: Service `b2b-proxy`, look at latency traces
2. Check time breakdown: is the latency in B2B proxy (transformation) or in 12go API call (upstream)?
3. If 12go is slow: nothing to do on our side. Alert is informational.
4. If B2B proxy is slow: check PHP-FPM worker pool status (`pm.status`). If all workers are busy, the pool is saturated. Increase `pm.max_children` or container resource limits.

### Webhook notifications not arriving to clients

1. Check if 12go is sending webhooks: look at Datadog logs for incoming webhook requests
2. If webhooks are arriving: check transformation logic and client URL forwarding
3. If webhooks are NOT arriving: check 12go's webhook configuration. IP allowlist may be blocking (check nginx access logs)
4. Test manually: `curl -X POST http://b2b-proxy:8081/v1/notifications/test -d '{"test": true}'`

### Key information for the on-call engineer

- **Language**: PHP 8.3 / Symfony 6.4 (same as F3)
- **Process manager**: PHP-FPM (same as F3)
- **Logs**: Datadog, service name `b2b-proxy`
- **Config**: `.env` file in container, database for client config
- **No database to worry about**: Service is stateless, all data comes from 12go
- **Restart is always safe**: No state to lose, no transactions to interrupt (in-flight requests will fail, clients retry)

---

## Unconventional Idea (optional)

### Considered: Deploy the B2B proxy as a Symfony Bundle inside F3

Instead of a standalone service, package the B2B proxy as a Symfony Bundle that gets installed into F3 via Composer. This would mean:

- Zero additional containers (no new deployment target)
- Zero additional infrastructure (no new health checks, no new resource limits)
- Shared PHP-FPM pool with F3 (rides on F3's scaling)
- Shared Datadog APM (automatically appears in F3's service traces)
- Shared database connection (for client configuration)

**Why rejected**:

- Couples B2B proxy deployment to F3 deployment. Any B2B change requires an F3 release.
- F3 is about to undergo major refactoring (Q2 planning). B2B code inside F3 becomes collateral damage.
- F3 local development is painful (documented in POC results). Independent development of the B2B proxy would be blocked by F3 setup issues.
- The Team Lead explicitly said the transition design "will live for a significant time" -- it needs to be independent enough to survive F3 changes.
- The Search POC already demonstrated the friction of working inside F3. A standalone service avoids this entirely.

The standalone container approach preserves operational simplicity (same technology as F3) without the coupling risks of embedding in F3.

### Considered: PHP without Symfony (micro-framework)

Use a lighter framework like Slim or even raw PHP with a router. The B2B proxy is small enough that Symfony's full framework might be overkill.

**Why rejected**:

- DevOps knows Symfony. The directory structure, the console commands (`bin/console`), the `.env` handling, the Monolog logging -- all familiar.
- Datadog's `dd-trace-php` has first-class Symfony integration with auto-detected route names and controller spans. Raw PHP would require more manual instrumentation.
- Symfony's HttpClient component has built-in retry, timeout, and logging that matches Guzzle's feature set but with better Symfony integration.
- The overhead of Symfony for 13 endpoints is negligible. Framework startup is cached by OPcache after first request.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for

- **Operational simplicity**: One technology stack across the entire fleet. No new knowledge required for DevOps, on-call, or infrastructure management.
- **Deployment speed**: Same CI/CD pipeline, same Docker patterns, same Datadog setup. Zero infrastructure ramp-up.
- **Observability out of the box**: `dd-trace-php` auto-instrumentation covers 100% of the service's HTTP traffic with zero code.
- **12go DevOps acceptance**: The easiest possible conversation. "It is another PHP service, identical to F3."
- **Survivability during F3 refactoring**: Standalone container, same technology, can be absorbed into a refactored F3 or kept independent -- either path is operationally simple.
- **Solo developer feasibility**: 13 HTTP proxy endpoints in Symfony, with AI-assisted development, is achievable by one developer in Q2.

### Sacrifices

- **Developer productivity**: Soso is a .NET expert. Writing PHP is slower than writing C#, even with AI assistance. The learning curve for Symfony conventions, Composer dependency management, and PHP idioms is real. Estimate: 20-30% reduced velocity compared to .NET for the first 2-3 weeks, decreasing to ~10% after familiarity builds.
- **Type safety**: PHP's type system is weaker than C#'s. The booking schema parser with its 20+ dynamic field patterns will be more error-prone to implement in PHP. Mitigation: PHPStan at maximum level, comprehensive unit tests for all transformation logic.
- **Team expertise alignment**: The existing .NET team cannot easily review or contribute to PHP code. The B2B proxy becomes a service that only Soso (and 12go PHP veterans) can maintain. This is a bus factor risk. However: the service is small (13 endpoints, ~2000-3000 lines of business logic), well-documented, and follows standard Symfony patterns that any PHP developer can understand.
- **Existing code reuse**: The C# HTTP client code, request/response models, and transformation logic (~2500 lines) cannot be directly ported. They must be reimplemented in PHP. With .NET, these could be copied and adapted. This is a one-time cost of ~1-2 weeks of additional development.
