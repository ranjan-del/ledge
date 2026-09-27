/**
 * TEMPORARY: replace with @ledge/core/pure exports at merge.
 *
 * A local copy of the pure half of the AI assistant contract (v3,
 * docs/superpowers/specs/2026-09-27-ai-assistant-contract.md): the two sidecar shapes, the
 * content key both sides use to look an entry up, the two parsers and the two derived session
 * facts. Core is being built in parallel, so the desktop carries this shim with exactly the
 * contract's names and signatures; at merge every importer switches to `@ledge/core/pure` and
 * this file is deleted. Nothing else lives here, so the swap is one import line per file.
 */

/** A session counts as running while it has not ended and was active this recently. */
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export interface SessionRecord {
  version: 1;
  id: string;
  taskId?: string;
  repo?: string;
  transcriptPath?: string;
  started: string;
  lastActivity: string;
  ended?: string;
  title?: string;
  summary?: string;
  filesChanged: string[];
  commits: { sha: string; subject: string }[];
  todosTicked: string[];
  todosAdded: string[];
  autoCreatedTask?: boolean;
  capturedAt?: string;
  capturedLines?: number;
  model?: string;
}

export interface TaskInsights {
  version: 1;
  taskId: string;
  headline?: string;
  phase?: string;
  notes: Record<string, { title: string; summary: string }>;
  plan: Record<string, { title: string; detail?: string }>;
  updatedAt: string;
  model?: string;
}

/**
 * FNV-1a, 32 bit, over the text with whitespace collapsed and trimmed, as 8 lowercase hex
 * characters. Collapsing first is what lets a note that was re-wrapped by an editor keep its
 * key. The hash runs over UTF-8 bytes so the Node side and the WebView agree on non-ASCII text.
 */
export function contentKey(text: string): string {
  const normal = text.replace(/\s+/g, ' ').trim();
  const bytes = new TextEncoder().encode(normal);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Assigns only the optional fields that are present, so a record never carries `undefined`. */
function assignDefined<T extends object>(target: T, extra: Partial<T>): T {
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
  return target;
}

/**
 * Reads one `sessions/<id>.json`. Anything that is not a version 1 record with an id and the two
 * timestamps is treated as absent, and list fields that are missing or malformed become empty,
 * so a half written file can never crash a reader.
 */
export function parseSessionRecord(json: string): SessionRecord | undefined {
  const raw = parseJson(json);
  if (!isObject(raw) || raw.version !== 1) return undefined;
  const id = str(raw.id);
  const started = str(raw.started);
  if (!id || !started) return undefined;
  const lastActivity = str(raw.lastActivity) ?? started;
  const commits = Array.isArray(raw.commits)
    ? raw.commits
        .filter(isObject)
        .map((c) => ({ sha: str(c.sha) ?? '', subject: typeof c.subject === 'string' ? c.subject : '' }))
        .filter((c) => c.sha !== '')
    : [];
  const rec: SessionRecord = {
    version: 1,
    id,
    started,
    lastActivity,
    filesChanged: strings(raw.filesChanged),
    commits,
    todosTicked: strings(raw.todosTicked),
    todosAdded: strings(raw.todosAdded),
  };
  return assignDefined(rec, {
    taskId: str(raw.taskId),
    repo: str(raw.repo),
    transcriptPath: str(raw.transcriptPath),
    ended: str(raw.ended),
    title: str(raw.title),
    summary: str(raw.summary),
    autoCreatedTask: typeof raw.autoCreatedTask === 'boolean' ? raw.autoCreatedTask : undefined,
    capturedAt: str(raw.capturedAt),
    capturedLines: typeof raw.capturedLines === 'number' ? raw.capturedLines : undefined,
    model: str(raw.model),
  });
}

/** Reads one `insights/<task-id>.json`, dropping entries that are not the documented shape. */
export function parseInsights(json: string): TaskInsights | undefined {
  const raw = parseJson(json);
  if (!isObject(raw) || raw.version !== 1) return undefined;
  const taskId = str(raw.taskId);
  if (!taskId) return undefined;
  const notes: TaskInsights['notes'] = {};
  if (isObject(raw.notes)) {
    for (const [key, v] of Object.entries(raw.notes)) {
      if (isObject(v) && typeof v.title === 'string') {
        notes[key] = { title: v.title, summary: typeof v.summary === 'string' ? v.summary : '' };
      }
    }
  }
  const plan: TaskInsights['plan'] = {};
  if (isObject(raw.plan)) {
    for (const [key, v] of Object.entries(raw.plan)) {
      if (isObject(v) && typeof v.title === 'string') {
        const entry: { title: string; detail?: string } = { title: v.title };
        if (typeof v.detail === 'string' && v.detail !== '') entry.detail = v.detail;
        plan[key] = entry;
      }
    }
  }
  const out: TaskInsights = {
    version: 1,
    taskId,
    notes,
    plan,
    updatedAt: str(raw.updatedAt) ?? '',
  };
  return assignDefined(out, {
    headline: str(raw.headline),
    phase: str(raw.phase),
    model: str(raw.model),
  });
}

/** Running is derived, never stored: not ended, and active within ACTIVE_WINDOW_MS. */
export function isSessionRunning(rec: SessionRecord, now: Date): boolean {
  if (rec.ended) return false;
  const last = Date.parse(rec.lastActivity);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < ACTIVE_WINDOW_MS;
}

/** From `started` to `ended`, or to `lastActivity` while it has not ended. Never negative. */
export function sessionDurationMs(rec: SessionRecord): number {
  const start = Date.parse(rec.started);
  const end = Date.parse(rec.ended ?? rec.lastActivity);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}
