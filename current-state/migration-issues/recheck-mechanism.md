---
status: draft
last_updated: 2026-03-10
---

# Migration Issue: Recheck Mechanism

The 12go platform does not serve fully live supplier availability from its search API. Instead, many trips in `trip_pool` carry stale or unvalidated availability data. When a search is performed, 12go returns an array of recheck URLs alongside the trip results. These URLs must be called — asynchronously, after the search response has been delivered — to trigger per-integration live supplier checks that write fresh availability back into `trip_pool`. If these URLs are not called, any trip whose price is not yet confirmed carries `priceIsValid = false` (rendered as `"approximate": true` to API consumers) and will continue to do so on every subsequent search. The current .NET system handles this through `OneTwoGoRecheckManager`, which fires HTTP GET requests to each recheck URL inside unobserved `Task.Run` tasks. The current work-in-progress PoC B2B Search controller (`B2bApi/Controller/SearchController.php`) calls `searchWithRecheckUrls()` and reads back the resulting recheck URL list, but does not yet call any of those URLs. This is a known limitation of the throwaway PoC code, not a gap in the migration design — recheck invocation must be implemented before the B2B Search endpoint can be considered production-ready.

---

## How rechecks work in 12go

### The trip_pool database and the price validity flag

12go's search is backed by `trip_pool`, a database table that stores pre-fetched trip availability per route and date. When a search query hits the F3 search stack, `SearchService::newSearch()` returns a `Search` component that calls `searchWithRecheckUrls()` (defined in `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/TripSearch/Component/Search.php`, line 145). This method first executes `searchWithoutRecheckUrls()` — a direct query against `trip_pool` — and returns whatever data is currently there.

For trips whose pricing data is stale or unvalidated, the price-binary subsystem sets `priceIsValid = false` on the `TravelOption`. The `RecheckBuilder::build()` method (in `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/TripSearch/Service/RecheckBuilder.php`, line 97) scans the returned trips: for each `TravelOption` where `getPriceIsValid()` returns `false`, it adds the trip to a `RecheckCollection`. The `RecheckCollection` groups items by integration+route key into three buckets: regular trips (`items`), manual packs (`manualPacks`), and auto-packs (`autoPacks`).

### How recheck URLs are generated

After `searchWithoutRecheckUrls()` and `RecheckBuilder::build()`, `Search::searchWithRecheckUrls()` calls `Rechecker::getRecheckUrls()` (defined in `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/TripSearch/Service/Rechecker.php`, line 115). For each group in `RecheckCollection::items`, this method generates a URL pointing to the internal `/searchr` (route name `recheck`) endpoint, parameterised with station IDs, date, seats, integration ID, agent, currency, visitor ID, and the origin search URL. Manual packs generate `/searchpm` URLs (route `recheck_pack_manual`) and auto-packs generate `/recheckpa` URLs (route `recheck_pack_auto`). The `recheckDomain` is configured separately from the current domain — `initDomain()` and `deinitDomain()` temporarily swap the router context host to the recheck subdomain.

The resulting array of URLs is assigned to `SearchResultsInterface::recheckUrls`. Both `SearchResultApiV1` and `SearchResultFullApiV1` hold this as a public `array $recheckUrls` field, serialised as the top-level `"recheck"` key in the JSON response (see `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/TripSearch/DTO/ApiV1/SearchResultFullApiV1.php`, line 29, and `SearchResultApiV1.php`, line 27). The F3 `SearchController` for the public API sets a `Token` response header when `recheckUrls` is non-empty (`/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/Controller/ApiV1/SearchController.php`, line 169–170).

### What the recheck endpoint does when called

When a recheck URL is called, it reaches `RecheckController::recheckAction()` (route `/searchr`, defined in `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/Controller/ApiV1/RecheckController.php`, line 50). That action calls `Rechecker::recheckAndHandle()` (line 407 in `Rechecker.php`). This method:

1. Checks whether the integration allows rechecks (`IntegrationManager::getAllowRechecks()`).
2. Uses a cache key (MD5 of integration+stations+date+seats) with a semaphore-like guard (`pool` cache item value = 1 while in-flight, = 2 when done) to deduplicate concurrent recheck calls for the same parameters (lines 527–563 in `Rechecker.php`).
3. If a fresh call is needed, invokes `IntegrationProxy::getTripsList()`, which calls the actual supplier integration to fetch live availability.
4. Passes the result to `AvailableResultHandler::handle()`, which writes the fresh availability data back into `trip_pool`.
5. If existing trips are no longer returned by the supplier, marks them with `availableSeats = 0` and `PriceReason::REASON_TRIP_NOT_BOOKABLE` via `TripPoolPriceManager::collectPrice()` (lines 663–691 in `Rechecker.php`).
6. Returns a `RecheckResult` with the updated trip keys.

When the `out=keys` query parameter is present (appended by `Rechecker::recheckByUrls()` at line 340), the response body is a JSON array of string trip keys. Otherwise the full search result for those trips is returned.

### How recheck URLs are synchronously consumed within F3

For some internal use cases (e.g., the syncer, the `?r=1` round-trip path in `SearchController`), F3 calls its own recheck URLs synchronously using `Rechecker::recheckByUrls()` (line 328 of `Rechecker.php`). This method creates a `GuzzleHttp\Client` with `connect_timeout` of 30 seconds and `timeout` of 60 seconds (`RECHECK_CONNECT_TIMEOUT` and `RECHECK_TIMEOUT` class constants), sends async POST requests to all recheck URLs in parallel using Guzzle promises (`GuzzleHttp\Promise\Utils::settle()`), and collects the returned trip keys. Errors from individual requests are logged via `Logger::bug()` but do not abort the collection (line 358). The trip keys from all successful responses are merged and returned as a `RecheckManyResult`.

---

## Current .NET implementation

### OneTwoGoRecheckManager

The current system calls recheck URLs through `OneTwoGoRecheckManager`, defined in:

[integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/Tools/OneTwoGoRecheckManager.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/Tools/OneTwoGoRecheckManager.cs)

The implementation is:

```csharp
public bool DoRechecksIfNeeded(string[] rechecks)
{
    if (rechecks is { Length: > 0 })
    {
        foreach (var rcUrl in rechecks)
        {
            Task.Run(async () =>
            {
                await httpConnector.SendAsync(new HttpRequestMessage(HttpMethod.Get, rcUrl));
            });
        }
        return true;
    }
    return false;
}
```

Each recheck URL is dispatched as an independent `Task.Run` task. The task is not awaited and not stored — it is fire-and-forget. There is no result handling, no logging, and no error handling. If a recheck request fails, the failure is silently discarded. The `IHttpConnector` used here is the integration-scoped `HttpClientConnector` from the SI framework (registered via `AutofacSiServiceProvider`, [abstractions/SupplyIntegration/AutofacSiServiceProvider.cs](https://github.com/boost-platform/supply-integration/blob/main/abstractions/SupplyIntegration/AutofacSiServiceProvider.cs), line 59–61).

`OneTwoGoRecheckManager` is registered as a transient service in the SI search module's `ConfigureServices` (line 27 of [integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/ConfigureServices.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/ConfigureServices.cs)) and is injected into `OneTwoGoSearchSupplier`.

### How it is called in the search flow

`OneTwoGoSearchSupplier.FetchIntegrationDataForRoute()` (in [integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/OneTwoGoSearchSupplier.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Search/OneTwoGoSearchSupplier.cs), line 34) calls `IOneTwoGoApi.Search()`, which hits `GET /search/{fromProvinceId}p/{toProvinceId}p/{date}?seats={n}&direct=True`. The API response is deserialized into `OneTwoGoSearchResponse` ([integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Endpoints/Search/OneTwoGoSearchResponse.cs](https://github.com/boost-platform/supply-integration/blob/main/integrations/onetwogo/SupplyIntegration.OneTwoGo.Common/Api/Endpoints/Search/OneTwoGoSearchResponse.cs)), which has a `string[] Recheck` field (`[JsonPropertyName("recheck")]`, line 24).

Immediately after the API call returns, `recheckMgr.DoRechecksIfNeeded(apiResp.Recheck)` is called (line 45 of `OneTwoGoSearchSupplier.cs`). If that method returns `true` (meaning rechecks were present and fired), `base.MarkSearchIncomplete()` is called (line 47), setting `ctx.IsSearchIncomplete = true` on the current search context (`SearchSupplierBase.cs`, line 40–46). This flag propagates upward: the SI host returns a response that causes etna's `EtnaSearchProcessorService` to classify those routes as `PotentialItineraries`, which sets `PipelineResult.HasPotentialItineraries = true` (line 88 of [api/Etna.Search.Api.Service/Services/Implementation/EtnaSearchProcessorService.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api.Service/Services/Implementation/EtnaSearchProcessorService.cs)). `ItinerariesController` then returns `206 Partial Content` (line 63 of [api/Etna.Search.Api/Controllers/ItinerariesController.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Controllers/ItinerariesController.cs)) when the `ReturnPartialResultsStatus` feature flag is enabled.

### The 12GoRechecks named HTTP client (etna)

Etna configures a dedicated named HTTP client for recheck requests in `ConfigurationExtension.cs` ([api/Etna.Search.Api/Shared/ConfigurationExtension.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Shared/ConfigurationExtension.cs)):

- Name: `12GoRechecks` (line 124)
- `Timeout = Timeout.InfiniteTimeSpan` on the underlying `HttpClient` (line 128); the actual timeout is controlled by the Polly policy
- `HandlerLifetime = 10 minutes` (line 130)
- Polly policy `12goRecheckTimeoutPolicy`: configurable timeout from `One2GoApiConfiguration.RecheckTimeout`, defaulting to 5 minutes (lines 51–52; and `One2GoApiConfiguration.cs`, line 15)
- `OneTwoGoRecheckCacheHandler` delegating handler (line 132): caches the HTTP response for a configurable interval (`RecheckCacheTimeInterval`, default 15 seconds, line 44 of [OneTwoGoRecheckCacheHandler.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.ApiModels/Models/OneTwoGoRecheckCacheHandler.cs)) using `IMemoryCache` with a semaphore to prevent thundering herd on the same URL
- Throttle policy `12goThrottlePolicy`: rate-limiting (line 133)

This named client is separate from the `12GoHttpApi` client (which has a short 10-second timeout and retry policy). The separation allows rechecks to run with a much longer timeout without affecting regular API calls.

### Error handling

There is no error handling in `OneTwoGoRecheckManager.DoRechecksIfNeeded()`. Failed tasks are discarded. The `OneTwoGoRecheckCacheHandler` has a post-eviction callback that disposes the cached response and logs the eviction reason at Debug level (line 82–86 of `OneTwoGoRecheckCacheHandler.cs`), but there is no retry on failure and no alerting.

---

## Impact of missing rechecks

> The scenarios below describe what **would** happen if rechecks are not implemented in the final migration — they are documented to inform the design, not to characterize the current PoC (which is known to be incomplete).

### trip_pool stays stale

When recheck URLs are not called, `IntegrationProxy::getTripsList()` is never invoked for the trips in question. The `trip_pool` rows for those trips retain their existing price and seat data, with `priceIsValid = false`. On subsequent searches against the same route and date, the same trips appear with `"approximate": true`.

### The 206 contract is broken from the consumer side

The current B2B API contract specifies that `206 Partial Content` means results are available but some routes are still loading. The client is expected to handle 206 by waiting and re-querying. In the POC B2B Search controller at `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Controller/SearchController.php` (line 64–67), a `206` status is returned whenever `getRecheckUrls()` is non-empty. However, the controller does not call those URLs. The subsequent search, if retried by the client, will return another `206` for the same routes indefinitely — because the data in `trip_pool` has not changed.

### Trips with `priceIsValid = false` remain in results

In the existing F3 search pipeline, when `searchWithRecheckUrls()` is called with a non-zero `recheckAmount`, `Rechecker::recheckSearchResults()` (line 305 of `Rechecker.php`) is invoked first. It fires recheck URLs synchronously (via the Guzzle parallel-promise path), waits for results, and updates the search result set before building the final response. In the POC B2B controller, `searchWithRecheckUrls()` is called (line 60 of `B2bApi/Controller/SearchController.php`), but the `SearchFilter` is built without setting `recheckAmount`, so the inline recheck is skipped. The resulting response will include trips with `"approximate": true` in the payload.

### Availability is never resolved for new or scanned integrations

In addition to trips already in `trip_pool`, the F3 search pipeline can emit "scan" URLs for integrations that have never been queried for a given route. These are generated by `Rechecker::getSearchUrls()` (line 223 of `Rechecker.php`) and appended to the recheck URL list. Without calling these URLs, new integrations will never be populated for the route.

---

## POC limitation note

> **Important context:** The B2B Search controller at `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Controller/SearchController.php` is a **work-in-progress proof of concept** — temporary, exploratory code that is known to be incomplete. The gaps described below (missing recheck invocation, infinite 206 loops, stale trip_pool) reflect the current state of this throwaway PoC, **not** a design flaw in the migration approach. No architectural conclusions should be drawn from its implementation.

The POC plan (`/Users/sosotughushi/RiderProjects/transition-design/design/poc-plan.md`) identifies the recheck flow as an explicit open question. Under section "What to Observe", item 7 reads:

> **206 Partial Content** — How does 12go's `recheck` array flow through? Is there existing support?

The POC scope section specifies that `206 Partial Content for recheck` is a required contract convention (item 5 in the Scope list), but classifies it as something to "implement" rather than something that has been implemented.

The runbook for F3 local development (`/Users/sosotughushi/RiderProjects/transition-design/runbooks/run-f3-locally.md`, line 125) documents `206 Partial Content` as meaning "Partial results; recheck URLs present in response" — confirming that the status code is emitted by the POC controller — but the runbook makes no mention of the recheck URLs being consumed.

The transition complexity document (`/Users/sosotughushi/RiderProjects/transition-design/current-state/cross-cutting/transition-complexity.md`, line 261) explicitly notes the open problem:

> **206 Partial Content** | Returned when 12go search has `recheck[]` entries | Must detect recheck and return 206 with polling mechanism

The POC B2B Search controller at `/Users/sosotughushi/RiderProjects/12go/docker-local-env/frontend3/src/B2bApi/Controller/SearchController.php` correctly detects the presence of recheck URLs and sets the `206` status (lines 64–68), but contains no mechanism to invoke those URLs. There is no background task infrastructure, no queue, no second call to `recheckByUrls()`, and no deferred HTTP client in the B2B controller path. The recheck URL list is constructed and immediately discarded after the status code is set.

ST-2432 is the Jira ticket tracking this gap. The description notes that the recheck mechanism is a known limitation of the current POC implementation and that it must be resolved before the B2B Search endpoint can be considered production-ready.

---

## Reference Update Summary

All local absolute file paths in this document have been replaced with GitHub `blob/main/` URLs. 7 GitHub URL references were added, covering source files in the `supply-integration` and `etna` repositories:

- `supply-integration`: `OneTwoGoRecheckManager.cs`, `OneTwoGoSearchSupplier.cs`, `OneTwoGoSearchResponse.cs`, `ConfigureServices.cs` (onetwogo search module)
- `etna`: `EtnaSearchProcessorService.cs`, `ItinerariesController.cs`, `ConfigurationExtension.cs` (named HTTP client setup)

References to `frontend3` (12go PHP codebase) were already in their existing inline format referencing the local path and were not changed, as `frontend3` does not map to any of the four `boost-platform` GitHub repositories. No references were left unconverted for the boost-platform repos.

---

## Meeting Insights (2026-03-12)

Source: Soso / Shauly 1-on-1 (timestamps 00:46:20 – 00:48:13)

### Confirmed Known Gap (Beyond PoC)

Shauly confirmed the recheck mechanism is a known gap not just in the PoC but in the **current TC system** as well. The existing fire-and-forget recheck implementation is inadequate: "I think that it's not good enough."

### Trip Pool Issues

Recent problems with trip pool behavior and how it gets populated. **Levan** has been investigating these issues. The internals of how the trip pool works are not well understood by the TC team.

### Ownership and Resolution

- Hope that **Sana** will provide a good solution on the 12go side
- Unknown who will implement the fix
- Shauly: "this is a gap that we currently also have right now in TC"
