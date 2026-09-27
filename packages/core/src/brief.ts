/**
 * The resume briefing: what a fresh Claude Code session is handed when the person opens a task
 * that has no recent session to resume. It is built from the task file and the two sidecars and
 * from nothing else, so it can be printed by `ledge brief` and passed as a prompt by the panel
 * with the same words. Pure, so the desktop could build it too.
 *
 * It is capped at BRIEF_MAX_LINES because it lands as the first prompt of a session, where every
 * line is paid for on every turn after. The order is the order a person picking the work back
 * up would ask in: what is this, where does it stand, what is left, what happened last time.
 */
import { noteKey } from './sidecars.ts';
import type { SessionRecord, TaskInsights } from './sidecars.ts';
import type { Task } from './types.ts';

/** Most lines a briefing may have. */
export const BRIEF_MAX_LINES = 40;

/**
 * The first one or two sentences of a text, flattened to one line and cut at `max` characters.
 * This is the contract's fallback for a note with no AI summary: the person's own first words.
 */
export function firstSentences(text: string, count = 2, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [flat];
  const taken = sentences.slice(0, count).join(' ').replace(/\s+/g, ' ').trim();
  return taken.length <= max ? taken : `${taken.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Builds the briefing for one task. `sessions` may hold any records; only those attributed to
 * this task are used, and the newest one with a summary is quoted. `insights` supplies the
 * headline, the phase and the latest note's title when there is a current entry for it, and the
 * person's own words stand in when there is not.
 */
export function buildBrief(
  task: Task,
  extras: { insights?: TaskInsights; sessions?: SessionRecord[] } = {},
): string {
  const insights = extras.insights?.taskId === task.id ? extras.insights : undefined;
  const head: string[] = [`Resuming the Ledge task "${task.title}" (id: ${task.id}).`];
  if (insights?.headline) head.push(`Where it stands: ${insights.headline}`);
  const phase = insights?.phase ?? task.plan[0];
  if (phase) head.push(`Current phase: ${phase}`);

  const requirement = task.requirement
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

  const open = task.checklist.filter((item) => !item.done).map((item) => `- [ ] ${item.text}`);

  const tail: string[] = [];
  const last = (extras.sessions ?? [])
    .filter((record) => record.taskId === task.id && (record.summary || record.title))
    .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity))[0];
  if (last) {
    const day = last.lastActivity.slice(0, 10);
    const words = [last.title, last.summary].filter(Boolean).join(': ');
    tail.push(`Last session (${day}): ${words}`);
  }
  const note = task.notes[task.notes.length - 1];
  if (note) {
    const entry = insights?.notes[noteKey(note)];
    const words = entry
      ? [entry.title, entry.summary].filter(Boolean).join(': ')
      : firstSentences(note.body);
    tail.push(`Last note (${note.date}): ${words}`);
  }
  tail.push('', 'Read the task with `ledge open ' + task.id + '` if you need more, and keep it current as you work.');

  // When it does not fit, the requirement gives way first and the open items last, because the
  // open items are what the next session acts on and the requirement is one command away.
  const todoLines = open.length === 0 ? ['Open todos: none recorded.'] : ['Open todos:', ...open];
  let req = requirement.length === 0 ? [] : ['Requirement:', ...requirement];
  let todos = todoLines;
  const assemble = (): string[] => [
    ...head,
    '',
    ...(req.length > 0 ? [...req, ''] : []),
    ...todos,
    '',
    ...tail,
  ];
  let reqCut = false;
  while (assemble().length > BRIEF_MAX_LINES && req.length > 2) {
    req = req.slice(0, -1);
    reqCut = true;
  }
  if (reqCut) req = [...req.slice(0, -1), `${req[req.length - 1]} (continues in the task file)`];
  let hidden = 0;
  while (assemble().length > BRIEF_MAX_LINES && todos.length > 2) {
    todos = todos.slice(0, -1);
    hidden++;
  }
  if (hidden > 0) todos = [...todos.slice(0, -1), `- and ${hidden + 1} more open items`];
  const lines = assemble();
  return lines.slice(0, BRIEF_MAX_LINES).join('\n');
}
