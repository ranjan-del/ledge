import type { Task } from '@ledge/core/pure';
import { describe, expect, it } from 'vitest';
import {
  PILE_THRESHOLD,
  diff,
  groupNotifications,
  nudgeKey,
  nudgedAfter,
  snapshot,
  type Notification,
  type Observation,
} from '../src/lib/observed.ts';
import { DAY, repoStatus, taskA, taskC } from './fixtures.ts';

const AT = '2026-09-15T09:00:00+05:30';
const LATER = '2026-09-15T11:00:00+05:30';

function look(tasks: Task[], repos = [repoStatus()], archived = 0, at = AT): Observation {
  return snapshot({ tasks, repos, archived, at });
}

function ids(items: Notification[]): string[] {
  return items.map((item) => item.kind);
}

function dirty(n: number) {
  return Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, code: 'M.' }));
}

describe('snapshot', () => {
  it('records counts and stamps, not the text of the files', () => {
    const observed = look([taskC()]);
    const task = observed.tasks[taskC().file];
    expect(task).toMatchObject({
      title: 'Roll the version file out to every app',
      done: 1,
      total: 3,
      notes: 2,
      sessions: 1,
      planned: '2026-09-11',
      lastNote: '2026-09-14',
    });
    expect(task?.noteChars).toBeGreaterThan(0);
    expect(JSON.stringify(observed)).not.toContain('service worker');
  });

  it('records a repository as its branch and its two counts', () => {
    const observed = look([], [repoStatus()]);
    expect(Object.values(observed.repos)[0]).toEqual({
      branch: 'feature/banner',
      dirty: 2,
      ahead: 2,
    });
  });
});

describe('diff', () => {
  it('says nothing at all about a task or a repository it is seeing for the first time', () => {
    const before = look([], []);
    const after = look([taskA()], [repoStatus()]);
    expect(diff(before, after, DAY)).toEqual([]);
  });

  it('announces a checklist reaching complete, once', () => {
    const task = taskA();
    const before = look([task]);
    const finished = { ...task, checklist: task.checklist.map((i) => ({ ...i, done: true })) };
    const after = look([finished], undefined, 0, LATER);
    const fired = diff(before, after, DAY);
    expect(ids(fired)).toEqual(['checklist-complete']);
    expect(fired[0]?.detail).toBe('Checklist complete, all 5 items ticked');
    expect(fired[0]?.file).toBe(task.file);
    /* And nothing the next time round, because it is no longer a crossing. */
    expect(diff(after, look([finished], undefined, 0, LATER), DAY)).toEqual([]);
  });

  it('announces a note being added, and one appended to a day that already had one', () => {
    const task = taskC();
    const before = look([task]);
    const extra = {
      ...task,
      notes: [...task.notes, { date: DAY, body: 'Tried the other thing. It was worse.' }],
    };
    expect(ids(diff(before, look([extra], undefined, 0, LATER), DAY))).toEqual(['note-added']);

    const appended = {
      ...task,
      notes: task.notes.map((n, i) => (i === 1 ? { ...n, body: `${n.body} And one more thing.` } : n)),
    };
    const fired = diff(before, look([appended], undefined, 0, LATER), DAY);
    expect(ids(fired)).toEqual(['note-added']);
    expect(fired[0]?.detail).toContain('Note written under');
  });

  it('nudges once a day about a task planned for today that is still untouched', () => {
    const task: Task = { ...taskA(), planned: DAY, checklist: [{ text: 'Start', done: false }] };
    const before = look([task]);
    const after = look([task], undefined, 0, LATER);
    const fired = diff(before, after, DAY);
    expect(ids(fired)).toEqual(['planned-untouched']);
    expect(fired[0]?.detail).toBe('Planned for today, nothing ticked yet of 1');

    /* Once the nudge is recorded, the same state says nothing more today. */
    const recorded: Observation = { ...before, nudged: nudgedAfter(before, fired, DAY) };
    expect(recorded.nudged).toEqual([nudgeKey(task.file, DAY)]);
    expect(diff(recorded, after, DAY)).toEqual([]);
  });

  it('does not nudge about a task that has been touched, by a tick or by a note', () => {
    const base: Task = { ...taskA(), planned: DAY, checklist: [{ text: 'Start', done: true }] };
    expect(diff(look([base]), look([base], undefined, 0, LATER), DAY)).toEqual([]);

    const noted: Task = {
      ...base,
      checklist: [{ text: 'Start', done: false }],
      notes: [{ date: DAY, body: 'Had a look, it is bigger than it seemed.' }],
    };
    expect(diff(look([noted]), look([noted], undefined, 0, LATER), DAY)).toEqual([]);
  });

  it('announces a repository crossing into having uncommitted work', () => {
    const clean = look([], [repoStatus({ dirty: [], ahead: 0 })]);
    const now = look([], [repoStatus({ dirty: dirty(3), ahead: 0 })], 0, LATER);
    const fired = diff(clean, now, DAY);
    expect(ids(fired)).toEqual(['repo-uncommitted']);
    expect(fired[0]?.detail).toBe('3 uncommitted files on feature/banner');
    expect(fired[0]?.title).toBe('app');
  });

  it('announces a repository crossing into having unpushed commits', () => {
    const pushed = look([], [repoStatus({ dirty: dirty(1), ahead: 0 })]);
    const now = look([], [repoStatus({ dirty: dirty(1), ahead: 4 })], 0, LATER);
    const fired = diff(pushed, now, DAY);
    expect(ids(fired)).toEqual(['repo-unpushed']);
    expect(fired[0]?.detail).toBe('4 commits not pushed on feature/banner');
  });

  it('calls out a pile of uncommitted files as its own thing, and not twice', () => {
    const before = look([], [repoStatus({ dirty: [], ahead: 0 })]);
    const now = look([], [repoStatus({ dirty: dirty(333), ahead: 0 })], 0, LATER);
    const fired = diff(before, now, DAY);
    expect(ids(fired)).toEqual(['repo-pile']);
    expect(fired[0]?.detail).toBe('333 uncommitted files on feature/banner');
    expect(PILE_THRESHOLD).toBeLessThan(333);
  });

  it('says nothing about a repository that was already dirty and got dirtier', () => {
    const before = look([], [repoStatus({ dirty: dirty(2), ahead: 1 })]);
    const now = look([], [repoStatus({ dirty: dirty(9), ahead: 3 })], 0, LATER);
    expect(diff(before, now, DAY)).toEqual([]);
  });
});

describe('groupNotifications', () => {
  const item = (kind: Notification['kind'], at: string, title: string): Notification => ({
    id: `${kind}:${title}`,
    kind,
    tone: 'neutral',
    title,
    detail: 'something happened',
    at,
  });

  it('groups by subject, newest group first, newest item first inside it', () => {
    const groups = groupNotifications([
      item('note-added', '2026-09-15T08:00:00+05:30', 'a note'),
      item('repo-pile', '2026-09-15T10:00:00+05:30', 'unlab-web'),
      item('repo-unpushed', '2026-09-15T12:00:00+05:30', 'app'),
      item('checklist-complete', '2026-09-15T09:00:00+05:30', 'a task'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Repositories', 'Checklists', 'Notes']);
    expect(groups[0]?.items.map((i) => i.title)).toEqual(['app', 'unlab-web']);
  });

  it('has no group for a kind nothing happened to', () => {
    expect(groupNotifications([])).toEqual([]);
    const one = groupNotifications([item('planned-untouched', AT, 'a task')]);
    expect(one.map((g) => g.label)).toEqual(['Planned']);
  });
});
