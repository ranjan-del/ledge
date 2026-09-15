import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { freshHome, initHome, removeHome, run } from './helpers.ts';

const ALL_COMMANDS = ['add', 'start', 'park', 'done', 'current', 'link', 'todo', 'tick', 'untick',
  'open', 'scan', 'init'];

describe('main dispatch and exit codes', () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(() => removeHome(home));

  test('--help prints usage for every command and exits 0', async () => {
    const r = await run(['--help']);
    assert.equal(r.code, 0);
    for (const name of ALL_COMMANDS) assert.match(r.stdout, new RegExp(`ledge ${name}`));
    assert.doesNotMatch(r.stdout, /\u2014/);
  });

  test('help <command> prints that command only', async () => {
    const r = await run(['help', 'park']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: ledge park <id> "reason"/);
    assert.doesNotMatch(r.stdout, /ledge tick/);
  });

  test('--version prints the package version', async () => {
    const r = await run(['--version']);
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('unknown command exits 1 with help on stderr', async () => {
    const r = await run(['frobnicate']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown command "frobnicate"/);
    assert.match(r.stderr, /Usage:/);
    assert.equal(r.stdout, '');
  });

  test('unknown flag exits 1', async () => {
    const r = await run(['--colour']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ledge: /);
  });

  test('commands before init exit 2 with a hint', async () => {
    const r = await run(['list']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Run "ledge init" first/);
    assert.ok(r.stderr.includes(home));
  });

  test('a malformed task file exits 3 and names the file and line', async () => {
    removeHome(home);
    home = await initHome();
    const broken = join(home, 'tasks', '2026-01-01-broken.md');
    writeFileSync(broken, 'no frontmatter here\n');
    const r = await run([]);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /cannot parse task file/);
    assert.ok(r.stderr.includes(broken + ':'), 'stderr names the file with a line number');
  });
});
