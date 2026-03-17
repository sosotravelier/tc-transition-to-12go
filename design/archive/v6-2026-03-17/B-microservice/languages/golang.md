---
status: draft
last_updated: 2026-02-23
---

# Go Language Exploration

## Why Go (and Why Not)

### Strategic Alignment
Go aligns with 12go's potential future direction. If 12go adopts Go, this choice provides strategic alignment and shared expertise.

### Strengths
- **Performance**: Low latency, efficient concurrency, small binary footprint (~20MB static binaries)
- **Simplicity**: Minimal language surface, clear error handling, no hidden magic
- **Deployment**: Single static binary, scratch/distroless Docker images (~20MB), cross-compilation to linux/amd64
- **Concurrency**: Native goroutines/channels fit async notification delivery and worker pools
- **Standard library**: Strong `net/http`, JSON, context, and testing support
- **Production readiness**: Widely used in microservices; mature ecosystem

### Challenges
- **Team learning curve**: Team is .NET-focused; Go requires new mental models
- **Error handling**: Explicit error returns vs exceptions; requires discipline
- **No generics (until Go 1.18)**: Less familiar to .NET developers (though generics are now available)
- **Composition over inheritance**: Different OOP approach
- **Goroutines vs async/await**: Different concurrency model
- **AI-assisted development**: Cursor/Claude work well with Go, but team needs to learn Go idioms

### Honest Assessment
The biggest risk is the learning curve for a .NET team. With AI assistance (Cursor with Claude Sonnet 4), the team can be productive in 2-4 weeks, but full proficiency takes 2-3 months. The performance and deployment benefits are real, and strategic alignment with 12go's potential direction adds value.

## Framework Choice

### Comparison

| Framework | Performance | Popularity | Learning Curve | Recommendation |
|-----------|------------|------------|----------------|----------------|
| **Chi** | Moderate (860 ns/op) | Moderate | Low | ✅ **Recommended** |
| **Gin** | Fast (76.7 ns/op) | Very High (87.5K stars) | Low | Alternative |
| **Echo** | Fast (99.1 ns/op) | High | Moderate | Alternative |
| **Fiber** | Fastest | Moderate | Moderate | Not recommended |
| **stdlib only** | Fastest | N/A | High | Not recommended |

### Recommendation: Chi Router

**Rationale:**
1. **Minimalist**: Thin wrapper over `net/http`; idiomatic Go
2. **Low overhead**: Sufficient performance for proxy services
3. **Middleware-friendly**: Clean middleware pattern for auth, logging, tracing
4. **Standard library alignment**: Uses `net/http` types; easy to understand
5. **Maintainability**: Small API surface, less framework magic

**Why not Gin:**
- Larger binary size
- More opinionated
- Overkill for a stateless proxy

**Why not Echo:**
- More features than needed
- Slightly steeper learning curve

**Why not Fiber:**
- Non-standard API (Express-inspired)
- Higher maintenance risk
- Performance difference is negligible for proxy workloads

**Why not stdlib only:**
- Chi provides routing and middleware without significant overhead
- Reduces boilerplate while staying close to stdlib

### Implementation Pattern

```go
import (
    "net/http"
    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
)

func setupRouter() *chi.Mux {
    r := chi.NewRouter()
    
    // Middleware stack
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(correlationIDMiddleware)
    r.Use(versionHeaderMiddleware)
    
    // Routes
    r.Route("/v1/{client_id}", func(r chi.Router) {
        r.Get("/itineraries", searchHandler)
        r.Get("/stations", stationsHandler)
        // ...
    })
    
    return r
}
```

## Architecture Pattern

### Flat Package Structure (Recommended)

Go favors simplicity. For focused microservices, a flat structure is preferable to hexagonal architecture.

```
booking-service/
├── cmd/
│   └── api/
│       └── main.go              # Entry point
├── internal/
│   ├── handler/                 # HTTP handlers
│   │   ├── search.go
│   │   ├── booking.go
│   │   └── notifications.go
│   ├── service/                 # Business logic
│   │   ├── search_service.go
│   │   ├── booking_service.go
│   │   └── notification_service.go
│   ├── client/                  # 12go HTTP client
│   │   ├── twelvego_client.go
│   │   ├── retry.go
│   │   └── circuit_breaker.go
│   ├── mapper/                  # Response transformation
│   │   ├── search_mapper.go
│   │   ├── booking_mapper.go
│   │   └── schema_mapper.go
│   ├── config/                  # Configuration
│   │   ├── auth.go              # Auth mapping
│   │   └── station.go           # Station ID mapping
│   ├── state/                   # Transient state
│   │   ├── seat_lock.go         # In-process seat lock
│   │   └── incomplete_results.go
│   └── middleware/
│       ├── auth.go
│       ├── logging.go
│       └── tracing.go
├── pkg/                         # Shared utilities (if any)
│   └── errors/
├── api/                         # OpenAPI specs
├── go.mod
└── Dockerfile
```

### Key Principles

1. **Thin handlers**: Decode request → call service → encode response
2. **Service layer**: Business logic, orchestration, error handling
3. **Client layer**: 12go HTTP calls, retry, circuit breaker
4. **Mapper layer**: 12go response → client contract transformation
5. **No DDD/CQRS**: Keep it simple for a proxy service

### Dependency Flow

```
Handler → Service → Client → 12go API
         ↓
       Mapper → Client Response
```

Handlers depend on services. Services depend on clients and mappers. No circular dependencies.

## Project Structure (Directory Layout with Explanations)

### `cmd/api/main.go`

Minimal entry point:
- Parse environment variables
- Initialize config (auth mapping, station mapping)
- Construct dependencies (client, services, handlers)
- Start HTTP server with graceful shutdown

### `internal/handler/`

HTTP handlers:
- Extract path parameters (`client_id`, `booking_id`)
- Parse query strings
- Call service methods
- Encode responses
- Handle errors → appropriate HTTP status

**Example:**
```go
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
    clientID := chi.URLParam(r, "client_id")
    // ... extract query params
    
    result, err := h.searchService.Search(ctx, clientID, params)
    if err != nil {
        h.handleError(w, err)
        return
    }
    
    h.encodeResponse(w, result)
}
```

### `internal/service/`

Business logic orchestration:
- Coordinate multiple 12go calls (e.g., GetItinerary = 3 calls)
- Handle transient state (seat lock, incomplete results)
- Apply contract transformations (versioning, money format)
- Error handling and retry decisions

### `internal/client/`

12go HTTP client:
- Request construction with API key injection
- Retry logic (exponential backoff with jitter)
- Circuit breaker
- Timeout configuration per endpoint
- Error mapping (12go errors → domain errors)

### `internal/mapper/`

Response transformation:
- 12go models → client contract models
- Station ID reverse mapping (12go → Fuji)
- Money format conversion (decimal → string)
- Travelier-Version header handling
- Booking schema parsing (dynamic field extraction)

### `internal/config/`

Configuration loading:
- Auth mapping (`client_id` → `12go_api_key`)
- Station mapping (Fuji → 12go IDs)
- Environment variable parsing
- In-memory caching with periodic refresh

### `internal/state/`

Transient in-process state:
- Seat lock store (map[string]SeatLock with TTL)
- Incomplete results store (polling IDs)
- Thread-safe with `sync.Map` or `sync.RWMutex`

## HTTP Client Design (for 12go API)

### Structure

```go
type TwelveGoClient struct {
    httpClient    *http.Client
    baseURL       string
    authResolver  AuthResolver
    retryConfig   RetryConfig
    circuitBreaker *gobreaker.CircuitBreaker
    logger        *slog.Logger
}

func (c *TwelveGoClient) Search(ctx context.Context, req SearchRequest) (*SearchResponse, error) {
    // Resolve API key
    apiKey, err := c.authResolver.Resolve(ctx, req.ClientID)
    if err != nil {
        return nil, fmt.Errorf("auth resolution failed: %w", err)
    }
    
    // Build URL with ?k=apiKey
    url := fmt.Sprintf("%s/search/%sp/%sp/%s?seats=%d&direct=true&k=%s",
        c.baseURL, req.FromProvinceID, req.ToProvinceID, req.Date, req.Seats, apiKey)
    
    // Make request with retry
    return c.doRequestWithRetry(ctx, http.MethodGet, url, nil, &SearchResponse{})
}
```

### Connection Pooling

```go
transport := &http.Transport{
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 10,
    IdleConnTimeout:     90 * time.Second,
    DisableKeepAlives:   false,
}

httpClient := &http.Client{
    Transport: transport,
    Timeout:   30 * time.Second, // Overall timeout
}
```

### Retry Strategy

Use `hashicorp/go-retryablehttp` or custom implementation:

```go
func (c *TwelveGoClient) doRequestWithRetry(ctx context.Context, method, url string, body io.Reader, result interface{}) error {
    for attempt := 0; attempt < 3; attempt++ {
        if attempt > 0 {
            backoff := time.Duration(1<<uint(attempt)) * time.Second
            jitter := time.Duration(rand.Intn(200)) * time.Millisecond
            time.Sleep(backoff + jitter)
        }
        
        err := c.doRequest(ctx, method, url, body, result)
        if err == nil {
            return nil
        }
        
        if !isRetryable(err) {
            return err
        }
    }
    return fmt.Errorf("max retries exceeded")
}
```

**Retry rules:**
- GET requests: Retry on 5xx, timeouts, network errors
- POST /reserve, /confirm, /refund: **No retry** (non-idempotent)
- POST /cart: Retry (idempotent in practice)

### Circuit Breaker

Use `sony/gobreaker`:

```go
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "twelvego-api",
    MaxRequests: 5,
    Interval:    60 * time.Second,
    Timeout:     30 * time.Second,
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        return counts.ConsecutiveFailures >= 5
    },
})

result, err := cb.Execute(func() (interface{}, error) {
    return c.doRequest(ctx, method, url, body, result)
})
```

### Timeout Configuration

Per-endpoint timeouts:

```go
var endpointTimeouts = map[string]time.Duration{
    "search":           10 * time.Second,
    "trip_details":      8 * time.Second,
    "add_to_cart":      8 * time.Second,
    "checkout":         8 * time.Second,
    "reserve":          15 * time.Second,
    "confirm":          15 * time.Second,
    "booking_details":  8 * time.Second,
    "refund_options":   8 * time.Second,
    "refund":           15 * time.Second,
}
```

### Error Mapping

```go
func mapTwelveGoError(statusCode int, body []byte) error {
    switch statusCode {
    case 400:
        var errResp ErrorResponse
        json.Unmarshal(body, &errResp)
        if strings.Contains(errResp.Message, "Trip is no longer available") {
            return ErrProductNotFound
        }
        return ErrValidationError{Fields: errResp.Fields}
    case 401:
        return ErrAuthenticationFailed
    case 404:
        return ErrProductNotFound
    case 500, 502, 503, 504:
        return ErrTwelveGoServerError{StatusCode: statusCode}
    default:
        return ErrUnknownError{StatusCode: statusCode}
    }
}
```

## Data Strategy

### Stateless Proxy (Recommended)

**No local storage** for booking/search data:
- All data fetched from 12go on-demand
- 12go MariaDB is the source of truth
- Eliminates cache invalidation, sync issues, and storage overhead

### Transient State: Seat Lock

In-process only (no Redis needed initially):

```go
type SeatLockStore struct {
    mu    sync.RWMutex
    locks map[string]*SeatLockEntry
}

type SeatLockEntry struct {
    BookingToken string
    Seats        []string
    ExpiresAt    time.Time
}

func (s *SeatLockStore) Lock(token string, seats []string, ttl time.Duration) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    s.locks[token] = &SeatLockEntry{
        BookingToken: token,
        Seats:        seats,
        ExpiresAt:    time.Now().Add(ttl),
    }
    return nil
}

func (s *SeatLockStore) Get(token string) ([]string, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    entry, exists := s.locks[token]
    if !exists || time.Now().After(entry.ExpiresAt) {
        return nil, ErrSeatLockNotFound
    }
    return entry.Seats, nil
}
```

**Cleanup**: Background goroutine removes expired entries every minute.

### Incomplete Results

Same pattern as seat lock — in-process map with TTL (15 minutes).

### When 12go Ships Native Seat Lock

Replace in-process store with 12go API call. Client contract unchanged.

### Redis (Optional Future Enhancement)

If horizontal scaling is required before 12go native seat lock:
- Use `go-redis/redis` for shared seat lock state
- Only needed if sticky sessions are not acceptable
- Adds infrastructure dependency

## Cross-Cutting Concerns

### Logging (slog vs zerolog vs zap)

**Recommendation: `slog` (standard library)**

**Rationale:**
- **Built-in**: No external dependency (Go 1.21+)
- **Structured**: Native support for key-value pairs
- **Performance**: Sufficient for proxy service workloads
- **Simplicity**: Standard library reduces maintenance burden

**Alternative: `zerolog`**
- Faster than slog (~2x in benchmarks)
- More features (contextual logging, sampling)
- External dependency

**Not recommended: `zap`**
- Fastest but more complex API
- Overkill for this use case

**Implementation:**
```go
import "log/slog"

logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
    AddSource: true,
}))

logger.Info("request completed",
    "client_id", clientID,
    "correlation_id", correlationID,
    "endpoint", "search",
    "duration_ms", duration.Milliseconds(),
    "status_code", statusCode,
)
```

### Tracing and Metrics (OpenTelemetry + Datadog)

**Setup: OpenTelemetry Go SDK → Datadog**

**Approach:**
1. Use OpenTelemetry Go SDK for instrumentation
2. Export via OTLP to Datadog Agent or DDOT Collector
3. Datadog Agent forwards to Datadog backend

**Implementation:**
```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/propagation"
)

func setupTracing() (*trace.TracerProvider, error) {
    exporter, err := otlptracehttp.New(context.Background(),
        otlptracehttp.WithEndpoint("localhost:4318"), // Datadog Agent
        otlptracehttp.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceNameKey.String("booking-service"),
        )),
    )
    
    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))
    
    return tp, nil
}
```

**Metrics:**
```go
import (
    "go.opentelemetry.io/otel/metric"
    "go.opentelemetry.io/otel/attribute"
)

meter := otel.Meter("booking-service")
requestDuration, _ := meter.Float64Histogram(
    "proxy.request.duration",
    metric.WithUnit("ms"),
)

requestDuration.Record(ctx, float64(duration.Milliseconds()),
    metric.WithAttributes(
        attribute.String("service", "booking-service"),
        attribute.String("endpoint", "search"),
        attribute.Int("status_code", statusCode),
        attribute.String("client_id", clientID),
    ),
)
```

**Datadog APM:**
- Use `dd-trace-go` for automatic instrumentation (optional)
- Or rely on OpenTelemetry → Datadog mapping (recommended for consistency)

### Error Handling Pattern

**Go error wrapping:**
```go
import "errors"

var (
    ErrProductNotFound = errors.New("product not found")
    ErrValidationError = errors.New("validation failed")
    ErrAuthenticationFailed = errors.New("authentication failed")
)

func (c *TwelveGoClient) Search(ctx context.Context, req SearchRequest) (*SearchResponse, error) {
    apiKey, err := c.authResolver.Resolve(ctx, req.ClientID)
    if err != nil {
        return nil, fmt.Errorf("failed to resolve API key for client %s: %w", req.ClientID, err)
    }
    
    resp, err := c.doRequest(ctx, ...)
    if err != nil {
        return nil, fmt.Errorf("12go search failed: %w", err)
    }
    
    return resp, nil
}
```

**Handler error mapping:**
```go
func (h *SearchHandler) handleError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, ErrProductNotFound):
        http.Error(w, "Product not found", http.StatusNotFound)
    case errors.Is(err, ErrValidationError):
        http.Error(w, "Validation failed", http.StatusUnprocessableEntity)
    case errors.Is(err, ErrAuthenticationFailed):
        http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
    default:
        h.logger.Error("unhandled error", "error", err)
        http.Error(w, "Internal server error", http.StatusInternalServerError)
    }
}
```

### Middleware Stack

**Chi middleware:**
```go
r.Use(middleware.RequestID)           // Generate request ID if missing
r.Use(middleware.RealIP)              // Extract real IP from headers
r.Use(middleware.Logger)              // Request logging
r.Use(middleware.Recoverer)           // Panic recovery
r.Use(correlationIDMiddleware)        // Extract/propagate x-correlation-id
r.Use(versionHeaderMiddleware)        // Extract Travelier-Version header
r.Use(authMiddleware)                 // Resolve client_id → 12go API key
r.Use(tracingMiddleware)              // OpenTelemetry spans
r.Use(metricsMiddleware)              // Request duration metrics
```

**Custom middleware examples:**
```go
func correlationIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        correlationID := r.Header.Get("x-correlation-id")
        if correlationID == "" {
            correlationID = uuid.New().String()
        }
        
        ctx := context.WithValue(r.Context(), "correlation_id", correlationID)
        w.Header().Set("x-correlation-id", correlationID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

## Notification Transformer

### Architecture

Component within Booking Service (not separate deployment):
- Webhook receiver handler
- Worker pool for async delivery
- Retry queue with exponential backoff

### Webhook Receiver

```go
func (h *NotificationHandler) ReceiveWebhook(w http.ResponseWriter, r *http.Request) {
    var payload struct {
        Bid int64 `json:"bid"`
    }
    
    if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
        http.Error(w, "Invalid payload", http.StatusBadRequest)
        return
    }
    
    // Validate source IP (or HMAC if 12go supports it)
    if !h.isValidSource(r.RemoteAddr) {
        h.logger.Warn("webhook from invalid source", "ip", r.RemoteAddr)
        http.Error(w, "Forbidden", http.StatusForbidden)
        return
    }
    
    // Always return 200 immediately (decouple from delivery)
    w.WriteHeader(http.StatusOK)
    
    // Process asynchronously
    go h.processNotification(context.Background(), payload.Bid)
}
```

### Worker Pool Pattern

```go
type NotificationWorkerPool struct {
    workers    int
    jobQueue   chan NotificationJob
    retryQueue chan RetryJob
}

func (p *NotificationWorkerPool) Start(ctx context.Context) {
    for i := 0; i < p.workers; i++ {
        go p.worker(ctx)
    }
    go p.retryWorker(ctx)
}

func (p *NotificationWorkerPool) worker(ctx context.Context) {
    for {
        select {
        case job := <-p.jobQueue:
            p.processJob(ctx, job)
        case <-ctx.Done():
            return
        }
    }
}

func (p *NotificationWorkerPool) processJob(ctx context.Context, job NotificationJob) {
    // 1. Fetch booking details from 12go
    booking, err := p.twelveGoClient.GetBookingDetails(ctx, job.Bid)
    if err != nil {
        p.enqueueRetry(job, err)
        return
    }
    
    // 2. Resolve client_id from booking reference
    clientID := p.resolveClientID(booking)
    
    // 3. Transform to client notification format
    notification := p.mapper.Transform(booking)
    
    // 4. Deliver to client webhook
    if err := p.deliver(ctx, clientID, notification); err != nil {
        p.enqueueRetry(job, err)
        return
    }
    
    p.logger.Info("notification delivered", "bid", job.Bid, "client_id", clientID)
}
```

### Retry with Exponential Backoff

```go
type RetryJob struct {
    Job       NotificationJob
    Attempts  int
    NextRetry time.Time
}

func (p *NotificationWorkerPool) enqueueRetry(job NotificationJob, err error) {
    retryJob := RetryJob{
        Job:      job,
        Attempts: 1,
        NextRetry: time.Now().Add(30 * time.Second),
    }
    p.retryQueue <- retryJob
}

func (p *NotificationWorkerPool) retryWorker(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ticker.C:
            p.processRetries(ctx)
        case <-ctx.Done():
            return
        }
    }
}

func (p *NotificationWorkerPool) processRetries(ctx context.Context) {
    // Process retry queue with exponential backoff:
    // Attempt 1: 30 seconds
    // Attempt 2: 5 minutes
    // Attempt 3: 30 minutes
    // After 3 attempts: log and alert
}
```

## Testing Strategy

### Standard Testing Package + Testify

**Unit tests:**
```go
import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestSearchService_Search(t *testing.T) {
    tests := []struct {
        name    string
        request SearchRequest
        wantErr bool
    }{
        {
            name: "valid search",
            request: SearchRequest{
                ClientID: "client-a",
                FromProvinceID: "1",
                ToProvinceID: "2",
                Date: "2026-02-23",
                Seats: 2,
            },
            wantErr: false,
        },
        // ... more test cases
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // Setup: mock 12go client
            mockClient := &MockTwelveGoClient{}
            service := NewSearchService(mockClient, ...)
            
            // Execute
            result, err := service.Search(context.Background(), tt.request)
            
            // Assert
            if tt.wantErr {
                assert.Error(t, err)
            } else {
                require.NoError(t, err)
                assert.NotNil(t, result)
            }
        })
    }
}
```

### Table-Driven Tests (Go Idiom)

Go convention: use table-driven tests for multiple scenarios.

### HTTP Handler Testing

```go
import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestSearchHandler_Search(t *testing.T) {
    handler := NewSearchHandler(mockService, logger)
    req := httptest.NewRequest("GET", "/v1/client-a/itineraries?departures=1&arrivals=2&date=2026-02-23", nil)
    w := httptest.NewRecorder()
    
    handler.Search(w, req)
    
    assert.Equal(t, http.StatusOK, w.Code)
    var response SearchResponse
    json.Unmarshal(w.Body.Bytes(), &response)
    assert.NotEmpty(t, response.Itineraries)
}
```

### Mocking

**Options:**
1. **Manual mocks**: Implement interfaces manually (recommended for small interfaces)
2. **testify/mock**: Generate mocks from interfaces
3. **mockgen**: Generate mocks from interfaces (more boilerplate)

**Recommendation:** Manual mocks for simple interfaces, `testify/mock` for complex ones.

### Integration Tests

Use `testcontainers-go` for local 12go API simulation (if needed):

```go
import (
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/wait"
)

func TestIntegration_Search(t *testing.T) {
    ctx := context.Background()
    
    // Start mock 12go API container
    req := testcontainers.ContainerRequest{
        Image: "mock-twelvego-api:latest",
        ExposedPorts: []string{"8080/tcp"},
        WaitingFor: wait.ForHTTP("/health").WithPort("8080"),
    }
    
    container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: req,
        Started: true,
    })
    require.NoError(t, err)
    defer container.Terminate(ctx)
    
    // Run integration test
    // ...
}
```

## Deployment

### Docker Image (scratch/distroless)

**Multi-stage build:**
```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o booking-service ./cmd/api

# Runtime stage
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /build/booking-service /booking-service
EXPOSE 8080
ENTRYPOINT ["/booking-service"]
```

**Image size:** ~20MB (vs ~100MB+ for alpine-based images)

**Benefits:**
- Minimal attack surface (no shell, no package manager)
- Fast container startup
- Smaller image pulls

### Health Check Endpoints

```go
func (h *HealthHandler) Liveness(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func (h *HealthHandler) Readiness(w http.ResponseWriter, r *http.Request) {
    // Check: auth mapping loaded?
    if !h.authConfig.IsLoaded() {
        http.Error(w, "Not ready", http.StatusServiceUnavailable)
        return
    }
    
    // Check: 12go reachable?
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()
    
    if err := h.twelveGoClient.HealthCheck(ctx); err != nil {
        http.Error(w, "Not ready", http.StatusServiceUnavailable)
        return
    }
    
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
```

### Configuration via Environment Variables

**No config files** — use environment variables:

```go
type Config struct {
    Port            string
    TwelveGoBaseURL string
    AuthConfigPath  string  // Path to auth mapping YAML (mounted as config map)
    StationMapPath  string  // Path to station mapping JSON
    DatadogAgentURL string
    LogLevel        string
}

func LoadConfig() (*Config, error) {
    return &Config{
        Port:            getEnv("PORT", "8080"),
        TwelveGoBaseURL: getEnv("TWELVEGO_BASE_URL", "https://api.12go.asia"),
        AuthConfigPath:  getEnv("AUTH_CONFIG_PATH", "/config/auth.yaml"),
        StationMapPath:  getEnv("STATION_MAP_PATH", "/config/stations.json"),
        DatadogAgentURL: getEnv("DD_AGENT_URL", "http://localhost:4318"),
        LogLevel:        getEnv("LOG_LEVEL", "info"),
    }, nil
}
```

### CI/CD

**GitHub Actions example:**
```yaml
name: Build and Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.22'
      - run: go test ./...
      - run: go build ./cmd/api
```

**Docker build:**
```yaml
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: docker build -t booking-service:latest .
```

## Team Ramp-Up Plan

### Learning Path for .NET Developers

**Week 1: Fundamentals**
- Go syntax basics (variables, functions, structs, interfaces)
- Error handling (explicit returns vs exceptions)
- Pointers and value semantics
- Go modules and dependency management

**Week 2: Concurrency**
- Goroutines and channels
- `sync` package (mutex, waitgroup)
- Context package for cancellation
- Common concurrency patterns

**Week 3: HTTP and Testing**
- `net/http` package
- Chi router and middleware
- JSON marshaling/unmarshaling
- Table-driven tests

**Week 4: Production Patterns**
- Structured logging (slog)
- OpenTelemetry instrumentation
- Graceful shutdown
- Docker multi-stage builds

**Resources:**
- "Effective Go" (official Go documentation)
- "Go by Example" (practical examples)
- "The Go Programming Language" (book)
- Go blog posts on error handling, concurrency, testing

### Key Mental Model Shifts

1. **Explicit Error Handling**
   - No exceptions; errors are values
   - `if err != nil { return err }` pattern
   - Error wrapping with `fmt.Errorf("...: %w", err)`

2. **No Inheritance**
   - Composition over inheritance
   - Interfaces are implicit (duck typing)
   - Embedding for code reuse

3. **Goroutines vs Async/Await**
   - Goroutines are lightweight threads
   - Channels for communication
   - `select` for multiplexing

4. **Value Semantics**
   - Structs are value types (copied by default)
   - Use pointers when mutation is needed
   - Slices and maps are reference types

5. **Package Organization**
   - Flat structure preferred for small services
   - `internal/` for private code
   - `pkg/` only for reusable libraries

### AI-Assisted Go Development

**Cursor with Claude Sonnet 4:**
- **Effectiveness**: Developers report 5-30x faster development with proper workflows
- **Code quality**: High-quality Go code generation
- **Context awareness**: Excellent codebase search for accurate context retrieval

**Best Practices:**
1. Use Agent mode (Cmd+I) for complex refactors
2. Set up AI-specific documentation (`.cursorrules` for Go conventions)
3. Implement edit-test-fix loop (AI runs tests and self-corrects)
4. Provide clear prompts with Go idioms in mind

**Limitations:**
- AI may generate non-idiomatic Go (e.g., overuse of interfaces)
- Requires human review for Go-specific patterns
- Team needs to learn Go idioms to review AI-generated code effectively

### Realistic Timeline

**To Productive Development (2-4 weeks):**
- Can write handlers, services, and tests
- Understands error handling and concurrency basics
- Can debug Go code effectively
- Still needs guidance on advanced patterns

**To Full Proficiency (2-3 months):**
- Writes idiomatic Go code
- Understands performance implications
- Comfortable with advanced concurrency patterns
- Can mentor other developers

**Risk Mitigation:**
- Pair programming with Go-experienced developers (if available)
- Code reviews focused on Go idioms
- AI assistance (Cursor) accelerates learning curve
- Start with simple endpoints (search) before complex ones (booking schema)

**Recommendation:**
- Begin with Search & Master Data service (simpler, stateless)
- Move to Booking service after team gains confidence
- Expect 2-3 months for full team proficiency, but productive work can start in 2-4 weeks with AI assistance
