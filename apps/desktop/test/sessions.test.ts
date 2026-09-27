import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Sessions from '../src/components/Sessions.svelte';
import type { SessionRecord } from '@ledge/core/pure';
import { formatDuration, groupSessions, sessionCount } from '../src/lib/session-view.ts';
import { taskA, taskB, taskC } from './fixtures.ts';

const NOW = Date.parse('2026-09-27T12:00:00+05:30');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function rec(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    version: 1,
    id: 'x',
    started: minutesAgo(120),
    lastActivity: minutesAgo(60),
    filesChanged: [],
    commits: [],
    todosTicked: [],
    todosAdded: [],
    ...overrides,
  };
}

/* taskA lists b13e8b5e and 071729a1; taskC lists 4c1d9a2b; taskB lists none. */
const tasks = [taskA(), taskB(), taskC()];
const live = rec({
  id: '071729a1',
  taskId: 'release-watch-banner',
  title: 'Build the version poller',
  summary: 'Added the poll and wired it to focus.',
  started: minutesAgo(50),
  lastActivity: minutesAgo(3),
  filesChanged: ['src/poll.ts', 'src/shell.ts'],
  commits: [{ sha: 'abcdef1234', subject: 'feat: poll version.json' }],
  todosTicked: ['Build step that writes version.json'],
  todosAdded: ['Banner copy'],
});
const quiet = rec({
  id: 'c0ffee00',
  taskId: 'version-file-rollout',
  started: minutesAgo(600),
  lastActivity: minutesAgo(540),
  ended: minutesAgo(540),
});
const stray = rec({ id: 'deadbeef', title: 'Looked at something else', started: minutesAgo(30) });
const records = [quiet, live, stray];
const groups = groupSessions(tasks, records, new Date(NOW));
const base = { groups, now: NOW, onselect: () => {} };

describe('groupSessions', () => {
  it('groups by task, newest first, with records before ids a task file only names', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'Release watch banner for stale tabs',
      'Roll the version file out to every app',
      'Not linked to a task',
    ]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['071729a1', 'b13e8b5e']);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['c0ffee00', '4c1d9a2b']);
    expect(sessionCount(groups)).toBe(5);
  });

  it('derives running and duration from the record', () => {
    const [first] = groups[0]!.items;
    expect(first?.running).toBe(true);
    expect(first?.durationMs).toBe(47 * 60_000);
    expect(groups[1]?.items[0]?.running).toBe(false);
  });

  it('files a record with no task id under the task that lists its id', () => {
    const g = groupSessions(tasks, [rec({ id: '4c1d9a2b', title: 'Linked by the hook' })], new Date(NOW));
    const rollout = g.find((x) => x.task?.id === 'version-file-rollout');
    expect(rollout?.items.map((i) => i.record?.title)).toEqual(['Linked by the hook']);
  });

  it('formats a duration in words', () => {
    expect(formatDuration(20_000)).toBe('under a minute');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(80 * 60_000)).toBe('1 h 20 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
  });
});

describe('Sessions, empty', () => {
  it('explains what would make a session appear', () => {
    const { container } = render(Sessions, { props: { ...base, groups: [] } });
    expect(screen.getByRole('heading', { name: /No sessions yet/ })).toBeTruthy();
    expect(container.querySelector('.session')).toBeNull();
  });
});

describe('Sessions, cards', () => {
  it('leads with the AI title, not the id, and falls back to Untitled session with the task', () => {
    const { container } = render(Sessions, { props: base });
    const titles = [...container.querySelectorAll('.s-title')].map((e) => e.textContent?.trim());
    expect(titles[0]).toBe('Build the version poller');
    expect(titles).toContain('Untitled session');
    /* No card shows a UUID until it is opened. */
    expect(container.textContent).not.toContain('071729a1');
    const untitled = [...container.querySelectorAll('.session')].find((c) =>
      c.textContent?.includes('Untitled session'),
    ) as HTMLElement;
    expect(untitled.querySelector('.s-task')?.textContent).toBeTruthy();
  });

  it('shows the summary, start, duration, a live dot and the three chips', () => {
    const { container } = render(Sessions, { props: base });
    const card = container.querySelector('.session') as HTMLElement;
    expect(card.textContent).toContain('Added the poll and wired it to focus.');
    expect(card.querySelector('.s-when')?.textContent).toBe('started 50 min ago, running 47 min');
    expect(card.querySelector('.live')).toBeTruthy();
    const chips = [...card.querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chips).toEqual(['2 files', '1 commit', '1 todo ticked']);
  });

  it('shows no live dot on a session that ended', () => {
    const { container } = render(Sessions, { props: base });
    const ended = [...container.querySelectorAll('.session')].find((c) =>
      c.textContent?.includes('started 10 h ago'),
    ) as HTMLElement;
    expect(ended.classList.contains('running')).toBe(false);
    expect(ended.querySelector('.s-when')?.textContent).toBe('started 10 h ago, 1 h');
  });

  it('says a session with no record has no record, rather than inventing times', () => {
    const { container } = render(Sessions, { props: base });
    const bare = [...container.querySelectorAll('.session')].filter((c) =>
      c.textContent?.includes('no record yet'),
    );
    expect(bare).toHaveLength(2);
  });

  it('expands to the lists, a copy id button and Resume', async () => {
    const onresume = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(Sessions, { props: { ...base, onresume } });
    const card = container.querySelector('.session') as HTMLElement;
    await fireEvent.click(within(card).getByRole('button', { name: /Build the version poller/ }));
    expect(card.textContent).toContain('src/poll.ts');
    expect(card.textContent).toContain('abcdef1');
    expect(card.textContent).toContain('feat: poll version.json');
    expect(card.textContent).toContain('Banner copy');
    await fireEvent.click(within(card).getByRole('button', { name: 'Copy session id' }));
    expect(writeText).toHaveBeenCalledWith('071729a1');
    await fireEvent.click(within(card).getByRole('button', { name: 'Resume in Claude' }));
    expect(onresume).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'release-watch-banner' }),
      '071729a1',
    );
  });

  it('opens the task from its group heading', async () => {
    const onselect = vi.fn();
    render(Sessions, { props: { ...base, onselect } });
    await fireEvent.click(screen.getByRole('button', { name: 'Release watch banner for stale tabs' }));
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-watch-banner' }));
  });

  it('no longer carries the footnote about sessions having no start time', () => {
    render(Sessions, { props: base });
    expect(screen.queryByText(/no start time/)).toBeNull();
  });
});
