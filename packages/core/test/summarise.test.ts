// Tests for the insight backfill: which items count as missing, how a batch is cut, and the
// answer check that keeps a model from filing a title under a key it was not shown.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSummarisePrompt,
  contentKey,
  emptyInsights,
  fitSummaryBatch,
  missingInsights,
  noteKey,
  parseSummariseResult,
} from '../src/pure.ts';
import type { Task } from '../src/pure.ts';

const task = {
  id: 'release-watch-banner',
  title: 'Release watch banner',
  plan: ['Write version.json at build time', 'Poll it (every minute, and on focus)'],
  notes: [
    { date: '2026-09-15', body: 'Decided to poll.' },
    { date: '2026-09-16', body: 'Moved the write into closeBundle.' },
  ],
} as unknown as Task;

describe('missingInsights', () => {
  test('everything is missing without insights, newest note first, then the plan', () => {
    const items = missingInsights(task, undefined);
    assert.deepEqual(
      items.map((i) => [i.kind, i.date ?? '', i.text]),
      [
        ['note', '2026-09-16', 'Moved the write into closeBundle.'],
        ['note', '2026-09-15', 'Decided to poll.'],
        ['plan', '', 'Write version.json at build time'],
        ['plan', '', 'Poll it (every minute, and on focus)'],
      ],
    );
    assert.equal(items[0]!.key, noteKey(task.notes[1]!));
  });

  test('a current entry counts, an entry under an old key does not', () => {
    const insights = emptyInsights(task.id, '');
    insights.notes[noteKey(task.notes[0]!)] = { title: 'Polling', summary: '' };
    insights.notes[noteKey({ date: '2026-09-16', body: 'An older wording.' })] = { title: 'Old', summary: '' };
    insights.plan[contentKey(task.plan[0]!)] = { title: 'version.json' };
    const items = missingInsights(task, insights);
    assert.deepEqual(items.map((i) => i.text), [
      'Moved the write into closeBundle.',
      'Poll it (every minute, and on focus)',
    ]);
  });
});

describe('fitSummaryBatch', () => {
  test('takes what fits and always at least one', () => {
    const items = missingInsights(task, undefined);
    assert.equal(fitSummaryBatch(items).batch.length, 4);
    const tight = fitSummaryBatch(items, 1);
    assert.equal(tight.batch.length, 1);
    assert.equal(tight.rest.length, 3);
  });
});

describe('buildSummarisePrompt and parseSummariseResult', () => {
  const items = missingInsights(task, undefined);

  test('the prompt carries every key and the no rewrite rule, and no em dash', () => {
    const prompt = buildSummarisePrompt(task, items);
    for (const item of items) assert.ok(prompt.includes(item.key));
    assert.match(prompt, /Never add facts/);
    assert.doesNotMatch(prompt, /[\u2014\u2013]/);
  });

  test('keeps only asked keys, skips bad entries, trims titles', () => {
    const [n1, , p1] = items;
    const answer = JSON.stringify({
      notes: { [n1!.key]: { title: 'Moved to closeBundle.', summary: 'Hash was stale.' }, deadbeef: { title: 'x' } },
      plan: { [p1!.key]: { title: 'version.json at build', detail: '' }, [n1!.key]: { title: 'wrong kind' } },
    });
    const parsed = parseSummariseResult('Here you go:\n' + answer, items);
    assert.equal(parsed.error, undefined);
    assert.deepEqual(parsed.notes, { [n1!.key]: { title: 'Moved to closeBundle', summary: 'Hash was stale.' } });
    assert.deepEqual(parsed.plan, { [p1!.key]: { title: 'version.json at build' } });
  });

  test('refuses an answer with no object or the wrong shape', () => {
    assert.match(parseSummariseResult('nope', items).error ?? '', /no JSON/);
    assert.match(parseSummariseResult('{"notes": []}', items).error ?? '', /notes is not an object/);
  });
});
