import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { addTask, coreKind, initHome, removeHome, run } from './helpers.ts';

interface TaskJson {
  id: string;
  title: string;
  status: string;
  order: number;
  repo?: string;
  sessions: string[];
  parked?: string;
  checklist: { text: string; done: boolean }[];
  file: string;
}

interface DeskJson {
  current: TaskJson[];
  backlog: TaskJson[];
  pending: { repo: string; task?: { id: string; title: string } }[];
}

async function desk(): Promise<DeskJson> {
  return JSON.parse((await run(['--json'])).stdout) as DeskJson;
}

interface RepoSpec {
  branch: string;
  upstream: boolean;
  ahead: number;
  dirty: number;
}

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  });
}

/**
 * Builds a throwaway git repo matching the spec: branch name, optional upstream (a bare repo),
 * commits ahead of it and untracked files. Under the fake core the same spec is mirrored into
 * LEDGE_FAKE_SCAN, so one test exercises both cores.
 */
function makeRepo(spec: RepoSpec, parent = mkdtempSync(join(tmpdir(), 'ledge-cli-repo-'))): string {
  tempDirs.push(parent);
  const dir = parent;
  git(dir, 'init', '-q', '-b', spec.branch);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  if (spec.upstream) {
    const bare = mkdtempSync(join(tmpdir(), 'ledge-cli-remote-'));
    tempDirs.push(bare);
    git(bare, 'init', '-q', '--bare');
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', '-u', 'origin', spec.branch);
  }
  for (let i = 0; i < spec.ahead; i++) git(dir, 'commit', '-q', '--allow-empty', '-m', `c${i}`);
  for (let i = 0; i < spec.dirty; i++) writeFileSync(join(dir, `scratch${i}.txt`), 'wip\n');
  return dir;
}

/** Points the fake core's scan at the repos just built; a no-op under the real core. */
function mirrorScan(repos: { dir: string; spec: RepoSpec }[]): void {
  if (coreKind !== 'fake') return;
  process.env.LEDGE_FAKE_SCAN = JSON.stringify(repos.map(({ dir, spec }) => ({
    repo: dir,
    branch: spec.branch,
    upstream: spec.upstream ? `origin/${spec.branch}` : undefined,
    ahead: spec.ahead,
    behind: 0,
    dirty: Array.from({ length: spec.dirty }, (_, i) => ({ path: `scratch${i}.txt`, code: '??' })),
    lastActivity: new Date().toISOString(),
  })));
}

/** Sets scan roots in the temp home's config.json (read by the real core). */
function setRoots(roots: string[]): void {
  const configPath = join(home, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { roots: string[] };
  config.roots = roots;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let home: string;
beforeEach(async () => {
  home = await initHome();
  delete process.env.LEDGE_FAKE_SCAN;
});
afterEach(() => {
  removeHome(home);
  for (const dir of tempDirs.splice(0)) removeHome(dir);
});

describe('init', () => {
  test('creates the store layout and reports a second run', async () => {
    assert.ok(existsSync(join(home, 'tasks')));
    assert.ok(existsSync(join(home, 'archive')));
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    assert.ok(Array.isArray(config.roots));
    const again = await run(['init']);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /already exists/);
    const asJson = await run(['init', '--json']);
    assert.deepEqual(JSON.parse(asJson.stdout), { home, created: false });
  });

  test('uses a temp home, never ~/.ledge', () => {
    assert.ok(!home.endsWith('/.ledge'));
    assert.match(home, /ledge-cli-test-/);
  });
});

describe('add', () => {
  test('creates a current task by default and prints id and file', async () => {
    const r = await run(['add', 'Release watch banner']);
    assert.equal(r.code, 0);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines[0], 'Added current task release-watch-banner');
    assert.match(lines[1], /^ {2}.*release-watch-banner\.md$/);
  });

  test('--backlog and --repo are honoured', async () => {
    const r = await run(['add', 'Optimistic CRUD', '--backlog', '--repo', 'apps/admin'], '/work');
    assert.equal(r.code, 0);
    const task = (await desk()).backlog.find((t) => t.id === 'optimistic-crud');
    assert.ok(task);
    assert.equal(task.status, 'backlog');
    assert.equal(task.repo, '/work/apps/admin');
  });

  test('--json prints the task and a missing title exits 1', async () => {
    const r = await run(['add', 'As JSON', '--json']);
    assert.equal((JSON.parse(r.stdout) as TaskJson).title, 'As JSON');
    const bad = await run(['add']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /add needs a title/);
    assert.match(bad.stderr, /Usage: ledge add/);
  });
});

describe('list', () => {
  test('bare ledge prints the three sections with aligned columns', async () => {
    await addTask('First task', '--repo', '/repos/a');
    await addTask('Second task');
    await addTask('Parked one', '--backlog');
    await run(['park', 'parked-one', 'Waiting for design']);
    const r = await run([]);
    assert.equal(r.code, 0);
    const lines = r.stdout.split('\n');
    assert.equal(lines[0], 'Current');
    assert.ok(lines.includes('Backlog'));
    assert.ok(lines.includes('Pending'));
    assert.match(r.stdout, /Waiting for design/);
    assert.match(r.stdout, /Pending\n {2}\(none\)/);
    const first = lines.find((l) => l.includes('First task')) ?? '';
    const second = lines.find((l) => l.includes('Second task')) ?? '';
    assert.ok(first && second);
    assert.equal(first.indexOf('First task'), second.indexOf('Second task'), 'titles aligned');
    assert.equal(first.indexOf('/repos/a'), second.trimEnd().length + 2, 'repo column follows');
    assert.doesNotMatch(r.stdout, /\x1b\[/);
  });

  test('--json prints current, backlog and pending arrays', async () => {
    await addTask('One');
    const d = await desk();
    assert.ok(d.current.some((t) => t.id === 'one'));
    assert.ok(Array.isArray(d.backlog));
    assert.deepEqual(d.pending, []);
  });

  test('pending rows show branch state and the matching task title', async () => {
    const banner = { branch: 'feat/banner', upstream: true, ahead: 2, dirty: 1 };
    const clean = { branch: 'main', upstream: true, ahead: 0, dirty: 0 };
    const orphan = { branch: 'wip', upstream: false, ahead: 0, dirty: 0 };
    const repos = [banner, clean, orphan].map((spec) => ({ dir: makeRepo(spec), spec }));
    const [bannerDir, cleanDir, orphanDir] = repos.map((r) => r.dir);
    setRoots(repos.map((r) => r.dir));
    mirrorScan(repos);
    await addTask('Banner work', '--repo', bannerDir);
    const r = await run([]);
    assert.equal(r.code, 0);
    const pending = r.stdout.slice(r.stdout.indexOf('Pending'));
    assert.match(pending, new RegExp(
      `${escapeRe(bannerDir)} +feat/banner +ahead 2 +1 dirty +Banner work`));
    assert.match(pending, new RegExp(`${escapeRe(orphanDir)} +wip \\(no upstream\\)`));
    assert.doesNotMatch(pending, new RegExp(escapeRe(cleanDir)));
    const d = await desk();
    assert.deepEqual(d.pending.map((p) => p.repo).sort(), [bannerDir, orphanDir].sort());
    const labelled = d.pending.find((p) => p.repo === bannerDir);
    assert.deepEqual(labelled?.task, { id: 'banner-work', title: 'Banner work' });
    assert.equal(d.pending.find((p) => p.repo === orphanDir)?.task, undefined);
  });
});

describe('start, park, done', () => {
  test('start moves a backlog task to current at order 1', async () => {
    await addTask('Existing current');
    await addTask('Later', '--backlog');
    const before = new Map((await desk()).current.map((t) => [t.id, t.order]));
    const r = await run(['start', 'later']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'Started later: Later\n');
    const after = (await desk()).current;
    assert.deepEqual([after[0].id, after[0].order], ['later', 1]);
    assert.deepEqual(after.map((t) => t.order), after.map((_, i) => i + 1), 'orders are 1..n');
    for (const [id, order] of before) {
      assert.equal(after.find((t) => t.id === id)?.order, order + 1, `${id} shifted down`);
    }
    assert.ok(before.has('existing-current'));
  });

  test('park records the reason and needs one', async () => {
    await addTask('Parkable');
    const r = await run(['park', 'parkable', 'Blocked on review']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'Parked parkable: Blocked on review\n');
    const parked = (await desk()).backlog.find((t) => t.id === 'parkable');
    assert.equal(parked?.parked, 'Blocked on review');
    const missing = await run(['park', 'parkable']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /needs a reason/);
  });

  test('done moves the task out of the lists into the archive', async () => {
    await addTask('Finish me');
    const r = await run(['done', 'finish-me', '--json']);
    assert.equal(r.code, 0);
    const task = JSON.parse(r.stdout) as TaskJson;
    assert.equal(task.status, 'done');
    assert.match(task.file, /\/archive\//);
    assert.ok(!(await desk()).current.some((t) => t.id === 'finish-me'));
    const gone = await run(['done', 'never-existed']);
    assert.equal(gone.code, 2);
    assert.match(gone.stderr, /Task not found: never-existed/);
  });

  test('unknown id exits 2, missing id exits 1', async () => {
    assert.equal((await run(['start', 'nope'])).code, 2);
    assert.equal((await run(['start'])).code, 1);
    assert.equal((await run(['done'])).code, 1);
  });
});

describe('current', () => {
  test('matches the deepest repo and renders Markdown', async () => {
    await addTask('Outer', '--repo', '/repos/outer');
    await addTask('Inner', '--repo', '/repos/outer/inner');
    await run(['todo', 'inner', 'Write the thing']);
    const r = await run(['current', '--repo', '/repos/outer/inner/src']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^# Inner\n/);
    assert.match(r.stdout, /- \[ \] Write the thing/);
    const outer = await run(['current'], '/repos/outer/docs');
    assert.match(outer.stdout, /^# Outer\n/);
  });

  test('--json prints the task and --context prints the hook block', async () => {
    await addTask('Ctx task', '--repo', '/repos/ctx');
    await run(['todo', 'ctx-task', 'Open item']);
    await run(['todo', 'ctx-task', 'Done item']);
    await run(['tick', 'ctx-task', '2']);
    const json = await run(['current', '--repo', '/repos/ctx', '--json']);
    assert.equal((JSON.parse(json.stdout) as TaskJson).id, 'ctx-task');
    const ctx = await run(['current', '--repo', '/repos/ctx', '--context']);
    assert.equal(ctx.code, 0);
    assert.match(ctx.stdout, /Ctx task/);
    assert.match(ctx.stdout, /Open item/);
    assert.doesNotMatch(ctx.stdout, /Done item/);
    assert.ok(ctx.stdout.split('\n').length <= 41);
  });

  test('--context never exceeds 40 lines', async () => {
    await addTask('Long task', '--repo', '/repos/long');
    for (let i = 1; i <= 60; i++) await run(['todo', 'long-task', `Item ${i}`]);
    const r = await run(['current', '--repo', '/repos/long', '--context']);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 40);
    assert.match(lines[39], /more lines/);
  });

  test('no match exits 2 and --json with --context exits 1', async () => {
    const r = await run(['current', '--repo', '/nowhere']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No current task for \/nowhere/);
    const ctx = await run(['current', '--repo', '/nowhere', '--context']);
    assert.equal(ctx.code, 2);
    assert.equal(ctx.stdout, '', 'nothing on stdout for the hook to inject');
    const both = await run(['current', '--json', '--context']);
    assert.equal(both.code, 1);
  });
});

describe('link, todo, tick, untick, open', () => {
  test('link appends a session id once', async () => {
    await addTask('Linked');
    assert.equal((await run(['link', 'linked', 'abc123'])).stdout, 'Linked abc123 to linked\n');
    await run(['link', 'linked', 'abc123']);
    const r = await run(['link', 'linked', 'def456', '--json']);
    assert.deepEqual((JSON.parse(r.stdout) as TaskJson).sessions, ['abc123', 'def456']);
    assert.equal((await run(['link', 'linked'])).code, 1);
    assert.equal((await run(['link', 'ghost', 'x'])).code, 2);
  });

  test('todo appends unchecked items', async () => {
    await addTask('Checks');
    const added = await run(['todo', 'checks', 'First step']);
    assert.equal(added.code, 0);
    assert.equal(added.stdout, 'Added item 1 to checks: First step\n');
    const second = await run(['todo', 'checks', 'Second step', '--json']);
    const task = JSON.parse(second.stdout) as TaskJson;
    assert.deepEqual(task.checklist, [
      { text: 'First step', done: false },
      { text: 'Second step', done: false },
    ]);
    assert.equal((await run(['todo', 'checks'])).code, 1);
    assert.equal((await run(['todo', 'nobody', 'x'])).code, 2);
  });

  test('tick and untick use 1-based item numbers', async () => {
    await addTask('Checks');
    await run(['todo', 'checks', 'First step']);
    await run(['todo', 'checks', 'Second step']);
    const ticked = await run(['tick', 'checks', '2']);
    assert.equal(ticked.code, 0);
    assert.equal(ticked.stdout, 'Ticked checks item 2: Second step\n');
    let task = JSON.parse((await run(['tick', 'checks', '2', '--json'])).stdout) as TaskJson;
    assert.deepEqual(task.checklist.map((c) => c.done), [false, true]);
    const unticked = await run(['untick', 'checks', '2']);
    assert.equal(unticked.stdout, 'Unticked checks item 2: Second step\n');
    task = JSON.parse((await run(['untick', 'checks', '1', '--json'])).stdout) as TaskJson;
    assert.deepEqual(task.checklist.map((c) => c.done), [false, false]);
    assert.equal((await run(['tick', 'checks', '9'])).code, 2);
    assert.equal((await run(['untick', 'checks', '9'])).code, 2);
    assert.equal((await run(['tick', 'checks', 'two'])).code, 1);
    assert.equal((await run(['tick', 'checks', '0'])).code, 1);
    assert.equal((await run(['untick', 'checks'])).code, 1);
  });

  test('open prints only the task file path', async () => {
    await addTask('Openable');
    const r = await run(['open', 'openable']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.ok(r.stdout.trim().startsWith(join(home, 'tasks')));
    assert.match(r.stdout, /-openable\.md\n$/);
    assert.equal((await run(['open', 'missing'])).code, 2);
    assert.equal((await run(['open'])).code, 1);
  });
});

describe('scan', () => {
  test('prints pending repos as JSON', async () => {
    const r = await run(['scan']);
    assert.equal(r.code, 0);
    assert.ok(Array.isArray(JSON.parse(r.stdout)));
  });

  test('labels a pending repo with the deepest task that contains it', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'ledge-cli-root-'));
    tempDirs.push(parent);
    const spec = { branch: 'main', upstream: true, ahead: 1, dirty: 0 };
    const sub = join(parent, 'sub');
    mkdirSync(sub);
    makeRepo(spec, sub);
    setRoots([parent]);
    mirrorScan([{ dir: sub, spec }]);
    await addTask('Scan task', '--repo', parent);
    const rows = JSON.parse((await run(['scan'])).stdout) as DeskJson['pending'];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].repo, sub);
    assert.equal(rows[0].task?.id, 'scan-task');
  });
});
