// Plain text rendering. No colour libraries: tables are aligned with spaces so the output reads
// the same in a terminal, a hook transcript and a test assertion.
import { homedir } from 'node:os';
import {
  ACTIVE_WINDOW_MS,
  ACTIVITY_HALF_LIFE_MS,
  ACTIVITY_HORIZON_MS,
  formatAge,
} from '@ledge/core';
import type { ActivitySignal, AskResult, MemoryEntry, NoteEntry, Observed } from '@ledge/core';
import type { ObservedRepo, ObservedTask, RepoStatus, SessionRef, Task } from '@ledge/core';

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
    const lines = note.body.trim().split('\n');
    const room = max - fixed - 2;
    // When the note has to be shortened it also needs a line to say so, so the budget for the
    // note itself is one smaller in that case. Without this the block came out one line over
    // and was trimmed a second time, which put a second marker in and cost a note line.
    const fits = room >= lines.length;
    const kept = fits ? lines : lines.slice(lines.length - Math.max(room - 1, 0));
    if (kept.length > 0) {
      noteLines = ['', `Notes (${note.date}):`];
      // Say when the note is only partly here. Relying on the whole block being cut to signal
      // this stopped working once the closing instruction was protected from truncation, and a
      // silently shortened note is worse than an obviously shortened one.
      if (!fits) {
        noteLines.push(`... ${lines.length - kept.length} earlier lines, see ledge open`);
      }
      noteLines.push(...kept);
    } else {
      noteLines = ['', `Notes (${note.date}): not shown, see ledge open`];
    }
  }
  // The tail is never truncated. It carries the file path and the one instruction that changes
  // behaviour, and cutting the block as a whole dropped exactly those lines whenever the
  // requirement and the notes were long, which is precisely when they matter most. So the
  // middle is trimmed to make room and the tail is always appended after.
  const body = truncateLines([...head, ...noteLines].join('\n'), Math.max(max - tail.length, 1));
  return [body, ...tail].join('\n');
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

/** What one assistant command produced: the facts it read, and the inference or its absence. */
export interface AssistView {
  kind: 'ask' | 'standup' | 'handoff';
  /** The calendar day the command ran on, `YYYY-MM-DD`. */
  day: string;
  /** The question, on `ask` only, exactly as it was typed. */
  question?: string;
  /** The task the handoff is about, on `handoff` only. */
  task?: { id: string; title: string };
  /** The facts read from the task files and from git. Printed whether or not a model answered. */
  observed: Observed;
  /** The model's answer and the provider that produced it. Absent when there is none. */
  inference?: AskResult;
  /** Why there is no inference: a missing provider, a failed call, or nothing to ask about. */
  noInference?: string;
  /** Absolute path of the task file a handoff was appended to, on `handoff --save` only. */
  saved?: string;
}

/**
 * Row for the Observed section: id, title, repo, status, progress and the next step the files
 * themselves name. The next step is quoted from the task, never composed, so this row stays a
 * reading of the file even on a line that sits directly above a model's answer.
 */
export function observedRow(task: ObservedTask): string[] {
  const progress = task.total === 0 ? '' : `${task.done}/${task.total}`;
  const next = task.nextAction ? `next (${task.nextAction.source}): ${task.nextAction.text}` : '';
  const repo = task.repo ? shortPath(task.repo) : '';
  return [task.id, task.title, repo, task.status, progress, next];
}

/** Row for the Observed git section: repo, branch, how far it has drifted and how dirty it is. */
export function observedRepoRow(repo: ObservedRepo): string[] {
  const branch = repo.upstream ? repo.branch : `${repo.branch} (no upstream)`;
  const drift = [
    repo.ahead > 0 ? `ahead ${repo.ahead}` : '',
    repo.behind > 0 ? `behind ${repo.behind}` : '',
  ].filter((part) => part !== '').join(' ');
  return [shortPath(repo.repo), branch, drift, repo.dirty > 0 ? `${repo.dirty} dirty` : 'clean'];
}

/** Indents a block of model text by two spaces so it sits under its heading like every section. */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
}

/**
 * Renders an assistant command's output: the observed facts first, then the inference under a
 * heading that names the provider and says it did not come from the person's files.
 *
 * The two are never merged and never printed under one heading, because they are not the same
 * kind of thing: the rows above are what Ledge read, and the block below is a model's reading of
 * those rows. When there is no inference the heading still appears, carrying the reason instead
 * of an answer, so a reader can always tell the difference between "the model said nothing
 * useful" and "no model was asked".
 */
export function renderAssist(view: AssistView): string {
  const blocks: string[] = [];
  if (view.kind === 'ask') blocks.push(section('Question', [[view.question ?? '']]));
  if (view.kind === 'handoff' && view.task) {
    blocks.push(`Handoff for ${view.task.id}: ${view.task.title}`);
  }
  blocks.push(section(`Observed ${view.day}`, view.observed.tasks.map(observedRow)));
  blocks.push(section('Observed git', view.observed.repos.map(observedRepoRow)));
  if (view.inference) {
    const head = `Inference (from ${view.inference.provider}, not from your files)`;
    blocks.push(`${head}\n${indent(view.inference.text)}`);
  } else {
    const why = view.noInference ?? 'No reason was given.';
    blocks.push(
      `Inference (none)\n${indent(why)}\n` +
        '  The rows above were read from your files and are unaffected.',
    );
  }
  if (view.saved) blocks.push(`Saved to ${shortPath(view.saved)} under ${view.day}`);
  return blocks.join('\n\n');
}

/** One signal as `ledge active` prints it: the reading, its age, and whether it counted. */
export interface ActiveSignalRow {
  signal: ActivitySignal;
  /** True when the signal was inside the horizon and so took part in the ranking. */
  counted: boolean;
  /** How old the signal is at the moment the command ran, e.g. `3h 10m`. */
  age: string;
}

/** One task's place in `ledge active`, with the evidence that put it there. */
export interface ActiveRow {
  rank: number;
  task: Task;
  score: number;
  /** The one-line reason, generated from the signal that decided the rank. */
  reason: string;
  signals: ActiveSignalRow[];
}

/** Everything `ledge active` prints: the ranking, the evidence and what is warm right now. */
export interface ActiveView {
  /** When the command ran, which is what every age is measured against. */
  now: string;
  /** The newest signal in the whole reading, which is what the ranking measured against. */
  reference?: string;
  /** The task that looks active at `now`, absent when nothing is recent enough to say. */
  active?: Task;
  rows: ActiveRow[];
  /** Repositories named by more than one of the ranked tasks, with the tasks naming them. */
  sharedRepos: { repo: string; taskIds: string[] }[];
}

/** Score to three decimals, so two near-identical scores can still be told apart by eye. */
function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

/**
 * Renders `ledge active`: the ranking, then the evidence per task, then the rules the numbers
 * came from. The evidence is not an appendix. A reordering a person cannot interrogate is one
 * they stop trusting the first time it is wrong, so every row's reason, every signal behind it
 * and the signals that were too old to count are all printed, and the last paragraph states the
 * weights and the horizon so the ordering can be checked by hand.
 */
export function renderActive(view: ActiveView): string {
  const blocks: string[] = [`Active ${view.now}`];
  blocks[0] += view.active
    ? `\n  Working on now: ${view.active.id} (${view.active.title})`
    : '\n  Nothing looks active right now, so nothing is claimed about the present.';

  const ranked = view.rows.map((row) => [
    String(row.rank),
    row.task.id,
    row.task.title,
    `order ${row.task.order}`,
    String(roundScore(row.score)),
    row.reason,
  ]);
  blocks.push(section('Ranked by activity', ranked));

  const evidence: string[] = ['Evidence'];
  if (view.rows.length === 0) evidence.push('  (none)');
  for (const row of view.rows) {
    evidence.push(`  ${row.rank}  ${row.task.id}`);
    if (row.signals.length === 0) {
      evidence.push('       (nothing observed)');
      continue;
    }
    const rows = row.signals.map((entry) => [
      entry.signal.kind,
      entry.signal.at,
      `${entry.age} ago`,
      entry.counted ? 'counted' : 'too old',
      entry.signal.detail,
    ]);
    evidence.push(table(rows, '       '));
  }
  blocks.push(evidence.join('\n'));

  if (view.sharedRepos.length > 0) {
    const notes = view.sharedRepos.map((shared) => [
      `${shortPath(shared.repo)} is named by ${shared.taskIds.length} tasks ` +
        `(${shared.taskIds.join(', ')}), so its session and worktree signals cannot say which.`,
    ]);
    blocks.push(section('Shared repositories', notes));
  }

  const half = formatAge(ACTIVITY_HALF_LIFE_MS);
  const horizon = formatAge(ACTIVITY_HORIZON_MS);
  const window = formatAge(ACTIVE_WINDOW_MS);
  blocks.push(
    [
      `Signals weigh session > worktree > taskfile and halve every ${half}. Anything older than`,
      `${horizon} is ignored, and a task with no signal keeps the order you gave it. "Working on`,
      `now" needs a signal from the last ${window}. This orders what is shown and nothing else:`,
      'no status is read, set or suggested here.',
    ].join('\n'),
  );
  return blocks.join('\n\n');
}

/** The same view as plain JSON for `--json`, with the thresholds it was computed under. */
export function activeJson(view: ActiveView): unknown {
  return {
    now: view.now,
    reference: view.reference ?? null,
    active: view.active ? { id: view.active.id, title: view.active.title } : null,
    thresholds: {
      halfLifeMs: ACTIVITY_HALF_LIFE_MS,
      horizonMs: ACTIVITY_HORIZON_MS,
      activeWindowMs: ACTIVE_WINDOW_MS,
    },
    ranked: view.rows.map((row) => ({
      rank: row.rank,
      id: row.task.id,
      title: row.task.title,
      status: row.task.status,
      order: row.task.order,
      repo: row.task.repo ?? null,
      score: roundScore(row.score),
      reason: row.reason,
      signals: row.signals.map((entry) => ({
        kind: entry.signal.kind,
        at: entry.signal.at,
        age: entry.age,
        counted: entry.counted,
        detail: entry.signal.detail,
      })),
    })),
    sharedRepos: view.sharedRepos,
  };
}
