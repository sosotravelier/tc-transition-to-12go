# Analysis: Risk and Migration

## Executive Summary

This analysis evaluates the five design alternatives through the lens of business continuity, implementation effort, and long-term strategic risk. The project's most significant hurdles—station ID mapping, booking schema parsing, and refund flow transformation—are common to all alternatives, but the technology choice significantly impacts the timeline and team retention.

**Key Findings:**
- **.NET Microservice** represents the lowest implementation risk due to zero learning curve, but carries the highest "orphaned technology" risk if 12go moves toward Go.
- **PHP Monolith** offers the cleanest migration path (transparent switch) and zero infrastructure risk, but poses the highest risk to team retention and initial implementation velocity.
- **TypeScript Microservice** is the most balanced "modern" choice, offering high AI synergy and a manageable learning curve.
- **Go Microservice** is the strongest strategic choice for 12go's future, but the learning curve for a .NET team creates a "timeline bloat" risk.

---

## Comparison by Design/Language

### A: Monolith (PHP/Symfony)
- **Implementation Effort (2/5)**: High. Reading 12go internals while learning PHP is a slow process.
- **Migration Risk (5/5)**: Excellent. Allows for a truly transparent switch within the same infrastructure.
- **Maintainability (3/5)**: Moderate. Requires coordination with the 12go core team for every change.

### B: Microservice (.NET 8)
- **Implementation Effort (5/5)**: Lowest. 8-12 weeks to feature parity is realistic with this team.
- **Migration Risk (4/5)**: Good. Clean separation, but requires new infrastructure rollout.
- **Maintainability (3/5)**: Moderate. Easy for the current team, but hard for 12go's PHP/Go-focused future team to pick up.

### B: Microservice (PHP/Symfony)
- **Implementation Effort (3/5)**: Moderate. Smaller codebase than monolith, but still requires language ramp-up.
- **Migration Risk (4/5)**: Good. Standard microservice deployment.
- **Maintainability (4/5)**: Good. Aligns with 12go's current primary stack.

### B: Microservice (Go)
- **Implementation Effort (3/5)**: Moderate. 4-week ramp-up expected. AI helps, but Go idioms take time to master.
- **Migration Risk (4/5)**: Good. Minimal resource footprint makes side-by-side running easy.
- **Maintainability (5/5)**: Excellent. Strategic alignment with 12go's considered future direction.

### B: Microservice (TypeScript/Node.js)
- **Implementation Effort (4/5)**: Low. 2-week ramp-up. AI synergy accelerates transformation logic implementation.
- **Migration Risk (4/5)**: Good. Familiar stack for modern DevOps.
- **Maintainability (4/5)**: Good. Broad hiring pool and high developer satisfaction.

---

## Migration Risk & Rollback Assessment

| Risk Category | Monolith (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
|---|---|---|---|---|---|
| **Rollback Ease** | Instant (Code) | Easy (Traffic) | Easy (Traffic) | Easy (Traffic) | Easy (Traffic) |
| **Coexistence** | Native | HTTP Proxy | HTTP Proxy | HTTP Proxy | HTTP Proxy |
| **Client Impact** | None | Potential Latency | Potential Latency | Minimal Latency | Potential Latency |
| **Security** | Shared Auth | New Auth Bridge | New Auth Bridge | New Auth Bridge | New Auth Bridge |

**Analysis**: The monolith wins on migration mechanics (no new endpoints, no auth bridging needed). All microservice options require an "Authentication Bridge" to map `clientId` to 12go's `apiKey`.

---

## Effort & Timeline Comparison

| Stage | Monolith (A) | Micro-.NET (B1) | Micro-Other (B2-4) |
|---|---|---|---|
| **Ramp-up** | 6 Weeks | 0 Weeks | 2-4 Weeks |
| **Search MVP** | 4 Weeks | 2 Weeks | 3 Weeks |
| **Booking MVP** | 8 Weeks | 6 Weeks | 8 Weeks |
| **Full Parity** | 20+ Weeks | 10 Weeks | 14-16 Weeks |

---

## Strategic Alignment & Long-term Maintainability

- **Bus Factor**: .NET option has a high bus factor now, but low in 12 months if the team rotates. PHP/Go options have a better long-term bus factor within the 12go ecosystem.
- **Retention**: Forcing a .NET team into a PHP monolith is a high retention risk. TS or Go are perceived as "career growth" steps, reducing this risk.

---

## Comparative Scoring Matrix

| Criterion (Weight) | Monolith-PHP (A) | Micro-.NET (B1) | Micro-PHP (B2) | Micro-Go (B3) | Micro-TS (B4) |
|---|---|---|---|---|---|
| Implementation Effort (x3) | 2 (6) | 5 (15) | 3 (9) | 3 (9) | 4 (12) |
| Migration Risk (x2) | 5 (10) | 4 (8) | 4 (8) | 4 (8) | 4 (8) |
| Maintainability (x2) | 3 (6) | 3 (6) | 4 (8) | 4 (8) | 4 (8) |
| Future Extensibility (x1) | 3 (3) | 3 (3) | 3 (3) | 5 (5) | 2 (2) |
| **Total Weighted Score** | **25** | **32** | **28** | **30** | **30** |
