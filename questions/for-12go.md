---
status: draft
last_updated: 2026-02-18
---

### Answers Received (2026-02-18)

**From 12go meeting:**
- Go is being considered as future language but not decided; PHP remains current
- Search is backed by MariaDB; rechecks go to actual integrations (up to 1 min latency)
- Infrastructure is DevOps-managed; environments: Local (Docker), Staging, PreProd (Canary), Prod
- Tech stack: MariaDB, Redis, Kafka (business events), ClickHouse (analytics)
- Logs and metrics on Datadog (comprehensive monitoring available, varies by team)
- Documentation via Jira/Atlassian; code traceability via git blame -> Jira
- Static data endpoints: still open (forgot to ask)

**From management (Shauly):**
- Pricing/Ushba goes away -- use 12go prices directly
- Seat lock is being developed on 12go's side
- Scope: all B2B endpoints (static data, search, booking)
- Out of scope: distribution, Ushba, station mapping ID migration, client onboarding
- Client notifications: 12go has capability but different shape; need transformer service
- Most Kafka events are redundant (no trip lake, no data team)
- Monitoring needs: client, operator, action, outcome, bookingId, itineraryId, traceId
- API key mapping issue: clientId+apiKey (ours) vs apiKey-only (12go)

---

# Questions for 12go Representative

> These questions are compiled from the open questions in all current-state documentation files.
> They are prioritized by impact on the transition architecture.
> Prepared for Wednesday (Feb 18, 2026) meeting.

## Priority 1: Architecture & Integration Model

These questions determine the fundamental approach to the transition.

### Q1. What is the preferred integration method?

Currently we call 12go via HTTP REST endpoints (e.g., `/search/{from}p/{to}p/{date}`, `/reserve/{bookingId}`, etc.). We see three possible approaches for the transition:

- **A) Keep HTTP API calls** - We maintain thin adapter services that translate our client contracts to 12go HTTP calls. Simple but adds a network hop.
- **B) Direct code reference** - We reference 12go PHP repositories and call their service layer directly (e.g., as a Symfony bundle). Eliminates network hop but creates tight coupling to PHP.
- **C) Direct database access** - We write services that access 12go's MySQL/Redis directly. Maximum performance but brittle and hard to maintain.

Which approach does 12go prefer? Is there a fourth option (e.g., gRPC, shared library, message queue)?

### Q2. [RESOLVED] What is the vision for the programming language of new services?

Our current services are .NET. 12go is PHP. For the adapter/proxy services we need to maintain for client compatibility:
- Should we rewrite them in PHP to align with 12go's ecosystem?
- Should we keep them in .NET since they're just thin translation layers?
- Is there a plan to introduce a different language for new services?

### Q3. [RESOLVED] Where will our services run?

We need to migrate infrastructure to 12go's cloud. Key questions:
- What cloud provider and orchestration does 12go use (K8s, ECS, etc.)?
- Can we deploy .NET containers alongside PHP services?
- What are the networking constraints (VPC, service mesh, etc.)?
- Is there a staging/testing environment we can use during migration?

### Q4. How does 12go handle multi-tenant / multi-client API access?

Our clients authenticate via API key (`x-api-key` header) and are identified by `client_id` in the URL path. Each client has different:
- Pricing/markup rules
- Contract codes
- Feature flags
- Distribution rules

Does 12go have a concept of "client" or "partner" with per-client configuration? How would client-specific behavior (markup, contract) work post-transition?

## Priority 2: Functional Capabilities

These questions determine what we need to build vs. what 12go already provides.

### Q5. Can 12go's booking details endpoint replace our local storage?

Currently after a booking is confirmed, we store it in our database (DynamoDB/PostgreSQL) and serve `GetBookingDetails` from there. We want to eliminate this local storage and proxy to 12go.

- Does `GET /booking/{bookingId}` return all the fields our clients expect? Specifically: net price, cost price, cancellation policies with deadlines, passenger details, segment information?
- Is the response available immediately after confirmation, or is there a delay?
- What is the SLA/availability of this endpoint?

### Q6. Can we use 12go's ticket generation instead of our own?

We currently generate PDF tickets ourselves (with QR codes, maps, logos) for some integrations, and re-host supplier tickets on S3/CloudFront for others. 12go returns a `ticket_url` in booking details.

- Is the 12go ticket URL stable and long-lived (we currently sign URLs for 90 days)?
- Can the ticket PDF be customized (branding, layout) per client?
- Is the ticket available immediately after confirmation, or is there a generation delay? (Our clients poll for this)

### Q7. [RESOLVED] Does 12go support seat locking?

Our `LockSeats` endpoint is client-facing, but OneTwoGo's `IBookingFunnel.LockSeats()` throws `NotImplementedException`. Currently we fake seat locking by validating availability and storing the selection locally.

- Does 12go have native seat locking capability?
- If not, is there a plan to add it?
- Is the current approach (validate + store locally, pass seats at reserve time) acceptable long-term?

### Q8. How does 12go handle booking status webhooks?

We have a `booking-notification-service` that receives webhooks from 12go at `POST /v1/integrations/{integration}/webhook/{path?}`. Currently OneTwoGo webhooks have no authentication and send `{ "bid": <long> }`.

- Does 12go actually send booking status webhooks to our system today?
- If we're moving to the same infrastructure, is the webhook still needed, or can we subscribe to internal events (Kafka, database triggers)?
- If webhooks remain, can authentication be added (HMAC, API key)?

### Q9. What cancellation/refund data does 12go provide?

Our cancel flow calls `GET /booking/{bookingId}/refund-options` then `POST /booking/{bookingId}/refund`. But Denali also calculates its own refund amounts (which may differ from 12go's).

- Is 12go the source of truth for refund amounts?
- Does refund-options return the same cancellation policy structure our clients expect (deadlines, penalty percentages, refund amounts)?
- Can we eliminate our local refund calculation and use 12go's directly?

### Q10. How does 12go handle the "recheck" mechanism in search?

When we search, 12go returns a `recheck` field. Our system retries the search when `recheck` is true (the `timeout` parameter triggers this loop).

- What does `recheck` mean exactly? Is it "results are still loading" or "prices may have changed"?
- What is the recommended polling strategy?
- Is there a way to get a callback instead of polling?

## Priority 3: Data & Station Mapping

### Q11. Station ID mapping strategy

This is the hardest transition problem. Our clients have our Fuji station IDs embedded in their systems. 12go uses its own station IDs (and province IDs for search).

- Does 12go maintain a mapping between Fuji station IDs and 12go station IDs?
- Can 12go accept Fuji station IDs in API calls (with internal translation)?
- Or do we need to maintain a station mapping service permanently?
- How frequently do station IDs change in 12go?

### Q12. How does 12go expose station/operator/POI data for bulk consumption?

Our clients call `GET /v1/{client_id}/stations` to get all stations at once (served as pre-signed S3 URLs to JSON). They use this to build their own station mappings.

- Does 12go have a bulk station export API?
- What format is the data in (JSON, CSV, API with pagination)?
- How often does the station list change?
- Can our clients call 12go directly for this, or do we need to maintain the Fuji proxy?

### Q13. Is the POI (province) concept needed?

Our POIs map to 12go provinces. Clients can search by POI instead of specific stations. The mapping is done by province name string matching.

- Does 12go's search support searching by province directly (which it does -- provinceId is in the URL)?
- Can we expose 12go province IDs to clients as POI IDs?
- Would this break existing client integrations?

## Priority 4: Observability & Operations

### Q14. [RESOLVED] Monitoring and logging unification

We use Coralogix for logs/tracing and Grafana for metrics. 12go uses OpenTelemetry.

- What log aggregation does 12go use? Can we send our logs there too?
- Can we access 12go's dashboards/monitoring for end-to-end visibility?
- Is there a unified way to trace a request from our adapter through to 12go's backend?
- Does 12go support correlation IDs / trace context propagation (W3C)?

### Q15. How does 12go handle booking traceability?

Today we can find all logs for a specific booking by searching Coralogix with the booking ID. This is critical for customer support.

- Does 12go provide similar booking-level log correlation?
- Can we search for all events related to a specific booking ID in 12go's systems?
- How does customer support work today in 12go?

### Q16. What Kafka topics does 12go use?

We publish several Kafka events (BookSucceeded, ReservationChanged, etc.). Some may be consumed by 12go or external systems.

- Does 12go consume any of our Kafka topics?
- Does 12go publish Kafka events that we could consume instead of webhooks?
- Can we share Kafka infrastructure, or are they separate clusters?

## Priority 5: Operational Details

### Q17. [RESOLVED] Credit line and pricing

Our system checks a "credit line" balance before booking and confirmation. We also apply markup per-client using Ushba Revenue SDK.

- How does 12go handle credit/payment for API partners?
- Is there a credit line concept in 12go?
- How does per-client pricing/markup work in 12go?

### Q18. Rate limiting and SLA

When we remove the caching layers (trip lake, DynamoDB caches), all search/booking traffic goes directly to 12go.

- What is the rate limit on 12go's API endpoints?
- What is the expected latency for search, booking, and confirmation?
- Is there a staging environment with the same performance characteristics?

### Q19. Cart expiration and state management

In our GetItinerary flow, we call `AddToCart` which creates a cart in 12go. The `cartId` is then used for booking schema and reservation.

- How long does a cart live before expiring?
- Is there a way to extend cart TTL?
- What happens if the cart expires between GetItinerary and CreateBooking?

### Q20. Booking schema stability

We fetch the booking schema from `GET /checkout/{cartId}?people=1` which returns dynamic form fields. Our system caches the field name mappings.

- How stable is the booking schema? Do fields change frequently?
- Is the schema the same for all operators, or operator-specific?
- Is there a way to get the schema without creating a cart first?

## Summary: Key Decision Points

| Question | Decision Impact |
|----------|----------------|
| Q1 (Integration method) | Determines entire architecture |
| Q2 (Programming language) | Determines development approach |
| Q3 (Infrastructure) | Determines deployment strategy |
| Q4 (Multi-client) | Determines if we need client management layer |
| Q5 (Booking storage) | Determines if we keep DynamoDB/PostgreSQL |
| Q11 (Station mapping) | Determines if we keep Fuji or build translation layer |
| Q14 (Monitoring) | Determines observability architecture |

---

## Still Open

- **Static data endpoints** — Forgot to ask in meeting
- **Integration team relevance/details** — TBD
- **Webhook authentication (12go→us)** — TBD
