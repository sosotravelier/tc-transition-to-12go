# Context Engineering Patterns for AI-Assisted Development

**Research date**: 2026-04-01
**Purpose**: Patterns for structuring AI context in sidecar knowledge repositories and AI coding tools.

---

## 1. Context Engineering as a Discipline

Context engineering is the successor to prompt engineering. The distinction: **prompt engineering is how you phrase a request; context engineering is what the model knows when it processes that request.**

**Canonical definition** (Philipp Schmid, Google DeepMind): "The discipline of designing and building dynamic systems that provide the right information and tools, in the right format, at the right time."

**Seven-part taxonomy of context**:
1. Instructions / System Prompt
2. User Prompt
3. State / History (short-term memory)
4. Long-term Memory
5. Retrieved Information (RAG)
6. Available Tools
7. Structured Output

**Core insight**: "Most agent failures are not model failures — they are context failures."

**Key voices**: Philipp Schmid, Simon Willison ("prompt engineering was trivialized"), Karpathy ("the delicate art of filling the context window"), Swyx ("everything that makes agents good is context engineering"), Anthropic (September 2025 guide).

---

## 2. Progressive Context Building

### Three-Layer Architecture (Progressive Disclosure)

- **Layer 1 (Index)**: Lightweight metadata — titles, descriptions, capabilities. Sufficient for routing.
- **Layer 2 (Details)**: Full content loaded only when relevance is established.
- **Layer 3 (Deep Dive)**: Supporting materials accessed during execution.

### Claude Code's Native Implementation

- CLAUDE.md loads at session start (Layer 1)
- glob/grep enable just-in-time file discovery (Layer 2)
- Skills load dynamically when needed (Layer 3)
- Compaction summarizes history when nearing limits, preserving architectural decisions

### Key Insights

- Stanford "lost in the middle" research: LLMs degrade when key info sits in the middle of long contexts. Front or end placement is critical.
- Maximum 2-3 disclosure layers. Deeper chains add complexity without benefit.
- Front-loading provides immediate availability but introduces noise; on-demand loading keeps context clean but adds latency.

**Ref**: [Progressive Disclosure for AI Agents](https://www.honra.io/articles/progressive-disclosure-for-ai-agents), [Skills as Progressive Disclosure](https://marcelcastrobr.github.io/posts/2026-01-29-Skills-Context-Engineering.html)

---

## 3. Knowledge Graphs / Structured Context

Graph-structured context **cuts token usage roughly in half** compared to raw file dumps.

- **Graphiti (Zep)**: Real-time temporal knowledge graphs for agents
- **Neo4j GraphRAG**: Graph as retrieval layer — start from identifier, traverse relationships
- **aictrl.dev**: MCP-compatible knowledge graph tools (`query_context`, `update_backlog`) for Claude Code, Cursor, Windsurf
- **TrustGraph**: AI-optimized "Context Graphs"

Pattern: expose graph-structured context via MCP tools, giving agents structural understanding without custom integration.

---

## 4. Sidecar Documentation / Companion Repository

### The Codified Context Paper (arXiv:2602.20478)

The most rigorous treatment. Three-tier architecture built during 108,000-line C# project:

**Tier 1: Project Constitution (Hot Memory)**
- ~660-line Markdown file loaded every session
- Contains: code standards, naming conventions, build procedures, architectural summaries, known failure modes, trigger-based routing tables
- Prioritizes conciseness; details belong in Tier 3

**Tier 2: Specialized Domain Agents**
- 19 agent specs (115-1,233 lines each, ~9,300 lines total)
- Critical: >50% of content is domain facts, NOT behavioral instructions
- Embedded knowledge beats retrieval for complex, bug-prone domains

**Tier 3: Knowledge Base (Cold Memory)**
- 34 Markdown specs (~16,250 lines), served on-demand via MCP server
- Five retrieval tools: `list_subsystems()`, `get_files_for_subsystem()`, `find_relevant_context()`, `search_context_documents()`, `suggest_agent()`
- Written for AI consumption: explicit code patterns, file paths, "do this / don't do this"

**Key findings**:
- 24.2% of codebase was context infrastructure
- Maintenance: 1-2 hours/week (5 min per session + biweekly 30-45 min reviews)
- Primary failure mode: **specification staleness** — agents trust docs absolutely
- "Repeated explanation signals codification" — if you explain something twice, write a spec
- "Agent confusion indicates gaps"

**Ref**: [arXiv:2602.20478](https://arxiv.org/abs/2602.20478), [GitHub](https://github.com/arisvas4/codified-context-infrastructure)

---

## 5. Single Source of Truth Patterns

### Canonical Document Architecture

Central versioned document → all agents pull from same source. Shared file system: one agent writes, others read.

### Addy Osmani's SPEC.md Pattern

Six core areas: Commands, Testing, Project Structure, Code Style, Git Workflow, Boundaries. Three-tier constraint system: Always do / Ask first / Never do. Keep focused and modular; feed only the relevant slice per task.

### Anti-Pattern: AI-Generated Rules

Research shows human-curated AGENTS.md yields ~4% improvement. AI-generated rules marginally *decrease* success rates (~3% worse). Human curation is essential.

### Context Compression

- Canonical summaries replace repeated tool outputs with one "current truth"
- Schema compression: typed fields rather than prose

---

## 6. Claude Code / AI IDE Best Practices

### Claude Code's Three Memory Layers

1. **CLAUDE.md**: Per-project persistent instructions, loaded at session start
2. **Auto Memory**: Cross-session accumulation (build commands, debugging insights, code style)
3. **Auto-Dream** (March 2026): Background agent that consolidates memory files between sessions

### Practitioner Best Practices

- Keep CLAUDE.md under 200 lines; link to skills for detail
- For each line, ask: "Would removing this cause Claude to make mistakes?" If not, cut it
- **Aggressive `/clear` when switching tasks** — context degradation is #1 failure mode
- Sub-agents return condensed summaries (1,000-2,000 tokens) to coordinators
- Plan before implementing — always

### Multi-Agent Orchestration Tiers (2026)

1. **Single session**: Claude Code subagents and Agent Teams (simplest)
2. **Local orchestration**: Multiple agents in isolated git worktrees (3-10 agents)
3. **Cloud-based**: Agents in cloud VMs, async execution, return PRs

### Conflict Prevention

- One agent per file — never allow concurrent edits
- Git worktrees for isolated workspaces
- Shared task lists track dependencies
- Peer messaging between agents

---

## 7. CLAUDE.md / AGENTS.md Patterns

### Effective CLAUDE.md Content

- Project overview and architecture (major components)
- Tech stack details
- Coding conventions (one real code snippet beats paragraphs)
- Folder structure explanations
- Build/test commands with full flags
- Hard constraints ("never do X")
- Links to detailed docs (not inline detail)

### AGENTS.md Patterns

- Single versioned file as source of truth
- Updated at end of agent tasks with new learnings
- **Human-curated only** — AI-generated rules hurt performance
- Maps agent roles to file ownership and responsibilities

### The Constitution Approach (Codified Context)

Single ~660-line file with:
- Trigger tables mapping file patterns to specialist agents
- Concise summaries linking to detailed specs
- Routing logic so developers don't need to remember which agent handles what
- Updated alongside code changes (5 min overhead)

---

## Actionable Patterns for This Project

1. **Already aligned**: CLAUDE.md → AGENTS.md → .claude/agents/ → prompts/context/ maps to three-tier hot/cold architecture
2. **Add trigger-based routing**: CLAUDE.md table mapping task types to agents
3. **Progressive disclosure via Skills**: Already implemented — research validates the pattern
4. **Monitor staleness**: Add `last_verified` dates to key docs + review cadence
5. **Context compression for handoffs**: Condensed summaries (1-2K tokens) between agent phases
6. **Knowledge graph potential**: For F3 codebase, MCP-exposed graph could halve token usage
7. **Auto-Dream**: Enable for memory consolidation between sessions

---

## Sources

- [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Philipp Schmid: Context Engineering](https://www.philschmid.de/context-engineering)
- [Simon Willison: Context Engineering](https://simonwillison.net/2025/jun/27/context-engineering/)
- [Codified Context (arXiv:2602.20478)](https://arxiv.org/abs/2602.20478)
- [Addy Osmani: Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/)
- [Addy Osmani: Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/)
- [Progressive Disclosure for AI Agents](https://www.honra.io/articles/progressive-disclosure-for-ai-agents)
- [GitHub Blog: Reliable AI Workflows](https://github.blog/ai-and-ml/github-copilot/how-to-build-reliable-ai-workflows-with-agentic-primitives-and-context-engineering/)
- [Neo4j: Context Engineering vs Prompt Engineering](https://neo4j.com/blog/agentic-ai/context-engineering-vs-prompt-engineering/)
- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)
- [State of Context Engineering 2026](https://www.newsletter.swirlai.com/p/state-of-context-engineering-in-2026)
- [Zep: Context Engineering Platform](https://www.getzep.com/)
- [aictrl.dev](https://aictrl.dev/features/knowledge-graph)
