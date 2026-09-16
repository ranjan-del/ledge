import { describe, expect, it } from 'vitest';
import { searchDesk } from '../src/lib/search.ts';
import { taskA, taskB, taskC } from './fixtures.ts';

const tasks = [taskA(), taskB(), taskC()];

describe('searchDesk', () => {
  it('answers nothing at all before it is asked', () => {
    expect(searchDesk(tasks, '')).toEqual([]);
    expect(searchDesk(tasks, '   ')).toEqual([]);
  });

  it('matches a title and says the match was the title', () => {
    const hits = searchDesk(tasks, 'optimistic crud');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'task', where: 'title' });
    expect(hits[0].task.id).toBe('optimistic-crud');
  });

  it('looks inside the requirement, the checklist and the plan, and names which', () => {
    const requirement = searchDesk(tasks, 'lazy routes');
    expect(requirement[0]).toMatchObject({ kind: 'task', where: 'requirement' });

    const checklist = searchDesk(tasks, 'ReleaseWatchService');
    expect(checklist[0]).toMatchObject({ kind: 'task', where: 'checklist' });

    const plan = searchDesk(tasks, 'window focus');
    expect(plan.some((h) => h.where === 'plan')).toBe(true);
  });

  it('finds a note and carries the day it was written', () => {
    const hits = searchDesk(tasks, 'service worker');
    const note = hits.find((h) => h.kind === 'note');
    expect(note?.date).toBe('2026-09-12');
    expect(note?.text).toContain('Polling a static file');
    expect(note?.where).toBe('Roll the version file out to every app');
  });

  it('requires every word, ignoring case, and ranks nothing', () => {
    expect(searchDesk(tasks, 'BANNER SHELL').length).toBeGreaterThan(0);
    expect(searchDesk(tasks, 'banner kubernetes')).toEqual([]);
  });

  it('puts tasks before notes, so the thing itself beats what was said about it', () => {
    const hits = searchDesk(tasks, 'version');
    const firstNote = hits.findIndex((h) => h.kind === 'note');
    const lastTask = hits.map((h) => h.kind).lastIndexOf('task');
    expect(firstNote).toBeGreaterThan(lastTask);
  });

  it('caps the answer so one broad query cannot flood the panel', () => {
    expect(searchDesk(tasks, 'the', 2)).toHaveLength(2);
  });
});
