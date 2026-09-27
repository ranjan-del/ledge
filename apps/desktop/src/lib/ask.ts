/**
 * The desk as the assistant is told about it, in one context block, plus two small readers of
 * what Claude Code prints: the `ledge` part of a shell command, and why a run failed in words a
 * person can act on. This began as Ask Ledge, the one-question sheet the Assistant tab replaced;
 * what is left is the part the assistant engine still uses.
 */
import { renderAskContext, type RepoStatus, type Task } from '@ledge/core/pure';
import {
  isSessionRunning,
  type SessionRecord,
  type TaskInsights,
} from '@ledge/core/pure';
import { numberedLines } from './week-view.ts';
import type { WeekFile } from '@ledge/core/pure';

/** How many recent session records the context carries. */
export const RECENT_SESSIONS = 8;

export interface LedgeContextInput {
  day: string;
  tasks: Task[];
  repos?: RepoStatus[];
  insights: Record<string, TaskInsights>;
  sessions: SessionRecord[];
  now: Date;
  /** This week's to-do. Absent, the context says nothing about the week. */
  week?: WeekFile;
}

/**
 * The context block: the tasks and git state exactly as `renderAskContext` in core quotes them
 * for `ledge ask`, followed by what the sidecars add, the headline and phase per task and the
 * newest session records. Done tasks are left out, as core's own callers do.
 */
export function renderLedgeContext(input: LedgeContextInput): string {
  const tasks = input.tasks.filter((t) => t.status !== 'done');
  const lines = [renderAskContext({ day: input.day, tasks, repos: input.repos })];

  const withInsight = tasks.filter((t) => input.insights[t.id]);
  lines.push('', '=== INSIGHTS, written by a model from the records above ===');
  if (withInsight.length === 0) lines.push('(none yet)');
  for (const t of withInsight) {
    const i = input.insights[t.id] as TaskInsights;
    const parts = [
      i.headline ? `headline: ${i.headline}` : '',
      i.phase ? `current phase: ${i.phase}` : '',
    ].filter((p) => p !== '');
    if (parts.length > 0) lines.push(`${t.id}: ${parts.join('; ')}`);
  }

  const recent = input.sessions.slice(0, RECENT_SESSIONS);
  lines.push('', '=== RECENT CLAUDE CODE SESSIONS, newest first ===');
  if (recent.length === 0) lines.push('(none recorded)');
  for (const s of recent) {
    const state = isSessionRunning(s, input.now) ? 'running' : s.ended ? 'ended' : 'idle';
    const head = `${s.started} ${state} task=${s.taskId ?? 'none'}: ${s.title ?? 'untitled'}`;
    lines.push(head);
    if (s.summary) lines.push(`  ${s.summary}`);
    const facts = [
      s.filesChanged.length > 0 ? `${s.filesChanged.length} files changed` : '',
      s.commits.length > 0 ? `commits: ${s.commits.map((c) => c.subject).join('; ')}` : '',
      s.todosTicked.length > 0 ? `ticked: ${s.todosTicked.join('; ')}` : '',
    ].filter((p) => p !== '');
    if (facts.length > 0) lines.push(`  ${facts.join('. ')}`);
  }
  if (input.week) {
    lines.push('', `=== THIS WEEK'S TO-DO, ${input.week.week}, numbered as \`ledge week\` prints it ===`);
    const items = numberedLines(input.week);
    if (items.length === 0) lines.push('(nothing yet)');
    lines.push(...items);
  }
  lines.push('=== END ===');
  return lines.join('\n');
}

/** Only the `ledge` part of a command the model ran, for the list under the answer. */
export function ledgeCommandOf(command: string): string | undefined {
  const m = /(?:^|[;&|]\s*)(ledge\s[^\n;&|]*)/.exec(command.trim());
  return m ? m[1]!.trim() : undefined;
}

/**
 * Why a run failed, in words a person can act on. Exit 127 from the launching shell means the
 * program was not found at all; anything else carries whatever Claude Code printed.
 */
export function failureText(code: number | null, stderr: string): string {
  if (code === 127 || /claude: (command )?not found/.test(stderr)) {
    return 'Claude Code is not installed, or not on the PATH Ledge can see. Install it and sign in, then ask again.';
  }
  const detail = stderr.trim().split('\n').filter((l) => l.trim() !== '').slice(-2).join(' ');
  if (/logged in|log ?in|\/login|auth|credential|api key/i.test(detail)) {
    return `Claude Code is not signed in. Run claude once in a terminal to sign in. (${detail})`;
  }
  return detail === ''
    ? `Claude Code stopped without an answer (exit ${code ?? 'unknown'}).`
    : `Claude Code stopped without an answer: ${detail}`;
}
