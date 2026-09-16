// Usage text for every command. The dispatcher and the commands both read from here so the
// help screen and usage errors never drift apart.

export interface HelpEntry {
  usage: string;
  summary: string;
}

/** Usage line and one-line summary per command, in the order they appear in `ledge help`. */
export const COMMANDS: Record<string, HelpEntry> = {
  list: { usage: 'ledge [list] [--json]', summary: 'Print Current, Backlog and Pending' },
  add: {
    usage: 'ledge add "title" [--repo path] [--backlog] [--json]',
    summary: 'Create a task file',
  },
  start: { usage: 'ledge start <id> [--json]', summary: 'Set status current, order 1' },
  park: { usage: 'ledge park <id> "reason" [--json]', summary: 'Set status backlog with a reason' },
  done: { usage: 'ledge done <id> [--json]', summary: 'Set status done, move to archive' },
  delete: {
    usage: 'ledge delete <id> --yes [--json]',
    summary: 'Destroy a task and its file, no undo',
  },
  current: {
    usage: 'ledge current [--repo path] [--json|--context]',
    summary: 'Print the current task whose repo matches',
  },
  link: { usage: 'ledge link <id> <sessionId> [--json]', summary: 'Append a Claude session id' },
  todo: { usage: 'ledge todo <id> "text" [--json]', summary: 'Append an unchecked item' },
  tick: { usage: 'ledge tick <id> <n> [--json]', summary: 'Tick checklist item n (1-based)' },
  untick: { usage: 'ledge untick <id> <n> [--json]', summary: 'Untick checklist item n (1-based)' },
  plan: {
    usage: 'ledge plan <id> "step" "step" ... [--json]',
    summary: 'Replace the ordered plan steps',
  },
  note: { usage: 'ledge note <id> "text" [--json]', summary: "Append to today's notes" },
  when: {
    usage: 'ledge when <id> <YYYY-MM-DD|today|tomorrow|none> [--json]',
    summary: 'Set or clear the planned day',
  },
  today: {
    usage: 'ledge today [--json]',
    summary: 'Tasks planned for today, overdue ones, then current',
  },
  sessions: {
    usage: 'ledge sessions [--json]',
    summary: 'Claude session ids recorded on tasks, newest first',
  },
  memory: {
    usage: 'ledge memory [query] [--json]',
    summary: 'Dated notes across every task, newest first, filtered by query',
  },
  open: { usage: 'ledge open <id>', summary: 'Print the task file path' },
  scan: { usage: 'ledge scan', summary: 'Run the git scan once and print Pending as JSON' },
  init: { usage: 'ledge init', summary: 'Create LEDGE_HOME, a default config and a sample task' },
  help: { usage: 'ledge help [command]', summary: 'Show this help' },
};

/**
 * Renders the full help screen: every command with its usage and summary, the flags, the exit
 * codes and where the store lives. Plain text, aligned with spaces.
 */
export function renderHelp(): string {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((n) => COMMANDS[n].usage.length));
  const lines = [
    'ledge: current tasks, backlog and pending git work from plain Markdown files.',
    '',
    'Usage:',
    ...names.map((n) => `  ${COMMANDS[n].usage.padEnd(width)}  ${COMMANDS[n].summary}`),
    '',
    'Flags:',
    '  --json       Print JSON instead of text on listing and mutating commands',
    '  --context    With current: print the block the SessionStart hook injects (max 40 lines):',
    '               title, planned day, requirement, plan, unchecked items and the latest note',
    '  --repo path  With add or current: the repo the task belongs to',
    '  --backlog    With add: create the task in the backlog instead of current',
    '  -h, --help   Show help; -v, --version prints the version',
    '',
    'Exit codes: 0 ok, 1 usage error, 2 not found, 3 task file parse error.',
    'Store: $LEDGE_HOME, default ~/.ledge.',
  ];
  return lines.join('\n');
}

/**
 * Renders help for one command, or the full help screen when the command is unknown. Used by
 * `ledge help <command>` and appended to usage errors.
 */
export function renderCommandHelp(name: string): string {
  const entry = COMMANDS[name];
  if (!entry) return renderHelp();
  return `Usage: ${entry.usage}\n  ${entry.summary}`;
}
