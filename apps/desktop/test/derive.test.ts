import { defaultConfig } from '@ledge/core/pure';
import { describe, expect, it } from 'vitest';
import { greeting, personName, progressOf, summaryParts, taskState } from '../src/lib/derive.ts';
import { DAY, DAY_PAST, plannedTask, taskA, taskB, taskC } from './fixtures.ts';

describe('taskState', () => {
  it('calls current work planned for today, or already late, Working', () => {
    expect(taskState(plannedTask(DAY), DAY).label).toBe('Working');
    expect(taskState(plannedTask(DAY_PAST), DAY).label).toBe('Working');
    expect(taskState(taskC(), DAY).id).toBe('working');
  });

  it('calls current work with something ticked but no day for today In Progress', () => {
    /* taskA has two of five ticked and no planned day. */
    expect(taskState(taskA(), DAY).label).toBe('In Progress');
    expect(taskState(plannedTask('2026-09-30'), DAY).label).toBe('In Progress');
  });

  it('calls current work with nothing ticked Not started', () => {
    const fresh = { ...taskA(), checklist: taskA().checklist.map((i) => ({ ...i, done: false })) };
    expect(taskState(fresh, DAY).label).toBe('Not started');
  });

  it('reads status before anything else, so a parked or archived task says so', () => {
    expect(taskState(taskB(), DAY).label).toBe('Parked');
    expect(taskState({ ...taskC(), status: 'done' }, DAY).label).toBe('Done');
  });

  it('gives every state a glyph, so the pill survives greyscale', () => {
    for (const task of [taskA(), taskB(), taskC()]) {
      expect(taskState(task, DAY).glyph).not.toBe('');
    }
  });
});

describe('progressOf', () => {
  it('counts ticked against total', () => {
    expect(progressOf(taskA())).toEqual({ done: 2, total: 5 });
    expect(progressOf({ ...taskA(), checklist: [] })).toEqual({ done: 0, total: 0 });
  });
});

describe('greeting', () => {
  it('names the part of the day rather than the hour', () => {
    expect(greeting(new Date(2026, 8, 16, 7, 0))).toBe('Good morning');
    expect(greeting(new Date(2026, 8, 16, 11, 59))).toBe('Good morning');
    expect(greeting(new Date(2026, 8, 16, 12, 0))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 8, 16, 16, 59))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 8, 16, 17, 0))).toBe('Good evening');
  });
});

describe('personName', () => {
  it('prefers a name someone actually wrote in config.json', () => {
    const config = { ...defaultConfig(), ui: { ...defaultConfig().ui, name: 'Ranjan' } };
    expect(personName(config, '/Users/thinktac')).toBe('Ranjan');
  });

  it('falls back to the account folder, which is the only name the machine gave us', () => {
    expect(personName(defaultConfig(), '/Users/thinktac')).toBe('Thinktac');
  });

  it('greets nobody rather than guessing when there is no home folder', () => {
    expect(personName(defaultConfig(), '')).toBe('');
  });
});

describe('summaryParts', () => {
  it('states only what is true, and never a count of zero', () => {
    expect(summaryParts({ sessions: 0, working: 2, pending: 6 })).toEqual([
      '2 active tasks',
      '6 pending tasks',
    ]);
    expect(summaryParts({ sessions: 3, working: 1, pending: 0 })).toEqual([
      '3 linked sessions',
      '1 active task',
    ]);
    expect(summaryParts({ sessions: 0, working: 0, pending: 0 })).toEqual([]);
  });

  it('says "linked session", never "active session", because nothing measures liveness', () => {
    expect(summaryParts({ sessions: 1, working: 0, pending: 0 })).toEqual(['1 linked session']);
  });
});
