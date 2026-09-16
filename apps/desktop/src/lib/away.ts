/**
 * What changed while nobody was looking, as a few lines. The panel is opened and closed all day,
 * so the interesting question when it comes back is not "what is on the desk" but "what moved
 * since I last looked", and the desk itself cannot answer that: only the difference between two
 * observations can.
 *
 * Every line is a count of something the store records, and a count of zero produces no line at
 * all rather than a line saying zero. A stretch in which nothing happened comes back with no
 * lines, and the caller says so in one sentence instead of filling the space.
 *
 * The threshold for "a while" is worked out from the store's own timestamps rather than picked:
 * see `idleThresholdMs`.
 */
import type { Observation } from './observed.ts';

/** Nothing shorter than this counts as being away, however quiet the store is. */
export const IDLE_MIN_MS = 30 * 60_000;
/** And nothing longer, however busy it is: a whole working day away is away. */
export const IDLE_MAX_MS = 8 * 60 * 60_000;

/**
 * How long the panel has to have been unwatched before coming back to it is a return rather
 * than a glance, in milliseconds.
 *
 * It is the median gap between consecutive writes in the store, clamped to between half an hour
 * and eight hours. The reasoning: the store's own write cadence is the only evidence this
 * machine has about how fast the person works, and the interval that matters is the one after
 * which something has probably happened. Someone who saves a file every ten minutes should be
 * told about a two hour absence; someone whose tasks move twice a week should not be shown a
 * summary because they went to lunch. The clamp is there because a median over two or three
 * timestamps is a weak measurement, and both ends of it would otherwise be absurd.
 */
export function idleThresholdMs(stamps: string[]): number {
  const times = stamps
    .map((stamp) => Date.parse(stamp))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i]! - times[i - 1]!);
  if (gaps.length === 0) return IDLE_MIN_MS;
  gaps.sort((a, b) => a - b);
  const half = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[half]! : (gaps[half - 1]! + gaps[half]!) / 2;
  return Math.min(Math.max(median, IDLE_MIN_MS), IDLE_MAX_MS);
}

export interface AwaySummary {
  /** When the panel was last watched, ISO 8601. */
  since: string;
  /** One clause per thing that actually changed, already worded. Empty when nothing did. */
  lines: string[];
  /** The task to go back to: the most recently written one. Absent when there are none. */
  resumeFile?: string;
  resumeTitle?: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function repoWord(n: number): string {
  return n === 1 ? 'repository' : 'repositories';
}

/**
 * The summary of everything between two observations. Only tasks and repositories present in
 * both are compared: something that appeared while you were away has no previous state to be
 * measured against, so its arrival is not counted as a change to it.
 *
 * What the lines can and cannot say. "Uncommitted files" is a count from `git status`, so the
 * summary can say how many more or fewer there are but not which ones, and a file changed and
 * then changed back is invisible to it. "Commits" are commits ahead of the upstream, so a push
 * lowers the count rather than raising it and is not reported as commits added. "Tasks
 * finished" is the number of files in `archive/`, which grows by one per finished task; the
 * titles are not named because the archive is not parsed at boot.
 */
export function awaySummary(previous: Observation, next: Observation): AwaySummary {
  let filesAdded = 0;
  let filesCleared = 0;
  let reposDirtier = 0;
  let reposCleaner = 0;
  let commits = 0;
  let reposAhead = 0;
  for (const [repo, state] of Object.entries(next.repos)) {
    const was = previous.repos[repo];
    if (!was) continue;
    const dirty = state.dirty - was.dirty;
    if (dirty > 0) {
      filesAdded += dirty;
      reposDirtier += 1;
    } else if (dirty < 0) {
      filesCleared += -dirty;
      reposCleaner += 1;
    }
    const ahead = state.ahead - was.ahead;
    if (ahead > 0) {
      commits += ahead;
      reposAhead += 1;
    }
  }

  let notes = 0;
  let sessions = 0;
  let ticked = 0;
  for (const [file, task] of Object.entries(next.tasks)) {
    const was = previous.tasks[file];
    if (!was) continue;
    if (task.notes > was.notes || task.noteChars > was.noteChars) notes += 1;
    if (task.sessions > was.sessions) sessions += task.sessions - was.sessions;
    if (task.done > was.done) ticked += task.done - was.done;
  }

  const finished = Math.max(0, next.archived - previous.archived);

  const lines: string[] = [];
  if (filesAdded > 0) {
    lines.push(
      `${plural(filesAdded, 'file changed', 'files changed')} in ` +
        `${reposDirtier} ${repoWord(reposDirtier)}`,
    );
  }
  if (filesCleared > 0) {
    lines.push(
      `${plural(filesCleared, 'file committed or cleared', 'files committed or cleared')} in ` +
        `${reposCleaner} ${repoWord(reposCleaner)}`,
    );
  }
  if (commits > 0) {
    lines.push(
      `${plural(commits, 'commit added', 'commits added')} in ` +
        `${reposAhead} ${repoWord(reposAhead)}, not yet pushed`,
    );
  }
  if (finished > 0) lines.push(plural(finished, 'task finished', 'tasks finished'));
  if (ticked > 0) {
    lines.push(plural(ticked, 'checklist item ticked', 'checklist items ticked'));
  }
  if (notes > 0) lines.push(plural(notes, 'note written', 'notes written'));
  if (sessions > 0) lines.push(plural(sessions, 'session linked', 'sessions linked'));

  const summary: AwaySummary = { since: previous.at, lines };
  const recent = Object.entries(next.tasks).sort((a, b) =>
    b[1].updated.localeCompare(a[1].updated),
  )[0];
  if (recent) {
    summary.resumeFile = recent[0];
    summary.resumeTitle = recent[1].title;
  }
  return summary;
}
