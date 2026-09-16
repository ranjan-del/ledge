/**
 * The handful of claims a card makes that are presentation rather than data: which word names
 * the state a task is in, how far along it is, who the panel is greeting and what the thin
 * summary line under the greeting says.
 *
 * Everything derived from the task files themselves, the next action, the sessions, the notes
 * and the four counts, lives in `@ledge/core/pure` so the CLI and the panel cannot disagree
 * about them. Only what is specific to drawing this panel is here.
 *
 * Nothing in this file invents anything. Each function either returns something derived from
 * data that is in the file, or returns nothing so the caller can show nothing at all.
 */
import type { Config, Task } from '@ledge/core/pure';
import { basename } from './paths.ts';

/** How a task is described in a word. Every one of these is derived, never stored. */
export type StateId = 'working' | 'progress' | 'fresh' | 'parked' | 'done';

export interface TaskState {
  id: StateId;
  /** The words on the pill. */
  label: string;
  /** The mark before the words, so the pill survives greyscale and a colour blind reader. */
  glyph: string;
}

/**
 * The state pill on a card, derived from the task's status, its planned day and its checklist,
 * which are the only three things the file records about how far along it is. Current work
 * planned for today or earlier is what you are working on; current work with something already
 * ticked is under way but is not today's business; current work with nothing ticked has not
 * started. Backlog and archive speak for themselves.
 *
 * None of these means "a session is running", which nothing in the store records.
 */
export function taskState(task: Task, day: string): TaskState {
  if (task.status === 'done') return { id: 'done', label: 'Done', glyph: '✓' };
  if (task.status === 'backlog') return { id: 'parked', label: 'Parked', glyph: '❙❙' };
  if (task.planned !== undefined && task.planned <= day) {
    return { id: 'working', label: 'Working', glyph: '●' };
  }
  if (task.checklist.some((item) => item.done)) {
    return { id: 'progress', label: 'In Progress', glyph: '✦' };
  }
  return { id: 'fresh', label: 'Not started', glyph: '○' };
}

/** Ticked and total checklist items, which is what the progress bar and "20 of 31" show. */
export function progressOf(task: Task): { done: number; total: number } {
  return { done: task.checklist.filter((i) => i.done).length, total: task.checklist.length };
}

/** Time of day in the words a person would use. The only input is the clock. */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Who to greet. `ui.name` in config.json is the answer when someone has set it; otherwise the
 * account folder's name is the only name this machine has told us, and it is at least real.
 * An empty string means greet nobody, which is what an unknown home folder gets.
 */
export function personName(config: Config, home: string): string {
  const named = (config as { ui?: { name?: unknown } }).ui?.name;
  if (typeof named === 'string' && named.trim() !== '') return named.trim();
  const account = basename(home).trim();
  if (account === '') return '';
  return account.charAt(0).toUpperCase() + account.slice(1);
}

/**
 * The thin line under the greeting. Only facts that are actually true get a clause, and a count
 * of zero is left out rather than announced, so the line never pads itself. The wording follows
 * what each count actually means: `sessions` are linked session ids, not live processes.
 */
export function summaryParts(counts: {
  sessions: number;
  working: number;
  pending: number;
}): string[] {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (counts.sessions > 0) parts.push(plural(counts.sessions, 'linked session', 'linked sessions'));
  if (counts.working > 0) parts.push(plural(counts.working, 'active task', 'active tasks'));
  if (counts.pending > 0) parts.push(plural(counts.pending, 'pending task', 'pending tasks'));
  return parts;
}
