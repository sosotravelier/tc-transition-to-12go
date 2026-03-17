---

## status: draft
last_updated: 2026-02-24
depends_on: design/v3/comparison-matrix.md

# Architecture Recommendation (v3)

## Executive Summary

Based on the updated evaluation criteria (v3) that heavily prioritizes long-term platform alignment and infrastructure fit over short-term execution speed, the recommended architecture for the 12go B2B transition is **Option B3: Microservice Go**, narrowly beating out **Option B2: Microservice PHP/Symfony**.

While a .NET 8 Microservice (B1) optimizes perfectly for the transition team's current expertise and short-term delivery velocity, it introduces a severe long-term risk of becoming a technological "orphan" within 12go's mature PHP/Go infrastructure.

## Scoring Summary


| Rank  | Architecture            | Score (out of 235) | Key Characteristic                                                                       |
| ----- | ----------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| **1** | **B3: Microservice Go** | **180**            | Perfect strategic alignment with high performance and acceptable team ramp-up.           |
| 2     | B2: Microservice PHP    | 178                | Perfect infrastructure fit, but lower velocity and competency match for the .NET team.   |
| 3     | A: Monolith PHP         | 168                | Safest migration, highest operational fit, but worst implementation effort and velocity. |
| 4     | B1: Microservice .NET 8 | 155                | Highest execution speed, but a fatal flaw in future extensibility and operational fit.   |
| 5     | B4: Microservice TS     | 154                | High AI/Team synergy, but lacks long-term strategic alignment.                           |


## The Core Tension: Team Velocity vs. Infrastructure Fit

The v3 scoring framework exposes a fundamental tension in this transition project: **who are we optimizing for?**

If we optimize strictly for the **Current Transition Team**, .NET 8 (B1) is the undeniable winner. It allows the team to be instantly productive, leverages their 12+ years of expertise, and guarantees a fast, high-quality MVP delivery. However, it severely punishes the 12go DevOps team (Operational Complexity: 1/5) and violates the company's long-term technical direction (Future Extensibility: 1/5).

If we optimize strictly for **12go's Long-Term Owners**, Monolith PHP (A) or Microservice PHP (B2) wins. They fit perfectly into the existing ecosystem. However, this demands the .NET team completely abandon their expertise to learn PHP and Symfony, massively slowing down MVP delivery (Implementation Effort: 1-2/5) and risking team retention due to "drudgery work."

**The Winning Compromise: Go (B3)**
Go bridges this gap. It is a recognized strategic runtime for 12go (Future Extensibility: 5/5), making it a first-class citizen in the infrastructure. At the same time, Go's modern ecosystem, strict typing, and high performance make it a much more palatable and productive transition for C# developers than PHP, enabling reasonable development velocity after a short ramp-up.

## Why Microservice Go (B3) Wins

1. **Perfect Future Extensibility (5/5):** Go is explicitly aligned with 12go's future platform direction. It will never become an isolated "orphan" service.
2. **Superior Performance (5/5):** Go provides the absolute lowest latency and highest throughput for a microservice via lightweight goroutines, comfortably keeping overhead within the 5ms tolerance.
3. **High Elegance (5/5):** Go's idiomatic patterns naturally enforce a clean, maintainable architecture.
4. **Acceptable Team Match (3/5):** While not C#, Go's statically typed, compiled nature is highly learnable for senior .NET engineers, especially with the assistance of AI coding tools.

## The Close Second: Microservice PHP (B2)

Microservice PHP (178 points) lost to Go by only 2 points. It scored perfectly on Infrastructure Fit (5/5) because it uses the exact same Docker base images as 12go's core monolith. 

However, it lost ground on Development Velocity (3/5) and Team Competency Match (2/5). Asking senior C# engineers to build a new microservice in PHP introduces more friction and cognitive dissonance than transitioning to Go. If the organizational mandate strictly forbids Go for this specific service, B2 is the highly capable fallback.

## Why .NET 8 (B1) Was Rejected

Despite dominating the "Execution" category with a massive 75/90 points due to its perfect match with the current team, B1 collapsed in the "Strategic" and "Critical" categories. 

12go has a mature, revenue-generating EC2/Docker infrastructure built around PHP. Introducing .NET requires new Microsoft base images, new CI/CD vulnerability scanning, and completely unique memory/CPU profiling tooling (`dotnet-trace`, `dotnet-dump`). It creates an operational silo that the core DevOps team cannot easily support, making the long-term total cost of ownership unacceptable.

## Final Architectural Recommendation

**We recommend building the B2B API Transition Layer as a standalone Go Microservice (B3).**

### Next Steps & Migration Strategy

1. **Tooling & Ramp-up:** The transition team should allocate 2-3 weeks to internalize Go idioms, focusing on routing (e.g., `chi`), standard library testing, and error handling patterns.
2. **Infrastructure Provisioning:** Set up CI/CD pipelines to build static Go binaries into distroless/scratch Docker images for deployment to 12go's EC2 environment.
3. **MVP Implementation:** Begin porting the search proxy and caching layer from Etna/Denali into the new Go service, leveraging AI tools (Cursor/Claude) to accelerate the C#-to-Go translation.
4. **Auth & Gateway Routing:** Establish the authentication bridge and configure the API Gateway to route specific B2B client traffic to the new Go service.
5. **Shadow Testing:** Run the Go service in parallel with the legacy .NET systems to verify contract parity and measure latency overhead before final cutover.

