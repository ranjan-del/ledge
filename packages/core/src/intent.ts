/**
 * The intent record: which task a Claude Code session was launched for. A session knows only the
 * folder it runs in, and several tasks can share one repository, so the launcher has to write
 * down what it opened or nothing downstream can tell which task a session belonged to.
 *
 * The records live in `<home>/intent.json`, a file of their own. They are deliberately not in
 * `config.json`: that file is owned by `ledge init` and by the desktop's settings screen, both of
 * which rewrite it wholesale, and a record written by a launcher would be lost the next time
 * either of them saved.
 *
 * A record is a claim about right now, not a standing fact, so every record carries the moment it
 * was made and anything older than INTENT_TTL_MS is ignored and dropped on the next write. That
 * is what stops a click on Monday from promoting a task on Thursday.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expandTilde, ledgeHome } from './config.ts';
import { matchRepo } from './store.ts';
import { formatIso } from './task-file.ts';
import type { Snapshot } from './evidence.ts';

/** How long an intent record can promote a task. Older records are ignored and then deleted. */
export const INTENT_TTL_MS = 12 * 60 * 60 * 1000;

const INTENT_FILE = 'intent.json';

/**
 * One launch: the task a session was opened for, the folder it was opened in, when that happened,
 * the session id once the session announced itself, and the snapshot of the task taken before the
 * session could change anything.
 */
export interface IntentRecord {
  taskId: string;
  /** Absolute path of the repository the session runs in. Absent when the task names none. */
  repo?: string;
  /** The Claude Code session id, recorded at session start, not at launch. */
  sessionId?: string;
  /** ISO 8601 with offset, the moment the record was made. */
  started: string;
  /** The task and repository as they stood before the session. Absent until one is taken. */
  before?: Snapshot;
}

/** Where to read and write, and what time it is. Both default to this machine. */
export interface IntentOptions {
  home?: string;
  now?: Date;
}

function fileFor(home?: string): string {
  return join(resolve(expandTilde(home ?? ledgeHome())), INTENT_FILE);
}

function isLive(record: IntentRecord, now: Date): boolean {
  const started = Date.parse(record.started);
  if (!Number.isFinite(started)) return false;
  const age = now.getTime() - started;
  return age >= 0 && age <= INTENT_TTL_MS;
}

function readAll(home?: string): IntentRecord[] {
  const file = fileFor(home);
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A half-written or hand-mangled file must never break a session start or a session end.
    // There is nothing here that cannot be recreated by clicking again, so it is dropped.
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const list = (parsed as { intents?: unknown }).intents;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is IntentRecord =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as IntentRecord).taskId === 'string' &&
      typeof (item as IntentRecord).started === 'string',
  );
}

function writeAll(records: IntentRecord[], home?: string): void {
  const file = fileFor(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ intents: records }, null, 2) + '\n');
}

/**
 * Returns the live intent records, newest first, ignoring any that have expired or that the file
 * spells wrongly. Reading never throws: both hooks call this on every session, and a store that
 * cannot answer must still let the session run.
 */
export function readIntents(opts: IntentOptions = {}): IntentRecord[] {
  const now = opts.now ?? new Date();
  return readAll(opts.home)
    .filter((record) => isLive(record, now))
    .sort((a, b) => b.started.localeCompare(a.started));
}

/**
 * Writes the intent record for a task, replacing any earlier record for the same task and
 * dropping every expired one, so the file cannot grow without bound. This is what the desktop
 * panel calls before it launches a session, through `ledge began <id>`.
 */
export function recordIntent(
  input: { taskId: string; repo?: string; sessionId?: string; before?: Snapshot },
  opts: IntentOptions = {},
): IntentRecord {
  const now = opts.now ?? new Date();
  const record: IntentRecord = { taskId: input.taskId, started: formatIso(now) };
  if (input.repo !== undefined) record.repo = resolve(expandTilde(input.repo));
  if (input.sessionId !== undefined) record.sessionId = input.sessionId;
  if (input.before !== undefined) record.before = input.before;
  const kept = readAll(opts.home).filter(
    (other) => other.taskId !== input.taskId && isLive(other, now),
  );
  writeAll([record, ...kept], opts.home);
  return record;
}

/**
 * Updates the live record for a task with the session id, the before snapshot, or both, and
 * returns it. Returns undefined when there is no live record, which is the normal answer for a
 * session nobody launched from Ledge; callers treat that as "nothing to do", never as an error.
 */
export function updateIntent(
  taskId: string,
  patch: { sessionId?: string; before?: Snapshot },
  opts: IntentOptions = {},
): IntentRecord | undefined {
  const now = opts.now ?? new Date();
  const records = readAll(opts.home).filter((record) => isLive(record, now));
  const found = records.find((record) => record.taskId === taskId);
  if (!found) return undefined;
  if (patch.sessionId !== undefined) found.sessionId = patch.sessionId;
  if (patch.before !== undefined) found.before = patch.before;
  writeAll(records, opts.home);
  return found;
}

/**
 * Removes the record for a task, and every expired record with it. Called once a record has done
 * its job, so that running `ledge settle` twice cannot promote or report anything twice.
 */
export function clearIntent(taskId: string, opts: IntentOptions = {}): void {
  const now = opts.now ?? new Date();
  const kept = readAll(opts.home).filter(
    (record) => record.taskId !== taskId && isLive(record, now),
  );
  writeAll(kept, opts.home);
}

/**
 * Returns the live record for the folder a session is running in: the one whose repository equals
 * the folder or contains it, deepest match first and newest record among equals. Records with no
 * repository never match a folder, exactly as tasks with no repo never match one, because there
 * is nothing to compare the folder against.
 */
export function intentFor(cwd: string, opts: IntentOptions = {}): IntentRecord | undefined {
  return matchRepo(readIntents(opts), cwd);
}
