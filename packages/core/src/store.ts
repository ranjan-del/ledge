import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defaultConfig, expandTilde, ledgeHome, saveConfig } from './config.ts';
import {
  appendNote as appendNotePure,
  isIsoDay,
  setPlan as setPlanPure,
} from './planning.ts';
import { parseTask, serializeTask } from './task-file-node.ts';
import { formatIso, slugify, taskFileName } from './task-file.ts';
import type { Task, TaskStatus } from './types.ts';

/**
 * Finds the task whose `repo` contains `cwd`, choosing the deepest repo when several match
 * (spec section 4: "a task matches a folder when the folder equals the task repo or sits inside
 * it; the deepest match wins"). Tasks without a repo never match. Ties keep the first task in
 * list order, which for store lists means the lowest `order`.
 */
export function matchRepo<T extends { repo?: string }>(tasks: T[], cwd: string): T | undefined {
  const target = stripTrailingSep(resolve(expandTilde(cwd)));
  let best: T | undefined;
  let bestLength = -1;
  for (const task of tasks) {
    if (!task.repo) continue;
    const repo = stripTrailingSep(resolve(expandTilde(task.repo)));
    const inside = target === repo || target.startsWith(repo + sep);
    if (inside && repo.length > bestLength) {
      best = task;
      bestLength = repo.length;
    }
  }
  return best;
}

function stripTrailingSep(p: string): string {
  return p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
}

function compareTasks(a: Task, b: Task): number {
  if (a.order !== b.order) return a.order - b.order;
  return b.updated.localeCompare(a.updated);
}

const SAMPLE_REQUIREMENT = [
  'Get to know Ledge. Tasks are plain Markdown files in this folder; Claude Code edits them',
  'through the /ledge command and this panel re-renders when a file changes.',
].join('\n');

const SAMPLE_CHECKLIST = [
  'Run `ledge` in a terminal to print the desk',
  'Install the Claude Code plugin and open a repo',
  'Type /ledge start "first task" inside Claude Code',
  'Mark this sample done with `ledge done try-ledge`',
];

/**
 * File-backed task store over `<home>/tasks` and `<home>/archive`. Every method reads the files
 * fresh and writes through immediately, because the files are the API: an editor, a script,
 * Claude Code and the desktop app may all change them between two calls. There is no cache and
 * no daemon; correctness comes from re-reading, which is cheap for a folder of dozens of files.
 */
export class TaskStore {
  readonly home: string;

  constructor(home?: string) {
    this.home = resolve(expandTilde(home ?? ledgeHome()));
  }

  private get tasksDir(): string {
    return join(this.home, 'tasks');
  }

  private get archiveDir(): string {
    return join(this.home, 'archive');
  }

  /**
   * Creates the store folders, writes a default config.json when none exists and, on that first
   * run only, a sample task so the panel and `ledge` have something to show. Safe to call again:
   * an existing store is left untouched and `created` comes back false.
   */
  init(): { created: boolean } {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.archiveDir, { recursive: true });
    const configFile = join(this.home, 'config.json');
    if (existsSync(configFile)) return { created: false };
    saveConfig(defaultConfig(), this.home);
    if (this.readDir(this.tasksDir).length === 0) {
      const sample = this.add({ title: 'Try Ledge', requirement: SAMPLE_REQUIREMENT });
      sample.checklist = SAMPLE_CHECKLIST.map((text) => ({ text, done: false }));
      this.save(sample);
    }
    return { created: true };
  }

  /**
   * Lists tasks in `tasks/` (never the archive), optionally filtered by status, sorted by
   * `order` ascending then `updated` descending. Throws TaskParseError for a malformed file so
   * the CLI can print the path and line; the desktop app parses per file instead.
   */
  list(status?: TaskStatus): Task[] {
    const tasks = this.readDir(this.tasksDir);
    const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
    return filtered.sort(compareTasks);
  }

  /**
   * Lists tasks in `archive/`, newest update first. The panel uses only the count; the CLI can
   * print them when asked. Kept separate from `list` so the hot path never parses old files.
   */
  archived(): Task[] {
    return this.readDir(this.archiveDir).sort(compareTasks);
  }

  /**
   * Returns the task with the given id, looking in `tasks/` first and then `archive/` so that
   * done tasks can still be opened, linked or restarted. Throws a plain Error when no file has
   * that id.
   */
  get(id: string): Task {
    const found =
      this.readDir(this.tasksDir).find((t) => t.id === id) ??
      this.readDir(this.archiveDir).find((t) => t.id === id);
    if (!found) throw new Error(`Task not found: ${id}`);
    return found;
  }

  /**
   * Creates a task file from a title, deriving a unique id with slugify (suffixing -2, -3 when
   * taken), resolving `repo` to an absolute path and appending it at the bottom of its status
   * list. Returns the saved task with `file` set.
   */
  add(input: { title: string; repo?: string; status?: TaskStatus; requirement?: string }): Task {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.archiveDir, { recursive: true });
    const status = input.status ?? 'current';
    const now = formatIso();
    const siblings = status === 'done' ? this.archived() : this.list(status);
    const task: Task = {
      id: this.uniqueId(slugify(input.title)),
      title: input.title.trim(),
      status,
      order: siblings.reduce((max, t) => Math.max(max, t.order), 0) + 1,
      sessions: [],
      created: now,
      updated: now,
      requirement: (input.requirement ?? '').trim(),
      plan: [],
      checklist: [],
      notes: [],
      extra: '',
      file: '',
    };
    if (input.repo) task.repo = resolve(expandTilde(input.repo));
    return this.save(task);
  }

  /**
   * Makes a task current at the top of the list: status current, order 1, every other current
   * task shifted down by one, and any parked reason cleared. Works on backlog and archived tasks
   * alike, which is how a done task comes back to life.
   */
  start(id: string): Task {
    const task = this.get(id);
    const others = this.list('current').filter((t) => t.id !== id);
    others.forEach((t, i) => this.save({ ...t, order: i + 2 }));
    delete task.parked;
    const saved = this.save({ ...task, status: 'current', order: 1 });
    this.compact(task.status, id);
    return saved;
  }

  /**
   * Moves a task to the backlog with a human-readable reason, appending it at the bottom of the
   * backlog and closing the gap it leaves in its previous list.
   */
  park(id: string, reason: string): Task {
    const task = this.get(id);
    const backlog = this.list('backlog').filter((t) => t.id !== id);
    const order = backlog.reduce((max, t) => Math.max(max, t.order), 0) + 1;
    const saved = this.save({ ...task, status: 'backlog', order, parked: reason.trim() });
    this.compact(task.status, id);
    return saved;
  }

/**
   * Deletes a task and its file for good. This is the one destructive operation in the store:
   * `done` keeps the file by moving it to the archive, so there was no way to get rid of a task
   * created by mistake. Anything calling this has to ask the person first, because there is no
   * undo and nothing is left on disk to recover from.
   */
  remove(id: string): Task {
    const task = this.get(id);
    if (task.file) rmSync(task.file, { force: true });
    this.compact(task.status, id);
    return task;
  }

  /**
   * Marks a task done and moves its file to `archive/` so `tasks/` stays small, then renumbers
   * the list it left. The file keeps its name and `status: done`.
   */
  done(id: string): Task {
    const task = this.get(id);
    const saved = this.save({ ...task, status: 'done' });
    this.compact(task.status, id);
    return saved;
  }

  /**
   * Appends a Claude Code session id to the task unless it is already recorded. Called by the
   * Stop hook after every session, so it must be idempotent.
   */
  link(id: string, sessionId: string): Task {
    const task = this.get(id);
    if (task.sessions.includes(sessionId)) return task;
    return this.save({ ...task, sessions: [...task.sessions, sessionId] });
  }

  /**
   * Appends an unchecked checklist item. Used by `/ledge todo` and the CLI so that adding a step
   * never requires hand-editing the file.
   */
  addTodo(id: string, text: string): Task {
    const task = this.get(id);
    const checklist = [...task.checklist, { text: text.trim(), done: false }];
    return this.save({ ...task, checklist });
  }

  /**
   * Sets the done flag of the checklist item at the 0-based `index`. Throws RangeError when the
   * index is out of bounds so a typo in `ledge tick` fails loudly instead of silently no-oping.
   */
  setTodo(id: string, index: number, done: boolean): Task {
    const task = this.get(id);
    if (!Number.isInteger(index) || index < 0 || index >= task.checklist.length) {
      throw new RangeError(
        `Checklist index ${index} is out of range (task has ${task.checklist.length} items)`,
      );
    }
    const checklist = task.checklist.map((item, i) => (i === index ? { ...item, done } : item));
    return this.save({ ...task, checklist });
  }

  /**
   * Sets or clears the day the person intends to work on the task. Pass undefined to clear it.
   * Validates the day here rather than at the file boundary so a typo fails loudly on the way in
   * instead of being silently dropped on the way out.
   */
  setPlanned(id: string, day: string | undefined): Task {
    const task = this.get(id);
    if (day === undefined) {
      const next = { ...task };
      delete next.planned;
      return this.save(next);
    }
    if (!isIsoDay(day)) throw new RangeError(`Not a YYYY-MM-DD day: ${day}`);
    return this.save({ ...task, planned: day });
  }

  /**
   * Appends text to today's note subsection, creating it when absent. This is how a session
   * records a decision or a dead end: the reasoning behind the checklist, kept in the file so
   * the next session reads it for free at session start.
   */
  addNote(id: string, text: string, day?: string): Task {
    const task = this.get(id);
    return this.save(appendNotePure(task, text, day));
  }

  /**
   * Replaces the plan steps of a task. Written before work starts, so a session that starts with
   * no plan has somewhere to put one before it touches code.
   */
  setPlan(id: string, steps: string[]): Task {
    const task = this.get(id);
    return this.save(setPlanPure(task, steps));
  }

  /**
   * Rewrites `order` for every task in a status list: the given ids get 1..n in sequence, any
   * remaining tasks of that status follow in their current order. Drives drag-to-reorder in the
   * panel. Throws when an id is unknown or not in that status.
   */
  reorder(status: TaskStatus, ids: string[]): void {
    const tasks = this.list(status);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const ordered: Task[] = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) throw new Error(`Task not found in ${status}: ${id}`);
      ordered.push(t);
      byId.delete(id);
    }
    ordered.push(...tasks.filter((t) => byId.has(t.id)));
    ordered.forEach((t, i) => {
      if (t.order !== i + 1) this.save({ ...t, order: i + 1 });
    });
  }

  /**
   * Returns the current task whose repo contains `cwd`, deepest match first, or undefined. This
   * is what the SessionStart hook asks for; backlog and done tasks are ignored on purpose so a
   * parked task never hijacks a session.
   */
  currentFor(cwd: string): Task | undefined {
    return matchRepo(this.list('current'), cwd);
  }

  /**
   * Bumps `updated`, serializes the task and writes it to the folder its status dictates
   * (`archive/` for done, `tasks/` otherwise), removing the old file when the task moved. Returns
   * the task with `file` pointing at the written path.
   */
  save(task: Task): Task {
    const next: Task = { ...task, updated: formatIso() };
    const dir = next.status === 'done' ? this.archiveDir : this.tasksDir;
    mkdirSync(dir, { recursive: true });
    const target = join(dir, taskFileName(next));
    if (next.file && next.file !== target && existsSync(next.file)) {
      renameSync(next.file, target);
    }
    next.file = target;
    writeFileSync(target, serializeTask(next));
    return next;
  }

  private readDir(dir: string): Task[] {
    if (!existsSync(dir)) return [];
    const tasks: Task[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = join(dir, name);
      tasks.push(parseTask(readFileSync(file, 'utf8'), file));
    }
    return tasks;
  }

  private uniqueId(base: string): string {
    const taken = new Set(
      [...this.readDir(this.tasksDir), ...this.readDir(this.archiveDir)].map((t) => t.id),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Renumbers a status list 1..n after a task left it, skipping the archive. */
  private compact(status: TaskStatus, leavingId: string): void {
    if (status === 'done') return;
    const remaining = this.list(status).filter((t) => t.id !== leavingId);
    remaining.forEach((t, i) => {
      if (t.order !== i + 1) this.save({ ...t, order: i + 1 });
    });
  }
}
