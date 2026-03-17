---
status: draft
last_updated: 2026-02-24
depends_on: design/v3/evaluation-criteria.md
---

# Analysis v3: Operations & Infrastructure

## Executive Summary

This analysis evaluates the five architectural alternatives (A, B1, B2, B3, B4) specifically through the lens of Operations & Infrastructure, using the updated scoring weights from [evaluation-criteria.md](../evaluation-criteria.md). 

The three criteria evaluated here are:
1. **Infrastructure Fit (Weight: x7)** - Critical Weight
3. **Operational Complexity (Weight: x5)** - Strategic Weight
15. **Observability (Weight: x1)** - Base Weight

**Maximum possible score for this section:** (7 * 5) + (5 * 5) + (1 * 5) = **65**

**Key Findings:**
* **Option A (Monolith PHP)** and **Option B2 (Microservice PHP)** achieve near-perfect scores because they natively align with 12go's existing EC2/Docker/PHP infrastructure, requiring zero new operational knowledge or tooling.
* **Option B3 (Microservice Go)** scores well due to its alignment with 12go's stated future direction and excellent operational characteristics (single binary, low footprint), though it introduces a slight learning curve compared to pure PHP.
* **Option B4 (Microservice TS)** and **Option B1 (Microservice .NET)** score the lowest because they introduce "foreign body" runtimes to the 12go ecosystem, significantly increasing operational complexity and infrastructure maintenance burden for the core Ops team.

---

## Detailed Scoring by Option

### Option A: Monolith (PHP/Symfony)

#### 1. Infrastructure Fit (Score: 5/5, Weighted: 35)
**Rationale:** The solution is literally built into the existing `frontend3` repository. It deploys exactly as the rest of the application does across 12go's EC2 instances. There is zero new infrastructure, no new Docker containers, and no new resource limits to configure. It represents the ultimate "native alignment."

#### 3. Operational Complexity (Score: 5/5, Weighted: 25)
**Rationale:** The DevOps team changes absolutely nothing about their runbooks. Debugging uses the exact same tools currently in use for the core 12go application. On-call engineers don't need to learn a new stack or deployment pipeline to troubleshoot B2B API issues in production.

#### 15. Observability (Score: 5/5, Weighted: 5)
**Rationale:** Integrates automatically with the existing Datadog APM (`dd-trace-php`) and logging setup in `frontend3`. Traces and correlation IDs flow naturally within the monolith without requiring distributed trace context propagation headers.

**Total Score: 65 / 65**

---

### Option B1: Microservice (.NET 8)

#### 1. Infrastructure Fit (Score: 2/5, Weighted: 14)
**Rationale:** While .NET 8 can run in a Docker container on EC2, it represents a "foreign body" runtime in a PHP/Go ecosystem. It requires Microsoft base images, new security patching processes for those images, and completely different memory/CPU profiling characteristics than what 12go's infrastructure team is used to tuning.

#### 3. Operational Complexity (Score: 1/5, Weighted: 5)
**Rationale:** Introduces severe unique tooling requirements. If a memory leak or CPU spike occurs in production, 12go's DevOps team cannot use their standard PHP or Go debugging tools; they would need to learn `dotnet-dump`, `dotnet-trace`, and understand the .NET Garbage Collector. This represents a significant new cognitive load for on-call teams.

#### 15. Observability (Score: 4/5, Weighted: 4)
**Rationale:** .NET has excellent native OpenTelemetry and Datadog (`dd-trace-dotnet`) support. However, it requires explicit initial setup to ensure logs and traces format exactly like 12go's existing services, and trace context must be manually propagated across HTTP boundaries.

**Total Score: 23 / 65**

---

### Option B2: Microservice (PHP/Symfony)

#### 1. Infrastructure Fit (Score: 5/5, Weighted: 35)
**Rationale:** Uses the exact same Alpine/PHP-FPM base images and runtime as the rest of 12go. It fits perfectly into their existing Docker/EC2 deployment patterns. It is just another container running a stack they already deeply understand.

#### 3. Operational Complexity (Score: 4/5, Weighted: 20)
**Rationale:** Highly familiar to the ops team. Standard 12go runbooks apply, and debugging uses the exact same PHP tools (Xdebug, Blackfire, etc.). It scores slightly lower than the monolith only because it requires a new CI/CD pipeline and represents an additional moving part in the network topology.

#### 15. Observability (Score: 5/5, Weighted: 5)
**Rationale:** Uses the exact same Datadog instrumentation (`dd-trace-php`) as the main app. Since it's a separate service, distributed tracing headers must be configured, but this is a standard pattern for 12go's microservices.

**Total Score: 60 / 65**

---

### Option B3: Microservice (Go)

#### 1. Infrastructure Fit (Score: 4/5, Weighted: 28)
**Rationale:** Go compiles to a static binary, making Docker images incredibly small (scratch/distroless) with very low memory footprint and fast startup times. It fits excellently into EC2. Since Go is explicitly mentioned as 12go's "long-term technical direction" alongside PHP, it is not a foreign body, though it may be newer to the infrastructure than PHP.

#### 3. Operational Complexity (Score: 3/5, Weighted: 15)
**Rationale:** Moderate complexity. While Go operations are generally simpler than JVM/.NET (no complex GC tuning required), it still represents a different operational model than PHP-FPM. Debugging requires `pprof` and understanding goroutines, which the DevOps team may still be ramping up on compared to their deep PHP expertise.

#### 15. Observability (Score: 4/5, Weighted: 4)
**Rationale:** Excellent OpenTelemetry and Datadog (`dd-trace-go`) support. Requires slightly more manual instrumentation for custom business logic spans compared to PHP/Node's more automatic "magic" APM, but standardizes well.

**Total Score: 47 / 65**

---

### Option B4: Microservice (TypeScript/Node.js)

#### 1. Infrastructure Fit (Score: 2/5, Weighted: 14)
**Rationale:** Similar to .NET, Node.js is a foreign body in 12go's PHP/Go infrastructure. It requires Node base images, new NPM vulnerability scanning in CI/CD, and tuning the Node event loop (V8) for EC2 limits, which diverges from the core team's expertise.

#### 3. Operational Complexity (Score: 2/5, Weighted: 10)
**Rationale:** Requires unique tooling for production debugging. If the event loop gets blocked by synchronous B2B mapping logic, diagnosing it requires Node-specific expertise (clinic.js, Node inspect) that the 12go DevOps team likely lacks, increasing MTTR (Mean Time To Recovery).

#### 15. Observability (Score: 5/5, Weighted: 5)
**Rationale:** Node.js has world-class observability. Datadog (`dd-trace-js`) provides exceptional out-of-the-box automatic instrumentation for almost all libraries, and context propagation is heavily battle-tested.

**Total Score: 29 / 65**

---

## Comparative Matrix

| Option | 1. Infra Fit (x7) | 3. Ops Complexity (x5) | 15. Observability (x1) | **Total Score** |
| :--- | :---: | :---: | :---: | :---: |
| **A (Monolith PHP)** | 5 (35) | 5 (25) | 5 (5) | **65** |
| **B2 (Micro PHP)** | 5 (35) | 4 (20) | 5 (5) | **60** |
| **B3 (Micro Go)** | 4 (28) | 3 (15) | 4 (4) | **47** |
| **B4 (Micro TS)** | 2 (14) | 2 (10) | 5 (5) | **29** |
| **B1 (Micro .NET)** | 2 (14) | 1 (5) | 4 (4) | **23** |