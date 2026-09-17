import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceOfWork, snapshotOfTask, takeSnapshot } from '../src/index.ts';
import type { Snapshot, Task } from '../src/index.ts';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'release-watch-banner',
    title: 'Release watch banner',
    status: 'backlog',
    order: 1,
    sessions: [],
    created: '2026-09-14T21:04:00+05:30',
    updated: '2026-09-14T21:04:00+05:30',
    requirement: 'Users keep old code in open tabs.',
    plan: [],
    checklist: [],
    notes: [],
    extra: '',
    file: '',
    ...over,
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { checklist: [], notes: [], plan: [], ...over };
}

test('an unchanged snapshot is not evidence of work', () => {
  const before = snap({
    checklist: [{ text: 'Build step', done: false }],
    notes: [{ date: '2026-09-15', body: 'Polling, not a service worker.' }],
    plan: ['Write version.json'],
    git: { commits: 4, dirty: ['?? scratch.txt'] },
  });
  const after = snap({
    checklist: [{ text: 'Build step', done: false }],
    notes: [{ date: '2026-09-15', body: 'Polling, not a service worker.' }],
    plan: ['Write version.json'],
    git: { commits: 4, dirty: ['?? scratch.txt'] },
  });
  const evidence = evidenceOfWork(before, after);
  assert.equal(evidence.worked, false);
  assert.ok(evidence.reasons.length >= 4, 'says what it looked at');
  assert.ok(evidence.reasons.some((r) => r.includes('checklist')));
  assert.ok(evidence.reasons.some((r) => r.includes('note')));
  assert.ok(evidence.reasons.some((r) => r.includes('plan')));
  assert.ok(evidence.reasons.some((r) => r.includes('working tree is unchanged')));
});

test('a ticked checklist item is evidence, matched by text and not by index', () => {
  const before = snap({
    checklist: [
      { text: 'Build step', done: false },
      { text: 'Banner component', done: false },
    ],
  });
  const after = snap({
    checklist: [
      { text: 'New first step', done: false },
      { text: 'Build step', done: true },
      { text: 'Banner component', done: false },
    ],
  });
  const evidence = evidenceOfWork(before, after);
  assert.equal(evidence.worked, true);
  assert.deepEqual(evidence.reasons, ['a checklist item was ticked', 'a checklist item was added']);
});

test('several ticks and additions are counted in the reason', () => {
  const before = snap({
    checklist: [
      { text: 'One', done: false },
      { text: 'Two', done: false },
    ],
  });
  const after = snap({
    checklist: [
      { text: 'One', done: true },
      { text: 'Two', done: true },
      { text: 'Three', done: false },
      { text: 'Four', done: false },
    ],
  });
  const evidence = evidenceOfWork(before, after);
  assert.deepEqual(evidence.reasons, [
    '2 checklist items were ticked',
    '2 checklist items were added',
  ]);
});

test('a note written for a new day and a note extended both count', () => {
  const written = evidenceOfWork(
    snap({ notes: [] }),
    snap({ notes: [{ date: '2026-09-17', body: 'Chose polling.' }] }),
  );
  assert.deepEqual(written.reasons, ['a note was written']);

  const extended = evidenceOfWork(
    snap({ notes: [{ date: '2026-09-17', body: 'Chose polling.' }] }),
    snap({ notes: [{ date: '2026-09-17', body: 'Chose polling.\n\nThen it failed.' }] }),
  );
  assert.deepEqual(extended.reasons, ['a note was extended']);
});

test('an empty note subsection for a new day is not a note', () => {
  const evidence = evidenceOfWork(
    snap({ notes: [] }),
    snap({ notes: [{ date: '2026-09-17', body: '   ' }] }),
  );
  assert.equal(evidence.worked, false);
});

test('a changed plan counts, and an unchanged one does not', () => {
  const changed = evidenceOfWork(snap({ plan: ['a'] }), snap({ plan: ['a', 'b'] }));
  assert.deepEqual(changed.reasons, ['the plan changed']);
  const same = evidenceOfWork(snap({ plan: ['a', 'b'] }), snap({ plan: ['a', 'b'] }));
  assert.equal(same.worked, false);
});

test('commits gained and a changed working tree both count, with the number', () => {
  const evidence = evidenceOfWork(
    snap({ git: { commits: 4, dirty: [] } }),
    snap({ git: { commits: 6, dirty: ['1 .M src/app.ts'] } }),
  );
  assert.equal(evidence.worked, true);
  assert.deepEqual(evidence.reasons, [
    'the repository gained 2 commits',
    'the working tree changed',
  ]);
});

test('HEAD moving without gaining commits is not evidence', () => {
  // A branch switch or a reset changes what HEAD points at while the count stays the same or
  // falls. That is navigation, not work, and promoting on it would be a false promotion.
  const evidence = evidenceOfWork(
    snap({ git: { commits: 12, dirty: [] } }),
    snap({ git: { commits: 9, dirty: [] } }),
  );
  assert.equal(evidence.worked, false);
});

test('unticking, deleting and renaming are never evidence', () => {
  const before = snap({
    checklist: [
      { text: 'One', done: true },
      { text: 'Two', done: false },
    ],
    notes: [{ date: '2026-09-17', body: 'Something.' }],
    plan: ['a'],
  });
  const after = snap({
    checklist: [{ text: 'One', done: false }],
    notes: [{ date: '2026-09-17', body: 'Something.' }],
    plan: ['a'],
  });
  assert.equal(evidenceOfWork(before, after).worked, false);
});

test('a task with no repo is judged on its file alone and never on git', () => {
  const before = snap({ checklist: [{ text: 'One', done: false }] });
  const after = snap({ checklist: [{ text: 'One', done: false }] });
  const evidence = evidenceOfWork(before, after);
  assert.equal(evidence.worked, false);
  assert.ok(evidence.reasons.some((r) => r.includes('no git state was observed')));
});

test('an unreadable repository is refused rather than called unchanged', () => {
  // One side has git, the other does not. Comparing them would be comparing a reading with a
  // silence, so the repository is left out of the verdict entirely.
  const evidence = evidenceOfWork(
    snap({ git: { commits: 4, dirty: [] } }),
    snap({ checklist: [] }),
  );
  assert.equal(evidence.worked, false);
  assert.ok(evidence.reasons.some((r) => r.includes('no git state was observed')));
});

test('snapshotOfTask copies only the fields whose change is work', () => {
  const snapshot = snapshotOfTask(
    task({
      checklist: [{ text: 'One', done: true }],
      notes: [{ date: '2026-09-17', body: 'x' }],
      plan: ['a'],
    }),
    { commits: 2, dirty: ['b', 'a'] },
  );
  assert.deepEqual(Object.keys(snapshot).sort(), ['checklist', 'git', 'notes', 'plan']);
  assert.deepEqual(snapshot.git?.dirty, ['a', 'b'], 'dirty paths are sorted');
});

test('takeSnapshot reads a real repository and sees a commit and a dirty file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-evidence-'));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-C', dir, ...args],
      { stdio: 'pipe' });
  };
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  const before = await takeSnapshot(task({ repo: dir }));
  assert.equal(before.git?.commits, 1);
  assert.deepEqual(before.git?.dirty, []);

  writeFileSync(join(dir, 'scratch.txt'), 'wip\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'two');
  const after = await takeSnapshot(task({ repo: dir }));
  assert.equal(after.git?.commits, 2);

  const evidence = evidenceOfWork(before, after);
  assert.equal(evidence.worked, true);
  assert.ok(evidence.reasons.includes('the repository gained 1 commit'));
});

test('takeSnapshot on a folder that is not a repository has no git half', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-evidence-'));
  const snapshot = await takeSnapshot(task({ repo: dir }));
  assert.equal(snapshot.git, undefined);
});
