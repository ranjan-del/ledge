/**
 * The sidecar records, Node half: SessionStore over `<home>/sessions/` and InsightStore over
 * `<home>/insights/`. The shapes and the parsers are pure and live in ./sidecars.ts; this file
 * only reads and writes them.
 *
 * Every write goes to a temporary file in the same folder and is then renamed over the target.
 * A rename inside one folder is atomic, so the panel's file watcher sees either the old record or
 * the new one and never half of each. That matters more here than for task files, because these
 * are written by a capture running detached in the background while a person has the panel open.
 *
 * Every read is tolerant: a missing folder is an empty list, and a file that does not parse is
 * treated as absent. Nothing in this file throws on the way in except `put` with an id that would
 * escape the folder, which is a caller bug and should be loud.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandTilde, ledgeHome } from './config.ts';
import {
  parseInsights,
  parseSessionRecord,
  serializeInsights,
  serializeSessionRecord,
} from './sidecars.ts';
import type { SessionRecord, TaskInsights } from './sidecars.ts';

/**
 * Ids become file names, so only characters that cannot form a path are allowed: a session id
 * is a UUID and a task id is a slug, and both fit comfortably inside this.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes('..');
}

/**
 * Writes `text` to `file` atomically: a temporary sibling first, then a rename. The temporary
 * name carries the process id so two writers racing for the same record cannot trample each
 * other's half-written file; the loser's rename simply lands second.
 */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Reads a file, answering undefined when it is missing or unreadable for any reason. */
function readQuietly(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function timeOf(iso: string | undefined): number {
  const t = iso === undefined ? NaN : Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** The part both stores share: a folder of `<id>.json` files and a parser for one of them. */
class JsonFolder<T> {
  readonly dir: string;
  private readonly parse: (json: string) => T | undefined;
  private readonly serialize: (value: T) => string;

  constructor(dir: string, parse: (json: string) => T | undefined, serialize: (value: T) => string) {
    this.dir = dir;
    this.parse = parse;
    this.serialize = serialize;
  }

  file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  get(id: string): T | undefined {
    if (!safeId(id)) return undefined;
    const text = readQuietly(this.file(id));
    return text === undefined ? undefined : this.parse(text);
  }

  all(): T[] {
    if (!existsSync(this.dir)) return [];
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const found: T[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const text = readQuietly(join(this.dir, name));
      const value = text === undefined ? undefined : this.parse(text);
      if (value !== undefined) found.push(value);
    }
    return found;
  }

  put(id: string, value: T): void {
    if (!safeId(id)) throw new Error(`Not a usable record id: ${JSON.stringify(id)}`);
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(this.file(id), this.serialize(value));
  }
}

/**
 * One SessionRecord per Claude Code session, in `<home>/sessions/<session id>.json`. The folder
 * is created on the first write. `home` defaults to `ledgeHome()`, which is what keeps every test
 * away from the real store.
 */
export class SessionStore {
  readonly home: string;
  private readonly folder: JsonFolder<SessionRecord>;

  constructor(home?: string) {
    this.home = resolve(expandTilde(home ?? ledgeHome()));
    this.folder = new JsonFolder(join(this.home, 'sessions'), parseSessionRecord, serializeSessionRecord);
  }

  /** Folder the records live in. */
  get dir(): string {
    return this.folder.dir;
  }

  /** The record for a session id, or undefined when there is none or it does not parse. */
  get(id: string): SessionRecord | undefined {
    return this.folder.get(id);
  }

  /**
   * Every readable record, newest first by `lastActivity`, then by `started`. With `taskId`,
   * only the sessions attributed to that task.
   */
  list(taskId?: string): SessionRecord[] {
    const records = this.folder.all().filter((r) => taskId === undefined || r.taskId === taskId);
    return records.sort(
      (a, b) =>
        timeOf(b.lastActivity) - timeOf(a.lastActivity) || timeOf(b.started) - timeOf(a.started),
    );
  }

  /** Writes a record atomically under its own id, replacing any earlier one. */
  put(record: SessionRecord): SessionRecord {
    this.folder.put(record.id, record);
    return record;
  }

  /**
   * Attributes every session of the tasks in `fromIds` to `intoId` instead, which is what a
   * merge needs so the next capture of those sessions lands in the parent. Returns how many
   * records changed.
   */
  reassign(fromIds: readonly string[], intoId: string): number {
    let changed = 0;
    for (const record of this.folder.all()) {
      if (record.taskId === undefined || !fromIds.includes(record.taskId)) continue;
      this.put({ ...record, taskId: intoId });
      changed++;
    }
    return changed;
  }
}

/**
 * One TaskInsights per task, in `<home>/insights/<task id>.json`, created on the first write.
 * The store never merges: a caller reads, changes and puts, which is simple because the only
 * writers are a capture and `ledge summarise`, both short and both run by the same person.
 */
export class InsightStore {
  readonly home: string;
  private readonly folder: JsonFolder<TaskInsights>;

  constructor(home?: string) {
    this.home = resolve(expandTilde(home ?? ledgeHome()));
    this.folder = new JsonFolder(join(this.home, 'insights'), parseInsights, serializeInsights);
  }

  /** Folder the insight files live in. */
  get dir(): string {
    return this.folder.dir;
  }

  /** The insights for a task id, or undefined when there are none or the file does not parse. */
  get(taskId: string): TaskInsights | undefined {
    return this.folder.get(taskId);
  }

  /** Every readable insights file, most recently updated first. */
  list(): TaskInsights[] {
    return this.folder.all().sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
  }

  /** Writes a task's insights atomically, replacing any earlier file. */
  put(insights: TaskInsights): TaskInsights {
    this.folder.put(insights.taskId, insights);
    return insights;
  }

  /** Deletes a task's insights, for a task that no longer exists. Absent is fine. */
  remove(taskId: string): void {
    rmSync(this.folder.file(taskId), { force: true });
  }
}
