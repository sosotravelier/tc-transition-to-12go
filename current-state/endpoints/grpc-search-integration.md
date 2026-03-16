# Migration Issue: gRPC Search Integration (Google Metasearch)

## Summary

The etna search API exposes a gRPC endpoint (`EtnaSearchGrpcService`) that serves search results to the Google Metasearch integration. This is a dedicated gRPC transport layer built on top of the same search pipeline used by the REST API. During the transition to 12go, this integration must be accounted for — either by preserving the gRPC interface or by migrating Google Metasearch to use 12go's search capabilities directly.

---

## Current Architecture

### gRPC Server

- **Service:** `EtnaSearchGrpcService` in [api/Etna.Search.Api/Services/EtnaSearchGrpcService.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Services/EtnaSearchGrpcService.cs)
- **Proto:** [api/Etna.Search.Api/Protos/search.proto](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Protos/search.proto)
- **Single RPC method:** `Search(SearchRequestMessage) → SearchResponseMessage`
- **Framework:** Grpc.AspNetCore v2.61.0 on .NET 8.0
- **Auth:** `[AllowAnonymous]` — no authentication at gRPC level; relies on network isolation and API Gateway

### gRPC Client (Consumer)

- **Google Metasearch service** in [google-metasearch/provider/search/Services/Implementation/GrpcService.cs](https://github.com/boost-platform/etna/blob/main/google-metasearch/provider/search/Services/Implementation/GrpcService.cs)
- Connects via HTTP/2 with keep-alive pings (60s delay, 30s timeout)
- SSL verification disabled (internal network)
- Configured via `EtnaSearchGrpcOptions` (BaseUrl + path suffix)

### Request/Response Contract

**Request fields:**
- `client_id` (required), `departure_date`, `pax`, `travelier_version`
- Station IDs (`departures`, `arrivals`) and/or POI strings (`departure_poi`, `arrival_poi`)
- Optional: `return_date`, `confidence_score`, `pax_ages`, `locale`, `currency`, `cache_only`, `timeout_seconds`, `x_api_experiment`

**Response fields:**
- `vehicles` — vehicle types with seat classes, amenities, images
- `segments` — trip segments with stations, times, transportation types
- `itineraries` — complete trips with pricing, cancellation policies
- `has_potential_itineraries` — flag for client retry logic

### Processing Pipeline

The gRPC service delegates to `IEtnaSearchProcessorService.Process()`, which runs the full search pipeline:
1. Search type classification (by station, POI, or mixed)
2. Search execution via `IExperimentExecutor` (MediatR behavior pipeline)
3. Timeout-based retry for potential itineraries
4. Response building with vehicle enrichment and feature flag filtering
5. Per-client 12go API key lookup from AWS AppConfig (`Connector / GeneralConfiguration`)

---

## Migration Concerns

### 1. Google Metasearch Must Continue to Receive Search Results

Google Metasearch is an active integration. During and after migration, it must continue to receive search results in a compatible format. Options:
- **Keep the gRPC interface** and point it at 12go's search backend
- **Migrate Google Metasearch** to call 12go's search API directly (if 12go supports a compatible protocol)
- **Maintain a translation layer** that converts between the current proto contract and 12go's response format

### 2. Proto Contract Compatibility

The proto definition includes fields and nested structures (vehicles with seat classes, segments with transportation types, itineraries with cancellation policies) that map to the current TC/etna search response model. If 12go's search response has different field names, structures, or semantics, the proto mapping layer must be updated.

### 3. Client ID and Distributed Context

- `client_id` is a required field in the proto request and is propagated via `IConnectContextAccessor` for per-client feature flags and API key lookup
- The gRPC interceptor adds distributed tracing context (`Flow` from `Activity.Current` trace ID)
- See: [api-key-transition.md](api-key-transition.md)

### 4. Authentication Model

The gRPC service currently has no authentication (`[AllowAnonymous]`), relying entirely on network isolation. Post-migration, the authentication model for this endpoint needs to be defined — especially if the service moves to a different network boundary.

### 5. Timeout and Retry Behavior

The search processor implements configurable timeout-based retry for "potential itineraries" (incomplete results). This retry logic is specific to the current search pipeline and may not have an equivalent in 12go's search. The latency profile of search responses could change.

---

## Key Files

| Component | File |
|---|---|
| gRPC service implementation | [api/Etna.Search.Api/Services/EtnaSearchGrpcService.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Services/EtnaSearchGrpcService.cs) |
| Proto definition | [api/Etna.Search.Api/Protos/search.proto](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Protos/search.proto) |
| Search processor service | [api/Etna.Search.Api.Service/Services/Implementation/EtnaSearchProcessorService.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api.Service/Services/Implementation/EtnaSearchProcessorService.cs) |
| gRPC startup configuration | [api/Etna.Search.Api/Program.cs](https://github.com/boost-platform/etna/blob/main/api/Etna.Search.Api/Program.cs) (lines 82–107, 175–176) |
| Google Metasearch gRPC client | [google-metasearch/provider/search/Services/Implementation/GrpcService.cs](https://github.com/boost-platform/etna/blob/main/google-metasearch/provider/search/Services/Implementation/GrpcService.cs) |
| gRPC client config | [google-metasearch/provider/search/EtnaSearchGrpcOptions.cs](https://github.com/boost-platform/etna/blob/main/google-metasearch/provider/search/EtnaSearchGrpcOptions.cs) |

---

## Open Questions

1. Does 12go have an existing search API that Google Metasearch could consume directly?
2. Is gRPC a requirement for Google's integration, or can it be replaced with REST?
3. What is the expected search response latency SLA for Google Metasearch?
4. Should this gRPC endpoint be maintained as a thin translation layer during the transition period?
