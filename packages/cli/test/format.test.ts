import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Task } from '@ledge/core';
import { useFakeCore } from './fake-core/register.ts';

useFakeCore();
const format = await import('../src/format.ts');
const pending = await import('../src/pending.ts');

describe('format', () => {
  test('table pads columns and trims trailing spaces', () => {
    const out = format.table([['a', 'bb', 'c'], ['dddd', 'e', '']]);
    assert.equal(out, '  a     bb  c\n  dddd  e');
  });

  test('shortPath replaces the home prefix with ~', () => {
    assert.equal(format.shortPath('/home/u/code/x', '/home/u'), '~/code/x');
    assert.equal(format.shortPath('/home/u', '/home/u'), '~');
    assert.equal(format.shortPath('/home/user2/x', '/home/u'), '/home/user2/x');
  });

  test('truncateLines keeps the cap and notes what was dropped', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const out = format.truncateLines(text, 40).split('\n');
    assert.equal(out.length, 40);
    assert.equal(out[38], 'line 39');
    assert.match(out[39], /^\.\.\. 11 more lines/);
    assert.equal(format.truncateLines('short', 40), 'short');
  });

  test('section prints (none) for empty rows', () => {
    assert.equal(format.section('Pending', []), 'Pending\n  (none)');
  });

  test('latestNote prefers the given day and falls back to the newest entry', () => {
    const notes = [
      { date: '2026-09-13', body: 'older' },
      { date: '2026-09-14', body: 'newer' },
    ];
    const task = { notes } as unknown as Task;
    assert.equal(format.latestNote(task, '2026-09-13')?.body, 'older');
    assert.equal(format.latestNote(task, '2026-09-15')?.body, 'newer', 'newest when none today');
    assert.equal(format.latestNote({ notes: [] } as unknown as Task, '2026-09-15'), undefined);
  });

  test('renderContext keeps the requirement and open items and trims the note', () => {
    const task = {
      id: 'ctx',
      title: 'Context',
      status: 'current',
      order: 1,
      sessions: [],
      created: '2026-09-15T09:00:00+05:30',
      updated: '2026-09-15T09:00:00+05:30',
      planned: '2026-09-15',
      requirement: 'Must hold.',
      plan: ['Step one'],
      checklist: [
        { text: 'Open one', done: false },
        { text: 'Closed one', done: true },
      ],
      notes: [{ date: '2026-09-15', body: Array.from({ length: 30 },
        (_, i) => `note ${i + 1}`).join('\n') }],
      extra: '',
      file: '/tmp/ctx.md',
    } as unknown as Task;
    const out = format.renderContext(task, '2026-09-15', 20).split('\n');
    assert.ok(out.length <= 20, `got ${out.length} lines`);
    assert.ok(out.includes('Planned: 2026-09-15 (today)'));
    assert.ok(out.includes('Must hold.'));
    assert.ok(out.includes('1. Step one'));
    assert.ok(out.includes('- [ ] Open one'));
    assert.ok(!out.includes('- [x] Closed one'));
    assert.ok(out.includes('note 30'), 'the newest note line is kept');
    assert.ok(!out.includes('note 1'), 'the oldest note line is dropped');
  });
});

describe('taskForRepo', () => {
  const tasks = [
    { id: 'outer', repo: '/r/outer' },
    { id: 'inner', repo: '/r/outer/inner' },
    { id: 'none' },
  ] as unknown as Task[];

  test('picks the deepest containing repo', () => {
    assert.equal(pending.taskForRepo(tasks, '/r/outer/inner/src')?.id, 'inner');
    assert.equal(pending.taskForRepo(tasks, '/r/outer/other')?.id, 'outer');
    assert.equal(pending.taskForRepo(tasks, '/r/outer'), tasks[0]);
    assert.equal(pending.taskForRepo(tasks, '/r/outerlong'), undefined);
  });
});

test('the closing instruction survives a long requirement and long notes', () => {
  const task = {
    id: 'ctx',
    title: 'Context',
    status: 'current',
    order: 1,
    sessions: [],
    created: '2026-09-16T09:00:00+05:30',
    updated: '2026-09-16T09:00:00+05:30',
    requirement: Array.from({ length: 40 }, (_, i) => `requirement line ${i}`).join('\n'),
    plan: [],
    checklist: [{ text: 'Open one', done: false }],
    notes: [
      { date: '2026-09-16', body: Array.from({ length: 40 }, (_, i) => `note ${i}`).join('\n') },
    ],
    extra: '',
    file: '/home/t/.ledge/tasks/2026-09-16-x.md',
  } as unknown as Task;

  const out = format.renderContext(task, '2026-09-16');

  // The point of the block is that it tells the assistant what to do with the file. Losing
  // that line to truncation removes the only instruction in it, and it was being lost exactly
  // when the requirement and notes were long, which is when it matters most.
  assert.match(out, /Task file: \/home\/t\/\.ledge\/tasks\/2026-09-16-x\.md/);
  assert.match(out, /Tick items, append notes and keep the plan current/);
  assert.match(out, /more lines, see ledge open/, 'the middle is still trimmed');
});
