// Plain text rendering. No colour libraries: tables are aligned with spaces so the output reads
// the same in a terminal, a hook transcript and a test assertion.
import { homedir } from 'node:os';
import type { MemoryEntry, NoteEntry, RepoStatus, SessionRef, Task } from '@ledge/core';

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
 * Renders one task as readable Markdown for `ledge current`: heading, metadata lines, then the
 * Requirement, Plan, Checklist and Notes sections it has. This is a view, not the file format;
 * use `ledge open` for the file itself.
 */
export function renderTaskMarkdown(task: Task): string {
  const meta = [`id: ${task.id}`, `status: ${task.status}`];
  if (task.repo) meta.push(`repo: ${shortPath(task.repo)}`);
  if (task.parked) meta.push(`parked: ${task.parked}`);
  if (task.planned) meta.push(`planned: ${task.planned}`);
  if (task.sessions.length > 0) meta.push(`sessions: ${task.sessions.join(', ')}`);
  const lines = [`# ${task.title}`, '', ...meta];
  if (task.requirement) lines.push('', '## Requirement', '', task.requirement);
  if (task.plan.length > 0) {
    lines.push('', '## Plan', '');
    task.plan.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  if (task.checklist.length > 0) {
    lines.push('', '## Checklist', '');
    for (const item of task.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (task.notes.length > 0) {
    lines.push('', '## Notes');
    for (const note of task.notes) lines.push('', `### ${note.date}`, note.body);
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

/** A `YYYY-MM-DD` day plus the three lists `ledge today` prints. */
export interface Today {
  day: string;
  planned: Task[];
  overdue: Task[];
  current: Task[];
}

/** Row for the Today section: id, title, repo and progress. */
export function todayRow(task: Task): string[] {
  return [task.id, task.title, task.repo ? shortPath(task.repo) : '', progress(task)];
}

/**
 * Row for the Overdue section: the day it was planned for, spelled out as overdue, then the
 * same columns as a Today row. The word is repeated per row so a row copied out of the terminal
 * still says what it is.
 */
export function overdueRow(task: Task): string[] {
  return [`overdue since ${task.planned ?? '?'}`, ...todayRow(task)];
}

/**
 * Renders the answer to "what is on for today": the tasks planned for the day, then the ones
 * planned earlier and still not done, labelled as overdue, then the current tasks that were not
 * already listed above. Sections always appear, so an empty day reads as `(none)` rather than as
 * a missing section.
 */
export function renderToday(today: Today): string {
  return [
    section(`Today ${today.day}`, today.planned.map(todayRow)),
    section('Overdue', today.overdue.map(overdueRow)),
    section('Current', today.current.map(currentRow)),
  ].join('\n\n');
}

/** Today's note entry, or the newest one when nothing was written today. */
export function latestNote(task: Task, day: string): NoteEntry | undefined {
  return task.notes.find((note) => note.date === day) ?? task.notes[task.notes.length - 1];
}

/**
 * Builds the block the SessionStart hook injects: title, planned date, requirement, plan,
 * unchecked items and the most recent note, capped at CONTEXT_MAX_LINES lines. When it does not
 * fit, the note is shortened from its oldest line first and dropped entirely if that is still
 * not enough, because the requirement and the unchecked items are what the assistant cannot work
 * without, while a note is the part of the record it can go and read in the file.
 */
export function renderContext(task: Task, day: string, max = CONTEXT_MAX_LINES): string {
  const head: string[] = [`Ledge task: ${task.title} (id: ${task.id})`];
  if (task.planned) {
    const when =
      task.planned === day ? 'today' : task.planned < day ? 'overdue' : `on ${task.planned}`;
    head.push(`Planned: ${task.planned} (${when})`);
  }
  head.push('', 'Requirement:', task.requirement.trim() || '(none recorded yet)');
  if (task.plan.length > 0) {
    head.push('', 'Plan:');
    task.plan.forEach((step, i) => head.push(`${i + 1}. ${step}`));
  }
  head.push('', 'Still to do:');
  const open = task.checklist.filter((item) => !item.done);
  if (open.length === 0) head.push('(nothing unchecked; decide the next step)');
  else for (const item of open) head.push(`- [ ] ${item.text}`);

  const tail: string[] = [];
  if (task.file !== '') {
    tail.push('', `Task file: ${task.file}`);
    tail.push('Tick items, append notes and keep the plan current in that file as you work.');
  }

  const note = latestNote(task, day);
  const fixed = head.length + tail.length;
  let noteLines: string[] = [];
  if (note) {
    const body = note.body.trim().split('\n');
    const room = max - fixed - 2;
    const kept = room >= body.length ? body : body.slice(body.length - Math.max(room, 0));
    if (kept.length > 0) noteLines = ['', `Notes (${note.date}):`, ...kept];
  }
  return truncateLines([...head, ...noteLines, ...tail].join('\n'), max);
}

/**
 * Row for the Sessions section: the session id, a `latest` marker for the newest id of its task,
 * the task title, the repo and the lastSeen timestamp. The marker is a word rather than a symbol
 * so a row copied out of the terminal still says what it is.
 */
export function sessionRow(ref: SessionRef): string[] {
  const repo = ref.repo ? shortPath(ref.repo) : '';
  return [ref.id, ref.isLatest ? 'latest' : '', ref.taskTitle, repo, ref.lastSeen];
}

/** Renders the Sessions section, `(none)` when no task has a session id recorded. */
export function renderSessions(refs: SessionRef[]): string {
  return section('Sessions', refs.map(sessionRow));
}

/**
 * Renders one memory entry: a heading line with the day and the task, then the note body
 * indented under it. Notes are prose over several lines, so they are blocks rather than table
 * rows; the body is printed as written and never reflowed.
 */
export function memoryBlock(entry: MemoryEntry): string {
  const head = `  ${entry.date}  ${entry.taskTitle} (${entry.taskId})`;
  const body = entry.body
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `    ${line}`));
  return [head, ...body].join('\n');
}

/**
 * Renders the Memory section: every dated note across the tasks, newest first, one block each
 * separated by a blank line. `(none)` when there is nothing to show, which is also what a query
 * that matched nothing prints, so an empty result is never mistaken for a missing section.
 */
export function renderMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) return 'Memory\n  (none)';
  return ['Memory', '', entries.map(memoryBlock).join('\n\n')].join('\n');
}
