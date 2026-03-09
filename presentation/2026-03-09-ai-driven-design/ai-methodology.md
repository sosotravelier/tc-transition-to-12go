# AI-Driven Architecture Design

**Internal Presentation** | Mar 2026

---

## How I Approach Working with AI

### The Tooling Layer: Car, Engine, Driver

Think of AI coding tools in three layers:


| Layer                      | Analogy                                      | Examples                              |
| -------------------------- | -------------------------------------------- | ------------------------------------- |
| **Tool** (IDE integration) | The car -- chassis, controls, UX             | Cursor, Copilot, Claude Code          |
| **Model** (LLM)            | The engine -- capability, power              | Claude Opus, Sonnet, Gemini Flash/Pro |
| **Human**                  | The driver -- direction, judgment, decisions | You                                   |


A great engine in the wrong hands still crashes. A skilled driver with a weak engine is limited. The driver decides where to go and how to get there -- the engine provides the power.

Not every drive needs a racing engine. I use different models for different tasks:


| Mode          | Model                              | When to use                                                        |
| ------------- | ---------------------------------- | ------------------------------------------------------------------ |
| **Planning**  | Opus, Gpt, Gemini Pro, Sonnet      | Design proposals, synthesis, decisions requiring deep reasoning    |
| **Execution** | Sonnet, Gemini Flash/Pro, Composer | Writing code from a clear spec, filling templates, mechanical work |


### The Model Layer: A Room Full of Specialists

The car analogy covers the tooling, but it misses something important about *the engine itself*. A real car engine produces the same horsepower regardless of where you drive. An LLM does not. The same model produces radically different output depending on the context you give it.

Think of the model as a room full of specialists -- architects, DBAs, DevOps engineers, PHP veterans, .NET seniors, junior developers -- all sitting silently. Your prompt is a question shouted into the room. **Who stands up to answer depends on how you phrase it.**

Ask a generic beginner question, and the junior developers rush to the front -- you get Stack Overflow territory. Give it a specific role, a concrete situation, and rich domain context, and different specialists activate.

> **A domain-specific example**: We needed to propose transition designs. If you ask the model "design a replacement for our B2B proxy layer" with an AWS Solutions Architect persona, it reaches for Lambda functions, API Gateway, Step Functions -- it tries to decompose the system into stateless transformations because that's what the "AWS architect" region of its knowledge does. Ask the same question with a ".NET architect" persona, and it proposes an EC2-hosted microservice with Minimal API and Refit. The input data is identical. The system description is identical. But the persona changes which design patterns the model reaches for. This is why we used 4 separate design agents -- not because we needed 4 answers, but because each persona activates different architectural instincts.

### Multi-Agent: From Driver to Fleet Dispatcher

With sub-agents, the analogy shifts. You are no longer a single driver -- you are a **fleet dispatcher**. You define routes, assign a driver to each car, send them out in parallel, and synthesize what they bring back. The orchestrator is the dispatcher. Sub-agents are drivers on independent routes. The map-reduce pattern is: dispatch the fleet, wait for all to return, consolidate findings.

---

## The Task: What I Was Trying to Do

The approaches described here are general. The specific task I applied them to: designing the B2B API transition.

We have 4 repositories (~342 .csproj projects) that essentially proxy HTTP calls from B2B clients to 12go. The goal was to design a replacement -- something simpler that preserves the client API contract, removes local storage, and fits into 12go's infrastructure.

This requires three distinct types of work: understanding what currently exists, proposing how to replace it, and evaluating the options against each other. All three are naturally parallelizable and well-suited to AI agents.

---

## The Approach: 3 Phases

Each phase builds on the one below. The output of one phase becomes the input context for the next.

```mermaid
flowchart TD
    subgraph prereq["Prerequisite: Workspace"]
        W["Multi-repo workspace: etna + denali + SI + fuji + transition-design"]
    end

    subgraph p1["Phase 1: Current-State"]
        CS["AI reads code, produces documentation of what exists"]
    end

    subgraph p2["Phase 2: Design"]
        D["Independent agents propose architectures"]
    end

    subgraph p3["Phase 3: Evaluation"]
        E["Analyzer agents score designs against weighted criteria"]
    end

    prereq --> p1
    p1 -->|"24 docs, 7K+ lines"| p2
    p2 -->|"5 designs, decision map"| p3
    p3 -->|"3 rounds, comparison matrix"| R["Scored recommendation"]
```




| Phase                | Input                      | Agents                           | Output                                                           |
| -------------------- | -------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| **Prerequisite**     | Raw repos                  | --                               | Workspace, `AGENTS.md`, context prompts                          |
| **1. Current-State** | Big prompt + code pointers | 4+ documenter agents             | 25 markdown files (13 endpoints, 4 cross-cutting, 3 integration) |
| **2. Design**        | Current-state docs         | 4 design agents (1 per language) | Monolith design + 4 microservice variants, decision map          |
| **3. Evaluation**    | Design docs + criteria     | 4 analyzer agents x 3 rounds     | 12 analysis reports, 3 comparison matrices, recommendation       |


---

## How Sub-Agents Work: Map-Reduce

The orchestrator (main AI agent in Cursor) breaks a large task into independent subtasks, spawns parallel sub-agents, waits for them to finish, and consolidates the results.

```mermaid
flowchart TD
    ORCH["Orchestrator (main agent)"]

    ORCH -->|"MAP: split into independent tasks"| A1
    ORCH --> A2
    ORCH --> A3
    ORCH --> A4

    subgraph parallel["Running in parallel"]
        A1["Agent 1: Task 1"]
        A2["Agent 2: Task 2"]
        A3["Agent 3: Task 3"]
        A4["Agent 4: Task 4"]
    end

    A1 --> REDUCE
    A2 --> REDUCE
    A3 --> REDUCE
    A4 --> REDUCE

    REDUCE["Orchestrator: REDUCE — consolidate all results into final output"]
```



This matters because:

- **Independence** -- each agent works on a separate concern, no interference between them
- **Speed** -- 4 agents in parallel instead of 4 sequential analyses
- **Quality** -- each agent gets a focused prompt with role and constraints instead of one massive prompt trying to cover everything

---

## Phase 1: Document the Current State

**Goal**: Turn undocumented source code into structured documentation that AI (and humans) can use as foundation for design.

**Why code pointers matter**: Current repos have 50+ csprojs. Letting AI explore blindly wastes context and time. Instead, the initial prompt gave specific pointers -- which controllers matter, where the 12go integration lives, what the client flow looks like. AI then traced the actual code to produce docs with real DTOs, real sequence diagrams, real endpoint contracts.

```mermaid
flowchart LR
    subgraph input["Input"]
        P["Big prompt: system description + code pointers"]
    end

    subgraph map["MAP: 4+ parallel agents"]
        DA["Denali Agent"]
        EA["Etna Agent"]
        SA["SI Host Agent"]
        FA["Fuji Agent"]
    end

    subgraph reduce["REDUCE"]
        OV["Overview + architecture diagrams"]
        Q["20 questions for 12go"]
    end

    input --> DA
    input --> EA
    input --> SA
    input --> FA
    DA --> reduce
    EA --> reduce
    SA --> reduce
    FA --> reduce
```



**Verification**: Manually spot-checked a few generated documents against actual source code. If those were accurate, the rest was trusted.

**Output**: `current-state/` -- 24 files


| Category             | Count | Examples                                                  |
| -------------------- | ----- | --------------------------------------------------------- |
| Endpoint docs        | 13    | search, get-itinerary, create-booking, confirm, seat-lock |
| Cross-cutting        | 4     | authentication, monitoring, data-storage, messaging       |
| Integration analysis | 3     | 12go API surface, service layer, caching strategy         |
| Context docs         | 2     | system-context.md, codebase-analysis.md                   |


### This Step Should Not Have Been Necessary

In a healthy environment, Phase 1 wouldn't exist as a one-time catch-up effort. Documentation of what a system does -- its contracts, flows, and trade-offs -- should accumulate continuously as the system is built. Product, QA, architects, and developers all contribute. Not just for humans to read, but so that AI agents can use it as a reliable starting point instead of having to reverse-engineer knowledge from source code.

This documentation effort was done here from scratch because it didn't exist. Months earlier, similar AI-first documentation was built for the `supply-integration` repository -- and because that repo already had it, AI could digest its code far more easily during this transition work. The contrast is telling: when documentation exists, AI just uses it. When it doesn't, you spend a full phase creating it before any real work can begin.

**The cost of undocumented systems is rising.** When knowledge lives in developers' heads and decisions happen verbally, not only does onboarding new people take longer -- AI-assisted development is also degraded. An AI agent working from code alone will miss context that a well-maintained doc would have made explicit in seconds. The Phase 1 work is technical debt, accumulated from not writing down what you know as you build.

---

## Phase 2: Propose Designs

**Goal**: Generate multiple architecture proposals independently, then group them into a decision tree.

**Divide and conquer.** Instead of asking one agent "design the whole transition," the problem was broken into a tree of smaller decisions. First: monolith or microservice? If microservice: which language? If that language: which framework? Each sub-problem can be evaluated independently, and the decision map captures all of them.

Each design agent received the same input -- current-state docs, system context, constraints (preserve 13 endpoints, <10K LOC, no DynamoDB) -- but a different persona:


| Agent                | Persona                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| .NET Architect       | Senior .NET architect specializing in lean, high-performance API services         |
| PHP Architect        | Symfony expert focused on monolith-first pragmatism and infrastructure alignment  |
| Go Architect         | Go systems engineer focused on simplicity, performance, and minimal dependencies  |
| TypeScript Architect | Full-stack architect focused on developer experience and AI-augmented development |


```mermaid
flowchart LR
    subgraph input2["Input: current-state docs + system context"]
        CS2["24 docs from Phase 1"]
    end

    subgraph map2["MAP: 4 design agents"]
        DN[".NET Architect"]
        PH["PHP Architect"]
        GO["Go Architect"]
        TS["TypeScript Architect"]
    end

    subgraph reduce2["REDUCE: group + decision tree"]
        DM["Decision Map: 15+ decisions"]
        ALT["5 design variants"]
    end

    CS2 --> DN
    CS2 --> PH
    CS2 --> GO
    CS2 --> TS
    DN --> reduce2
    PH --> reduce2
    GO --> reduce2
    TS --> reduce2
```



**Key insight**: The 4 agents converged on similar structures. The .NET agent proposed a microservice; the PHP agent proposed a monolith. But the core proxy pattern was the same across all. This convergence validated the approach -- and made it natural to group them into a decision tree instead of treating them as 4 separate proposals.

**Decision Map structure**:

```mermaid
flowchart LR
    D1["Monolith or Microservice?"]
    D1 -->|Monolith| A["PHP inside F3"]
    D1 -->|Microservice| D2["Which language?"]
    D2 --> L1[".NET"]
    D2 --> L2["Go"]
    D2 --> L3["PHP"]
    D2 --> L4["TypeScript"]
    D2 --> D3["Which framework?"]
```



---

## Phase 3: Evaluate Designs

**Goal**: Score each design variant against weighted criteria using independent evaluator agents.

```mermaid
flowchart LR
    subgraph input3["Input"]
        DES["5 design variants"]
        CRIT["14 weighted criteria"]
    end

    subgraph map3["MAP: 4 analyzer agents"]
        TV["Team / Velocity"]
        AP["Architecture / Performance"]
        OI["Operations / Infra"]
        RM["Risk / Migration"]
    end

    subgraph reduce3["REDUCE"]
        CM["Comparison Matrix"]
        REC["Recommendation"]
    end

    input3 --> TV
    input3 --> AP
    input3 --> OI
    input3 --> RM
    TV --> reduce3
    AP --> reduce3
    OI --> reduce3
    RM --> reduce3
```



**The 3 evaluation rounds**: After the first run, the weights felt wrong -- too execution-focused. Criteria were revised and the full pipeline was re-run. A third version deliberately boosted weights to favor PHP/monolith, stress-testing whether the recommendation was robust.

```mermaid
flowchart TD
    V1["v1: Execution-focused weights"]
    V2["v2: Balanced weights"]
    V3["v3: Strategic weights — PHP-favored"]

    V1 -->|".NET wins — 118 pts"| R1["Revisit weights"]
    R1 --> V2
    V2 -->|".NET wins — 127 pts"| R2["Maximize PHP advantage"]
    R2 --> V3
    V3 -->|"Go 180 / PHP 178 / .NET 155"| R3["Microservice wins under all weight profiles"]
```



**Key takeaway**: Even when weights were manipulated to favor PHP monolith, it never won outright. The microservice pattern was consistently preferred across all 3 rounds.

---

## Error Propagation Between Phases

Each phase introduces some inaccuracy -- from AI hallucination, incomplete prompting, or missing context. The question is: does the next phase absorb the error or amplify it?

```mermaid
flowchart TD
    subgraph phase1["Phase 1: Current-State"]
        S1["Signal: endpoint contracts, diagrams, API surface"]
        N1["Noise: 2 missing csprojs, omitted DTO field"]
    end

    subgraph phase2["Phase 2: Design"]
        S2["Signal: proxy architecture, decision tree"]
        N2["Noise: 12go assumed = unmodifiable black box"]
    end

    subgraph phase3["Phase 3: Evaluation"]
        S3["Signal: consistent ranking across 3 rounds"]
        N3["Noise: scores built on wrong assumptions"]
    end

    S1 -->|"correct foundation"| S2
    N1 -.->|"absorbed"| S2
    S2 -->|"good designs"| S3
    N2 -.->|"AMPLIFIED"| N3
```




| Error Type    | Example                                   | Impact                                                                                                          |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Absorbed**  | Reported 56 csprojs, actually 58          | Zero impact on architecture decisions                                                                           |
| **Absorbed**  | Missing one field in booking DTO doc      | Design pattern is the same either way                                                                           |
| **Absorbed**  | Incomplete description of caching layers  | Design eliminates all caches anyway                                                                             |
| **AMPLIFIED** | Assumed 12go is an unmodifiable black box | All designs treated F3 as external-only. Meeting revealed F3 can be modified -- changed the entire option space |
| **AMPLIFIED** | Event requirements were unknown           | Sunsetting .NET services would drop events the data team may still depend on -- not surfaced until the meeting  |
| **Caught**    | Arithmetic errors in comparison matrix    | AI summed weighted scores incorrectly in Phase 3. Required manual intervention to verify and correct the totals. Score rankings were right, but the exact numbers were off -- a reminder that numerical reasoning is a weak spot |


**The architect's abstraction principle**: This is the same tolerance a human architect applies. When designing at the system level, a missing DTO field doesn't change the architecture. The risk is in *structural* assumptions, not implementation details.

**Phase 3 is most sensitive**: It sits at the top of the pyramid and inherits errors from both Phase 1 and Phase 2. An incorrect structural assumption in Phase 1 that survives into Phase 2 will distort the evaluation scores in Phase 3.

---

## The Feedback Loop

The process doesn't end with evaluation. Presenting the results to stakeholders surfaces new information that feeds back into the documentation.

```mermaid
flowchart TD
    P1["Phase 1: Current-State"] --> P2["Phase 2: Design"] --> P3["Phase 3: Evaluation"]
    P3 --> PRES["Present to stakeholders"]
    PRES --> NEW["New context surfaces"]
    NEW --> UPD["Update docs / system context"]
    UPD --> NEXT["Next decision / POC"]
```

**What the meeting revealed**:

- F3 breakdown is planned (no timeline) -- code written inside F3 today may require a second migration
- Sunsetting .NET services would drop events that the data team may still depend on -- the meeting revealed this was an open question, not a resolved one (F3 currently publishes events for ClickHouse; it's unclear which of our events need to be preserved or recreated)
- .NET microservice was not ruled out -- decision deferred, not rejected
- 12go is not a black box -- the assumption that shaped all designs was wrong

**Where the loop stands now**: System context and current-state docs were updated after the meeting. Phase 2 designs have not been re-generated yet -- that would happen once the POC is complete and the architecture decision is revisited.

**Result**: Decision deferred. POC requested: implement Search endpoint inside F3 to evaluate friction. The full documentation produced by this process is being used to implement that POC.

---

## Side Effects: What We Got For Free

The primary goal was a scored recommendation. The process also produced artifacts that are independently valuable.

Before this process, a developer asking "how does the booking flow work?" had to read source code across 3 repositories. Now there is a document with a sequence diagram. But this only helps if the documentation is discoverable. A repo that only the author knows about is not much better than no docs. Two options:

- **Push to where people already look** -- publish key docs to Confluence or Notion so they surface in existing searches
- **Adopt the sidecar repo as a convention** -- agree as a team that `transition-design` is the authoritative knowledge base for this module, and that developers working on it open it alongside the source repos (the way it's set up in this workspace)

Both are valid. The sidecar approach has the advantage that documentation lives close to the code and can be versioned with it. The trade-off is that it requires a team agreement to actually use it.

- **24 current-state docs** (13 endpoints, 4 cross-cutting, 3 integration analyses) -- now used directly for F3 POC implementation
- **System context document** -- onboarding material for new developers and AI agents, capturing domain knowledge that previously lived only in people's heads
- **Decision map** -- 15+ decisions with options and trade-offs, ready for any future re-evaluation
- **Reusable prompt templates** -- design agents, analyzer agents, evaluation criteria -- can be applied to any future design task
- **Meeting-ready presentation** -- diagrams and scored comparison tables, ready to present without additional preparation

---

## What This Presentation Does Not Do

This presentation shows one approach to one task. It does not hand you a ready-made workflow.

- **Each developer is responsible for adapting these patterns to their own daily work.** The map-reduce pattern, the phased approach, the prompt templates -- these are tools. Whether and how you use them is up to you.
- **We still need to decide where documentation and rules live.** Right now, context docs sit in `transition-design/`, agent rules sit in `supply-integration/rules/`, and nothing is in Confluence. We need a team decision on where shared knowledge should accumulate so that both humans and AI can find it.
- **AI can bridge our existing tools.** I use MCP (Model Context Protocol) integrations with Jira, Confluence, and Notion -- meaning the AI agent can read from and write to those systems directly. For example, it can create Jira tickets from a design doc, publish documentation to Confluence, or query Notion for context. This is not set up for the team yet, but it's available.


