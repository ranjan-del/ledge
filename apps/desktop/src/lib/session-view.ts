/**
 * What the SESSIONS surface shows, as data: every Claude Code session Ledge knows of, grouped
 * by the task it worked on, newest first. Two sources feed it and neither is trusted to be
 * complete. A SessionRecord from `~/.ledge/sessions/` carries the title, summary, times and
 * what changed; a task file's `sessions:` list carries ids only, and is all an older session or
 * one that capture never reached will ever have. A session known from both is shown once, with
 * its record.
 *
 * Pure, so the grouping and the ordering are tested without a filesystem.
 */
import type { Task } from '@ledge/core/pure';
import { isSessionRunning, sessionDurationMs, type SessionRecord } from './insights.ts';

export interface SessionItem {
  id: string;
  /** Absent for a session only a task file mentions. */
  record?: SessionRecord;
  /** When it started, from the record. Absent without one. */
  started?: string;
  running: boolean;
  durationMs: number;
  /** The first, and so the newest, session listed under its task. */
  isLatest: boolean;
}

export interface SessionGroup {
  /** Stable key for the keyed each block. */
  key: string;
  /** Undefined for sessions that name no task Ledge can find. */
  task?: Task;
  title: string;
  items: SessionItem[];
  /** Newest start in the group, or the task's `updated` when no item has a record. */
  newest: number;
}

const UNLINKED = 'Not linked to a task';

function time(iso: string | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Groups every known session by task. Within a group, sessions with a record come first,
 * newest start first; ids only a task file names follow, newest id first, because the file
 * lists them oldest first and has no times. Groups are ordered by their newest session.
 */
export function groupSessions(tasks: Task[], records: SessionRecord[], now: Date): SessionGroup[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  /* A record that names no task may still be listed on one: the Stop hook links sessions to
     tasks on its own, before any capture has run. */
  const ownerOf = new Map<string, Task>();
  for (const t of tasks) for (const id of t.sessions) if (!ownerOf.has(id)) ownerOf.set(id, t);

  const groups = new Map<string, SessionGroup>();
  function group(task: Task | undefined): SessionGroup {
    const key = task ? `task:${task.id}` : 'unlinked';
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: task?.title ?? UNLINKED,
        items: [],
        newest: Number.NEGATIVE_INFINITY,
      };
      if (task) g.task = task;
      groups.set(key, g);
    }
    return g;
  }

  const placed = new Set<string>();
  const sorted = [...records].sort((a, b) => time(b.started) - time(a.started));
  for (const rec of sorted) {
    const task = (rec.taskId ? taskById.get(rec.taskId) : undefined) ?? ownerOf.get(rec.id);
    const g = group(task);
    g.items.push({
      id: rec.id,
      record: rec,
      started: rec.started,
      running: isSessionRunning(rec, now),
      durationMs: sessionDurationMs(rec),
      isLatest: false,
    });
    g.newest = Math.max(g.newest, time(rec.started));
    placed.add(rec.id);
  }

  for (const task of tasks) {
    const ids = [...task.sessions].reverse().filter((id) => id.trim() !== '' && !placed.has(id));
    if (ids.length === 0) continue;
    const g = group(task);
    for (const id of ids) {
      if (placed.has(id)) continue;
      placed.add(id);
      g.items.push({ id, running: false, durationMs: 0, isLatest: false });
    }
    if (g.newest === Number.NEGATIVE_INFINITY) g.newest = time(task.updated);
  }

  for (const g of groups.values()) {
    const first = g.items[0];
    if (first && g.task) first.isLatest = true;
  }

  return [...groups.values()].sort((a, b) => {
    if (a.task === undefined && b.task !== undefined) return 1;
    if (b.task === undefined && a.task !== undefined) return -1;
    return b.newest - a.newest;
  });
}

/** How long a session ran, in the words a row can afford. */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The number of sessions the surface lists, for the tab count and the sizing estimate. */
export function sessionCount(groups: SessionGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}
