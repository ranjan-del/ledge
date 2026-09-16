import { describe, expect, it } from 'vitest';
import { IDLE_MAX_MS, IDLE_MIN_MS, awaySummary, idleThresholdMs } from '../src/lib/away.ts';
import { snapshot, type Observation } from '../src/lib/observed.ts';
import { repoStatus, taskA, taskC } from './fixtures.ts';

const T0 = '2026-09-15T09:00:00+05:30';
const T1 = '2026-09-15T17:00:00+05:30';

function look(over: Partial<Parameters<typeof snapshot>[0]> = {}): Observation {
  return snapshot({
    tasks: [taskA(), taskC()],
    repos: [repoStatus()],
    archived: 0,
    at: T0,
    ...over,
  });
}

describe('idleThresholdMs', () => {
  it('falls back to the floor when the store holds no gap to measure', () => {
    expect(idleThresholdMs([])).toBe(IDLE_MIN_MS);
    expect(idleThresholdMs(['2026-09-15T09:00:00+05:30'])).toBe(IDLE_MIN_MS);
  });

  it('is the median gap between writes for a store that says something about its pace', () => {
    const stamps = [
      '2026-09-15T09:00:00+05:30',
      '2026-09-15T11:00:00+05:30',
      '2026-09-15T12:00:00+05:30',
      '2026-09-15T15:00:00+05:30',
    ];
    /* Gaps of 2 h, 1 h and 3 h: the median is 2 h. */
    expect(idleThresholdMs(stamps)).toBe(2 * 3600_000);
  });

  it('clamps both ends, because a median over three stamps is a weak measurement', () => {
    const busy = ['2026-09-15T09:00:00+05:30', '2026-09-15T09:01:00+05:30'];
    expect(idleThresholdMs(busy)).toBe(IDLE_MIN_MS);
    const sparse = ['2026-08-01T09:00:00+05:30', '2026-09-15T09:00:00+05:30'];
    expect(idleThresholdMs(sparse)).toBe(IDLE_MAX_MS);
  });

  it('ignores anything that is not a timestamp rather than counting it as zero', () => {
    expect(idleThresholdMs(['not a date', 'nor this'])).toBe(IDLE_MIN_MS);
  });
});

describe('awaySummary', () => {
  it('says nothing at all when nothing changed', () => {
    const summary = awaySummary(look(), look({ at: T1 }));
    expect(summary.lines).toEqual([]);
    expect(summary.since).toBe(T0);
  });

  it('counts files changed and commits added, and names how many repositories', () => {
    const before = look({ repos: [repoStatus({ dirty: [], ahead: 0 })] });
    const after = look({
      at: T1,
      repos: [
        repoStatus({
          dirty: [
            { path: 'a.ts', code: 'M.' },
            { path: 'b.ts', code: 'M.' },
            { path: 'c.ts', code: '??' },
          ],
          ahead: 2,
        }),
      ],
    });
    expect(awaySummary(before, after).lines).toEqual([
      '3 files changed in 1 repository',
      '2 commits added in 1 repository, not yet pushed',
    ]);
  });

  it('reports work that was committed away as files cleared, not as commits added', () => {
    const before = look({ repos: [repoStatus({ dirty: [{ path: 'a.ts', code: 'M.' }], ahead: 4 })] });
    const after = look({ at: T1, repos: [repoStatus({ dirty: [], ahead: 0 })] });
    expect(awaySummary(before, after).lines).toEqual(['1 file committed or cleared in 1 repository']);
  });

  it('counts tasks finished, items ticked, notes written and sessions linked', () => {
    const before = look();
    const task = taskA();
    const after = snapshot({
      tasks: [
        {
          ...task,
          checklist: task.checklist.map((item) => ({ ...item, done: true })),
          notes: [{ date: '2026-09-15', body: 'Finished it off.' }],
          sessions: [...task.sessions, 'aa11bb22'],
        },
        taskC(),
      ],
      repos: [repoStatus()],
      archived: 2,
      at: T1,
    });
    expect(awaySummary(before, after).lines).toEqual([
      '2 tasks finished',
      '3 checklist items ticked',
      '1 note written',
      '1 session linked',
    ]);
  });

  it('offers the most recently written task to go back to', () => {
    const summary = awaySummary(look(), look({ at: T1 }));
    expect(summary.resumeTitle).toBe('Release watch banner for stale tabs');
    expect(summary.resumeFile).toBe(taskA().file);
  });

  it('offers nothing to go back to when there are no tasks at all', () => {
    const summary = awaySummary(look({ tasks: [] }), look({ tasks: [], at: T1 }));
    expect(summary.resumeFile).toBeUndefined();
  });

  it('does not count something that only appeared while you were away as a change to it', () => {
    const before = look({ tasks: [taskA()], repos: [] });
    const after = look({ tasks: [taskA(), taskC()], at: T1 });
    expect(awaySummary(before, after).lines).toEqual([]);
  });
});
