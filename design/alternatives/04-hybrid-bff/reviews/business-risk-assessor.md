# Business Risk Review: Hybrid BFF / Thin Proxy (TypeScript/Bun)

## Overall Risk Assessment

**Risk Level: MEDIUM**

This alternative makes an honest trade: it's the smallest possible codebase (~3K LOC) but introduces two risk factors — a language the team doesn't know (TypeScript) and a runtime that is relatively new in production (Bun). The design's self-awareness about where "thin" breaks down is commendable, but the recommended TypeScript/Bun combination adds unnecessary runtime risk on top of the language learning cost. The "thin proxy" philosophy is sound; the runtime choice weakens it.

## Migration Timeline Risk

The 4-5 week realistic estimate is plausible for the code volume but underestimates the TypeScript ramp-up for .NET developers. The design claims "1-2 days with AI assistance" for ramp-up — this is too optimistic. TypeScript syntax is learnable in days, but npm ecosystem fluency (package management, module systems, bundler configuration, debugging Node.js/Bun runtime issues) takes 1-2 weeks. Realistic MVP: **5-7 weeks**. Total to production cutover: **8-10 weeks**. The biggest timeline risk is the Bun recommendation. Bun 1.2 is production-capable but not battle-tested at enterprise scale. If the team hits a Bun-specific bug in production, they have zero experience debugging it and limited community resources compared to Node.js. The design acknowledges Node.js as a fallback, but switching runtimes mid-migration is disruptive. Pick Node.js from the start and eliminate this risk.

## Client Disruption Risk

Low. Shadow traffic with Nginx routing, per-client canary, instant rollback — all standard patterns. The thin proxy nature means the service is stateless, so there's no data migration concern. The notification transformer's in-memory state (booking→client mapping) is a minor gap — lost on restart, but manageable with the documented workarounds.

## Team Impact Assessment

**Moderate risk.** TypeScript is the closest non-.NET language to C# (same designer, similar type system, identical async/await), which genuinely reduces learning friction compared to Go or PHP. However, "close" is not "identical." The .NET developers will be frustrated by npm's dependency management, JavaScript's type coercion quirks, and the lack of familiar tooling (no Visual Studio, no strong debugger integration, no NuGet-quality package ecosystem). The morale impact is less severe than PHP (TypeScript is a "cool" language that developers generally want to learn) but more severe than staying in .NET. The Bun recommendation specifically adds risk — asking developers to learn TypeScript AND use a non-standard runtime simultaneously is doubling the unfamiliarity.

## Knowledge Transfer Risk

**Good for long-term hiring.** TypeScript has the largest developer pool globally. If the current team leaves, finding TypeScript developers is easier than finding .NET developers (in most markets) or Go developers. However, neither 12go's PHP team nor the potential Go direction benefits from a TypeScript service. The service becomes an isolated technology island — maintainable by readily available talent, but not naturally owned by anyone in the current organization.

## Cost Analysis

Infrastructure: minimal (single Docker container). Training: 1-2 weeks of reduced productivity for 2-3 developers. Opportunity cost: 8-10 weeks vs 7-8 for .NET = 1-2 extra weeks, which is the smallest delta among non-.NET alternatives. No licensing costs. The Bun runtime adds no cost but adds risk that could translate to unbudgeted debugging time in production.

## Rollback Strategy Assessment

Excellent at the technical level. Nginx configuration change reverts to .NET services in seconds. The stateless design means no data rollback is needed. The organizational rollback (abandoning TypeScript for .NET) wastes 5-7 weeks but the domain knowledge carries over. The thin codebase (~3K LOC) means less sunk cost than larger alternatives.

## Top 3 Risks (Ranked by Severity)

1. **Bun runtime instability in production** — the team has no experience diagnosing Bun-specific issues; a production bug in the runtime (not the application) could cause extended downtime with no one able to diagnose it
2. **TypeScript ecosystem unfamiliarity** — npm dependency management, module resolution, and JavaScript runtime behavior are genuinely different from .NET; the team will hit unexpected issues that consume time disproportionate to their apparent simplicity
3. **Notification transformer state loss** — the in-memory booking→client mapping is lost on restart, meaning booking notifications during/after a deploy may be misrouted or lost

## Risk Mitigations

1. **Use Node.js 22 LTS instead of Bun.** Eliminate the runtime risk entirely. The performance difference is irrelevant for a proxy that's bottlenecked by 12go's response time. Node.js has 15 years of production hardening, first-class Datadog support, and massive community troubleshooting resources.
2. Budget 1.5-2 weeks for TypeScript ramp-up, not 1-2 days. Have the team complete a small but real feature (search endpoint) before committing to the full build.
3. Implement Redis-backed booking→client mapping from day one instead of in-memory. The complexity is minimal (~50 lines) and 12go already has Redis infrastructure available. Don't ship a known reliability gap.

## Score Adjustments

The self-assessed 99/140 is fair but should be adjusted for the Bun risk. If the team uses **Node.js instead of Bun** (as I recommend), the Infrastructure Fit score improves from 4 to 4 (no change — still a new runtime for DevOps) and the operational risk decreases. With Node.js: score stays at ~**99/140**. With Bun: I'd dock 3-5 points for runtime risk, putting it at ~**95/140**. The core thesis — minimal code, maximum simplicity — is strong, but the execution choices introduce avoidable risk.
