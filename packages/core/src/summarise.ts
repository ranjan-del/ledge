/**
 * Backfilling insights, pure half: which notes and plan steps of a task have no current AI title,
 * what the model is asked about them, and what shape its answer must have. `ledge summarise` does
 * the reading and writing; this file decides.
 *
 * It exists because the capture only titles the note it writes. Every note and plan step written
 * before capture existed, or by hand since, would otherwise show the UI's fallback forever. The
 * rule the prompt is built around is the contract's: a title and a summary go next to the
 * original, and the original is never rewritten. So the model is asked to describe, not to
 * improve, and nothing it says is ever written into the task file.
 */
import { contentKey, noteKey } from './sidecars.ts';
import type { NoteInsight, PlanInsight, TaskInsights } from './sidecars.ts';
import type { Task } from './types.ts';

/** One note or plan step that needs a title, with the key its insight will be filed under. */
export interface SummaryItem {
  key: string;
  kind: 'note' | 'plan';
  /** The note's day, for a note. */
  date?: string;
  text: string;
}

/** Character budget for the items of one prompt. Whatever does not fit waits for the next run. */
export const SUMMARISE_MAX_CHARS = 40_000;

/** Longest single note quoted to the model. The title only needs the gist. */
const NOTE_QUOTE_MAX = 3_000;

/**
 * Every note and plan step of `task` that `insights` has no entry for under its current content
 * key, newest notes first and then the plan in order. An entry filed under an old key does not
 * count: the text has changed since it was written, so it describes something that is gone.
 */
export function missingInsights(task: Task, insights: TaskInsights | undefined): SummaryItem[] {
  const notes = [...task.notes]
    .reverse()
    .filter((note) => note.body.trim() !== '' && !insights?.notes[noteKey(note)])
    .map((note): SummaryItem => ({ key: noteKey(note), kind: 'note', date: note.date, text: note.body }));
  const seen = new Set<string>();
  const plan = task.plan
    .map((step): SummaryItem => ({ key: contentKey(step), kind: 'plan', text: step }))
    .filter((item) => {
      if (insights?.plan[item.key] || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  return [...notes, ...plan];
}

/**
 * Splits items into the ones that fit one prompt and the rest, by quoted size. At least one item
 * is always taken, so a single huge note still gets a title rather than blocking the queue.
 */
export function fitSummaryBatch(
  items: SummaryItem[],
  maxChars: number = SUMMARISE_MAX_CHARS,
): { batch: SummaryItem[]; rest: SummaryItem[] } {
  let used = 0;
  let cut = 0;
  for (const item of items) {
    const cost = Math.min(item.text.length, NOTE_QUOTE_MAX) + 40;
    if (cut > 0 && used + cost > maxChars) break;
    used += cost;
    cut++;
  }
  return { batch: items.slice(0, cut), rest: items.slice(cut) };
}

function quote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= NOTE_QUOTE_MAX ? trimmed : `${trimmed.slice(0, NOTE_QUOTE_MAX)} (cut)`;
}

/** Builds the prompt that asks for a title per item, in one call for the whole task. */
export function buildSummarisePrompt(task: Task, items: SummaryItem[]): string {
  const body: string[] = [];
  for (const item of items) {
    body.push('');
    if (item.kind === 'note') body.push(`NOTE key ${item.key}, dated ${item.date}:`);
    else body.push(`PLAN STEP key ${item.key}:`);
    body.push(quote(item.text));
  }
  return [
    "You write short titles for one person's own work records, kept by Ledge. You have no",
    'tools. Answer with one JSON object and nothing else: no prose, no Markdown fence.',
    '',
    'Rules:',
    '1. Describe what the text says. Never add facts, never judge it, never improve it.',
    '2. For each NOTE: "title" is at most 60 characters, a noun phrase or an imperative, no',
    '   trailing period, naming the decision, finding or state the note records. "summary" is',
    '   one or two plain sentences with the substance, at most 300 characters.',
    '3. For each PLAN STEP: "title" is at most 60 characters, the step itself in short. When the',
    '   step carries more than fits, put the rest in "detail", at most 200 characters; otherwise',
    '   leave "detail" out.',
    '4. Use the person\'s own words and names. Never use an em dash or an en dash.',
    '5. Use exactly the keys given below. Cover every one.',
    '',
    `The task: "${task.title}" (id: ${task.id}).`,
    '=== ITEMS ===',
    ...body,
    '=== END ITEMS ===',
    '',
    'The JSON shape:',
    '{"notes": {"<key>": {"title": "...", "summary": "..."}},',
    ' "plan": {"<key>": {"title": "...", "detail": "..."}}}',
    '',
  ].join('\n');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A checked summarise answer, or the reason it was refused. */
export type SummariseParse =
  | { notes: Record<string, NoteInsight>; plan: Record<string, PlanInsight>; error?: undefined }
  | { notes?: undefined; plan?: undefined; error: string };

/**
 * Checks a summarise answer. Only keys that were asked about are kept, so a model cannot file a
 * title under a note it was not shown. An entry without a string title is skipped rather than
 * refusing the rest, since each entry stands alone; an answer with no object, or with `notes`
 * or `plan` of the wrong type, is refused whole.
 */
export function parseSummariseResult(text: string, items: SummaryItem[]): SummariseParse {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let data: unknown;
  try {
    data = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined;
  } catch {
    data = undefined;
  }
  if (!isObject(data)) return { error: 'the answer held no JSON object' };
  if (data.notes !== undefined && !isObject(data.notes)) return { error: 'notes is not an object' };
  if (data.plan !== undefined && !isObject(data.plan)) return { error: 'plan is not an object' };
  const wanted = new Map(items.map((item) => [`${item.kind}:${item.key}`, item]));
  const notes: Record<string, NoteInsight> = {};
  const plan: Record<string, PlanInsight> = {};
  for (const [key, entry] of Object.entries((data.notes ?? {}) as Record<string, unknown>)) {
    if (!wanted.has(`note:${key}`) || !isObject(entry) || typeof entry.title !== 'string') continue;
    const title = clip(entry.title, 60).replace(/\.+$/, '');
    if (title === '') continue;
    notes[key] = { title, summary: typeof entry.summary === 'string' ? clip(entry.summary, 400) : '' };
  }
  for (const [key, entry] of Object.entries((data.plan ?? {}) as Record<string, unknown>)) {
    if (!wanted.has(`plan:${key}`) || !isObject(entry) || typeof entry.title !== 'string') continue;
    const title = clip(entry.title, 60).replace(/\.+$/, '');
    if (title === '') continue;
    const step: PlanInsight = { title };
    if (typeof entry.detail === 'string' && entry.detail.trim() !== '') step.detail = clip(entry.detail, 240);
    plan[key] = step;
  }
  return { notes, plan };
}
