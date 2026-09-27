import { parseTask, serializeTask, type Task } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Digest from '../src/components/Digest.svelte';
import Memory from '../src/components/Memory.svelte';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { noteDigest, noteKey } from '../src/lib/digest.ts';
import { contentKey, type TaskInsights } from '@ledge/core/pure';
import { isAutoTask, mergeTask, withoutAutoOrigin } from '../src/lib/merge.ts';
import { memoryFor } from '@ledge/core/pure';
import { DAY, HOME, taskA, taskC } from './fixtures.ts';

const LONG_NOTE =
  'Polling a static file beats a service worker here. The app already fetches its config the ' +
  'same way. So there is nothing new to cache-bust. We also checked the CDN headers and they ' +
  'are fine for a short max-age.';

const LONG_STEP =
  'Wire the poller into the shell: start it after the first render, stop it when the tab is ' +
  'hidden, and restart it on focus. Keep the interval in config. Log each reload for the soak.';

function withLong(): Task {
  const t = taskC();
  return {
    ...t,
    plan: [LONG_STEP, ...t.plan.slice(1)],
    notes: [{ date: '2026-09-12', body: LONG_NOTE }, ...t.notes.slice(1)],
  };
}

function insightsFor(task: Task): TaskInsights {
  return {
    version: 1,
    taskId: task.id,
    headline: 'Poll built, banner next',
    phase: 'Poll on focus',
    notes: {
      [noteKey(task.notes[0]!)]: { title: 'Polling over a worker', summary: 'Reuses the config fetch.' },
    },
    plan: {
      [contentKey(task.plan[0]!)]: { title: 'Wire the poller', detail: 'Start, stop, restart.' },
      [contentKey(task.plan[1]!)]: { title: 'Poll on focus' },
    },
    updatedAt: '2026-09-15T10:00:00+05:30',
  };
}

const base = { day: DAY, onback: () => {}, onsave: () => {} };

describe('Digest', () => {
  it('shows a title and summary and keeps the original out of the page until asked', async () => {
    const note = { date: DAY, body: LONG_NOTE };
    const { container } = render(Digest, { props: { digest: noteDigest(note), original: LONG_NOTE } });
    expect(container.querySelector('.d-title')?.textContent).toContain(
      'Polling a static file beats a service worker here.',
    );
    expect(container.querySelector('.d-sum')?.textContent).toBe(
      'The app already fetches its config the same way. So there is nothing new to cache-bust.',
    );
    expect(screen.queryByText(/CDN headers/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Show the full note' }));
    expect(screen.getByText(/CDN headers/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide the full note' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('offers no disclosure when the digest already says everything', () => {
    const note = { date: DAY, body: 'Short and done.' };
    render(Digest, { props: { digest: noteDigest(note), original: note.body } });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks a title a model wrote', () => {
    const task = withLong();
    const d = noteDigest(task.notes[0]!, insightsFor(task));
    const { container } = render(Digest, { props: { digest: d, original: task.notes[0]!.body } });
    expect(container.querySelector('.d-ai')).toBeTruthy();
    expect(container.querySelector('.d-title')?.textContent).toContain('Polling over a worker');
  });
});

describe('TaskDetail, plan and notes as digests', () => {
  it('without insights, titles a long step from its own words and keeps the rest one press away', async () => {
    const { container } = render(TaskDetail, { props: { ...base, task: withLong() } });
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    const first = container.querySelector('.plan-list li') as HTMLElement;
    expect(first.querySelector('.step-title')?.textContent).toBe('Wire the poller into the shell');
    expect(first.querySelector('.d-sum')?.textContent).toContain('start it after the first render');
    expect(first.textContent).not.toContain('Log each reload');
    await fireEvent.click(screen.getByRole('button', { name: 'Show the full step' }));
    expect(first.querySelector('.d-full')?.textContent).toBe(LONG_STEP);
  });

  it('with insights, uses the stored title, marks the step in progress and shows the headline', async () => {
    const task = withLong();
    const { container } = render(TaskDetail, {
      props: { ...base, task, insights: insightsFor(task) },
    });
    expect(screen.getByText('Poll built, banner next')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    const titles = [...container.querySelectorAll('.plan-list .step-title')].map((e) => e.textContent);
    expect(titles[0]).toBe('Wire the poller');
    expect(titles[1]).toBe('Poll on focus');
    const now = container.querySelector('.plan-list li.now') as HTMLElement;
    expect(now.textContent).toContain('Poll on focus');
    expect(now.querySelector('.chip')?.textContent).toBe('now');
  });

  it('ignores an insight whose step text has since changed', async () => {
    const task = withLong();
    const stale = insightsFor({ ...task, plan: ['Something else entirely', ...task.plan.slice(1)] });
    const { container } = render(TaskDetail, { props: { ...base, task, insights: stale } });
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    expect(container.querySelector('.plan-list .step-title')?.textContent).toBe(
      'Wire the poller into the shell',
    );
  });

  it('shows earlier notes as a compact timeline of digests', async () => {
    const task = withLong();
    const { container } = render(TaskDetail, {
      props: { ...base, task, insights: insightsFor(task) },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Earlier notes/ }));
    const rows = [...container.querySelectorAll('.timeline > li')];
    expect(rows).toHaveLength(2);
    /* Newest first: the 14th, from the fallback, then the 12th, from insights. */
    expect(rows[0]?.querySelector('.d-title')?.textContent).toContain('Chunk load errors');
    expect(rows[1]?.querySelector('.d-title')?.textContent).toContain('Polling over a worker');
    expect(rows[1]?.textContent).not.toContain('CDN headers');
  });
});

describe('TaskDetail, a task capture created', () => {
  const autoTask = (): Task => ({ ...taskA(), meta: { origin: 'auto' } });

  it('carries an auto chip with Rename, Merge into and Delete', () => {
    render(TaskDetail, {
      props: {
        ...base,
        task: autoTask(),
        ondelete: () => {},
        onmerge: () => {},
        mergeTargets: [taskA(), taskC()],
      },
    });
    expect(screen.getByText('auto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Merge into…' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);
  });

  it('shows no chip on a task the person made', () => {
    render(TaskDetail, { props: { ...base, task: taskA() } });
    expect(screen.queryByText('auto')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('renaming claims the task, so the origin flag leaves the file', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { ...base, task: autoTask(), onsave } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Task title') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: 'Stale tab banner' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await Promise.resolve();
    const markdown = onsave.mock.calls[0]?.[1] as string;
    expect(markdown).toContain('title: Stale tab banner');
    expect(markdown).not.toContain('origin:');
  });

  it('merges into the chosen task', async () => {
    const onmerge = vi.fn();
    const target = taskC();
    render(TaskDetail, {
      props: { ...base, task: autoTask(), onmerge, mergeTargets: [target] },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Merge into…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onmerge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'release-watch-banner' }),
      expect.objectContaining({ id: 'version-file-rollout' }),
    );
  });
});

describe('Memory, notes as digests', () => {
  it('titles each note and uses insights when a lookup is given', () => {
    const task = withLong();
    const tasks = [task];
    const { container } = render(Memory, {
      props: {
        entries: memoryFor(tasks),
        taskFor: (id: string) => tasks.find((t) => t.id === id),
        onselect: () => {},
        day: DAY,
        insightsFor: () => insightsFor(task),
      },
    });
    const titles = [...container.querySelectorAll('.d-title')].map((e) => e.textContent ?? '');
    expect(titles.some((t) => t.includes('Polling over a worker'))).toBe(true);
    expect(titles.some((t) => t.includes('Chunk load errors'))).toBe(true);
  });
});

describe('mergeTask', () => {
  it('adds what is new, joins notes by day and never rewords the target', () => {
    const source: Task = {
      ...taskA(),
      plan: ['Write version.json in the build step', 'Log the reload'],
      notes: [
        { date: '2026-09-14', body: 'Seen from the other session.' },
        { date: '2026-09-10', body: 'Earliest.' },
      ],
      references: 'https://example.com',
    };
    const target = taskC();
    const merged = mergeTask(source, target);
    expect(merged.title).toBe(target.title);
    expect(merged.requirement).toBe(target.requirement);
    expect(merged.plan).toEqual([...target.plan, 'Log the reload']);
    expect(merged.notes.map((n) => n.date)).toEqual(['2026-09-10', '2026-09-12', '2026-09-14']);
    expect(merged.notes[2]?.body).toContain('Chunk load errors');
    expect(merged.notes[2]?.body).toContain('Seen from the other session.');
    expect(merged.sessions).toEqual(['4c1d9a2b', 'b13e8b5e', '071729a1']);
    expect(merged.checklist.length).toBe(target.checklist.length + source.checklist.length);
    expect(merged.references).toContain('https://example.com');
    /* Merging the same source again changes nothing. */
    expect(mergeTask(source, merged).checklist).toEqual(merged.checklist);
  });

  it('removes only the origin key when a task is claimed', () => {
    const t = { ...taskA(), meta: { origin: 'auto', owner: 'me' } };
    expect(isAutoTask(t)).toBe(true);
    expect(withoutAutoOrigin(t).meta).toEqual({ owner: 'me' });
    expect(withoutAutoOrigin({ ...taskA(), meta: { origin: 'auto' } }).meta).toBeUndefined();
  });

  it('round trips origin: auto through the task file', () => {
    const md = serializeTask({ ...taskA(), meta: { origin: 'auto' } }, { home: HOME });
    expect(md).toContain('origin: auto');
    expect(isAutoTask(parseTask(md, taskA().file, { home: HOME }))).toBe(true);
  });
});
