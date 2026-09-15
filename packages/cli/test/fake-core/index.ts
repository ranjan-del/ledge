// Minimal in-memory stand-in for @ledge/core, shaped exactly like Contract 2 of the phase 0
// plan. It exists so the CLI tests run before the real package lands. State lives in a Map keyed
// by LEDGE_HOME, so several TaskStore instances for the same home see the same tasks, which is
// how the CLI behaves across invocations in one test file.
//
// Test-only affordances, none of which exist in the real core:
// - Any `*.md` file present in `<home>/tasks` makes list() and get() throw TaskParseError, since
//   the fake never writes Markdown itself. Tests plant one to exercise exit code 3.
// - scanRepos() returns the JSON array in the LEDGE_FAKE_SCAN environment variable, or [].
// - Constructing a TaskStore whose home is the real ~/.ledge throws, so no test can touch it.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

export type TaskStatus = 'current' | 'backlog' | 'done';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  order: number;
  repo?: string;
  sessions: string[];
  created: string;
  updated: string;
  parked?: string;
  requirement: string;
  checklist: ChecklistItem[];
  extra: string;
  file: string;
}

export interface Config {
  roots: string[];
  scan: { intervalMinutes: number; maxDepth: number; ignore: string[]; staleDays: number };
  terminal: string;
  claude: { command: string; resumeFlag: string };
  ui: { edge: 'left' | 'right'; theme: 'system' | 'light' | 'dark'; y?: number };
}

export interface RepoStatus {
  repo: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  dirty: { path: string; code: string }[];
  lastActivity: string;
}

export class TaskParseError extends Error {
  file: string;
  line?: number;

  constructor(message: string, file: string, line?: number) {
    super(message);
    this.name = 'TaskParseError';
    this.file = file;
    this.line = line;
  }
}

interface State {
  tasks: Map<string, Task>;
  archive: Map<string, Task>;
}

const states = new Map<string, State>();

function stateFor(home: string): State {
  let state = states.get(home);
  if (!state) {
    state = { tasks: new Map(), archive: new Map() };
    states.set(home, state);
  }
  return state;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Returns $LEDGE_HOME or ~/.ledge, mirroring the real core. */
export function ledgeHome(): string {
  return process.env.LEDGE_HOME ?? join(homedir(), '.ledge');
}

/** Returns the built-in default configuration. */
export function defaultConfig(): Config {
  return {
    roots: [join(homedir(), 'code')],
    scan: {
      intervalMinutes: 5,
      maxDepth: 4,
      ignore: ['node_modules', '.git', 'dist', 'target'],
      staleDays: 30,
    },
    terminal: 'Terminal.app',
    claude: { command: 'claude', resumeFlag: '--resume' },
    ui: { edge: 'right', theme: 'system' },
  };
}

/** Returns the default config; the fake never reads config.json. */
export function loadConfig(_home?: string): Config {
  return defaultConfig();
}

/** Turns a title into a lowercase, hyphen-separated id. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
}

/** Builds `YYYY-MM-DD-<id>.md` from the task's created date and id. */
export function taskFileName(task: Pick<Task, 'id' | 'created'>): string {
  return `${task.created.slice(0, 10)}-${task.id}.md`;
}

/** Deepest repo match: the folder equals the task repo or sits inside it. */
export function matchRepo<T extends { repo?: string }>(tasks: T[], cwd: string): T | undefined {
  const target = resolve(cwd);
  let best: T | undefined;
  for (const task of tasks) {
    if (!task.repo) continue;
    const repo = resolve(task.repo);
    if (target === repo || target.startsWith(repo + sep)) {
      if (!best || repo.length > resolve(best.repo as string).length) best = task;
    }
  }
  return best;
}

function sortTasks(tasks: Task[]): Task[] {
  return tasks.sort((a, b) => a.order - b.order || b.updated.localeCompare(a.updated));
}

export class TaskStore {
  readonly home: string;

  constructor(home?: string) {
    this.home = resolve(home ?? ledgeHome());
    if (this.home === join(homedir(), '.ledge')) {
      throw new Error('fake core refuses to touch the real ~/.ledge; set LEDGE_HOME');
    }
  }

  private get state(): State {
    return stateFor(this.home);
  }

  private guardPlantedFiles(): void {
    const dir = join(this.home, 'tasks');
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.md')) {
        throw new TaskParseError('missing frontmatter', join(dir, name), 1);
      }
    }
  }

  init(): { created: boolean } {
    const created = !existsSync(join(this.home, 'tasks'));
    mkdirSync(join(this.home, 'tasks'), { recursive: true });
    mkdirSync(join(this.home, 'archive'), { recursive: true });
    const configPath = join(this.home, 'config.json');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2) + '\n');
    }
    if (created && this.state.tasks.size === 0) {
      this.add({ title: 'Try Ledge', requirement: 'Run ledge to see this task.' });
    }
    return { created };
  }

  list(status?: TaskStatus): Task[] {
    this.guardPlantedFiles();
    const all = [...this.state.tasks.values()].filter((t) => !status || t.status === status);
    return sortTasks(all.map((t) => structuredClone(t)));
  }

  archived(): Task[] {
    return [...this.state.archive.values()].map((t) => structuredClone(t));
  }

  get(id: string): Task {
    this.guardPlantedFiles();
    const task = this.state.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return structuredClone(task);
  }

  add(input: { title: string; repo?: string; status?: TaskStatus; requirement?: string }): Task {
    const status = input.status ?? 'current';
    let id = slugify(input.title);
    let n = 2;
    while (this.state.tasks.has(id)) id = `${slugify(input.title)}-${n++}`;
    const created = nowIso();
    const task: Task = {
      id,
      title: input.title,
      status,
      order: this.list(status).length + 1,
      sessions: [],
      created,
      updated: created,
      requirement: input.requirement ?? '',
      checklist: [],
      extra: '',
      file: join(this.home, 'tasks', taskFileName({ id, created })),
    };
    if (input.repo) task.repo = resolve(input.repo);
    this.state.tasks.set(id, task);
    return structuredClone(task);
  }

  start(id: string): Task {
    const task = this.get(id);
    for (const other of this.state.tasks.values()) {
      if (other.status === 'current' && other.id !== id) other.order += 1;
    }
    task.status = 'current';
    task.order = 1;
    delete task.parked;
    this.save(task);
    this.reorder('current', this.list('current').map((t) => t.id));
    return this.get(id);
  }

  park(id: string, reason: string): Task {
    const task = this.get(id);
    task.status = 'backlog';
    task.parked = reason;
    task.order = this.list('backlog').length + 1;
    return this.save(task);
  }

  done(id: string): Task {
    const task = this.get(id);
    task.status = 'done';
    task.updated = nowIso();
    task.file = join(this.home, 'archive', basename(task.file));
    this.state.tasks.delete(id);
    this.state.archive.set(id, task);
    return structuredClone(task);
  }

  link(id: string, sessionId: string): Task {
    const task = this.get(id);
    if (!task.sessions.includes(sessionId)) task.sessions.push(sessionId);
    return this.save(task);
  }

  addTodo(id: string, text: string): Task {
    const task = this.get(id);
    task.checklist.push({ text, done: false });
    return this.save(task);
  }

  setTodo(id: string, index: number, done: boolean): Task {
    const task = this.get(id);
    const item = task.checklist[index];
    if (!item) throw new RangeError(`No checklist item at index ${index} in ${id}`);
    item.done = done;
    return this.save(task);
  }

  reorder(status: TaskStatus, ids: string[]): void {
    ids.forEach((id, i) => {
      const task = this.state.tasks.get(id);
      if (task && task.status === status) task.order = i + 1;
    });
  }

  currentFor(cwd: string): Task | undefined {
    return matchRepo(this.list('current'), cwd);
  }

  save(task: Task): Task {
    const copy = structuredClone(task);
    copy.updated = nowIso();
    this.state.tasks.set(copy.id, copy);
    return structuredClone(copy);
  }
}

/** Returns whatever LEDGE_FAKE_SCAN holds, so tests can inject repo statuses. */
export async function scanRepos(
  _config: Config,
  _opts?: { referenced?: string[]; now?: Date },
): Promise<RepoStatus[]> {
  const raw = process.env.LEDGE_FAKE_SCAN;
  return raw ? (JSON.parse(raw) as RepoStatus[]) : [];
}

/** Dirty, ahead of upstream, or on a non-main branch with no upstream. */
export function isPending(status: RepoStatus): boolean {
  const offMain = status.branch !== 'main' && status.branch !== 'master';
  return status.dirty.length > 0 || status.ahead > 0 || (!status.upstream && offMain);
}

/** Title, requirement and unchecked items as a prompt for a fresh Claude session. */
export function buildResumePrompt(task: Task): string {
  const lines = [`# ${task.title}`, ''];
  if (task.requirement) lines.push(task.requirement, '');
  const open = task.checklist.filter((item) => !item.done);
  if (open.length > 0) {
    lines.push('## Remaining');
    for (const item of open) lines.push(`- [ ] ${item.text}`);
  }
  return lines.join('\n').trimEnd();
}
