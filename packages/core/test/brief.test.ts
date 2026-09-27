// Tests for the resume briefing: what it quotes, where the AI insight wins over the fallback, and
// the forty line cap that decides what gives way first.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_MAX_LINES, buildBrief, emptyInsights, firstSentences, noteKey } from '../src/pure.ts';
import type { SessionRecord, Task } from '../src/pure.ts';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'release-watch-banner',
    title: 'Release watch banner',
    status: 'current',
    order: 1,
    sessions: [],
    created: '2026-09-14T21:04:00+05:30',
    updated: '2026-09-16T09:12:00+05:30',
    requirement: 'Users keep old code in open tabs.\nShow a banner.',
    plan: ['Write version.json', 'Poll it', 'Show the banner'],
    checklist: [
      { text: 'Investigate caching', done: true },
      { text: 'Build step that writes version.json', done: false },
    ],
    references: '',
    notes: [
      { date: '2026-09-15', body: 'Old note.' },
      { date: '2026-09-16', body: 'Moved the write into closeBundle. Not committed yet. Third bit.' },
    ],
    extra: '',
    file: '',
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    version: 1,
    id: 's',
    started: '2026-09-16T08:00:00+05:30',
    lastActivity: '2026-09-16T09:00:00+05:30',
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
    ...overrides,
  };
}

describe('firstSentences', () => {
  test('takes one or two sentences and flattens them', () => {
    assert.equal(firstSentences('One.  Two!\nThree?'), 'One. Two!');
    assert.equal(firstSentences('No full stop at all'), 'No full stop at all');
    assert.equal(firstSentences('A. B.', 1), 'A.');
    assert.equal(firstSentences('x'.repeat(300)).length, 240);
  });
});

describe('buildBrief', () => {
  test('without sidecars it falls back to the file: first plan step, first sentences', () => {
    const brief = buildBrief(task());
    assert.match(brief, /^Resuming the Ledge task "Release watch banner" \(id: release-watch-banner\)\./);
    assert.match(brief, /Current phase: Write version.json/);
    assert.match(brief, /Requirement:\nUsers keep old code in open tabs\.\nShow a banner\./);
    assert.match(brief, /Open todos:\n- \[ \] Build step that writes version.json/);
    assert.doesNotMatch(brief, /Investigate caching/);
    assert.match(brief, /Last note \(2026-09-16\): Moved the write into closeBundle\. Not committed yet\.$/m);
    assert.doesNotMatch(brief, /Last session/);
    assert.doesNotMatch(brief, /[—–]/);
  });

  test('with sidecars it uses the headline, the phase, the note insight and the last session', () => {
    const t = task();
    const insights = emptyInsights(t.id, '2026-09-16T09:00:00+05:30');
    insights.headline = 'Build step done, banner next';
    insights.phase = 'Poll it';
    insights.notes[noteKey(t.notes[1]!)] = { title: 'Moved to closeBundle', summary: 'Hash was stale.' };
    const sessions = [
      session({ id: 'old', taskId: t.id, title: 'Old', summary: 'Old one.', lastActivity: '2026-09-15T09:00:00+05:30' }),
      session({ id: 'new', taskId: t.id, title: 'Fix the stale hash', summary: 'Moved the write.' }),
      session({ id: 'other', taskId: 'other-task', title: 'Elsewhere', lastActivity: '2026-09-20T09:00:00+05:30' }),
    ];
    const brief = buildBrief(t, { insights, sessions });
    assert.match(brief, /Where it stands: Build step done, banner next/);
    assert.match(brief, /Current phase: Poll it/);
    assert.match(brief, /Last session \(2026-09-16\): Fix the stale hash: Moved the write\./);
    assert.match(brief, /Last note \(2026-09-16\): Moved to closeBundle: Hash was stale\./);
    assert.doesNotMatch(brief, /Elsewhere/);
  });

  test('never runs past forty lines, and the requirement gives way before the open items', () => {
    const requirement = Array.from({ length: 30 }, (_, i) => `Requirement line ${i + 1}.`).join('\n');
    const checklist = Array.from({ length: 30 }, (_, i) => ({ text: `Open item ${i + 1}`, done: false }));
    const brief = buildBrief(task({ requirement, checklist }));
    const lines = brief.split('\n');
    assert.ok(lines.length <= BRIEF_MAX_LINES, `${lines.length} lines`);
    assert.match(brief, /Requirement line 1\. \(continues in the task file\)/);
    assert.match(brief, /Open item 1\n/);
    assert.match(brief, /- and \d+ more open items/);
    assert.match(brief, /Last note/);
  });
});
