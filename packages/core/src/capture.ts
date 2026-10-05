/**
 * The capture, pure half: when a capture is due, what the model is asked, what shape its answer
 * must have, and how a line the model wrote is matched to a checklist item the person wrote.
 * Everything that reads a file, runs git or writes a record is in ./capture-node.ts; everything
 * here is a function of its arguments, which is what lets the rules be tested without a model.
 *
 * The capture is the background half of keeping a task current. The standing rules in the
 * plugin ask the session itself to plan, tick and note as it works; the capture reads the
 * transcript afterwards and fills in what the session did not write down. The prompt below is
 * built around the one failure that would make it worse than nothing: inventing work. So the
 * model is told to attribute rather than create, to tick only what the digest shows was done,
 * and to leave a field out rather than guess at it, and the answer is checked field by field
 * before any of it is allowed near a task file.
 */
import type { Task } from './types.ts';

/** New transcript lines below which a capture is skipped, unless enough time has also passed. */
export const CAPTURE_DEBOUNCE_LINES = 40;

/** Time since the last capture below which a capture is skipped, unless enough lines arrived. */
export const CAPTURE_DEBOUNCE_MS = 10 * 60 * 1000;

/** Longest session title the record keeps, in characters. */
export const SESSION_TITLE_MAX = 60;

/** Longest plan step the capture writes, in characters. Detail belongs in the note. */
export const PLAN_STEP_MAX = 90;

/** What `captureDue` needs to know about the previous capture of this session. */
export interface CaptureHistory {
  capturedAt?: string;
  capturedLines?: number;
}

/** Whether a capture should run now, and a few words saying why, for the capture log. */
export interface CaptureDecision {
  due: boolean;
  reason: string;
}

/**
 * The debounce. The Stop hook fires after every assistant turn, and a model call per turn would
 * cost more than the record is worth, so a capture runs only when there is enough new material:
 * at least CAPTURE_DEBOUNCE_LINES new transcript lines, or at least CAPTURE_DEBOUNCE_MS since
 * the last capture. A session never captured before is always due, so that it gets a title on
 * its first stop. `force` always runs. `final`, sent at compaction and at session end, skips the
 * debounce but not the one case where there is truly nothing to read: no new line at all.
 */
export function captureDue(
  history: CaptureHistory | undefined,
  lineCount: number,
  now: Date,
  flags: { final?: boolean; force?: boolean } = {},
): CaptureDecision {
  if (flags.force) return { due: true, reason: 'forced' };
  const capturedAt = history?.capturedAt ? Date.parse(history.capturedAt) : NaN;
  if (!Number.isFinite(capturedAt)) return { due: true, reason: 'first capture' };
  const newLines = lineCount - (history?.capturedLines ?? 0);
  if (newLines <= 0) return { due: false, reason: 'no new transcript lines' };
  if (flags.final) return { due: true, reason: `final, ${newLines} new lines` };
  const age = now.getTime() - capturedAt;
  if (newLines >= CAPTURE_DEBOUNCE_LINES) return { due: true, reason: `${newLines} new lines` };
  if (age >= CAPTURE_DEBOUNCE_MS) {
    return { due: true, reason: `${Math.floor(age / 60_000)} min since the last capture` };
  }
  return {
    due: false,
    reason: `debounced, ${newLines} new lines and ${Math.floor(age / 60_000)} min since the last capture`,
  };
}

/** The answer a capture asks the model for, once it has been checked. */
export interface CaptureResult {
  /** An existing candidate task, or null when none fits. */
  taskId: string | null;
  /** Present only when taskId is null and the work is a clearly different goal. */
  newTask?: { title: string; requirement: string };
  /** The whole plan, when the session made or changed one. */
  plan?: string[];
  checklistAdd: string[];
  checklistTick: string[];
  note?: { title: string; summary: string; body: string };
  session: { title: string; summary: string };
  headline?: string;
  phase?: string;
}

/** Everything the capture prompt is built from. */
export interface CapturePromptInput {
  /** The rendered digest, from renderDigest. */
  digest: string;
  /** Tasks the session may be attributed to. */
  candidates: Task[];
  /** The task this session is already linked to, if any. */
  linkedTaskId?: string;
  /**
   * Every other open task, from any folder, shown in one line each. Work in `~/code` on a
   * project whose task lives in `~/AI/project` is still that project's work, and a model that
   * is never shown the task cannot know it exists.
   */
  otherTasks?: Task[];
  /** The folder the session runs in. */
  cwd: string;
  /** The person's calendar day, `YYYY-MM-DD`, which a new note will be filed under. */
  day: string;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Turns an answer that asks for a new task into one that adds to an existing task instead. This
 * is the rule that keeps one piece of work in one task: a session already linked to a task, or
 * a new goal whose title is close to a task that is already open, never makes a second task.
 * What the model would have put in the new task lands in the existing one's checklist, each
 * line marked with the new goal's title, the same `[title] item` shape `ledge merge` writes. The
 * plan is dropped, because it described the sub-goal and must not replace the task's own plan.
 */
export function foldIntoTask(result: CaptureResult, taskId: string): CaptureResult {
  if (result.taskId !== null || !result.newTask) return result;
  const label = result.newTask.title;
  const steps = result.plan ?? [];
  const items = [...steps, ...result.checklistAdd];
  const checklistAdd = items.length === 0 ? [label] : items.map((text) => `[${label}] ${text}`);
  const folded: CaptureResult = { ...result, taskId, checklistAdd };
  delete folded.newTask;
  delete folded.plan;
  delete folded.phase;
  return folded;
}

const TITLE_STOPWORDS = new Set(['a', 'an', 'and', 'the', 'to', 'of', 'for', 'in', 'on', 'with', 'by']);

/**
 * The index of the title that names the same work as `title`, or -1. Looser than matchItem,
 * because task titles are short and the model rewords them every time ("student portal UI
 * redesign and missing features" against "student portal: redesign, features, dynamic
 * dashboard"): small words are ignored and half the remaining words in common is enough.
 */
export function similarTitle(titles: readonly string[], title: string): number {
  const key = (text: string) => new Set(words(text).filter((word) => !TITLE_STOPWORDS.has(word)));
  const target = key(title);
  if (target.size === 0) return -1;
  let best = -1;
  let bestScore = 0;
  titles.forEach((candidate, index) => {
    const other = key(candidate);
    if (other.size === 0) return;
    const shared = [...other].filter((word) => target.has(word)).length;
    const score = shared / new Set([...other, ...target]).size;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return bestScore >= 0.5 ? best : -1;
}

function renderCandidate(task: Task, input: CapturePromptInput): string[] {
  const lines = [`TASK id: ${task.id}${task.id === input.linkedTaskId ? ' (this session is already linked to it)' : ''}`];
  lines.push(`title: ${task.title}`);
  lines.push(`status: ${task.status}`);
  const first = task.requirement.split('\n').find((l) => l.trim() !== '');
  lines.push(`requirement, first line: ${first ? clip(first, 240) : '(none)'}`);
  lines.push('plan:');
  if (task.plan.length === 0) lines.push('(no plan)');
  task.plan.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push('checklist:');
  if (task.checklist.length === 0) lines.push('(empty)');
  for (const item of task.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  const today = task.notes.find((note) => note.date === input.day);
  if (today) lines.push(`today's note so far: ${clip(today.body, 1200)}`);
  return lines;
}

/**
 * Builds the capture prompt: the rules, the candidate tasks, the digest, then the exact JSON
 * shape wanted. The rules say what the contract says: attribute to an existing task when the
 * work is the same goal, create one only for a clearly different goal, keep plan steps short,
 * and never invent work that is not in the digest.
 */
export function buildCapturePrompt(input: CapturePromptInput): string {
  const tasks = input.candidates.flatMap((task, i) => [
    ...(i === 0 ? [] : ['']),
    ...renderCandidate(task, input),
  ]);
  const others = (input.otherTasks ?? []).map((task) => {
    const first = task.requirement.split('\n').find((l) => l.trim() !== '');
    return `- ${task.id} | ${clip(task.title, 90)} | ${task.repo ?? '-'} | ${first ? clip(first, 140) : '-'}`;
  });
  const linked = input.linkedTaskId
    ? [
        `   This session is already linked to ${input.linkedTaskId}, so never fill newTask: a`,
        '   new sub-goal, step or follow-up in this session is that task\'s checklistAdd.',
      ]
    : [];
  return [
    'You keep a person\'s task records current from what happened in one Claude Code session.',
    'You have no tools. Everything you know is the candidate tasks and the session digest below.',
    'Answer with one JSON object and nothing else: no prose, no Markdown fence.',
    '',
    'Rules, most important first:',
    '1. Never invent work. Only report what the digest shows was asked, said, run or edited.',
    '2. Attribute the session to an existing task when the work is the same goal, continues it,',
    '   or is part of it, even if the wording differs or the session runs in another folder.',
    '   Check the CANDIDATE TASKS first, then every line of OTHER OPEN TASKS. Set taskId to its id.',
    '3. Set taskId to null and fill newTask only when the work is a clearly different goal from',
    '   every task in both lists. If the session was only chat or setup with no real goal, set taskId to',
    '   null and leave newTask out. A step, sub-goal, batch or follow-up of a candidate\'s goal',
    '   is never a different goal: it goes in that candidate\'s checklistAdd.',
    ...linked,
    '4. plan: include it only when the session made or changed a plan, and then give the whole',
    `   plan in order. Each step at most ${PLAN_STEP_MAX} characters; detail goes in the note.`,
    '5. checklistTick: exact texts of unticked checklist items of that task that the digest shows',
    '   were finished. checklistAdd: short new items the digest shows are still to do. Do not',
    '   add an item that is already on the checklist.',
    '6. note: only for what is NEW SINCE THE LAST CAPTURE, and only when there is something worth',
    '   remembering: a decision and what it rules out, a dead end and why, what is left and where.',
    '   body is plain prose, at most 120 words, no Markdown headings. title (at most 60',
    '   characters) and summary (at most 2 sentences) describe today\'s whole note after your',
    '   body is appended to it.',
    `7. session.title: at most ${SESSION_TITLE_MAX} characters, an imperative or noun phrase, no`,
    '   trailing period. session.summary: at most 2 sentences, plain words, no file lists. Both',
    '   describe the whole session.',
    '8. headline: one line saying where the task stands now. phase: the text of the plan step in',
    '   progress, copied from the plan, or leave it out.',
    '9. Plain punctuation. Never use an em dash or an en dash.',
    '',
    `The session runs in: ${input.cwd}`,
    `Today is ${input.day}.`,
    '',
    '=== CANDIDATE TASKS ===',
    ...(tasks.length === 0 ? ['(none: no task is recorded for this folder)'] : tasks),
    '=== END CANDIDATE TASKS ===',
    '',
    '=== OTHER OPEN TASKS (id | title | repo | requirement) ===',
    ...(others.length === 0 ? ['(none)'] : others),
    '=== END OTHER OPEN TASKS ===',
    '',
    '=== SESSION DIGEST ===',
    input.digest,
    '=== END SESSION DIGEST ===',
    '',
    'The JSON shape, with every key; optional keys may be left out:',
    '{"taskId": "<candidate id>" | null,',
    ' "newTask": {"title": "...", "requirement": "..."},',
    ' "plan": ["step", "step"],',
    ' "checklistAdd": ["..."],',
    ' "checklistTick": ["..."],',
    ' "note": {"title": "...", "summary": "...", "body": "..."},',
    ' "session": {"title": "...", "summary": "..."},',
    ' "headline": "...",',
    ' "phase": "..."}',
    '',
  ].join('\n');
}

/**
 * Takes the JSON object out of a model answer. A bare object is the contract, but a model that
 * wraps it in a Markdown fence or a sentence of preamble has still answered, so the outermost
 * braces are what is read. Anything that does not parse to an object is undefined.
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A checked capture answer, or the reason it was refused. Never both, never neither. */
export type CaptureParse = { result: CaptureResult; error?: undefined } | { result?: undefined; error: string };

function stringList(value: unknown, key: string): string[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return `${key} is not a list of strings`;
  }
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== '');
}

function optionalString(value: unknown, key: string, max: number): string | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return new Error(`${key} is not a string`);
  const text = clip(value, max);
  return text === '' ? undefined : text;
}

/**
 * Checks a model answer against the capture shape. Strict about types: a field of the wrong
 * type refuses the whole answer, since an answer that got the shape wrong cannot be trusted to
 * have got the content right, and a refused answer writes nothing. Lenient about length: text
 * over its limit is cut rather than refused, because the model was told the limit and a long
 * title is still a title.
 *
 * `candidateIds` is the set the model was shown. A taskId outside it is refused: the model may
 * pick one of the tasks it was given, or none, and never one it made up.
 */
export function parseCaptureResult(text: string, candidateIds: readonly string[]): CaptureParse {
  const data = extractJsonObject(text);
  if (!data) return { error: 'the answer held no JSON object' };

  let taskId: string | null = null;
  if (typeof data.taskId === 'string' && data.taskId.trim() !== '') {
    taskId = data.taskId.trim();
    if (!candidateIds.includes(taskId)) {
      return { error: `taskId ${JSON.stringify(taskId)} is not one of the candidates` };
    }
  } else if (data.taskId !== undefined && data.taskId !== null && data.taskId !== '') {
    return { error: 'taskId is neither a string nor null' };
  }

  if (!isObject(data.session)) return { error: 'session is missing' };
  const sessionTitle = optionalString(data.session.title, 'session.title', SESSION_TITLE_MAX);
  const sessionSummary = optionalString(data.session.summary, 'session.summary', 400);
  if (sessionTitle instanceof Error) return { error: sessionTitle.message };
  if (sessionSummary instanceof Error) return { error: sessionSummary.message };
  if (sessionTitle === undefined) return { error: 'session.title is empty' };

  const add = stringList(data.checklistAdd, 'checklistAdd');
  const tick = stringList(data.checklistTick, 'checklistTick');
  if (typeof add === 'string') return { error: add };
  if (typeof tick === 'string') return { error: tick };

  const result: CaptureResult = {
    taskId,
    checklistAdd: add.map((item) => clip(item, 160)),
    checklistTick: tick,
    session: { title: sessionTitle.replace(/[.。]+$/, ''), summary: sessionSummary ?? '' },
  };

  if (taskId === null && data.newTask !== undefined && data.newTask !== null) {
    if (!isObject(data.newTask)) return { error: 'newTask is not an object' };
    const title = optionalString(data.newTask.title, 'newTask.title', 80);
    const requirement = data.newTask.requirement;
    if (title instanceof Error) return { error: title.message };
    if (requirement !== undefined && typeof requirement !== 'string') {
      return { error: 'newTask.requirement is not a string' };
    }
    if (title !== undefined) {
      result.newTask = { title, requirement: (requirement ?? '').trim() };
    }
  }

  if (data.plan !== undefined && data.plan !== null) {
    const steps = stringList(data.plan, 'plan');
    if (typeof steps === 'string') return { error: steps };
    if (steps.length > 0) result.plan = steps.slice(0, 12).map((s) => clip(s, PLAN_STEP_MAX));
  }

  if (data.note !== undefined && data.note !== null) {
    if (!isObject(data.note)) return { error: 'note is not an object' };
    const noteTitle = optionalString(data.note.title, 'note.title', 60);
    const noteSummary = optionalString(data.note.summary, 'note.summary', 400);
    const body = data.note.body;
    if (noteTitle instanceof Error) return { error: noteTitle.message };
    if (noteSummary instanceof Error) return { error: noteSummary.message };
    if (body !== undefined && typeof body !== 'string') return { error: 'note.body is not a string' };
    if (typeof body === 'string' && body.trim() !== '') {
      result.note = {
        title: noteTitle ?? clip(body, 60),
        summary: noteSummary ?? '',
        body: body.trim(),
      };
    }
  }

  const headline = optionalString(data.headline, 'headline', 160);
  const phase = optionalString(data.phase, 'phase', 160);
  if (headline instanceof Error) return { error: headline.message };
  if (phase instanceof Error) return { error: phase.message };
  if (headline !== undefined) result.headline = headline;
  if (phase !== undefined) result.phase = phase;
  return { result };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
}

/**
 * Finds the item a line of model text means, or -1. The model is asked for exact texts, but it
 * rephrases, drops a backtick or changes a plural, and a tick that silently misses is a record
 * that silently lies. So the match is on words, not characters: the same words in any case and
 * punctuation match outright, one text containing the other matches when the shorter has at
 * least three words, and otherwise the share of words in common has to reach 0.6. The best
 * score wins; ties go to the earlier item, which is the order the person wrote them in.
 */
export function matchItem(items: readonly string[], text: string): number {
  const target = words(text);
  if (target.length === 0) return -1;
  const joined = target.join(' ');
  let best = -1;
  let bestScore = 0;
  items.forEach((item, index) => {
    const candidate = words(item);
    if (candidate.length === 0) return;
    const other = candidate.join(' ');
    let score: number;
    if (other === joined) score = 1;
    else if (
      Math.min(candidate.length, target.length) >= 3 &&
      (other.includes(joined) || joined.includes(other))
    ) {
      score = 0.9;
    } else {
      const a = new Set(candidate);
      const b = new Set(target);
      const shared = [...a].filter((word) => b.has(word)).length;
      score = shared / new Set([...a, ...b]).size;
    }
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return bestScore >= 0.6 ? best : -1;
}

const LABELLED = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * Finds the checklist item `text` repeats, or -1, minding the `[sub-goal] item` marks that
 * folding and merging write. Two items under one mark share those words, so they are compared
 * on what follows the mark, and only with items under the same mark; unmarked text is compared
 * with matchItem as before.
 */
export function matchChecklistItem(items: readonly string[], text: string): number {
  const marked = LABELLED.exec(text);
  if (!marked) return matchItem(items, text);
  const label = marked[1]!.trim().toLowerCase();
  const same = items
    .map((item, index) => ({ hit: LABELLED.exec(item), index }))
    .filter((entry) => entry.hit && entry.hit[1]!.trim().toLowerCase() === label);
  const hit = matchItem(same.map((entry) => entry.hit![2]!), marked[2]!);
  return hit < 0 ? -1 : same[hit]!.index;
}

/** True when two plans say the same steps in the same order, ignoring spacing and case. */
export function samePlan(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, i) => words(step).join(' ') === words(b[i]!).join(' '));
}
