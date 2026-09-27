/**
 * How the panel opens Claude Code on a task, decided as data so it is tested without a
 * terminal. A session that was active in the last 12 hours is resumed with `claude --resume`,
 * because its own transcript is the best context there is. Anything older, and every Open in
 * Claude, starts a fresh session with a briefing as its first prompt instead: a resumed session
 * from last week drags a whole stale conversation into the context window.
 *
 * The briefing is `ledge brief <task-id>` when the CLI has it. When it does not (not installed,
 * an older version, not on the PATH the app can see), the same briefing is built here from the
 * task and its insights, so the button still does the useful thing.
 */
import type { Task } from '@ledge/core/pure';
import { noteDigest } from './digest.ts';
import type { SessionRecord, TaskInsights } from './insights.ts';

/** How recent a session must be for Resume to reopen it rather than brief a new one. */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
/** The contract's cap on the briefing. */
export const BRIEF_MAX_LINES = 40;

export type LaunchPlan = { kind: 'resume'; sessionId: string } | { kind: 'brief' };

function time(iso: string | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

/** The newest session record for a task, by last activity. */
export function lastRecordFor(task: Task, records: SessionRecord[]): SessionRecord | undefined {
  let best: SessionRecord | undefined;
  for (const r of records) {
    if (r.taskId !== task.id && !task.sessions.includes(r.id)) continue;
    if (!best || time(r.lastActivity) > time(best.lastActivity)) best = r;
  }
  return best;
}

/**
 * Resume or brief. `resume` false is Open in Claude, which always briefs. With `sessionId` the
 * question is about that session; without it, about the task's newest one. A session with no
 * record is judged by the task's `updated` time, which is an upper bound on when it last ran.
 */
export function chooseLaunch(input: {
  task: Task;
  records: SessionRecord[];
  now: Date;
  resume: boolean;
  sessionId?: string;
}): LaunchPlan {
  if (!input.resume) return { kind: 'brief' };
  const { task, records } = input;
  const byId = input.sessionId ? records.find((r) => r.id === input.sessionId) : undefined;
  const record = input.sessionId ? byId : lastRecordFor(task, records);
  const id = input.sessionId ?? record?.id ?? task.sessions[task.sessions.length - 1];
  if (!id) return { kind: 'brief' };
  const last = record ? time(record.lastActivity) : time(task.updated);
  if (Number.isNaN(last)) return { kind: 'brief' };
  return input.now.getTime() - last < RESUME_WINDOW_MS ? { kind: 'resume', sessionId: id } : { kind: 'brief' };
}

function firstParagraph(text: string): string {
  return text.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * The briefing built locally, in the shape `ledge brief` prints: title, requirement, current
 * phase, open todos, the last session's summary and the last note's summary, capped at 40
 * lines. Open todos are what get cut when it does not fit, from the end, with a line saying so.
 */
export function buildBrief(task: Task, insights?: TaskInsights, last?: SessionRecord): string {
  const head: string[] = [`Resume the Ledge task "${task.title}" (id: ${task.id}).`];
  if (insights?.headline) head.push(`Where it stands: ${insights.headline}`);
  head.push('', 'Requirement:');
  const req = firstParagraph(task.requirement);
  head.push(req === '' ? '(no requirement recorded yet)' : req);
  if (insights?.phase) head.push('', `Current phase: ${insights.phase}`);

  const tail: string[] = [];
  if (last && (last.title || last.summary)) {
    tail.push('', `Last session: ${[last.title, last.summary].filter(Boolean).join('. ')}`);
  }
  const note = task.notes[task.notes.length - 1];
  if (note) {
    const d = noteDigest(note, insights);
    tail.push('', `Last note (${note.date}): ${[d.title, d.summary].filter(Boolean).join(' ')}`);
  }
  if (task.file !== '') {
    tail.push('', `Task file: ${task.file}`);
    tail.push('Keep the task current with ledge tick, ledge todo and ledge note as you work.');
  }

  const open = task.checklist.filter((i) => !i.done).map((i) => `- ${i.text}`);
  const todoHead = ['', 'Open todos:'];
  const room = BRIEF_MAX_LINES - head.length - tail.length - todoHead.length;
  let todos: string[];
  if (open.length === 0) todos = ['(nothing unchecked; review the task and decide the next step)'];
  else if (open.length <= room) todos = open;
  else {
    const keep = Math.max(0, room - 1);
    todos = [...open.slice(0, keep), `(and ${open.length - keep} more in the task file)`];
  }
  const lines = [...head, ...todoHead, ...todos, ...tail];
  return lines.slice(0, BRIEF_MAX_LINES).join('\n');
}

/**
 * The fixed script behind the `ledge-brief` entry in capabilities/default.json. `$1` is the
 * task id, which the capability also validates. Exit 127 means `ledge` is not installed.
 */
export const BRIEF_SCRIPT =
  'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH LEDGE_CAPTURE=1; ' +
  'command -v ledge >/dev/null 2>&1 || exit 127; exec ledge brief "$1"';

export function briefArgs(taskId: string): string[] {
  return ['-c', BRIEF_SCRIPT, 'ledge-brief', taskId];
}

/** Takes `ledge brief` output only when it looks like one: exit 0, words, within the cap. */
export function acceptBrief(code: number | null, stdout: string): string | undefined {
  if (code !== 0) return undefined;
  const text = stdout.trim();
  if (text === '') return undefined;
  return text.split('\n').slice(0, BRIEF_MAX_LINES).join('\n');
}
