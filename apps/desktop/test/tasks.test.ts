import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Tasks from '../src/components/Tasks.svelte';
import { archived, repoStatus, taskA, taskB } from './fixtures.ts';

const base = {
  live: [taskA()],
  backlog: [taskB()],
  done: archived(),
  pending: [repoStatus()],
  doneCount: 2,
  onview: () => {},
  onselect: () => {},
  onadd: () => {},
};

describe('Tasks, the four views', () => {
  it('offers Live, Done, Backlog and Pending, each with its own count', () => {
    const { container } = render(Tasks, { props: { ...base, view: 'live' } });
    const buttons = [...container.querySelectorAll('.view')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(buttons).toEqual(['Live 1', 'Done 2', 'Backlog 1', 'Pending 1']);
  });

  it('reports the view that was pressed', async () => {
    const onview = vi.fn();
    render(Tasks, { props: { ...base, view: 'live', onview } });
    await fireEvent.click(screen.getByRole('button', { name: /Pending/ }));
    expect(onview).toHaveBeenCalledWith('pending');
  });

  it('shows live work as cards with an add row under it', () => {
    const { container } = render(Tasks, { props: { ...base, view: 'live' } });
    expect(container.querySelectorAll('.task')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeTruthy();
  });

  it('keeps the backlog add row, and says which list it adds to', () => {
    render(Tasks, { props: { ...base, view: 'backlog' } });
    expect(screen.getByRole('button', { name: 'Add to the backlog' })).toBeTruthy();
    expect(screen.getByText('Parked: Waiting for design approval')).toBeTruthy();
  });

  it('shows the archive on Done, as records rather than as a workbench', () => {
    const { container } = render(Tasks, { props: { ...base, view: 'done' } });
    expect(container.querySelectorAll('.done')).toHaveLength(2);
    expect(container.querySelector('.task')).toBeNull();
    expect(container.querySelector('.pane-foot')).toBeNull();
  });

  it('shows the git scan on Pending, and nothing anybody can type', () => {
    const { container } = render(Tasks, { props: { ...base, view: 'pending' } });
    expect(container.querySelector('[data-repo]')).toBeTruthy();
    expect(container.querySelector('.pane-foot')).toBeNull();
  });

  it('makes Live a real list whose rows can be moved, and no other view', async () => {
    const onreorder = vi.fn();
    const live = [taskA(), { ...taskA(), file: 'second.md', id: 'second', order: 2 }];
    const { container, unmount } = render(Tasks, {
      props: { ...base, live, view: 'live', onreorder },
    });
    expect(container.querySelector('[role="list"]')).toBeTruthy();
    expect(container.querySelectorAll('.slot[draggable="true"]')).toHaveLength(2);
    await fireEvent.keyDown(screen.getAllByRole('button', { name: /Reorder/ })[1], {
      key: 'ArrowUp',
    });
    expect(onreorder).toHaveBeenCalledWith(1, 0);
    unmount();

    const parked = render(Tasks, { props: { ...base, view: 'backlog', onreorder } });
    expect(parked.container.querySelector('.grip')).toBeNull();
  });

  it('leaves a list of one alone, since there is nowhere for its row to go', () => {
    const { container } = render(Tasks, { props: { ...base, view: 'live', onreorder: () => {} } });
    expect(container.querySelector('.grip')).toBeNull();
    expect(container.querySelector('.slot[draggable="true"]')).toBeNull();
  });

  it('explains an empty list in the words that view needs', () => {
    const empty = { ...base, live: [], backlog: [], done: [], pending: [], doneCount: 0 };
    const live = render(Tasks, { props: { ...empty, view: 'live' } });
    expect(screen.getByText(/Nothing live/)).toBeTruthy();
    live.unmount();

    const parked = render(Tasks, { props: { ...empty, view: 'backlog' } });
    expect(screen.getByText('Nothing parked.')).toBeTruthy();
    parked.unmount();

    const pending = render(Tasks, { props: { ...empty, view: 'pending' } });
    expect(screen.getByText(/Everything is pushed and clean/)).toBeTruthy();
    pending.unmount();

    render(Tasks, { props: { ...empty, view: 'pending', scanning: true } });
    expect(screen.getByText('Scanning repositories')).toBeTruthy();
  });
});
