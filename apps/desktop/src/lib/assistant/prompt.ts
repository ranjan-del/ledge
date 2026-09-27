/**
 * The words the assistant is given: the appended system prompt (rules), the short preamble in
 * front of every user message (today's date and the Ledge context, refreshed per turn), the
 * compact transcript replayed when a chat has no Claude Code session to resume, and the one
 * line summaries of tool calls the UI lists under an answer. Pure.
 */
import { ledgeCommandOf } from '../ask.ts';
import type { ChatMessage } from './types.ts';

/** How many earlier messages a replay carries, and how much of each. */
export const REPLAY_MESSAGES = 12;
export const REPLAY_CHARS = 600;
/** The longest tool summary. */
export const SUMMARY_MAX = 100;

const LEDGE_COMMANDS = [
  '  ledge add "title" [--repo path] [--backlog]   ledge start <id>   ledge park <id> "reason"',
  '  ledge done <id>   ledge plan <id> "step" "step" ...   ledge todo <id> "text"',
  '  ledge tick <id> <n>   ledge untick <id> <n>   ledge note <id> "text"',
  '  ledge when <id> <YYYY-MM-DD|today|tomorrow|none>   ledge list --json',
  '  ledge week --json   ledge week add "text" --day <day> [--task <id>]',
  '  ledge week tick <n>   ledge week untick <n>   ledge week rm <n>   ledge week move <n> --day <day>',
  '  (<day> is YYYY-MM-DD, today, tomorrow, mon to sun, or anytime)',
];

/** The rules, appended to Claude Code's own system prompt for the life of the process. */
export function systemPrompt(today: string): string {
  return [
    "You are the assistant in the Assistant tab of Ledge, the person's desktop task app. They talk to",
    'you like a personal assistant: quick questions, questions about their own work, and requests to',
    `do things. Today is ${today}.`,
    '',
    'Rules:',
    '1. Answer general questions directly and briefly from your own knowledge, with no tools.',
    '2. For questions about their work, use the <ledge-context> block at the top of each message:',
    '   tasks, insights, recent Claude Code sessions, git state and this week\'s to-dos. It is',
    '   refreshed every turn, so trust the newest one. Where it is silent, look it up, or say so;',
    '   never guess.',
    '3. Use the `ledge` command line tool (through Bash) for any change to tasks, to-dos, notes or',
    '   the backlog. "Remind me", "this week" and "add to my week" go on the weekly to-do. Before',
    '   ticking, unticking or removing a to-do, run `ledge week --json` for its number.',
    ...LEDGE_COMMANDS,
    '4. You have every tool the person has in Claude Code, including their command line tools and',
    '   MCP servers. Deletes, access or permission grants, pushes, merges, deploys, and messages or',
    '   email to other people show them an approval card first. If one is refused, do not look',
    '   for another way to do it; say it was not done.',
    '5. After doing something, say what you did in one line.',
    '6. Lead with the answer. Keep it short: plain sentences or short lists, light Markdown only',
    '   (bold, lists, code, links), no headings, no preamble, no offer of more help.',
    '7. Never use an em dash or an en dash. Use a comma, a colon or a full stop.',
  ].join('\n');
}

/** A date line such as `Saturday 27 September 2026, 17:58`. */
export function dateLine(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day.replace(/,/g, '')}, ${time}`;
}

/** What goes in front of the person's words each turn. */
export function turnText(text: string, options: { now: Date; context?: string; replay?: string }): string {
  const parts: string[] = [];
  if (options.replay) parts.push(options.replay, '');
  parts.push(`<ledge-context now="${dateLine(options.now)}">`);
  parts.push(options.context && options.context.trim() !== '' ? options.context.trim() : '(Ledge context unavailable this turn.)');
  parts.push('</ledge-context>', '', text.trim());
  return parts.join('\n');
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * The earlier conversation, for a chat whose Claude Code session is gone (or never existed):
 * the last few messages, each cut short, oldest first.
 */
export function replayTranscript(messages: readonly ChatMessage[]): string | undefined {
  const earlier = messages.filter((m) => m.text.trim() !== '').slice(-REPLAY_MESSAGES);
  if (earlier.length === 0) return undefined;
  const lines = ['<earlier-conversation note="Restored from Ledge chat history. Continue from here.">'];
  for (const m of earlier) lines.push(`${m.role === 'user' ? 'Person' : 'Assistant'}: ${clip(m.text, REPLAY_CHARS)}`);
  lines.push('</earlier-conversation>');
  return lines.join('\n');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tildePath(p: string, home?: string): string {
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  return p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~');
}

/** One line for the "Did 3 things" list, e.g. `ledge week add "Call vendor" --day thu`. */
export function toolSummary(name: string, input: unknown, home?: string): string {
  const a = isObject(input) ? input : {};
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
  let out: string;
  if (name === 'Bash' || name === 'PowerShell' || name === 'Monitor') {
    const command = s('command') ?? '';
    out = ledgeCommandOf(command) ?? command.split('\n')[0]!.trim();
  } else if (name === 'Read' || name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') {
    out = `${name} ${tildePath(s('file_path') ?? s('notebook_path') ?? s('path') ?? '', home)}`.trim();
  } else if (name === 'Grep') {
    out = `Search for "${s('pattern') ?? ''}"${s('path') ? ` in ${tildePath(s('path')!, home)}` : ''}`;
  } else if (name === 'Glob') {
    out = `Find ${s('pattern') ?? 'files'}`;
  } else if (name === 'WebSearch') {
    out = `Web search "${s('query') ?? ''}"`;
  } else if (name === 'WebFetch') {
    out = `Fetch ${s('url') ?? ''}`.trim();
  } else if (name === 'Task' || name === 'Agent') {
    out = s('description') ?? 'Run a subagent';
  } else if (name.startsWith('mcp__')) {
    const [, server = '', ...rest] = name.split('__');
    const tool = rest.join('__').replace(/_/g, ' ');
    const label = server.replace(/^claude_ai_/, '').replace(/[_-]/g, ' ');
    const detail = Object.values(a).find((v): v is string => typeof v === 'string');
    out = `${label}: ${tool}${detail ? ` (${detail})` : ''}`;
  } else {
    const detail = Object.values(a).find((v): v is string => typeof v === 'string');
    out = detail ? `${name} ${detail}` : name;
  }
  return clip(out, SUMMARY_MAX);
}
