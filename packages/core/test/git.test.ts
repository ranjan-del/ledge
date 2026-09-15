import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  existsSync,
  symlinkSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parsePorcelainV2,
  findRepos,
  scanRepos,
  isPending,
  defaultConfig,
} from '../src/index.ts';
import type { RepoStatus } from '../src/index.ts';

// Recorded from `git status --porcelain=v2 --branch` on a repo with staged, unstaged,
// added, deleted, renamed, unmerged, untracked and ignored paths.
const fixture = readFileSync(
  join(import.meta.dirname, 'fixtures', 'porcelain-v2.txt'),
  'utf8',
);

test('parsePorcelainV2 reads branch headers, ahead/behind and XY codes', () => {
  const s = parsePorcelainV2(fixture, '/srv/repo', '2026-09-01T00:00:00+00:00');
  assert.equal(s.repo, '/srv/repo');
  assert.equal(s.branch, 'feature/release-watch');
  assert.equal(s.upstream, 'origin/feature/release-watch');
  assert.equal(s.ahead, 3);
  assert.equal(s.behind, 1);
  assert.equal(s.lastActivity, '2026-09-01T00:00:00+00:00');
  assert.deepEqual(s.dirty, [
    { path: 'src/app.ts', code: '.M' },
    { path: 'README.md', code: 'M.' },
    { path: 'docs/new file.md', code: 'A.' },
    { path: 'old.txt', code: '.D' },
    { path: 'src/renamed.ts', code: 'R.' },
    { path: 'conflict.ts', code: 'UU' },
    { path: 'notes.txt', code: '??' },
  ]);
});

test('parsePorcelainV2 handles no upstream, initial commit and detached head', () => {
  const fresh = parsePorcelainV2(
    '# branch.oid (initial)\n# branch.head main\n',
    '/srv/fresh',
    '2026-09-01T00:00:00+00:00',
  );
  assert.equal(fresh.branch, 'main');
  assert.equal(fresh.upstream, undefined);
  assert.equal(fresh.ahead, 0);
  assert.equal(fresh.behind, 0);
  assert.deepEqual(fresh.dirty, []);

  const detached = parsePorcelainV2(
    '# branch.oid abc\n# branch.head (detached)\n',
    '/srv/d',
    '2026-09-01T00:00:00+00:00',
  );
  assert.equal(detached.branch, '(detached)');
});

function status(over: Partial<RepoStatus>): RepoStatus {
  return {
    repo: '/srv/r',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    dirty: [],
    lastActivity: '2026-09-01T00:00:00+00:00',
    ...over,
  };
}

test('isPending: dirty, ahead, or unpushed non-main branch', () => {
  assert.equal(isPending(status({})), false);
  assert.equal(isPending(status({ behind: 4 })), false, 'behind alone is not pending');
  assert.equal(isPending(status({ dirty: [{ path: 'a', code: '??' }] })), true);
  assert.equal(isPending(status({ ahead: 1 })), true);
  assert.equal(isPending(status({ branch: 'feature/x', upstream: undefined })), true);
  assert.equal(isPending(status({ branch: 'main', upstream: undefined })), false);
  assert.equal(isPending(status({ branch: 'master', upstream: undefined })), false);
  assert.equal(isPending(status({ branch: '(detached)', upstream: undefined })), false);
});

test('findRepos respects maxDepth and ignore, and does not descend into repos', () => {
  const root = mkdtempSync(join(tmpdir(), 'ledge-find-'));
  const mk = (...p: string[]) => mkdirSync(join(root, ...p), { recursive: true });
  mk('a', '.git');
  mk('a', 'nested', '.git');
  mk('b', 'c', '.git');
  mk('b', 'c2', 'd', '.git');
  mk('node_modules', 'pkg', '.git');
  mk('deep', '1', '2', '3', '.git');
  writeFileSync(join(root, 'b', 'c2', 'd', '.git', 'HEAD'), 'ref: refs/heads/main\n');

  const found = findRepos([root], 2, ['node_modules']);
  assert.deepEqual(found, [join(root, 'a'), join(root, 'b', 'c')], 'depth 3 is beyond maxDepth 2');

  const shallow = findRepos([root], 1, ['node_modules']);
  assert.deepEqual(shallow, [join(root, 'a')]);

  const deep = findRepos([root], 4, ['node_modules']);
  assert.ok(deep.includes(join(root, 'b', 'c2', 'd')), '.git as a file (worktree) counts');
  assert.ok(deep.includes(join(root, 'deep', '1', '2', '3')));
  assert.ok(!deep.some((r) => r.includes('node_modules')));
  assert.ok(!deep.includes(join(root, 'a', 'nested')), 'nested repo inside a repo is skipped');

  assert.deepEqual(findRepos([join(root, 'missing')], 2, []), [], 'missing roots are skipped');
  assert.deepEqual(findRepos([join(root, 'a')], 2, []), [join(root, 'a')], 'root can be a repo');
});

test('findRepos expands tilde and ignores symlinked dirs', () => {
  const root = mkdtempSync(join(tmpdir(), 'ledge-find-'));
  mkdirSync(join(root, 'real', '.git'), { recursive: true });
  symlinkSync(join(root, 'real'), join(root, 'link'));
  const found = findRepos([root], 2, []);
  assert.deepEqual(found, [join(root, 'real')]);
  assert.equal(findRepos(['~/definitely-not-a-ledge-root-xyz'], 1, []).length, 0);
});

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('scanRepos runs git status on discovered repos and honours staleDays', {
  skip: hasGit() ? false : 'git is not installed',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ledge-scan-'));
  const active = join(root, 'active');
  const stale = join(root, 'stale');
  const outside = mkdtempSync(join(tmpdir(), 'ledge-outside-'));
  for (const dir of [active, stale, outside]) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    execFileSync('git', ['-C', dir, 'add', 'a.txt']);
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  }
  writeFileSync(join(active, 'b.txt'), 'dirty\n');
  execFileSync('git', ['-C', stale, 'checkout', '-q', '-b', 'feature/old']);
  assert.ok(existsSync(join(stale, '.git', 'index')));
  const old = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  utimesSync(join(stale, '.git', 'index'), old, old);

  const config = defaultConfig();
  config.roots = [root];
  config.scan.staleDays = 30;

  const results = await scanRepos(config);
  const repos = results.map((r) => r.repo).sort();
  assert.deepEqual(repos, [active], 'stale repo skipped');
  const a = results.find((r) => r.repo === active)!;
  assert.equal(a.branch, 'main');
  assert.equal(a.upstream, undefined);
  assert.deepEqual(a.dirty, [{ path: 'b.txt', code: '??' }]);
  assert.match(a.lastActivity, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(isPending(a), true);

  const withRef = await scanRepos(config, { referenced: [stale, outside] });
  const refRepos = withRef.map((r) => r.repo).sort();
  assert.deepEqual(refRepos, [active, outside, stale].sort(), 'referenced repos always included');
  const s = withRef.find((r) => r.repo === stale)!;
  assert.equal(s.branch, 'feature/old');
  assert.equal(isPending(s), true, 'non-main branch without upstream is pending');
  const o = withRef.find((r) => r.repo === outside)!;
  assert.equal(isPending(o), false);

  const many = Array.from({ length: 6 }, (_, i) => join(root, `r${i}`));
  for (const dir of many) {
    mkdirSync(dir);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  }
  // git status refreshes .git/index, so re-age the stale repo before scanning again.
  utimesSync(join(stale, '.git', 'index'), old, old);
  const all = await scanRepos(config);
  assert.equal(all.length, 7, 'six empty repos plus the active one; no commits is fine');
  assert.ok(all.every((r) => r.branch === 'main'));
});
