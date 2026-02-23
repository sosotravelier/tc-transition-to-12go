#!/usr/bin/env node

/**
 * Export all user messages from Cursor chat history.
 * Output: chronologically sorted, optionally grouped by session or workspace.
 * Usage: node export-user-messages.mjs [options]
 */

import { listSessions, isDatabaseLockedError, isDatabaseNotFoundError } from 'cursor-history';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    outputDir: join(__dirname, 'output'),
    format: 'both',
    groupBy: 'none',
    workspace: null,
    sinceDays: null,
    listWorkspaces: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && args[i + 1]) {
      opts.outputDir = args[i + 1];
      i++;
    } else if (args[i] === '--format' && args[i + 1]) {
      opts.format = args[i + 1];
      i++;
    } else if (args[i] === '--group-by' && args[i + 1]) {
      opts.groupBy = args[i + 1];
      i++;
    } else if (args[i] === '--workspace' && args[i + 1]) {
      opts.workspace = args[i + 1];
      i++;
    } else if ((args[i] === '--since-days' || args[i] === '--days') && args[i + 1]) {
      opts.sinceDays = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--list-workspaces') {
      opts.listWorkspaces = true;
    }
  }
  return opts;
}

function formatTimestamp(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

async function collectUserMessages(opts) {
  const listConfig = { limit: 10000 };
  if (opts.workspace) listConfig.workspace = opts.workspace;

  const result = await listSessions(listConfig);
  const sessionList = result?.data ?? [];

  const allMessages = [];

  for (let i = 0; i < sessionList.length; i++) {
    const session = sessionList[i];
    const workspace = session.workspace ?? 'unknown';
    const sessionId = session.id ?? `session-${i}`;
    const userMessages = (session.messages ?? []).filter((m) => m.role === 'user');
    const firstUserText = userMessages[0]?.content?.slice(0, 80) ?? '';

    for (const msg of userMessages) {
      const timestamp = msg.timestamp ?? null;
      const text = msg.content ?? msg.text ?? '';
      if (!text.trim()) continue;

      allMessages.push({
        timestamp,
        date: formatTimestamp(timestamp),
        text,
        sessionId,
        workspace,
        firstMessagePreview: firstUserText,
      });
    }
  }

  let filtered = allMessages;
  if (opts.sinceDays != null && opts.sinceDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opts.sinceDays);
    filtered = allMessages.filter((m) => m.date && m.date >= cutoff);
  }

  filtered.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

  return filtered;
}

function toMarkdown(messages, groupBy) {
  const lines = ['# Cursor User Messages Export\n', `Exported: ${new Date().toISOString()}\n`, `Total: ${messages.length} messages\n`, '---\n'];

  if (groupBy === 'workspace') {
    const byWorkspace = new Map();
    for (const m of messages) {
      const key = m.workspace ?? 'unknown';
      if (!byWorkspace.has(key)) byWorkspace.set(key, []);
      byWorkspace.get(key).push(m);
    }
    for (const [ws, msgs] of byWorkspace) {
      lines.push(`## Workspace: ${ws}\n\n`);
      for (const m of msgs) {
        const ts = m.date ? m.date.toISOString().slice(0, 16).replace('T', ' ') : 'unknown';
        lines.push(`### ${ts}\n\n${m.text}\n\n---\n`);
      }
    }
  } else if (groupBy === 'session') {
    const bySession = new Map();
    for (const m of messages) {
      const key = `${m.workspace} / ${m.sessionId}`;
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key).push(m);
    }
    for (const [sess, msgs] of bySession) {
      lines.push(`## Session: ${sess}\n\n`);
      for (const m of msgs) {
        const ts = m.date ? m.date.toISOString().slice(0, 16).replace('T', ' ') : 'unknown';
        lines.push(`### ${ts}\n\n${m.text}\n\n---\n`);
      }
    }
  } else {
    for (const m of messages) {
      const ts = m.date ? m.date.toISOString().slice(0, 16).replace('T', ' ') : 'unknown';
      const label = m.workspace ? `[${m.workspace}]` : '';
      lines.push(`## ${ts} ${label}\n\n${m.text}\n\n---\n`);
    }
  }

  return lines.join('');
}

function toJson(messages) {
  const out = messages.map((m) => ({
    timestamp: m.timestamp,
    text: m.text,
    sessionId: m.sessionId,
    workspace: m.workspace,
  }));
  return JSON.stringify(out, null, 2);
}

async function main() {
  const opts = parseArgs();

  try {
    const messages = await collectUserMessages(opts);

    if (messages.length === 0) {
      console.log('No user messages found.');
      return;
    }

    if (opts.listWorkspaces) {
      const workspaces = [...new Set(messages.map((m) => m.workspace ?? 'unknown'))].sort();
      for (const ws of workspaces) {
        console.log(ws);
      }
      return;
    }

    mkdirSync(opts.outputDir, { recursive: true });

    if (opts.format === 'md' || opts.format === 'both') {
      const mdPath = join(opts.outputDir, 'user-messages.md');
      writeFileSync(mdPath, toMarkdown(messages, opts.groupBy), 'utf8');
      console.log(`Wrote ${mdPath}`);
    }

    if (opts.format === 'json' || opts.format === 'both') {
      const jsonPath = join(opts.outputDir, 'user-messages.json');
      writeFileSync(jsonPath, toJson(messages), 'utf8');
      console.log(`Wrote ${jsonPath}`);
    }

    console.log(`Exported ${messages.length} user messages.`);
  } catch (err) {
    if (isDatabaseLockedError?.(err)) {
      console.error('Cursor database is locked. Close Cursor and retry.');
    } else if (isDatabaseNotFoundError?.(err)) {
      console.error('Cursor data not found. Ensure Cursor has been used and chat history exists.');
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
