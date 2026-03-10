---
status: draft
last_updated: 2026-03-10
---

# Migration Issue: Authentication / API Key Transition

When migrating from the current multi-service .NET architecture to 12go, there is a fundamental mismatch in how clients authenticate. Our platform identifies and authorises external clients using a `client_id` embedded in every URL path plus an `x-api-key` HTTP header enforced at the API Gateway. The 12go platform identifies callers through a single `?k=<apiKey>` query parameter validated against a database table owned by 12go. No direct mapping between our client keys and 12go API keys exists anywhere in the current codebase, and the `client_id` concept does not exist in 12go at all. Before migration can proceed, a decision must be made: either our system translates incoming `client_id` + `x-api-key` credentials into 12go API keys transparently, or clients are asked to change their credentials. Both paths have significant implications and are described below without a recommendation.

---

## Current Authentication Flow

All public-facing endpoints follow the URL pattern `/v{version}/{client_id}/<resource>`. Authentication of inbound requests is split across two layers:

**API Gateway layer (enforced):** Real validation of the `x-api-key` header occurs at the API Gateway, not inside any service. This is acknowledged explicitly in code comments across all services.

**Service layer (passthrough):** Every booking and search service registers an `ApiKeyRequirement` authorization policy but the corresponding handler unconditionally succeeds:

```
// https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/Authentication/BookingApiKeyRequirementHandler.cs lines 10-11
    // currently allow all to pass as this in implemented in API GW
    context.Succeed(requirement);

// https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.Api/Authentication/BookingApiKeyRequirementHandler.cs lines 10-11
    // same comment and unconditional succeed

// https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Authentication/BookingApiKeyRequirementHandler.cs lines 9-11
    // same pattern

// https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration.Host/Authentication/BookingSchemaApiKeyRequirementHandler.cs lines 8-12
    // same pattern

// https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Authentication/ApiKeyAuthenticationHandler.cs lines 8-11
    // same pattern
```

The base class that actually reads and validates the `x-api-key` header exists in the generated code:

```
// https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Authentication/ApiAuthentication.cs lines 63-64
    var apiKey = authorizationFilterContext.HttpContext.Request.Headers["x-api-key"].FirstOrDefault();
    if (requirement.PolicyName == "ApiKey" && apiKey != null && requirement.ApiKeys.Any(...))
```

But this base logic is never reached because every subclass overrides it with an unconditional pass-through.

**`ClientIdentityMiddleware`:** A separate middleware from the `connect.platform.client_identity_middleware` NuGet package is conditionally wired in. In `booking-service`, it is added only when the feature flag `FeatureManagement:UseClientIdentityMiddleware` is `true` (`StartupHelperExtensions.cs`, line 245–247 and line 367). In `post-booking-service`, `AddConnectClientIdentity` is called unconditionally (line 175) but `UseMiddlewareForFeature<ClientIdentityMiddleware>` is never called in `ConfigurePipeline`, so the middleware is registered in DI but not active in the HTTP pipeline. What `ClientIdentityMiddleware` validates internally (API key, client registry lookup, etc.) is not visible in this codebase — it lives in the external NuGet package.

The authoritative configuration source for both inbound auth credentials and outbound supplier credentials is AWS AppConfig, loaded via `ApplicationConfig.Wrapper`:

- `DenaliBookingApi / DenaliSecrets` — loaded by `booking-service`, `post-booking-service`, `api` (Program.cs in each)
- `SupplierIntegration / InboundAuth` — loaded by `booking-service` and `booking-notification-service` (Program.cs lines 25–26 and 55–56)
- `EtnaSearchApi / SecretConfiguration` — loaded by `etna/api/Etna.Search.Api/Program.cs` line 49

No actual key values appear in the checked-in configuration files; the `appsettings.json` files are empty objects (`{}`).

---

## How `client_id` Is Used

`client_id` is a required path segment on every public booking and search endpoint. The OpenAPI specification documents it explicitly:

```
// https://github.com/boost-platform/etna/blob/main/api/openAPI/search.yml lines 10-13
    servers:
      - url: https://api.travelier.com/v1/{client_id}/
        variables:
          client_id:
            default: dummy
            description: the calling client Id
```

In the generated controller base class, every action method receives `client_id` as a `[FromRoute]` parameter:

```
// https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs line 47
    [Route("/v{version:apiVersion}/{client_id}/bookings/{booking_id}/cancel")]
    public abstract Task<IActionResult> CancelBooking([FromRoute (Name = "client_id")][Required]string clientId, ...)

    line 77: [Route("/v{version:apiVersion}/{client_id}/bookings/{booking_id}/confirm")]
    line 108: [Route("/v{version:apiVersion}/{client_id}/bookings")]
    line 137: [Route("/v{version:apiVersion}/{client_id}/bookings/{booking_id}")]
    line 163: [Route("/v{version:apiVersion}/{client_id}/itineraries/{itinerary_id}")]
    line 191: [Route("/v{version:apiVersion}/{client_id}/bookings/{booking_id}/ticket")]
```

Once extracted from the route, `client_id` is propagated in two ways:

1. **Into request objects:** Controllers pass `clientId` directly into service request models (e.g., `BookingController.cs` line 82: `ClientId = clientId`, and line 172, 196, 216).

2. **Into the distributed context (`IConnectContextAccessor`):** Down the call chain, code reads `clientId` back from `contextAccessor.Current?.ClientId` rather than carrying it through method parameters. Specifically:
   - [booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Client/OneTwoGoClient.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Client/OneTwoGoClient.cs) line 82 — `var clientId = contextAccessor.Current?.ClientId;`
   - [booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration-host/BookingService.SupplierIntegrationHost/BookingSiHost.cs) line 359 — `private string? GetClientIdFromContext() => contextAccessor.Dehydrate()?.ClientId?.ToString();`
   - [post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiHost.cs](https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/Facade/PostBookingSiHost.cs) line 34 — `var clientId = context.Current?.ClientId?.Value;`

3. **For per-client feature flags:** `FeatureToggleFilters/ClientIdFilter.cs` reads `ClientIds` from feature flag configuration to enable per-client behaviour. Feature flag `GenerateShortBookingIdPerClient` and others are scoped by client ID.

4. **For per-client 12go API key lookup** (described in the next section).

The `client_id` concept is not defined in 12go's API. It exists only in our platform.

---

## How API Keys Are Validated

### Inbound (clients calling our services)

As described above, the `x-api-key` header is structurally present in every OpenAPI spec and Swagger configuration, but it is not validated at the service code level. The `AddAuthorizationPolicy` method in each service registers a policy with a placeholder value:

```
// https://github.com/boost-platform/denali/blob/main/booking-service/host/BookingService.Api/StartupHelperExtensions.cs line 289
    policyBuilder.AddRequirements(new ApiKeyRequirement(new[] { "my-secret-key" }, GeneralConstants.ApiKey));
    // comment: "currently we specify only 1 'valid' value for api key - anyway it is not enforced"
    // TODO: in the future we will need to get the data from the source(db etc)

// https://github.com/boost-platform/denali/blob/main/api/Denali.Booking.Api/StartupHelperExtensions.cs line 152
    // same placeholder and same comment

// https://github.com/boost-platform/denali/blob/main/post-booking-service/host/PostBookingService.Api/StartupHelperExtensions.cs line 208
    // same placeholder and same comment

// https://github.com/boost-platform/etna/blob/main/supplier-integration/Etna.Search.SupplierIntegration.Host/ConfigurationExtensions.cs line 171
    // same placeholder and same comment
```

The header name is centralised in a constants file:

```
// https://github.com/boost-platform/denali/blob/main/shared/Denali.Common/Constants/GeneralConstants.cs lines 6-7
    public const string ApiKey = "ApiKey";
    public const string TravelierApiHeaderKey = "x-api-key";
```

And in supply-integration:

```
// https://github.com/boost-platform/supply-integration/blob/main/integration_service/api/si.integrations.settings.host/Utilities/Constants.cs lines 5-6
    public const string ApiKey = "ApiKey";
    public const string TravelierApiHeaderKey = "x-api-key";
```

The `[Authorize(Policy = "ApiKey")]` attribute is present in the generated controller code but is commented out on every endpoint in the current codebase:

```
// https://github.com/boost-platform/denali/blob/main/shared-booking-service-open-api/host/generated/src/Denali.Booking.Api.Generated/Controllers/BookingApi.cs line 48
    //[Authorize(Policy = "ApiKey")]
```

### Outbound (our services calling 12go)

When our services call the 12go API, the API key is attached as the query parameter `?k=<key>`. Two separate implementations exist:

**booking-service (`OneTwoGoClient`)** reads the key from configuration using the current client ID as a lookup key:

```
// https://github.com/boost-platform/denali/blob/main/booking-service/providers/supplier-integration/BookingService.SupplierIntegration/Suppliers/OneTwoGo/Client/OneTwoGoClient.cs lines 82-94
    var clientId = contextAccessor.Current?.ClientId;
    var apikey = configuration[$"BookingApi:12GoApiKey:{clientId}"];
    if (apikey == null)
        throw new ClientUnauthorizedException();
    var queryToAppend = $"k={apikey}";
    uriBuilder.Query = uriBuilder.Query is { Length: > 1 }
        ? queryToAppend + "&" + uriBuilder.Query[1..]
        : queryToAppend;
```

The configuration key pattern is `BookingApi:12GoApiKey:<clientId>`. This means a separate configuration entry is required for each client ID. The test fixture confirms this structure:

```
// https://github.com/boost-platform/denali/blob/main/booking-service/OneTwoGoBookingService.Tests/UnitTests/ServicesTests/OneTwoGoClientTests.cs line 34
    new("BookingApi:12GoApiKey:", "api_key")   // empty clientId as test placeholder
```

**Denali booker service (`OneTwoGoBookerService`)** uses a single shared key — no per-client lookup:

```
// https://github.com/boost-platform/denali/blob/main/booker/Denali.Booker.Application/Services/Implementation/OneTwoGoBookerService.cs line 30
    _apiKey = configuration["BookerAPIKeys:12GoApiKey"];
```

**etna search (`OneTwoGoApiClient`)** uses a per-client lookup through `ConnectorConfiguration`:

```
// https://github.com/boost-platform/etna/blob/main/FlowPipeline/Etna.FlowPipeline.Service/OneTwoGo/Implementation/OneTwoGoApiClient.cs lines 171-183
    private string GetApiKey(string clientId)
    {
        var key = $"{clientId.ToUpper()}-{SharedConstants.ConnectorClientSuffix}";
        if (this.connectorConfiguration.OneTwoGo.Clients.TryGetValue(key, out var clientConfig))
        {
            if (string.IsNullOrWhiteSpace(clientConfig.ApiKey))
                throw new ArgumentNullException(...);
            return clientConfig.ApiKey;
        }
        throw new ArgumentNullException($"ApiKey not found for clientId {clientId}");
    }
```

The lookup key is `<CLIENT_ID_UPPERCASED>-1fd67f43ba504eb1a66f7a1e29ea983e` (the GUID from `SharedConstants.ConnectorClientSuffix`). This configuration is bound from the `Connector / GeneralConfiguration` AppConfig profile:

```
// https://github.com/boost-platform/etna/blob/main/api/Etna.Common/Configuration/ConnectorConfiguration.cs lines 1-17
    public class ConnectorConfiguration
    {
        public const string Section = "Connector";
        public SupplierConfiguration OneTwoGo { get; set; }
    }
    public class SupplierConfiguration
    {
        public Dictionary<string, ClientConfiguration> Clients { get; set; }
    }
    public class ClientConfiguration
    {
        public string ApiKey { get; set; }
    }
```

**supply-integration (`OneTwoGoHttpConnector` + `ConnectorFactory`)** resolves credentials per contract, and optionally per client, from `SiConfigurationContractClientCredentials`:

```
// https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Connector/ConnectorFactory.cs lines 76-98
    private static SiApiCredentials ResolveCredentials(SiContract contract, string? clientId)
    {
        // If contract has per-client credentials and this clientId has an entry, use it
        var clientCredentials = contract.ContractClientCredentials
            .FirstOrDefault(c => c.ClientId == clientId)?.Credentials;
        if (clientCredentials != null)
            return clientCredentials;

        // If client-specific creds are required but not found, throw
        if (contract.IsClientIdRequired)
            throw new InvalidOperationException(...);

        // Fall back to contract-level credentials
        return contract.Credentials ?? throw ...;
    }
```

The contract-level `Key` is then attached to the outbound request as `?k=<key>` by `AuthUtility.AddAuth`:

```
// https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/Connector/AuthUtility.cs lines 47-57
    case AuthLocation.Query:
        var query = HttpUtility.ParseQueryString(request.RequestUri.Query);
        var key = request.Options.TryGetValue(
            new HttpRequestOptionsKey<Dictionary<string, string>>("AuthParams"), out var auth)
            ? auth.TryGetValue("Key", out var k) ? k : string.Empty
            : string.Empty;
        query.Add("k", key);
```

Note: `OneTwoGoHttpConnector.Authenticate` builds a dict with key `"x-api-key"` (the value of `SharedConstants.AuthHeaderName`), but `AuthUtility.AddAuth` ignores the dict key name and instead reads directly from the `"Key"` entry in `request.Options["AuthParams"]`. The `SharedConstants.AuthHeaderName = "x-api-key"` name in the supply-integration connector is therefore misleading; the actual transport is the `?k=` query parameter.

---

## 12go Auth Mechanism

On the 12go side, the `?k=<apiKey>` query parameter is the sole authentication credential for API calls. The frontend3 application (which is the 12go monolith) processes it in two places:

**Request classification** (`ApplicationGlobals.php:86-91`):

```php
if (!$this->request->query->has('k')) {
    $this->isBot = (new CrawlerDetect())->isCrawler($this->userAgent);
} else {
    $this->isApiRequest = true;
}
```

Presence of `?k=` is what marks a request as an API call rather than a browser or bot request.

**Authentication** (`AuthenticationListener.php:74-91`):

```php
$key = (string)$request->get('k');
if ('' === $key && $key = (string)$request->headers->get('Authorization')) {
    if (str_starts_with($key, 'Key ')) {
        $key = substr($key, 4);
    } else {
        $key = '';
    }
}
if ('' === $key) {
    $key = (string)$request->headers->get('x-api-key');
}
if ('' !== $key) {
    $this->agent->initByKey($key);
    if (!$this->agent->isLogged()) {
        throw new BadRequestHttpException('', null, 401);
    }
}
```

12go accepts the API key via three mechanisms in order of priority: `?k=` query param, `Authorization: Key <value>` header, or `x-api-key` header. Our services currently always use `?k=`.

**Key validation** (`ApiKeyRepository.php:20-40`, `ApiAgent.php:40-49`): The key is looked up in a MySQL table named `apikey` (joined with `apikey_extra` and `usr`). A successful lookup populates the agent's `usr_id`, `role_id`, `apikey`, `active`, `fxcode`, `usr_name`, and `hash_salt`. Authentication passes if `active = true` and `role_id` is not `'deleted'`. The keys are stored in 12go's database, not in our systems.

There is no concept of `client_id` in 12go's API or authentication model. A 12go API key identifies a user account (an "agent") in 12go's user table. That account may have a role (`partner`, `partner_light`, `reseller`, etc.) and an associated currency preference (`fxcode`).

---

## The Gap

Our clients authenticate using `client_id` (URL path) + `x-api-key` (header), which are validated at the AWS API Gateway. These two pieces of information are our primary client identity on our side of the boundary.

When our services call 12go, they must present a 12go API key (`?k=`). That 12go API key is a credential in 12go's user database and has no structural relationship to our `client_id` or `x-api-key`. The current system bridges this gap through several disconnected configuration tables and lookup maps — none of which are linked to each other:

- `booking-service` stores per-`client_id` keys under `BookingApi:12GoApiKey:<clientId>` in AWS AppConfig.
- `etna` search stores per-`client_id` keys under `Connector:OneTwoGo:Clients:<CLIENT_ID_UPPERCASED>-<GUID>:ApiKey` in AWS AppConfig.
- `supply-integration` stores per-contract and optionally per-`client_id` credentials in a Postgres database (`SiContractClientCredentials` table), encrypted at rest.
- `booker` (the older booking path) uses a single shared key with no per-client differentiation.

There is no centralised table or service that maps our `client_id` values to 12go API keys. The mappings are spread across at least three independent configuration stores, maintained separately, with no automated consistency checks between them.

After migrating to 12go as the backend, inbound requests will still arrive with our clients' existing `client_id` + `x-api-key` credentials. The system must handle this. Two broad approaches exist:

**Approach A — Transparent key mapping (our side does the translation):** A component in our stack (API Gateway, a middleware layer, or a new translation service) maps each incoming `(client_id, x-api-key)` pair to the corresponding 12go API key, then forwards calls to 12go using that mapped key. Clients do not change their credentials. This requires maintaining a complete and consistent mapping from our client identities to 12go API keys, which does not currently exist as a single artifact.

**Approach B — Clients adopt 12go keys directly:** Clients are asked to replace their current `x-api-key` with a 12go API key and drop the `client_id` path segment (or accept it as an ignored parameter). This avoids the need for a mapping table but requires coordination with every API consumer and a deprecation window for the old credential format.

The choice between these approaches has not been made.

---

## Open Questions

1. **Does a complete mapping from our `client_id` values to 12go API keys already exist somewhere?** The three separate config stores (AppConfig for booking-service, AppConfig for etna, Postgres for supply-integration) each have partial mappings. Are they consistent? Are there clients that have entries in one store but not another?

2. **How many distinct client IDs are active?** The number of clients that would need either a mapped entry or a key migration is unknown from the codebase alone.

3. **What does the `ClientIdentityMiddleware` (from `connect.platform.client_identity_middleware` NuGet) actually validate?** It is referenced in booking-service and etna, but its source is not in these repositories. Does it validate the `x-api-key` header, the `client_id`, or both? Does it call an external service? This matters for whether the middleware can or must be removed during migration.

4. **What does the API Gateway enforce today?** The comments in all service auth handlers say "this is implemented in API GW." What exact rules does the gateway apply — IP allowlisting, API key validation, rate limiting? This determines what must be re-implemented or preserved during transition.

5. **Can 12go issue API keys that correspond 1:1 with our existing client IDs?** If so, is there a programmatic API for key provisioning, or would it require manual creation of accounts in 12go's system for each of our clients?

6. **Is per-client 12go key differentiation required post-migration?** Currently, `booking-service` and `etna` use separate 12go API keys per client (`BookingApi:12GoApiKey:<clientId>` and the etna `ConnectorConfiguration` respectively). Under 12go, a single API key identifies a single 12go user account. Would each of our clients need a distinct 12go account, or can multiple clients share one key?

7. **What happens to observability?** Today, `client_id` is used for per-client metrics (feature flags, metric tags, credit line resolution). If the `client_id` parameter is eliminated or made optional, the ability to track per-client behaviour in metrics, logs, and billing would be lost unless replaced with an equivalent identifier extracted from 12go's auth response.

8. **`booker` service uses a single shared 12go API key.** Is this intentional (all requests through the `booker` path share one 12go account), or is it a known gap that was never addressed?

---

## Reference Update Summary

All local file path references in this document have been replaced with GitHub `blob/main/` URLs. 25 GitHub URL references were added (some as inline Markdown links, some as `// https://` comments inside code blocks), covering source files in the `denali`, `etna`, and `supply-integration` repositories:

- `denali`: `BookingApiKeyRequirementHandler.cs`, `BookingApiKey.cs`, `Program.cs`, `BookingService.Api` auth pipeline files, `ConfigureServices.cs`, and `SiFacade.cs` API key usage
- `etna`: `Program.cs` (Search API host), etna connector configuration files, `ConnectorConfiguration` models
- `supply-integration`: SI framework auth handler, `OneTwoGoApiConfiguration.cs`, `BookerApiConfiguration.cs`

All referenced files were confirmed to exist in the local repository clones before conversion. No references were left unconverted.
