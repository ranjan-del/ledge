import { describe, expect, it } from 'vitest';
import { failureText, ledgeCommandOf, renderLedgeContext } from '../src/lib/ask.ts';
import { buildPalette } from '../src/lib/palette.ts';
import { DAY, repoStatus, taskA, taskB, taskC } from './fixtures.ts';
import { parseWeek } from '@ledge/core/pure';

describe('helpers', () => {
  it('keeps only the ledge part of a command', () => {
    expect(ledgeCommandOf('ledge note a "x"')).toBe('ledge note a "x"');
    expect(ledgeCommandOf('cd /tmp && ledge list --json')).toBe('ledge list --json');
    expect(ledgeCommandOf('git status')).toBeUndefined();
  });

  it('explains a missing Claude Code and a signed out one in words', () => {
    expect(failureText(127, '')).toMatch(/not installed/);
    expect(failureText(1, 'Not logged in · Please run /login')).toMatch(/not signed in/);
    expect(failureText(1, '')).toMatch(/exit 1/);
  });
});

describe('the context', () => {
  const context = renderLedgeContext({
    day: DAY,
    tasks: [taskA(), taskB(), { ...taskC(), status: 'done' }],
    repos: [repoStatus()],
    insights: {
      'release-watch-banner': {
        version: 1,
        taskId: 'release-watch-banner',
        headline: 'Build step next',
        phase: 'Build step',
        notes: {},
        plan: {},
        updatedAt: '',
      },
    },
    sessions: [
      {
        version: 1,
        id: 's1',
        taskId: 'release-watch-banner',
        title: 'Poller work',
        summary: 'Wrote the poll.',
        started: '2026-09-15T10:00:00+05:30',
        lastActivity: '2026-09-15T10:30:00+05:30',
        ended: '2026-09-15T10:30:00+05:30',
        filesChanged: ['a.ts'],
        commits: [{ sha: 'abc', subject: 'feat: poll' }],
        todosTicked: [],
        todosAdded: [],
      },
    ],
    now: new Date('2026-09-15T12:00:00+05:30'),
  });

  it('carries tasks, git, insights and sessions, and leaves done tasks out', () => {
    expect(context).toContain('id: release-watch-banner');
    expect(context).toContain('id: optimistic-crud');
    expect(context).not.toContain('id: version-file-rollout');
    expect(context).toContain('branch feature/banner');
    expect(context).toContain('release-watch-banner: headline: Build step next; current phase: Build step');
    expect(context).toContain('ended task=release-watch-banner: Poller work');
    expect(context).toContain('commits: feat: poll');
  });
});

describe('the week in the context', () => {
  const base = { day: DAY, tasks: [taskA()], insights: {}, sessions: [], now: new Date(DAY) };
  const week = parseWeek(
    '---\nweek: 2026-W38\n---\n\n## Anytime\n\n- [ ] Renew the domain\n\n## Tue 2026-09-15\n\n- [x] Call the vendor {task: release-watch-banner}\n',
    '2026-W38',
  );

  it("quotes this week's items numbered as ledge week prints them", () => {
    const context = renderLedgeContext({ ...base, week });
    expect(context).toContain("=== THIS WEEK'S TO-DO, 2026-W38");
    expect(context).toContain('1. [ ] anytime: Renew the domain');
    expect(context).toContain('2. [x] Tue 2026-09-15: Call the vendor (task release-watch-banner)');
    expect(context.indexOf('2026-W38')).toBeLessThan(context.indexOf('=== END ==='));
  });

  it('says so when the week is empty, and says nothing when no week is given', () => {
    const empty = renderLedgeContext({ ...base, week: parseWeek('', '2026-W38') });
    expect(empty).toContain('(nothing yet)');
    expect(renderLedgeContext(base)).not.toContain('TO-DO');
  });
});

describe('the palette offers Ask Ledge', () => {
  const base = { tasks: [taskA(), taskC()], surface: 'assistant' as const, day: DAY };

  it('only when asked to', () => {
    expect(buildPalette({ ...base, query: 'why poll?' }).some((g) => g.kind === 'ask')).toBe(false);
  });

  it('first for a question, after what the desk found otherwise', () => {
    const q = buildPalette({ ...base, query: 'what is left on the banner?', ask: true });
    expect(q[0]?.kind).toBe('ask');
    expect(q[0]?.items[0]?.command).toEqual({ type: 'ask', question: 'what is left on the banner?' });
    const plain = buildPalette({ ...base, query: 'banner', ask: true });
    expect(plain[0]?.kind).toBe('task');
    expect(plain.map((g) => g.kind)).toContain('ask');
  });
});
