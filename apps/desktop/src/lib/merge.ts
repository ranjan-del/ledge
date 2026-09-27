/**
 * What "Merge into…" does to a task that capture created by itself: everything it recorded is
 * carried into a task the person already owns, and nothing already in that task is lost or
 * reworded. It is pure, returns a new task and never mutates either argument; the panel writes
 * the result and then deletes the source file.
 *
 * The rules are the ones a person would apply by hand. Checklist items and plan steps are
 * added only when the target does not already carry the same words, so merging twice changes
 * nothing. Notes are joined by day, the target's words first, and kept in date order, because
 * a note is a day of reasoning and two notes about the same day are one day. Session ids are a
 * union in order. References are appended as pasted. The requirement is taken only when the
 * target has none, since the target's own requirement is the one the person wrote.
 */
import { appendReference, type NoteEntry, type Task } from '@ledge/core/pure';

function same(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function mergeTask(source: Task, target: Task): Task {
  const checklist = [...target.checklist];
  for (const item of source.checklist) {
    if (!checklist.some((have) => same(have.text, item.text))) checklist.push({ ...item });
  }
  const plan = [...target.plan];
  for (const step of source.plan) {
    if (!plan.some((have) => same(have, step))) plan.push(step);
  }
  const byDay = new Map<string, string>();
  for (const note of target.notes) byDay.set(note.date, note.body);
  for (const note of source.notes) {
    const have = byDay.get(note.date);
    if (have === undefined) byDay.set(note.date, note.body);
    else if (!have.includes(note.body.trim())) byDay.set(note.date, `${have}\n\n${note.body}`);
  }
  const notes: NoteEntry[] = [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, body]) => ({ date, body }));
  const sessions = [...target.sessions];
  for (const id of source.sessions) if (!sessions.includes(id)) sessions.push(id);

  let next: Task = {
    ...target,
    checklist,
    plan,
    notes,
    sessions,
    requirement: target.requirement.trim() === '' ? source.requirement : target.requirement,
  };
  if (source.references.trim() !== '') next = appendReference(next, source.references);
  return next;
}

/** A task with `origin: auto` removed, for when the person has claimed it by renaming it. */
export function withoutAutoOrigin(task: Task): Task {
  if (task.meta?.origin !== 'auto') return task;
  const { origin: _origin, ...rest } = task.meta;
  const next: Task = { ...task };
  if (Object.keys(rest).length > 0) next.meta = rest;
  else delete next.meta;
  return next;
}

/** True for a task capture created by itself and nobody has claimed yet. */
export function isAutoTask(task: Task): boolean {
  return task.meta?.origin === 'auto';
}
