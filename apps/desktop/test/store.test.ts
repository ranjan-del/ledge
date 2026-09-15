import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROKEN_TASK,
  CONFIG_PATH,
  HOME,
  LEDGE_HOME,
  PORCELAIN,
  TASKS_DIR,
  TASK_A,
  TASK_A_FILE,
  TASK_A_RENAMED,
  TASK_B,
  TASK_B_FILE,
} from './fixtures.ts';

/* In-memory disk shared with the mocked fs plugin. */
const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const state: {
    watchCb: ((e: { type: unknown; paths: string[]; attrs: unknown }) => void) | null;
    watchArgs: { paths: unknown; opts: unknown } | null;
    gitCalls: string[][];
  } = { watchCb: null, watchArgs: null, gitCalls: [] };
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'));
  const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  return { files, dirs, state, parent, name };
});

vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => `${'/home/t'}/`) }));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (p: string) => {
    if (!disk.files.has(p)) throw new Error(`ENOENT ${p}`);
    return disk.files.get(p) as string;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    disk.files.set(p, c);
  }),
  readDir: vi.fn(async (p: string) => {
    const files = [...disk.files.keys()]
      .filter((f) => disk.parent(f) === p)
      .map((f) => ({ name: disk.name(f), isFile: true, isDirectory: false, isSymlink: false }));
    const dirs = [...disk.dirs]
      .filter((d) => disk.parent(d) === p)
      .map((d) => ({ name: disk.name(d), isFile: false, isDirectory: true, isSymlink: false }));
    return [...dirs, ...files];
  }),
  exists: vi.fn(async (p: string) => disk.files.has(p) || disk.dirs.has(p)),
  mkdir: vi.fn(async (p: string) => {
    disk.dirs.add(p);
  }),
  rename: vi.fn(async (a: string, b: string) => {
    disk.files.set(b, disk.files.get(a) as string);
    disk.files.delete(a);
  }),
  stat: vi.fn(async () => ({ mtime: new Date() })),
  watch: vi.fn(async (paths: unknown, cb: (e: never) => void, opts: unknown) => {
    disk.state.watchCb = cb as typeof disk.state.watchCb;
    disk.state.watchArgs = { paths, opts };
    return () => {
      disk.state.watchCb = null;
    };
  }),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn((program: string, args: string[]) => ({
      execute: async () => {
        disk.state.gitCalls.push([program, ...args]);
        return { code: 0, signal: null, stdout: PORCELAIN, stderr: '' };
      },
    })),
  },
}));

import { readTextFile, rename } from '@tauri-apps/plugin-fs';
import {
  WATCH_DEBOUNCE_MS,
  backlogTasks,
  boot,
  currentTasks,
  desk,
  markDone,
  mergeConfig,
  shutdown,
  toggleChecklist,
} from '../src/lib/store.svelte.ts';

const readsOf = (file: string) =>
  (readTextFile as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === file)
    .length;

function fire(paths: string[]) {
  disk.state.watchCb?.({ type: 'any', paths, attrs: {} });
}

async function settle() {
  await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
}

describe('store', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    disk.files.clear();
    disk.dirs.clear();
    disk.state.watchCb = null;
    disk.state.watchArgs = null;
    disk.state.gitCalls = [];
    disk.dirs.add(LEDGE_HOME);
    disk.dirs.add(TASKS_DIR);
    disk.dirs.add(`${HOME}/code`);
    disk.dirs.add(`${HOME}/code/app`);
    disk.files.set(`${HOME}/code/app/.git`, '');
    disk.files.set(TASK_A_FILE, TASK_A);
    disk.files.set(TASK_B_FILE, TASK_B);
    disk.files.set(CONFIG_PATH, JSON.stringify({ scan: { intervalMinutes: 5 } }));
    await boot();
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    shutdown();
    vi.useRealTimers();
  });

  it('boots from $HOME/.ledge, parses tasks, expands ~ in repo, and watches with a 150 ms delay', () => {
    expect(desk.home).toBe(HOME);
    expect(desk.tasksDir).toBe(TASKS_DIR);
    expect(desk.ready).toBe(true);
    expect(currentTasks().map((t) => t.id)).toEqual(['release-watch-banner']);
    expect(backlogTasks().map((t) => t.id)).toEqual(['optimistic-crud']);
    expect(currentTasks()[0].repo).toBe(`${HOME}/code/app`);
    expect(disk.state.watchArgs?.paths).toEqual([TASKS_DIR, LEDGE_HOME]);
    expect(disk.state.watchArgs?.opts).toMatchObject({ delayMs: 150 });
  });

  it('scans discovered and referenced repos through git status porcelain v2', () => {
    expect(disk.state.gitCalls).toEqual([
      ['git', '-C', `${HOME}/code/app`, 'status', '--porcelain=v2', '--branch'],
    ]);
    expect(desk.pending).toHaveLength(1);
    expect(desk.pending[0].branch).toBe('feature/banner');
    expect(desk.pending[0].ahead).toBe(2);
    expect(desk.pending[0].dirty).toHaveLength(2);
    expect(disk.files.has(`${LEDGE_HOME}/.scan-cache.json`)).toBe(true);
  });

  it('coalesces a burst of watch events and re-parses only the changed file once', async () => {
    const before = readsOf(TASK_A_FILE);
    const beforeB = readsOf(TASK_B_FILE);
    disk.files.set(TASK_A_FILE, TASK_A_RENAMED);
    fire([TASK_A_FILE]);
    await vi.advanceTimersByTimeAsync(50);
    fire([TASK_A_FILE]);
    await vi.advanceTimersByTimeAsync(50);
    fire([TASK_A_FILE]);
    expect(readsOf(TASK_A_FILE)).toBe(before);
    expect(currentTasks()[0].title).toBe('Release watch banner for stale tabs');
    await settle();
    expect(readsOf(TASK_A_FILE)).toBe(before + 1);
    expect(readsOf(TASK_B_FILE)).toBe(beforeB);
    expect(currentTasks()[0].title).toBe('Release watch banner v2');
  });

  it('removes a task whose file disappeared', async () => {
    disk.files.delete(TASK_B_FILE);
    fire([TASK_B_FILE]);
    await settle();
    expect(backlogTasks()).toHaveLength(0);
    expect(desk.tasks).toHaveLength(1);
  });

  it('keeps the desk alive and reports a malformed file instead of crashing', async () => {
    const broken = `${TASKS_DIR}/2026-09-15-broken.md`;
    disk.files.set(broken, BROKEN_TASK);
    fire([broken]);
    await settle();
    expect(desk.tasks).toHaveLength(2);
    expect(desk.broken).toHaveLength(1);
    expect(desk.broken[0].file).toBe(broken);
    expect(desk.broken[0].error.length).toBeGreaterThan(0);
  });

  it('reloads config.json when it changes and ignores unrelated files in the home folder', async () => {
    disk.files.set(CONFIG_PATH, JSON.stringify({ scan: { intervalMinutes: 9 }, ui: { theme: 'dark' } }));
    disk.files.set(`${LEDGE_HOME}/.scan-cache.json`, '{}');
    const before = readsOf(TASK_A_FILE);
    fire([CONFIG_PATH, `${LEDGE_HOME}/.scan-cache.json`]);
    await settle();
    expect(desk.config.scan.intervalMinutes).toBe(9);
    expect(desk.config.scan.maxDepth).toBe(4);
    expect(desk.config.ui.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(readsOf(TASK_A_FILE)).toBe(before);
  });

  it('deep-merges partial config over defaults', () => {
    const merged = mergeConfig({ roots: ['~/work'], claude: { command: 'cc' } });
    expect(merged.roots).toEqual(['~/work']);
    expect(merged.claude).toEqual({ command: 'cc', resumeFlag: '--resume' });
    expect(merged.scan.intervalMinutes).toBe(5);
  });

  it('toggling a checklist item writes the serialized file and updates the desk', async () => {
    const task = currentTasks()[0];
    await toggleChecklist(task, 2, true);
    const written = disk.files.get(TASK_A_FILE) as string;
    expect(written).toContain('- [x] Build step that writes version.json');
    expect(written).toContain('repo: ~/code/app');
    expect(currentTasks()[0].checklist[2].done).toBe(true);
    expect(currentTasks()[0].updated).not.toBe(task.updated);
  });

  it('marking done writes status done and moves the file into archive/', async () => {
    const task = backlogTasks()[0];
    await markDone(task);
    expect(rename).toHaveBeenCalledWith(TASK_B_FILE, `${LEDGE_HOME}/archive/2026-09-14-optimistic-crud.md`);
    expect(disk.files.get(`${LEDGE_HOME}/archive/2026-09-14-optimistic-crud.md`)).toContain('status: done');
    expect(desk.tasks).toHaveLength(1);
    expect(desk.archivedCount).toBe(1);
  });

  it('runs the periodic scan on the configured interval', async () => {
    const calls = disk.state.gitCalls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(disk.state.gitCalls.length).toBe(calls + 1);
  });
});
