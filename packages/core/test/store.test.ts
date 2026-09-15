import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, matchRepo, parseTask, serializeTask } from '../src/index.ts';
import type { Task } from '../src/index.ts';

function freshStore(): TaskStore {
  const home = mkdtempSync(join(tmpdir(), 'ledge-store-'));
  process.env.LEDGE_HOME = home;
  const store = new TaskStore(home);
  store.init();
  return store;
}

test('TaskStore defaults home to LEDGE_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'ledge-store-'));
  process.env.LEDGE_HOME = home;
  assert.equal(new TaskStore().home, home);
});

test('init creates dirs, config and a sample task once', () => {
  const home = mkdtempSync(join(tmpdir(), 'ledge-store-'));
  const store = new TaskStore(home);
  const first = store.init();
  assert.equal(first.created, true);
  assert.ok(existsSync(join(home, 'config.json')));
  assert.ok(existsSync(join(home, 'tasks')));
  assert.ok(existsSync(join(home, 'archive')));
  const files = readdirSync(join(home, 'tasks'));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/);
  const sample = store.list()[0]!;
  assert.equal(sample.status, 'current');
  assert.ok(sample.checklist.length > 0);
  assert.ok(sample.requirement.length > 0);

  const second = store.init();
  assert.equal(second.created, false);
  assert.equal(readdirSync(join(home, 'tasks')).length, 1, 'no second sample task');
});

test('add writes a file named by date and slug, with unique ids', () => {
  const store = freshStore();
  const t = store.add({ title: 'Optimistic CRUD', repo: '~/code/demo' });
  assert.equal(t.id, 'optimistic-crud');
  assert.equal(t.status, 'current');
  assert.equal(t.order, 2, 'appended after the sample task');
  assert.ok(t.repo!.endsWith('/code/demo'));
  assert.ok(!t.repo!.startsWith('~'));
  assert.ok(existsSync(t.file));
  assert.match(t.file, /tasks\/\d{4}-\d{2}-\d{2}-optimistic-crud\.md$/);
  assert.match(readFileSync(t.file, 'utf8'), /^repo: ~\/code\/demo$/m);

  const dup = store.add({ title: 'Optimistic CRUD', status: 'backlog', requirement: 'Why.' });
  assert.equal(dup.id, 'optimistic-crud-2');
  assert.equal(dup.status, 'backlog');
  assert.equal(dup.order, 1);
  assert.equal(dup.requirement, 'Why.');
  assert.equal(store.list().length, 3);
  assert.equal(store.list('backlog').length, 1);
});

test('get finds tasks in tasks/ and archive/ and throws when missing', () => {
  const store = freshStore();
  const t = store.add({ title: 'Find me' });
  assert.equal(store.get('find-me').id, t.id);
  store.done('find-me');
  assert.equal(store.get('find-me').status, 'done');
  assert.throws(() => store.get('nope'), /nope/);
});

test('start puts the task at order 1 and shifts the others down', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  const b = store.add({ title: 'B', status: 'backlog' });
  store.park(a.id, 'later');
  const started = store.start(b.id);
  assert.equal(started.status, 'current');
  assert.equal(started.order, 1);
  assert.equal(started.parked, undefined);
  const current = store.list('current');
  assert.deepEqual(current.map((t) => t.order), [1, 2]);
  assert.equal(current[0]!.id, 'b');
  assert.equal(store.list('backlog').map((t) => t.id).join(','), 'a');
});

test('park records the reason, moves to backlog and closes the gap in current', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  store.add({ title: 'B' });
  const parked = store.park(a.id, 'Waiting for design');
  assert.equal(parked.status, 'backlog');
  assert.equal(parked.parked, 'Waiting for design');
  assert.deepEqual(store.list('current').map((t) => t.order), [1, 2]);
  assert.match(readFileSync(parked.file, 'utf8'), /^parked: Waiting for design$/m);
});

test('done moves the file to archive and renumbers the rest', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  store.add({ title: 'B' });
  const oldFile = a.file;
  const finished = store.done(a.id);
  assert.equal(finished.status, 'done');
  assert.equal(existsSync(oldFile), false);
  assert.match(finished.file, /\/archive\//);
  assert.ok(existsSync(finished.file));
  assert.equal(store.archived().length, 1);
  assert.equal(store.list().some((t) => t.id === a.id), false);
  assert.deepEqual(store.list('current').map((t) => t.order), [1, 2]);
});

test('start on an archived task moves it back into tasks/', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  store.done(a.id);
  const again = store.start(a.id);
  assert.match(again.file, /\/tasks\//);
  assert.equal(store.archived().length, 0);
  assert.equal(store.list('current')[0]!.id, a.id);
});

test('link appends session ids without duplicates', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  store.link(a.id, 's1');
  store.link(a.id, 's2');
  const t = store.link(a.id, 's1');
  assert.deepEqual(t.sessions, ['s1', 's2']);
  assert.deepEqual(store.get(a.id).sessions, ['s1', 's2']);
});

test('addTodo and setTodo edit the checklist and persist', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  store.addTodo(a.id, 'first');
  const t = store.addTodo(a.id, 'second');
  assert.deepEqual(t.checklist, [
    { text: 'first', done: false },
    { text: 'second', done: false },
  ]);
  const ticked = store.setTodo(a.id, 1, true);
  assert.equal(ticked.checklist[1]!.done, true);
  assert.equal(store.get(a.id).checklist[1]!.done, true);
  store.setTodo(a.id, 1, false);
  assert.equal(store.get(a.id).checklist[1]!.done, false);
  assert.throws(() => store.setTodo(a.id, 5, true), RangeError);
});

test('reorder rewrites order 1..n in the given sequence', () => {
  const store = freshStore();
  store.add({ title: 'A' });
  store.add({ title: 'B' });
  store.add({ title: 'C' });
  store.reorder('current', ['c', 'a']);
  const ids = store.list('current').map((t) => `${t.id}:${t.order}`);
  assert.equal(ids[0], 'c:1');
  assert.equal(ids[1], 'a:2');
  assert.equal(ids.length, 4);
  assert.deepEqual(
    store.list('current').map((t) => t.order),
    [1, 2, 3, 4],
  );
  assert.throws(() => store.reorder('current', ['missing']), /missing/);
});

test('list sorts by order then updated desc and ignores non-markdown files', () => {
  const store = freshStore();
  writeFileSync(join(store.home, 'tasks', 'README.txt'), 'ignore me');
  const a = store.add({ title: 'A', status: 'backlog' });
  const b = store.add({ title: 'B', status: 'backlog' });
  const older = { ...store.get(a.id), order: 1, updated: '2020-01-01T00:00:00+00:00' };
  const newer = { ...store.get(b.id), order: 1, updated: '2025-01-01T00:00:00+00:00' };
  writeFileSync(older.file, serializeTask(older));
  writeFileSync(newer.file, serializeTask(newer));
  assert.deepEqual(store.list('backlog').map((t) => t.id), ['b', 'a']);
});

test('save bumps updated and writes the file', () => {
  const store = freshStore();
  const a = store.add({ title: 'A' });
  const stale: Task = { ...a, updated: '2020-01-01T00:00:00+00:00', title: 'Renamed' };
  const saved = store.save(stale);
  assert.notEqual(saved.updated, '2020-01-01T00:00:00+00:00');
  assert.match(saved.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(parseTask(readFileSync(saved.file, 'utf8')).title, 'Renamed');
});

test('list surfaces TaskParseError with file for malformed task files', () => {
  const store = freshStore();
  const bad = join(store.home, 'tasks', '2026-01-01-bad.md');
  writeFileSync(bad, '---\nid: [\n---\n');
  assert.throws(() => store.list(), (err: unknown) => {
    assert.equal((err as { file: string }).file, bad);
    return true;
  });
});

test('currentFor picks the deepest repo match among current tasks only', () => {
  const store = freshStore();
  const root = mkdtempSync(join(tmpdir(), 'ledge-repos-'));
  const outer = join(root, 'product');
  const inner = join(outer, 'apps', 'web');
  mkdirSync(inner, { recursive: true });
  store.add({ title: 'Outer', repo: outer });
  store.add({ title: 'Inner', repo: inner });
  store.add({ title: 'Deepest but parked', repo: join(inner, 'src'), status: 'backlog' });
  assert.equal(store.currentFor(join(inner, 'src', 'lib'))?.id, 'inner');
  assert.equal(store.currentFor(inner)?.id, 'inner');
  assert.equal(store.currentFor(join(outer, 'functions'))?.id, 'outer');
  assert.equal(store.currentFor(outer)?.id, 'outer');
  assert.equal(store.currentFor(root), undefined);
  assert.equal(store.currentFor(join(root, 'productive')), undefined, 'prefix is not a match');
});

test('matchRepo ignores tasks without a repo and handles trailing slashes', () => {
  const tasks = [
    { id: 'none' },
    { id: 'a', repo: '/srv/a' },
    { id: 'ab', repo: '/srv/a/b/' },
  ];
  assert.equal(matchRepo(tasks, '/srv/a/b/c')?.id, 'ab');
  assert.equal(matchRepo(tasks, '/srv/a/')?.id, 'a');
  assert.equal(matchRepo(tasks, '/srv'), undefined);
});

test('setPlanned sets and clears the planned day and rejects a bad one', () => {
  const store = freshStore();
  const t = store.add({ title: 'Planned work' });
  assert.equal(t.planned, undefined);
  const set = store.setPlanned(t.id, '2026-09-18');
  assert.equal(set.planned, '2026-09-18');
  assert.match(readFileSync(set.file, 'utf8'), /^planned: 2026-09-18$/m);
  assert.equal(store.get(t.id).planned, '2026-09-18');
  const cleared = store.setPlanned(t.id, undefined);
  assert.equal(cleared.planned, undefined);
  assert.doesNotMatch(readFileSync(cleared.file, 'utf8'), /^planned:/m);
  assert.throws(() => store.setPlanned(t.id, 'tomorrow'), RangeError);
  assert.throws(() => store.setPlanned('nope', '2026-09-18'), /Task not found/);
});

test('addNote appends into one dated subsection and survives a reload', () => {
  const store = freshStore();
  const t = store.add({ title: 'Noted work' });
  store.addNote(t.id, 'Chose polling over a service worker.', '2026-09-15');
  const second = store.addNote(t.id, 'Chunk load errors are the safety net.', '2026-09-15');
  assert.equal(second.notes.length, 1);
  assert.equal(second.notes[0]!.date, '2026-09-15');
  const file = readFileSync(second.file, 'utf8');
  assert.match(file, /^## Notes$/m);
  assert.equal((file.match(/^### 2026-09-15$/gm) ?? []).length, 1, 'one subsection for the day');
  const later = store.addNote(t.id, 'Next day.', '2026-09-16');
  assert.deepEqual(later.notes.map((n) => n.date), ['2026-09-15', '2026-09-16']);
  assert.deepEqual(store.get(t.id).notes, later.notes, 'notes survive the round trip');
  assert.throws(() => store.addNote('nope', 'x'), /Task not found/);
});

test('setPlan replaces the steps in the file', () => {
  const store = freshStore();
  const t = store.add({ title: 'Planned steps' });
  const planned = store.setPlan(t.id, ['Write version.json', 'Poll it on focus']);
  assert.deepEqual(planned.plan, ['Write version.json', 'Poll it on focus']);
  const file = readFileSync(planned.file, 'utf8');
  assert.match(file, /^## Plan$/m);
  assert.match(file, /^1\. Write version\.json$/m);
  assert.match(file, /^2\. Poll it on focus$/m);
  assert.ok(file.indexOf('## Plan') < file.indexOf('## Checklist'), 'Plan before Checklist');
  const replaced = store.setPlan(t.id, ['One step only']);
  assert.deepEqual(replaced.plan, ['One step only']);
  assert.deepEqual(store.get(t.id).plan, ['One step only']);
  assert.deepEqual(store.setPlan(t.id, []).plan, []);
  assert.throws(() => store.setPlan('nope', ['x']), /Task not found/);
});
