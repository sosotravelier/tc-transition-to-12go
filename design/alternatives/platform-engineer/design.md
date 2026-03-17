# Platform Engineer Design

## Infrastructure Reality Assessment

The infrastructure is not hypothetical. It is 8 EC2 instances running Docker containers, managed by a DevOps team whose toolchain is PHP-native. Every container on those hosts runs PHP 8.3 / Symfony 6.4. Datadog is the single observability platform -- `dd-trace-php` is installed in every container, DogStatsD receives metrics with the `f3.` prefix, and Monolog ships logs via GELF. The deployment pipeline, the alerting, the runbooks, the on-call engineer's muscle memory -- all of it assumes PHP.

This is the environment the new B2B API layer must operate in.

### What DevOps Controls

- Docker image builds and registry
- EC2 instance provisioning and scaling
- Datadog agent configuration (DogStatsD, APM)
- `.env` file distribution per environment
- Container orchestration and health check monitoring
- SSL termination and network routing
- Environment promotion: Local -> Staging -> PreProd (canary) -> Prod

### What DevOps Does Not Control

- Application code or framework choice (but they strongly prefer what they know)
- API contract design
- Business logic decisions

### The 3am Question

When this service throws a 500 at 3am, the on-call engineer will:
1. Open Datadog, look at the APM trace
2. SSH into the EC2 host, `docker logs` the container
3. Check PHP-FPM status and worker pool
4. Restart the container if needed

If the service is written in Go, .NET, or Node.js, step 3 becomes "I don't know what to check" and step 4 becomes "I hope restarting works." That is not acceptable for a service handling live bookings.

---

## Language/Runtime Comparison (infrastructure lens only)

### PHP/Symfony: Operational Profile

**Docker image**: `php:8.3-fpm-alpine` base (~45MB) + Symfony deps + `dd-trace-php` extension. Final image ~120-150MB. Identical to every other container on the fleet.

**Deployment**: Zero new pipeline steps. Same Dockerfile template. Same `docker-compose` config structure. Same PHP-FPM tuning knobs. DevOps copies an existing service config and changes the app directory.

**Datadog APM**: `dd-trace-php` is already installed and configured. Auto-instruments: Symfony HTTP kernel, Guzzle/cURL HTTP clients, PDO database calls, Redis calls. Zero manual instrumentation needed for the critical path (inbound HTTP request -> outbound 12go API call). Correlation ID propagation works automatically through Datadog's distributed tracing headers.

**Memory**: PHP-FPM workers use ~20-40MB each. With 4-8 workers per container, total ~160-320MB. Predictable, well-understood by DevOps.

**Startup time**: Cold start ~2-3 seconds (PHP-FPM + Symfony container compilation). Warm restart (SIGUSR2 to FPM master) ~500ms.

**On-call burden**: None above baseline. Same language, same tools, same debugging approach as every other service.

**DevOps acceptance**: Automatic. No discussion needed.

### Go: Operational Profile

**Docker image**: Static binary in `gcr.io/distroless/static-debian12` (~20MB). Smallest possible image. No runtime dependencies.

**Deployment**: New Dockerfile template (multi-stage build: Go builder -> distroless). No PHP-FPM. No `.ini` files. Different process model (single binary, goroutine-based concurrency). DevOps must learn: how Go handles signals, how to tune GOMAXPROCS, what a goroutine leak looks like, how to read Go stack traces.

**Datadog APM**: `dd-trace-go` provides auto-instrumentation for `net/http`, `gorilla/mux`, gRPC. HTTP client calls require wrapping with `httptrace.WrapClient()` -- not automatic. Manual span creation needed for custom business logic. Correlation ID propagation requires explicit header injection/extraction.

**Memory**: ~10-30MB for a Go HTTP service. Excellent. But DevOps has no baseline for what "normal" looks like, which means no useful alerting thresholds on day one.

**Startup time**: ~50-100ms. Excellent, but irrelevant -- this is not a serverless workload.

**On-call burden**: High initially. Go panics look nothing like PHP errors. `pprof` profiling is powerful but requires Go knowledge. Stack traces reference goroutines, not request handlers. DevOps would need training.

**DevOps acceptance**: Moderate resistance. 12go is "considering Go" for the future, which provides some organizational cover. But "considering" is not "operating in production." The DevOps team would be learning Go operations on a live booking system.

### .NET: Operational Profile

**Docker image**: `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` (~90MB) or AOT-published to ~60-90MB. Requires .NET runtime or self-contained publish.

**Deployment**: Entirely new pipeline. New base image. New health check conventions. New graceful shutdown patterns (`IHostedService`, `IHostApplicationLifetime`). MSBuild/dotnet CLI instead of Composer. NuGet instead of Packagist. Different CI cache strategy.

**Datadog APM**: `dd-trace-dotnet` auto-instruments: ASP.NET Core, HttpClient, ADO.NET, gRPC. Good coverage. But the Datadog .NET agent must be installed in the Docker image (either via `dd-trace-dotnet-linux-x64.tar.gz` injection or as a sidecar). DevOps has never done this.

**Memory**: ~50-100MB for a minimal ASP.NET Core service. Higher than Go, lower than PHP-FPM with multiple workers. But again -- no baseline for DevOps to alert on.

**Startup time**: ~1-2 seconds (without AOT), ~200-500ms (with AOT). Comparable to PHP.

**On-call burden**: Very high. .NET is completely foreign to the 12go infrastructure. Kestrel configuration, `appsettings.json` layering, dependency injection container, middleware pipeline -- none of this maps to PHP-FPM concepts. When the on-call engineer sees a .NET stack trace, they are reading a foreign language.

**DevOps acceptance**: Strong resistance expected. This is the single runtime on the fleet that nobody has ever operated. The Soso-as-sole-developer constraint makes this worse, not better -- if Soso is unavailable, nobody can debug a .NET service in production.

### Node.js/TypeScript: Operational Profile

**Docker image**: `node:20-alpine` (~50MB) + `node_modules` (~50-200MB depending on deps). Final image ~150-250MB.

**Deployment**: New pipeline. `npm ci` build step. `node_modules` caching. Different process model (single-threaded event loop, `cluster` module for multi-core). PM2 or similar process manager needed for production.

**Datadog APM**: `dd-trace-js` auto-instruments: Express/Fastify, `http`/`https` module, popular ORMs. Good coverage for HTTP workloads. Requires `--require dd-trace/init` at startup or programmatic initialization.

**Memory**: ~50-100MB baseline for a Node.js process. Can spike with large JSON parsing (relevant: booking schema responses are large JSON objects).

**Startup time**: ~500ms-1s. Acceptable.

**On-call burden**: Moderate. JavaScript is more widely known than Go or .NET, and `docker logs` still works. But the event loop model, `unhandledRejection` behavior, and Node.js-specific memory patterns are unfamiliar to a PHP team.

**DevOps acceptance**: Moderate resistance. Better than .NET (at least some devops teams have seen Node.js), worse than PHP (not what runs on these hosts), roughly equivalent to Go in terms of "new thing to learn."

---

## Recommendation (with infrastructure justification)

**PHP/Symfony. Standalone service, not inside F3.**

The infrastructure case is unambiguous:

1. **DevOps acceptance**: PHP is the only runtime that requires zero infrastructure changes. Same base image, same FPM config, same Datadog integration, same deployment pipeline.

2. **Operational footprint**: No new base images to maintain. No new APM agent to install. No new process model to understand. No new debugging tools to learn.

3. **Datadog integration**: `dd-trace-php` is already deployed and configured. Auto-instrumentation covers Symfony controllers and Guzzle HTTP clients out of the box. This means the B2B service gets full APM traces from day one without writing a single line of instrumentation code.

4. **Deployment pattern**: Identical to existing F3 services. DevOps can clone an existing service's Docker and deployment configuration.

**Why standalone and not inside F3:**

From an infrastructure perspective, a separate container is operationally cleaner than modifying F3:

- **Independent scaling**: The B2B API has a different load profile than F3's consumer-facing traffic. Separate containers allow independent resource limits.
- **Independent deployment**: Deploying B2B changes does not require restarting F3. This eliminates a whole class of "I deployed my change and it broke the main site" incidents.
- **Blast radius**: If the B2B service crashes, F3 continues serving. If it is inside F3 and a bad B2B code path triggers a segfault in a PHP-FPM worker, it takes down the shared worker pool.
- **Resource isolation**: PHP-FPM worker pools are finite. A burst of B2B search traffic should not starve F3's own request handling.

The "one system" vision from management does not require code to live in the same Docker container. It means the same runtime, the same framework, the same deployment infrastructure, and the same team owning both. A standalone Symfony service on the same EC2 fleet, using the same Datadog, the same `.env` conventions, and the same deployment pipeline achieves this.

**Addressing the F3 refactoring concern**: When F3 is eventually refactored, a standalone Symfony service written in clean, well-structured PHP is straightforward to absorb into whatever F3 becomes. If F3 stays PHP, it is a copy-paste merge. If F3 moves to Go, the PHP service has the same migration cost as F3's own code -- no worse. A .NET microservice, by contrast, is in a different language and cannot be absorbed at all.

---

## Deployment Specification

### Docker Image

```dockerfile
FROM php:8.3-fpm-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    libzip-dev \
    icu-dev \
    linux-headers

# Install PHP extensions
RUN docker-php-ext-install \
    zip \
    intl \
    opcache \
    pcntl

# Install Datadog tracing extension
RUN curl -LO https://github.com/DataDog/dd-trace-php/releases/latest/download/datadog-setup.php \
    && php datadog-setup.php --php-bin=all \
    && rm datadog-setup.php

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

FROM base AS build
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts
COPY . .
RUN composer dump-autoload --optimize

FROM base AS production
WORKDIR /app
COPY --from=build /app /app

# PHP-FPM configuration
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/www.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/99-app.ini

EXPOSE 9000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD php-fpm-healthcheck || exit 1
```

**Why this image**: `php:8.3-fpm-alpine` is the standard 12go base. Alpine keeps it small. FPM is the process manager DevOps knows. The Datadog setup script installs `ddtrace` as a PHP extension -- the same way it is installed in F3 containers.

### Resource Limits

| Resource | Limit | Request | Rationale |
|----------|-------|---------|-----------|
| CPU | 1.0 core | 0.25 core | B2B traffic is I/O-bound (waiting on 12go API). Low CPU burst needed for JSON serialization |
| Memory | 512MB | 256MB | 8 FPM workers x 30MB each = 240MB + overhead. Allows headroom for booking schema parsing (large JSON) |

These are estimates. After the first week in production with Datadog resource metrics, adjust to the P95 observed usage + 30% headroom.

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

The health check does NOT call 12go. If 12go is down, this service should still be marked healthy -- it can return meaningful error responses to clients. The health check verifies the PHP-FPM process is responsive and the Symfony kernel boots. A deeper check (`/health/ready`) can verify 12go API reachability for operational dashboards but should not gate container restarts.

**Graceful shutdown**:

PHP-FPM handles SIGTERM by default: it stops accepting new connections and waits for in-flight requests to complete. Configure `process_control_timeout = 30` in `php-fpm.conf`. This gives active requests 30 seconds to finish (more than enough -- the longest operation is a booking confirm, which waits on 12go's API, typically <10s).

Docker's `stop_grace_period: 35s` should exceed FPM's `process_control_timeout` to avoid SIGKILL during graceful drain.

Symfony's `kernel.terminate` event fires after the response is sent, allowing background cleanup (closing connections, flushing metrics) without blocking the client.

### CI/CD Pipeline

```
1. Git push to branch
2. CI: composer install --no-dev
3. CI: phpunit (unit tests, ~30s)
4. CI: phpstan (static analysis, ~10s)
5. CI: docker build (multi-stage, ~60s)
6. CI: docker push to registry
7. Deploy to Staging (automatic)
8. Integration tests against staging 12go API
9. Manual approval gate
10. Deploy to PreProd (canary with real traffic)
11. Monitor Datadog dashboards for 30 min
12. Deploy to Prod (rolling restart)
```

This pipeline is identical to what F3 uses. Steps 2-6 are commodity PHP CI. Steps 7-12 follow 12go's existing promotion model. A developer who knows PHP and Docker can execute every step.

Total deployment time: ~15 minutes from push to staging. ~60 minutes from staging to prod (including canary soak time).

---

## Observability Design

### Datadog APM Integration

**Library**: `datadog/dd-trace-php` (PHP extension, installed at container build time)

**Automatic instrumentation** (zero code changes):
- Symfony HTTP kernel: every inbound request creates a trace span with route, status code, and duration
- Guzzle HTTP client: every outbound call to 12go's API creates a child span with URL, method, status code, and duration
- Redis (if used for caching): every cache operation creates a span
- cURL: automatic if Guzzle is not used

**Manual instrumentation needed for**:
- Booking ID enrichment: add `booking_id` as a span tag after parsing the request
- Client ID enrichment: add `client_id` from the URL path parameter
- Business error classification: tag spans with error codes from 12go's API responses

```php
// Middleware to enrich spans
public function onKernelRequest(RequestEvent $event): void
{
    $request = $event->getRequest();
    $span = \DDTrace\root_span();
    if ($span) {
        $clientId = $request->attributes->get('client_id');
        if ($clientId) {
            $span->meta['client_id'] = $clientId;
        }
    }
}
```

**Correlation ID propagation**: Datadog's PHP tracer automatically propagates `x-datadog-trace-id` and `x-datadog-parent-id` headers on outbound HTTP calls. For the client-facing `x-correlation-id` header, read it from the inbound request and set it as a span tag. Also forward it to 12go API calls as a custom header (12go may or may not use it, but it makes cross-system debugging possible).

### Structured Logging

**Format**: JSON via Monolog's `JsonFormatter`, shipped to Datadog via the Datadog Agent's log collection (reading from container stdout).

```json
{
    "timestamp": "2026-04-15T10:23:45.123Z",
    "level": "error",
    "message": "12go API returned 400 on reserve",
    "context": {
        "client_id": "bookaway",
        "booking_id": "12345678",
        "trace_id": "abc123def456",
        "span_id": "789ghi",
        "endpoint": "/reserve/12345678",
        "http_status": 400,
        "error_fields": {"contact[mobile]": "Invalid format"},
        "duration_ms": 342
    },
    "channel": "b2b_api"
}
```

Standard fields that Datadog can parse without custom pipelines:
- `dd.trace_id` and `dd.span_id` (auto-injected by `dd-trace-php` when log correlation is enabled)
- `level` maps to Datadog log severity
- `context.*` fields become facets for filtering

Configure in `config/packages/monolog.yaml`:
```yaml
monolog:
    handlers:
        main:
            type: stream
            path: "php://stdout"
            level: info
            formatter: monolog.formatter.json
```

### Custom Metrics

Use `DataDogStatsD` (already available in 12go's infrastructure) with the `b2b.` prefix:

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `b2b.request.count` | Counter | `client_id`, `endpoint`, `status_code` | Request count per endpoint |
| `b2b.request.duration` | Timer | `client_id`, `endpoint` | End-to-end request duration |
| `b2b.12go_api.count` | Counter | `endpoint`, `status_code` | 12go API call count |
| `b2b.12go_api.duration` | Timer | `endpoint` | 12go API call latency |
| `b2b.12go_api.error_rate` | Counter | `endpoint`, `error_type` | 12go API errors by type |
| `b2b.booking.reserved` | Counter | `client_id` | Successful reservations |
| `b2b.booking.confirmed` | Counter | `client_id` | Successful confirmations |
| `b2b.booking.failed` | Counter | `client_id`, `reason` | Failed booking operations |
| `b2b.search.empty_results` | Counter | `client_id` | Searches returning zero itineraries |
| `b2b.webhook.received` | Counter | `type` | Webhook notifications received |
| `b2b.webhook.forwarded` | Counter | `client_id` | Notifications forwarded to clients |

Implementation via a thin service class:

```php
class B2bMetrics
{
    public function __construct(private DataDogStatsD $statsd) {}

    public function recordApiCall(string $endpoint, int $statusCode, float $durationMs): void
    {
        $this->statsd->increment('b2b.12go_api.count', 1, [
            'endpoint' => $endpoint,
            'status_code' => (string)$statusCode,
        ]);
        $this->statsd->timing('b2b.12go_api.duration', $durationMs, [
            'endpoint' => $endpoint,
        ]);
    }
}
```

### Alerting

**First alert to configure**: 12go API error rate.

```
Alert: b2b.12go_api.error_rate
Condition: sum(b2b.12go_api.count{status_code:5*}) / sum(b2b.12go_api.count) > 0.05
Window: 5 minutes
Severity: P2 (page on-call)
Message: "B2B service seeing >5% error rate from 12go API. Check 12go platform health."
```

Why this first: If 12go's API is returning 500s, every B2B client is affected. This is the highest-leverage single alert.

**Second alert**: Request latency P95.

```
Alert: b2b.request.duration P95 > 5000ms
Window: 5 minutes
Severity: P3 (notify)
Message: "B2B API P95 latency above 5s. Likely 12go API slowdown or recheck delays."
```

**Third alert**: Zero traffic (canary).

```
Alert: b2b.request.count == 0
Window: 10 minutes (during business hours)
Severity: P2 (page on-call)
Message: "B2B service receiving zero requests. Check routing, health checks, container status."
```

---

## Local Development Setup

### docker-compose integration

Add the B2B service as a new service in 12go's existing `docker-compose.yml`:

```yaml
services:
  b2b-api:
    build:
      context: ./b2b-api
      dockerfile: Dockerfile
    ports:
      - "8081:9000"
    volumes:
      - ./b2b-api/src:/app/src
    environment:
      - APP_ENV=dev
      - TWELVEGO_API_BASE_URL=http://frontend3:80
      - TWELVEGO_API_KEY=${B2B_DEV_API_KEY}
      - DD_TRACE_ENABLED=false
      - DD_DOGSTATSD_DISABLE=true
    depends_on:
      - frontend3
    networks:
      - 12go-network
```

Key points:
- `depends_on: frontend3` -- the B2B service calls F3's API locally, same as it would in production
- `DD_TRACE_ENABLED=false` -- no need for Datadog in local dev
- Volume mount for live code reload during development
- Same Docker network as the rest of 12go's local stack

### Environment variable management

Follow 12go's existing convention: `.env` files per environment.

```
# .env (defaults)
APP_ENV=prod
TWELVEGO_API_BASE_URL=https://api.12go.asia
LOG_LEVEL=info

# .env.local (developer overrides, gitignored)
APP_ENV=dev
TWELVEGO_API_BASE_URL=http://frontend3:80
TWELVEGO_API_KEY=dev-key-here
LOG_LEVEL=debug

# .env.staging (deployed)
TWELVEGO_API_BASE_URL=https://staging-api.12go.asia
TWELVEGO_API_KEY=staging-key

# .env.prod (deployed, managed by DevOps)
TWELVEGO_API_BASE_URL=https://api.12go.asia
TWELVEGO_API_KEY=<from-secrets-management>
```

This is identical to how F3 manages its configuration. No new conventions to learn.

### Running alongside F3

A developer working on B2B features:

1. `docker-compose up frontend3 b2b-api` -- starts both services
2. F3 runs on port 80 (internal) / 8080 (host-mapped)
3. B2B API runs on port 9000 (internal) / 8081 (host-mapped)
4. B2B API calls F3 at `http://frontend3:80` within the Docker network
5. Developer tests B2B endpoints at `http://localhost:8081/v1/{client_id}/itineraries`

If the developer also needs to modify F3 (e.g., adding cancellation policy endpoints), they modify F3 code in the existing F3 workspace. The B2B service picks up F3 changes immediately because it calls F3 over HTTP, not through shared code.

---

## Configuration Management

### Per-client 12go API key mapping

Store the `client_id -> 12go_api_key` mapping in the `.env` file or a simple config file:

```yaml
# config/clients.yaml
clients:
    bookaway:
        api_key: '%env(CLIENT_BOOKAWAY_API_KEY)%'
        webhook_url: 'https://bookaway.com/webhooks/booking'
    comport:
        api_key: '%env(CLIENT_COMPORT_API_KEY)%'
        webhook_url: 'https://comport.example.com/notify'
```

Actual API key values come from environment variables (set in `.env.prod` by DevOps, or from secrets management). The YAML file defines the structure; the `.env` file holds the secrets.

For ~20-30 active clients, this is a flat config file. No database needed. Adding a new client is: add two lines to the YAML, add one env var, deploy. This aligns with the "new clients should be able to onboard in Q2" requirement.

### Feature flags

For per-client feature flags (e.g., booking ID format, short IDs vs. encrypted), use Symfony's config with environment variable overrides:

```yaml
# config/packages/feature_flags.yaml
feature_flags:
    use_short_booking_ids:
        default: true
        overrides:
            legacy_client_1: false
            legacy_client_2: false
```

No LaunchDarkly. No external feature flag service. A flat config file that DevOps can read and modify. This is a 13-endpoint HTTP proxy, not a feature-flagging platform.

---

## Migration Strategy

### Client Transition Approach

**Transparent switch via API Gateway routing.**

From an infrastructure perspective, the operationally simplest approach:

1. Deploy the B2B Symfony service alongside the existing .NET services
2. Configure AWS API Gateway to route specific client IDs to the new service (if API Gateway supports Lambda authorizer-based routing) or deploy a thin routing layer (nginx/Caddy) that inspects the `client_id` path parameter and forwards to either old or new backend
3. Migrate clients one at a time by updating the routing config
4. Decommission old services when all clients are migrated

If AWS API Gateway does not support per-client routing natively (this is flagged as an open question needing DevOps investigation), the fallback is a simple nginx reverse proxy that reads the `client_id` from the URL path and routes accordingly. This is a ~20-line nginx config.

Clients change nothing. Same URL, same headers, same API key. The backend changes behind them.

### Authentication Bridge

The `client_id` + `x-api-key` combination from inbound requests maps to a 12go API key via the `config/clients.yaml` file described above. The flow:

1. Client sends `GET /v1/bookaway/itineraries` with `x-api-key: abc123`
2. API Gateway validates the `x-api-key` (this already works today)
3. B2B service extracts `bookaway` from the URL
4. B2B service looks up `bookaway` in `clients.yaml` -> gets `CLIENT_BOOKAWAY_API_KEY` env var
5. B2B service calls 12go API with `?k=<12go_api_key>`

**Secrets management**: API keys are stored as environment variables, injected via `.env.prod` managed by DevOps. This matches F3's existing pattern. For a more secure approach, 12go could adopt HashiCorp Vault or AWS Secrets Manager, but that is a platform-wide decision, not a B2B-specific one. Starting with `.env` files and upgrading later is the operationally simplest path.

### Per-Client Rollout Mechanism

A routing configuration file (nginx or API Gateway config) that maps `client_id` to backend:

```nginx
# /etc/nginx/conf.d/b2b-routing.conf
map $client_id $backend {
    default         old_dotnet_backend;
    bookaway        new_php_backend;
    comport         new_php_backend;
    # Add clients here as they are migrated
}
```

This is a config change, not a code change. DevOps can add a client to the new backend by editing one line and reloading nginx. No application deployment needed. Rollback is equally simple: move the client back to `old_dotnet_backend`.

The per-client rollout order should be:
1. Internal test client (TC automation) -- validate basic flow
2. Lowest-traffic external client -- limit blast radius
3. Remaining clients in ascending traffic order
4. Highest-traffic client last

### In-Flight Booking Safety

During cutover, the critical concern is active booking funnels. A client that started a search on the old system and tries to confirm a booking on the new system will fail if the booking ID format is incompatible.

**Mitigation**: Route cutover at the client level, not the request level. Once a client is moved to the new backend, all their requests go to the new backend. There is no split-brain for a single client.

For pre-cutover bookings (bookings created on the old system before migration):
- **KLV-format IDs**: The 12go `bid` is embedded and extractable. The new service can decode KLV, extract the `bid`, and call 12go's API directly.
- **Short IDs**: Not decodable. Require the one-time static mapping table (old booking ID -> 12go `bid`). This table is loaded into the B2B service's config or a simple database table at migration time.

The mapping table has ~hundreds to low thousands of entries (active bookings at any point in time). It can be a flat JSON/YAML file loaded at startup. No database needed.

### Webhook/Notification Transition

**Infrastructure-level routing**:

1. Configure 12go's webhook subscriber table to point to the B2B service's webhook endpoint: `https://b2b.travelier.com/v1/notifications/12go?client_id={client_id}`
2. The B2B service receives the webhook, transforms the payload from 12go format to TC client format, and forwards to the client's webhook URL (looked up from `clients.yaml`)
3. During transition, for clients still on the old system, 12go's webhook subscriber table continues pointing to the old endpoint

The `client_id` embedded as a query parameter in the webhook URL eliminates the need for a booking-to-client database lookup. 12go already knows booking -> client, and the URL encodes the client identity.

**For old bookings**: The webhook payload includes the 12go `bid`. Look up the static mapping table to find the old TC booking ID and include both IDs in the notification. This handles the transition period where clients still reference old booking IDs.

### Validation Plan

**Search (shadow traffic)**:

Run the new B2B service in parallel with the old system. For a selected test client, the API Gateway sends the search request to both backends. Compare responses:
- Same number of itineraries
- Same pricing (within tolerance for currency rounding)
- Same station/operator IDs (after mapping)

Infrastructure requirement: An API Gateway or nginx config that duplicates requests to both backends. The old backend's response is served to the client; the new backend's response is logged and compared offline.

**Booking (contract tests)**:

Do not shadow live bookings (they create real reservations). Instead:
- Unit tests covering every 12go API response shape (use the existing .NET test fixtures as reference data)
- Integration tests against staging 12go API with a test client
- Manual end-to-end test of the full booking funnel on PreProd before each client migration

**Canary rollout sequence**:

1. Deploy to PreProd. Route one internal test client. Run full booking funnel manually.
2. Monitor Datadog for 24 hours. Check: error rate, latency, response shape.
3. Route first external client (lowest traffic).
4. Monitor for 48 hours.
5. Route remaining clients in batches of 2-3 per day.

---

## Security Design

### Webhook Authentication (Key Finding #10)

The current webhook receiver has zero authentication. Anyone who can reach the endpoint can trigger a booking status refresh for any `bid`. This is a known vulnerability that must be fixed in the new system.

**Operationally simplest approach that does not require 12go to change their webhook delivery**:

1. **IP allowlisting**: Configure the B2B service (or the reverse proxy in front of it) to accept webhook requests only from 12go's known egress IP range. This is a network-level control that requires no code changes on 12go's side.

```nginx
# In nginx config for the webhook path
location /v1/notifications/ {
    allow 10.0.0.0/8;  # 12go internal network
    deny all;
    proxy_pass http://b2b-api;
}
```

2. **HMAC signature verification (aspirational)**: If 12go can be convinced to add a signature header (e.g., `X-Webhook-Signature: sha256=<hmac>`), verify it against a shared secret. But this requires 12go engineering effort and is not a prerequisite for launch.

3. **Bid validation**: After receiving a webhook, verify the `bid` exists and belongs to a known client before processing. This is a defense-in-depth measure -- even if an attacker reaches the endpoint, they cannot trigger processing for arbitrary booking IDs.

**Network isolation**: The webhook endpoint should be on the same service (same container) but on a distinct URL path (`/v1/notifications/12go`). It should NOT be exposed on the public API Gateway that clients use. The webhook path should only be reachable from 12go's internal network. This is a routing/firewall rule, not an application change.

### Network Exposure

- **Client-facing endpoints** (`/v1/{client_id}/*`): Behind AWS API Gateway. API key validation at the gateway level (existing behavior).
- **Webhook endpoint** (`/v1/notifications/*`): Not behind the public API Gateway. Accessible only from 12go's internal network via IP allowlist.
- **Health check** (`/health`): Accessible from the EC2 host's Docker network for container orchestration. Not exposed externally.

### API Key Storage

- Client API keys (for inbound validation): Managed by the existing AWS API Gateway infrastructure. No change needed.
- 12go API keys (for outbound calls): Stored as environment variables in `.env.prod`. In the short term, this is consistent with F3's approach. In the medium term, migrate to a proper secrets manager (Vault, AWS Secrets Manager) -- but this should be a platform-wide initiative, not B2B-specific.

---

## On-Call Runbook (brief: what does the engineer do when this breaks?)

### Service is returning 500s

1. **Datadog APM**: Open the B2B service dashboard. Look at the error rate graph. Click into a failing trace. Read the error message and stack trace.
2. **Check 12go API health**: Is the 12go backend returning errors? Filter APM traces by `b2b.12go_api` span. If 12go is returning 500s, the problem is upstream. Escalate to 12go on-call.
3. **Container logs**: `docker logs b2b-api | tail -100`. Look for PHP fatal errors, memory exhaustion, or configuration issues.
4. **PHP-FPM status**: `docker exec b2b-api php-fpm-healthcheck`. If FPM is unresponsive, restart: `docker restart b2b-api`.

### Service is returning 0 traffic

1. Check the API Gateway / routing layer. Is traffic reaching the B2B container?
2. `docker ps | grep b2b-api` -- is the container running?
3. `curl http://localhost:8081/health` -- does the health check respond?
4. Check Datadog's container health dashboard for CPU/memory spikes.

### Client reports wrong data in response

1. Get the `x-correlation-id` from the client.
2. Search Datadog APM traces by `correlation_id` tag.
3. Inspect the trace: what did 12go return? What did the B2B service transform it to?
4. If 12go returned wrong data: escalate to 12go.
5. If the B2B service transformed it incorrectly: this is a code bug. Fix in the mapping layer.

### Webhook notifications not reaching clients

1. Check `b2b.webhook.received` metric. Are webhooks arriving from 12go?
2. Check `b2b.webhook.forwarded` metric. Are they being forwarded?
3. If received but not forwarded: check the client's webhook URL in `clients.yaml`. Is it correct? Is the client's endpoint responding?
4. If not received: check 12go's webhook subscriber configuration. Is the URL pointing to the B2B service?

---

## Unconventional Idea (optional)

### Considered: Running the B2B service as a Symfony Bundle inside F3

Instead of a separate container, package the B2B code as a Symfony Bundle and install it into F3 via Composer. This would make it literally the same process as F3, with zero deployment overhead.

**Rejected** because:
- F3 is a large monolith that is "at the beginning of the beginning" of being refactored. Adding more code to it makes refactoring harder, not easier.
- F3 local development is already painful (documented in the search POC). Adding B2B development to the same codebase compounds the pain.
- The sole developer (Soso) would need to navigate F3's full codebase for every B2B change. A separate service has a much smaller cognitive footprint.
- Independent deployment and scaling are meaningful operational benefits that outweigh the marginal cost of an additional container.

The Bundle approach would be the right choice if the team had 5 PHP developers and F3 was well-understood. With a solo .NET developer using AI assistance, a clean standalone Symfony project with a small, focused codebase is operationally superior.

### Considered: Thin Go sidecar for the webhook endpoint

The webhook notification handler is a simple endpoint: receive JSON, transform, forward. Go excels at this. A tiny Go binary (~5MB) could handle webhooks while the main PHP service handles everything else.

**Rejected** because: two runtimes means two sets of everything -- two Docker images, two log formats, two debugging approaches, two on-call procedures. The operational cost of a second runtime exceeds the benefit of Go's suitability for this narrow use case. PHP handles webhooks just fine.

---

## What This Design Optimizes For (and what it sacrifices)

### Optimizes for

- **Operational continuity**: DevOps changes nothing about how they operate services. Same runtime, same tools, same deployment, same debugging.
- **On-call simplicity**: Any engineer who can debug F3 can debug this service.
- **Datadog integration**: Full APM coverage from day one with zero instrumentation code.
- **Deployment velocity**: Clone an existing service config, change the app code, deploy. No new infrastructure.
- **Solo developer productivity**: Soso will write PHP with AI assistance (Claude Code). Symfony is well-documented, widely supported by AI tools, and has excellent auto-completion. The codebase is small (13 endpoints, ~2500 lines of business logic) and focused.
- **Future absorption**: When F3 is refactored, this service is a Symfony app that can be absorbed into the next iteration of F3 with minimal friction -- same language, same framework, same patterns.

### Sacrifices

- **Developer preference**: Soso's 12 years of .NET experience are not directly leveraged. The PHP learning curve is real, though mitigated by AI assistance and the simplicity of the business logic (HTTP proxy with transformations).
- **Type safety**: PHP's type system is weaker than .NET's or Go's. Complex transformations (booking schema parsing with 20+ dynamic field patterns) benefit from strong typing. Mitigation: PHPStan at maximum level, comprehensive unit tests ported from existing .NET test fixtures.
- **Performance ceiling**: PHP-FPM's process-per-request model is less efficient than Go's goroutine model. For this workload (~100-1000 requests/minute based on B2B traffic patterns), this does not matter. The bottleneck is 12go's API latency, not PHP's throughput.
- **Team expertise**: The sole developer must learn PHP/Symfony. This is a real cost. However, the business logic is straightforward (HTTP calls + JSON transformations), AI tools excel at PHP, and 12go veterans are available for consultation. The alternative -- deploying a runtime nobody on the operations team understands -- trades developer comfort for operational risk.
