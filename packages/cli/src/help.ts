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
  began: {
    usage: 'ledge began [id] [--repo path] [--session id] [--json]',
    summary: 'Record that a session was launched for a backlog task',
  },
  settle: {
    usage: 'ledge settle [--repo path] [--json]',
    summary: 'Promote that task only if the session shows evidence of work',
  },
  todo: { usage: 'ledge todo <id> "text" [--json]', summary: 'Append an unchecked item' },
  tick: { usage: 'ledge tick <id> <n> [--json]', summary: 'Tick checklist item n (1-based)' },
  untick: { usage: 'ledge untick <id> <n> [--json]', summary: 'Untick checklist item n (1-based)' },
  plan: {
    usage: 'ledge plan <id> "step" "step" ... [--json]',
    summary: 'Replace the ordered plan steps',
  },
  note: { usage: 'ledge note <id> "text" [--json]', summary: "Append to today's notes" },
  ref: {
    usage: 'ledge ref <id> "text" [--json]',
    summary: 'Add pasted raw material under References',
  },
  when: {
    usage: 'ledge when <id> <YYYY-MM-DD|today|tomorrow|none> [--json]',
    summary: 'Set or clear the planned day',
  },
  today: {
    usage: 'ledge today [--json]',
    summary: "Tasks planned for today, today's week items, overdue ones, then current",
  },
  week: {
    usage: 'ledge week [add "text"|tick|untick|rm|move <n>] [--day d] [--week W|--next] [--json]',
    summary: 'The to-do list for the week by day; add, tick, untick, rm and move by number',
  },
  active: {
    usage: 'ledge active [--json]',
    summary: 'Rank current tasks by observed activity, with the evidence',
  },
  sessions: {
    usage: 'ledge sessions [--task id] [--json]',
    summary: 'Claude sessions, newest first; --json prints the session records',
  },
  capture: {
    usage: 'ledge capture --session id --transcript path [--cwd dir] [--final] [--force] [--json]',
    summary: 'Read a session transcript and keep its task current (the hooks run this)',
  },
  track: {
    usage: 'ledge track --session id [--transcript path] [--cwd dir] [--ended] [--json]',
    summary: 'Write the session record skeleton, or mark it ended (the hooks run this)',
  },
  summarise: {
    usage: 'ledge summarise [<id>] [--all] [--json]',
    summary: 'Add AI titles next to notes and plan steps that have none; files untouched',
  },
  brief: {
    usage: 'ledge brief <id> [--json]',
    summary: 'Print the briefing a new Claude session on this task starts from',
  },
  memory: {
    usage: 'ledge memory [query] [--json]',
    summary: 'Dated notes across every task, newest first, filtered by query',
  },
  ask: {
    usage: 'ledge ask "question" [--json]',
    summary: 'Answer a question about your tasks, notes and git state',
  },
  standup: {
    usage: 'ledge standup [--json]',
    summary: 'Where each current task stands and what to do next',
  },
  handoff: {
    usage: 'ledge handoff <id> [--save] [--json]',
    summary: "Write a session handoff; --save appends it to the task's notes",
  },
  open: { usage: 'ledge open <id>', summary: 'Print the task file path' },
  scan: { usage: 'ledge scan', summary: 'Run the git scan once and print Pending as JSON' },
  app: { usage: 'ledge app', summary: 'Start the desktop panel' },
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
    '               title, planned day, requirement, plan, unchecked items, the latest note and',
    '               a line saying how much is in References, never References itself, and',
    "               today's unticked week items (at most 5 lines)",
    '  --repo path  With add, current, began or settle: the repo the task belongs to',
    '  --session id With began: the Claude Code session id, so a record knows its session',
    '  --backlog    With add: create the task in the backlog instead of current',
    "  --save       With handoff: append the handoff to the task's notes under today",
    '  --session id With capture and track: the Claude Code session id',
    '  --transcript With capture and track: the session transcript, a .jsonl file',
    '  --cwd dir    With capture and track: the folder the session runs in (default: here)',
    '  --final      With capture: skip the debounce, as compaction and session end do',
    '  --force      With capture: run even when there is nothing new to read',
    '  --ended      With track: mark the session ended',
    '  --task id    With sessions: only that task\'s sessions; with week add: link the item',
    '  --day d      With week add and move: YYYY-MM-DD, today, tomorrow, mon to sun, anytime',
    '  --week W     With week: act on week W, e.g. 2026-W40, instead of the current one',
    '  --next       With week: act on next week',
    '  --all        With summarise: every task in the tasks folder',
    '  -h, --help   Show help; -v, --version prints the version',
    '',
    'ask, standup and handoff send your task files and git state to a model and print what it',
    'says under a separate Inference heading, never mixed into the observed rows. They use the',
    'Claude Code command line tool, so they need `claude` on PATH and signed in; without it they',
    'print the observed rows, say why there is no inference, and still exit 0.',
    '',
    'active answers "what am I actually on" from three readings rather than from the order you',
    'typed: the Claude Code session transcript folder for a task repo, the newest tracked file in',
    "that repo, and the task file's own time, which is all a task with no repo has. It prints",
    'the evidence next to every row, ignores anything older than 12 hours so a quiet task keeps',
    'your order, and changes no status: it orders what is shown and nothing more.',
    '',
    'ref puts raw material on a task under ## References: a message somebody sent you, a link,',
    'an error, a snippet. It appends rather than replaces, and the file gives back byte for byte',
    'what you pasted: a heading, a fence or a line of dashes in it stays text. The SessionStart',
    'context block says only that references exist and how many lines they run to, so a long',
    'paste never crowds out the requirement and the open items in the forty lines it has.',
    '',
    'began and settle are the two halves of one loop. A launcher runs `ledge began <id>` before',
    'it opens Claude on a backlog task; `ledge settle` at the end of the session compares the task',
    'and its repo with how they stood before and promotes the task only when something changed:',
    'an item ticked or added, a note, a new plan, a commit, or a working tree that moved. A',
    'session that did nothing leaves the task in the backlog, which is the point.',
    '',
    'capture is what keeps a task current without being asked. The plugin starts it in the',
    'background after each turn, before compaction and at session end. It reads the transcript,',
    'asks Haiku which task the session was for (creating one marked origin: auto when none',
    'fits), updates the plan, ticks and adds checklist items, appends a note, and writes',
    'sessions/<id>.json and insights/<task>.json next to the task files. It skips when fewer',
    'than 40 lines and under 10 minutes have passed since the last capture, writes nothing when',
    'the model cannot answer, and logs one line per run to capture.log.',
    '',
    'week keeps a personal list of things to do this week, one file per ISO week in',
    'weeks/<YYYY>-W<ww>.md. Items sit under a day or under Anytime, may link to a task with',
    '--task, and are numbered Anytime first, then Monday to Sunday, in file order; tick, untick,',
    'rm and move take that number. Each week starts empty and unfinished items stay in their own',
    "week. today and current --context show today's unticked items. Only a person or a session",
    'asked to adds items: the capture never does.',
    '',
    'Exit codes: 0 ok, 1 usage error, 2 not found, 3 task file parse error.',
    'Store: $LEDGE_HOME, default ~/.ledge.'
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
