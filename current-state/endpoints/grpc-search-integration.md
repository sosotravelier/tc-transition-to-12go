# Migration Issue: gRPC Search Integration (Google Metasearch)

## Summary

The etna search API exposes a gRPC endpoint (`EtnaSearchGrpcService`) that serves search results to the Google Metasearch integration. This is a dedicated gRPC transport layer built on top of the same search pipeline used by the REST API. During the transition to 12go, the gRPC interface must be preserved with the same contract — Google Metasearch requires gRPC with these proto definitions and cannot migrate to a different protocol or API.

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

### 1. gRPC Interface Must Be Preserved

Google Metasearch requires the gRPC interface with the existing proto contract. The migration strategy is to point the gRPC endpoint at 12go's search backend while maintaining the same request/response schemas. No protocol migration or API redesign is acceptable.

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

1. Does 12go's search API produce the same response structure (vehicles, segments, itineraries with pricing/policies), or does a translation layer need to be built?
2. What is the expected search response latency SLA for Google Metasearch, and how does 12go's search latency compare?
3. Should the gRPC endpoint initially remain on etna, or should it be moved to run alongside 12go's infrastructure?
