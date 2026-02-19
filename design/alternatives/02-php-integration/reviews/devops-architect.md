# DevOps & Infrastructure Review: PHP Integration (Inside f3)

## Overall Infrastructure Assessment

From a pure infrastructure standpoint, this is paradoxically both the best and most dangerous option. Best because it requires zero new infrastructure — the B2B API deploys as part of the existing f3 monolith on the same 8 EC2 instances. Dangerous because it couples our release cycle to f3's, introduces shared-resource contention risk, and makes our team dependent on 12go's DevOps pipeline for every deployment.

## Deployment Strategy

No new deployment — B2B code ships with every f3 release. This eliminates all deployment infrastructure work for DevOps. However, it introduces a critical constraint: we cannot deploy independently. Every B2B change requires going through f3's release process, which means coordinating with 12go's team on timing, testing, and rollback. If a B2B bug slips through, rolling back means rolling back all of f3. Feature flags can mitigate this, but they add operational complexity of their own.

## CI/CD Pipeline Assessment

We inherit f3's CI/CD pipeline entirely — no new pipeline to build or maintain. The B2B test suite runs as part of f3's CI. Build time increases marginally (PHP is fast to build). However, our test failures can block f3 releases, and f3's test failures block us. This coupling is a real operational concern. The design mentions dedicated B2B tests in f3's CI, which is correct, but test isolation in a shared pipeline requires discipline. Artifact is f3's existing Docker image, slightly larger with our additional code.

## Container Analysis

No new containers. The B2B endpoints run inside the existing PHP-FPM process. PHP-FPM's process model is well-understood: each request gets a worker, workers are recycled. Startup time for additional routes is effectively zero. Memory impact depends on how many PHP-FPM workers are configured — each worker process adds ~30-50MB, but B2B traffic won't meaningfully increase worker count since it's small relative to f3's consumer traffic. The existing container image (~100MB base) grows negligibly.

## Monitoring Integration

Excellent by inheritance. `dd-trace-php` is already installed and configured in f3. B2B endpoints get automatic tracing with zero setup. Custom spans are straightforward. Monolog is already piped to Datadog. The only work is creating a dedicated "B2B API" Datadog dashboard to separate B2B metrics from f3's consumer metrics. The design correctly identifies `dd-trace-php` Symfony quirks — these are real but well-documented. Overall, monitoring integration is nearly free.

## Configuration Management

B2B configuration lives in f3's existing config system — Symfony YAML files, `.env` variables, and database-stored settings. Per-client API keys and webhook URLs fit naturally into this model. The challenge is separation of concerns: B2B config changes require f3 deployments. Dynamic configuration (changing a client's webhook URL) would ideally be database-backed, which f3 already supports. No new secrets management needed — uses f3's existing approach.

## Local Development Experience

Developers use f3's existing `docker-compose` local environment. This is both a blessing (no new setup) and a burden (must run the entire f3 monolith locally, which is a heavyweight setup). Debugging B2B code means understanding f3's Xdebug/PHPStorm setup. For a .NET team learning PHP, the local dev experience is an additional friction point — they need to set up f3's Docker environment, understand Symfony's debug toolbar, and navigate a large monolith just to test their 13 endpoints.

## Operational Burden

Day-to-day operational burden is the lowest of all alternatives because there's nothing new to operate. No new containers, no new health checks, no new log streams. However, incident response becomes more complex: if B2B endpoints have issues, the investigation happens inside f3's codebase and infrastructure. Our team needs to understand f3's operational tooling, log patterns, and deployment process. On-call becomes a shared responsibility — B2B issues may manifest as f3 issues and vice versa.

## Infrastructure Risks

- **Blast radius**: A B2B bug (memory leak, infinite loop, unhandled exception) can impact f3's consumer-facing functionality. PHP-FPM worker isolation helps, but a runaway database query from B2B code could degrade MariaDB for all of f3.
- **Release coupling**: Cannot deploy B2B fixes independently. Emergency patches require coordinating with 12go's release process.
- **Resource contention**: B2B traffic adds load to existing EC2 instances. The design correctly notes B2B traffic is small relative to f3, but search endpoint under heavy B2B load could compete with consumer search for MariaDB connections.
- **Shared failure domain**: If f3 goes down, B2B goes down. If MariaDB has issues, both are affected simultaneously. No isolation boundary.

## Recommendations

1. Establish a dedicated B2B Datadog dashboard from day one with clear SLO metrics separate from f3.
2. Implement feature flags for all B2B endpoints so they can be disabled without an f3 rollback.
3. Set up MariaDB connection pool limits for B2B queries to prevent resource contention.
4. Negotiate an expedited deployment process with 12go for urgent B2B fixes.
5. Create B2B-specific Datadog monitors/alerts that page our team, not 12go's.

## Score Adjustments

| Criterion | Design Self-Score | My Adjustment | Rationale |
|-----------|------------------|---------------|-----------|
| Infrastructure Fit | 5 | **5** (agree) | Zero new infrastructure is hard to beat. |
| Operational Complexity | 5 | **4** (lower) | The shared deployment/failure domain adds complexity that isn't visible day-to-day but surfaces during incidents. Independent deployability matters. |
| Monitoring/Observability | 4 | **4** (agree) | Inherited monitoring is great, but separating B2B signal from f3 noise requires deliberate dashboard/alert setup. |

The 1-point reduction on Operational Complexity reflects that "no new infrastructure" is not the same as "no operational burden." Coupling to f3's release cycle and shared failure domain is a meaningful operational concern that the self-assessment understates.
