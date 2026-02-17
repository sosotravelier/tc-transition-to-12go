---
status: draft
last_updated: 2026-02-17
---
# Caching Strategy

## Current State

The system uses multiple caching layers across services, each serving different purposes and using different technologies:

| Cache Layer | Technology | Service | Scope | TTL |
|---|---|---|---|---|
| HybridCache | Microsoft.Extensions.Caching.Hybrid | Supply-Integration | Per-integration, distributed + local | 3 days (trip), 3 hours (schema) |
| MemoryCache (SI) | Microsoft.Extensions.Caching.Memory | Supply-Integration | Per-integration, local only | Varies by usage |
| DynamoDB Cache Tables | AWS DynamoDB with TTL | Denali booking-service | Cross-service | 5 days (7200 min default) |
| MemoryCache (Index Search) | Microsoft.Extensions.Caching.Memory | Etna search-engine | Process-local, size-limited | 1 day (configurable) |
| MemoryCache (Station Mapping) | Microsoft.Extensions.Caching.Memory | Etna supplier-integration | Process-local, per-integration | Configurable (hours), 10 min refresh check |

## Cache Layers

### HybridCache (Supply-Integration)

**Implementation:** `SiHybridCache` wrapping `Microsoft.Extensions.Caching.Hybrid.HybridCache`

`SiHybridCache` is a decorator around the standard `HybridCache` that:
1. **Prefixes all keys and tags** with the `integrationId` to namespace caches per integration
2. **Records metrics** for cache writes via `ISiCacheMetrics` (tracking local vs. distributed writes)

The underlying `HybridCache` provides a two-tier cache:
- **L1 (local):** In-process memory cache
- **L2 (distributed):** Configurable distributed cache backend (typically Redis)

**Extension methods:**
- `GetOrCreateLocal<T>()` — local-only cache (disables distributed cache via `HybridCacheEntryFlags.DisableDistributedCache`)
- `GetOrCreate<T>()` — both local and distributed with same expiration

**Consumers:**

#### OneTwoGoCache

**Implementation:** `OneTwoGoCache` in `SupplyIntegration.OneTwoGo.Common`

| Cache Key | Data | TTL | Purpose |
|---|---|---|---|
| `{productId}` | `OneTwoGoCachedTripData` (Price, OperatorId) | **3 days** | Caches trip pricing and operator data from search results. Used to avoid re-fetching trip details during booking. |
| `"schema" + {productId}` | `Dictionary<string, string>` (NameToSupplierName) | **3 hours** | Caches booking schema field name mappings. Shorter TTL because schema can change. |

**Read/Write pattern:** `GetOrCreate` for trip data (lazy initialization), `SetAsync` for explicit writes after search. Schema fields saved explicitly during pre-booking.

**Why it exists:** SI calls the supplier (OneTwoGo/12go) for search results. The trip data (price, operator) is cached so subsequent booking steps don't need to re-query. The schema mapping is cached because it's expensive to compute.

#### SiMemoryCache

**Implementation:** `SiMemoryCache` wrapping `IMemoryCache`

A decorator that:
1. Prefixes keys with `{integrationId}|` for namespace isolation
2. Asserts keys are always strings
3. Records write metrics

Used by various SI integration modules for short-lived local caching of data that doesn't need distributed access.

#### SiMemoryCacheExtensions

**Utility:** `GetOrCreateLazyAsync<T>()` — wraps cache entries in `Lazy<Task<T>>` to ensure the factory is executed only once per key even under concurrent access. Failed entries are automatically removed to allow retry.

### MemoryCache (Etna Search)

#### IndexSearchBehaviour

**Implementation:** `IndexSearchBehaviour` in `etna.searchengine`

**Cache key format:** `/indexSearch/{fromStation}/{toStation}/{departureDate:O}/{contract}`

**Cache entry options:**
- `AbsoluteExpirationRelativeToNow`: `SearchEngineOptions.IndexCacheExpirationTime` (default: **1 day**)
- `Size`: 1100 (estimated bytes per entry, used for size-limited cache)

**Behavior:**
- **Normal fidelity:** Uses `cache.GetOrCreate()` with `Lazy<Task<List<IndexItinerary>>>` wrapping. Multiple concurrent requests for the same route share a single database query.
- **High fidelity:** Always fetches fresh data and replaces the cache entry. Used for premium/real-time search requests.
- **Empty results:** Removed from cache immediately to allow retries (avoids caching "no results" scenarios).

**Data source:** `ISearchIndexReader.QueryIndex()` — reads from DynamoDB itinerary index.

**Why it exists:** The search engine processes many routes per request (fan-out). Caching index results prevents redundant DynamoDB queries for the same from/to/date/contract combination across concurrent requests.

#### Size-Limited Cache Configuration

The `IMemoryCache` used by `IndexSearchBehaviour` is registered with `[FromKeyedServices(ServiceKeys.SizeLimitedCache)]`, indicating it has a configured `SizeLimit`. Each entry claims `Size = 1100`. This prevents unbounded memory growth during search fan-out.

### DynamoDB Cache Tables (Denali)

The DynamoDB tables in Denali booking-service serve as **persistent caches** for the booking funnel. They are documented in detail in `data-storage.md`. From a caching perspective:

#### ItineraryCache

| Aspect | Detail |
|---|---|
| **What's cached** | Full itinerary data from SI search results (segments, vehicles, pricing) |
| **TTL** | 7200 minutes (5 days) from creation |
| **Cache key** | Itinerary ID |
| **Invalidation** | TTL-based only (DynamoDB automatic deletion) |
| **Why it exists** | Persists search results across the booking funnel steps. User may take hours/days between searching and booking. |

#### PreBookingCache

| Aspect | Detail |
|---|---|
| **What's cached** | Booking schema (form fields), field name mappings, locked seats |
| **TTL** | 7200 minutes (5 days) from creation |
| **Cache key** | BookingToken |
| **Invalidation** | TTL-based only |
| **Why it exists** | Persists the pre-booking context (what fields to show, how to map them) across the user's form-filling session |

#### BookingCache

| Aspect | Detail |
|---|---|
| **What's cached** | Full booking state: pricing, status, passenger data, credit state |
| **TTL** | 7200 minutes (5 days) from creation |
| **Cache key** | BookingId |
| **Invalidation** | TTL-based. Also has `ConfirmationDeadLine` (1440 min = 24h) for business logic |
| **Why it exists** | This is more than a cache — it's the **funnel state store**. It tracks the booking through Reserved → Confirmed → Cancelled states. Cross-service: read by post-booking-service. |

#### IncompleteResults

| Aspect | Detail |
|---|---|
| **What's cached** | Async operation results (for polling-based confirm/cancel) |
| **TTL** | 15 hours (configurable via `AsyncProcess:IncompleteResultsTTLInHours`) |
| **Cache key** | Operation ID |
| **Invalidation** | TTL-based only |

### MemoryCache (Station Mapping — Etna)

#### WebHostStationMappingCache

**Implementation:** `WebHostStationMappingCache` in `Etna.Search.SupplierIntegration.Host`

**Purpose:** Caches the full station mapping lookup for each integration at startup and refreshes periodically. This is a **warm cache** — the service won't start accepting requests until all integrations are cached.

**Cache key format:** `stationIdCache-{integrationId}`

**Lifecycle:**
1. **Startup:** `InitializeCache()` fetches all station mappings for all configured integrations in parallel. Fails fast if any integration fails.
2. **Background refresh:** Every **5 minutes** (`CacheExpirationCheckInterval`), checks if any integration's cache is within **10 minutes** (`CacheRefreshThreshold`) of expiration and proactively refreshes it.
3. **Expiration:** `cacheExpirationInHours` (constructor parameter, configurable).
4. **Failure handling:** If background refresh fails, the host application is stopped (`hostApplicationLifetime.StopApplication()`) to force a restart with fresh cache.

**Data fetched:** `StationMappingsLookup` — a lookup structure indexed by integration station ID, fetched page-by-page from the Fuji station mapping API.

**Why it exists:** Station mapping is needed for every search request to translate between integration-specific station IDs and CMS station IDs. Fetching on every request would be too slow. The entire mapping set is loaded into memory.

**Metrics:**
- `station_fetch_failures` — counter by integration ID and status code
- `station_fetched_count` — counter of stations fetched per integration
- `station_fetch_duration` — timer by integration ID

## Per-Cache Analysis

### Redundancy Map

```
Search Results:
  12go MySQL/Redis  ←→  SI HybridCache (trip data)  ←→  DynamoDB ItineraryCache
                         ↕
                    Etna IndexSearch MemoryCache

Booking Schema:
  12go API          ←→  SI HybridCache (schema fields)  ←→  DynamoDB PreBookingCache

Booking State:
  12go MySQL        ←→  DynamoDB BookingCache  →  PostgreSQL BookingEntities

Station Mappings:
  Fuji DynamoDB     ←→  Etna Station Mapping MemoryCache
```

### Overlap Analysis

| Data | Cached In | Also Stored In | Redundant? |
|---|---|---|---|
| Trip price/operator | SI HybridCache | 12go Redis, DynamoDB ItineraryCache | Yes — triple-cached |
| Booking schema | SI HybridCache | DynamoDB PreBookingCache | Yes — double-cached |
| Index itineraries | Etna MemoryCache | DynamoDB itinerary index | Expected (read cache) |
| Station mappings | Etna MemoryCache | Fuji DynamoDB | Expected (read cache) |
| Booking state | DynamoDB BookingCache | 12go MySQL | Yes — but serves different purposes |

## 12go Caching

### Redis
- **Search results:** Cached supplier search responses. Equivalent to SI HybridCache trip data + Etna index cache.
- **Session/funnel state:** May overlap with DynamoDB BookingCache.
- **General key-value cache:** Various operational caches.

### MySQL
- **Bookings:** Authoritative booking records. Equivalent to PostgreSQL BookingEntities.
- **Operators/stations:** Master data that Fuji DynamoDB maps to.

### Key difference
12go's caching (Redis) is a **unified layer** serving the entire platform. The current architecture has **fragmented caching** across multiple services, each with its own technology and TTL strategy.

## Transition Considerations

### 1. Eliminate DynamoDB Booking Funnel Caches

The ItineraryCache, PreBookingCache, and BookingCache tables can potentially be eliminated if:
- The booking funnel passes sufficient context in each API call (stateless approach)
- OR 12go's Redis/MySQL is used as the state store

**Risk:** BookingCache is not purely a cache — it's a state machine. The `BookingFunnelStatus` and `CreditStatus` transitions need careful handling.

### 2. Consolidate Search Caching

Currently search results are cached in three places:
1. SI HybridCache (trip data, 3 days)
2. DynamoDB ItineraryCache (full itinerary, 5 days)
3. Etna IndexSearch MemoryCache (index itineraries, 1 day)

If proxying through 12go, only the Etna index cache may need to remain (or be replaced by 12go's Redis).

### 3. Station Mapping Cache Strategy

The `WebHostStationMappingCache` pattern (load-all-at-startup, periodic refresh) is effective but creates startup latency. Options:
- Keep as-is (it works well)
- Move to 12go's station service with local caching
- Use a distributed cache (Redis) shared across Etna instances

### 4. HybridCache Migration Path

SI's `SiHybridCache` is the most modern caching implementation. If SI remains as a layer:
- Keep HybridCache for integration-specific caching
- Remove DynamoDB caches that duplicate HybridCache data

If SI is absorbed into 12go:
- HybridCache functionality moves to 12go's Redis layer

### 5. TTL Alignment

Current TTL inconsistencies:
- Trip data: 3 days (HybridCache) vs. 5 days (DynamoDB ItineraryCache)
- Schema fields: 3 hours (HybridCache) vs. 5 days (DynamoDB PreBookingCache)
- Index search: 1 day (Etna MemoryCache)
- Station mappings: configurable hours with 10-min refresh check

Any consolidation should standardize TTLs based on data freshness requirements.

## Open Questions

1. **Can the booking funnel be made stateless?** If each step carries enough context (e.g., signed tokens), can we eliminate all funnel caches?
2. **What is 12go's Redis cache TTL for search results?** Need to compare with current 3-day/5-day TTLs.
3. **Is SI HybridCache backed by Redis in production?** The L2 distributed backend configuration determines whether it survives pod restarts.
4. **How does station mapping refresh work with multiple Etna instances?** Each instance fetches independently — is there thundering herd risk on the Fuji API?
5. **What is the memory footprint of Etna's size-limited index cache?** With `Size=1100` per entry, what's the configured `SizeLimit`?
6. **Does the high-fidelity search path (bypassing cache) create significant extra load on DynamoDB?** How often is it triggered?
7. **Should IncompleteResults move to a queue/event-based pattern?** The current polling approach (store result, client polls) is inherently cache-like. An event-driven approach would eliminate this table.
