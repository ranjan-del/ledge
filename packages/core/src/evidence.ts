/**
 * Whether a session actually worked on a task. Pure: a caller hands over two snapshots and gets
 * back a verdict with its reasons, so the same rule runs in the CLI, in a hook and in the
 * desktop app. Nothing here reads a file, runs git or looks at a clock.
 *
 * This exists because a task must not be promoted out of the backlog for being opened. Opening
 * a session is an intent to work; only a change in the record of the work is evidence of it.
 */
import type { ChecklistItem, NoteEntry, Task } from './types.ts';

/**
 * What git reported about a task's repository at one moment. `commits` is how many commits are
 * reachable from HEAD and `dirty` is one `"<code> <path>"` string per changed or untracked path,
 * sorted, which is what `git status --porcelain=v2` already gives.
 */
export interface GitSnapshot {
  commits: number;
  dirty: string[];
}

/**
 * Everything about a task that can be observed at the start and at the end of a session, and
 * nothing else. The fields are exactly the ones whose change counts as work: the checklist, the
 * notes, the plan and the state of the task's repository.
 *
 * What is deliberately absent is as important as what is here. There is no timestamp, no session
 * id, no `updated` field and no file modification time, because a snapshot that carried any of
 * those would differ between two moments in which nothing was done.
 */
export interface Snapshot {
  checklist: ChecklistItem[];
  notes: NoteEntry[];
  plan: string[];
  /** Absent when the task names no repository, or when git could not be read there. */
  git?: GitSnapshot;
}

/** The verdict of `evidenceOfWork` and the reasons behind it, in the order they were checked. */
export interface WorkEvidence {
  worked: boolean;
  reasons: string[];
}

/**
 * Builds the task half of a snapshot, copying only the fields whose change counts as work. The
 * git half is passed in because reading it needs a child process, which this module will not do.
 * Callers in Node should use `takeSnapshot` from `@ledge/core`, which fills both halves in.
 */
export function snapshotOfTask(task: Task, git?: GitSnapshot): Snapshot {
  const snapshot: Snapshot = {
    checklist: task.checklist.map((item) => ({ text: item.text, done: item.done })),
    notes: task.notes.map((note) => ({ date: note.date, body: note.body })),
    plan: [...task.plan],
  };
  if (git) snapshot.git = { commits: git.commits, dirty: [...git.dirty].sort() };
  return snapshot;
}

/** How many checklist items went from unticked to ticked, matched by their text, not by index. */
function tickedCount(before: ChecklistItem[], after: ChecklistItem[]): number {
  const doneByText = (items: ChecklistItem[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.done) continue;
      counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
    }
    return counts;
  };
  const was = doneByText(before);
  let ticked = 0;
  for (const [text, count] of doneByText(after)) {
    ticked += Math.max(0, count - (was.get(text) ?? 0));
  }
  return ticked;
}

/** 'written' for a day that had no note, 'extended' for a day whose note text changed. */
function noteChange(before: NoteEntry[], after: NoteEntry[]): 'written' | 'extended' | 'none' {
  const was = new Map(before.map((note) => [note.date, note.body.trim()]));
  for (const note of after) {
    if (!was.has(note.date) && note.body.trim() !== '') return 'written';
  }
  for (const note of after) {
    const old = was.get(note.date);
    if (old !== undefined && old !== note.body.trim()) return 'extended';
  }
  return 'none';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Decides whether work happened between two snapshots of the same task, and says why. The reasons
 * are the point: a promotion a person cannot audit is a promotion they cannot trust, so the
 * verdict never travels without the sentences that produced it. When the verdict is false the
 * reasons name each thing that was looked at and found unchanged.
 *
 * What counts, in the order it is checked: a checklist item ticked, a checklist item added, a
 * note written for a new day, a note extended on a day that already had one, a change to the
 * plan, commits gained in the task's repository, and a change to that repository's working tree.
 *
 * What this deliberately refuses to count as work, because a false promotion is worse than a
 * missed one:
 *
 * - time passing, a session existing, or a session id being recorded on the task; none of them
 *   is in a Snapshot at all, so a session that only opened and closed cannot move anything;
 * - the task file being saved, re-serialized or touched without its content changing, since the
 *   snapshot holds no `updated` field and no file timestamp;
 * - HEAD moving without the commit count rising, which is a branch switch, a checkout or a
 *   reset rather than work done here;
 * - a checklist item being unticked, removed, or having its text edited, and a note being
 *   deleted or a plan step being removed; going backwards is not evidence of going forwards;
 * - anything about a repository the task does not name, because a task with no repo can only be
 *   judged on its own file.
 */
export function evidenceOfWork(before: Snapshot, after: Snapshot): WorkEvidence {
  const reasons: string[] = [];

  const ticked = tickedCount(before.checklist, after.checklist);
  if (ticked === 1) reasons.push('a checklist item was ticked');
  else if (ticked > 1) reasons.push(`${plural(ticked, 'checklist item')} were ticked`);
  const added = after.checklist.length - before.checklist.length;
  if (added === 1) reasons.push('a checklist item was added');
  else if (added > 1) reasons.push(`${plural(added, 'checklist item')} were added`);

  const note = noteChange(before.notes, after.notes);
  if (note === 'written') reasons.push('a note was written');
  else if (note === 'extended') reasons.push('a note was extended');

  if (before.plan.join('\n') !== after.plan.join('\n')) reasons.push('the plan changed');

  const gitBefore = before.git;
  const gitAfter = after.git;
  if (gitBefore && gitAfter) {
    const gained = gitAfter.commits - gitBefore.commits;
    if (gained > 0) reasons.push(`the repository gained ${plural(gained, 'commit')}`);
    const wasDirty = [...gitBefore.dirty].sort().join('\n');
    const isDirty = [...gitAfter.dirty].sort().join('\n');
    if (wasDirty !== isDirty) reasons.push('the working tree changed');
  }

  if (reasons.length > 0) return { worked: true, reasons };

  const why = [
    'no checklist item was ticked or added',
    'no note was written or extended',
    'the plan is unchanged',
  ];
  if (gitBefore && gitAfter) {
    why.push('the repository gained no commits and its working tree is unchanged');
  } else {
    why.push('no git state was observed, so nothing in a repository could count');
  }
  return { worked: false, reasons: why };
}
