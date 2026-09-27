/**
 * Ask Ledge, the pure half: the prompt, the context it carries, and how the stream Claude Code
 * prints is read back into an answer and a list of the `ledge` commands it ran. Running the
 * program lives in ./ask-runner.ts, so everything here is tested without a process.
 *
 * Each question is one `claude -p` run with Sonnet. Claude Code keeps no conversation between
 * two runs, so the few turns before this one are quoted in the prompt; that is the whole of the
 * "short in-memory conversation", and it goes when the panel does.
 *
 * The model may change the desk, but only through the `ledge` command line tool, which is the
 * one tool the run allows. The panel never applies an answer itself: a task that was edited is
 * re-read from its file by the watcher like any other change, so what the person sees is what
 * is on disk.
 */
import { renderAskContext, type RepoStatus, type Task } from '@ledge/core/pure';
import {
  isSessionRunning,
  type SessionRecord,
  type TaskInsights,
} from '@ledge/core/pure';
import { numberedLines } from './week-view.ts';
import type { WeekFile } from '@ledge/core/pure';

/** How many earlier turns are quoted back to the model. */
export const HISTORY_TURNS = 4;
/** How many recent session records the context carries. */
export const RECENT_SESSIONS = 8;

export interface AskTurn {
  question: string;
  answer: string;
}

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

const RULES = [
  "You are Ledge, a task assistant inside the person's desktop panel. You answer questions about",
  'their own work, and you can change their tasks, but only by running the `ledge` command line',
  'tool through Bash. You cannot read or write code, run git, or use any other command.',
  '',
  'Commands you may run (ids are the task ids in the context):',
  '  ledge add "title" [--repo path] [--backlog]   ledge start <id>   ledge park <id> "reason"',
  '  ledge done <id>   ledge plan <id> "step" "step" ...   ledge todo <id> "text"',
  '  ledge tick <id> <n>   ledge untick <id> <n>   ledge note <id> "text"',
  '  ledge when <id> <YYYY-MM-DD|today|tomorrow|none>',
  '  ledge week --json   ledge week add "text" --day <day> [--task <id>]',
  '  ledge week tick <n>   ledge week untick <n>   ledge week rm <n>   ledge week move <n> --day <day>',
  '  (<day> is YYYY-MM-DD, today, tomorrow, mon to sun, or anytime)',
  'Never delete a task. Checklist numbers are 1-based in file order, ticked items included.',
  '',
  'Rules:',
  '1. Answer from the context below. Where it is silent, say so plainly; never guess.',
  '2. Change a task only when the person asks for a change. Then run the command, and say in',
  '   one line what changed.',
  '3. Lead with the answer. At most 150 words. Plain sentences or short "- " lists. No headings,',
  '   no bold, no tables, no preamble, no offer of more help.',
  '4. Never use an em dash or an en dash. Use a comma, a colon or a full stop.',
  '5. "Remind me", "this week" and "add to my week" requests go on the weekly to-do, not on a',
  '   task: run `ledge week add "<text>" --day <day>`, with `--task <id>` when it is about a task.',
  '   To tick, untick or remove one, run `ledge week --json` first and use the number it gives.',
].join('\n');

/** The whole prompt for one question: rules, context, the last few turns, then the question. */
export function buildLedgePrompt(question: string, context: string, history: AskTurn[] = []): string {
  const parts = [RULES, '', context];
  const quoted = history.slice(-HISTORY_TURNS).filter((t) => t.answer.trim() !== '');
  if (quoted.length > 0) {
    parts.push('', 'EARLIER IN THIS CONVERSATION, oldest first:');
    for (const t of quoted) parts.push(`Person: ${t.question}`, `Ledge: ${t.answer}`);
  }
  parts.push('', 'THE QUESTION:', question.trim(), '');
  return parts.join('\n');
}

/* ------------------------------------------------------------------ the stream */

export type AskEvent =
  | { type: 'text'; delta: string }
  /** A new assistant message began, so streamed text should start a new paragraph. */
  | { type: 'turn' }
  | { type: 'command'; id: string; command: string }
  | { type: 'command-result'; id: string; ok: boolean }
  | { type: 'result'; text: string; isError: boolean };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads one line of `--output-format stream-json --verbose --include-partial-messages` into
 * the events the panel cares about. Anything else, including a line that is not JSON, is no
 * event at all: the stream carries far more than an answer needs, and its extra fields change
 * between Claude Code versions.
 */
export function parseStreamLine(line: string): AskEvent[] {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed[0] !== '{') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObject(raw)) return [];
  if (raw.type === 'stream_event' && isObject(raw.event)) {
    const ev = raw.event;
    if (ev.type === 'message_start') return [{ type: 'turn' }];
    if (ev.type === 'content_block_delta' && isObject(ev.delta) && ev.delta.type === 'text_delta') {
      return typeof ev.delta.text === 'string' ? [{ type: 'text', delta: ev.delta.text }] : [];
    }
    return [];
  }
  if (raw.type === 'assistant' && isObject(raw.message) && Array.isArray(raw.message.content)) {
    const out: AskEvent[] = [];
    for (const block of raw.message.content) {
      if (!isObject(block) || block.type !== 'tool_use' || block.name !== 'Bash') continue;
      const input = isObject(block.input) ? block.input : {};
      if (typeof input.command === 'string' && typeof block.id === 'string') {
        out.push({ type: 'command', id: block.id, command: input.command });
      }
    }
    return out;
  }
  if (raw.type === 'user' && isObject(raw.message) && Array.isArray(raw.message.content)) {
    const out: AskEvent[] = [];
    for (const block of raw.message.content) {
      if (!isObject(block) || block.type !== 'tool_result') continue;
      if (typeof block.tool_use_id !== 'string') continue;
      out.push({ type: 'command-result', id: block.tool_use_id, ok: block.is_error !== true });
    }
    return out;
  }
  if (raw.type === 'result') {
    const text = typeof raw.result === 'string' ? raw.result : '';
    return [{ type: 'result', text, isError: raw.is_error === true || raw.subtype !== 'success' }];
  }
  return [];
}

/** Only the `ledge` part of a command the model ran, for the list under the answer. */
export function ledgeCommandOf(command: string): string | undefined {
  const m = /(?:^|[;&|]\s*)(ledge\s[^\n;&|]*)/.exec(command.trim());
  return m ? m[1]!.trim() : undefined;
}

/**
 * The answer as the panel shows it: Markdown decoration a narrow panel cannot use taken off,
 * the words kept. Headings lose their hashes, bold and inline code lose their marks, and runs
 * of blank lines close up.
 */
export function cleanAnswer(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#{1,6}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
