# Business Risk Review: PHP Integration (Inside f3)

## Overall Risk Assessment

**Risk Level: HIGH**

This alternative has the best long-term strategic alignment and the worst short-term execution risk. The technical design is sound — embedding B2B endpoints inside f3 is architecturally clean. But the execution depends on a .NET team writing production PHP inside someone else's monolith during a period of uncertain retention. I have seen migrations fail for exactly this reason: the team resents the technology choice, velocity craters, and people leave. The risk is human, not technical.

## Migration Timeline Risk

The 6-8 week MVP estimate assumes 1 week of PHP/Symfony ramp-up is sufficient. It is not. Learning PHP syntax takes days; understanding f3's codebase, its service layer conventions, its deployment pipeline, and its failure modes takes weeks. Realistic MVP timeline: **10-14 weeks**, with significant variance depending on 12go veteran availability. The booking schema mapper must be rewritten in PHP from C# — same logic, different language, different serialization patterns. Every subtlety must be re-discovered. The "Phase 1 HTTP proxy" fallback is smart risk management, but it also means the core value proposition (direct MariaDB access, eliminated round-trips) is deferred to Phase 4, pushing total timeline to **13-21 weeks**. That's 3-5 months — dangerously close to the team retention horizon.

## Client Disruption Risk

Moderate. Shadow mode with progressive rollover is feasible. The load balancer routing approach supports per-endpoint rollback. However, deploying inside f3 means B2B releases are coupled to f3's release cycle — a broken f3 deploy could take down B2B endpoints even if the B2B code is fine. This is a new blast radius that doesn't exist with a standalone service.

## Team Impact Assessment

**This is the highest-risk factor.** The design document itself acknowledges: "The dominant risk is human, not technical." I agree emphatically. Two senior .NET developers with 12 years of experience are being asked to write PHP — a language they explicitly do not prefer — inside a monolith they don't understand, maintained by a team they're still building a relationship with. This is a recipe for accelerated departures. If even one senior developer leaves during the PHP ramp-up phase, the migration stalls. The remaining team doesn't have the PHP knowledge to continue independently, and hiring a PHP developer to finish a half-migrated B2B layer is a nightmare onboarding scenario. The 12go veteran dependency is critical and single-threaded — if that person is pulled to other priorities (likely, given they work at a large company with competing demands), the team is blocked.

## Knowledge Transfer Risk

**Paradoxically, the best long-term.** If the migration succeeds and the current team eventually leaves, 12go's PHP engineers can maintain the B2B module natively. No cross-language friction, no separate deployment pipeline, no "who owns the .NET thing" conversations. This is the strongest argument for this option — but it requires surviving the migration period first.

## Cost Analysis

Infrastructure cost: zero (deploys on existing f3 instances). Training cost: significant but soft — lost productivity during PHP ramp-up, estimated 2-4 weeks of reduced velocity. Opportunity cost: highest of all alternatives — the team spends 13-21 weeks on migration instead of 7-8 weeks with .NET. The delta is 6-13 weeks of developer time, which at fully loaded cost for 3-4 developers is substantial. Hidden cost: 12go veteran time is not free — it's borrowed from 12go's own roadmap.

## Rollback Strategy Assessment

Good at the system level — load balancer switches traffic back to .NET services. But there's a subtler rollback problem: if the team spends 8 weeks on PHP and then decides it's not working, the sunk cost is significant. The "rollback" from a PHP strategy decision is "start over with .NET," which means those 8 weeks produced nothing. This organizational rollback cost is higher than any other alternative.

## Top 3 Risks (Ranked by Severity)

1. **Team attrition accelerated by PHP mandate** — forced language change during uncertain transition triggers departures, leaving the migration incomplete and the remaining codebase in two half-finished languages
2. **12go veteran unavailability** — the single expert needed for f3 codebase onboarding is pulled to other priorities, blocking the team for weeks
3. **f3 coupling creates cascading failures** — a bad f3 release breaks B2B endpoints; the team lacks PHP debugging expertise to diagnose quickly in production

## Risk Mitigations

1. Do not proceed unless the team genuinely consents (not just acquiesces). Run a 1-week PHP spike — if velocity and morale are poor, switch to .NET immediately. Treat this as a hard gate.
2. Negotiate dedicated 12go veteran allocation in writing before starting. Minimum 50% availability for 6 weeks. Have a backup contact identified.
3. Implement B2B-specific integration tests in f3's CI pipeline. Use feature flags so B2B code can be disabled independently of f3 releases.

## Score Adjustments

The self-assessed 104/140 is reasonable but I would lower **Implementation Effort to 2** (6-8 weeks is optimistic; 10-14 is realistic when you factor in real f3 ramp-up time) and **Migration Risk to 3** (the f3 coupling introduces new failure modes). Adjusted score: ~**98/140**. The gap between this and .NET (126) represents the "PHP tax" — and that tax is mostly paid in team risk, not technical risk.
