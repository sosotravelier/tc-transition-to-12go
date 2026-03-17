---
paths:
  - "design/**/*.md"
---

# Design Document Rules

These rules apply to all markdown files under `design/`.

## Required Frontmatter

Every design document must include YAML frontmatter with these fields:

```yaml
---
status: draft | review | complete
last_updated: YYYY-MM-DD
agent: <agent-name>
---
```

- `status`: One of `draft`, `review`, or `complete`
- `last_updated`: Date in ISO format
- `agent`: Name of the agent that produced the document (e.g., `pragmatic-minimalist`, `red-team`)

## Required Sections

### Security Section
Every design document must include a `## Security` section. This addresses Key Finding #10 from the Phase 1 analysis: webhook notifications from 12go have zero authentication. The security section must be specific — "add HMAC signature verification" is better than "add security."

## Diagram Standards

Mermaid diagrams in design documents must use one of:
- `sequenceDiagram` — for endpoint flows and interaction patterns
- `flowchart LR` — for architecture overviews and decision trees

### Critical rendering rules
- **One decision question per mermaid block.** NEVER combine multiple independent decision questions (disconnected subgraphs) into a single diagram — they render as scattered clusters with huge whitespace gaps. Each `{decision?}` node gets its own fenced mermaid block.
- Do not use `flowchart TD` for decision trees (renders as tall vertical chains, hard to read).
- Keep labels short (2-3 lines max). Move details into prose or bullet lists below the diagram.
- Maximum 6-8 nodes per diagram. Split larger trees into multiple diagrams.

Node IDs must be camelCase with no spaces. Wrap labels containing special characters in double quotes. Do not use HTML tags or explicit colors/styling.

## Cross-References

All cross-references between documents must use relative links:
- `[Search](../endpoints/search.md)`
- `[Authentication](../cross-cutting/authentication.md)`
- `[12go API Surface](../integration/12go-api-surface.md)`
