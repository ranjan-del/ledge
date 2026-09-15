/**
 * Pure helpers for the three v2 additions: the planned calendar day, the dated notes and the
 * ordered plan (contract section 3). Nothing here touches the filesystem or `node:` anything, so
 * both entries of @ledge/core export these and the desktop WebView can call them directly. Every
 * function returns a new Task and never mutates its argument, because the store's pattern is
 * read, pure transform, save.
 */
import type { NoteEntry, Task } from './types.ts';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a Date as a calendar day in local time, `YYYY-MM-DD`. Planned dates and note
 * subheadings are days, not instants: "today" has to mean the day the person is living in, so
 * this reads the local calendar rather than UTC.
 */
export function isoDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * True when a value is a real calendar day spelled `YYYY-MM-DD`. Used to validate the `planned`
 * frontmatter field and the `### ` note subheadings, so a hand-typed `2026-02-31` is rejected
 * instead of silently becoming March.
 */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Adds `days` to a calendar day and returns the result as `YYYY-MM-DD`. Exists so `ledge when
 * <id> tomorrow` does not have to do date arithmetic by hand, and so month and year ends are
 * handled by the platform rather than by a guess.
 */
export function shiftDay(day: string, days: number): string {
  const m = ISO_DAY.exec(day);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD day: ${day}`);
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Splits tasks into the ones planned for `day` and the ones planned before it that are still not
 * done. This is the whole answer to "what is on for today", which a flat list of tasks cannot
 * give: it is what `ledge today` and the panel's home view are built on. Input order is kept in
 * both lists, so a caller that sorted by `order` stays sorted. Tasks with no `planned` date
 * appear in neither list.
 */
export function plannedFor(tasks: Task[], day: string): { today: Task[]; overdue: Task[] } {
  const today: Task[] = [];
  const overdue: Task[] = [];
  for (const task of tasks) {
    const planned = task.planned;
    if (!planned) continue;
    if (planned === day) today.push(task);
    else if (planned < day && task.status !== 'done') overdue.push(task);
  }
  return { today, overdue };
}

/**
 * Appends text to the note subsection for `day`, creating that subsection at the end when it is
 * absent. Existing entries are never reordered and never rewritten, so the notes stay a
 * chronological record that a later session can trust. Blank text is a no-op: the task comes
 * back unchanged rather than growing an empty subsection.
 */
export function appendNote(task: Task, text: string, day: string = isoDay()): Task {
  const body = text.trim();
  if (body === '') return { ...task };
  const notes: NoteEntry[] = task.notes.map((note) => ({ ...note }));
  const existing = notes.find((note) => note.date === day);
  if (existing) existing.body = existing.body === '' ? body : `${existing.body}\n\n${body}`;
  else notes.push({ date: day, body });
  return { ...task, notes };
}

/**
 * Replaces the plan with `steps`, dropping blank ones and trimming the rest. The plan is the
 * intent written before work starts, so replacing it wholesale is the honest operation: a plan
 * that has changed is a new plan, not an edited list.
 */
export function setPlan(task: Task, steps: string[]): Task {
  return { ...task, plan: steps.map((step) => step.trim()).filter((step) => step !== '') };
}
