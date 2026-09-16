/**
 * What has changed on the desk since the last time the panel looked, and what that is worth
 * saying out loud. Two readers use it: the notification centre, which wants each change as an
 * item, and the return to work summary, which wants the whole stretch you were away as a few
 * lines. Both come from the same place so they can never tell different stories.
 *
 * The method is the whole point. A change is the difference between two observations of the
 * store, so this file defines an observation, `snapshot`, and the comparison, `diff`. The
 * previous observation is kept in the store folder, which is what stops a notification firing
 * again every time the app starts. Nothing is invented and nothing is inferred: if the files do
 * not record it, no reader of this file can claim it.
 *
 * What this deliberately cannot detect, because nothing in the store records it: that a session
 * started or ended, how long one ran, what it changed, which files a commit touched, who wrote
 * a note, and what time of day any note was written, since a note carries a calendar day and
 * nothing finer. The first observation of anything is never a change: a task or a repository
 * seen for the first time is recorded and passed over, so a fresh store is silent rather than
 * announcing everything it has ever held.
 */
import type { RepoStatus, Task } from '@ledge/core/pure';
import { basename } from './paths.ts';
import { dayLabel } from './time.ts';

/** What was observed about one task. Counts and stamps only: the text is in the file. */
export interface TaskObservation {
  title: string;
  updated: string;
  /** Ticked checklist items, and how many there are. */
  done: number;
  total: number;
  /** Dated note entries. */
  notes: number;
  /** Total length of the note bodies, so an append to today's note is visible too. */
  noteChars: number;
  /** The newest note's day, when there is one. */
  lastNote?: string;
  /** Recorded Claude Code session ids. */
  sessions: number;
  /** The day the task is planned for, when the file names one. */
  planned?: string;
}

export interface RepoObservation {
  branch: string;
  /** Uncommitted paths, tracked and untracked. */
  dirty: number;
  /** Commits ahead of the upstream. */
  ahead: number;
}

/** One complete look at the desk. */
export interface Observation {
  /** When the look was taken, ISO 8601. */
  at: string;
  /** Keyed by task file, which is the identity the store itself uses. */
  tasks: Record<string, TaskObservation>;
  /** Keyed by absolute repository path. */
  repos: Record<string, RepoObservation>;
  /** Files in `archive/`, which is how many tasks have been finished. */
  archived: number;
  /**
   * `<task file>|<day>` pairs already nudged about, so "planned for today and still untouched"
   * is said once a day rather than every time the scan comes round.
   */
  nudged: string[];
}

export type NotifyKind =
  | 'checklist-complete'
  | 'note-added'
  | 'repo-uncommitted'
  | 'repo-unpushed'
  | 'repo-pile'
  | 'planned-untouched';

/** Colour is the second signal on a notification; the detail line always says it in words. */
export type NotifyTone = 'done' | 'attention' | 'neutral';

export interface Notification {
  /** Stable for the change it describes, so one change cannot queue twice. */
  id: string;
  kind: NotifyKind;
  tone: NotifyTone;
  /** The thing this is about: a task's title, or a repository's short name. */
  title: string;
  /** What happened, in words, from the numbers that changed. */
  detail: string;
  /** When it was observed, ISO 8601. Not when it happened, which nothing records. */
  at: string;
  /** The task file to open. Absent for a repository. */
  file?: string;
  /** The repository path. Absent for a task. */
  repo?: string;
  /** Read once the centre has been opened. */
  read?: boolean;
}

/**
 * Uncommitted files past which a repository is a pile rather than a change. Crossing it is
 * worth saying on its own, because the difference between four uncommitted files and three
 * hundred is the difference between work in progress and work that could be lost.
 */
export const PILE_THRESHOLD = 100;

function noteChars(task: Task): number {
  return task.notes.reduce((n, note) => n + note.body.length, 0);
}

/** Takes one look at the desk. Pure: everything it needs is passed in. */
export function snapshot(input: {
  tasks: Task[];
  repos: RepoStatus[];
  archived: number;
  at: string;
  nudged?: string[];
}): Observation {
  const tasks: Record<string, TaskObservation> = {};
  for (const task of input.tasks) {
    const observed: TaskObservation = {
      title: task.title,
      updated: task.updated,
      done: task.checklist.filter((item) => item.done).length,
      total: task.checklist.length,
      notes: task.notes.length,
      noteChars: noteChars(task),
      sessions: task.sessions.length,
    };
    const last = task.notes[task.notes.length - 1];
    if (last) observed.lastNote = last.date;
    if (task.planned !== undefined) observed.planned = task.planned;
    tasks[task.file] = observed;
  }
  const repos: Record<string, RepoObservation> = {};
  for (const repo of input.repos) {
    repos[repo.repo] = { branch: repo.branch, dirty: repo.dirty.length, ahead: repo.ahead };
  }
  return {
    at: input.at,
    tasks,
    repos,
    archived: input.archived,
    nudged: input.nudged ?? [],
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The key that records a nudge as already given. */
export function nudgeKey(file: string, day: string): string {
  return `${file}|${day}`;
}

/**
 * Everything worth saying about the difference between two looks at the desk, newest first.
 *
 * Every branch below is a crossing, not a level: a repository that was already dirty when we
 * last looked says nothing, because a notification that repeats what you already know is how a
 * notification centre becomes something people close without reading. The one exception is the
 * nudge about a task planned for today, which is a level rather than a crossing; it is said
 * once per task per day and the ledger of what has been said lives in the observation.
 */
export function diff(previous: Observation, next: Observation, day: string): Notification[] {
  const out: Notification[] = [];
  const at = next.at;

  for (const [file, task] of Object.entries(next.tasks)) {
    const was = previous.tasks[file];
    if (!was) continue;

    if (task.total > 0 && task.done === task.total && was.total > 0 && was.done < was.total) {
      out.push({
        id: `checklist:${file}`,
        kind: 'checklist-complete',
        tone: 'done',
        title: task.title,
        detail: `Checklist complete, all ${plural(task.total, 'item', 'items')} ticked`,
        at,
        file,
      });
    }

    if (task.notes > was.notes || task.noteChars > was.noteChars) {
      const when = task.lastNote ? ` under ${dayLabel(task.lastNote, day)}` : '';
      out.push({
        id: `note:${file}:${task.lastNote ?? ''}:${task.noteChars}`,
        kind: 'note-added',
        tone: 'neutral',
        title: task.title,
        detail: `Note written${when}`,
        at,
        file,
      });
    }

    const untouched = task.done === 0 && task.lastNote !== day;
    if (task.planned === day && task.total > 0 && untouched) {
      const key = nudgeKey(file, day);
      if (!previous.nudged.includes(key)) {
        out.push({
          id: `planned:${key}`,
          kind: 'planned-untouched',
          tone: 'attention',
          title: task.title,
          detail: `Planned for today, nothing ticked yet of ${task.total}`,
          at,
          file,
        });
      }
    }
  }

  for (const [repo, state] of Object.entries(next.repos)) {
    const was = previous.repos[repo];
    if (!was) continue;
    const name = basename(repo);

    const uncommitted =
      `${plural(state.dirty, 'uncommitted file', 'uncommitted files')} on ${state.branch}`;
    if (state.dirty >= PILE_THRESHOLD && was.dirty < PILE_THRESHOLD) {
      out.push({
        id: `pile:${repo}`,
        kind: 'repo-pile',
        tone: 'attention',
        title: name,
        detail: uncommitted,
        at,
        repo,
      });
    } else if (state.dirty > 0 && was.dirty === 0) {
      out.push({
        id: `dirty:${repo}`,
        kind: 'repo-uncommitted',
        tone: 'attention',
        title: name,
        detail: uncommitted,
        at,
        repo,
      });
    }

    if (state.ahead > 0 && was.ahead === 0) {
      out.push({
        id: `ahead:${repo}`,
        kind: 'repo-unpushed',
        tone: 'attention',
        title: name,
        detail: `${plural(state.ahead, 'commit', 'commits')} not pushed on ${state.branch}`,
        at,
        repo,
      });
    }
  }

  return out;
}

/** The nudge ledger for the given day: what was already there, plus what has just been said. */
export function nudgedAfter(
  previous: Observation,
  fired: Notification[],
  day: string,
): string[] {
  const keys = new Set(previous.nudged.filter((key) => key.endsWith(`|${day}`)));
  for (const item of fired) {
    if (item.kind === 'planned-untouched' && item.file) keys.add(nudgeKey(item.file, day));
  }
  return [...keys];
}

export interface NotifyGroup {
  /** The quiet label over the group. */
  label: string;
  items: Notification[];
}

const GROUPS: { label: string; kinds: NotifyKind[] }[] = [
  { label: 'Checklists', kinds: ['checklist-complete'] },
  { label: 'Repositories', kinds: ['repo-pile', 'repo-uncommitted', 'repo-unpushed'] },
  { label: 'Planned', kinds: ['planned-untouched'] },
  { label: 'Notes', kinds: ['note-added'] },
];

/**
 * Groups notifications by what they are about, newest group first. Grouping is by kind rather
 * than by day: a centre read once a week would otherwise be a list of dates, and what a person
 * wants to know is whether anything happened to their repositories, not whether anything
 * happened on Tuesday.
 */
export function groupNotifications(items: Notification[]): NotifyGroup[] {
  const groups: NotifyGroup[] = [];
  for (const spec of GROUPS) {
    const found = items
      .filter((item) => spec.kinds.includes(item.kind))
      .sort((a, b) => b.at.localeCompare(a.at));
    if (found.length > 0) groups.push({ label: spec.label, items: found });
  }
  return groups.sort((a, b) => (b.items[0]?.at ?? '').localeCompare(a.items[0]?.at ?? ''));
}
