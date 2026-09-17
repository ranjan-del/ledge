/**
 * The inference layer of Ledge, pure half: the provider contract, the context Ledge assembles
 * out of its own records, and the three prompts built from that context. Nothing here imports
 * `node:` anything or reads a process, because the desktop bundle pulls this in through
 * `@ledge/core/pure`; the one implementation that actually runs a program lives in ./ai-node.ts.
 *
 * The rule the whole file is built around: a prompt may carry only what the person's own task
 * files and their git state already say, and it must tell the model to answer from that and
 * nothing else. Ledge shows observed records and model inference as two different kinds of
 * thing, and that separation starts here, in what the model is allowed to be asked.
 */
import { nextActionFor } from './surfaces.ts';
import type { NextAction, RepoStatus, Task, TaskStatus } from './types.ts';

/**
 * One answer from a provider. The provider name travels with the text so that no caller can
 * print inference without saying where it came from, which is the honesty rule Ledge enforces
 * in code rather than only in the prompt.
 */
export interface AskResult {
  text: string;
  /** The `name` of the provider that produced `text`, e.g. `claude-code`. */
  provider: string;
}

/**
 * The whole of what Ledge asks of an inference backend: a name to label answers with, an honest
 * availability check, and one call that turns a prompt into text. It is deliberately this thin
 * so that Ledge is never married to one provider: anything that can answer a prompt, local model
 * or hosted API, satisfies it without Ledge learning a second shape.
 *
 * `available()` must actually establish that the backend can answer right now, not that it was
 * configured once. Callers treat a false answer as normal, not as an error: every Ledge command
 * that uses a provider still prints its observed facts when there is no provider at all.
 */
export interface Provider {
  readonly name: string;
  available(): Promise<boolean>;
  ask(prompt: string, opts?: { timeoutMs?: number }): Promise<AskResult>;
  /**
   * Optional. One or two sentences saying why `available()` last answered false and what the
   * person can do about it, for a command that has to explain itself. Providers that cannot
   * tell the difference between causes may leave it out, so callers must cope with both an
   * absent method and an undefined answer.
   */
  unavailableReason?(): string | undefined;
}

/**
 * Everything a prompt is allowed to draw on: the calendar day it is being asked on, the tasks
 * to quote in full, and the git state of the repositories those tasks name. It exists as one
 * object rather than a pile of arguments so that the three prompt builders provably share a
 * context, which is what makes "the model saw exactly these facts" a true statement.
 */
export interface AskContext {
  /** The person's local calendar day, `YYYY-MM-DD`. Prompts need it to read `planned` dates. */
  day: string;
  /** Tasks quoted in full. The caller decides the set; archived tasks are normally left out. */
  tasks: Task[];
  /** Git state read just now. Absent when no scan was run, which the context then says. */
  repos?: RepoStatus[];
  /**
   * How many dated notes per task to quote, newest first. Notes are the only place a session's
   * reasoning is written down, so they are quoted whole rather than summarised; the count is
   * the budget. Defaults to DEFAULT_NOTES_PER_TASK.
   */
  notesPerTask?: number;
}

/**
 * Default number of dated notes quoted per task. Three covers the last few days of reasoning on
 * a task that is being worked, which is what a standup or a handoff is about, without carrying
 * a year of history into every prompt. Notes are never truncated inside themselves: a decision
 * written at the bottom of a long note is exactly the part a summary would lose.
 */
export const DEFAULT_NOTES_PER_TASK = 3;

/** One task reduced to the facts a Ledge command prints without asking a model anything. */
export interface ObservedTask {
  id: string;
  title: string;
  status: TaskStatus;
  repo?: string;
  planned?: string;
  /** Ticked checklist items. */
  done: number;
  /** Checklist length. 0 when the task has no checklist. */
  total: number;
  /** The first unticked item, or the first plan step when there is no checklist. */
  nextAction?: NextAction;
  /** Date of the newest dated note, absent when the task has none. */
  latestNote?: string;
  /** How many dated notes the task carries. */
  noteCount: number;
}

/** One repository reduced to the facts a Ledge command prints without asking a model anything. */
export interface ObservedRepo {
  repo: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Number of changed or untracked paths. */
  dirty: number;
}

/**
 * The observed half of every assistant command: the facts Ledge read out of the files and out
 * of git, with nothing added. A command prints this whether or not a model ever answers, which
 * is what keeps inference an addition to Ledge rather than a dependency of it.
 */
export interface Observed {
  day: string;
  tasks: ObservedTask[];
  repos: ObservedRepo[];
}

/**
 * Reduces a context to the facts alone: per task its progress, its own next step and whether it
 * has notes, and per repository its branch and how far it has drifted. Every field is copied or
 * counted, never composed, so a caller printing this is quoting the files. It is the same
 * context the model is given, so the printed facts and the prompt can never disagree.
 */
export function observedFacts(context: AskContext): Observed {
  const tasks = context.tasks.map((task): ObservedTask => {
    const observed: ObservedTask = {
      id: task.id,
      title: task.title,
      status: task.status,
      done: task.checklist.filter((item) => item.done).length,
      total: task.checklist.length,
      noteCount: task.notes.length,
    };
    if (task.repo !== undefined) observed.repo = task.repo;
    if (task.planned !== undefined) observed.planned = task.planned;
    const next = nextActionFor(task);
    if (next) observed.nextAction = next;
    const latest = task.notes[task.notes.length - 1];
    if (latest) observed.latestNote = latest.date;
    return observed;
  });
  const repos = (context.repos ?? []).map((status): ObservedRepo => {
    const observed: ObservedRepo = {
      repo: status.repo,
      branch: status.branch,
      ahead: status.ahead,
      behind: status.behind,
      dirty: status.dirty.length,
    };
    if (status.upstream !== undefined) observed.upstream = status.upstream;
    return observed;
  });
  return { day: context.day, tasks, repos };
}

/**
 * Removes the one thing a model answer can do to a task file that a person would not forgive:
 * start a line with `#`. A saved handoff is appended under a `### YYYY-MM-DD` note subheading,
 * where a line beginning `##` would be read back as a new section and a line beginning `###` as
 * a new dated note, silently cutting the file in two. The hashes are stripped and the words
 * kept, because the words are the answer and the hashes were only decoration.
 *
 * Applied to any model text before it is written anywhere. The prompt also asks for no
 * headings; this is the half of that rule that does not depend on the model obeying it.
 */
export function sanitizeForNote(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#{1,6}\s*/, ''))
    .join('\n')
    .trim();
}

function plannedLabel(planned: string, day: string): string {
  if (planned === day) return `${planned} (today)`;
  if (planned < day) return `${planned} (overdue)`;
  return `${planned} (upcoming)`;
}

function renderTask(task: Task, index: number, count: number, context: AskContext): string[] {
  const lines: string[] = [];
  lines.push(`TASK ${index + 1} of ${count}`);
  lines.push(`id: ${task.id}`);
  lines.push(`title: ${task.title}`);
  lines.push(`status: ${task.status}, position ${task.order} in that list`);
  if (task.parked) lines.push(`parked because: ${task.parked}`);
  lines.push(`planned: ${task.planned ? plannedLabel(task.planned, context.day) : 'no day set'}`);
  lines.push(`repo: ${task.repo ?? 'none recorded'}`);
  const done = task.checklist.filter((item) => item.done).length;
  lines.push(`checklist: ${done} ticked of ${task.checklist.length}`);
  lines.push(`claude code sessions recorded: ${task.sessions.length}`);

  lines.push('', 'requirement, as the person wrote it:');
  lines.push(task.requirement.trim() === '' ? '(nothing recorded)' : task.requirement.trim());

  lines.push('', 'plan, as the person wrote it before starting:');
  if (task.plan.length === 0) lines.push('(no plan recorded)');
  else task.plan.forEach((step, i) => lines.push(`${i + 1}. ${step}`));

  const open = task.checklist.filter((item) => !item.done);
  const closed = task.checklist.filter((item) => item.done);
  lines.push('', 'checklist, still unticked, in file order:');
  if (open.length === 0) lines.push('(nothing unticked)');
  else for (const item of open) lines.push(`- ${item.text}`);
  lines.push('', 'checklist, already ticked, in file order:');
  if (closed.length === 0) lines.push('(nothing ticked)');
  else for (const item of closed) lines.push(`- ${item.text}`);

  const budget = context.notesPerTask ?? DEFAULT_NOTES_PER_TASK;
  const quoted = budget <= 0 ? [] : task.notes.slice(Math.max(task.notes.length - budget, 0));
  lines.push('', `notes, dated, oldest first, ${quoted.length} quoted of ${task.notes.length}:`);
  if (quoted.length === 0) lines.push('(no notes recorded)');
  for (const note of quoted) {
    lines.push(`note dated ${note.date}:`);
    lines.push(note.body.trim() === '' ? '(empty)' : note.body.trim());
  }
  return lines;
}

function renderRepos(context: AskContext): string[] {
  const lines = ['GIT, read from the repositories just now and not from any task file:'];
  if (context.repos === undefined) {
    lines.push('(no scan was run, so nothing is known about the working trees)');
    return lines;
  }
  if (context.repos.length === 0) {
    lines.push('(the scan ran and found no repository to report)');
    return lines;
  }
  for (const status of context.repos) {
    const upstream = status.upstream ? `upstream ${status.upstream}` : 'no upstream';
    const paths = status.dirty.slice(0, 10).map((entry) => entry.path).join(', ');
    const more = status.dirty.length > 10 ? `, and ${status.dirty.length - 10} more` : '';
    const changed =
      status.dirty.length === 0
        ? 'working tree clean'
        : `${status.dirty.length} changed or untracked paths: ${paths}${more}`;
    lines.push(
      `${status.repo}: branch ${status.branch}, ${upstream}, ${status.ahead} ahead, ` +
        `${status.behind} behind, ${changed}`,
    );
  }
  return lines;
}

/**
 * Renders a context as the text block a prompt carries. It is the single place the model's view
 * of the work is built, so that `ask`, `standup` and `handoff` cannot drift into seeing
 * different things, and so that a person who wants to know what the model was told can be shown
 * exactly this. Every value is quoted from the files or from git; nothing is summarised,
 * reworded or scored.
 *
 * Requirements, plans and checklists are quoted whole. Notes are quoted whole too but only the
 * newest few per task, because a note is a day of reasoning and shortening one loses the part
 * at the bottom, which is usually the decision.
 */
export function renderAskContext(context: AskContext): string {
  const lines: string[] = [];
  lines.push('=== BEGIN CONTEXT ===');
  lines.push(`Today is ${context.day}, the person's local calendar day.`);
  const counts = new Map<TaskStatus, number>();
  for (const task of context.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  const summary = [...counts].map(([status, n]) => `${n} ${status}`).join(', ');
  lines.push(
    `Tasks quoted below: ${context.tasks.length}${summary === '' ? '' : ` (${summary})`}. ` +
      'Tasks the person has archived are not included.',
  );
  context.tasks.forEach((task, i) => {
    lines.push('', ...renderTask(task, i, context.tasks.length, context));
  });
  lines.push('', ...renderRepos(context));
  lines.push('=== END CONTEXT ===');
  return lines.join('\n');
}

const RULES = [
  'You are reading one person\'s own working records, kept by Ledge, a task desk that keeps',
  'each task as a Markdown file they write themselves. You are not writing code, you have no',
  'tools, and you cannot open anything. Everything you know is between BEGIN CONTEXT and END',
  'CONTEXT below.',
  '',
  'Rules, most important first:',
  '',
  '1. Use only the context. Do not use anything you may know about these projects, libraries,',
  '   companies or files from anywhere else, and never guess what is inside a file, a commit, a',
  '   branch or a repository that the context does not quote.',
  '2. Where the records are silent, say so. Write "the records do not say" and name the one',
  '   thing that would have to be written down for the answer to exist. Never close a gap with',
  '   a plausible answer; a wrong confident line costs this person more than a missing one.',
  '3. Keep observation and inference apart. A sentence that restates the records is an',
  '   observation: name the task id and where you read it, such as the requirement, a plan step,',
  '   a checklist item, the note of a given date, or git. A sentence that goes beyond the',
  '   records is inference: begin it with "Inferred:" and say in the same sentence what it',
  '   rests on.',
  '4. Do not promote a record into a status. Do not say that work is finished, running, blocked,',
  '   merged, deployed, reviewed, passing or failing unless the context says so in those words.',
  '   An unticked checklist item means it is unticked and nothing more. A ticked one means the',
  '   person ticked it, not that you verified it.',
  '5. Write for the person who wrote these records. They know the projects, so skip the recap,',
  '   skip the encouragement and use their own words and their own names for things. No',
  '   preamble, no sign off, no offer of further help, no restating of these rules.',
  '6. Plain punctuation, because this text is filed next to their own writing and may be',
  '   appended to it. Never use an em dash or an en dash. Use a comma, a colon or a full stop.',
].join('\n');

function assemble(job: string, context: AskContext, closing: string): string {
  return [RULES, '', renderAskContext(context), '', job, '', closing, ''].join('\n');
}

/**
 * Builds the prompt for a free question about the person's own work: the honesty rules, the
 * whole context, then the question. The question goes after the context so that it is the last
 * thing read, and it is quoted verbatim because rewording a person's question is the fastest
 * way to answer a different one.
 *
 * The prompt tells the model to answer only from the context, to say plainly when the context
 * does not contain the answer, and to mark anything it infers. A blank question is passed
 * through as such rather than invented for, so the model reports that nothing was asked instead
 * of choosing a question of its own.
 */
export function buildAskPrompt(question: string, context: AskContext): string {
  const asked = question.trim();
  const job = [
    'THE QUESTION, in the person\'s own words:',
    '',
    asked === '' ? '(no question was given)' : asked,
  ].join('\n');
  const closing = [
    'Answer that question now, from the context alone, in at most 200 words. Lead with the',
    'answer. If the records do not cover what was asked, say that in the first line, name what',
    'is missing, and stop there.',
  ].join('\n');
  return assemble(job, context, closing);
}

/**
 * Builds the prompt for the morning summary: where each current task stands and what is worth
 * doing next on it. The shape is fixed by the prompt, two lines per task and one closing line,
 * because a standup that varies in shape from day to day cannot be read at a glance.
 *
 * The next action must be quoted from an unticked checklist item, a plan step or a sentence in
 * a note that names one, and the model has to say which it took and why when it does not take
 * the first unticked item. That constraint is the whole point of the command: Ledge already
 * knows the first unticked item, and a reasoned, cited choice between the open items is the
 * thing a person cannot get by reading the file.
 */
export function buildStandupPrompt(context: AskContext): string {
  const job = [
    'THE JOB',
    '',
    'Write this person\'s standup for today. They are picking up work they put down themselves,',
    'so tell them where each task stands and what is worth doing next on it. Do not describe',
    'what the tasks are: they wrote them.',
    '',
    'Cover every task whose status is current, in the order the context lists them. A task whose',
    'status is backlog is parked; name one only if a current task depends on it.',
  ].join('\n');
  const closing = [
    'Write exactly this and nothing else.',
    '',
    'For each current task, two lines:',
    '<task id>: where it stands, in one sentence, built from what is ticked, what the newest',
    'note says and what git shows. Name the date of the note you used.',
    '  Next: one action, quoted from an unticked checklist item, from a plan step, or from a',
    '  sentence in a note that names a next step. Say which of those three you took it from. If',
    '  it is not the first unticked item, say why in the same line.',
    '',
    'Then a blank line and one last line:',
    'Start here: <task id>, <the one action>, because <one clause, grounded in the context>.',
  ].join('\n');
  return assemble(job, context, closing);
}

/**
 * Builds the prompt for a session handoff on one task: what happened, what is done, what
 * remains, and what the next session needs. The next session may be days away and will know
 * only what the file says, so the prompt asks for paths, branches, commands and decisions
 * already taken to be carried over in the person's own words rather than summarised away.
 *
 * The output is written to be appended under a dated note heading, so the prompt forbids
 * Markdown headings. `sanitizeForNote` enforces the same rule on the way to disk, because a
 * model that forgets would otherwise cut the task file into two sections.
 *
 * When `task` is not among `context.tasks` it is prepended to a copy of the context, so the
 * handoff can never be written about a task the model was not shown.
 */
export function buildHandoffPrompt(task: Task, context: AskContext): string {
  const known = context.tasks.some((candidate) => candidate.id === task.id);
  const full: AskContext = known ? context : { ...context, tasks: [task, ...context.tasks] };
  const job = [
    'THE JOB',
    '',
    `Write the handoff note for the task "${task.title}" (id: ${task.id}). Any other task in`,
    'the context is there for cross reference only; write about that one task.',
    '',
    'It is read by the next session on this task, which may be days from now and will know',
    'nothing at all except this note and the task file.',
  ].join('\n');
  const closing = [
    'Write four labelled blocks, in this order, and nothing else. No Markdown headings: no line',
    'may begin with #. Each block is its label alone on a line, then "- " bullets under it.',
    '',
    'What happened',
    '- what the records show was done on this task, newest first, each bullet naming where you',
    '  read it. At most five bullets.',
    '',
    'What is done',
    '- the parts the records treat as finished, in the person\'s own words. Say a date only when',
    '  a note gives one.',
    '',
    'What remains',
    '- every unticked checklist item that still matters, and anything a note names as',
    '  outstanding. Keep their wording.',
    '',
    'What the next session needs',
    '- the first action to take, quoted from the records; the files, paths, branches, line',
    '  numbers and commands the records name for it; and anything the records say is already',
    '  decided and must not be revisited. If the records name a trap, a casing problem or a',
    '  dead end, it belongs here.',
  ].join('\n');
  return assemble(job, full, closing);
}
