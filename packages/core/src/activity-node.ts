/**
 * The Node half of activity: reading the signals. Only this file touches the filesystem, which
 * is why the ranking itself lives in ./activity.ts with no platform import and can be tested,
 * and argued with, without a repository or a session folder anywhere near it.
 *
 * Three things are observable on a machine running Claude Code, and this reads all three:
 *
 * 1. `~/.claude/projects/<encoded folder>/*.jsonl`, and the subagent transcripts nested under
 *    it. Claude Code appends a transcript per folder and the newest file's modification time
 *    tracks a live session to the second. It is the strongest signal available, and it is about
 *    a folder, not a task.
 * 2. The newest modification time among a repository's tracked files. That says when the code
 *    was last touched, by an editor, an assistant or anything else.
 * 3. The task file itself: the `updated` time it records, and its modification time on disk when
 *    that is newer. This is the only signal a task with no repository can ever have, which is
 *    exactly the case the ranking has to work for.
 *
 * Everything here is read-only. Nothing in this file writes, moves or touches a file.
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { claudeProjectDirName } from './activity.ts';
import { collapseTilde, expandTilde } from './config.ts';
import { formatIso } from './task-file.ts';
import type { ActivitySignal, TaskActivity } from './activity.ts';
import type { Task } from './types.ts';

/** Where the observations are read from, and how much of a big repository to walk. */
export interface ActivityOptions {
  /** Home folder. Defaults to what Node reports; tests point it at a temporary directory. */
  home?: string;
  /** Session transcript folder. Defaults to `<home>/.claude/projects`. */
  projectsDir?: string;
  /**
   * Cap on tracked files stat-ed per repository, default 20000. A cap is needed because the
   * newest tracked file can only be found by asking every one of them, and a large monorepo has
   * more files than a panel refresh can afford. When the cap bites, the signal says so rather
   * than claiming to have looked at the whole tree.
   */
  maxTrackedFiles?: number;
}

const DEFAULT_MAX_TRACKED_FILES = 20000;

function run(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { maxBuffer: 64 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string) => done(err ? undefined : stdout),
    );
  });
}

function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * How deep and how wide the walk of one transcript folder goes. Claude Code writes a session's
 * own transcript at the top of the folder and a subagent's under `<session id>/subagents/`, so
 * the top level alone can be minutes behind a session that is delegating work right now. Three
 * levels reach the subagent files and stop; the entry budget keeps a folder with hundreds of
 * past sessions from turning a panel refresh into a directory crawl, and it is generous enough
 * that only an extraordinary folder will hit it.
 */
const SESSION_SCAN_MAX_DEPTH = 3;
const SESSION_SCAN_MAX_ENTRIES = 4000;

/** Newest .jsonl modification time under `dir`, walking within the depth and entry budget. */
function newestTranscript(dir: string, budget: { left: number }, depth = 1): number | undefined {
  let best: number | undefined;
  for (const entry of entriesOf(dir)) {
    if (budget.left <= 0) break;
    budget.left--;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth >= SESSION_SCAN_MAX_DEPTH) continue;
      const found = newestTranscript(path, budget, depth + 1);
      if (found !== undefined && (best === undefined || found > best)) best = found;
      continue;
    }
    if (!entry.name.endsWith('.jsonl')) continue;
    const ms = mtimeOf(path);
    if (ms !== undefined && (best === undefined || ms > best)) best = ms;
  }
  return best;
}

/**
 * The newest session transcript written for `repo` or for any folder inside it, as a signal.
 *
 * The whole folder is walked, not just its top level, because a session that has delegated to a
 * subagent writes under `<session id>/subagents/` and leaves its own file untouched meanwhile.
 *
 * The folder name Claude Code uses is a lossy encoding of the path, so a descendant is found by
 * name prefix: a session run in `<repo>/apps/android` counts for the task, because that is work
 * in the task's repository. The same prefix test can also match a sibling folder whose name
 * merely begins the same way, `code-other` against `code`, so a prefix match names the encoded
 * folder it found in the detail and never claims to know the real path, which cannot be
 * recovered from the encoding.
 */
function sessionSignal(
  repo: string,
  projectsDir: string,
  projectDirs: string[],
  home: string,
): ActivitySignal | undefined {
  const encoded = claudeProjectDirName(repo);
  let bestMs: number | undefined;
  let bestDir: string | undefined;
  for (const name of projectDirs) {
    if (name !== encoded && !name.startsWith(encoded + '-')) continue;
    const budget = { left: SESSION_SCAN_MAX_ENTRIES };
    const ms = newestTranscript(join(projectsDir, name), budget);
    if (ms === undefined) continue;
    if (bestMs === undefined || ms > bestMs) {
      bestMs = ms;
      bestDir = name;
    }
  }
  if (bestMs === undefined || bestDir === undefined) return undefined;
  const where = collapseTilde(repo, home);
  const detail =
    bestDir === encoded
      ? `a Claude Code session in ${where}`
      : `a Claude Code session in a folder inside ${where} ` +
        `(${collapseTilde(join(projectsDir, bestDir), home)})`;
  return { kind: 'session', at: formatIso(new Date(bestMs)), detail };
}

/**
 * The newest modification time among the repository's tracked files, as a signal. Untracked
 * files are left out on purpose: build output, caches and downloads move constantly and would
 * make every repository look permanently warm.
 *
 * It says the code was touched, not who touched it and not for which task: a build that
 * rewrites a generated file, a branch switch and a checkout all move tracked files without
 * anyone having worked on this task, and two tasks naming this repository get the same signal.
 */
async function worktreeSignal(
  repo: string,
  home: string,
  maxFiles: number,
): Promise<ActivitySignal | undefined> {
  const listing = await run(repo, ['ls-files', '-z']);
  if (listing === undefined) return undefined;
  const paths = listing.split('\0').filter((path) => path !== '');
  if (paths.length === 0) return undefined;
  const scanned = paths.slice(0, maxFiles);
  let bestMs: number | undefined;
  let bestPath: string | undefined;
  for (const path of scanned) {
    const ms = mtimeOf(join(repo, path));
    if (ms === undefined) continue;
    if (bestMs === undefined || ms > bestMs) {
      bestMs = ms;
      bestPath = path;
    }
  }
  if (bestMs === undefined || bestPath === undefined) return undefined;
  const where = collapseTilde(repo, home);
  const partial =
    paths.length > scanned.length ? ` of the first ${scanned.length} tracked files` : '';
  return {
    kind: 'worktree',
    at: formatIso(new Date(bestMs)),
    detail: `the newest${partial} tracked file in ${where} (${bestPath})`,
  };
}

/**
 * The task file's own time, as a signal: the `updated` it records, or its modification time on
 * disk when that is newer, which happens whenever something edited the file without going
 * through the store. Whichever is used, the detail says which, because the two mean different
 * things and a reader has to be able to tell them apart.
 *
 * This is the weakest signal and it is also the only one a task without a repository has.
 * Ledge rewrites every file in a list when one task is renumbered, so a reorder stamps the same
 * time on every task at once; when that happens these signals tie and the ranking falls back to
 * the person's order, which is the right answer for a store nobody has worked in since.
 */
function taskfileSignal(task: Task): ActivitySignal | undefined {
  const recorded = Date.parse(task.updated);
  const onDisk = task.file === '' ? undefined : mtimeOf(task.file);
  const hasRecorded = Number.isFinite(recorded);
  if (!hasRecorded && onDisk === undefined) return undefined;
  if (onDisk !== undefined && (!hasRecorded || onDisk > recorded + 1000)) {
    return {
      kind: 'taskfile',
      at: formatIso(new Date(onDisk)),
      detail: 'the task file, changed on disk after the update time it records',
    };
  }
  return { kind: 'taskfile', at: task.updated, detail: 'the task file, last saved by Ledge' };
}

/**
 * Reads every signal available for the given tasks, in the same order as the tasks, one entry
 * each whether or not anything was found. It exists so the ranking can stay pure: this is the
 * only place that knows a session transcript folder or a git repository exists.
 *
 * A task with no repository gets its task file signal and nothing else, which is deliberate:
 * the ranking has to work for a task nobody has attached a folder to, and that case is common
 * enough to be the reason this was built.
 *
 * Repositories are read once each even when several tasks name the same one, so two tasks
 * sharing a folder get identical session and worktree signals. That is honest, not a bug: the
 * folder cannot say which of the two the work was for, and the ranking is documented to leave
 * such a tie in the person's order.
 *
 * Nothing here throws for a missing folder, a repository that is not one, a file it cannot stat
 * or a git that will not run. A signal that cannot be read is left out, because no reading is
 * not the same as a reading of zero, and a panel refresh must not fail over a moved directory.
 */
export async function collectActivity(
  tasks: Task[],
  options: ActivityOptions = {},
): Promise<TaskActivity[]> {
  const home = resolve(expandTilde(options.home ?? homedir()));
  const projectsDir = options.projectsDir
    ? resolve(expandTilde(options.projectsDir, home))
    : join(home, '.claude', 'projects');
  const maxFiles = options.maxTrackedFiles ?? DEFAULT_MAX_TRACKED_FILES;

  const repos = new Map<string, string>();
  for (const task of tasks) {
    if (task.repo) repos.set(task.id, resolve(expandTilde(task.repo, home)));
  }
  // Only read the transcript folder when some task names a repository. Nothing can match
  // otherwise, and a store of repo-less tasks should not go looking through a session archive.
  const projectDirs =
    repos.size === 0
      ? []
      : entriesOf(projectsDir)
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);

  const perRepo = new Map<string, ActivitySignal[]>();
  for (const repo of new Set(repos.values())) {
    const signals: ActivitySignal[] = [];
    const session = sessionSignal(repo, projectsDir, projectDirs, home);
    if (session) signals.push(session);
    const worktree = await worktreeSignal(repo, home, maxFiles);
    if (worktree) signals.push(worktree);
    perRepo.set(repo, signals);
  }

  return tasks.map((task) => {
    const repo = repos.get(task.id);
    const signals: ActivitySignal[] = repo ? [...(perRepo.get(repo) ?? [])] : [];
    const file = taskfileSignal(task);
    if (file) signals.push(file);
    const newest = signals
      .map((signal) => Date.parse(signal.at))
      .filter((ms) => Number.isFinite(ms))
      .reduce((max, ms) => Math.max(max, ms), Number.NEGATIVE_INFINITY);
    const entry: TaskActivity = { taskId: task.id, signals };
    if (newest !== Number.NEGATIVE_INFINITY) entry.lastActive = formatIso(new Date(newest));
    return entry;
  });
}
