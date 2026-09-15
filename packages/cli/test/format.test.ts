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
