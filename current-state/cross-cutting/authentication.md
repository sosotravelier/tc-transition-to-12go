---
status: draft
last_updated: 2026-02-17
---
# Authentication

## Current State

Authentication across the platform operates at **three distinct layers**:

1. **Client-facing API authentication** — Identifies and authenticates external API consumers (e.g., 12go) calling our services. Uses a combination of the `ClientIdentityMiddleware` (from the `connect.platform.client-identity-middleware` NuGet package) and an `x-api-key` header scheme. The client ID is embedded in the URL path as `/{client_id}/...`.

2. **Outbound supplier authentication** — Authenticates our platform when calling supplier APIs (e.g., 12go/OneTwoGo). Each supplier integration implements `IIntegrationHttpConnector.Authenticate()`, which adds credentials (API keys, query params, headers) to outgoing requests. Credentials are resolved per-contract (and optionally per-client) from a centralized configuration source.

3. **Webhook (inbound notification) authentication** — Authenticates incoming webhook calls from suppliers. Each integration registers its own `INotificationAuthenticator` implementation. Authentication methods vary: API key header validation, HMAC signature verification, or no authentication at all.

### Key Patterns

- **Feature flag gated**: The `ClientIdentityMiddleware` is controlled by the feature flag `UseClientIdentityMiddleware`. When disabled, client identity validation is bypassed.
- **API key not enforced at service level**: The booking services define an `ApiKeyRequirement` authorization policy but the actual handler (`BookingApiKeyRequirementHandler`) **always succeeds** — the comment states "currently allow all to pass as this is implemented in API GW". Real API key enforcement happens at the **API Gateway** level.
- **Client ID in URL path**: All client-facing endpoints include `{client_id}` as a path parameter (e.g., `/v1/{client_id}/bookings`).
- **Configuration source**: The `SupplierIntegration` config profile `InboundAuth` provides webhook authentication credentials; `DenaliSecrets` and per-integration configs provide outbound API credentials.

## Per-Service Details

### Etna Search

**Source**: `etna/api/Etna.Search.Api/Program.cs`

| Aspect | Detail |
|---|---|
| **Middleware** | `ClientIdentityMiddleware` registered conditionally via `UseMiddlewareForFeature<ClientIdentityMiddleware>("UseClientIdentityMiddleware")` |
| **Feature flag** | `FeatureManagement:UseClientIdentityMiddleware` — if `true`, adds `AddConnectClientIdentity(builder.Configuration)` to DI |
| **API key** | No explicit `x-api-key` authorization policy at the service level; relies on `ClientIdentityMiddleware` and API Gateway |
| **URL pattern** | Path base: `/etna-search-api` (or `BASE_URL` env var). Client ID is not in the path for search (gRPC + HTTP) |
| **gRPC** | Also exposes `EtnaSearchGrpcService` with `AllowAnonymous()` on health checks |
| **Config profiles** | `EtnaSearchApi/SecretConfiguration`, `General/General` |

Key code:
```csharp
// Conditional registration
if (builder.Configuration.GetValue<bool>("FeatureManagement:UseClientIdentityMiddleware"))
{
    builder.Services.AddConnectClientIdentity(builder.Configuration);
}

// Conditional middleware
app.UseMiddlewareForFeature<ClientIdentityMiddleware>("UseClientIdentityMiddleware");
```

### Denali booking-service

**Source**: `denali/booking-service/host/BookingService.Api/StartupHelperExtensions.cs`

| Aspect | Detail |
|---|---|
| **Middleware** | `ClientIdentityMiddleware` registered via `UseMiddlewareForFeature<ClientIdentityMiddleware>(nameof(FeatureFlags.UseClientIdentityMiddleware))` |
| **Feature flag** | `FeatureManagement:UseClientIdentityMiddleware` — conditionally adds `AddConnectClientIdentity(builder.Configuration)` |
| **API key policy** | Defines `ApiKey` authorization policy with `ApiKeyRequirement(["my-secret-key"], "ApiKey")` — but `BookingApiKeyRequirementHandler` **always succeeds** (`context.Succeed(requirement)`) |
| **Header** | `x-api-key` defined in OpenAPI spec and Swagger config via `GeneralConstants.TravelierApiHeaderKey` |
| **URL pattern** | Path base: `/denali_booking_service`. Endpoints follow `/{client_id}/...` pattern (e.g., `/v1/{client_id}/bookings`) |
| **Config profiles** | `DenaliBookingApi/GeneralConfiguration`, `DenaliBookingApi/DenaliSecrets`, `SupplierIntegration/InboundAuth` |

Key code:
```csharp
// API key authorization — always passes through
public class BookingApiKeyRequirementHandler : ApiKeyRequirementHandler
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, ApiKeyRequirement requirement)
    {
        // currently allow all to pass as this is implemented in API GW
        context.Succeed(requirement);
    }
}
```

The generated `ApiKeyRequirementHandler` base class reads `x-api-key` from request headers and validates against configured keys — but the override bypasses this entirely.

### Denali post-booking-service

**Source**: `denali/post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs`

| Aspect | Detail |
|---|---|
| **Middleware** | `ClientIdentityMiddleware` is **always registered** (no feature flag guard on `AddConnectClientIdentity`) — `builder.Services.AddConnectClientIdentity(builder.Configuration)` is called unconditionally |
| **API key policy** | Same pattern as booking-service: `BookingApiKeyRequirementHandler` always succeeds |
| **Pipeline note** | `ConfigurePipeline()` does **not** include `UseMiddlewareForFeature<ClientIdentityMiddleware>` — the middleware is registered in DI but **not added to the HTTP pipeline** |
| **URL pattern** | Path base: `/denali_booking_service`. Endpoints follow `/{client_id}/...` pattern |
| **Config profiles** | `DenaliBookingApi/GeneralConfiguration`, `DenaliBookingApi/DenaliPostBookingGeneralConfiguration`, `DenaliBookingApi/DenaliSecrets` |

**Important**: Post-booking-service registers `AddConnectClientIdentity` in DI but does **not** call `UseMiddlewareForFeature<ClientIdentityMiddleware>` in its pipeline. The `ClientIdentityMiddleware` is therefore available but **not active** in the request pipeline. Authentication depends on the API Gateway.

### Denali booking-notification-service

**Source**: `denali/booking-notification-service/host/BookingNotificationService/Program.cs`

| Aspect | Detail |
|---|---|
| **Middleware** | **No `ClientIdentityMiddleware`** — this service handles incoming webhooks from suppliers, not client-facing requests |
| **Webhook auth** | Per-integration `INotificationAuthenticator` resolved via `IServiceProvider.GetKeyedService<INotificationAuthenticator>(integration)` |
| **URL pattern** | Path base: `/denali_booking_notification_service`. Webhook endpoint: `v1/notifications/{integration}/{*path}` |
| **Config profiles** | `DenaliBookingNotificationService/GeneralConfiguration`, `DenaliBookingNotificationService/DenaliBookingNotificationServiceSecrets`, `DenaliBookingApi/DenaliSecrets`, **`SupplierIntegration/InboundAuth`** |

The `WebhookController` orchestrates webhook processing:
1. Resolves `INotificationAuthenticator`, `IPostNotificationHandler`, and `INotificationResponseHandler` by integration key
2. Calls `authenticator.Authenticate(path, Request)` before processing
3. On `AuthenticationException`, delegates to `responseHandler.HandleResponseMessage`

#### Per-Integration Webhook Auth

| Integration | Auth Method | Details |
|---|---|---|
| **OneTwoGo** | **None** | `NotificationAuthenticator.Authenticate()` returns `ValueTask.CompletedTask` — no authentication |
| **Distribusion** | **HMAC-SHA256** | Reads `x-distribusion-signature` header (format: `sha256=<hex>`), validates via `IHMACAuthenticator` |
| **FlixBus** | **API Key** | Reads header (integration-specific `SharedConstants.AuthHeaderName`), validates via `IApiKeyAuthenticator` |
| **Bookaway** | **API Key** | Reads `NotificationConstants.NotificationAuthHeader`, validates via `IApiKeyAuthenticator` |
| **SeatOs** | **API Key** | Uses `IApiKeyAuthenticator` pattern |
| **DeOniBus** | **API Key/HMAC** | Uses inbound authentication from credentials store |
| **Sisorg** | **API Key** | Uses `IApiKeyAuthenticator` pattern |
| **TcTour** | **API Key** | Uses `IApiKeyAuthenticator` pattern |
| **Dummy** | **None** | Test/fake integration, no auth |

Credentials for webhook auth are loaded from the `SupplierIntegration/InboundAuth` config profile via `CredentialsStoreReader` into a `CredentialsStore` (dictionary of integration ID to credentials).

### Fuji Exposure API

**Source**: `fuji/exposure/api/Fuji.Exposure.Api/Program.cs`

| Aspect | Detail |
|---|---|
| **Middleware** | **No `ClientIdentityMiddleware`** — not registered or used |
| **API key** | Defined in OpenAPI spec (`master_data.yml`) as `X-API-KEY` header security scheme with global `security: [ApiKey: []]` |
| **Authorization** | `app.UseAuthorization()` is called but no custom authorization policies are configured |
| **URL pattern** | Path base: `/exposure`. Client ID in server URL template: `/v1/{client_id}/...` |
| **Config profiles** | `FujiExposureApi/GeneralConfiguration`, `General/General`, `GeneralEndpoints/GeneralEndpoints` |

**Important**: Despite the OpenAPI spec declaring API key authentication, the service code does **not** implement any API key validation middleware or authorization handler. Authentication is handled at the **API Gateway** level.

## 12go Authentication

### Outbound: How We Authenticate TO 12go

When our services call the 12go (OneTwoGo) API, authentication is handled through the Supply Integration connector framework:

**Flow**:
1. `ConnectorFactory.CreateConnector()` resolves credentials per integration/contract/client from `ISiConfigurationSource`
2. Credentials (`Key`, `Url`, `Username`, `Password`) are packed into `authParams` dictionary
3. `HttpClientConnector.SendAsync()` attaches `authParams` as request options
4. `IntegrationHttpMiddleware` (a `DelegatingHandler`) intercepts outgoing requests:
   - Reads `SiContext` and `AuthParams` from request options
   - Calls `IIntegrationHttpConnector.Authenticate()` for the specific integration
5. `OneTwoGoHttpConnector.Authenticate()` adds the API key as a **query parameter** `k`:

```csharp
public async Task<HttpRequestMessage> Authenticate(
    HttpRequestMessage message, IDictionary<string, string> connectivityParams)
{
    var modifyRequest = new Dictionary<string, string>
    {
        ["x-api-key"] = connectivityParams["Key"]
    };
    await message.AddAuth(AuthLocation.Query, modifyRequest);
    return message;
}
```

The `AuthUtility.AddAuth()` method with `AuthLocation.Query` reads the `Key` from auth params and adds it as query parameter `k`:
```csharp
case AuthLocation.Query:
    var query = HttpUtility.ParseQueryString(request.RequestUri!.Query);
    var key = request.Options.TryGetValue(
        new HttpRequestOptionsKey<Dictionary<string, string>>("AuthParams"), out var auth)
        ? auth.TryGetValue("Key", out var k) ? k : string.Empty
        : string.Empty;
    query.Add("k", key);
```

**Summary**: 12go API key is sent as query parameter `?k=<api_key>` on every outgoing request.

### Inbound: 12go Webhook Authentication

When 12go sends webhook notifications to our `booking-notification-service`:

- **No authentication** — the `OneTwoGo.PostBookingNotifications.NotificationAuthenticator` simply returns `ValueTask.CompletedTask`
- This means any HTTP POST to `v1/notifications/onetwogo/...` is accepted without validation

### Authentication Methods by Location

| Direction | Method | Transport |
|---|---|---|
| **Our services → 12go API** | API key as query param `k` | `?k=<key>` appended to URL |
| **12go → Our webhook** | None | Unauthenticated POST |

## Transition Considerations

### Must Preserve (Client Compatibility)

1. **`x-api-key` header scheme** — All client-facing APIs define this in their OpenAPI specs. Existing clients (including 12go) send this header. Any transition must continue accepting `x-api-key`.

2. **`{client_id}` in URL path** — All booking and search endpoints include client ID in the path. This is deeply embedded in routing, the `ClientIdentityMiddleware`, and client integrations.

3. **API Gateway enforcement** — Real authentication currently happens at the API Gateway, not at the service level. The services' own auth handlers are passthrough. A transition could either:
   - Continue delegating to gateway (simpler)
   - Move enforcement into services (more secure, allows service-level testing)

4. **`ClientIdentityMiddleware` contract** — The middleware from `connect.platform.client-identity-middleware` NuGet package is shared across services. Its configuration and behavior must be understood before replacing or upgrading.

5. **Outbound 12go API key mechanism** — The `?k=<api_key>` query parameter pattern is dictated by 12go's API contract. This must be preserved regardless of internal architecture changes.

### Can Change

1. **Passthrough authorization handlers** — `BookingApiKeyRequirementHandler` always succeeding is a known tech debt. Could be replaced with real validation.

2. **Inconsistent middleware registration** — Post-booking-service registers `ClientIdentityMiddleware` in DI but doesn't add it to the pipeline. This inconsistency should be resolved.

3. **Feature flag gating** — The `UseClientIdentityMiddleware` feature flag suggests the middleware was gradually rolled out. In a new system, it could be always-on or replaced with a standard auth approach.

4. **Webhook authentication gaps** — OneTwoGo webhooks have no authentication. This is a security concern that should be addressed in transition.

5. **Inbound auth credentials management** — Currently loaded from AWS AppConfig (`SupplierIntegration/InboundAuth`). Could move to a secrets manager or more centralized approach.

### Risks

- **Silent auth bypass**: Since booking services' API key handlers always succeed, if the API Gateway is misconfigured or bypassed, there is no service-level authentication.
- **Unauthenticated webhooks**: OneTwoGo webhooks are unauthenticated. An attacker who discovers the endpoint URL could send fake booking notifications.
- **Config profile sprawl**: Auth-related secrets are spread across multiple AWS AppConfig profiles (`DenaliSecrets`, `InboundAuth`, `SecretConfiguration`).

## Open Questions

1. **What does `ClientIdentityMiddleware` actually validate?** — The NuGet package is external; its internal behavior (does it validate API keys? check client ID against a registry?) needs clarification.

2. **API Gateway auth rules** — What exact authentication/authorization rules does the API Gateway enforce? Is it IP-based, API key validation, OAuth, or something else?

3. **Why is post-booking-service `ClientIdentityMiddleware` registered but not in the pipeline?** — Is this intentional (internal-only service) or a bug?

4. **Should OneTwoGo webhook auth be added?** — Does 12go support webhook signing/authentication? If so, should it be implemented before or during transition?

5. **Credential rotation process** — How are API keys (both inbound and outbound) rotated? Is there a process, or is it manual config updates?

6. **Per-client credentials** — The `ConnectorFactory` supports per-client credentials (`ContractClientCredentials`). Which integrations use this, and how does it affect the transition?

7. **Fuji Exposure API auth gap** — The OpenAPI spec declares API key auth, but the service has no enforcement. Is this by design (gateway handles it) or an oversight?
