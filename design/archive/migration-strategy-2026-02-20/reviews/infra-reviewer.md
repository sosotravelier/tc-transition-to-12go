---
status: complete
last_updated: 2026-02-20
reviewer: infra-gateway
---

# Infrastructure & Gateway Review: Migration Strategy

## Overall Assessment

The migration strategy correctly identifies core constraints and proposes pragmatic options. The feature-flag proxy pattern is sound and avoids DevOps dependency for per-client rollout. However, the document underplays cross-AWS networking implications and omits API Gateway v1/v2 distinctions. Shadow traffic and webhook proposals are feasible but need explicit networking assumptions.

## AWS API Gateway Analysis

**Correct:** API Gateway does not natively route by path parameter; Lambda authorizer context can drive integration URI overrides via mapping templates. The document rightly flags unverified config.

**Missing:** (1) **REST API vs HTTP API** — REST (v1) supports Lambda authorizers and VTL; HTTP API (v2) has different semantics. If the gateway is HTTP API, Lambda-based routing may not apply. (2) **VPC links** — integration type affects routing options. (3) **Stage variables** — per-stage backend URLs exist but require heavy per-client stage management. Add DevOps question: "REST or HTTP API? Integration type?"

## Deployment Feasibility

**Dual-system operation is feasible** but has networking implications. Old system runs on our AWS; new service runs on 12go's EC2/Docker. For the feature-flag proxy, the new service must call back to our old services. Our services must be reachable from 12go's VPC (public URL or PrivateLink). Latency adds one hop when proxying (~50–150ms for search). The document should state this explicitly. Deployment topology for 12go's 8 EC2 instances is correct — adding one Docker container is standard.

## Feature Flag Proxy Pattern

**Architecturally sound.** Well-established pattern; keeps routing in app code, enables instant rollback. Latency: proxied requests add one round-trip (Client → GW → New → Old → response). For search, expect 50–150ms extra. The new service becomes a single point of failure — consider a circuit breaker if the proxy path fails.

## Shadow Traffic Assessment

**Practical.** Async fire-and-forget HTTP call inside Etna is straightforward. Correctly restricted to search. Load: each search triggers one extra outbound call; doubles Etna's outbound traffic at full volume. Must not block the primary response; use fire-and-forget with bounded concurrency. Consider 10–20% sampling if volume is high.

## Webhook Routing During Transition

**Feasible.** Option 2 (both receive) requires 12go supporting two webhook URLs (open question) or a fan-out receiver we build. If both receive, we need a shared decision store ("client X is on new system") to avoid duplicate notifications. Design this before implementation.

## Operational Burden

**Underestimated.** Dual monitoring (Coralogix vs Datadog), on-call across both systems, deployment coordination, 4–12 weeks of double compute/logging. Add: "Define a unified runbook covering both systems and clear handoff when migrating a client."

## Missing Considerations

1. Cross-account/VPC connectivity — document that old services must be reachable from 12go.
2. API Gateway version — add to DevOps questions.
3. Shadow traffic sampling for high volume.
4. Circuit breaker for proxy failures.
5. Webhook routing decision store design.

## Recommendations

1. Add DevOps question: "REST or HTTP API? Integration type?"
2. Document: "Old services must remain reachable from 12go's VPC during transition."
3. Quantify proxy latency (50–150ms) and confirm acceptability.
4. Shadow traffic: fire-and-forget, no blocking; consider sampling.
5. Design webhook "which system owns this client" decision store.
6. Create unified incident runbook for the parallel period.
