# Business Risk Review: Trimmed .NET Service

## Overall Risk Assessment

**Risk Level: LOW**

This is the lowest-risk alternative by a significant margin. The team builds in their native language, the codebase is radically simpler than what they're replacing, and every phase supports instant rollback. The primary risk is strategic — .NET may become an orphaned technology choice within 12go's ecosystem — but that's a 12-month concern, not a migration concern.

## Migration Timeline Risk

The 3-week build estimate for MVP is credible. The team has deep .NET expertise and the existing SI codebase provides a working reference for every transformation. The realistic risk is in the **booking schema parser and reserve serializer** — these are genuinely complex ports (~1,000 lines of non-trivial logic with 20+ wildcard patterns). If edge cases surface during parallel-run validation, this could add 1-2 weeks. Total realistic timeline: **7-10 weeks** to full production cutover. The "unknown unknowns" are small because the team already understands the domain, the 12go API, and the transformation logic. They're rewriting code they wrote, in the language they know.

## Client Disruption Risk

Minimal. The design supports shadow traffic, response diffing, and per-client cutover with instant rollback via load balancer. The old .NET services stay warm for 2+ weeks post-cutover. This is a textbook low-disruption migration pattern. The only concern: if GetBookingDetails latency increases noticeably (local DB read → 12go proxy), clients that poll aggressively may notice. Mitigation is straightforward (Redis cache), but it needs monitoring from day one.

## Team Impact Assessment

**This is the safest choice for team morale and retention.** The developers stay in their comfort zone, build something dramatically simpler, and can point to a 98% code reduction as a career achievement. Nobody leaves because they were forced into an unfamiliar language during an uncertain transition. The bus factor is acceptable — any single developer leaving mid-migration doesn't block progress because the remaining team members know both the domain and the technology. A new .NET hire could onboard to a 6K-LOC service in days.

## Knowledge Transfer Risk

**Medium-term concern.** If the current team leaves within 6 months, the .NET service is easy for any .NET developer to maintain. But 12go's ecosystem is PHP (and possibly Go). Hiring .NET developers to maintain a 6K-LOC proxy inside a PHP organization is awkward but feasible — the service is small enough that a PHP developer with AI assistance could maintain it, or 12go could justify a rewrite at that point given the tiny codebase.

## Cost Analysis

Lowest cost of all alternatives. Zero new infrastructure (single Docker container on existing EC2). Zero training costs. Zero licensing costs. The only cost is developer time — approximately 26 person-days for build, which is the smallest investment across all options. Opportunity cost is real but bounded: the team spends 7-8 weeks on migration instead of new features, but this is true for every alternative.

## Rollback Strategy Assessment

**Excellent.** Every phase is reversible. Old services stay running throughout. Rollback is a DNS/load-balancer switch that takes effect in seconds. The maximum safe rollback window extends until old services are decommissioned (2+ weeks after full cutover). This is the gold standard for migration rollback.

## Top 3 Risks (Ranked by Severity)

1. **Strategic misalignment** — .NET becomes an orphan within 12go's PHP/Go ecosystem, creating long-term maintenance friction and hiring difficulty
2. **Booking schema parser regression** — subtle edge cases in the 20+ wildcard patterns cause production booking failures during cutover
3. **Team departure before completion** — if developers leave at 6 months, the half-migrated state is harder to manage than a completed migration in any language

## Risk Mitigations

1. Accept .NET as a deliberate short-term choice. Document that the 6K-LOC codebase is cheap to rewrite in Go/PHP later. Set a 12-month review checkpoint.
2. Port all existing SI test fixtures. Run response-diffing in shadow mode for minimum 2 weeks before any client cutover. Prioritize booking schema tests above all else.
3. Front-load the migration. With a 3-week build phase, the core service can be functional before any retention risk materializes. Document aggressively.

## Score Adjustments

The self-assessed 128/140 is slightly optimistic. I would dock **Implementation Effort to 4** (agree) and **Future Extensibility to 2** (the design says 3, but realistically maintaining .NET inside a PHP shop is a harder sell than acknowledged). Adjusted score: ~**126/140**. Still the highest-scoring option, and deservedly so from a risk perspective.
