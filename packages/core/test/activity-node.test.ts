// Signal gathering against a real filesystem: a temporary home with a fake session transcript
// folder, a real git repository and real task files. Nothing here reads the machine's own
// ~/.claude or ~/.ledge, and nothing is written outside the temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectDirName, collectActivity } from '../src/index.ts';
import type { Task, TaskActivity } from '../src/index.ts';

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ledge-activity-'));
  homes.push(home);
  return home;
}

test.after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function at(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60 * 1000);
}

function touch(path: string, when: Date): void {
  utimesSync(path, when, when);
}

function iso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'demo',
    title: 'Demo',
    status: 'current',
    order: 1,
    sessions: [],
    created: iso(at(600)),
    updated: iso(at(600)),
    requirement: '',
    plan: [],
    checklist: [],
    notes: [],
    extra: '',
    file: '',
    ...over,
  };
}

/** Writes a task file inside `home` and returns the task pointing at it. */
function taskFile(home: string, over: Partial<Task> = {}, mtime = at(600)): Task {
  const dir = join(home, 'tasks');
  mkdirSync(dir, { recursive: true });
  const built = task(over);
  const file = join(dir, `${built.id}.md`);
  writeFileSync(file, '# task\n');
  touch(file, mtime);
  return { ...built, file };
}

/** A transcript folder for `folder`, with one .jsonl file stamped at `when`. */
function transcript(home: string, folder: string, when: Date, name = 'session.jsonl'): string {
  const dir = join(home, '.claude', 'projects', claudeProjectDirName(folder));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '{"type":"user"}\n');
  touch(file, when);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  });
}

/** A repository with the given tracked files, each stamped at its own time. */
function repoWith(home: string, files: Record<string, Date>): string {
  const dir = join(home, 'repo');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  for (const [name, when] of Object.entries(files)) {
    const file = join(dir, name);
    writeFileSync(file, 'code\n');
    git(dir, 'add', name);
    touch(file, when);
  }
  return dir;
}

function kinds(entry: TaskActivity): string[] {
  return entry.signals.map((signal) => signal.kind);
}

function detailOf(entry: TaskActivity, kind: string): string {
  return entry.signals.find((signal) => signal.kind === kind)?.detail ?? '';
}

test('a task with a repository collects a session, a worktree and a task file signal', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(40) });
  transcript(home, repo, at(3));
  const subject = taskFile(home, { id: 'with-repo', repo }, at(600));
  const [entry] = await collectActivity([subject], { home });
  assert.deepEqual(kinds(entry!), ['session', 'worktree', 'taskfile']);
  assert.match(detailOf(entry!, 'session'), /^a Claude Code session in /);
  assert.match(detailOf(entry!, 'worktree'), /the newest tracked file in .*main\.ts/);
  assert.equal(
    entry!.lastActive,
    entry!.signals.find((signal) => signal.kind === 'session')!.at,
    'lastActive is the newest of the signals, which here is the session',
  );
});

test('a session in a folder inside the repo counts, and says it was a folder inside', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(300) });
  transcript(home, join(repo, 'apps', 'android'), at(6));
  const subject = taskFile(home, { id: 'nested', repo }, at(600));
  const [entry] = await collectActivity([subject], { home });
  const detail = detailOf(entry!, 'session');
  assert.match(detail, /a Claude Code session in a folder inside /);
  assert.match(detail, /projects\/-/, 'the encoded folder is named, since it cannot be decoded');
});

test('a subagent transcript counts, so a delegating session is not read as idle', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(300) });
  const dir = transcript(home, repo, at(45), 'parent.jsonl');
  const nested = join(dir, 'parent-session', 'subagents');
  mkdirSync(nested, { recursive: true });
  const child = join(nested, 'agent-1.jsonl');
  writeFileSync(child, '{"type":"user"}\n');
  touch(child, at(2));
  const subject = taskFile(home, { id: 'delegating', repo }, at(600));
  const [entry] = await collectActivity([subject], { home });
  const session = entry!.signals.find((signal) => signal.kind === 'session')!;
  assert.ok(
    Date.now() - Date.parse(session.at) < 10 * 60 * 1000,
    'the newest transcript anywhere in the folder is the reading, not the top-level one',
  );
});

test('a task with no repository gets its task file signal and nothing else', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(5) });
  transcript(home, repo, at(1));
  const subject = taskFile(home, { id: 'ios-deploy' }, at(600));
  const [entry] = await collectActivity([subject], { home });
  assert.deepEqual(kinds(entry!), ['taskfile'], 'no repo means no folder evidence, only the file');
  assert.equal(entry!.lastActive, subject.updated);
});

test('the task file signal uses the file mtime when that is newer than `updated`', async () => {
  const home = freshHome();
  const recorded = at(300);
  const touchedLater = at(4);
  const subject = taskFile(home, { id: 'edited-by-hand', updated: iso(recorded) }, touchedLater);
  const [entry] = await collectActivity([subject], { home });
  assert.equal(
    detailOf(entry!, 'taskfile'),
    'the task file, changed on disk after the update time it records',
  );
  assert.ok(
    Date.parse(entry!.signals[0]!.at) > Date.parse(subject.updated),
    'the newer of the two times is the one reported',
  );

  const quiet = taskFile(home, { id: 'saved-by-ledge', updated: iso(recorded) }, recorded);
  const [second] = await collectActivity([quiet], { home });
  assert.equal(detailOf(second!, 'taskfile'), 'the task file, last saved by Ledge');
  assert.equal(second!.signals[0]!.at, quiet.updated);
});

test('an untracked file does not make a repository look warm', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(240) });
  const junk = join(repo, 'build.log');
  writeFileSync(junk, 'noise\n');
  touch(junk, at(1));
  const subject = taskFile(home, { id: 'untracked', repo }, at(600));
  const [entry] = await collectActivity([subject], { home });
  const worktree = entry!.signals.find((signal) => signal.kind === 'worktree')!;
  assert.match(worktree.detail, /main\.ts/, 'the newest tracked file, not the newest file');
  assert.ok(Date.now() - Date.parse(worktree.at) > 60 * 60 * 1000);
});

test('the tracked file scan says when it only looked at part of a big repository', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'a.ts': at(100), 'b.ts': at(90), 'c.ts': at(80) });
  const subject = taskFile(home, { id: 'capped', repo }, at(600));
  const [entry] = await collectActivity([subject], { home, maxTrackedFiles: 2 });
  assert.match(detailOf(entry!, 'worktree'), /of the first 2 tracked files/);
});

test('a missing repo, a folder that is not one and a missing home read as silence', async () => {
  const home = freshHome();
  const gone = taskFile(home, { id: 'gone', repo: join(home, 'not-here') }, at(600));
  const plain = join(home, 'plain');
  mkdirSync(plain, { recursive: true });
  const notARepo = taskFile(home, { id: 'plain', repo: plain }, at(600));
  const entries = await collectActivity([gone, notARepo], { home: join(home, 'no-such-home') });
  assert.deepEqual(kinds(entries[0]!), ['taskfile']);
  assert.deepEqual(kinds(entries[1]!), ['taskfile']);
});

test('two tasks naming one repository get identical folder evidence', async () => {
  const home = freshHome();
  const repo = repoWith(home, { 'main.ts': at(30) });
  transcript(home, repo, at(2));
  const one = taskFile(home, { id: 'one', repo }, at(600));
  const two = taskFile(home, { id: 'two', repo }, at(600));
  const entries = await collectActivity([one, two], { home });
  assert.equal(detailOf(entries[0]!, 'session'), detailOf(entries[1]!, 'session'));
  assert.equal(detailOf(entries[0]!, 'worktree'), detailOf(entries[1]!, 'worktree'));
  assert.deepEqual(entries.map((entry) => entry.taskId), ['one', 'two'], 'order follows tasks');
});

test('an unsaved task with no file and no repo produces the recorded update only', async () => {
  const home = freshHome();
  const subject = task({ id: 'unsaved' });
  const [entry] = await collectActivity([subject], { home });
  assert.deepEqual(kinds(entry!), ['taskfile']);
  assert.equal(entry!.signals[0]!.at, subject.updated);
});
