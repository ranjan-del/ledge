import { afterEach, describe, expect, it } from 'vitest';
import {
  counts,
  desk,
  doneToday,
  lastUpdated,
  upNextTasks,
  workingTasks,
} from '../src/lib/store.svelte.ts';
import { DAY, DAY_PAST, archived, plannedTask, taskA, taskB, taskC } from './fixtures.ts';

afterEach(() => {
  desk.tasks = [];
  desk.archive = [];
  desk.archiveReady = false;
  desk.archivedCount = 0;
  desk.lastScan = null;
});

describe('workingTasks and upNextTasks', () => {
  it('puts current work planned for today or earlier under currently working', () => {
    const today = plannedTask(DAY, { file: 'a.md', order: 2 });
    const late = plannedTask(DAY_PAST, { file: 'b.md', order: 1 });
    const unplanned = { ...taskA(), file: 'c.md', order: 3 };
    desk.tasks = [today, late, unplanned];
    expect(workingTasks(DAY).map((t) => t.file)).toEqual(['b.md', 'a.md']);
    expect(upNextTasks(DAY).map((t) => t.file)).toEqual(['c.md']);
  });

  it('leaves work planned for a later day in up next', () => {
    desk.tasks = [plannedTask('2026-09-30', { file: 'later.md' })];
    expect(workingTasks(DAY)).toEqual([]);
    expect(upNextTasks(DAY).map((t) => t.file)).toEqual(['later.md']);
  });

  it('shows every current task as working when nothing is planned at all', () => {
    desk.tasks = [taskA(), { ...taskA(), file: 'other.md', order: 2 }];
    expect(workingTasks(DAY)).toHaveLength(2);
    expect(upNextTasks(DAY)).toEqual([]);
  });

  it('never lists a parked task on either, whatever day it is planned for', () => {
    desk.tasks = [{ ...taskB(), planned: DAY }];
    expect(workingTasks(DAY)).toEqual([]);
    expect(upNextTasks(DAY)).toEqual([]);
  });
});

describe('counts', () => {
  it('counts what each tab label claims and nothing else', () => {
    desk.tasks = [taskA(), taskB(), taskC()];
    /* taskA and taskC are current, taskB is parked. taskA carries two session ids of which
       one is the newest, taskC one. taskC has two dated notes; the others have none. */
    expect(counts()).toEqual({ now: 2, sessions: 2, tasks: 3, memory: 2 });
  });

  it('counts the live list only, so the archive never inflates a tab', () => {
    desk.tasks = [];
    desk.archive = archived();
    desk.archiveReady = true;
    expect(counts().tasks).toBe(0);
  });
});

describe('doneToday', () => {
  it('knows nothing until the archive has been read, rather than claiming zero', () => {
    desk.archiveReady = false;
    expect(doneToday(DAY)).toBeUndefined();
  });

  it('counts the archived tasks last written on the given day', () => {
    const [newer, older] = archived();
    desk.archive = [{ ...newer, updated: `${DAY}T11:05:00+05:30` }, older];
    desk.archiveReady = true;
    expect(doneToday(DAY)).toBe(1);
  });
});

describe('lastUpdated', () => {
  it('takes the newer of the last git scan and the newest task file', () => {
    desk.tasks = [{ ...taskA(), updated: '2026-09-14T23:04:00+05:30' }];
    desk.lastScan = '2026-09-15T09:00:00.000Z';
    expect(lastUpdated()).toBe('2026-09-15T09:00:00.000Z');
    desk.lastScan = '2026-09-13T09:00:00.000Z';
    expect(lastUpdated()).toBe('2026-09-14T23:04:00+05:30');
  });

  it('is undefined when nothing has happened yet at all', () => {
    expect(lastUpdated()).toBeUndefined();
  });
});
