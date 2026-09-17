/**
 * Ordering tasks by what is observably happening, instead of by a number a person typed.
 *
 * Everything in this file is pure: a caller hands over the tasks it already parsed and a list of
 * observations, and gets back an ordering with the evidence that produced it. Gathering the
 * observations needs a filesystem, so that half lives in ./activity-node.ts and this half runs
 * unchanged in the desktop WebView.
 *
 * Three constants decide everything, and they are exported so a panel and a terminal can say the
 * same thing about the same task:
 *
 * - ACTIVITY_HORIZON_MS (12 hours). Past it a signal is ignored entirely. Twelve hours is one
 *   sitting of work: it reaches back across a long day so this morning's session still counts at
 *   ten at night, and it stops before yesterday, because a task last touched yesterday says
 *   nothing about what is open now, while the person's own order still does.
 * - ACTIVITY_HALF_LIFE_MS (90 minutes). Inside the horizon a signal is worth half as much every
 *   90 minutes, so evidence fades instead of switching off at the edge. Ninety minutes is chosen
 *   so a weak but fresh signal overtakes a strong one that is a couple of hours stale: a task
 *   file saved a minute ago outranks a session folder last written to at lunchtime.
 * - ACTIVE_WINDOW_MS (15 minutes). The present tense. `activeTask` will only call something
 *   active when its newest signal is inside this window, which is long enough to survive a think
 *   pause or a slow build and short enough that a session closed half an hour ago stops claiming
 *   the desk.
 *
 * Signal weights are session > worktree > taskfile, and the reason is how directly each one
 * names a task. A session folder is a live process in that folder. A worktree change is work
 * that happened but could have come from a build or a branch switch. A task file save is the
 * weakest, since Ledge itself rewrites every file in a list when one task is renumbered, and it
 * is also the only signal a task without a repository can ever have, so it must be able to win.
 */
import type { Task } from './types.ts';

/**
 * One observation, with where it came from and when. `detail` is a noun phrase naming the
 * evidence, written so it can be read after "active now, " and after "last seen 3h ago, ".
 */
export interface ActivitySignal {
  kind: 'session' | 'worktree' | 'taskfile';
  /** ISO 8601 with offset, the moment that was observed. */
  at: string;
  detail: string;
}

/**
 * Everything observed about one task. `lastActive` is the newest signal, carried for readers
 * that only want a timestamp; `signals` is the record it came from, and no conclusion in this
 * file travels without it.
 */
export interface TaskActivity {
  taskId: string;
  lastActive?: string;
  signals: ActivitySignal[];
}

/** A signal is worth half as much after this long. See the module comment for the choice. */
export const ACTIVITY_HALF_LIFE_MS = 90 * 60 * 1000;

/** Older than this and a signal is ignored, so the task keeps the person's order. */
export const ACTIVITY_HORIZON_MS = 12 * 60 * 60 * 1000;

/** How recent a signal must be for `activeTask` to use the present tense. */
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

/** How much each kind of evidence is worth before recency is applied. */
export const SIGNAL_WEIGHT: Record<ActivitySignal['kind'], number> = {
  session: 1,
  worktree: 0.7,
  taskfile: 0.6,
};

/** One task's place in the ranking, with the numbers and the evidence behind it. */
export interface ActivityRank {
  task: Task;
  /** Weight times decay of the strongest signal inside the horizon. Exactly 0 when none is. */
  score: number;
  /** The signal the score came from. Absent when nothing counted. */
  strongest?: ActivitySignal;
  /** Every signal for the task, newest first, including the ones too old to count. */
  signals: ActivitySignal[];
  /** The signals inside the horizon, newest first. Empty means the manual order was kept. */
  live: ActivitySignal[];
  /** The moment ages were measured from: the newest signal in the whole input. */
  reference?: string;
}

/**
 * The folder name Claude Code writes a project's transcripts under, inside
 * `~/.claude/projects`. Every character that is not a letter or a digit becomes a hyphen, which
 * is why an absolute path gains a leading hyphen and why a dot in a path becomes one too:
 * `/Users/me/code` becomes `-Users-me-code` and `/Users/me/.claude-mem/x` becomes
 * `-Users-me--claude-mem-x`. Verified against the transcripts on a real machine by comparing
 * each folder name with the `cwd` recorded inside its own files.
 *
 * It exists so the panel and the CLI look in the same place without either of them guessing.
 * The encoding is lossy and cannot be reversed: a hyphen in the name could have been a slash, a
 * dot, a space or a hyphen, so two different folders can encode to the same name, and a folder
 * called `code-other` encodes to something that looks like a child of `code`. Callers that match
 * descendants must expect that and say so in what they report.
 */
export function claudeProjectDirName(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * A duration as a person would say it: "under a minute", "14m", "3h 10m", "2d 4h". It exists so
 * an age reads the same in the panel and in the terminal, and it rounds down, because claiming
 * less time has passed than actually has would overstate how fresh a signal is.
 */
export function formatAge(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return 'under a minute';
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/** Milliseconds for a signal, or undefined when `at` is not a date this runtime can read. */
function timeOf(signal: ActivitySignal): number | undefined {
  const ms = Date.parse(signal.at);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Signals newest first. Ones with an unreadable `at` are dropped, never ordered by guess. */
function newestFirst(signals: ActivitySignal[]): ActivitySignal[] {
  return signals
    .map((signal) => ({ signal, ms: timeOf(signal) }))
    .filter((entry): entry is { signal: ActivitySignal; ms: number } => entry.ms !== undefined)
    .sort((a, b) => b.ms - a.ms)
    .map((entry) => entry.signal);
}

/** Collects every signal recorded for a task id, across however many entries carry it. */
function signalsById(activity: TaskActivity[]): Map<string, ActivitySignal[]> {
  const byId = new Map<string, ActivitySignal[]>();
  for (const entry of activity) {
    const existing = byId.get(entry.taskId);
    if (existing) existing.push(...entry.signals);
    else byId.set(entry.taskId, [...entry.signals]);
  }
  return byId;
}

/**
 * The strongest signal no older than `windowMs` before `referenceMs`, and what it scores. A
 * signal timestamped in the future is treated as if it were exactly at the reference rather than
 * dropped, because a clock a few seconds ahead is the ordinary case; the timestamp is always
 * reported, so a badly wrong clock is visible rather than silently believed.
 */
function strongest(
  signals: ActivitySignal[],
  referenceMs: number,
  windowMs: number,
): { signal: ActivitySignal; score: number } | undefined {
  let best: { signal: ActivitySignal; score: number } | undefined;
  for (const signal of signals) {
    const ms = timeOf(signal);
    if (ms === undefined) continue;
    const age = Math.max(0, referenceMs - ms);
    if (age > windowMs) continue;
    const score = SIGNAL_WEIGHT[signal.kind] * Math.pow(0.5, age / ACTIVITY_HALF_LIFE_MS);
    if (!best || score > best.score) best = { signal, score };
  }
  return best;
}

/**
 * The ranking `rankByActivity` returns, with the reasoning attached: the score, the signal it
 * came from, the signals that were too old to count, and the moment ages were measured against.
 *
 * This is the function to call when the ordering is shown to a person. A reordering nobody can
 * interrogate is one they stop trusting the first time it is wrong, so the numbers and the
 * evidence come back together with the order and are meant to be displayed next to it.
 *
 * Ages are measured from the newest signal in the input, not from a clock, which is why neither
 * this nor `rankByActivity` takes one. The same inputs therefore always produce the same
 * ordering, whether they are read now, in a test, or from a file written an hour ago. The
 * horizon still applies, so a store nobody has touched since yesterday has no live signal at all
 * and every task keeps the order the person gave it.
 */
export function rankWithEvidence(tasks: Task[], activity: TaskActivity[]): ActivityRank[] {
  const byId = signalsById(activity);
  const sorted = new Map<string, ActivitySignal[]>();
  let referenceMs: number | undefined;
  let reference: string | undefined;
  for (const task of tasks) {
    const signals = newestFirst(byId.get(task.id) ?? []);
    sorted.set(task.id, signals);
    const newest = signals[0];
    const ms = newest ? timeOf(newest) : undefined;
    if (ms !== undefined && (referenceMs === undefined || ms > referenceMs)) {
      referenceMs = ms;
      reference = newest!.at;
    }
  }

  const ranks: ActivityRank[] = tasks.map((task) => {
    const signals = sorted.get(task.id) ?? [];
    const rank: ActivityRank = { task, score: 0, signals, live: [] };
    if (reference !== undefined) rank.reference = reference;
    if (referenceMs === undefined) return rank;
    rank.live = signals.filter((signal) => {
      const ms = timeOf(signal);
      return ms !== undefined && referenceMs - ms <= ACTIVITY_HORIZON_MS;
    });
    const best = strongest(signals, referenceMs, ACTIVITY_HORIZON_MS);
    if (best) {
      rank.score = best.score;
      rank.strongest = best.signal;
    }
    return rank;
  });

  const withIndex = ranks.map((rank, index) => ({ rank, index }));
  withIndex.sort((a, b) => {
    const aLive = a.rank.score > 0;
    const bLive = b.rank.score > 0;
    if (aLive !== bLive) return aLive ? -1 : 1;
    if (aLive && bLive && a.rank.score !== b.rank.score) return b.rank.score - a.rank.score;
    return a.index - b.index;
  });
  return withIndex.map((entry) => entry.rank);
}

/**
 * Orders tasks by what has been observed happening to them, strongest evidence first, and
 * returns a new array. It exists because every ordering in Ledge until now came from a number
 * someone typed and then had to keep typing; this one is read from the machine instead.
 *
 * How the order is decided. Each task scores the weight of its strongest signal inside the
 * horizon, halved for every 90 minutes of age, measured from the newest signal in the input.
 * Tasks that score come first, highest first. Tasks with no signal inside the horizon follow in
 * exactly the order they were given, which for a store listing is the person's own order: an
 * absence of evidence is not evidence of absence, and the order they typed is still their
 * statement of priority, so nothing is pushed below its neighbours for being quiet. Equal
 * scores, which happens whenever two tasks name the same repository, also fall back to the
 * given order.
 *
 * What it refuses to conclude:
 *
 * - That a signal identifies a task. A signal about a folder is about a folder. Two tasks can
 *   name the same repository, and then the session and worktree signals are identical on both;
 *   this function cannot tell which of them the work belonged to and does not pretend to, it
 *   leaves them in the person's order and reports the same evidence on each. Anything showing
 *   the ranking should say so where that happens.
 * - That a task is being worked on right now. That is a claim about the present and needs a
 *   clock, which this function does not take; ask `activeTask`.
 * - That a quiet task is finished, stalled, unimportant or misfiled. Silence is not information
 *   about the work, only about the sensors: a task with no repository whose file nobody has
 *   saved is invisible here no matter how urgent it is.
 * - That anything should change but the order of the list. This never sets, clears or suggests a
 *   status, never marks a task done, started or parked, and never edits a file. A person's
 *   `current`, `backlog` and `done` are theirs; observing activity orders what is shown and
 *   nothing more.
 * - That a strong signal and a weak one add up. The score is the strongest single signal, not a
 *   sum, because two signals in the same folder are usually one piece of work seen twice.
 */
export function rankByActivity(tasks: Task[], activity: TaskActivity[]): Task[] {
  return rankWithEvidence(tasks, activity).map((rank) => rank.task);
}

/**
 * The one task that looks like it is being worked on at `now`, or undefined. It exists so a
 * panel can answer "show me the current task" with something it observed, instead of showing
 * whatever sits at order 1.
 *
 * A task qualifies only when it has a signal inside ACTIVE_WINDOW_MS of `now`; among those, the
 * strongest wins, and a tie goes to the earlier task in the list, which for a store listing is
 * the person's order. `now` is a parameter rather than a call to the clock so the answer can be
 * tested and so a caller rendering a saved reading can ask what was true then.
 *
 * What it refuses to conclude. It will not name a task from evidence older than the window: no
 * recent signal returns undefined, which a caller should render as "nothing looks active" rather
 * than falling back to the top of the list, because a confident wrong answer is worse than none.
 * It cannot separate two tasks that share a repository, since the folder signal is the same on
 * both; when that tie decides the winner the answer is a guess dressed as a reading, so callers
 * showing it should also show the evidence and let the person judge. And an active task is not a
 * status: this says what is warm, not what is `current`, and changes nothing.
 */
export function activeTask(tasks: Task[], activity: TaskActivity[], now: Date): Task | undefined {
  const byId = signalsById(activity);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return undefined;
  let best: { task: Task; score: number } | undefined;
  for (const task of tasks) {
    const found = strongest(byId.get(task.id) ?? [], nowMs, ACTIVE_WINDOW_MS);
    if (!found) continue;
    if (!best || found.score > best.score) best = { task, score: found.score };
  }
  return best?.task;
}

/**
 * One sentence saying what is known about a task, for the line under its title: "active now, a
 * Claude Code session in ~/code/unlab-web", "last seen 3h 10m ago, the task file, saved by
 * Ledge", or "no signal in the last 12h, keeping your order".
 *
 * It exists so the panel and the terminal word the same evidence the same way, and so the reason
 * shown to a person is generated from the signal that actually decided the ranking rather than
 * written by hand next to it. The sentence names the evidence, never an interpretation of it: it
 * will not say a task is blocked, urgent, nearly done or forgotten, because no signal here
 * carries any of that.
 */
export function explainActivity(activity: TaskActivity | undefined, now: Date): string {
  const signals = newestFirst(activity?.signals ?? []);
  const nowMs = now.getTime();
  const best = Number.isFinite(nowMs)
    ? strongest(signals, nowMs, ACTIVITY_HORIZON_MS)
    : undefined;
  if (!best) return `no signal in the last ${formatAge(ACTIVITY_HORIZON_MS)}, keeping your order`;
  const age = Math.max(0, nowMs - (timeOf(best.signal) ?? nowMs));
  if (age <= ACTIVE_WINDOW_MS) return `active now, ${best.signal.detail}`;
  return `last seen ${formatAge(age)} ago, ${best.signal.detail}`;
}
