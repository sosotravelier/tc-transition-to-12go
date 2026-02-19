# Systems Architect Review: PHP Integration (Inside f3)

## Overall Assessment

This is the only design that fundamentally changes the system's architectural topology — from "external proxy calling 12go via HTTP" to "module inside 12go's monolith calling services directly." That's a genuinely different value proposition and the design is honest about the trade-offs. The sub-option analysis (A vs B vs C) is excellent — Option B is correctly dismissed as "all the pain of PHP with none of the benefit," and Option C is correctly identified as YAGNI. The dominant risk is human, not technical, and the design says so plainly.

## Strengths

- **Eliminates an entire network hop for search.** Direct MariaDB/Redis access via f3 services is the only way to beat the other alternatives on search latency. Going from ~150-400ms (HTTP proxy) to ~30-100ms (direct service call) is a meaningful, measurable improvement. If search performance is the overriding concern, this is the only design that fundamentally moves the needle.
- **Zero-infrastructure cost.** No new EC2 instances, no new Docker images, no new monitoring dashboards, no new deployment pipelines. The B2B module rides entirely on f3's existing operational surface. This is genuinely the lowest-overhead option in production.
- **Intellectually honest about the "PHP tax."** The self-assessment scores Team Competency Match at 2/5 and Development Velocity at 2/5. The design doesn't try to hand-wave away the fact that .NET developers writing PHP will be slower and less happy. The "when to choose / when not to choose" decision framework is well-calibrated.
- **Phased migration with HTTP-proxy fallback.** Starting with HTTP proxy in Phase 1 (same as every other alternative) and only migrating to direct service calls in Phase 4 is smart risk management. It means the team can ship a working MVP before understanding f3's internals.

## Weaknesses

- **Coupling to f3's internal APIs is the long-term architectural risk.** f3 is a monolith managed by a different team. Internal service interfaces are not stable APIs — they change without notice, they're not versioned, and "breaking" is defined by f3's consumers, not ours. The design mentions "automated contract tests in f3's CI pipeline," but this requires f3's team to buy in. If they don't, every f3 release is a potential B2B outage.
- **The Phase 1 → Phase 4 journey is long and uncertain.** 13-21 weeks total timeline means the team is writing PHP for 3-5 months. If the team is unhappy (risk #1, rated "High likelihood, Critical impact"), that's a long time to sustain morale on a language they didn't choose. The risk section is honest about this but the mitigation ("honest communication") is weak.
- **Notification architecture via Symfony event dispatcher is elegant but fragile.** Subscribing to internal `BookingStatusChangedEvent` means the B2B module depends on 12go's internal event contracts. If they rename the event, change its payload, or refactor the dispatcher, the B2B notification transformer breaks silently. This is harder to test than an HTTP webhook contract.

## Domain Modeling Critique

The design correctly avoids introducing a domain model — the B2B module is a presentation/mapping layer on top of f3's existing domain. The Handler/Mapper/Controller separation is appropriate: controllers are thin HTTP adapters, handlers orchestrate f3 service calls, mappers transform to the client contract. No unnecessary abstractions.

## Architecture Pattern Critique

Embedding a bounded module inside a monolith is a well-known pattern (modular monolith). The isolation via namespace (`src/B2bApi/`) is necessary but not sufficient — the true boundary enforcement depends on discipline (no direct Doctrine queries against f3's entities, no accessing f3's private services). Symfony's service container makes it easy to accidentally create tight coupling.

## Error Handling Assessment

Mapping internal PHP exceptions to B2B error codes via `B2bExceptionListener` is clean. The design correctly distinguishes between f3-internal exceptions (which should map to 500/502) and B2B-layer validation errors (400). One gap: when f3 services throw unexpected exceptions (uncaught `\Throwable`), the B2B module must ensure these don't leak f3 internals to clients.

## Recommendations

1. **Define an explicit interface contract for f3 services the B2B module consumes.** Even inside a monolith, document which services/methods are the "public API" for B2B. Get f3's team to agree that these won't change without notice.
2. **Budget for a 12go veteran at 50%+ allocation for the first 6 weeks.** The design says "not optional" — make this a hard prerequisite, not a nice-to-have.
3. **Add a kill switch.** If after 4 weeks the team's morale or velocity is unacceptable, have a documented pivot plan back to the .NET alternative. Don't let sunk-cost fallacy extend an untenable situation.
4. **Validate Symfony event dispatcher reliability.** Ensure `BookingStatusChangedEvent` is dispatched synchronously (or via Messenger with guaranteed delivery) — a missed event means a missed client notification with no recovery path.

## Score Adjustments

| Criterion | Self-Score | Suggested | Justification |
|-----------|-----------|-----------|---------------|
| Simplicity | 4 | 3 | The B2B module is simple; the inherited f3 complexity is not. Developers must navigate f3's codebase to debug issues |
| Migration Risk | 4 | 3 | Coupling to f3 internals introduces a new failure mode: f3 deploys breaking B2B endpoints |
| **Revised Total** | **104** | **~100** | Appropriate for a high-reward, high-risk option |
