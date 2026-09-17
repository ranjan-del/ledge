import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendNote, isIsoDay, isoDay, plannedFor, setPlan, shiftDay } from '../src/index.ts';
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

test('isoDay formats the local calendar day and defaults to now', () => {
  assert.equal(isoDay(new Date(2026, 8, 15, 23, 45)), '2026-09-15');
  assert.equal(isoDay(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.match(isoDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test('isIsoDay accepts real days and rejects everything else', () => {
  assert.equal(isIsoDay('2026-09-15'), true);
  assert.equal(isIsoDay('2024-02-29'), true);
  assert.equal(isIsoDay('2026-02-31'), false);
  assert.equal(isIsoDay('2026-13-01'), false);
  assert.equal(isIsoDay('2026-9-15'), false);
  assert.equal(isIsoDay('2026-09-15T10:00:00+05:30'), false);
  assert.equal(isIsoDay('today'), false);
  assert.equal(isIsoDay(undefined), false);
  assert.equal(isIsoDay(20260915), false);
});

test('shiftDay crosses month and year ends', () => {
  assert.equal(shiftDay('2026-09-15', 1), '2026-09-16');
  assert.equal(shiftDay('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.throws(() => shiftDay('tomorrow', 1), RangeError);
});

test('plannedFor splits today from overdue and skips done and unplanned tasks', () => {
  const tasks = [
    task({ id: 'today-a', planned: '2026-09-15' }),
    task({ id: 'late', planned: '2026-09-12' }),
    task({ id: 'later', planned: '2026-09-20' }),
    task({ id: 'unplanned' }),
    task({ id: 'late-but-done', planned: '2026-09-01', status: 'done' }),
    task({ id: 'today-b', planned: '2026-09-15' }),
  ];
  const { today, overdue } = plannedFor(tasks, '2026-09-15');
  assert.deepEqual(today.map((t) => t.id), ['today-a', 'today-b'], 'input order is kept');
  assert.deepEqual(overdue.map((t) => t.id), ['late']);
});

test('appendNote creates today subsection, appends to it and never reorders', () => {
  const start = task({
    notes: [
      { date: '2026-09-13', body: 'Two days ago.' },
      { date: '2026-09-14', body: 'Yesterday.' },
    ],
  });
  const created = appendNote(start, '  Chose polling over a service worker.  ', '2026-09-15');
  assert.deepEqual(created.notes.map((n) => n.date), ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.equal(created.notes[2]!.body, 'Chose polling over a service worker.');
  const appended = appendNote(created, 'Chunk load errors are the safety net.', '2026-09-15');
  assert.equal(appended.notes.length, 3);
  assert.equal(
    appended.notes[2]!.body,
    'Chose polling over a service worker.\n\nChunk load errors are the safety net.',
  );
  const middle = appendNote(appended, 'Late addition.', '2026-09-13');
  assert.deepEqual(middle.notes.map((n) => n.date), ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.equal(middle.notes[0]!.body, 'Two days ago.\n\nLate addition.');
  assert.deepEqual(start.notes.map((n) => n.body), ['Two days ago.', 'Yesterday.'], 'input pure');
});

test('appendNote defaults to today and ignores blank text', () => {
  const dated = appendNote(task(), 'Something happened.');
  assert.deepEqual(dated.notes.map((n) => n.date), [isoDay()]);
  assert.deepEqual(appendNote(task(), '   ').notes, [], 'blank text adds nothing');
});

test('setPlan replaces the steps, trimming and dropping blanks', () => {
  const start = task({ plan: ['Old step'] });
  const next = setPlan(start, ['  Write version.json  ', '', 'Poll it on focus', '   ']);
  assert.deepEqual(next.plan, ['Write version.json', 'Poll it on focus']);
  assert.deepEqual(setPlan(next, []).plan, []);
  assert.deepEqual(start.plan, ['Old step'], 'input is not mutated');
});
