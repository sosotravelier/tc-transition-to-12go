---
status: draft
last_updated: 2026-02-23
---

# .NET 8 Language Exploration

## Why .NET 8 (and Why Not)

### Why .NET 8

**Immediate Productivity:**
- Team has 12+ years of .NET experience; zero learning curve
- Existing codebase patterns (`OneTwoGoApi`, `ReserveDataRequest`, booking schema parsing) can be ported directly
- No context switching between languages during transition
- AI-assisted development (Cursor, Claude) works excellently with .NET

**Performance & Modern Features:**
- Minimal API offers ~10ms cold start vs ~100ms for MVC controllers, ~2.1M req/s vs ~1.3M
- Native AOT compilation reduces container size from ~450MB to ~90-100MB
- Built-in OpenTelemetry support for Datadog integration
- Source generators (Refit) eliminate runtime reflection overhead

**Ecosystem Maturity:**
- Rich HTTP client ecosystem (Refit, typed HttpClient, Polly)
- Comprehensive logging (Serilog) and metrics (System.Diagnostics.Metrics)
- Strong containerization support (.NET 8 chiseled images for AOT)
- Excellent tooling (IntelliSense, debugging, profiling)

### Why Not .NET 8

**Risk of Recreating Old Patterns:**
- Team familiarity may lead to porting unnecessary abstractions (MediatR pipeline, SI framework patterns)
- Must actively resist the urge to add layers "just in case"
- Requires discipline to keep codebase under 10K lines

**Infrastructure Alignment:**
- 12go's stack is PHP/Symfony; .NET services add language diversity
- DevOps manages PHP infrastructure; .NET containers require separate deployment pipeline
- Monitoring unification (Datadog) works but requires separate service configuration

**Future Considerations:**
- 12go is considering Go migration; .NET services may become orphaned
- If team transitions to PHP/Go, .NET codebase becomes maintenance burden
- However, this is a proxy layer — language choice is less critical than contract preservation

**Recommendation:** Choose .NET 8 for immediate productivity, but enforce strict code size limits (< 10K lines) and resist framework bloat. Treat this as a "bridge" solution that preserves contracts while simplifying architecture.

---

## Framework and API Layer

### Minimal API vs Controllers (Recommendation: Minimal API)

**Recommendation: Use Minimal API with Endpoint Groups**

**Rationale:**
1. **Performance:** ~10ms cold start vs ~100ms for controllers, ~2.1M req/s vs ~1.3M
2. **AOT Compatibility:** Controllers are incompatible with native AOT compilation; Minimal APIs work seamlessly
3. **Explicit Route Configuration:** Easier to debug than convention-based routing
4. **Opt-in Philosophy:** Only add validation/model binding when needed (vs MVC's opt-out filter pipeline)

**Structure Pattern:**
```csharp
// Features/Search/SearchEndpoints.cs
public static class SearchEndpoints
{
    public static RouteGroupBuilder MapSearchEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/{clientId}/itineraries");
        
        group.MapGet("", SearchHandler.Handle)
            .WithName("Search")
            .WithOpenApi()
            .AddEndpointFilter<CorrelationIdFilter>()
            .AddEndpointFilter<VersionHeaderFilter>();
            
        return group;
    }
}

// Program.cs
app.MapSearchEndpoints();
app.MapBookingEndpoints();
```

**When to Use Controllers:**
- Only if team strongly prefers MVC patterns and is willing to sacrifice AOT compatibility
- Not recommended for this project

### HTTP Client Design (Recommendation: Refit)

**Recommendation: Use Refit for 12go API Client**

**Rationale:**
1. **Type Safety:** Compile-time verification of API contracts via source generators
2. **Boilerplate Reduction:** Interface-based definitions eliminate manual HTTP call code
3. **AOT Support:** Refit 9.x supports native AOT and trimming for .NET 10+
4. **Polly Integration:** Built-in retry/circuit breaker support
5. **Existing Code Porting:** `OneTwoGoApi` patterns map cleanly to Refit interfaces

**Refit Interface Pattern:**
```csharp
public interface ITwelveGoApi
{
    [Get("/search/{fromProvinceId}p/{toProvinceId}p/{date}?seats={seats}&direct=true")]
    Task<OneTwoGoSearchResponse> SearchAsync(
        string fromProvinceId,
        string toProvinceId,
        [Path(Format = "yyyy-MM-dd")] DateOnly date,
        uint seats,
        [Query("k")] string apiKey,
        CancellationToken cancellationToken = default);
        
    [Post("/reserve/{bookingId}")]
    Task<OneTwoGoReserveBookingResult> ReserveAsync(
        string bookingId,
        [Body] ReserveDataRequest request,
        [Query("k")] string apiKey,
        CancellationToken cancellationToken = default);
}
```

**API Key Injection:**
- Use Refit's `[Query("k")]` attribute with a custom `IRequestBuilder` interceptor
- Resolve `clientId → 12goApiKey` mapping in the interceptor before request execution
- Cache mapping in memory with 5-minute refresh

**Alternative: Typed HttpClient**
- Use if fine-grained control over serialization/deserialization is required
- More boilerplate but complete control over request/response handling
- Existing `OneTwoGoApi` class can be adapted to typed HttpClient pattern

**Retry & Circuit Breaker:**
- Use Polly with Refit's `AddPolly` extension
- Exponential backoff: 1s, 2s, 4s (max 3 attempts) with ±20% jitter
- Circuit breaker: open after 5 failures in 60s, close after 30s
- Apply only to idempotent requests (GET, POST /cart); never retry POST /reserve, /confirm, /refund

**Error Mapping:**
- Port existing `OneTwoGoApi.CallApi<T>` error handling logic
- Map 12go HTTP status codes to client-facing exceptions:
  - 400 with `ErrorResponse.fields` → 422 Unprocessable Entity
  - 400 with "Trip is no longer available" → 404 Not Found
  - 401 → 503 Service Unavailable (do not expose auth details)
  - 404 → 404 Not Found
  - 500+ → 502 Bad Gateway
  - Timeout → 504 Gateway Timeout

---

## Architecture Pattern (Recommendation: Simple Layered)

**Recommendation: Simple Layered Architecture (Controllers → Services → Clients)**

**Rationale:**
1. **Proxy Layer Nature:** This is a stateless HTTP proxy, not a complex domain. DDD/CQRS adds unnecessary complexity.
2. **Code Size Target:** < 10K lines of application code. Vertical slices or Clean Architecture would add structural overhead.
3. **Team Familiarity:** Team understands layered patterns; no learning curve.
4. **Maintainability:** Simple structure is easier to reason about for a small team.

**Structure:**
```
src/
├── Api/                    # Minimal API endpoints
│   ├── SearchEndpoints.cs
│   ├── BookingEndpoints.cs
│   └── MasterDataEndpoints.cs
├── Services/              # Business logic
│   ├── SearchService.cs
│   ├── BookingService.cs
│   ├── NotificationService.cs
│   └── StationMapper.cs
├── Clients/               # External API clients
│   └── TwelveGoApiClient.cs (Refit interface + implementation)
├── Models/                 # Request/response models
│   ├── Requests/
│   ├── Responses/
│   └── Contracts/
├── Mappers/                # 12go → client contract transformation
│   ├── SearchMapper.cs
│   ├── BookingMapper.cs
│   └── NotificationMapper.cs
└── Infrastructure/         # Cross-cutting concerns
    ├── AuthMapping.cs
    ├── CorrelationIdMiddleware.cs
    ├── ErrorHandlingMiddleware.cs
    └── LoggingExtensions.cs
```

**Why Not Vertical Slices:**
- Vertical slices shine when features are independent and complex. Our endpoints are simple proxies with shared concerns (auth mapping, station ID translation, error handling).
- Feature-based organization would scatter shared infrastructure across slices.

**Why Not Clean Architecture:**
- Clean Architecture adds layers (Domain, Application, Infrastructure) for complex business logic. We have minimal business logic — mostly transformation and proxying.
- The "domain" is the client contract, not a rich domain model.

**Why Not CQRS:**
- Read/write separation is unnecessary when reads and writes are simple HTTP proxies.
- No event sourcing, no complex read models, no command handlers.

**Exception: Booking Schema Parser**
- The booking schema parser (`BookingSchemaMapper`) is complex (~500 lines) and deserves its own module.
- Keep it as a dedicated service with clear interfaces, but don't build an entire architecture around it.

---

## Project Structure

### Directory Layout

```
BookingService/                    # Booking service (separate from Search)
├── src/
│   ├── BookingService.Api/       # ASP.NET Core host project
│   │   ├── Program.cs
│   │   ├── appsettings.json
│   │   └── BookingService.Api.csproj
│   ├── BookingService.Application/  # Business logic
│   │   ├── Services/
│   │   │   ├── BookingService.cs
│   │   │   ├── NotificationService.cs
│   │   │   └── BookingSchemaMapper.cs
│   │   ├── Mappers/
│   │   │   ├── BookingMapper.cs
│   │   │   └── NotificationMapper.cs
│   │   └── BookingService.Application.csproj
│   ├── BookingService.Infrastructure/  # External integrations
│   │   ├── Clients/
│   │   │   ├── ITwelveGoApi.cs (Refit interface)
│   │   │   └── TwelveGoApiClient.cs
│   │   ├── Auth/
│   │   │   └── AuthMappingService.cs
│   │   ├── State/
│   │   │   └── SeatLockStore.cs (in-process ConcurrentDictionary)
│   │   └── BookingService.Infrastructure.csproj
│   └── BookingService.Contracts/  # Shared models
│       ├── Requests/
│       ├── Responses/
│       └── BookingService.Contracts.csproj
├── tests/
│   ├── BookingService.Api.Tests/
│   ├── BookingService.Application.Tests/
│   └── BookingService.Infrastructure.Tests/
└── BookingService.sln

SearchService/                    # Search & Master Data service
├── src/
│   ├── SearchService.Api/
│   ├── SearchService.Application/
│   ├── SearchService.Infrastructure/
│   └── SearchService.Contracts/
└── tests/
```

### .csproj Files (Total: 8 per service)

**Per Service:**
1. `{Service}.Api.csproj` — ASP.NET Core host (references Application, Infrastructure)
2. `{Service}.Application.csproj` — Business logic (references Contracts)
3. `{Service}.Infrastructure.csproj` — External clients, auth, state (references Contracts)
4. `{Service}.Contracts.csproj` — Request/response models (no dependencies)

**Test Projects:**
5. `{Service}.Api.Tests.csproj` — Integration tests
6. `{Service}.Application.Tests.csproj` — Unit tests for services/mappers
7. `{Service}.Infrastructure.Tests.csproj` — Unit tests for clients
8. `{Service}.Contracts.Tests.csproj` — Contract validation tests (optional)

**Total: 16 .csproj files (8 per service × 2 services)**

### Dependency Injection

**Standard .NET DI Only (No Autofac)**

```csharp
// Program.cs
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Application/ServiceCollectionExtensions.cs
public static IServiceCollection AddApplication(this IServiceCollection services)
{
    services.AddScoped<IBookingService, BookingService>();
    services.AddScoped<INotificationService, NotificationService>();
    services.AddScoped<IBookingSchemaMapper, BookingSchemaMapper>();
    return services;
}

// Infrastructure/ServiceCollectionExtensions.cs
public static IServiceCollection AddInfrastructure(
    this IServiceCollection services,
    IConfiguration configuration)
{
    services.AddRefitClient<ITwelveGoApi>()
        .ConfigureHttpClient(c => c.BaseAddress = new Uri(configuration["TwelveGo:BaseUrl"]))
        .AddHttpMessageHandler<ApiKeyInterceptor>()
        .AddPolicyHandler(GetRetryPolicy())
        .AddPolicyHandler(GetCircuitBreakerPolicy());
        
    services.AddSingleton<IAuthMappingService, AuthMappingService>();
    services.AddSingleton<ISeatLockStore, SeatLockStore>();
    return services;
}
```

### Configuration

**appsettings.json + Environment Variables**

```json
{
  "TwelveGo": {
    "BaseUrl": "https://api.12go.asia",
    "Timeouts": {
      "Search": 10,
      "GetTripDetails": 8,
      "Reserve": 15,
      "Confirm": 15
    }
  },
  "AuthMapping": {
    "ConfigPath": "/config/auth-mapping.yaml",
    "RefreshIntervalMinutes": 5
  },
  "StationMapping": {
    "ConfigPath": "/config/station-mapping.json",
    "RefreshIntervalHours": 24
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  },
  "Datadog": {
    "ApiKey": "${DATADOG_API_KEY}",
    "Service": "booking-service",
    "Environment": "${ASPNETCORE_ENVIRONMENT}"
  }
}
```

**Environment Variables:**
- `DATADOG_API_KEY` — injected at runtime
- `ASPNETCORE_ENVIRONMENT` — Development/Staging/Production
- `TwelveGo__BaseUrl` — override base URL per environment

---

## Data Strategy

### No DynamoDB, No PostgreSQL

**Eliminated Stores:**
- DynamoDB ItineraryCache → Re-fetch from 12go on each GetItinerary call
- DynamoDB PreBookingCache → Re-fetch booking schema from 12go at CreateBooking time
- DynamoDB BookingCache → Use 12go `/booking/{id}` as source of truth
- PostgreSQL BookingEntities → Proxy to 12go `/booking/{id}` for GetBookingDetails

**Rationale:**
- All data originates from 12go; no divergence to reconcile
- Eliminates cache invalidation bugs, GZip compression/decompression overhead
- 12go's MySQL is authoritative; local caches were never the source of truth

### Redis for Transient State (Optional)

**Seat Lock Store:**
- **Option A (Recommended):** In-process `ConcurrentDictionary<string, SeatLockEntry>` with TTL
  - Scope: single service instance
  - Lifetime: 30 minutes max
  - Loss on restart: acceptable (client can re-enter seat selection)
- **Option B:** Redis instance (if 12go's Redis is accessible)
  - Enables cross-instance seat lock sharing
  - Adds infrastructure dependency
  - Only needed if horizontal scaling without sticky sessions

**IncompleteResults Store:**
- In-process `ConcurrentDictionary<string, IncompleteSearchContext>` with 15-minute TTL
- Used for 206 Partial Content polling pattern
- No persistence needed

### Pure Stateless Proxy Where Possible

**Search & Master Data Service:** Fully stateless
- No local storage
- All requests proxy directly to 12go
- Master data snapshots (stations/operators) generated by periodic job → S3

**Booking Service:** Mostly stateless
- Seat lock: in-process only (or Redis if scaling)
- Notification delivery retry queue: in-process with scheduled jobs
- No booking storage — 12go is source of truth

---

## Cross-Cutting Concerns

### Logging and Tracing

**Serilog → Datadog**

```csharp
builder.Host.UseSerilog((context, config) =>
{
    config.ReadFrom.Configuration(context.Configuration)
        .Enrich.WithProperty("Service", "booking-service")
        .Enrich.WithProperty("Environment", context.HostingEnvironment.EnvironmentName)
        .WriteTo.DatadogLogs(
            apiKey: context.Configuration["Datadog:ApiKey"],
            source: "csharp",
            service: "booking-service",
            host: Environment.MachineName);
});
```

**Structured Logging:**
- Use source-generated logging (`LoggerMessage` attribute)
- Include: `client_id`, `correlation_id`, `endpoint`, `duration_ms`, `twelve_go_duration_ms`, `http_status`
- Log levels:
  - INFO: Request/response summaries
  - WARN: 12go errors handled gracefully, retries, near-timeouts
  - ERROR: Unhandled exceptions, 12go 5xx, circuit breaker trips, auth failures

**OpenTelemetry → Datadog**

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(builder => builder
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSource("BookingService")
        .AddOtlpExporter(options =>
        {
            options.Endpoint = new Uri("https://trace-intake.datadoghq.com/api/v2/traces");
            options.Headers = $"DD-API-KEY={configuration["Datadog:ApiKey"]}";
        }))
    .WithMetrics(builder => builder
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter(options =>
        {
            options.Endpoint = new Uri("https://trace-intake.datadoghq.com/api/v2/metrics");
            options.Headers = $"DD-API-KEY={configuration["Datadog:ApiKey"]}";
        }));
```

**Metrics:**
- `proxy.request.duration` (histogram): tagged with `service`, `endpoint`, `status_code`, `client_id`
- `proxy.twelvego.request.duration` (histogram): tagged with `endpoint`, `status_code`
- `proxy.twelvego.retry.count` (counter): tagged with `endpoint`
- `proxy.circuit_breaker.state` (gauge): 0=closed, 1=open
- `proxy.seatlock.active` (gauge): count of active seat locks
- `proxy.notification.delivered` (counter): tagged with `client_id`, `success`

### Error Handling

**Exception Hierarchy:**

```csharp
// Infrastructure/Exceptions/
public class TwelveGoApiException : Exception { }
public class TwelveGoAuthenticationException : TwelveGoApiException { }
public class TwelveGoProductNotFoundException : TwelveGoApiException { }
public class TwelveGoUnprocessableEntityException : TwelveGoApiException
{
    public Dictionary<string, string> FieldErrors { get; }
}
public class TwelveGoTimeoutException : TwelveGoApiException { }
public class TwelveGoCircuitBreakerOpenException : TwelveGoApiException { }
```

**Global Error Handler:**

```csharp
app.UseExceptionHandler(exceptionHandlerApp =>
{
    exceptionHandlerApp.Run(async context =>
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        
        logger.LogError(exception, 
            "Unhandled exception: {Path}, ClientId: {ClientId}, CorrelationId: {CorrelationId}",
            context.Request.Path,
            context.Request.RouteValues["clientId"],
            context.Request.Headers["x-correlation-id"]);
        
        var response = exception switch
        {
            TwelveGoProductNotFoundException => Results.NotFound(new { error = "Product not found" }),
            TwelveGoUnprocessableEntityException ex => Results.UnprocessableEntity(new { errors = ex.FieldErrors }),
            TwelveGoTimeoutException => Results.StatusCode(504),
            TwelveGoCircuitBreakerOpenException => Results.StatusCode(503),
            _ => Results.StatusCode(500)
        };
        
        await response.ExecuteAsync(context);
    });
});
```

**Error Response Format:**
- Match existing client contract format
- No stack traces in production
- Include `correlation_id` in response headers

### API Versioning and Correlation IDs

**Travelier-Version Header:**

```csharp
public class VersionHeaderFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var version = context.HttpContext.Request.Headers["Travelier-Version"]
            .FirstOrDefault() ?? "2024-01-01"; // oldest supported version
            
        context.HttpContext.Items["TravelierVersion"] = DateOnly.Parse(version);
        
        var result = await next(context);
        
        context.HttpContext.Response.Headers["Travelier-Version"] = version;
        return result;
    }
}
```

**Correlation ID Middleware:**

```csharp
public class CorrelationIdMiddleware
{
    private readonly RequestDelegate _next;
    
    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers["x-correlation-id"].FirstOrDefault()
            ?? Guid.NewGuid().ToString();
            
        context.Items["CorrelationId"] = correlationId;
        context.Response.Headers["x-correlation-id"] = correlationId;
        
        // Propagate to 12go calls via Refit interceptor
        await _next(context);
    }
}
```

**Propagation:**
- Read `x-correlation-id` from incoming request (or generate if absent)
- Include in all log lines
- Propagate to 12go API calls via Refit interceptor
- Return in response headers

---

## Notification Transformer

### Webhook Receiver Endpoint

```csharp
// Api/NotificationEndpoints.cs
app.MapPost("/v1/notifications/onetwogo/{path}", NotificationHandler.Handle)
    .WithName("TwelveGoWebhook")
    .AllowAnonymous() // Auth via IP whitelist or HMAC (when 12go supports it)
    .AddEndpointFilter<IpWhitelistFilter>();
```

**Security:**
- Validate source IP range (minimum security)
- Request HMAC-SHA256 signature from 12go (future enhancement)
- Log all unauthenticated webhook calls with source IP

### Per-Client Webhook Configuration

**Config Structure:**
```yaml
clients:
  - client_id: "client-a"
    twelveGoApiKey: "key-for-client-a"
    webhookUrl: "https://client-a.example.com/webhooks/booking"
    webhookAuthHeader: "X-Webhook-Secret"
    webhookAuthValue: "secret-for-client-a"
```

**Delivery Service:**

```csharp
public class NotificationService
{
    public async Task DeliverNotificationAsync(
        string clientId,
        BookingNotification notification,
        CancellationToken cancellationToken)
    {
        var config = _authMapping.GetClientConfig(clientId);
        var httpClient = _httpClientFactory.CreateClient();
        
        var request = new HttpRequestMessage(HttpMethod.Post, config.WebhookUrl);
        request.Content = JsonContent.Create(notification);
        if (!string.IsNullOrEmpty(config.WebhookAuthHeader))
        {
            request.Headers.Add(config.WebhookAuthHeader, config.WebhookAuthValue);
        }
        
        var response = await httpClient.SendAsync(request, cancellationToken);
        
        if (!response.IsSuccessStatusCode)
        {
            _retryQueue.Enqueue(new RetryItem(clientId, notification, attempt: 1));
        }
    }
}
```

### Retry Strategy

**In-Process Retry Queue:**

```csharp
public class NotificationRetryQueue : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var item = await _queue.DequeueAsync(stoppingToken);
            
            var delays = new[] { TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30) };
            if (item.Attempt > delays.Length)
            {
                _logger.LogError("Notification delivery failed after {Attempts} attempts: {ClientId}",
                    item.Attempt, item.ClientId);
                continue;
            }
            
            await Task.Delay(delays[item.Attempt - 1], stoppingToken);
            await _notificationService.DeliverNotificationAsync(
                item.ClientId, item.Notification, stoppingToken);
        }
    }
}
```

**Always Return 200 to 12go:**
- Acknowledge webhook immediately (decouple delivery from acknowledgement)
- Delivery failures are internal concern; don't cause 12go retry storms

---

## Reusable Code from Existing System

### Port from supply-integration

**1. OneTwoGoApi HTTP Client Logic**
- **Location:** `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/OneTwoGoApi.cs`
- **What to Port:**
  - URL construction patterns (`OneTwoGoUriBuilder`)
  - Error response parsing (`ErrorResponse` model, status code mapping)
  - Retry/timeout configuration
- **How to Port:** Adapt to Refit interface + Polly policies

**2. Request/Response Models**
- **Location:** `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/`
- **What to Port:**
  - `OneTwoGoSearchResponse`, `Trip`, `TravelOptions`, `Price`, `Station`, `Operator`
  - `GetBookingDetailsResponse`, `OneTwoGoBookingSchemaResponse`
  - `ReserveDataRequest`, refund models
- **How to Port:** Copy models directly; update namespaces

**3. ReserveDataRequest Serialization**
- **Location:** `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Serialization/FromRequestDataToReserveDataConverter.cs`
- **What to Port:** Custom `JsonConverter` for flat key-value bracket notation
- **How to Port:** Keep converter; use with `System.Text.Json` in Refit serialization

**4. Booking Schema Parser**
- **Location:** `supply-integration/SupplyIntegration.OneTwoGo.BookingSchema/OneTwoGoBookingSchema.cs`
- **What to Port:** Dynamic field extraction logic (20+ wildcard patterns)
- **How to Port:** Port `BookingSchemaMapper` service; preserve pattern matching logic

**5. Error Handling Patterns**
- **Location:** `supply-integration/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/OneTwoGoApi.cs` (CallApi method)
- **What to Port:** HTTP status → exception mapping, `ErrorResponse` parsing
- **How to Port:** Adapt to Refit error handling interceptor

### Do NOT Port

**1. SI Framework Abstractions**
- `ISiServiceProvider`, `AutofacSiServiceProvider` — unnecessary with single integration
- `ISiServiceScope`, Autofac keyed resolution — overkill
- `IntegrationHttpMiddleware` — replaced by Refit interceptors

**2. MediatR Pipeline**
- 10+ behaviors (SearchEvents, DistributionRules, etc.) — only direct call path survives
- MediatR itself — unnecessary for simple proxy layer

**3. DynamoDB Caching**
- `ItineraryCacheService`, `PreBookingCacheService`, `BookingCacheService` — eliminated
- Cache invalidation logic — not needed

**4. HybridCache**
- Triple-caching layer — 12go has Redis internally

**5. Kafka Event Producers**
- No trip lake, no data team — events not needed

---

## Testing Strategy

### Unit Tests

**Application Layer:**
- `BookingService` — mock `ITwelveGoApi`, verify mapping logic
- `BookingSchemaMapper` — test wildcard pattern matching with production 12go responses
- `SearchMapper`, `BookingMapper` — test contract transformation (money format, station ID reverse-mapping)

**Infrastructure Layer:**
- `AuthMappingService` — test config loading, refresh logic
- `SeatLockStore` — test TTL expiration, concurrent access
- `NotificationService` — test retry queue, delivery logic

### Integration Tests

**API Layer:**
- Test full request/response flow with in-memory test server
- Verify correlation ID propagation, version header handling
- Test error handling middleware

**12go API Client:**
- Use `WebApplicationFactory` or `HttpClient` test doubles
- Test retry policies, circuit breaker behavior
- Test error mapping (12go status codes → client responses)

### Contract Tests

**Contract Shape Validation:**
- Record production 12go API responses
- Replay through new service, diff output
- Verify money format (strings), station ID mapping, pricing structure

**OpenAPI/Swagger Validation:**
- Generate OpenAPI spec from Minimal API endpoints
- Compare against existing client contract documentation
- Verify all 13 endpoints match expected shapes

### Test Data

**Use AutoFixture for Test Data Generation:**
- Generate `OneTwoGoSearchResponse`, `GetBookingDetailsResponse` with realistic data
- Use `[MemberData]` attributes for parameterized tests

**Production Response Snapshots:**
- Store production 12go responses as JSON files in test project
- Use for booking schema parser tests (all operators, all routes)

---

## Deployment

### Docker Image (Standard vs AOT)

**Standard .NET 8 Container:**

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0-jammy-chiseled AS base
WORKDIR /app
EXPOSE 8080
USER app

FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy AS build
WORKDIR /src
COPY ["BookingService.Api/BookingService.Api.csproj", "BookingService.Api/"]
# ... copy other projects
RUN dotnet restore "BookingService.Api/BookingService.Api.csproj"
COPY . .
RUN dotnet build "BookingService.Api/BookingService.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "BookingService.Api/BookingService.Api.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "BookingService.Api.dll"]
```

**Size:** ~450MB (with .NET runtime)

**AOT Container (Recommended for Production):**

```dockerfile
FROM mcr.microsoft.com/dotnet/nightly/sdk:8.0-jammy-chiseled-aot AS build
WORKDIR /src
COPY ["BookingService.Api/BookingService.Api.csproj", "BookingService.Api/"]
# ... copy other projects
RUN dotnet restore "BookingService.Api/BookingService.Api.csproj"
COPY . .
RUN dotnet publish "BookingService.Api/BookingService.Api.csproj" \
    -c Release \
    -p:PublishAot=true \
    -p:SelfContained=true \
    -r linux-x64 \
    -o /app/publish

FROM mcr.microsoft.com/dotnet/nightly/runtime-deps:8.0-jammy-chiseled-aot AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["./BookingService.Api"]
```

**Size:** ~90-100MB (native binary, no .NET runtime)

**Constraints:**
- AOT requires all dependencies to be AOT-compatible
- Refit 9.x supports AOT (verify compatibility)
- Some reflection-based libraries may not work
- Test thoroughly before production deployment

**Recommendation:** Start with standard container for faster iteration, migrate to AOT for production after validation.

### CI/CD

**GitHub Actions Workflow:**

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'
      
      - name: Restore dependencies
        run: dotnet restore
      
      - name: Build
        run: dotnet build --no-restore -c Release
      
      - name: Test
        run: dotnet test --no-build -c Release --verbosity normal
      
      - name: Publish
        run: dotnet publish BookingService.Api/BookingService.Api.csproj -c Release -o ./publish
      
      - name: Build Docker image
        run: docker build -t booking-service:${{ github.sha }} .
      
      - name: Push to registry
        if: github.ref == 'refs/heads/main'
        run: |
          docker tag booking-service:${{ github.sha }} ${{ secrets.REGISTRY }}/booking-service:latest
          docker push ${{ secrets.REGISTRY }}/booking-service:latest
```

**Deployment:**
- Push Docker image to container registry
- DevOps manages deployment to 12go EC2 fleet
- Health checks: `GET /health/live`, `GET /health/ready`

---

## Team Considerations

### Immediate Productivity

**Advantages:**
- Zero learning curve — team knows .NET inside and out
- Existing code patterns (`OneTwoGoApi`, booking schema) port directly
- AI-assisted development (Cursor, Claude) works excellently with .NET
- Fast iteration — no context switching between languages

**Risks:**
- **Recreating Old Patterns:** Team familiarity may lead to porting unnecessary abstractions
  - **Mitigation:** Enforce strict code review, reject MediatR/SI framework patterns
  - **Mitigation:** Set hard code size limit (< 10K lines), reject "just in case" abstractions
- **Framework Bloat:** Temptation to add "enterprise" patterns (DDD, CQRS, Clean Architecture)
  - **Mitigation:** Remind team this is a proxy layer, not a complex domain
  - **Mitigation:** Use simple layered architecture; resist architectural complexity

### Code Size Discipline

**Target: < 10K Lines of Application Code**

**Breakdown Estimate:**
- API endpoints: ~500 lines (Minimal API route handlers)
- Services: ~2000 lines (SearchService, BookingService, NotificationService)
- Mappers: ~1500 lines (SearchMapper, BookingMapper, NotificationMapper)
- Booking schema parser: ~500 lines (port from existing)
- 12go API client: ~1000 lines (Refit interfaces + interceptors)
- Infrastructure: ~1000 lines (auth mapping, error handling, middleware)
- Models: ~2000 lines (request/response DTOs)
- Tests: ~2000 lines (unit + integration)

**Total: ~9.5K lines** (within target)

**Enforcement:**
- Code review checklist: "Does this add unnecessary abstraction?"
- Weekly code size reports (cloc tool)
- Reject PRs that exceed size limits without justification

### Maintenance Burden

**Long-Term Considerations:**
- If 12go migrates to Go, .NET services become orphaned
- However, proxy layer is simple — maintenance is minimal
- Team can transition to PHP/Go later if needed; contract preservation is the priority

**Recommendation:** Choose .NET 8 for immediate productivity, but design for eventual language transition. Keep codebase minimal and well-documented.
