/**
 * Pure helpers for the three v2 additions: the planned calendar day, the dated notes and the
 * ordered plan (contract section 3). Nothing here touches the filesystem or `node:` anything, so
 * both entries of @ledge/core export these and the desktop WebView can call them directly. Every
 * function returns a new Task and never mutates its argument, because the store's pattern is
 * read, pure transform, save.
 */
import { matchChecklistItem, matchItem } from './capture.ts';
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
 * Adds `text` under whatever is already in `## References`, separated by one blank line, and
 * returns a copy of the task. Appending rather than replacing is the whole point: the common act
 * is pasting a second thing to look at an hour after the first, and that must never mean
 * re-editing what is already there. Trailing whitespace is dropped so the file grows no blank
 * tail; nothing else about the text is touched. Blank text is a no-op, so an accidental empty
 * paste leaves the task exactly as it was.
 */
export function appendReference(task: Task, text: string): Task {
  const body = text.replace(/\s+$/, '');
  if (body.trim() === '') return { ...task };
  const current = task.references ?? '';
  return { ...task, references: current === '' ? body : `${current}\n\n${body}` };
}

/**
 * Replaces the plan with `steps`, dropping blank ones and trimming the rest. The plan is the
 * intent written before work starts, so replacing it wholesale is the honest operation: a plan
 * that has changed is a new plan, not an edited list.
 */
export function setPlan(task: Task, steps: string[]): Task {
  return { ...task, plan: steps.map((step) => step.trim()).filter((step) => step !== '') };
}

/**
 * Folds one task into another and returns the copy of `into` that results; `from` itself is
 * left alone, removing it is the store's job. This is how two records of one piece of work
 * become one again: the child's checklist moves into the parent marked with the child's title,
 * `[child title] item`, so the parent can still tell which subtask each line came from. A plan
 * step the child never turned into a checklist item moves over as an unchecked item too, since
 * a child's plan is its to-do list. An item the parent already has is not repeated, though a
 * tick on the child's copy still ticks it. A child with nothing to carry still leaves one line,
 * its own title, so the subtask is not lost from view.
 *
 * Everything that is not a to-do keeps its meaning: each dated note goes under the same day in
 * the parent, introduced by where it came from, and the requirement, plan and references go
 * into References as raw material. Sessions are joined so the history of both stays reachable.
 * The parent's title, status, order, repo, plan and requirement are never changed.
 */
export function mergeTask(into: Task, from: Task): Task {
  const label = from.title.trim();
  const checklist = into.checklist.map((item) => ({ ...item }));
  const carry = (text: string, done: boolean) => {
    const at = matchChecklistItem(checklist.map((item) => item.text), text);
    if (at < 0) checklist.push({ text, done });
    else if (done) checklist[at] = { ...checklist[at]!, done: true };
  };
  const mark = (text: string) => (/^\[[^\]]+\]/.test(text) ? text : `[${label}] ${text}`);
  for (const item of from.checklist) carry(mark(item.text), item.done);
  const own = from.checklist.map((item) => item.text);
  for (const step of from.plan) {
    if (matchItem(own, step) < 0) carry(mark(step), from.status === 'done');
  }
  if (from.checklist.length === 0 && from.plan.length === 0) carry(label, from.status === 'done');

  let next: Task = { ...into, checklist };
  for (const note of from.notes) {
    next = appendNote(next, `From "${label}":\n\n${note.body}`, note.date);
  }
  next.notes = [...next.notes].sort((a, b) => a.date.localeCompare(b.date));

  const material = [`Merged from "${label}" (${from.id}):`];
  if (from.requirement !== '') material.push('', from.requirement);
  if (from.plan.length > 0) material.push('', ...from.plan.map((step, i) => `${i + 1}. ${step}`));
  if (from.references !== '') material.push('', from.references);
  if (material.length > 1) next = appendReference(next, material.join('\n'));

  next.sessions = [...new Set([...into.sessions, ...from.sessions])];
  if (next.planned === undefined && from.planned !== undefined) next.planned = from.planned;
  return next;
}
