# Transition Design Scripts

Utility scripts for the transition-design project.

## export-user-messages

Exports all messages you wrote to Cursor agents (user messages only) from your Cursor chat history. Output is chronologically sorted and can be used to populate or cross-check [prompt-log.md](../prompt-log.md).

### Prerequisites

- Node.js 20+
- [cursor-history](https://www.npmjs.com/package/cursor-history) (installed via `npm install`)

### Usage

```bash
# From scripts directory
npm install
npm run export-prompts
```

Or run directly:

```bash
node export-user-messages.mjs [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--output-dir <path>` | Where to write output files | `./output` |
| `--format <md\|json\|both>` | Output format | `both` |
| `--group-by <none\|session\|workspace>` | Grouping mode | `none` (flat chronological) |
| `--workspace <path>` | Filter to specific workspace only | (all workspaces) |

### Output

- **user-messages.md** — Markdown with each message as a dated section
- **user-messages.json** — JSON array of `{ timestamp, text, sessionId, workspace }` for programmatic use

### Notes

- If the database is locked: close Cursor and retry
- Output is written to `scripts/output/` by default (gitignored)
