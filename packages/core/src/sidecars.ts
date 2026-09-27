/**
 * The two sidecar records of the AI assistant contract (v3), pure half: their shapes, the key
 * that ties an AI title to the text it was written for, and the readers that turn a file on disk
 * back into a record. Nothing here imports a platform module, because the desktop WebView reads
 * the same files through `@ledge/core/pure` and must reach the same answer as the CLI.
 *
 * Why sidecars at all. Rule zero of the contract is that a task file keeps its format, byte for
 * byte. What a model says about a session (its title, its summary, the files it touched) and
 * what a model says about a note or a plan step (a short title next to the original words) is
 * not the person's record, so it does not go into the Markdown. It goes into JSON beside it:
 * one SessionRecord per Claude Code session under `sessions/`, one TaskInsights per task under
 * `insights/`. Delete both folders and every task file still reads exactly as it did.
 *
 * Two properties every reader here keeps, since a background writer and a panel share the files:
 *
 * - A file that is missing, half written or written by something else is absent, never an
 *   error. The parsers answer undefined rather than throwing, and they drop a field of the wrong
 *   type rather than rejecting the record, because a panel that goes blank over one bad field
 *   is worse than one that shows a little less.
 * - Running is derived, never stored. A stored flag would be wrong the moment the session was
 *   killed without its SessionEnd hook firing, which is exactly when a person most needs to
 *   know that it stopped.
 */
import { ACTIVE_WINDOW_MS } from './activity.ts';

/** One commit made while a session ran, as `git log` reported it. */
export interface SessionCommit {
  sha: string;
  subject: string;
}

/**
 * Everything Ledge knows about one Claude Code session. The hooks write the facts they can see
 * (when it started, where, which transcript) and the capture adds what the transcript and git
 * show (files, commits, ticks) and what the model wrote (title and summary). Only `version`,
 * `id`, `started`, `lastActivity` and the four lists are always present.
 */
export interface SessionRecord {
  version: 1;
  /** The Claude Code session id, exactly as the hook payload spells it. */
  id: string;
  /** Task the session was attributed to. Absent until the first capture decides. */
  taskId?: string;
  /** Absolute working directory of the session. */
  repo?: string;
  /** Absolute path of the JSONL transcript, from the hook payload. */
  transcriptPath?: string;
  /** ISO 8601 with offset: the first transcript entry, or the hook time before there is one. */
  started: string;
  /** ISO 8601: the newest transcript entry seen. */
  lastActivity: string;
  /** ISO 8601, set by the SessionEnd hook. Absent while the session may still be running. */
  ended?: string;
  /** AI written, at most 60 characters, no trailing period. */
  title?: string;
  /** AI written, at most two sentences. */
  summary?: string;
  /** Paths edited by Edit, Write or NotebookEdit calls, relative to `repo` when inside it. */
  filesChanged: string[];
  /** Commits between `started` and `lastActivity`, newest first. */
  commits: SessionCommit[];
  /** Checklist item texts ticked during this session. */
  todosTicked: string[];
  /** Checklist item texts added during this session. */
  todosAdded: string[];
  /** True when the capture created the task this session is attributed to. */
  autoCreatedTask?: boolean;
  /** ISO 8601 of the last successful capture. */
  capturedAt?: string;
  /** Transcript line count at the last capture, which is what the debounce counts from. */
  capturedLines?: number;
  /** Model that wrote `title` and `summary`. */
  model?: string;
}

/** An AI title and summary for one dated note. The note itself is never rewritten. */
export interface NoteInsight {
  title: string;
  summary: string;
}

/** An AI title, and optionally the rest of the step, for one plan step. */
export interface PlanInsight {
  title: string;
  detail?: string;
}

/**
 * AI written titles and summaries for one task, kept apart from the task file. Every entry is
 * keyed by `contentKey` of the text it describes, so an entry written for a note that has since
 * been edited no longer matches anything and simply stops being shown: nothing has to notice the
 * edit, and nothing stale can ever be put next to words it was not written for.
 */
export interface TaskInsights {
  version: 1;
  taskId: string;
  /** One line: where the task stands right now. */
  headline?: string;
  /** Name of the plan step currently in progress. */
  phase?: string;
  /** Keyed by `contentKey(note.date + '\n' + note.body)`. */
  notes: Record<string, NoteInsight>;
  /** Keyed by `contentKey(step)`. */
  plan: Record<string, PlanInsight>;
  /** ISO 8601 of the last write. */
  updatedAt: string;
  /** Model that wrote the newest entries. */
  model?: string;
}

/**
 * The key an insight is filed under: FNV-1a, 32 bit, over the UTF-8 bytes of the text with every
 * run of whitespace collapsed to one space and the ends trimmed, as eight lowercase hex digits.
 *
 * Whitespace is folded so that re-wrapping a paragraph, which the serializer and editors both do,
 * does not orphan its title; any change to the words themselves does, on purpose. FNV-1a is used
 * because it is a dozen lines with no dependency, gives the same answer in Node and in a
 * WebView, and a collision between two notes of one task is not a realistic concern at 32 bits.
 */
export function contentKey(text: string): string {
  const folded = text.replace(/\s+/g, ' ').trim();
  const bytes = new TextEncoder().encode(folded);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The content key of a dated note, as TaskInsights files it. */
export function noteKey(note: { date: string; body: string }): string {
  return contentKey(`${note.date}\n${note.body}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Reads a SessionRecord from the text of its file. Answers undefined for text that is not JSON,
 * not an object, not version 1, or missing one of `id`, `started` and `lastActivity`. Anything
 * else of the wrong type is dropped and the rest kept: a list that is not a list reads as empty,
 * a commit without a sha is skipped, an optional string that is not a string is left out.
 */
export function parseSessionRecord(json: string): SessionRecord | undefined {
  const data = parseJson(json);
  if (!isObject(data) || data.version !== 1) return undefined;
  const id = str(data.id);
  const started = str(data.started);
  const lastActivity = str(data.lastActivity) ?? started;
  if (!id || !started || !lastActivity) return undefined;
  const record: SessionRecord = {
    version: 1,
    id,
    started,
    lastActivity,
    filesChanged: strings(data.filesChanged),
    commits: Array.isArray(data.commits)
      ? data.commits
          .filter(isObject)
          .filter((c) => typeof c.sha === 'string' && c.sha !== '')
          .map((c) => ({ sha: c.sha as string, subject: str(c.subject) ?? '' }))
      : [],
    todosTicked: strings(data.todosTicked),
    todosAdded: strings(data.todosAdded),
  };
  for (const key of [
    'taskId',
    'repo',
    'transcriptPath',
    'ended',
    'title',
    'summary',
    'capturedAt',
    'model',
  ] as const) {
    const value = str(data[key]);
    if (value !== undefined) record[key] = value;
  }
  if (data.autoCreatedTask === true) record.autoCreatedTask = true;
  if (typeof data.capturedLines === 'number' && Number.isFinite(data.capturedLines)) {
    record.capturedLines = data.capturedLines;
  }
  return record;
}

/**
 * Reads a TaskInsights from the text of its file, with the same tolerance as
 * parseSessionRecord: undefined for anything that is not a version 1 object with a `taskId`,
 * and an entry whose title is not a string is dropped rather than failing the whole file.
 */
export function parseInsights(json: string): TaskInsights | undefined {
  const data = parseJson(json);
  if (!isObject(data) || data.version !== 1) return undefined;
  const taskId = str(data.taskId);
  if (!taskId) return undefined;
  const notes: Record<string, NoteInsight> = {};
  if (isObject(data.notes)) {
    for (const [key, entry] of Object.entries(data.notes)) {
      if (!isObject(entry) || typeof entry.title !== 'string') continue;
      notes[key] = { title: entry.title, summary: str(entry.summary) ?? '' };
    }
  }
  const plan: Record<string, PlanInsight> = {};
  if (isObject(data.plan)) {
    for (const [key, entry] of Object.entries(data.plan)) {
      if (!isObject(entry) || typeof entry.title !== 'string') continue;
      const step: PlanInsight = { title: entry.title };
      const detail = str(entry.detail);
      if (detail !== undefined) step.detail = detail;
      plan[key] = step;
    }
  }
  const insights: TaskInsights = {
    version: 1,
    taskId,
    notes,
    plan,
    updatedAt: str(data.updatedAt) ?? '',
  };
  for (const key of ['headline', 'phase', 'model'] as const) {
    const value = str(data[key]);
    if (value !== undefined) insights[key] = value;
  }
  return insights;
}

/** The text of a SessionRecord file: two space JSON and a final newline, so diffs stay small. */
export function serializeSessionRecord(record: SessionRecord): string {
  return JSON.stringify(record, null, 2) + '\n';
}

/** The text of a TaskInsights file, in the same shape as serializeSessionRecord. */
export function serializeInsights(insights: TaskInsights): string {
  return JSON.stringify(insights, null, 2) + '\n';
}

/** A TaskInsights with nothing in it yet, for a task that has never been summarised. */
export function emptyInsights(taskId: string, updatedAt: string): TaskInsights {
  return { version: 1, taskId, notes: {}, plan: {}, updatedAt };
}

/**
 * Whether a session is running at `now`: it has not ended and its newest transcript entry is
 * inside ACTIVE_WINDOW_MS, the same fifteen minutes the activity ranking calls the present
 * tense, so the panel's live dot and the desk's "active now" can never disagree.
 */
export function isSessionRunning(record: SessionRecord, now: Date): boolean {
  if (record.ended) return false;
  const last = Date.parse(record.lastActivity);
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < ACTIVE_WINDOW_MS;
}

/**
 * How long a session was worked, in milliseconds: from `started` to `lastActivity`, never less
 * than zero. It deliberately stops at the last transcript entry rather than at `ended`, since a
 * terminal left open overnight and closed in the morning did not do a night of work. A record
 * whose times cannot be read is zero long.
 */
export function sessionDurationMs(record: SessionRecord): number {
  const start = Date.parse(record.started);
  const last = Date.parse(record.lastActivity);
  if (!Number.isFinite(start) || !Number.isFinite(last)) return 0;
  return Math.max(0, last - start);
}
