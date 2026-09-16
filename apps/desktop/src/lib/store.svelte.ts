/**
 * The desk: one reactive module holding tasks, pending git work, config and UI state.
 * Files are the source of truth. This store reads them through the fs plugin, parses with
 * @ledge/core/pure (handing it `desk.home`, since a WebView has no home folder of its own), and
 * re-parses only the file the watcher reports as changed. Writes are
 * optimistic: the local copy updates first, the watcher confirms it a moment later.
 */
import {
  TaskParseError,
  defaultConfig,
  isPending,
  parseTask,
  plannedFor,
  serializeTask,
  slugify,
  surfaceCounts as countSurfaces,
  taskFileName,
  type Config,
  type RepoStatus,
  type SurfaceCounts,
  type Task,
} from '@ledge/core/pure';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import {
  ensureDir,
  listDir,
  moveFile,
  pathExists,
  readText,
  removeFile,
  watchPaths,
  writeText,
} from './io.ts';
import { basename, expandTilde, isTaskFile, join, ledgeHomeFor } from './paths.ts';
import { discoverRepos, scanRepoList } from './scan.ts';
import { nowIso, todayIso } from './time.ts';

export const WATCH_DEBOUNCE_MS = 150;

/**
 * The four surfaces, in the order the tab strip shows them. They are the whole navigation:
 * NOW is what is in front of you, SESSIONS is what Claude Code has worked on, TASKS is every
 * list of work there is, and MEMORY is the reasoning those sessions left behind.
 */
export type Surface = 'now' | 'sessions' | 'tasks' | 'memory';

/**
 * The views inside TASKS. Live and Done are the two halves of the work you own; Backlog and
 * Pending were top-level tabs before the four surfaces and are views here instead, because
 * both of them answer "which task" rather than "which part of the app". Done is read from
 * `archive/`, a folder that only grows, so it is never parsed at boot.
 */
export type TaskView = 'live' | 'done' | 'backlog' | 'pending';

export interface BrokenTask {
  file: string;
  error: string;
  line?: number;
}

export interface ScanCache {
  scannedAt: string;
  repos: RepoStatus[];
}

export interface Desk {
  home: string;
  ledgeHome: string;
  tasksDir: string;
  archiveDir: string;
  configPath: string;
  cachePath: string;
  config: Config;
  tasks: Task[];
  broken: BrokenTask[];
  pending: RepoStatus[];
  archivedCount: number;
  /** Parsed archive files, newest first. Empty until the Done view is first asked for. */
  archive: Task[];
  /** True once the archive has been read and while that reading is still trusted. */
  archiveReady: boolean;
  archiveLoading: boolean;
  selectedFile: string | null;
  surface: Surface;
  view: TaskView;
  /** The header search is open. The query lives with it, so reopening starts clean. */
  searching: boolean;
  scanning: boolean;
  lastScan: string | null;
  panelVisible: boolean;
  ready: boolean;
  error: string | null;
}

export const desk: Desk = $state({
  home: '',
  ledgeHome: '',
  tasksDir: '',
  archiveDir: '',
  configPath: '',
  cachePath: '',
  config: defaultConfig(),
  tasks: [],
  broken: [],
  pending: [],
  archivedCount: 0,
  archive: [],
  archiveReady: false,
  archiveLoading: false,
  selectedFile: null,
  surface: 'now',
  view: 'live',
  searching: false,
  scanning: false,
  lastScan: null,
  panelVisible: false,
  ready: false,
  error: null,
});

/* ------------------------------------------------------------------ selectors */

function byOrderThenUpdated(a: Task, b: Task): number {
  if (a.order !== b.order) return a.order - b.order;
  return b.updated.localeCompare(a.updated);
}

/** Current tasks sorted by `order`, 1 at the top. */
export function currentTasks(): Task[] {
  return desk.tasks.filter((t) => t.status === 'current').sort(byOrderThenUpdated);
}

/** Backlog tasks, most recently updated first. */
export function backlogTasks(): Task[] {
  return desk.tasks
    .filter((t) => t.status === 'backlog')
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Finished tasks from `archive/`, newest first. Empty until the archive has been read. */
export function doneTasks(): Task[] {
  return desk.archive;
}

/**
 * How many finished tasks the Done button should claim. The count from `listDir` is right
 * from boot and costs nothing; once the files have actually been parsed the parsed number
 * is the honest one, since a file the parser refused is not a row anybody can see.
 */
export function doneCount(): number {
  return desk.archiveReady ? desk.archive.length : desk.archivedCount;
}

/** The task currently open in the detail view, if any. */
export function selectedTask(): Task | undefined {
  return desk.selectedFile ? desk.tasks.find((t) => t.file === desk.selectedFile) : undefined;
}

/**
 * Turns anything thrown into readable text. The shell and filesystem plugins reject with a
 * plain string rather than an Error, so reading `.message` blindly renders "undefined" and
 * hides the only clue about what actually failed.
 */
export function report(level: 'warn' | 'error', message: string): void {
  void invoke('log_message', { level, message }).catch(() => {
    /* the logger must never be the thing that fails */
  });
}

export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/** Git status for a task's repo from the last scan, if the repo was scanned. */
export function statusForRepo(repo: string | undefined): RepoStatus | undefined {
  return repo ? desk.pending.find((p) => p.repo === repo) : undefined;
}

/** Title of the task that references a repo, for the Pending tab. */
export function taskTitleForRepo(repo: string): string | undefined {
  return desk.tasks.find((t) => t.repo === repo)?.title;
}

/**
 * What is on for today: tasks planned for this day, and ones whose planned day has passed
 * and which are still not done. Backlog tasks count: planning one for today is how a person
 * says they mean to pick it up, whatever list it currently sits in.
 */
export function todayPlan(day: string = todayIso()): { today: Task[]; overdue: Task[] } {
  /* `plannedFor` keeps the order it is given, so the sorting is this caller's job: today in
     the same priority order as the Current list, and overdue oldest first, because the
     oldest thing you have already missed is the one that matters most. */
  const { today, overdue } = plannedFor([...desk.tasks].sort(byOrderThenUpdated), day);
  return {
    today,
    overdue: overdue.sort((a, b) => (a.planned ?? '').localeCompare(b.planned ?? '')),
  };
}

/**
 * What the NOW surface calls "currently working": current tasks planned for today or for a day
 * that has already passed.
 *
 * When no current task names a planned day at all, every one of them lands here instead. That
 * is not a guess about the person's intent: it is that `planned` is optional, most task files
 * never carry it, and a desk with work on it under an empty "currently working" heading would
 * be a lie told by the layout. As soon as any current task does name a day, the field is being
 * used, and then a day in the future genuinely means "not today" and belongs in Up next.
 *
 * Priority order, the same as the Current list.
 */
export function workingTasks(day: string = todayIso()): Task[] {
  const current = currentTasks();
  if (!current.some((t) => t.planned !== undefined)) return current;
  return current.filter((t) => t.planned !== undefined && t.planned <= day);
}

/** The current tasks NOW did not put under "currently working", in the same priority order. */
export function upNextTasks(day: string = todayIso()): Task[] {
  const working = new Set(workingTasks(day).map((t) => t.file));
  return currentTasks().filter((t) => !working.has(t.file));
}

/**
 * The number beside each tab, counted by `surfaceCounts` in core so the panel and the CLI agree
 * on what each one means: `now` is tasks whose status is current, `sessions` is distinct newest
 * session ids, `tasks` is every task in the live list, and `memory` is total dated notes. The
 * archive is not passed in, for the same reason no other listing reads it.
 */
export function counts(): SurfaceCounts {
  return countSurfaces(desk.tasks);
}

/**
 * Tasks finished today, from the archive. Undefined until the archive has been read, so the
 * footer can say what it knows instead of claiming zero before it has looked. A task's `updated`
 * stamp is when it was last written, and `ledge done` writes it on the way to the archive.
 */
export function doneToday(day: string = todayIso()): number | undefined {
  if (!desk.archiveReady) return undefined;
  return desk.archive.filter((t) => t.updated.slice(0, 10) === day).length;
}

/**
 * When the desk last changed, as an ISO stamp: the newer of the last git scan and the most
 * recently written task file. Undefined when nothing has happened yet at all.
 */
export function lastUpdated(): string | undefined {
  const stamps = desk.tasks.map((t) => t.updated);
  if (desk.lastScan) stamps.push(desk.lastScan);
  let best: string | undefined;
  for (const stamp of stamps) {
    const at = Date.parse(stamp);
    if (Number.isNaN(at)) continue;
    if (best === undefined || at > Date.parse(best)) best = stamp;
  }
  return best;
}

/**
 * Repositories from the last scan holding work that is neither committed nor pushed. This is
 * the "needs attention" count on the home view; `desk.pending` is wider, because a branch
 * merely behind its upstream is worth listing but is not work of yours that could be lost.
 */
export function attentionRepos(): RepoStatus[] {
  return desk.pending.filter((p) => p.dirty.length > 0 || p.ahead > 0);
}

/* ------------------------------------------------------------------ ui state */

export function setSurface(surface: Surface): void {
  desk.surface = surface;
  desk.selectedFile = null;
}

/**
 * Switches between the views inside TASKS, and moves to that surface, because the switch these
 * views belong to only exists there: asking for Pending is asking to be on TASKS looking at
 * Pending. Reading `archive/` happens here, on the first switch to Done, rather than at boot: a
 * folder that only ever grows must not be parsed to show a panel whose whole subject is what is
 * still unfinished.
 */
export function setView(view: TaskView): void {
  desk.view = view;
  desk.surface = 'tasks';
  desk.selectedFile = null;
  if (view === 'done') void loadArchive();
}

/** Opens or closes the header search. Closing it never changes which surface you are on. */
export function setSearching(open: boolean): void {
  desk.searching = open;
}

export function select(file: string | null): void {
  desk.selectedFile = file;
}

export function setPanelVisible(visible: boolean): void {
  desk.panelVisible = visible;
}

/** Applies `config.ui.theme` to the document: `system` removes the override. */
export function applyTheme(theme: Config['ui']['theme']): void {
  if (typeof document === 'undefined') return;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/* ------------------------------------------------------------------ config */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merges a partial config file over defaults so missing keys never break the UI. */
export function mergeConfig(partial: unknown, base: Config = defaultConfig()): Config {
  if (!isObject(partial)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(partial)) {
    const current = out[k];
    out[k] = isObject(v) && isObject(current) ? { ...current, ...v } : v;
  }
  return out as unknown as Config;
}

async function loadConfigFile(): Promise<void> {
  let next = defaultConfig();
  if (await pathExists(desk.configPath)) {
    try {
      next = mergeConfig(JSON.parse(await readText(desk.configPath)));
    } catch (e) {
      desk.error = `config.json: ${errorText(e)}`;
      report('error', desk.error);
    }
  }
  const intervalChanged = next.scan.intervalMinutes !== desk.config.scan.intervalMinutes;
  desk.config = next;
  applyTheme(next.ui.theme);
  if (intervalChanged && scanTimer !== null) startScanTimer();
}

/** Writes config.json (pretty JSON) and applies it immediately. */
export async function saveConfigFile(config: Config): Promise<void> {
  await writeText(desk.configPath, JSON.stringify(config, null, 2) + '\n');
  desk.config = config;
  applyTheme(config.ui.theme);
  startScanTimer();
}

/* ------------------------------------------------------------------ tasks */

function upsertTask(task: Task): void {
  desk.broken = desk.broken.filter((b) => b.file !== task.file);
  const i = desk.tasks.findIndex((t) => t.file === task.file);
  if (i === -1) desk.tasks = [...desk.tasks, task];
  else desk.tasks[i] = task;
}

/** Drops a task from the desk without touching the disk. Deselects it if it was open. */
function forgetTask(file: string): void {
  desk.tasks = desk.tasks.filter((t) => t.file !== file);
  desk.broken = desk.broken.filter((b) => b.file !== file);
  if (desk.selectedFile === file) desk.selectedFile = null;
}

function markBroken(file: string, e: unknown): void {
  desk.tasks = desk.tasks.filter((t) => t.file !== file);
  const entry: BrokenTask =
    e instanceof TaskParseError
      ? { file, error: e.message, line: e.line }
      : { file, error: errorText(e) };
  const i = desk.broken.findIndex((b) => b.file === file);
  if (i === -1) desk.broken = [...desk.broken, entry];
  else desk.broken[i] = entry;
}

/** Reads and parses one task file, replacing its previous copy in the desk. */
export async function reloadTask(file: string): Promise<void> {
  if (!(await pathExists(file))) {
    forgetTask(file);
    return;
  }
  try {
    upsertTask(parseTask(await readText(file), file, { home: desk.home }));
  } catch (e) {
    markBroken(file, e);
  }
}

/** Reads every task in tasks/ and counts archive/. Used at boot and on directory events. */
export async function reloadTasks(): Promise<void> {
  const entries = await listDir(desk.tasksDir);
  const files = entries
    .filter((e) => e.isFile && isTaskFile(e.name))
    .map((e) => join(desk.tasksDir, e.name));
  const tasks: Task[] = [];
  const broken: BrokenTask[] = [];
  for (const file of files) {
    try {
      tasks.push(parseTask(await readText(file), file, { home: desk.home }));
    } catch (e) {
      broken.push(
        e instanceof TaskParseError
          ? { file, error: e.message, line: e.line }
          : { file, error: errorText(e) },
      );
    }
  }
  desk.tasks = tasks;
  desk.broken = broken;
  const archived = await listDir(desk.archiveDir);
  desk.archivedCount = archived.filter((e) => e.isFile && isTaskFile(e.name)).length;
}

/**
 * Reads and parses `archive/`, newest first, once. Repeat calls are free: the result is kept
 * until a watcher event touches the archive folder, which is the only thing that can change
 * it. A file the parser refuses is logged and left out rather than shown as a broken row: the
 * archive is a record of finished work, not a list anybody is going to fix.
 */
export async function loadArchive(): Promise<void> {
  if (desk.archiveReady || desk.archiveLoading) return;
  desk.archiveLoading = true;
  try {
    const entries = await listDir(desk.archiveDir);
    const files = entries
      .filter((e) => e.isFile && isTaskFile(e.name))
      .map((e) => join(desk.archiveDir, e.name));
    const tasks: Task[] = [];
    for (const file of files) {
      try {
        tasks.push(parseTask(await readText(file), file, { home: desk.home }));
      } catch (e) {
        report('warn', `archive: could not parse ${file}: ${errorText(e)}`);
      }
    }
    desk.archive = tasks.sort((a, b) => b.updated.localeCompare(a.updated));
    desk.archivedCount = files.length;
    desk.archiveReady = true;
  } finally {
    desk.archiveLoading = false;
  }
}

/**
 * Drops the cached archive. It is re-read straight away when Done is the view you are looking
 * at, and lazily on the next switch when it is not.
 */
export function invalidateArchive(): void {
  desk.archiveReady = false;
  if (desk.surface === 'tasks' && desk.view === 'done') void loadArchive();
}

/** Serializes and writes a task, bumping `updated`. The local copy updates immediately. */
export async function saveTask(task: Task): Promise<Task> {
  const next: Task = { ...task, updated: nowIso() };
  await writeText(next.file, serializeTask(next, { home: desk.home }));
  upsertTask(next);
  return next;
}

/** Flips one checklist item and writes the file. */
export async function toggleChecklist(task: Task, index: number, done: boolean): Promise<void> {
  const checklist = task.checklist.map((item, i) => (i === index ? { ...item, done } : item));
  await saveTask({ ...task, checklist });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Everything a view can supply when adding a task. Only the title is required. */
export interface NewTask {
  title: string;
  /** Which list it joins. Defaults to current; the Backlog tab passes backlog. */
  status?: 'current' | 'backlog';
  /** Repository path; `~` is expanded against the home folder. */
  repo?: string;
  /** YYYY-MM-DD. Anything else is ignored rather than written to the file. */
  planned?: string;
}

/** An id not already taken by a task on the desk, so two same-titled tasks cannot collide. */
function uniqueId(base: string): string {
  const taken = new Set(desk.tasks.map((t) => t.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Creates a task file. The title is enough: everything else is optional, and the new task
 * joins the end of its list so it never displaces what is already at the top. `status` is how
 * the Backlog tab adds straight to the backlog instead of to Current.
 */
export async function addTask(input: NewTask): Promise<Task> {
  const title = input.title.trim();
  if (title === '') throw new Error('A task needs a title.');
  const created = nowIso();
  const id = uniqueId(slugify(title));
  const status = input.status ?? 'current';
  const siblings = status === 'backlog' ? backlogTasks() : currentTasks();
  const orders = siblings.map((t) => t.order);
  const task: Task = {
    id,
    title,
    status,
    order: orders.length === 0 ? 1 : Math.max(...orders) + 1,
    sessions: [],
    created,
    updated: created,
    requirement: '',
    plan: [],
    checklist: [],
    notes: [],
    extra: '',
    file: join(desk.tasksDir, taskFileName({ id, created })),
  };
  const repo = input.repo?.trim();
  if (repo) task.repo = expandTilde(repo, desk.home);
  const planned = input.planned?.trim();
  if (planned && DAY.test(planned)) task.planned = planned;
  await ensureDir(desk.tasksDir);
  await writeText(task.file, serializeTask(task, { home: desk.home }));
  upsertTask(task);
  return task;
}

/** Moves a task to Current at position 1 and shifts the other current tasks down. */
export async function startTask(task: Task): Promise<void> {
  const others = currentTasks().filter((t) => t.file !== task.file);
  for (const [i, other] of others.entries()) {
    if (other.order !== i + 2) await saveTask({ ...other, order: i + 2 });
  }
  const { parked: _parked, ...rest } = task;
  await saveTask({ ...rest, status: 'current', order: 1 });
}

/** Parks a task in the backlog with a reason. */
export async function parkTask(task: Task, reason: string): Promise<void> {
  await saveTask({ ...task, status: 'backlog', parked: reason });
}

/** Marks a task done and moves its file to archive/. */
export async function markDone(task: Task): Promise<void> {
  const saved = await saveTask({ ...task, status: 'done' });
  await ensureDir(desk.archiveDir);
  await moveFile(saved.file, join(desk.archiveDir, basename(saved.file)));
  forgetTask(saved.file);
  desk.archivedCount += 1;
  invalidateArchive();
}

/**
 * Deletes a task and its file for good. Unlike `markDone`, nothing is archived: this is the
 * exit for a task that should never have existed. The task is looked up by id because that is
 * the identity the rest of the world uses, and the open detail view closes with it.
 *
 * `removeTask(id)` is the name @ledge/core/pure and the CLI are gaining for this; it is not
 * exported from core yet, so the implementation lives here and callers already use that name.
 */
export async function removeTask(id: string): Promise<void> {
  const task = desk.tasks.find((t) => t.id === id);
  if (!task) return;
  await removeFile(task.file);
  forgetTask(task.file);
}

/* ------------------------------------------------------------------ watching */

let changeTimer: ReturnType<typeof setTimeout> | null = null;
const changed = new Set<string>();
let stopWatching: (() => void) | null = null;

/**
 * Coalesces watcher events for 150 ms, then re-parses only the files that changed.
 * Editors often write a temp file and rename it; without this every save would parse twice.
 */
export function scheduleChange(paths: string[]): void {
  for (const p of paths) changed.add(p);
  if (changeTimer !== null) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    const batch = [...changed];
    changed.clear();
    void applyChanges(batch);
  }, WATCH_DEBOUNCE_MS);
}

/** Routes a batch of changed paths: config.json reloads config, task files reload one by one. */
export async function applyChanges(paths: string[]): Promise<void> {
  let reloadConfig = false;
  let reloadAll = false;
  let archiveTouched = false;
  const files = new Set<string>();
  for (const p of paths) {
    if (basename(p) === 'config.json') reloadConfig = true;
    else if (p === desk.tasksDir) reloadAll = true;
    else if (p.startsWith(desk.tasksDir + '/') && isTaskFile(p)) files.add(p);
    else if (p === desk.archiveDir || p.startsWith(desk.archiveDir + '/')) archiveTouched = true;
  }
  if (reloadConfig) await loadConfigFile();
  if (reloadAll) await reloadTasks();
  else for (const file of files) await reloadTask(file);
  if (archiveTouched) invalidateArchive();
}

async function startWatching(): Promise<void> {
  if (stopWatching) stopWatching();
  try {
    stopWatching = await watchPaths(
      /* The archive is watched too, not because the panel reads it often, but because a task
         finished in another window has to invalidate the cached Done list. */
      [desk.tasksDir, desk.archiveDir, desk.ledgeHome],
      scheduleChange,
      WATCH_DEBOUNCE_MS,
    );
  } catch (e) {
    desk.error = `watch: ${errorText(e)}`;
    report('error', desk.error);
  }
}

/* ------------------------------------------------------------------ git scan */

let scanTimer: ReturnType<typeof setInterval> | null = null;

async function loadScanCache(): Promise<void> {
  if (!(await pathExists(desk.cachePath))) return;
  try {
    const cache = JSON.parse(await readText(desk.cachePath)) as ScanCache;
    if (Array.isArray(cache.repos)) {
      desk.pending = cache.repos.filter(isPending);
      desk.lastScan = cache.scannedAt ?? null;
    }
  } catch {
    /* a bad cache is simply ignored; the next scan rewrites it */
  }
}

/** Runs the git scan now: discover repos, run git with 4 in flight, keep the pending ones. */
export async function scanNow(): Promise<void> {
  if (desk.scanning) return;
  desk.scanning = true;
  try {
    const referenced = desk.tasks.map((t) => t.repo).filter((r): r is string => !!r);
    const discovered = await discoverRepos(desk.config, desk.home);
    const repos = [...new Set([...discovered, ...referenced])];
    const results = await scanRepoList(repos, desk.config, { referenced });
    desk.pending = results
      .filter(isPending)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    desk.lastScan = new Date().toISOString();
    desk.error = null;
    // The cache only makes the next launch quicker. Losing it must never discard a scan that
    // already succeeded, so a write failure is reported without throwing the results away.
    try {
      const cache: ScanCache = { scannedAt: desk.lastScan, repos: results };
      await writeText(desk.cachePath, JSON.stringify(cache) + '\n');
    } catch (e) {
      desk.error = `could not save the scan cache: ${errorText(e)}`;
      report('error', desk.error);
    }
  } catch (e) {
    desk.error = `scan: ${errorText(e)}`;
    report('error', desk.error);
  } finally {
    desk.scanning = false;
  }
}

/** (Re)starts the periodic scan. This is the only timer that runs while the panel is hidden. */
export function startScanTimer(): void {
  if (scanTimer !== null) clearInterval(scanTimer);
  const minutes = Math.max(1, desk.config.scan.intervalMinutes);
  scanTimer = setInterval(() => void scanNow(), minutes * 60_000);
}

/* ------------------------------------------------------------------ lifecycle */

/**
 * Boots the desk: resolves the home folder, loads config, tasks and the scan cache, starts
 * watching, then runs the first scan. Safe to call once per window.
 */
export async function boot(homeOverride?: string): Promise<void> {
  const home = (homeOverride ?? (await homeDir())).replace(/[\\/]+$/, '');
  desk.home = home;
  desk.ledgeHome = ledgeHomeFor(home);
  desk.tasksDir = join(desk.ledgeHome, 'tasks');
  desk.archiveDir = join(desk.ledgeHome, 'archive');
  desk.configPath = join(desk.ledgeHome, 'config.json');
  desk.cachePath = join(desk.ledgeHome, '.scan-cache.json');

  await ensureDir(desk.tasksDir);
  /* The archive is created here rather than on the first `ledge done`, because the watcher
     cannot subscribe to a folder that does not exist yet. */
  await ensureDir(desk.archiveDir);
  await loadConfigFile();
  await reloadTasks();
  await loadScanCache();
  await startWatching();
  desk.ready = true;
  startScanTimer();
  void scanNow();
}

/** Stops timers and the watcher. Used by tests and on window teardown. */
export function shutdown(): void {
  if (scanTimer !== null) clearInterval(scanTimer);
  scanTimer = null;
  if (changeTimer !== null) clearTimeout(changeTimer);
  changeTimer = null;
  changed.clear();
  if (stopWatching) stopWatching();
  stopWatching = null;
}
