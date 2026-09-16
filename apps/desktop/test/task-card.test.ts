import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskCard from '../src/components/TaskCard.svelte';
import { DAY, DAY_PAST, plannedTask, repoStatus, taskA, taskB, taskC } from './fixtures.ts';

const base = { day: DAY, onselect: () => {} };

describe('TaskCard, closed', () => {
  it('leads with the project, its state and where it lives', () => {
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), status: repoStatus() },
    });
    expect(screen.getByRole('button', { name: /Release watch banner/ })).toBeTruthy();
    expect(container.querySelector('.chip')?.textContent).toContain('In Progress');
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText('feature/banner')).toBeTruthy();
    expect(screen.getByText('2 of 5')).toBeTruthy();
  });

  it('keeps the detail closed, so a list of projects is a list of projects', () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskC() } });
    expect(container.querySelector('.detail')).toBeNull();
    /* The old row dumped three checklist items and a truncated note here. Only the next
       action survives, and only because it is the one line worth having. */
    expect(screen.queryByText('Banner in the shell')).toBeNull();
    expect(screen.queryByText('Build step writes version.json')).toBeNull();
    expect(screen.queryByText(/Polling a static file/)).toBeNull();
    expect(container.querySelector('[aria-expanded="false"]')).toBeTruthy();
  });

  it('shows the branch in monospace and the git state as words beside it', () => {
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), status: repoStatus() },
    });
    expect(container.querySelector('.branch')?.classList.contains('mono')).toBe(true);
    expect(screen.getByText('2 uncommitted')).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
  });

  it('claims an agent only for a task that really carries session ids', () => {
    const withSessions = render(TaskCard, {
      props: { ...base, task: taskA(), status: repoStatus() },
    });
    expect(withSessions.getByText('Claude Code')).toBeTruthy();
    withSessions.unmount();

    /* taskB has `sessions: []`, so there is no agent to name. */
    const none = render(TaskCard, { props: { ...base, task: taskB() } });
    expect(none.queryByText('Claude Code')).toBeNull();
  });

  it('spells lateness out and stripes the card, so colour is never the only signal', () => {
    const { container } = render(TaskCard, { props: { ...base, task: plannedTask(DAY_PAST) } });
    expect(screen.getByText('4 days late')).toBeTruthy();
    expect(container.querySelector('.task.late')).toBeTruthy();
  });

  it('opens the full task when the title is clicked', async () => {
    const onselect = vi.fn();
    const task = taskA();
    render(TaskCard, { props: { ...base, task, onselect } });
    await fireEvent.click(screen.getByRole('button', { name: /Release watch banner/ }));
    expect(onselect).toHaveBeenCalledWith(task);
  });
});

describe('TaskCard, the next action', () => {
  it('quotes the first unticked checklist item and says where it came from', () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskA() } });
    const next = container.querySelector('.next');
    expect(next?.textContent).toContain('Build step that writes version.json');
    expect(next?.textContent).toContain('from the checklist');
  });

  it('falls back to the first plan step only when there is no checklist at all', () => {
    const planOnly = { ...taskC(), checklist: [] };
    const { container } = render(TaskCard, { props: { ...base, task: planOnly } });
    const next = container.querySelector('.next');
    expect(next?.textContent).toContain('Write version.json in the build step');
    expect(next?.textContent).toContain('from the plan');
  });

  it('shows nothing at all rather than inventing one', () => {
    const allTicked = {
      ...taskC(),
      checklist: taskC().checklist.map((i) => ({ ...i, done: true })),
    };
    const { container } = render(TaskCard, { props: { ...base, task: allTicked } });
    expect(container.querySelector('.next')).toBeNull();

    const bare = render(TaskCard, {
      props: { ...base, task: { ...taskA(), checklist: [], plan: [] } },
    });
    expect(bare.container.querySelector('.next')).toBeNull();
  });
});

describe('TaskCard, opened', () => {
  it('answers where it stands, then the plan, then what is done, in that order', async () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskC() } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    const labels = [...container.querySelectorAll('.detail .section-label')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels[0]).toContain('Where it stands');
    expect(labels[1]).toContain('Planned steps');
    expect(labels[2]).toContain('Already done');
  });

  it('shows the newest note in full as where the task stands', async () => {
    render(TaskCard, { props: { ...base, task: taskC() } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    expect(screen.getByText(/Chunk load errors are the safety net/)).toBeTruthy();
    /* Reflowed into one paragraph, not left hard-wrapped mid-sentence. */
    expect(screen.getByText(/reload recovered it/)).toBeTruthy();
    expect(screen.queryByText(/Polling a static file/)).toBeNull();
  });

  it('lists the plan as written and the ticked items as ticked', async () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskC() } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    const steps = [...container.querySelectorAll('.plan-list li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Write version.json in the build step',
      'Poll it on an interval and on window focus',
      'Show the banner and reload only when the tab is idle',
    ]);
    expect(screen.getByText('Build step writes version.json')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Already done 1 of 3/ })).toBeTruthy();
  });

  it('says the file is silent rather than filling the space', async () => {
    render(TaskCard, { props: { ...base, task: taskA() } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    expect(screen.getByText(/No note yet/)).toBeTruthy();
    expect(screen.getByText(/No plan written/)).toBeTruthy();
  });

  it('closes again from the same control', async () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskC() } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    expect(container.querySelector('.detail')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Hide detail/ }));
    expect(container.querySelector('.detail')).toBeNull();
  });
});

describe('TaskCard, the overflow menu', () => {
  it('has no menu button when it was given no actions', () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskA() } });
    expect(container.querySelector('.more')).toBeNull();
  });

  it('runs the action that was chosen, then closes', async () => {
    const run = vi.fn();
    const task = taskA();
    const { container } = render(TaskCard, {
      props: { ...base, task, actions: [{ label: 'Mark done', run }] },
    });
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Mark done' }));
    expect(run).toHaveBeenCalledWith(task);
    expect(container.querySelector('.menu')).toBeNull();
  });

  it('closes on Escape without running anything', async () => {
    const run = vi.fn();
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), actions: [{ label: 'Park', run }] },
    });
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    await fireEvent.keyDown(container.querySelector('.menu') as HTMLElement, { key: 'Escape' });
    expect(container.querySelector('.menu')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
