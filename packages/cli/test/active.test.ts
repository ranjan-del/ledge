// `ledge active` end to end: the ranking, the evidence next to it, and the two cases the panel
// gets wrong today, which are a task with no repository and a task nobody has touched.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { claudeProjectDirName } from '@ledge/core';
import { addTask, initHome, removeHome, run } from './helpers.ts';

interface ActiveJson {
  now: string;
  reference: string | null;
  active: { id: string; title: string } | null;
  thresholds: { halfLifeMs: number; horizonMs: number; activeWindowMs: number };
  ranked: {
    rank: number;
    id: string;
    order: number;
    score: number;
    reason: string;
    signals: { kind: string; at: string; age: string; counted: boolean; detail: string }[];
  }[];
  sharedRepos: { repo: string; taskIds: string[] }[];
}

function taskFileFor(home: string, id: string): string {
  const dir = join(home, 'tasks');
  const name = execFileSync('ls', [dir], { encoding: 'utf8' })
    .split('\n')
    .find((entry) => entry.includes(id));
  assert.ok(name, `no task file for ${id}`);
  return join(dir, name);
}

/** Backdates a task: its `updated` frontmatter and its file mtime, so it has no live signal. */
function backdate(home: string, id: string, hoursAgo: number): void {
  const file = taskFileFor(home, id);
  const when = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const offset = -when.getTimezoneOffset();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const zone =
    `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}` +
    `:${pad(Math.abs(offset) % 60)}`;
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}${zone}`;
  const text = readFileSync(file, 'utf8').replace(/^updated: .*$/m, `updated: ${stamp}`);
  writeFileSync(file, text);
  utimesSync(file, when, when);
}

async function activeJson(): Promise<ActiveJson> {
  const result = await run(['active', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as ActiveJson;
}

describe('ledge active', () => {
  let home: string;
  beforeEach(async () => {
    home = await initHome();
  });
  afterEach(() => removeHome(home));

  test('ranks current tasks and prints the evidence for each one', async () => {
    await addTask('paperwork');
    const result = await run(['active']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Active \d{4}-\d{2}-\d{2}T/);
    assert.match(result.stdout, /Ranked by activity/);
    assert.match(result.stdout, /Evidence/);
    assert.match(result.stdout, /the task file, last saved by Ledge/);
    assert.match(result.stdout, /halve every 1h 30m/, 'the rules behind the order are printed');
    assert.match(result.stdout, /no status is read, set or suggested here/);
    assert.doesNotMatch(result.stdout, /\u2014/);
  });

  test('a task with no repository still ranks, on its task file alone', async () => {
    await addTask('deploy ios to the app store');
    backdate(home, 'try-ledge', 30);
    const json = await activeJson();
    assert.equal(json.ranked[0]!.id, 'deploy-ios-to-the-app-store');
    assert.deepEqual(
      json.ranked[0]!.signals.map((signal) => signal.kind),
      ['taskfile'],
      'a task with no repo has exactly one kind of evidence, and it is enough to rank it',
    );
    assert.match(json.ranked[0]!.reason, /^active now, the task file/);
    assert.equal(json.active?.id, 'deploy-ios-to-the-app-store');
  });

  test('a task nobody has touched keeps its manual order instead of sinking', async () => {
    const quiet = await addTask('quiet one');
    const alsoQuiet = await addTask('quiet two');
    const warm = await addTask('warm one');
    backdate(home, 'try-ledge', 30);
    backdate(home, quiet, 30);
    backdate(home, alsoQuiet, 30);
    const json = await activeJson();
    assert.equal(json.ranked[0]!.id, warm, 'the one with live evidence comes first');
    assert.deepEqual(
      json.ranked.slice(1).map((row) => row.id),
      ['try-ledge', quiet, alsoQuiet],
      'the quiet ones keep the order the person gave them, in their own sequence',
    );
    for (const row of json.ranked.slice(1)) {
      assert.equal(row.score, 0, 'no live signal means no score');
      assert.match(row.reason, /no signal in the last 12h, keeping your order/);
      assert.deepEqual(
        row.signals.map((signal) => signal.counted),
        row.signals.map(() => false),
        'the stale signal is still shown, marked as not counted',
      );
    }
  });

  test('a session transcript in the task repo is read, named and ranked above a task file',
    async () => {
      const repo = join(home, 'repo');
      mkdirSync(repo, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
      const transcripts = join(home, '.claude', 'projects', claudeProjectDirName(repo));
      mkdirSync(transcripts, { recursive: true });
      writeFileSync(join(transcripts, 'live.jsonl'), '{"type":"user"}\n');
      const withRepo = await addTask('repo work', '--repo', repo);
      const previousHome = process.env.HOME;
      process.env.HOME = home;
      try {
        const json = await activeJson();
        assert.equal(json.ranked[0]!.id, withRepo);
        const session = json.ranked[0]!.signals.find((signal) => signal.kind === 'session');
        assert.ok(session, 'the transcript folder for the repo was found');
        assert.match(session.detail, /^a Claude Code session in /);
        assert.match(json.ranked[0]!.reason, /^active now, a Claude Code session in /);
      } finally {
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
      }
    });

  test('two tasks on one repository are reported as inseparable rather than ranked apart',
    async () => {
      const repo = join(home, 'shared');
      mkdirSync(repo, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
      writeFileSync(join(repo, 'a.txt'), 'x\n');
      execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'pipe' });
      const first = await addTask('first on shared', '--repo', repo);
      const second = await addTask('second on shared', '--repo', repo);
      const json = await activeJson();
      assert.deepEqual(json.sharedRepos, [{ repo, taskIds: [first, second] }]);
      const text = await run(['active']);
      assert.match(text.stdout, /Shared repositories/);
      assert.match(text.stdout, /cannot say which/);
    });

  test('--json carries the thresholds so a reader can check the ordering by hand', async () => {
    const json = await activeJson();
    assert.equal(json.thresholds.halfLifeMs, 90 * 60 * 1000);
    assert.equal(json.thresholds.horizonMs, 12 * 60 * 60 * 1000);
    assert.equal(json.thresholds.activeWindowMs, 15 * 60 * 1000);
    assert.ok(json.reference, 'the moment the ages were measured from is reported');
  });

  test('active leaves every task file exactly as it found it', async () => {
    const id = await addTask('do not touch me');
    const file = taskFileFor(home, id);
    const before = readFileSync(file, 'utf8');
    await run(['active']);
    assert.equal(readFileSync(file, 'utf8'), before, 'a read-only command wrote nothing');
    const desk = JSON.parse((await run(['--json'])).stdout) as {
      current: { id: string; order: number; status: string }[];
    };
    const touched = desk.current.find((task) => task.id === id)!;
    assert.equal(touched.status, 'current', 'and changed no status');
    assert.equal(touched.order, 2, 'and renumbered nothing');
  });
});
