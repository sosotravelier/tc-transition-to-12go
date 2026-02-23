---
status: draft
last_updated: 2026-02-23
---

# TypeScript/Node.js Language Exploration

## Why TypeScript (and Why Not)

### Why TypeScript

TypeScript is the optimal choice for this transition project for several strategic reasons:

**1. AI-First Development Advantage**
- TypeScript has the largest training corpus in AI code generation tools (Cursor, Claude, GitHub Copilot)
- AI models achieve 70-82% accuracy on TypeScript code generation, comparable to Python but with better structural type safety
- The type system provides rich context for AI tools to understand code relationships and generate correct implementations
- Largest ecosystem of AI-generated code examples and patterns available

**2. Team Alignment**
- The team has 12+ years of .NET experience; TypeScript shares significant syntax and patterns with C#
- Both languages created by Anders Hejlsberg (Microsoft) — similar design philosophy
- Familiar concepts: `async/await`, generics, interfaces, enums, union types, decorators (NestJS)
- TypeScript's structural typing is less strict than C#'s nominal typing, but compile-time guarantees are still strong
- Learning curve is estimated at 2-4 weeks for productive contribution vs 8-12 weeks for PHP

**3. Type Safety for API Contracts**
- Compile-time type checking ensures request/response shapes match documented contracts
- Type inference reduces boilerplate while maintaining safety
- TypeScript's structural type system maps naturally to JSON API contracts
- Can generate types from OpenAPI specs using `openapi-typescript` or `swagger-typescript-api`

**4. Async/Await Model**
- Native `async/await` syntax identical to C# — no mental model shift
- Node.js event loop is ideal for I/O-bound proxy operations (HTTP calls to 12go)
- No thread management complexity — single-threaded event loop handles concurrency naturally
- Promise-based error handling aligns with C# Task patterns

**5. Ecosystem Maturity**
- Largest package ecosystem (npm) with mature libraries for HTTP clients, validation, logging, tracing
- Strong OpenTelemetry support for Datadog integration
- Production-proven frameworks (NestJS, Fastify) with extensive documentation
- Active community and Stack Overflow coverage

**6. Strategic Positioning**
- TypeScript doesn't align with 12go's PHP stack, but provides better developer experience than PHP for .NET developers
- If 12go migrates to Go in the future, TypeScript services can coexist (both are stateless HTTP proxies)
- TypeScript's type system provides stronger guarantees than PHP's dynamic typing
- Better tooling (IDE support, debugging, refactoring) than PHP

### Why Not Other Languages

**PHP (12go's stack):**
- Team has zero PHP experience — 8-12 week learning curve
- Dynamic typing makes API contract preservation error-prone
- Less mature AI tooling support compared to TypeScript
- Different async model (ReactPHP vs native async/await)
- Team preference against PHP (per constraints)

**Go:**
- 12go is considering Go but nothing decided — premature to adopt
- Steeper learning curve for .NET developers (different paradigms: no classes, explicit error handling)
- Smaller AI code generation corpus
- Overkill for a stateless HTTP proxy (Go excels at systems programming)

**C#/.NET:**
- Would require maintaining .NET infrastructure separate from 12go's PHP infrastructure
- DevOps overhead for separate deployment pipelines
- No alignment with 12go's stack — harder to get support/advice
- Defeats the purpose of simplifying to 12go's infrastructure

## Why Not Python

Python was considered as an alternative but excluded for the following reasons:

### Async Story

**Problem:** Python's `asyncio` is functional but more complex than Node.js's native event loop.

- Python's Global Interpreter Lock (GIL) limits true parallelism for CPU-bound work, though this doesn't affect I/O-bound proxy operations
- `asyncio` requires explicit `async`/`await` keywords throughout the call chain — more boilerplate than Node.js
- Event loop management is more explicit (must create/run event loops) vs Node.js's implicit event loop
- For a stateless HTTP proxy that's primarily I/O-bound (HTTP calls to 12go), Node.js's native event loop is a more natural fit
- Python's async ecosystem is fragmented: `asyncio`, `trio`, `curio` — less standardization than Node.js

**Impact:** While Python can handle I/O-bound workloads well, Node.js's event loop is purpose-built for this use case and requires less ceremony.

### Type System

**Problem:** Python's type hints (`mypy`/`pyright`) are opt-in and less mature than TypeScript's structural type system.

- Type hints are annotations, not enforced at runtime — types can be wrong without failing until runtime
- `mypy` static analysis is slower and less integrated into the development workflow than TypeScript's compiler
- TypeScript's structural typing provides stronger compile-time guarantees for API contract preservation
- Python's dynamic nature makes it easier to introduce bugs in response transformation (e.g., accessing `response.price` when it's `response.pricing`)
- For a service that must preserve precise API contracts (13 endpoints with exact field shapes), TypeScript's compile-time type checking catches errors before deployment

**Impact:** TypeScript's type system is more suitable for maintaining backward-compatible API contracts where field names, types, and shapes must match exactly.

### Strategic Alignment

**Problem:** Python doesn't align with either the team (.NET) or 12go (PHP/Go).

- Team has zero Python experience — similar learning curve to PHP (8-12 weeks)
- No alignment with 12go's PHP stack — can't leverage 12go veterans' expertise
- TypeScript at least shares async/await patterns with C# and has the strongest AI ecosystem
- If the team must learn a new language, TypeScript provides better ROI due to AI tooling and type safety

**Impact:** TypeScript provides better strategic value: easier for .NET developers to learn, better AI support, and type safety for contract preservation.

### Framework Maturity for API Proxies

**Problem:** FastAPI is excellent, but the ecosystem for structured API translation is less mature than NestJS/Fastify.

- FastAPI is great for building APIs from scratch, but less focused on proxy/transformation patterns
- Schema validation in FastAPI (Pydantic) is excellent, but TypeScript's Zod provides similar capabilities with better type inference
- Middleware pipelines in FastAPI are less structured than NestJS's decorator-based approach or Fastify's plugin system
- TypeScript frameworks (NestJS, Fastify) have more examples of proxy/transformation patterns in production
- NestJS's dependency injection and module system maps better to .NET developers' mental models

**Impact:** TypeScript frameworks provide better patterns for the specific use case: HTTP proxy with request/response transformation, middleware pipelines, and type-safe API contracts.

### Summary: Why Not Python

Python is a capable language for API services, but for this specific project:
1. **Async complexity:** Node.js's event loop is simpler for I/O-bound proxies
2. **Type safety:** TypeScript's compile-time types are stronger for contract preservation
3. **Team alignment:** TypeScript is easier for .NET developers to learn
4. **AI tooling:** TypeScript has better AI code generation support
5. **Framework patterns:** NestJS/Fastify provide better proxy/transformation patterns

**Verdict:** Python is excluded because TypeScript provides better developer experience, type safety, and strategic alignment for this transition project.

## Framework and Runtime Choice

### Framework Comparison (NestJS vs Fastify vs Hono)

#### NestJS

**Strengths:**
- **Enterprise-grade structure:** Angular-inspired architecture with modules, controllers, services, dependency injection
- **Familiar to .NET developers:** Decorators (`@Controller`, `@Get`, `@Post`), DI container, similar to ASP.NET Core
- **TypeScript-first:** Built for TypeScript with excellent type inference
- **Rich ecosystem:** Extensive plugins for validation, logging, tracing, database (though we don't need DB)
- **Built-in OpenAPI:** Swagger/OpenAPI generation from decorators
- **Testing support:** Excellent testing utilities with dependency injection mocking

**Weaknesses:**
- **Performance overhead:** 2-3x slower than Fastify for raw throughput (22,000 req/sec vs Fastify's 46,664 req/sec)
- **Bundle size:** Larger footprint (~200KB-1MB) vs Fastify's lighter weight
- **Complexity:** More boilerplate for simple proxy operations (modules, providers, etc.)
- **Learning curve:** Steeper than Fastify for developers new to NestJS patterns

**Use Case Fit:** Best if team prioritizes structure and familiarity over raw performance. The performance difference (22K vs 46K req/sec) is still more than sufficient for our expected load.

#### Fastify

**Strengths:**
- **Performance leader:** 46,664 req/sec — fastest Node.js framework in benchmarks
- **Schema validation:** Built-in Ajv JSON schema validation with TypeScript type generation
- **Plugin architecture:** Lightweight, composable plugins (similar to Express middleware but faster)
- **Low overhead:** Minimal framework overhead, close to raw Node.js performance
- **TypeScript support:** Good TypeScript support with `@fastify/type-provider-typebox` for type-safe schemas
- **Production-proven:** Used by major companies for high-throughput APIs

**Weaknesses:**
- **Less structure:** No built-in DI container or module system — more manual organization
- **Smaller ecosystem:** Fewer plugins than NestJS (though sufficient for our needs)
- **Learning curve:** Team must learn Fastify patterns (though simpler than NestJS)

**Use Case Fit:** Best if performance is the primary concern. For a stateless proxy, Fastify's speed advantage may not matter if 12go's API is the bottleneck.

#### Hono

**Strengths:**
- **Edge-optimized:** 50-100KB bundle size, 120ms cold starts (vs 450ms for traditional frameworks)
- **Multi-runtime:** Runs on Node.js, Bun, Deno, Cloudflare Workers, Vercel Edge
- **Performance:** 36,694 req/sec — faster than NestJS, slower than Fastify
- **Minimal:** Ultra-lightweight, perfect for serverless/edge deployments
- **TypeScript-first:** Excellent type inference and type-safe routing

**Weaknesses:**
- **Less mature:** Newer framework (2022), smaller ecosystem than NestJS/Fastify
- **Edge-focused:** Optimized for edge/serverless, may be overkill for traditional deployments
- **Less structure:** No built-in DI or module system — more manual organization

**Use Case Fit:** Best if deploying to edge/serverless (Cloudflare, Vercel). For traditional EC2 deployments, Fastify or NestJS are better choices.

#### Elysia (Bun)

**Strengths:**
- **Bun-native:** Built specifically for Bun runtime — fastest benchmarks (180K+ req/sec)
- **Type-safe:** Excellent TypeScript support with type-safe routing
- **Modern:** Latest patterns and best practices

**Weaknesses:**
- **Bun dependency:** Requires Bun runtime — less proven in production than Node.js
- **Ecosystem:** Smaller ecosystem than Node.js frameworks
- **Risk:** Bun is newer (2023) — less battle-tested than Node.js

**Use Case Fit:** Not recommended — Bun runtime is too new for production-critical services.

### Runtime Comparison (Node.js vs Bun vs Deno)

#### Node.js 22 LTS

**Strengths:**
- **Proven stability:** 15+ years in production, battle-tested at scale
- **Largest ecosystem:** npm has 2+ million packages — any library we need exists
- **Team familiarity:** Most developers have some Node.js experience
- **Long-term support:** LTS releases provide 30 months of support
- **Production-ready:** Used by major companies (Netflix, LinkedIn, Uber)
- **Tooling:** Mature debugging, profiling, monitoring tools
- **OpenTelemetry:** Excellent OpenTelemetry support for Datadog

**Weaknesses:**
- **Performance:** 65,000-95,000 req/sec — slower than Bun (180K+ req/sec)
- **Package management:** npm/pnpm slower than Bun's native package manager
- **Startup time:** 60-120ms cold starts (vs Bun's 15-30ms)

**Use Case Fit:** **Recommended** — proven, stable, large ecosystem. Performance is sufficient for our proxy workload (12go API is likely the bottleneck, not Node.js).

#### Bun

**Strengths:**
- **Performance:** 180,000-245,000 req/sec — 2.5-3.6x faster than Node.js
- **Built-in TypeScript:** No transpilation step — runs TypeScript directly
- **Fast package installs:** 5-20x faster than npm (2-3 seconds vs 30-45 seconds)
- **Lower memory:** 40% less memory usage than Node.js
- **Faster cold starts:** 15-30ms vs Node.js's 60-120ms

**Weaknesses:**
- **New runtime:** Released 2023 — less battle-tested than Node.js
- **Ecosystem compatibility:** Some npm packages may not work (though compatibility is improving)
- **Production risk:** Fewer production deployments, less community support
- **Tooling:** Less mature debugging/profiling tools than Node.js
- **OpenTelemetry:** Less mature OpenTelemetry support

**Use Case Fit:** **Not recommended for initial deployment** — too new for production-critical services. Consider migrating to Bun after Node.js deployment is stable.

#### Deno 2

**Strengths:**
- **Security by default:** No file system/network access unless explicitly granted
- **Built-in TypeScript:** Runs TypeScript directly (like Bun)
- **Modern:** ES modules, top-level await, modern JavaScript features
- **Built-in tooling:** Formatter, linter, test runner included

**Weaknesses:**
- **Smaller ecosystem:** Fewer packages than npm (though npm compatibility exists)
- **Less adoption:** Fewer production deployments than Node.js
- **Learning curve:** Different module system and security model
- **OpenTelemetry:** Less mature than Node.js

**Use Case Fit:** **Not recommended** — security model is overkill for our use case, smaller ecosystem, less proven in production.

### Recommendation

**Framework: NestJS**
- **Rationale:** Team familiarity with .NET/ASP.NET Core makes NestJS's decorator-based, DI-driven architecture the easiest transition. Performance (22K req/sec) is sufficient for our proxy workload. Structure and maintainability outweigh raw performance for a team of 3-4 developers.

**Runtime: Node.js 22 LTS**
- **Rationale:** Proven stability, largest ecosystem, excellent OpenTelemetry support for Datadog. Performance is sufficient (65K-95K req/sec) — 12go's API latency will be the bottleneck, not Node.js. Bun can be evaluated after initial deployment is stable.

**Alternative Consideration:** If performance becomes a concern, Fastify can replace NestJS with minimal code changes (both use similar middleware patterns). The performance gain (46K vs 22K req/sec) may not matter if 12go API calls take 100-500ms.

## Architecture Pattern

### Layered Architecture

Following NestJS conventions, the architecture uses a layered pattern:

```
Controller Layer (HTTP handlers)
  ↓
Service Layer (business logic, transformations)
  ↓
Client Layer (12go HTTP client)
```

**Controller Layer:**
- Handles HTTP requests/responses
- Validates request parameters (using class-validator)
- Maps responses to client contract format
- Handles error responses

**Service Layer:**
- Station ID translation (Fuji → 12go)
- Response transformation (12go format → client format)
- Booking schema parsing (dynamic field extraction)
- Seat lock management (in-process store)
- Notification transformation

**Client Layer:**
- 12go HTTP client with retry/timeout/circuit breaker
- API key injection (`?k=apiKey`)
- Error mapping (12go errors → client errors)
- Request/response serialization

### Modular Organization

NestJS modules group related functionality:

```
AppModule
├── SearchModule (Search, Stations, Operators, POIs, IncompleteResults)
│   ├── SearchController
│   ├── SearchService
│   ├── StationMapperService
│   └── TwelveGoClientModule
├── BookingModule (GetItinerary, CreateBooking, Confirm, SeatLock, etc.)
│   ├── BookingController
│   ├── BookingService
│   ├── BookingSchemaMapperService
│   ├── SeatLockService (in-process store)
│   └── TwelveGoClientModule
└── NotificationModule (webhook receiver)
    ├── NotificationController
    ├── NotificationTransformerService
    └── WebhookDeliveryService
```

### Functional Transformations

Pure functions for data transformations (no side effects):

```typescript
// Pure function — easy to test, no side effects
function map12GoTripToClientItinerary(
  trip: TwelveGoTrip,
  stations: StationMap,
  version: string
): ClientItinerary {
  // Transform 12go trip to client format
  // Reverse-map station IDs (12go → Fuji)
  // Apply Travelier-Version shaping
  return { ... };
}
```

Side effects (HTTP calls, state mutations) are isolated to service classes.

### Minimal Complexity

This is a proxy service, not a complex domain:
- No business logic beyond transformation
- No database (except transient seat lock state)
- No caching (12go has Redis)
- No event publishing (except client notifications)
- Focus on HTTP proxying and response transformation

## Project Structure (directory layout)

```
booking-service/                    # or search-service/
├── src/
│   ├── main.ts                    # Bootstrap NestJS app
│   ├── app.module.ts              # Root module
│   │
│   ├── common/                    # Shared utilities
│   │   ├── decorators/
│   │   │   └── correlation-id.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   └── pipes/
│   │       └── validation.pipe.ts
│   │
│   ├── config/                    # Configuration
│   │   ├── auth.config.ts         # clientId → 12go apiKey mapping
│   │   ├── station-map.config.ts  # Fuji → 12go station ID mapping
│   │   └── twelvego.config.ts     # 12go API base URL, timeouts
│   │
│   ├── search/                    # Search module (if search-service)
│   │   ├── search.module.ts
│   │   ├── controllers/
│   │   │   └── search.controller.ts
│   │   ├── services/
│   │   │   ├── search.service.ts
│   │   │   └── station-mapper.service.ts
│   │   └── dto/
│   │       ├── search-request.dto.ts
│   │       └── search-response.dto.ts
│   │
│   ├── booking/                   # Booking module (if booking-service)
│   │   ├── booking.module.ts
│   │   ├── controllers/
│   │   │   └── booking.controller.ts
│   │   ├── services/
│   │   │   ├── booking.service.ts
│   │   │   ├── booking-schema-mapper.service.ts
│   │   │   └── seat-lock.service.ts
│   │   └── dto/
│   │       ├── create-booking-request.dto.ts
│   │       └── booking-response.dto.ts
│   │
│   ├── master-data/              # Master data module (if search-service)
│   │   ├── master-data.module.ts
│   │   ├── controllers/
│   │   │   ├── stations.controller.ts
│   │   │   ├── operators.controller.ts
│   │   │   └── pois.controller.ts
│   │   ├── services/
│   │   │   └── snapshot.service.ts
│   │   └── jobs/
│   │       └── snapshot.job.ts    # Periodic S3 snapshot generation
│   │
│   ├── notifications/             # Notification module (if booking-service)
│   │   ├── notifications.module.ts
│   │   ├── controllers/
│   │   │   └── webhook.controller.ts
│   │   ├── services/
│   │   │   ├── notification-transformer.service.ts
│   │   │   └── webhook-delivery.service.ts
│   │   └── dto/
│   │       └── webhook-request.dto.ts
│   │
│   └── twelvego/                 # 12go HTTP client module
│       ├── twelvego.module.ts
│       ├── services/
│       │   └── twelvego-client.service.ts
│       ├── models/
│       │   ├── twelvego-search-response.model.ts
│       │   ├── twelvego-booking-schema.model.ts
│       │   └── twelvego-booking-details.model.ts
│       └── utils/
│           ├── retry-strategy.ts
│           ├── circuit-breaker.ts
│           └── error-mapper.ts
│
├── test/                         # Tests
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docker/
│   └── Dockerfile
│
├── .env.example
├── nest-cli.json
├── package.json
├── tsconfig.json
└── README.md
```

## Type System Design

### API Contract Types

TypeScript types for client-facing API contracts, generated from OpenAPI specs or manually defined:

```typescript
// Client-facing request/response types
export interface SearchRequest {
  departures: string[];        // Fuji station IDs
  arrivals: string[];
  date: string;                // YYYY-MM-DD
  seats: number;
  // ... other query params
}

export interface SearchResponse {
  itineraries: Itinerary[];
  // ... contract fields
}

export interface Itinerary {
  id: string;
  segments: Segment[];
  pricing: Pricing;
  // ... contract fields
}

// Money as strings (per contract requirement)
export interface Money {
  amount: string;               // "14.60" (not number)
  currency: string;
}
```

**Versioning Support:**
```typescript
// Travelier-Version header shapes response
function shapeResponse<T>(
  data: T,
  version: string,              // "2024-01-15"
  contractVersion: string
): T {
  // Apply version-specific transformations
  // e.g., remove fields added after version date
  return applyVersionTransform(data, version, contractVersion);
}
```

### Runtime Validation (Zod/io-ts/Ajv)

**Recommendation: Zod**

Zod provides runtime validation with TypeScript type inference:

```typescript
import { z } from 'zod';

// Define schema
const SearchRequestSchema = z.object({
  departures: z.array(z.string()).min(1),
  arrivals: z.array(z.string()).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.number().int().min(1).max(10),
});

// Infer TypeScript type from schema
type SearchRequest = z.infer<typeof SearchRequestSchema>;

// Validate at runtime
function validateSearchRequest(body: unknown): SearchRequest {
  return SearchRequestSchema.parse(body);  // Throws ZodError if invalid
}
```

**Why Zod over io-ts/Ajv:**
- **Type inference:** Automatically generates TypeScript types from schemas
- **Better error messages:** Human-readable validation errors
- **Smaller bundle:** ~10KB vs io-ts's ~50KB
- **Active development:** More actively maintained than io-ts
- **NestJS integration:** Works well with NestJS validation pipes

**Alternative: Ajv (Fastify's built-in)**
- If using Fastify, Ajv is built-in and performant
- Requires separate type definitions (no automatic inference)
- More verbose schema definitions

### 12go Client Types

TypeScript types for 12go API requests/responses, ported from C# models:

```typescript
// 12go API response types
export interface TwelveGoSearchResponse {
  trips: TwelveGoTrip[];
  operators: Record<string, TwelveGoOperator>;
  stations: Record<string, TwelveGoStation>;
  classes: Record<string, TwelveGoClass>;
  recheck: string[];
}

export interface TwelveGoTrip {
  id: string;
  chunk_key: string;
  route_name: string;
  params: TwelveGoTripParams;
  segments: TwelveGoSegment[];
  travel_options: TwelveGoTravelOptions[];
}

export interface TwelveGoTravelOptions {
  id: string;
  bookable: number;
  price: TwelveGoPrice;              // decimal in JSON
  netprice: TwelveGoPrice;
  agfee: TwelveGoPrice;
  sysfee: TwelveGoPrice;
  class: number;
  ticket_type: string;
  confirmation_time: number;
  cancellation: number;
  // ... other fields
}

export interface TwelveGoPrice {
  value: number;                     // decimal from JSON
  fxcode: string;
}

// Transformation: 12go price → client money (string)
function mapPriceToMoney(price: TwelveGoPrice): Money {
  return {
    amount: price.value.toFixed(2),   // "14.60"
    currency: price.fxcode,
  };
}
```

**Booking Schema Types:**
```typescript
// 12go booking schema (flat key-value with dynamic fields)
export interface TwelveGoBookingSchemaResponse {
  // Fixed fields
  'contact[mobile]'?: FormField;
  'contact[email]'?: FormField;
  'passenger[0][first_name]'?: FormField;
  // ... other fixed fields
  
  // Dynamic fields (captured via [key: string])
  [key: string]: FormField | undefined;
}

export interface FormField {
  type: string;
  name: string;
  title: string;
  required?: boolean;
  data?: FieldData;
  // ... other fields
}

// Parsed schema (typed structure)
export interface ParsedBookingSchema {
  contact: ContactFields;
  passengers: PassengerFields[];
  selectedSeats?: SelectedSeatsFields;
  baggage?: BaggageFields;
  points?: PointsFields;
  delivery?: DeliveryFields;
}
```

## HTTP Client Design

### 12go HTTP Client Service

Centralized HTTP client for all 12go API calls:

```typescript
@Injectable()
export class TwelveGoClientService {
  private readonly baseUrl: string;
  private readonly httpService: HttpService;
  private readonly retryStrategy: RetryStrategy;
  private readonly circuitBreaker: CircuitBreaker;

  async search(route: SearchRoute, date: Date, seats: number): Promise<TwelveGoSearchResponse> {
    const url = `/search/${route.fromProvinceId}p/${route.toProvinceId}p/${formatDate(date)}`;
    const params = { seats, direct: true };
    
    return this.callApi<TwelveGoSearchResponse>('GET', url, { params });
  }

  async getTripDetails(tripId: string, datetime: Date, seats: number): Promise<TwelveGoTripDetailsResponse> {
    const url = `/trip/${tripId}/${formatDateTime(datetime)}`;
    const params = { seats };
    
    return this.callApi<TwelveGoTripDetailsResponse>('GET', url, { params });
  }

  async addToCart(tripId: string, datetime: Date, seats: number): Promise<string> {
    const url = `/cart/${tripId}/${formatDateTime(datetime)}`;
    const params = { seats };
    
    const response = await this.callApi<{ cartId: string }>('POST', url, { params });
    return response.cartId;
  }

  async getBookingSchema(cartId: string): Promise<TwelveGoBookingSchemaResponse> {
    const url = `/checkout/${cartId}`;
    const params = { people: 1 };
    
    return this.callApi<TwelveGoBookingSchemaResponse>('GET', url, { params });
  }

  async reserve(cartId: string, reserveData: ReserveDataRequest): Promise<{ bid: string }> {
    const url = `/reserve/${cartId}`;
    const body = serializeReserveData(reserveData);  // Flat bracket-notation format
    
    return this.callApi<{ bid: string }>('POST', url, { body });
  }

  async confirm(bid: string): Promise<{ bid: number }> {
    const url = `/confirm/${bid}`;
    
    return this.callApi<{ bid: number }>('POST', url);
  }

  async getBookingDetails(bid: string): Promise<TwelveGoBookingDetailsResponse> {
    const url = `/booking/${bid}`;
    
    return this.callApi<TwelveGoBookingDetailsResponse>('GET', url);
  }

  async getRefundOptions(bid: string): Promise<TwelveGoRefundOptionsResponse> {
    const url = `/booking/${bid}/refund-options`;
    
    return this.callApi<TwelveGoRefundOptionsResponse>('GET', url);
  }

  async refund(bid: string, refundRequest: TwelveGoRefundRequest): Promise<TwelveGoRefundResponse> {
    const url = `/booking/${bid}/refund`;
    
    return this.callApi<TwelveGoRefundResponse>('POST', url, { body: refundRequest });
  }

  private async callApi<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { params?: Record<string, any>; body?: any }
  ): Promise<T> {
    // Inject API key from auth config
    const apiKey = this.authConfig.getApiKey(this.clientId);
    const url = `${this.baseUrl}${path}?k=${apiKey}`;
    
    // Add correlation ID header
    const headers = {
      'x-correlation-id': this.correlationId,
    };
    
    // Check circuit breaker
    if (this.circuitBreaker.isOpen(path)) {
      throw new ServiceUnavailableException('Circuit breaker open');
    }
    
    try {
      const response = await this.retryStrategy.execute(async () => {
        return this.httpService.request<T>({
          method,
          url,
          params: options.params,
          data: options.body,
          headers,
          timeout: this.getTimeout(path),
        }).toPromise();
      });
      
      this.circuitBreaker.recordSuccess(path);
      return response.data;
    } catch (error) {
      this.circuitBreaker.recordFailure(path);
      throw this.mapError(error);
    }
  }

  private mapError(error: any): Error {
    // Map 12go HTTP errors to client-facing errors
    if (error.response?.status === 400) {
      // Check for "Trip is no longer available"
      if (error.response.data?.messages?.some((m: string) => m.includes('Trip is no longer available'))) {
        throw new NotFoundException('Trip not found');
      }
      // Check for field-level errors
      if (error.response.data?.fields) {
        throw new UnprocessableEntityException(error.response.data.fields);
      }
      throw new UnprocessableEntityException('Invalid request');
    }
    if (error.response?.status === 401) {
      throw new ServiceUnavailableException('Authentication failed');  // Don't expose auth details
    }
    if (error.response?.status === 404) {
      throw new NotFoundException('Resource not found');
    }
    if (error.response?.status >= 500) {
      throw new BadGatewayException('12go service error');
    }
    if (error.code === 'ECONNABORTED') {
      throw new GatewayTimeoutException('Request timeout');
    }
    throw new InternalServerErrorException('Unknown error');
  }
}
```

### Retry Strategy

Exponential backoff with jitter for idempotent requests:

```typescript
export class RetryStrategy {
  async execute<T>(
    operation: () => Promise<T>,
    options: { maxAttempts: number; isIdempotent: boolean } = { maxAttempts: 3, isIdempotent: true }
  ): Promise<T> {
    if (!options.isIdempotent) {
      return operation();  // No retry for non-idempotent (reserve, confirm, refund)
    }
    
    let lastError: Error;
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < options.maxAttempts - 1) {
          const backoff = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
          const jitter = backoff * 0.2 * (Math.random() * 2 - 1);  // ±20%
          await this.sleep(backoff + jitter);
        }
      }
    }
    throw lastError!;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Circuit Breaker

Prevent cascading failures:

```typescript
export class CircuitBreaker {
  private failures: Map<string, number> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private state: Map<string, 'closed' | 'open'> = new Map();

  isOpen(endpoint: string): boolean {
    const state = this.state.get(endpoint) || 'closed';
    if (state === 'open') {
      const lastFailure = this.lastFailureTime.get(endpoint) || 0;
      if (Date.now() - lastFailure > 30000) {  // 30s cooldown
        this.state.set(endpoint, 'closed');
        this.failures.set(endpoint, 0);
        return false;
      }
      return true;
    }
    return false;
  }

  recordFailure(endpoint: string): void {
    const count = (this.failures.get(endpoint) || 0) + 1;
    this.failures.set(endpoint, count);
    this.lastFailureTime.set(endpoint, Date.now());
    
    if (count >= 5) {  // 5 consecutive failures
      this.state.set(endpoint, 'open');
    }
  }

  recordSuccess(endpoint: string): void {
    this.failures.set(endpoint, 0);
  }
}
```

## Data Strategy

### No Persistent Storage

The service is stateless — no database required:
- **Search results:** Re-fetch from 12go on each request (no caching)
- **Booking details:** Proxy to 12go `/booking/{id}` (12go MariaDB is authoritative)
- **Booking schema:** Re-fetch from 12go `/checkout/{cartId}` on CreateBooking (eliminates PreBookingCache)

### Transient State: Seat Lock

In-process memory store for seat locks (per-instance, not shared):

```typescript
@Injectable()
export class SeatLockService {
  private locks: Map<string, SeatLockEntry> = new Map();
  private readonly ttl = 30 * 60 * 1000;  // 30 minutes

  lockSeats(bookingToken: string, seatIds: string[]): void {
    this.locks.set(bookingToken, {
      seatIds,
      expiresAt: Date.now() + this.ttl,
    });
    
    // Cleanup expired locks periodically
    this.cleanup();
  }

  getLockedSeats(bookingToken: string): string[] | null {
    const entry = this.locks.get(bookingToken);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.locks.delete(bookingToken);
      return null;
    }
    return entry.seatIds;
  }

  releaseLock(bookingToken: string): void {
    this.locks.delete(bookingToken);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.locks.entries()) {
      if (entry.expiresAt < now) {
        this.locks.delete(token);
      }
    }
  }
}

interface SeatLockEntry {
  seatIds: string[];
  expiresAt: number;
}
```

**Multi-instance Consideration:**
- Seat locks are per-instance (not shared across pods)
- Options: sticky sessions at load balancer, or accept per-instance locks (12go validates availability at reserve time)
- When 12go ships native seat lock, replace with 12go API call

### Master Data Snapshots (S3)

Periodic job generates station/operator JSON artifacts:

```typescript
@Injectable()
export class SnapshotJobService {
  @Cron('0 2 * * *')  // Daily at 2 AM
  async generateSnapshots(): Promise<void> {
    // Fetch stations/operators from 12go API or DB
    const stations = await this.fetchStations();
    const operators = await this.fetchOperators();
    
    // Apply Fuji → 12go translation
    const translatedStations = this.translateStations(stations);
    
    // Generate locale-specific JSON files
    for (const locale of ['en', 'th', 'vi']) {
      const artifact = this.generateArtifact(translatedStations, operators, locale);
      const s3Key = `stations-operators-${locale}-${Date.now()}.json`;
      await this.s3Client.putObject(s3Key, artifact);
    }
  }
}
```

## Cross-Cutting Concerns

### Logging (pino)

**Recommendation: pino**

Pino is the fastest Node.js logger (benchmarked at 2-3x faster than Winston):

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: 'booking-service',  // or 'search-service'
  },
});

// Usage in controllers/services
logger.info({
  client_id: request.clientId,
  correlation_id: request.correlationId,
  endpoint: 'GET /bookings/{id}',
  duration_ms: elapsed,
  twelve_go_duration_ms: twelveGoElapsed,
  http_status: 200,
}, 'Request completed');
```

**Structured Logging:**
- All logs include `client_id`, `correlation_id`, `endpoint`, `duration_ms`, `http_status`
- Log levels: INFO (request/response), WARN (12go errors handled gracefully), ERROR (exceptions, 5xx)
- DEBUG level disabled in production (full request/response bodies)

### Tracing and Metrics (OpenTelemetry + Datadog)

**Setup:**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { DatadogSpanProcessor, DatadogExporter } from 'opentelemetry-exporter-datadog';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'booking-service',
  instrumentations: [getNodeAutoInstrumentations()],
  spanProcessor: new DatadogSpanProcessor(
    new DatadogExporter({
      serviceName: 'booking-service',
      agentUrl: process.env.DD_AGENT_URL || 'http://localhost:8126',
      env: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
    })
  ),
});

sdk.start();
```

**Metrics:**

```typescript
import { MeterProvider, Counter, Histogram } from '@opentelemetry/api';

const meter = new MeterProvider().getMeter('booking-service');

const requestDuration = meter.createHistogram('proxy.request.duration', {
  description: 'Request duration in milliseconds',
});

const twelveGoDuration = meter.createHistogram('proxy.twelvego.request.duration', {
  description: '12go API call duration',
});

const retryCount = meter.createCounter('proxy.twelvego.retry.count', {
  description: 'Number of retries for 12go calls',
});

// Usage
requestDuration.record(duration, {
  service: 'booking-service',
  endpoint: 'GET /bookings/{id}',
  status_code: 200,
  client_id: clientId,
});
```

**Distributed Tracing:**
- `x-correlation-id` propagated as trace ID
- Spans for: incoming request, each 12go API call, response mapping, notification delivery

### Error Handling

Global exception filter:

```typescript
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    // Log full exception with context
    this.logger.error({
      client_id: request.params.client_id,
      correlation_id: request.headers['x-correlation-id'],
      endpoint: `${request.method} ${request.path}`,
      status,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    }, 'Unhandled exception');

    // Return generic error (no stack traces in production)
    response.status(status).json({
      error: {
        code: status,
        message: typeof message === 'string' ? message : (message as any).message,
      },
    });
  }
}
```

**Custom Exception Classes:**

```typescript
export class TwelveGoApiException extends HttpException {
  constructor(
    message: string,
    public readonly twelveGoStatus: number,
    public readonly twelveGoError: any
  ) {
    super(message, HttpStatus.BAD_GATEWAY);
  }
}

export class StationMappingException extends HttpException {
  constructor(stationId: string) {
    super(`Station ID ${stationId} not found in mapping`, HttpStatus.BAD_REQUEST);
  }
}
```

### Middleware Stack

NestJS middleware/interceptors:

```typescript
// 1. Correlation ID extraction/generation
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const correlationId = request.headers['x-correlation-id'] || uuidv4();
    request.correlationId = correlationId;
    
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        response.setHeader('x-correlation-id', correlationId);
      })
    );
  }
}

// 2. Travelier-Version header extraction
@Injectable()
export class VersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const version = request.headers['travelier-version'] || '2020-01-01';  // Oldest supported
    request.contractVersion = version;
    
    return next.handle();
  }
}

// 3. Request logging
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log({
          method: request.method,
          path: request.path,
          client_id: request.params.client_id,
          correlation_id: request.correlationId,
          duration_ms: duration,
          status: context.switchToHttp().getResponse().statusCode,
        });
      })
    );
  }
}

// 4. Response transformation (apply version shaping, money format)
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const version = request.contractVersion;

    return next.handle().pipe(
      map(data => {
        // Apply version-specific transformations
        // Convert money to strings
        return this.transformResponse(data, version);
      })
    );
  }

  private transformResponse(data: any, version: string): any {
    // Recursively transform money fields to strings
    // Apply version-specific field inclusion/exclusion
    return transformMoneyToStrings(applyVersionShaping(data, version));
  }
}
```

## Notification Transformer

### Webhook Receiver

```typescript
@Controller('v1/notifications/onetwogo')
export class WebhookController {
  @Post(':path')
  async receiveWebhook(
    @Param('path') path: string,
    @Body() body: { bid: number },
    @Headers('x-12go-signature') signature?: string
  ): Promise<{ success: boolean }> {
    // Validate HMAC signature (if 12go supports it)
    if (signature && !this.validateSignature(body, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Always return 200 immediately (decouple delivery from acknowledgement)
    this.notificationService.processWebhook(body.bid).catch(error => {
      this.logger.error({ bid: body.bid, error }, 'Webhook processing failed');
    });

    return { success: true };
  }
}
```

### Notification Processing

```typescript
@Injectable()
export class NotificationService {
  async processWebhook(bid: number): Promise<void> {
    // Fetch booking details from 12go
    const bookingDetails = await this.twelveGoClient.getBookingDetails(String(bid));
    
    // Resolve client_id from booking reference (tracker field or metadata)
    const clientId = this.resolveClientId(bookingDetails);
    
    // Transform 12go booking details → client notification format
    const notification = this.transformNotification(bookingDetails);
    
    // Get client webhook URL from config
    const webhookConfig = this.authConfig.getWebhookConfig(clientId);
    
    // Deliver to client webhook
    await this.deliverWebhook(webhookConfig.url, notification, webhookConfig.auth);
  }

  private async deliverWebhook(
    url: string,
    notification: ClientNotification,
    auth?: WebhookAuth
  ): Promise<void> {
    const maxRetries = 3;
    const retryDelays = [30000, 300000, 1800000];  // 30s, 5min, 30min

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.httpService.post(url, notification, {
          headers: auth ? { [auth.header]: auth.value } : {},
          timeout: 10000,
        }).toPromise();
        
        this.logger.info({ url, attempt }, 'Webhook delivered successfully');
        return;
      } catch (error) {
        if (attempt < maxRetries - 1) {
          await this.sleep(retryDelays[attempt]);
        } else {
          this.logger.error({ url, error, attempts: attempt + 1 }, 'Webhook delivery failed after retries');
          // Alert on final failure
        }
      }
    }
  }
}
```

## Testing Strategy

### Unit Tests

Test pure transformation functions and service logic:

```typescript
describe('StationMapperService', () => {
  it('should map Fuji station ID to 12go station ID', () => {
    const mapper = new StationMapperService(mockConfig);
    const result = mapper.mapToTwelveGo('fuji-station-123');
    expect(result.stationId).toBe('12go-station-456');
    expect(result.provinceId).toBe('12go-province-78');
  });
});

describe('BookingSchemaMapperService', () => {
  it('should parse dynamic booking schema fields', () => {
    const mapper = new BookingSchemaMapperService();
    const schema = {
      'contact[mobile]': { required: true },
      'selected_seats_segment1': { type: 'select' },
      'points*pickup': { type: 'select' },
    };
    const parsed = mapper.parseSchema(schema);
    expect(parsed.contact.mobile).toBeDefined();
    expect(parsed.selectedSeats).toBeDefined();
    expect(parsed.points.pickup).toBeDefined();
  });
});
```

### Integration Tests

Test HTTP client with mocked 12go responses:

```typescript
describe('TwelveGoClientService', () => {
  it('should retry on transient errors', async () => {
    const client = new TwelveGoClientService(mockHttpService, mockRetryStrategy);
    mockHttpService.get.mockRejectedValueOnce({ code: 'ECONNRESET' });
    mockHttpService.get.mockResolvedValueOnce({ data: { trips: [] } });
    
    const result = await client.search(mockRoute, mockDate, 2);
    expect(mockHttpService.get).toHaveBeenCalledTimes(2);
  });
});
```

### E2E Tests

Test full request/response flow:

```typescript
describe('Booking E2E', () => {
  it('should create booking end-to-end', async () => {
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    
    const server = app.getHttpServer();
    
    // 1. GetItinerary
    const itineraryResponse = await request(server)
      .get('/client-a/itineraries/itinerary-123')
      .expect(200);
    
    // 2. CreateBooking
    const bookingResponse = await request(server)
      .post('/client-a/bookings')
      .send({
        bookingToken: itineraryResponse.body.bookingToken,
        passengers: [{ firstName: 'John', lastName: 'Doe' }],
      })
      .expect(201);
    
    expect(bookingResponse.body.booking_id).toBeDefined();
  });
});
```

### Contract Tests

Validate response shapes match OpenAPI spec:

```typescript
import { validateApiResponse } from 'openapi-validator';

describe('API Contract Compliance', () => {
  it('should return valid SearchResponse', async () => {
    const response = await request(server)
      .get('/client-a/itineraries?departures=123&arrivals=456&date=2024-01-15')
      .expect(200);
    
    validateApiResponse('/v1/{client_id}/itineraries', 'GET', response.body);
  });
});
```

## Deployment

### Docker Image

```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy config files
COPY .env.example .env

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/ready', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

**Multi-stage build:**
- Builder stage: installs dev dependencies, compiles TypeScript
- Production stage: only production dependencies, smaller image (~150MB vs ~500MB)

### CI/CD

**GitHub Actions workflow:**

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test
      - run: npm run test:e2e

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run build
      - uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: registry.example.com/booking-service:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to 12go infrastructure
        run: |
          # Deployment script (managed by DevOps)
          ./scripts/deploy.sh
```

**Deployment process:**
1. Run tests (unit, integration, e2e)
2. Build Docker image
3. Push to container registry
4. Deploy to 12go EC2 fleet (managed by DevOps)
5. Health check validation
6. Rollback on failure

## Team Ramp-Up Plan

### TypeScript for .NET Developers

**Week 1: Fundamentals**
- TypeScript syntax (types, interfaces, generics, async/await)
- Node.js basics (modules, event loop, npm)
- Similarities to C#: `async/await`, LINQ → array methods (`filter`, `map`, `reduce`), classes/interfaces

**Week 2: NestJS Framework**
- NestJS modules, controllers, services
- Dependency injection (similar to .NET DI)
- Decorators (`@Controller`, `@Get`, `@Injectable`)
- Validation pipes (similar to Data Annotations)

**Week 3: Project-Specific Patterns**
- 12go HTTP client patterns
- Response transformation logic
- Booking schema parsing
- Error handling patterns

**Week 4: Production Readiness**
- Logging and tracing
- Testing (Jest, similar to xUnit)
- Docker deployment
- Debugging Node.js applications

**Estimated Timeline:** 4 weeks to productive contribution, 8 weeks to full proficiency.

### AI-Assisted Development Advantage

**TypeScript's AI Advantage:**
- Largest training corpus in AI code generation tools (Cursor, Claude, GitHub Copilot)
- Type system provides rich context for AI code generation
- AI tools understand TypeScript patterns better than PHP or Python
- Can generate entire service classes with correct types from prompts

**Workflow:**
1. Describe endpoint requirement in natural language
2. AI generates TypeScript controller/service with types
3. Developer reviews and adjusts
4. AI generates tests from implementation
5. Developer validates and deploys

**Productivity Gain:** Estimated 2-3x faster development vs manual coding, especially for boilerplate (DTOs, controllers, mappers).

### Realistic Timeline

**Phase 1: Search Service (Weeks 1-6)**
- Week 1-2: Project setup, NestJS scaffolding, 12go client
- Week 3-4: Search endpoint implementation, station mapping
- Week 5: Master data endpoints (Stations, Operators, POIs)
- Week 6: Testing, deployment, shadow traffic validation

**Phase 2: Booking Service (Weeks 7-14)**
- Week 7-8: Booking module setup, GetItinerary endpoint
- Week 9-10: CreateBooking, ConfirmBooking, booking schema parsing
- Week 11: SeatLock, GetBookingDetails, GetTicket, CancelBooking
- Week 12: Notification transformer, webhook delivery
- Week 13-14: Testing, deployment, per-client migration

**Total:** 14 weeks (3.5 months) for both services, assuming 2-3 developers working in parallel.

**Risk Factors:**
- Booking schema parsing complexity (20+ wildcard patterns) — may take longer
- 12go API integration issues — depends on 12go team responsiveness
- Team learning curve — may extend timeline by 2-4 weeks if TypeScript adoption is slower than expected

**Mitigation:**
- Start with Search service (simpler, stateless) to build team confidence
- Use AI tools extensively to accelerate development
- Pair programming between senior and junior developers
- Weekly checkpoints to adjust timeline based on progress
