import type { Task } from '@ledge/core/pure';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGE_HOME, repoStatus, taskA, taskC } from './fixtures.ts';

/* An in-memory store folder. Only the three calls news.svelte.ts makes are needed. */
const disk = vi.hoisted(() => new Map<string, string>());

vi.mock('../src/lib/io.ts', () => ({
  pathExists: vi.fn(async (p: string) => disk.has(p)),
  readText: vi.fn(async (p: string) => {
    if (!disk.has(p)) throw new Error(`ENOENT ${p}`);
    return disk.get(p) as string;
  }),
  writeText: vi.fn(async (p: string, c: string) => {
    disk.set(p, c);
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => '/home/t/') }));

import {
  dismiss,
  dismissAll,
  markAwaySeen,
  markRead,
  news,
  resetNews,
  setCentreOpen,
  sync,
  unread,
} from '../src/lib/news.svelte.ts';
import { desk } from '../src/lib/store.svelte.ts';

const FILE = `${LEDGE_HOME}/.news.json`;
const DAY = '2026-09-15';
const T0 = Date.parse('2026-09-15T09:00:00+05:30');

function put(tasks: Task[], repos = [repoStatus()], archived = 0) {
  desk.tasks = tasks;
  desk.pending = repos;
  desk.archivedCount = archived;
}

function ticked(task: Task): Task {
  return { ...task, checklist: task.checklist.map((item) => ({ ...item, done: true })) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  disk.clear();
  resetNews();
  desk.ready = true;
  desk.ledgeHome = LEDGE_HOME;
  put([taskA(), taskC()]);
});

afterEach(() => {
  vi.useRealTimers();
  desk.ready = false;
  desk.tasks = [];
  desk.pending = [];
});

describe('the first look at a store', () => {
  it('says nothing at all, and records what it saw', async () => {
    await sync(true, DAY);
    expect(news.items).toEqual([]);
    expect(news.away).toBeUndefined();
    const written = JSON.parse(disk.get(FILE) as string);
    expect(Object.keys(written.last.tasks)).toHaveLength(2);
    expect(written.seen.at).toBeTruthy();
  });

  it('does nothing before the store has finished booting', async () => {
    desk.ready = false;
    await sync(true, DAY);
    expect(disk.has(FILE)).toBe(false);
  });
});

describe('noticing a change', () => {
  it('announces it once, and not again on the next look', async () => {
    await sync(true, DAY);
    put([ticked(taskA()), taskC()]);
    await sync(true, DAY);
    expect(news.items.map((i) => i.kind)).toEqual(['checklist-complete']);
    expect(unread()).toBe(1);

    await sync(true, DAY);
    expect(news.items).toHaveLength(1);
  });

  it('does not fire again on the next launch, because the file remembers', async () => {
    await sync(true, DAY);
    put([ticked(taskA()), taskC()]);
    await sync(true, DAY);
    expect(news.items).toHaveLength(1);

    /* A new launch: nothing in memory, the same store folder, the same files on disk. */
    resetNews();
    await sync(true, DAY);
    expect(news.items).toEqual([]);
  });

  it('notices while the panel is hidden, so the centre is worth opening when you return', async () => {
    await sync(false, DAY);
    put([taskA(), taskC()], [repoStatus({ dirty: [], ahead: 0 })]);
    await sync(false, DAY);
    put([taskA(), taskC()], [repoStatus({ dirty: [{ path: 'a.ts', code: 'M.' }], ahead: 0 })]);
    await sync(false, DAY);
    expect(news.items.map((i) => i.kind)).toEqual(['repo-uncommitted']);
  });
});

describe('reading and dismissing', () => {
  beforeEach(async () => {
    await sync(true, DAY);
    put([ticked(taskA()), taskC()]);
    await sync(true, DAY);
  });

  it('counts the unread, and stops counting once the centre has been opened', () => {
    expect(unread()).toBe(1);
    setCentreOpen(true);
    expect(news.open).toBe(true);
    expect(unread()).toBe(0);
    markRead();
    expect(unread()).toBe(0);
  });

  it('drops one, and drops the lot', () => {
    const id = news.items[0]?.id as string;
    dismiss(id);
    expect(news.items).toEqual([]);
    news.items = [{ ...news.items[0], id: 'a' } as never, { id: 'b' } as never];
    dismissAll();
    expect(news.items).toEqual([]);
  });
});

describe('the return to work summary', () => {
  it('is offered after a gap worked out from the store, and not before', async () => {
    await sync(true, DAY);
    /* A few minutes later, with the panel still being watched: not a return. */
    vi.setSystemTime(T0 + 4 * 60_000);
    await sync(true, DAY);
    expect(news.away).toBeUndefined();

    /* Six hours later, having been closed all afternoon. */
    vi.setSystemTime(T0 + 6 * 3600_000);
    put([ticked(taskA()), taskC()], [repoStatus({ dirty: [], ahead: 5 })], 1);
    await sync(true, DAY);
    expect(news.away).toBeDefined();
    expect(news.away?.lines.length).toBeGreaterThan(0);
    expect(news.away?.resumeTitle).toBeTruthy();
  });

  it('is not offered while the panel is hidden, since nobody is returning to anything', async () => {
    await sync(true, DAY);
    vi.setSystemTime(T0 + 6 * 3600_000);
    put([ticked(taskA()), taskC()]);
    await sync(false, DAY);
    expect(news.away).toBeUndefined();
  });

  it('does not come back for an absence it has already reported', async () => {
    await sync(true, DAY);
    vi.setSystemTime(T0 + 6 * 3600_000);
    put([ticked(taskA()), taskC()]);
    await sync(true, DAY);
    expect(news.away).toBeDefined();

    markAwaySeen();
    /* A new launch a few minutes later reads the file, and the file now says the person is up
       to date as of when they read it. */
    resetNews();
    vi.setSystemTime(T0 + 6 * 3600_000 + 5 * 60_000);
    await sync(true, DAY);
    expect(news.away).toBeUndefined();
  });

  it('reports a fresh absence, and says so plainly when nothing happened in it', async () => {
    await sync(true, DAY);
    markAwaySeen();
    resetNews();
    /* Away all afternoon, and nothing touched the store in the meantime. */
    vi.setSystemTime(T0 + 6 * 3600_000);
    await sync(true, DAY);
    expect(news.away).toBeDefined();
    expect(news.away?.lines).toEqual([]);
  });

  it('holds the baseline still until the summary has been seen', async () => {
    await sync(true, DAY);
    const first = JSON.parse(disk.get(FILE) as string).seen.at;
    vi.setSystemTime(T0 + 6 * 3600_000);
    put([ticked(taskA()), taskC()]);
    await sync(true, DAY);
    vi.setSystemTime(T0 + 7 * 3600_000);
    await sync(true, DAY);
    expect(JSON.parse(disk.get(FILE) as string).seen.at).toBe(first);
  });
});
