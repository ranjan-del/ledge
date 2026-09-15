import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskRow from '../src/components/TaskRow.svelte';
import { repoStatus, taskA, taskB } from './fixtures.ts';

describe('TaskRow', () => {
  it('shows title, repo short name, git chips and progress', () => {
    const task = taskA();
    const { container } = render(TaskRow, {
      props: { task, status: repoStatus(), onselect: () => {} },
    });
    expect(screen.getByText('Release watch banner for stale tabs')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText('feature/banner')).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
    expect(screen.getByText('2 dirty')).toBeTruthy();
    expect(screen.getByText('2/5')).toBeTruthy();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('40');
  });

  it('selects the task on click', async () => {
    const task = taskA();
    const onselect = vi.fn();
    render(TaskRow, { props: { task, onselect } });
    await fireEvent.click(screen.getByRole('button', { name: /Open Release watch/ }));
    expect(onselect).toHaveBeenCalledWith(task);
  });

  it('shows the parked reason and Start / Open actions for backlog rows', async () => {
    const task = taskB();
    const onstart = vi.fn();
    const onopen = vi.fn();
    render(TaskRow, { props: { task, onselect: () => {}, onstart, onopen } });
    expect(screen.getByText('Parked: Waiting for design approval')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onstart).toHaveBeenCalledWith(task);
    await fireEvent.click(screen.getByRole('button', { name: 'Open in Claude' }));
    expect(onopen).toHaveBeenCalledWith(task);
  });

  it('hides git chips and progress when there is nothing to show', () => {
    const task = { ...taskB(), checklist: [] };
    const { container } = render(TaskRow, { props: { task, onselect: () => {} } });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('.chip')).toBeNull();
  });
});
