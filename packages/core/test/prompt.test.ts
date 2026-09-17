import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumePrompt } from '../src/index.ts';
import type { Task } from '../src/index.ts';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'release-watch-banner',
    title: 'Release watch banner',
    status: 'current',
    order: 1,
    repo: '/srv/admin-web',
    sessions: ['abc'],
    created: '2026-09-14T21:04:00+05:30',
    updated: '2026-09-14T23:04:00+05:30',
    requirement: 'Old tabs break after deploy.\nShow a banner.',
    plan: [],
    notes: [],
    checklist: [
      { text: 'Investigated caching', done: true },
      { text: 'Build step writes version.json', done: false },
      { text: 'Banner component', done: false },
    ],
    references: '',
    extra: '',
    file: '/tmp/ledge/tasks/2026-09-14-release-watch-banner.md',
    ...over,
  };
}

test('buildResumePrompt includes title, requirement and only unchecked items', () => {
  const p = buildResumePrompt(task());
  assert.match(p, /Release watch banner/);
  assert.match(p, /release-watch-banner/);
  assert.match(p, /Old tabs break after deploy\.\nShow a banner\./);
  assert.match(p, /- Build step writes version\.json/);
  assert.match(p, /- Banner component/);
  assert.doesNotMatch(p, /Investigated caching/);
  assert.match(p, /2026-09-14-release-watch-banner\.md/);
  assert.ok(!p.includes(String.fromCodePoint(0x2014)), 'no em dashes');
});

test('buildResumePrompt copes with empty requirement and nothing left to do', () => {
  const p = buildResumePrompt(
    task({ requirement: '', checklist: [{ text: 'x', done: true }], file: '' }),
  );
  assert.match(p, /Release watch banner/);
  assert.match(p, /no requirement/i);
  assert.match(p, /nothing unchecked/i);
  assert.doesNotMatch(p, /- x/);
});
