/**
 * Derived views over a list of tasks, one per surface the desktop app shows: Now, Sessions,
 * Tasks and Memory. Nothing here reads a file or touches `node:` anything: a caller hands over
 * the tasks it already parsed and gets back plain data, so the CLI and the WebView share the
 * same answers. Every function is a pure read; none of them mutates its argument.
 *
 * The rule the whole file follows is that a view may only restate what the task files record.
 * Where the files are silent, these functions say nothing rather than guessing, and the doc
 * comments below name what the files would have to record for the view to know more.
 */
import type { MemoryEntry, NextAction, SessionRef, SurfaceCounts, Task } from './types.ts';

/**
 * Lists every Claude Code session id recorded across the given tasks, newest `lastSeen` first
 * and, within one task, the newest id first. It exists because a session is where work happens
 * while a task is what is being accomplished, and the desktop's Sessions surface cannot render a
 * bare id: it needs the task the id belongs to, its title and its repo.
 *
 * What this deliberately does not claim to know. A task file records a session id and nothing
 * else about that session, so this function cannot say whether a session is still running, when
 * it started, how long it lasted, or what it did, and it models none of those. `lastSeen` is the
 * task's `updated` timestamp, which is the closest thing the files hold: the Stop hook appends
 * the id and that save bumps `updated`, so for the newest id on a task the two coincide. For an
 * older id the same value is carried as an upper bound, not as a claim that the session was
 * active then. Knowing more would need the plugin to record a start time and a last-activity
 * time alongside the id, at which point this function should read those instead.
 *
 * An id is skipped when it is blank, and when the same id already appeared in the same task, so
 * a hand-edited file cannot produce two rows claiming to be the same session of one task. The
 * same id on two different tasks is two rows, because the pairing is what the surface shows.
 */
export function sessionsFor(tasks: Task[]): SessionRef[] {
  const refs: SessionRef[] = [];
  for (const task of tasks) {
    const seen = new Set<string>();
    for (let i = task.sessions.length - 1; i >= 0; i--) {
      const id = (task.sessions[i] ?? '').trim();
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      const ref: SessionRef = {
        id,
        taskId: task.id,
        taskTitle: task.title,
        lastSeen: task.updated,
        isLatest: i === task.sessions.length - 1,
      };
      if (task.repo !== undefined) ref.repo = task.repo;
      refs.push(ref);
    }
  }
  return refs.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/**
 * Flattens the dated notes of every task into one list, newest date first. The notes are the
 * only place a session's reasoning is written down, so read across tasks they are the memory
 * layer; no single task file can show it, which is why this function exists.
 *
 * What this deliberately does not claim to know. A note carries a calendar day and nothing
 * finer, so entries written on the same day cannot be ordered against each other and are left
 * in the order the tasks were given. Nothing records who or which session wrote an entry, so no
 * author is reported. The body is returned exactly as the file spells it, including an empty
 * one, because a dated heading with nothing under it is itself what the file says.
 */
export function memoryFor(tasks: Task[]): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const task of tasks) {
    for (let i = task.notes.length - 1; i >= 0; i--) {
      const note = task.notes[i]!;
      const entry: MemoryEntry = {
        taskId: task.id,
        taskTitle: task.title,
        date: note.date,
        body: note.body,
      };
      if (task.repo !== undefined) entry.repo = task.repo;
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Filters memory entries to the ones matching every whitespace-separated term of `query`, in
 * the note body or in the task title, ignoring case. It exists so the Memory surface can be
 * searched without an index, a dependency or a server.
 *
 * The matching is deliberately plain: substring containment, all terms required, no ranking, no
 * stemming and no fuzzy matching, and results come back in the order they were given. A person
 * reading this list has to be able to predict what it will return; a scoring function that
 * reorders results, or one that matches words nobody typed, would make the surface guesswork. A
 * query that is blank or only whitespace has no terms, so every entry matches and the list comes
 * back unchanged.
 */
export function searchMemory(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '');
  if (terms.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = `${entry.body}\n${entry.taskTitle}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Returns the one thing to do next on a task, or undefined when the files do not say. It exists
 * because every surface that lists tasks wants a single honest line under the title, and the
 * alternative, a sentence assembled from the requirement, would be text nobody wrote.
 *
 * The first unticked checklist item wins, because the checklist is the tracking. When there is
 * no checklist at all the first plan step is used instead, because a plan written before work
 * started is still the person's own words about what comes first. A checklist whose items are
 * all ticked returns undefined rather than falling back to the plan: the plan describes work the
 * checklist already accounts for, so offering a step from it would be a guess. Nothing is ever
 * synthesised, trimmed into a new sentence or reworded.
 */
export function nextActionFor(task: Task): NextAction | undefined {
  const open = task.checklist.find((item) => !item.done);
  if (open) return { text: open.text, source: 'checklist' };
  if (task.checklist.length === 0 && task.plan.length > 0) {
    return { text: task.plan[0]!, source: 'plan' };
  }
  return undefined;
}

/**
 * Counts the four surfaces in one pass, so a header can be rendered from a single call rather
 * than from four that might disagree about which task list they walked.
 *
 * Each count means exactly this, because a count whose meaning is unclear is worse than no
 * count at all:
 *
 * - `now`: tasks whose status is `current`. Not tasks planned for today, and not tasks being
 *   worked on right now, which nothing records.
 * - `sessions`: distinct newest session ids, one per task that has any, counted once when two
 *   tasks name the same id. It is not the number of sessions ever run, and not the number of
 *   live sessions, neither of which the files know.
 * - `tasks`: every task passed in, whatever its status. The caller decides what that covers: a
 *   store's `list()` leaves out the archive, so pass the archived tasks too when done work is
 *   meant to be counted.
 * - `memory`: total dated note entries across the tasks, one per day per task, not one per line
 *   or per paragraph of a note.
 */
export function surfaceCounts(tasks: Task[]): SurfaceCounts {
  const latest = new Set<string>();
  let memory = 0;
  let now = 0;
  for (const task of tasks) {
    if (task.status === 'current') now++;
    memory += task.notes.length;
    for (let i = task.sessions.length - 1; i >= 0; i--) {
      const id = (task.sessions[i] ?? '').trim();
      if (id === '') continue;
      latest.add(id);
      break;
    }
  }
  return { now, sessions: latest.size, tasks: tasks.length, memory };
}
