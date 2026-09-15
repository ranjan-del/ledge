// Plain text rendering. No colour libraries: tables are aligned with spaces so the output reads
// the same in a terminal, a hook transcript and a test assertion.
import { homedir } from 'node:os';
import type { RepoStatus, Task } from '@ledge/core';

/** A pending repo plus the task that references it, when one does. */
export interface PendingRow extends RepoStatus {
  task?: { id: string; title: string };
}

/** The three sections `ledge` prints. */
export interface Desk {
  current: Task[];
  backlog: Task[];
  pending: PendingRow[];
}

/** Hard cap on the SessionStart context block, from Contract 3. */
export const CONTEXT_MAX_LINES = 40;

/**
 * Aligns rows of cells into columns separated by two spaces, padding every cell to the widest
 * cell in its column. Trailing spaces are trimmed so the last column never pads. Returns one
 * line per row with the given indent.
 */
export function table(rows: string[][], indent = '  '): string {
  if (rows.length === 0) return '';
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => indent + row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd())
    .join('\n');
}

/**
 * Replaces the home directory prefix of an absolute path with `~` so repo columns stay short.
 * Paths outside home are returned unchanged.
 */
export function shortPath(path: string, home = homedir()): string {
  if (path === home) return '~';
  return path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
}

/** Progress as `done/total`, or an empty string when the checklist is empty. */
export function progress(task: Task): string {
  if (task.checklist.length === 0) return '';
  const done = task.checklist.filter((item) => item.done).length;
  return `${done}/${task.checklist.length}`;
}

/**
 * Renders a section heading followed by a table, or `(none)` when there are no rows, so the
 * three desk sections always appear even when empty.
 */
export function section(title: string, rows: string[][]): string {
  const body = rows.length === 0 ? '  (none)' : table(rows);
  return `${title}\n${body}`;
}

/** Row for the Current section: order, id, title, repo and progress. */
export function currentRow(task: Task): string[] {
  const repo = task.repo ? shortPath(task.repo) : '';
  return [String(task.order), task.id, task.title, repo, progress(task)];
}

/** Row for the Backlog section: id, title, repo and the parked reason. */
export function backlogRow(task: Task): string[] {
  return [task.id, task.title, task.repo ? shortPath(task.repo) : '', task.parked ?? ''];
}

/** Row for the Pending section: repo, branch, ahead count, dirty count and the task title. */
export function pendingRow(row: PendingRow): string[] {
  const branch = row.upstream ? row.branch : `${row.branch} (no upstream)`;
  const ahead = row.ahead > 0 ? `ahead ${row.ahead}` : '';
  const dirty = row.dirty.length > 0 ? `${row.dirty.length} dirty` : '';
  return [shortPath(row.repo), branch, ahead, dirty, row.task?.title ?? ''];
}

/** Renders the whole desk: Current, Backlog and Pending sections separated by blank lines. */
export function renderDesk(desk: Desk): string {
  return [
    section('Current', desk.current.map(currentRow)),
    section('Backlog', desk.backlog.map(backlogRow)),
    section('Pending', desk.pending.map(pendingRow)),
  ].join('\n\n');
}

/**
 * Renders one task as readable Markdown for `ledge current`: heading, metadata lines, the
 * Requirement and Checklist sections. This is a view, not the file format; use `ledge open`
 * for the file itself.
 */
export function renderTaskMarkdown(task: Task): string {
  const meta = [`id: ${task.id}`, `status: ${task.status}`];
  if (task.repo) meta.push(`repo: ${shortPath(task.repo)}`);
  if (task.parked) meta.push(`parked: ${task.parked}`);
  if (task.sessions.length > 0) meta.push(`sessions: ${task.sessions.join(', ')}`);
  const lines = [`# ${task.title}`, '', ...meta];
  if (task.requirement) lines.push('', '## Requirement', '', task.requirement);
  if (task.checklist.length > 0) {
    lines.push('', '## Checklist', '');
    for (const item of task.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (task.extra) lines.push('', task.extra);
  return lines.join('\n');
}

/**
 * Caps a block of text at `max` lines. When the text is longer, the last kept line is replaced
 * with a note saying how many lines were dropped, so the reader knows the block is partial.
 */
export function truncateLines(text: string, max = CONTEXT_MAX_LINES): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  const kept = lines.slice(0, max - 1);
  kept.push(`... ${lines.length - kept.length} more lines, see ledge open`);
  return kept.join('\n');
}

/** Formats a value as indented JSON for `--json` output. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
