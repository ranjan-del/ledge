import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_DIR,
  ARCHIVED_NEW,
  ARCHIVED_NEW_FILE,
  ARCHIVED_OLD,
  ARCHIVED_OLD_FILE,
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
  remove: vi.fn(async (p: string) => {
    if (!disk.files.has(p)) throw new Error(`ENOENT ${p}`);
    disk.files.delete(p);
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

import { readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import {
  WATCH_DEBOUNCE_MS,
  addTask,
  attentionRepos,
  backlogTasks,
  boot,
  currentTasks,
  desk,
  doneCount,
  doneTasks,
  doneToday,
  invalidateArchive,
  loadArchive,
  markDone,
  mergeConfig,
  removeTask,
  reorderTasks,
  select,
  setSurface,
  setView,
  shiftStatus,
  shutdown,
  todayPlan,
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

/* The parsed archive is module state and `boot` does not clear it, so a test that cares what
   is in the archive has to ask for it to be read again rather than trusting the last test. */
async function readArchive(): Promise<void> {
  invalidateArchive();
  await loadArchive();
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
    disk.dirs.add(ARCHIVE_DIR);
    disk.files.set(ARCHIVED_OLD_FILE, ARCHIVED_OLD);
    disk.files.set(ARCHIVED_NEW_FILE, ARCHIVED_NEW);
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
    expect(disk.state.watchArgs?.paths).toEqual([TASKS_DIR, ARCHIVE_DIR, LEDGE_HOME]);
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
    /* Two were already in archive/ from the fixtures, so the new one makes three. */
    expect(desk.archivedCount).toBe(3);
  });

  it('runs the periodic scan on the configured interval', async () => {
    const calls = disk.state.gitCalls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(disk.state.gitCalls.length).toBe(calls + 1);
  });

  it('adds a task from a title alone and writes a real file', async () => {
    const created = await addTask({ title: 'Write the release notes' });
    expect(created.id).toBe('write-the-release-notes');
    const expected = `${TASKS_DIR}/${created.created.slice(0, 10)}-write-the-release-notes.md`;
    expect(created.file).toBe(expected);
    const written = disk.files.get(created.file) as string;
    expect(written).toContain('title: Write the release notes');
    expect(written).toContain('status: current');
    expect(written).toContain('## Requirement');
    expect(written).toContain('## Checklist');
    expect(written).not.toContain('repo:');
    expect(written).not.toContain('planned:');
    expect(currentTasks().map((t) => t.id)).toContain('write-the-release-notes');
  });

  it('puts a new task at the end of Current, so it cannot displace the top one', async () => {
    await addTask({ title: 'Second thing' });
    await addTask({ title: 'Third thing' });
    expect(currentTasks().map((t) => t.order)).toEqual([1, 2, 3]);
    expect(currentTasks()[0].id).toBe('release-watch-banner');
  });

  it('renumbers a reordered list in one pass, writing only the files that moved', async () => {
    await addTask({ title: 'Second thing' });
    await addTask({ title: 'Third thing' });
    const files = currentTasks().map((t) => t.file);
    expect(currentTasks().map((t) => t.order)).toEqual([1, 2, 3]);

    const writes = (writeTextFile as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    /* The top two swap: those two files are rewritten and the third, which has not moved, is
       left alone. */
    await reorderTasks([files[1], files[0], files[2]]);
    expect(currentTasks().map((t) => t.file)).toEqual([files[1], files[0], files[2]]);
    expect(currentTasks().map((t) => t.order)).toEqual([1, 2, 3]);
    const after = (writeTextFile as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    expect(after - writes).toBe(2);
  });

  it('writes the new order into the files, so it survives a restart', async () => {
    await addTask({ title: 'Second thing' });
    const files = currentTasks().map((t) => t.file);
    await reorderTasks([files[1], files[0]]);
    expect(disk.files.get(files[1]) as string).toContain('order: 1');
    expect(disk.files.get(files[0]) as string).toContain('order: 2');
  });

  it('touches nothing at all when the order it was handed is the order already on disk', async () => {
    const files = currentTasks().map((t) => t.file);
    const writes = (writeTextFile as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await reorderTasks(files);
    expect((writeTextFile as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(
      writes,
    );
  });

  it('writes the repo and the planned day when the more fields are used', async () => {
    const created = await addTask({
      title: 'Ship the banner',
      repo: '~/code/app',
      planned: '2026-09-18',
    });
    expect(created.repo).toBe(`${HOME}/code/app`);
    expect(created.planned).toBe('2026-09-18');
    const written = disk.files.get(created.file) as string;
    expect(written).toContain('repo: ~/code/app');
    expect(written).toContain('planned: 2026-09-18');
  });

  it('ignores a planned value that is not a calendar day rather than writing it', async () => {
    const created = await addTask({ title: 'Vague', planned: 'sometime' });
    expect(created.planned).toBeUndefined();
    expect(disk.files.get(created.file) as string).not.toContain('planned:');
  });

  it('refuses a blank title and does not touch the disk', async () => {
    const before = disk.files.size;
    await expect(addTask({ title: '   ' })).rejects.toThrow(/needs a title/);
    expect(disk.files.size).toBe(before);
  });

  it('never reuses an id, so two tasks with one title stay two files', async () => {
    const first = await addTask({ title: 'Same title' });
    const second = await addTask({ title: 'Same title' });
    expect(first.id).toBe('same-title');
    expect(second.id).toBe('same-title-2');
    expect(first.file).not.toBe(second.file);
  });

  it('sorts today by priority and overdue oldest first, since core keeps input order', () => {
    const base = currentTasks()[0];
    desk.tasks = [
      { ...base, id: 'c', file: 'c.md', order: 3, planned: '2026-09-18' },
      { ...base, id: 'old', file: 'old.md', order: 9, planned: '2026-09-01' },
      { ...base, id: 'a', file: 'a.md', order: 1, planned: '2026-09-18' },
      { ...base, id: 'newer', file: 'newer.md', order: 2, planned: '2026-09-15' },
      { ...base, id: 'none', file: 'none.md', order: 4, planned: undefined },
      { ...base, id: 'done', file: 'done.md', order: 5, planned: '2026-09-02', status: 'done' },
    ];
    const { today, overdue } = todayPlan('2026-09-18');
    expect(today.map((t) => t.id)).toEqual(['a', 'c']);
    expect(overdue.map((t) => t.id)).toEqual(['old', 'newer']);
  });

  it('reports what is planned for a day, including a task added for today', async () => {
    const created = await addTask({ title: 'Due today', planned: '2026-09-18' });
    const { today, overdue } = todayPlan('2026-09-18');
    expect(today.map((t) => t.id)).toEqual([created.id]);
    expect(overdue).toEqual([]);
    expect(todayPlan('2026-09-20').overdue.map((t) => t.id)).toEqual([created.id]);
  });

  it('deletes a task and its file for good, and closes it if it was open', async () => {
    select(TASK_A_FILE);
    expect(desk.selectedFile).toBe(TASK_A_FILE);
    await removeTask('release-watch-banner');
    expect(disk.files.has(TASK_A_FILE)).toBe(false);
    expect(desk.tasks.map((t) => t.id)).toEqual(['optimistic-crud']);
    expect(desk.selectedFile).toBeNull();
    /* Deleted, not archived: nothing moved and the done count did not move either. */
    expect(disk.files.has(`${LEDGE_HOME}/archive/2026-09-14-release-watch-banner.md`)).toBe(false);
    expect(desk.archivedCount).toBe(2);
  });

  it('shrugs at an id it does not know rather than throwing', async () => {
    const before = disk.files.size;
    await removeTask('never-existed');
    expect(disk.files.size).toBe(before);
    expect(desk.tasks).toHaveLength(2);
  });

  it('can delete a task it just added', async () => {
    const created = await addTask({ title: 'Junk from a stray keypress' });
    expect(disk.files.has(created.file)).toBe(true);
    await removeTask(created.id);
    expect(disk.files.has(created.file)).toBe(false);
    expect(desk.tasks.map((t) => t.id)).not.toContain(created.id);
  });

  it('adds straight to the backlog when asked, numbering within that list', async () => {
    const created = await addTask({ title: 'Wait for the design', status: 'backlog' });
    expect(created.status).toBe('backlog');
    expect(created.order).toBe(2);
    expect(disk.files.get(created.file) as string).toContain('status: backlog');
    expect(backlogTasks().map((t) => t.id)).toEqual(['wait-for-the-design', 'optimistic-crud']);
    expect(currentTasks().map((t) => t.id)).toEqual(['release-watch-banner']);
  });

  it('counts only repos with uncommitted or unpushed work as needing attention', () => {
    expect(desk.pending.map((p) => p.repo)).toEqual([`${HOME}/code/app`]);
    expect(attentionRepos()).toHaveLength(1);
    desk.pending = [{ ...desk.pending[0], ahead: 0, dirty: [] }];
    expect(attentionRepos()).toHaveLength(0);
  });

  it('counts the archive at boot but does not read a single file in it', () => {
    expect(desk.archivedCount).toBe(2);
    expect(desk.archive).toEqual([]);
    expect(desk.archiveReady).toBe(false);
    expect(readsOf(ARCHIVED_NEW_FILE)).toBe(0);
    expect(readsOf(ARCHIVED_OLD_FILE)).toBe(0);
    /* The count is enough to label the Done button before anything is parsed. */
    expect(doneCount()).toBe(2);
  });

  it('reads the archive on the first switch to Done, newest first, then caches it', async () => {
    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(desk.archiveReady).toBe(true);
    expect(doneTasks().map((t) => t.id)).toEqual(['shipped-last', 'shipped-first']);
    expect(doneTasks()[0].status).toBe('done');
    const reads = readsOf(ARCHIVED_NEW_FILE);

    /* Switching away and back must not touch the disk again. */
    setView('live');
    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(readsOf(ARCHIVED_NEW_FILE)).toBe(reads);
  });

  it('a watcher event on the archive re-reads it while Done is the view on screen', async () => {
    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    const reads = readsOf(ARCHIVED_NEW_FILE);

    fire([ARCHIVED_NEW_FILE]);
    await settle();
    expect(readsOf(ARCHIVED_NEW_FILE)).toBe(reads + 1);
    expect(desk.archiveReady).toBe(true);
  });

  it('leaves the re-read until the next switch when Done is not the view on screen', async () => {
    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    const reads = readsOf(ARCHIVED_NEW_FILE);
    setView('live');

    fire([ARCHIVE_DIR]);
    await settle();
    expect(desk.archiveReady).toBe(false);
    expect(readsOf(ARCHIVED_NEW_FILE)).toBe(reads);

    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(readsOf(ARCHIVED_NEW_FILE)).toBe(reads + 1);
    expect(doneTasks()).toHaveLength(2);
  });

  it('leaves a task file alone when the change was in the archive, not in tasks/', async () => {
    const before = readsOf(TASK_A_FILE);
    fire([ARCHIVED_OLD_FILE]);
    await settle();
    expect(readsOf(TASK_A_FILE)).toBe(before);
  });

  it('marking a task done puts it in the Done list without waiting for the watcher', async () => {
    setView('done');
    await vi.advanceTimersByTimeAsync(0);
    await markDone(backlogTasks()[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(doneTasks().map((t) => t.id)).toContain('optimistic-crud');
    expect(doneCount()).toBe(3);
  });

  it('keeps the task view when the surface changes, and drops the open task either way', () => {
    setView('done');
    select(TASK_A_FILE);
    setSurface('memory');
    expect(desk.view).toBe('done');
    expect(desk.selectedFile).toBeNull();
  });

  /*
   * A task marked done disappeared in live use: the status write landed and the move into
   * archive/ did not, so the file sat in tasks/ saying `status: done` while Current and Backlog
   * filtered it out by status and Done only ever read the archive folder. It belonged to no
   * list at all, and the owner had to be told where their work went.
   *
   * These hold the two halves of the fix together: the move can fail without anything becoming
   * invisible, and the number on the Done button is the number of rows behind it.
   */
  it('keeps a task visible in Done when the move into the archive fails', async () => {
    const task = currentTasks()[0];
    (rename as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
      'Operation not permitted (os error 1)',
    );
    await markDone(task);
    await readArchive();
    /* The status landed, and the file is still where it was. */
    expect(disk.files.get(TASK_A_FILE)).toContain('status: done');
    expect(doneTasks().map((t) => t.id)).toContain('release-watch-banner');
    /* And it is out of the lists it is no longer in. */
    expect(currentTasks().map((t) => t.id)).not.toContain('release-watch-banner');
    expect(backlogTasks().map((t) => t.id)).not.toContain('release-watch-banner');
  });

  it('says out loud that the file did not move, naming both paths and the reason', async () => {
    (rename as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
      'Operation not permitted (os error 1)',
    );
    await markDone(currentTasks()[0]);
    expect(desk.error).toContain(TASK_A_FILE);
    expect(desk.error).toContain(`${LEDGE_HOME}/archive/`);
    expect(desk.error).toContain('Operation not permitted');
  });

  it('shows a done task that is still in the tasks folder, whatever put it there', async () => {
    /* A file somebody else marked done, or a move that failed in an earlier session. */
    disk.files.set(TASK_B_FILE, TASK_B.replace('status: backlog', 'status: done'));
    fire([TASK_B_FILE]);
    await settle();
    await readArchive();
    expect(doneTasks().map((t) => t.id)).toContain('optimistic-crud');
    expect(backlogTasks()).toHaveLength(0);
  });

  it('counts on the Done button exactly what the Done view lists', async () => {
    await readArchive();
    expect(doneCount()).toBe(doneTasks().length);
    (rename as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
      'Operation not permitted (os error 1)',
    );
    await markDone(currentTasks()[0]);
    expect(doneCount()).toBe(doneTasks().length);
    /* And after one that works, still exactly. */
    await markDone(backlogTasks()[0]);
    await readArchive();
    expect(doneCount()).toBe(doneTasks().length);
  });

  it('counts a task finished today whose file has not moved yet', async () => {
    (rename as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
      'Operation not permitted (os error 1)',
    );
    await markDone(currentTasks()[0]);
    await readArchive();
    const today = new Date().toISOString().slice(0, 10);
    expect(doneToday(today)).toBe(1);
  });

  it('counts an archived task once, not twice, while both copies are known', async () => {
    await readArchive();
    const before = doneCount();
    await markDone(currentTasks()[0]);
    await readArchive();
    expect(doneCount()).toBe(before + 1);
    expect(doneTasks().filter((t) => t.id === 'release-watch-banner')).toHaveLength(1);
  });

  /*
   * The status move behind the sideways drag. It writes through the same three functions the
   * buttons use rather than editing frontmatter, which is the whole reason it exists: a task
   * moved by a gesture has to end up in exactly the state the button would have left it in.
   */
  it('parks a live task dragged into the backlog, with a reason on it', async () => {
    await shiftStatus(currentTasks()[0], 'backlog');
    const written = disk.files.get(TASK_A_FILE) as string;
    expect(written).toContain('status: backlog');
    expect(written).toContain('parked: Moved to the backlog from the panel');
    /* Nothing else in the file moved: the unknown-free parts are all still there. */
    expect(written).toContain('repo: ~/code/app');
    expect(written).toContain('- [x] Design agreed: version.json polling, banner, idle reload');
    expect(backlogTasks().map((t) => t.id)).toContain('release-watch-banner');
  });

  it('starts a parked task dragged into live at the top, and clears the reason', async () => {
    await shiftStatus(backlogTasks()[0], 'current');
    const written = disk.files.get(TASK_B_FILE) as string;
    expect(written).toContain('status: current');
    expect(written).not.toContain('parked:');
    expect(currentTasks().map((t) => t.id)).toEqual(['optimistic-crud', 'release-watch-banner']);
  });

  it('archives a task dragged into done, the same as the button does', async () => {
    await shiftStatus(currentTasks()[0], 'done');
    const archived = `${LEDGE_HOME}/archive/2026-09-14-release-watch-banner.md`;
    expect(rename).toHaveBeenCalledWith(TASK_A_FILE, archived);
    expect(disk.files.get(archived)).toContain('status: done');
    expect(desk.tasks.map((t) => t.id)).not.toContain('release-watch-banner');
  });

  it('writes nothing when the task is dropped on the list it is already in', async () => {
    const before = disk.files.get(TASK_A_FILE);
    await shiftStatus(currentTasks()[0], 'current');
    expect(disk.files.get(TASK_A_FILE)).toBe(before);
  });
});
