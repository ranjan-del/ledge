import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryFor,
  nextActionFor,
  searchMemory,
  sessionsFor,
  surfaceCounts,
} from '../src/index.ts';
import type { Task } from '../src/index.ts';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'demo',
    title: 'Demo',
    status: 'current',
    order: 1,
    sessions: [],
    created: '2026-09-15T09:00:00+05:30',
    updated: '2026-09-15T09:00:00+05:30',
    requirement: 'Something must be true.',
    plan: [],
    checklist: [],
    notes: [],
    references: '',
    extra: '',
    file: '',
    ...over,
  };
}

test('sessionsFor turns session ids into rows, newest id of a task marked latest', () => {
  const tasks = [
    task({
      id: 'banner',
      title: 'Release watch banner',
      repo: '/repos/admin',
      sessions: ['aaa', 'bbb'],
      updated: '2026-09-15T21:00:00+05:30',
    }),
  ];
  const refs = sessionsFor(tasks);
  assert.deepEqual(
    refs.map((ref) => [ref.id, ref.isLatest]),
    [
      ['bbb', true],
      ['aaa', false],
    ],
    'newest id of a task comes first and is the only latest one',
  );
  assert.deepEqual(refs[0], {
    id: 'bbb',
    taskId: 'banner',
    taskTitle: 'Release watch banner',
    repo: '/repos/admin',
    lastSeen: '2026-09-15T21:00:00+05:30',
    isLatest: true,
  });
  assert.equal(refs[1]!.lastSeen, '2026-09-15T21:00:00+05:30', 'older ids carry the same bound');
  assert.equal(refs[0]!.repo, '/repos/admin');
});

test('sessionsFor sorts across tasks by lastSeen, newest first', () => {
  const tasks = [
    task({ id: 'old', sessions: ['one'], updated: '2026-09-10T09:00:00+05:30' }),
    task({ id: 'new', sessions: ['two', 'three'], updated: '2026-09-16T09:00:00+05:30' }),
    task({ id: 'middle', sessions: ['four'], updated: '2026-09-12T09:00:00+05:30' }),
  ];
  assert.deepEqual(
    sessionsFor(tasks).map((ref) => ref.id),
    ['three', 'two', 'four', 'one'],
  );
});

test('sessionsFor omits tasks with no sessions, blank ids and repeats of an id', () => {
  const tasks = [
    task({ id: 'quiet', sessions: [] }),
    task({ id: 'noisy', sessions: ['  ', 'dupe', 'dupe', ''] }),
  ];
  assert.deepEqual(
    sessionsFor(tasks).map((ref) => [ref.taskId, ref.id]),
    [['noisy', 'dupe']],
  );
  assert.equal(sessionsFor([]).length, 0);
  assert.equal(sessionsFor(tasks)[0]!.repo, undefined, 'a task with no repo leaves repo unset');
});

test('sessionsFor keeps the same id once per task when two tasks share it', () => {
  const tasks = [
    task({ id: 'left', title: 'Left', sessions: ['shared'], updated: '2026-09-16T10:00:00+05:30' }),
    task({
      id: 'right',
      title: 'Right',
      sessions: ['shared'],
      updated: '2026-09-15T10:00:00+05:30',
    }),
  ];
  assert.deepEqual(
    sessionsFor(tasks).map((ref) => [ref.id, ref.taskId, ref.isLatest]),
    [
      ['shared', 'left', true],
      ['shared', 'right', true],
    ],
  );
});

test('memoryFor flattens every dated note, newest date first', () => {
  const tasks = [
    task({
      id: 'banner',
      title: 'Release watch banner',
      repo: '/repos/admin',
      notes: [
        { date: '2026-09-12', body: 'Older reasoning.' },
        { date: '2026-09-15', body: 'Chose polling over a service worker.' },
      ],
    }),
    task({
      id: 'parity',
      title: 'Login parity',
      notes: [{ date: '2026-09-14', body: 'The OTP contract is shared.' }],
    }),
  ];
  const entries = memoryFor(tasks);
  assert.deepEqual(
    entries.map((entry) => [entry.date, entry.taskId]),
    [
      ['2026-09-15', 'banner'],
      ['2026-09-14', 'parity'],
      ['2026-09-12', 'banner'],
    ],
  );
  assert.deepEqual(entries[0], {
    taskId: 'banner',
    taskTitle: 'Release watch banner',
    repo: '/repos/admin',
    date: '2026-09-15',
    body: 'Chose polling over a service worker.',
  });
  assert.equal(entries[1]!.repo, undefined, 'a task with no repo leaves repo unset');
  assert.deepEqual(memoryFor([]), []);
  assert.deepEqual(memoryFor([task()]), [], 'a task with no notes contributes nothing');
});

test('memoryFor keeps two notes of the same day in task input order', () => {
  const tasks = [
    task({ id: 'first', notes: [{ date: '2026-09-15', body: 'One.' }] }),
    task({ id: 'second', notes: [{ date: '2026-09-15', body: 'Two.' }] }),
  ];
  assert.deepEqual(
    memoryFor(tasks).map((entry) => entry.taskId),
    ['first', 'second'],
  );
});

test('searchMemory needs every term, in the body or the title, ignoring case', () => {
  const entries = memoryFor([
    task({
      id: 'banner',
      title: 'Release watch banner',
      notes: [{ date: '2026-09-15', body: 'Chose polling over a SERVICE worker.' }],
    }),
    task({
      id: 'parity',
      title: 'Login parity',
      notes: [{ date: '2026-09-14', body: 'The OTP contract is shared.' }],
    }),
  ]);
  assert.deepEqual(
    searchMemory(entries, 'polling').map((e) => e.taskId),
    ['banner'],
  );
  assert.deepEqual(
    searchMemory(entries, 'service WORKER').map((e) => e.taskId),
    ['banner'],
    'terms may be in any case and any order',
  );
  assert.deepEqual(
    searchMemory(entries, 'banner chose').map((e) => e.taskId),
    ['banner'],
    'one term may match the title and another the body',
  );
  assert.deepEqual(searchMemory(entries, 'polling otp'), [], 'every term has to match');
  assert.deepEqual(searchMemory(entries, 'zzz'), []);
});

test('searchMemory returns input order and treats a blank query as no filter', () => {
  const entries = memoryFor([
    task({ id: 'a', notes: [{ date: '2026-09-15', body: 'Alpha note.' }] }),
    task({ id: 'b', notes: [{ date: '2026-09-14', body: 'Alpha again.' }] }),
  ]);
  assert.deepEqual(
    searchMemory(entries, 'alpha').map((e) => e.taskId),
    ['a', 'b'],
    'no ranking, the input order survives',
  );
  assert.deepEqual(searchMemory(entries, '   '), entries);
  assert.deepEqual(searchMemory(entries, ''), entries);
});

test('nextActionFor prefers the first unticked checklist item', () => {
  const withList = task({
    checklist: [
      { text: 'Investigated the deploy', done: true },
      { text: 'Write version.json', done: false },
      { text: 'Poll on focus', done: false },
    ],
    plan: ['Plan step'],
  });
  assert.deepEqual(nextActionFor(withList), { text: 'Write version.json', source: 'checklist' });
});

test('nextActionFor falls back to the first plan step only when there is no checklist', () => {
  const planned = task({ plan: ['Write version.json', 'Poll on focus'] });
  assert.deepEqual(nextActionFor(planned), { text: 'Write version.json', source: 'plan' });
  const allTicked = task({
    checklist: [{ text: 'Done already', done: true }],
    plan: ['Write version.json'],
  });
  assert.equal(nextActionFor(allTicked), undefined, 'a finished checklist is not a next action');
});

test('nextActionFor returns undefined rather than inventing text', () => {
  assert.equal(nextActionFor(task()), undefined);
  assert.equal(nextActionFor(task({ requirement: 'A long requirement.' })), undefined);
});

test('surfaceCounts counts current tasks, latest sessions, all tasks and all notes', () => {
  const tasks = [
    task({
      id: 'banner',
      status: 'current',
      sessions: ['aaa', 'bbb'],
      notes: [
        { date: '2026-09-12', body: 'One.' },
        { date: '2026-09-15', body: 'Two.' },
      ],
    }),
    task({ id: 'parity', status: 'backlog', sessions: ['ccc'], notes: [] }),
    task({
      id: 'shipped',
      status: 'done',
      sessions: [],
      notes: [{ date: '2026-09-11', body: '.' }],
    }),
  ];
  assert.deepEqual(surfaceCounts(tasks), { now: 1, sessions: 2, tasks: 3, memory: 3 });
  assert.deepEqual(surfaceCounts([]), { now: 0, sessions: 0, tasks: 0, memory: 0 });
});

test('surfaceCounts counts one session id shared by two tasks once', () => {
  const tasks = [
    task({ id: 'left', sessions: ['shared'] }),
    task({ id: 'right', sessions: ['old', 'shared'] }),
  ];
  assert.equal(surfaceCounts(tasks).sessions, 1, 'distinct latest ids, not rows');
});
