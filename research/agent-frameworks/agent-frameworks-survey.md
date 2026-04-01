# AI Agent Frameworks & Architectures: Survey

**Research date**: 2026-04-01
**Purpose**: Identify borrowable patterns for maintaining consistent AI context across a sidecar knowledge repository.

---

## 1. Context Management Patterns

### The Core Problem

LLM context windows are finite, attention quality degrades as token count grows, and agents are stateless by default. The field converged on **"context engineering"** as the successor to prompt engineering — defined by Anthropic as "curating and maintaining the optimal set of tokens during LLM inference."

**Key failure modes** (Weaviate taxonomy):
- **Context Poisoning**: Incorrect information compounds across iterations
- **Context Distraction**: Excessive history triggers reliance on past behavior over fresh reasoning
- **Context Confusion**: Irrelevant tools/documents misdirect the model
- **Context Clash**: Contradictory information creates decision paralysis

~65% of enterprise AI failures in 2025 attributed to context drift or memory loss, not raw context exhaustion.

### Pattern: Explicit State Schemas (LangGraph)

Typed state objects (`TypedDict` with reducer functions) as centralized, mutable context that all graph nodes can read and write. Checkpointing persists state to external storage for pause/resume and crash recovery.

**Borrowable**: Defining explicit typed structures for what agents know rather than relying on conversation history.

### Pattern: Just-in-Time Context Loading (Anthropic)

Agents maintain lightweight identifiers (file paths, URLs) and dynamically load context using tools. Hybrid approach: "hot" always-loaded context (constitution/rules) + "cold" on-demand retrieval (specifications/details).

**Borrowable**: The three-tier loading strategy is directly applicable to a sidecar knowledge repo.

### Pattern: Three-Tier Context Architecture (Codified Context Paper)

From arXiv:2602.20478 — validated during construction of 108,000-line C# system across 283 sessions:

1. **Hot Memory / Constitution** (~660 lines, always loaded): Standards, naming conventions, architectural summaries, trigger tables mapping file patterns to agents
2. **Domain Expert Agents** (19 agents, ~9,300 lines, invoked per task): >50% is domain knowledge, not behavioral instructions
3. **Cold Memory / Knowledge Base** (34 docs, ~16,250 lines, retrieved on demand via MCP)

Key results:
- 80%+ of human prompts under 100 words (pre-loaded context reduces explanation need)
- Context infrastructure = 24.2% of total codebase
- Maintenance: ~1-2 hours/week with biweekly review passes
- Drift detector parses Git commits against subsystem-to-file mapping

**Ref**: [arXiv:2602.20478](https://arxiv.org/abs/2602.20478), [GitHub](https://github.com/arisvas4/codified-context-infrastructure)

---

## 2. Memory Architectures

### Taxonomy

| Memory Type | Human Analog | Agent Implementation | Update Frequency |
|---|---|---|---|
| **Working Memory** | Current thoughts | Context window, scratchpad | Every turn |
| **Episodic Memory** | Specific experiences | Conversation logs, interaction records | Per interaction |
| **Semantic Memory** | General knowledge | Knowledge base, extracted facts, knowledge graphs | Consolidated from episodic |
| **Procedural Memory** | Skills, habits | Tools, learned workflows, prompt templates | Slow evolution |

### MemGPT / Letta: LLM-as-Operating-System

LLM manages its own memory hierarchy like an OS managing RAM and disk. Agent explicitly decides what to keep in context ("RAM") and what to page out ("disk").

- **Core Memory Blocks**: Persistent labeled blocks (goals, preferences, persona) always injected, editable by the agent itself
- **Recall Memory**: Searchable conversation history
- **Archival Memory**: External database for long-term storage

**Borrowable**: Editable, labeled memory blocks that persist across sessions = sidecar documents. Agent-editable aspect is key.

**Ref**: [Letta docs](https://docs.letta.com/concepts/memgpt/), [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)

### Mem0: Universal Memory Layer

Standalone memory layer between application and LLM. Two-phase pipeline: (1) extract facts from conversations, (2) consolidate with importance scoring. 26% accuracy improvement over OpenAI Memory, 91% faster, 90% lower tokens.

**Borrowable**: Automatic fact extraction and consolidation after each agent session.

**Ref**: [mem0.ai](https://mem0.ai/), [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)

### CrewAI: Unified Memory with Scoped Access

Before each task: agent recalls relevant context and injects into prompt. After each task: crew auto-extracts discrete facts and stores them. Composite scoring: semantic similarity + recency + importance.

**Borrowable**: Auto-extract-after-task / inject-before-task lifecycle.

### Zep/Graphiti: Temporal Knowledge Graphs

Temporally-aware knowledge graph engine. Three-tier subgraph: episodes (raw data) → semantic entities (extracted with temporal validity intervals) → communities (summarized clusters).

Key innovation: **bi-temporal model** tracking when events occurred AND when ingested. Old facts invalidated, not deleted — enables "what was true at time X?" queries. 94.8% accuracy on Deep Memory Retrieval.

**Borrowable**: Temporal validity model prevents agents from acting on stale information. Invalidation-not-deletion preserves audit trail.

**Ref**: [arXiv:2501.13956](https://arxiv.org/abs/2501.13956), [GitHub](https://github.com/getzep/graphiti)

---

## 3. Agent Orchestration Patterns

### Catalogue (Azure Architecture Center, Feb 2026)

| Pattern | Description | Best For |
|---|---|---|
| **Sequential** | Linear pipeline | Progressive refinement |
| **Concurrent (Fan-out/Fan-in)** | Parallel processing, aggregation | Diverse perspectives |
| **Group Chat** | Shared thread, chat manager | Brainstorming, validation |
| **Handoff** | Control transfer with context | Triage, escalation |
| **Magentic** | Ledger-based dynamic orchestration | Complex multi-step, evolving requirements |

### Orchestrator-Workers (Anthropic)

Lead agent spawns subagents returning condensed summaries (1,000-2,000 tokens). Research plans saved to external memory to persist beyond 200K token window. ~15x more tokens than chat — requires tasks with sufficient value.

**Borrowable**: "Summarize completed work and store in external memory before proceeding."

**Ref**: [Anthropic Multi-Agent Research](https://www.anthropic.com/engineering/multi-agent-research-system)

### Reflection / Reflexion

Iterative: generate → evaluate → refine. Reflexion stores verbal reflections on failed attempts in memory, conditioning future attempts on accumulated self-critiques. Multi-Agent Reflexion (MAR) uses multiple LLM critics with varied reasoning strategies.

**Borrowable**: Structured reflections/post-mortems after each session as first-class knowledge artifacts.

### Long-Running Agent Harnesses (Anthropic)

Two-agent architecture: Initializer Agent sets up scaffolding once, Coding Agent executes with clean state. State persistence via `claude-progress.txt` (read at session start) + git checkpointing + feature manifest (JSON with `passes` boolean).

**Borrowable**: Progress file + feature manifest = lightweight sidecar knowledge repo.

**Ref**: [Anthropic Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

---

## 4. Ground Truth / Drift Prevention

### Eight Tactics for Preventing Drift (Lumenalta)

1. Central shared task spec as single reference document
2. Scoped, role-specific context per agent
3. External memory with selective retrieval
4. Aggressive history trimming and summarization
5. Coordinator/arbiter agent for conflict detection
6. Structured state and protocols (plan-propose-review-finalize)
7. Guardrail prompts and validation checks
8. Observability and feedback loops

### Specification-as-Infrastructure (Codified Context Paper)

Treat documentation as load-bearing infrastructure. When code changes without spec updates, agents generate code based on stale information. Mitigation: updates in same session as code changes (~5 min overhead), drift detector, biweekly review passes.

### ACE: Evolving Playbooks (Stanford/SambaNova)

Structured, itemized bullet collections that evolve through granular delta updates. Generator → Reflector → Curator pipeline with helpful/harmful counters and deterministic merging. +10.6% on agent benchmarks.

**Borrowable**: Delta updates (not full rewrites) with helpful/harmful counters prevent context collapse.

**Ref**: [arXiv:2510.04618](https://arxiv.org/abs/2510.04618)

### Anchored Iterative Summarization

"Anchor" document remains stable. Conversation history gets progressively summarized. Anchor + latest summary + recent messages = context for each turn. Prevents anchor dilution by conversation noise.

---

## 5. Framework Reference Table

| Framework | Context/State | Memory | Sidecar Relevance |
|---|---|---|---|
| **LangGraph** | Typed state schemas + reducers + checkpointing | Thread-scoped + cross-thread | State schema patterns |
| **CrewAI** | Unified Memory with LLM-analyzed storage | Auto-extract/inject lifecycle | Extract-after/inject-before |
| **AutoGen → Agent Framework** | Session-based persistence | Runtime → persistent evolution | Session-based state management |
| **DSPy** | Modules manage own prompts/state | No persistent memory | Systematic prompt optimization |
| **Semantic Kernel** | Vector DB + middleware pipeline | Chunking/embedding/indexing | Middleware for context enrichment |
| **OpenAI Agents SDK** | Agents-as-tools, handoffs carry context | Session-based persistence | Handoff pattern for knowledge passing |
| **Anthropic Patterns** | CLAUDE.md + tools + sub-agents | External files, progress logs | CLAUDE.md IS a sidecar artifact |
| **Letta/MemGPT** | Agent-editable core memory blocks | Self-managed memory hierarchy | Editable persistent memory blocks |
| **Mem0** | Auto-extraction + consolidation | Graph variant for relationships | Memory-as-a-service |
| **Zep/Graphiti** | Temporal knowledge graph | Bi-temporal validity intervals | Staleness detection |

---

## 6. Synthesis: What's Borrowable

### Directly Applicable Patterns

1. **Three-Tier Architecture** (Codified Context): Hot constitution + domain agents + cold knowledge base via MCP
2. **Temporal Validity** (Zep): Tag knowledge with validity intervals
3. **Structured Delta Updates** (ACE): Granular deltas, not full rewrites
4. **Auto-Extract/Inject** (CrewAI, Mem0): Extract facts after session, inject before next
5. **Drift Detection** (Codified Context): Git commits vs knowledge-to-file mappings
6. **Editable Memory Blocks** (Letta): Agents update own knowledge via tool calls
7. **Progress Files** (Anthropic): Lightweight cross-session state
8. **Anchor Protection**: Core docs protected from summarization

### Design Principles

- Start simple — composable patterns beat complex frameworks
- Context is finite — quality over quantity even with 200K+ windows
- Documentation is infrastructure — stale docs are bugs
- Hybrid retrieval — pre-loaded hot + on-demand cold via tools
- Observability — log what context was loaded and what decisions resulted

---

## Sources

- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Long-Running Agent Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Codified Context (arXiv:2602.20478)](https://arxiv.org/abs/2602.20478)
- [ACE (arXiv:2510.04618)](https://arxiv.org/abs/2510.04618)
- [Zep (arXiv:2501.13956)](https://arxiv.org/abs/2501.13956)
- [Memory in the Age of AI Agents (arXiv:2512.13564)](https://arxiv.org/abs/2512.13564)
- [LangGraph](https://www.langchain.com/langgraph)
- [CrewAI Memory](https://docs.crewai.com/en/concepts/memory)
- [Mem0](https://mem0.ai/)
- [Letta/MemGPT](https://docs.letta.com/concepts/memgpt/)
- [DSPy](https://dspy.ai/)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [Azure AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [8 Tactics to Reduce Context Drift](https://lumenalta.com/insights/8-tactics-to-reduce-context-drift-with-parallel-ai-agents)
- [Weaviate Context Engineering](https://weaviate.io/blog/context-engineering)
