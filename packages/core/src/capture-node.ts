/**
 * The capture, Node half: read a session's transcript, ask a model what it amounted to, and
 * write the answer where it belongs. The task file gets what is the person's record (a plan, a
 * checklist change, a note, the session link) through TaskStore, never through string edits.
 * The sidecars get what is only the model's view (a session title and summary, note titles, a
 * headline). The rules for when to run, what to ask and what to accept are pure and live in
 * ./capture.ts; this file is the plumbing around them.
 *
 * Three promises this file keeps, because it runs detached from a hook with nobody watching:
 *
 * 1. Nothing is written when the model call fails. A provider that is missing, errors, times
 *    out or answers with something that does not check out leaves every file as it was, and the
 *    next capture simply tries again from the same place.
 * 2. Every run leaves one line in `<home>/capture.log`, captured, skipped or failed, with the
 *    reason. It is the only way to see what a background process did.
 * 3. Two captures of one session never run at once. The Stop hook and the SessionEnd hook can
 *    fire within a second of each other, and two model calls over the same lines would write the
 *    same note twice. A lock file per session serialises them, and the second one then usually
 *    finds nothing new and skips.
 */
import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Provider } from './ai.ts';
import { sanitizeForNote } from './ai.ts';
import {
  buildCapturePrompt,
  captureDue,
  foldIntoTask,
  matchChecklistItem,
  matchItem,
  parseCaptureResult,
  samePlan,
  similarTitle,
} from './capture.ts';
import type { CaptureResult } from './capture.ts';
import { expandTilde, ledgeHome } from './config.ts';
import { isoDay } from './planning.ts';
import { InsightStore, SessionStore } from './sidecars-node.ts';
import { emptyInsights, noteKey, contentKey } from './sidecars.ts';
import type { SessionCommit, SessionRecord, TaskInsights } from './sidecars.ts';
import { TaskStore, matchRepo } from './store.ts';
import { formatIso } from './task-file.ts';
import { parseTranscript, renderDigest } from './transcript.ts';
import type { TranscriptDigest } from './transcript.ts';
import type { Task } from './types.ts';

/** How long a capture waits for the model. Haiku over a 12k token digest is well inside this. */
const CAPTURE_TIMEOUT_MS = 120_000;

/** A lock older than this belongs to a capture that died, and is taken over. */
const STALE_LOCK_MS = 5 * 60 * 1000;

/** The log is rotated to `capture.log.1` once it passes this size. */
const LOG_MAX_BYTES = 1024 * 1024;

/** Most candidate tasks shown to the model. More than this in one folder is a desk to tidy. */
const MAX_CANDIDATES = 12;

/** Most other open tasks listed in one line each. A desk has a few dozen; this is generous. */
const MAX_OTHER_TASKS = 80;

/** Reads commits made in a folder between two instants. Injected in tests. */
export type GitLogReader = (cwd: string, since: string, until: string) => Promise<SessionCommit[]>;

/** Everything one capture run needs. Only the first four have no default. */
export interface CaptureOptions {
  sessionId: string;
  transcriptPath: string;
  /** The folder the session runs in. */
  cwd: string;
  /** The model to ask. Capture is meant for a fast one; the CLI passes Haiku. */
  provider: Provider;
  /** Skip the debounce, but not the "no new lines at all" check. */
  final?: boolean;
  /** Run whatever the debounce says. */
  force?: boolean;
  /** Ledge home. Defaults to `ledgeHome()`. */
  home?: string;
  /** The clock. Defaults to the real one. */
  now?: () => Date;
  /** Commit reader. Defaults to `git log`. */
  gitLog?: GitLogReader;
  /** How long to wait for another capture of the same session to finish. Default 150 s. */
  lockWaitMs?: number;
}

/** What one run did. `status` is also the first word of its capture.log line. */
export interface CaptureOutcome {
  status: 'captured' | 'skipped' | 'failed';
  reason: string;
  sessionId: string;
  taskId?: string;
  /** True when this run created the task. */
  created?: boolean;
  record?: SessionRecord;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Default commit reader: `git log` between two instants, newest first, never throwing. */
export const gitLogBetween: GitLogReader = (cwd, since, until) =>
  new Promise((done) => {
    execFile(
      'git',
      ['-C', cwd, 'log', `--since=${since}`, `--until=${until}`, '--format=%H%x1f%s', '-n', '50'],
      { maxBuffer: 4 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string) => {
        if (err) return done([]);
        const commits = stdout
          .split('\n')
          .filter((line) => line.includes('\x1f'))
          .map((line) => {
            const [sha, subject] = line.split('\x1f');
            return { sha: sha!.trim(), subject: (subject ?? '').trim() };
          });
        done(commits);
      },
    );
  });

/** Appends one line to `<home>/capture.log`, rotating it when it has grown large. Never throws. */
export function logCapture(home: string, line: string, now: Date = new Date()): void {
  try {
    mkdirSync(home, { recursive: true });
    const file = join(home, 'capture.log');
    try {
      if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // No log yet, which is the normal first run.
    }
    appendFileSync(file, `${formatIso(now)} ${line.replace(/\s*\n\s*/g, ' ')}\n`);
  } catch {
    // A log that cannot be written must not turn a capture into a failure.
  }
}

async function acquireLock(file: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      try {
        if (Date.now() - statSync(file).mtimeMs > STALE_LOCK_MS) {
          rmSync(file, { force: true });
          continue;
        }
      } catch {
        continue;
      }
    }
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
}

/** A path as the record keeps it: relative to the session folder when inside it. */
function repoRelative(cwd: string, path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(cwd, absolute);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : absolute;
}

/** Where a session folder sits in git: its checkout root, and the main checkout's matching path. */
export interface CheckoutPaths {
  /** The checkout the folder is in, or undefined outside git. */
  top?: string;
  /** The same folder in the main checkout, when the folder is inside a linked worktree. */
  main?: string;
}

/**
 * Finds the checkout a folder belongs to and, for a linked worktree, the same folder in the main
 * checkout. Tasks record the main checkout's path, so a session in `~/code/.wt/feature/apps/web`
 * has to be matched as `~/code/platform/apps/web` or it never sees its own task and the model
 * makes a new one. Never throws: outside git, or with git missing, both fields are undefined.
 */
export function checkoutPaths(cwd: string): CheckoutPaths {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const [top, common] = out.trim().split('\n').map((line) => line.trim());
    if (!top) return {};
    if (!common || basename(common) !== '.git' || dirname(common) === top) return { top };
    const rel = relative(top, realpathSync(cwd));
    const main = dirname(common);
    return { top, main: rel === '' || rel.startsWith('..') ? main : join(main, rel) };
  } catch {
    return {};
  }
}

function isInside(path: string, folder: string): boolean {
  const a = resolve(expandTilde(path));
  const b = resolve(expandTilde(folder));
  return a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Every task the session could be for, the linked one first: tasks whose repo holds the folder,
 * then, inside a git checkout, tasks for folders below it (a session at the root of a monorepo
 * works on its apps). A linked worktree is looked up as its main checkout too. Outside git, a
 * folder like `~/code` would hold every task, so tasks below it are not offered there.
 */
function candidatesFor(
  store: TaskStore,
  cwd: string,
  sessionId: string,
  linked: string | undefined,
  paths: CheckoutPaths,
): Task[] {
  const open = store.list().filter((task) => task.status !== 'done');
  const folders = paths.main ? [cwd, paths.main] : [cwd];
  const holds = open.filter((task) => folders.some((folder) => matchRepo([task], folder) !== undefined));
  const below = paths.top
    ? open.filter(
        (task) => !holds.includes(task) && task.repo && folders.some((folder) => isInside(task.repo!, folder)),
      )
    : [];
  const byLink = open.find((task) => task.sessions.includes(sessionId));
  const extra: Task[] = [];
  if (byLink) extra.push(byLink);
  if (linked && !extra.some((t) => t.id === linked)) {
    const found = open.find((t) => t.id === linked);
    if (found) extra.push(found);
    else {
      try {
        extra.push(store.get(linked));
      } catch {
        // The task the record names has been deleted since. The model is not shown it.
      }
    }
  }
  const rest = [...holds, ...below].filter((task) => !extra.some((t) => t.id === task.id));
  return [...extra, ...rest].slice(0, MAX_CANDIDATES);
}

/** Checklist ticks and additions the session made itself, by running `ledge tick` or `ledge todo`. */
function selfReported(commands: string[], task: Task): { ticked: string[]; added: string[] } {
  const ticked: string[] = [];
  const added: string[] = [];
  const escaped = task.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tick = new RegExp(`\\bledge\\s+tick\\s+${escaped}\\s+(\\d+)`, 'g');
  const todo = new RegExp(`\\bledge\\s+todo\\s+${escaped}\\s+(?:"([^"]+)"|'([^']+)')`, 'g');
  for (const command of commands) {
    for (const match of command.matchAll(tick)) {
      const item = task.checklist[Number(match[1]) - 1];
      if (item?.done) ticked.push(item.text);
    }
    for (const match of command.matchAll(todo)) {
      const text = (match[1] ?? match[2] ?? '').trim();
      if (text !== '') added.push(text);
    }
  }
  return { ticked, added };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Applies a checked capture answer to the task files through the store, and returns the task
 * it was applied to with what changed. A task is created, marked `origin: auto`, only when the
 * answer asks for one. The plan is replaced only when it actually differs, checklist lines are
 * matched by words so a rephrased tick still lands, and nothing is ever unticked.
 */
function applyToTask(
  store: TaskStore,
  result: CaptureResult,
  sessionId: string,
  repo: string,
  day: string,
): { task?: Task; created: boolean; ticked: string[]; added: string[] } {
  let task: Task | undefined;
  let created = false;
  if (result.taskId) task = store.get(result.taskId);
  else if (result.newTask) {
    const added = store.add({
      title: result.newTask.title,
      repo,
      requirement: result.newTask.requirement,
    });
    task = store.save({ ...added, meta: { ...(added.meta ?? {}), origin: 'auto' } });
    created = true;
  }
  if (!task) return { created, ticked: [], added: [] };
  const id = task.id;

  if (result.plan && !samePlan(result.plan, task.plan)) task = store.setPlan(id, result.plan);

  const added: string[] = [];
  for (const text of result.checklistAdd) {
    if (matchChecklistItem(task.checklist.map((item) => item.text), text) >= 0) continue;
    task = store.addTodo(id, text);
    added.push(text);
  }

  const ticked: string[] = [];
  for (const text of result.checklistTick) {
    const open = task.checklist
      .map((item, index) => ({ item, index }))
      .filter((entry) => !entry.item.done);
    const hit = matchItem(open.map((entry) => entry.item.text), text);
    if (hit < 0) continue;
    const { item, index } = open[hit]!;
    task = store.setTodo(id, index, true);
    ticked.push(item.text);
  }

  if (result.note) {
    const body = sanitizeForNote(result.note.body);
    if (body !== '') task = store.addNote(id, body, day);
  }
  store.link(id, sessionId);
  return { task: store.get(id), created, ticked, added };
}

/**
 * Merges what a capture learned about a task into its insights: the headline, the phase and the
 * title of today's note, filed under the note's content key as the file now spells it. Entries
 * whose key no longer matches any note or plan step are dropped on the way, since nothing can
 * ever show them again and a sidecar that only grows is a sidecar nobody can read.
 */
export function mergeInsights(
  previous: TaskInsights | undefined,
  task: Task,
  update: {
    headline?: string;
    phase?: string;
    notes?: Record<string, { title: string; summary: string }>;
    plan?: Record<string, { title: string; detail?: string }>;
    model?: string;
  },
  now: Date,
): TaskInsights {
  const base = previous ?? emptyInsights(task.id, formatIso(now));
  const noteKeys = new Set(task.notes.map(noteKey));
  const planKeys = new Set(task.plan.map(contentKey));
  const notes = Object.fromEntries(
    Object.entries({ ...base.notes, ...(update.notes ?? {}) }).filter(([key]) => noteKeys.has(key)),
  );
  const plan = Object.fromEntries(
    Object.entries({ ...base.plan, ...(update.plan ?? {}) }).filter(([key]) => planKeys.has(key)),
  );
  const next: TaskInsights = { ...base, taskId: task.id, notes, plan, updatedAt: formatIso(now) };
  if (update.headline !== undefined) next.headline = update.headline;
  if (update.phase !== undefined) next.phase = update.phase;
  if (update.model !== undefined) next.model = update.model;
  return next;
}

/** A fresh record for a session nothing has been written about yet. */
function skeleton(sessionId: string, now: Date): SessionRecord {
  const at = formatIso(now);
  return {
    version: 1,
    id: sessionId,
    started: at,
    lastActivity: at,
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
  };
}

/**
 * Records what a hook can see about a session without asking any model: that it exists, where
 * it runs, which transcript it writes, and with `ended`, that it has finished. Creates the record
 * when there is none. Without `ended`, an `ended` already on the record is cleared, because a
 * session that fires SessionStart again has been resumed and is running.
 */
export function trackSession(
  input: { sessionId: string; cwd?: string; transcriptPath?: string; ended?: boolean },
  options: { home?: string; now?: Date } = {},
): SessionRecord {
  const now = options.now ?? new Date();
  const sessions = new SessionStore(options.home);
  const record = sessions.get(input.sessionId) ?? skeleton(input.sessionId, now);
  if (input.cwd) record.repo = resolve(expandTilde(input.cwd));
  if (input.transcriptPath) record.transcriptPath = input.transcriptPath;
  if (input.ended) record.ended = formatIso(now);
  else delete record.ended;
  return sessions.put(record);
}

/**
 * Runs one capture of one session, from reading the transcript to writing both sidecars, and
 * logs the outcome. Never throws for anything a hook could cause; a bug in here still reaches
 * the caller, which is the CLI, and the CLI turns it into a failed line in the log.
 */
export async function runCapture(options: CaptureOptions): Promise<CaptureOutcome> {
  const home = resolve(expandTilde(options.home ?? ledgeHome()));
  const clock = options.now ?? (() => new Date());
  const cwd = resolve(expandTilde(options.cwd));
  const outcome = (o: Omit<CaptureOutcome, 'sessionId'>, lines?: number): CaptureOutcome => {
    const full: CaptureOutcome = { sessionId: options.sessionId, ...o };
    const parts = [full.status, `session=${full.sessionId}`, `task=${full.taskId ?? '-'}`];
    if (lines !== undefined) parts.push(`lines=${lines}`);
    if (full.created) parts.push('created');
    logCapture(home, `${parts.join(' ')} ${full.reason}`, clock());
    return full;
  };

  const sessions = new SessionStore(home);
  mkdirSync(sessions.dir, { recursive: true });
  const lock = join(sessions.dir, `${options.sessionId}.lock`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.sessionId)) {
    return outcome({ status: 'failed', reason: 'the session id is not usable as a file name' });
  }
  if (!(await acquireLock(lock, options.lockWaitMs ?? 150_000))) {
    return outcome({ status: 'skipped', reason: 'another capture of this session is still running' });
  }
  try {
    return await captureLocked(options, home, cwd, clock, sessions, outcome);
  } finally {
    rmSync(lock, { force: true });
  }
}

async function captureLocked(
  options: CaptureOptions,
  home: string,
  cwd: string,
  clock: () => Date,
  sessions: SessionStore,
  outcome: (o: Omit<CaptureOutcome, 'sessionId'>, lines?: number) => CaptureOutcome,
): Promise<CaptureOutcome> {
  let text: string;
  try {
    text = readFileSync(options.transcriptPath, 'utf8');
  } catch (error) {
    return outcome({ status: 'failed', reason: `transcript unreadable: ${(error as Error).message}` });
  }
  const digest: TranscriptDigest = parseTranscript(text);
  const previous = sessions.get(options.sessionId);
  const decision = captureDue(previous, digest.lineCount, clock(), {
    final: options.final,
    force: options.force,
  });
  if (!decision.due) {
    return outcome(
      { status: 'skipped', reason: decision.reason, taskId: previous?.taskId },
      digest.lineCount,
    );
  }

  const store = new TaskStore(home);
  const day = isoDay(clock());
  const paths = checkoutPaths(cwd);
  const candidates = candidatesFor(store, cwd, options.sessionId, previous?.taskId, paths);
  const linked = [previous?.taskId, candidates.find((t) => t.sessions.includes(options.sessionId))?.id]
    .find((id) => id !== undefined && candidates.some((t) => t.id === id));
  const otherTasks = store
    .list()
    .filter((task) => task.status !== 'done' && !candidates.some((c) => c.id === task.id))
    .slice(0, MAX_OTHER_TASKS);
  const prompt = buildCapturePrompt({
    digest: renderDigest(digest, { sinceLine: previous?.capturedLines ?? 0 }),
    candidates,
    otherTasks,
    linkedTaskId: linked,
    cwd,
    day,
  });

  let answer: string;
  try {
    if (!(await options.provider.available())) {
      const why = options.provider.unavailableReason?.() ?? 'the provider is not available';
      return outcome({ status: 'failed', reason: why, taskId: previous?.taskId }, digest.lineCount);
    }
    answer = (await options.provider.ask(prompt, { timeoutMs: CAPTURE_TIMEOUT_MS })).text;
  } catch (error) {
    return outcome(
      { status: 'failed', reason: `model call failed: ${(error as Error).message}`, taskId: previous?.taskId },
      digest.lineCount,
    );
  }
  const parsed = parseCaptureResult(answer, [...candidates, ...otherTasks].map((task) => task.id));
  if (!parsed.result) {
    return outcome(
      { status: 'failed', reason: `answer refused: ${parsed.error}`, taskId: previous?.taskId },
      digest.lineCount,
    );
  }
  let result = parsed.result;
  let folded = '';
  if (result.taskId === null && result.newTask) {
    // One piece of work, one task. A linked session adds to its task; a new goal that reads like
    // a task already open adds to that one. Only a session with neither makes a task.
    const open = store.list().filter((task) => task.status !== 'done');
    const into = linked ?? open[similarTitle(open.map((task) => task.title), result.newTask.title)]?.id;
    if (into) {
      folded = into === linked ? ', folded into the linked task' : ', folded into a similar task';
      result = foldIntoTask(result, into);
    }
  }

  const applied = applyToTask(store, result, options.sessionId, paths.main ?? cwd, day);
  const task = applied.task;
  const now = clock();
  const base = previous ?? skeleton(options.sessionId, now);
  const self = task ? selfReported(digest.commands, task) : { ticked: [], added: [] };
  const started = digest.started && Date.parse(digest.started) < Date.parse(base.started)
    ? formatIso(new Date(digest.started))
    : base.started;
  const lastActivity = digest.lastActivity ? formatIso(new Date(digest.lastActivity)) : formatIso(now);
  const gitLog = options.gitLog ?? gitLogBetween;
  const commits = await gitLog(cwd, started, lastActivity);

  const record: SessionRecord = {
    ...base,
    repo: base.repo ?? cwd,
    transcriptPath: options.transcriptPath,
    started,
    lastActivity,
    title: result.session.title,
    summary: result.session.summary,
    filesChanged: union(base.filesChanged, digest.filesChanged.map((p) => repoRelative(cwd, p))),
    commits,
    todosTicked: union(base.todosTicked, union(applied.ticked, self.ticked)),
    todosAdded: union(base.todosAdded, union(applied.added, self.added)),
    capturedAt: formatIso(now),
    capturedLines: digest.lineCount,
    model: options.provider.model ?? options.provider.name,
  };
  if (result.session.summary === '') delete record.summary;
  if (task) record.taskId = task.id;
  if (applied.created) record.autoCreatedTask = true;
  // The SessionEnd hook may have marked the session ended while the model was thinking. What is
  // on disk now wins for that one field, since this run read the record before it happened.
  const fresh = sessions.get(options.sessionId);
  if (fresh?.ended) record.ended = fresh.ended;
  sessions.put(record);

  if (task) {
    const insights = new InsightStore(home);
    const todayNote = task.notes.find((note) => note.date === day);
    const notes =
      result.note && todayNote
        ? { [noteKey(todayNote)]: { title: result.note.title, summary: result.note.summary } }
        : undefined;
    insights.put(
      mergeInsights(
        insights.get(task.id),
        task,
        {
          headline: result.headline,
          phase: result.phase,
          notes,
          model: record.model,
        },
        now,
      ),
    );
  }

  return outcome(
    {
      status: 'captured',
      reason: `${decision.reason}${folded}`,
      taskId: task?.id,
      created: applied.created || undefined,
      record,
    },
    digest.lineCount,
  );
}
