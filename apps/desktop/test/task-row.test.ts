import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskRow from '../src/components/TaskRow.svelte';
import { DAY, DAY_PAST, plannedTask, repoStatus, taskA, taskB, taskC } from './fixtures.ts';

describe('TaskRow', () => {
  it('shows title, repo short name, git chips and progress as a proportion', () => {
    const task = taskA();
    const { container } = render(TaskRow, {
      props: { task, status: repoStatus(), day: DAY, onselect: () => {} },
    });
    expect(screen.getByText('Release watch banner for stale tabs')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText('feature/banner')).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
    expect(screen.getByText('2 uncommitted')).toBeTruthy();
    expect(screen.getByText('2 of 5')).toBeTruthy();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('40');
    expect(bar?.querySelectorAll('.seg')).toHaveLength(5);
    expect(bar?.querySelectorAll('.seg.on')).toHaveLength(2);
  });

  it('shows the priority rank when it is given one', () => {
    render(TaskRow, { props: { task: taskA(), rank: 3, onselect: () => {} } });
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('selects the task on click', async () => {
    const task = taskA();
    const onselect = vi.fn();
    render(TaskRow, { props: { task, onselect } });
    await fireEvent.click(screen.getByRole('button', { name: /Open Release watch/ }));
    expect(onselect).toHaveBeenCalledWith(task);
  });

  it('marks an overdue task late in words, not only in colour', () => {
    const { container } = render(TaskRow, {
      props: { task: plannedTask(DAY_PAST), day: DAY, onselect: () => {} },
    });
    expect(screen.getByText('4 days late')).toBeTruthy();
    expect(container.querySelector('.row.late')).toBeTruthy();
  });

  it('names a future planned day and is not late', () => {
    const { container } = render(TaskRow, {
      props: { task: plannedTask('2026-09-16'), day: DAY, onselect: () => {} },
    });
    expect(screen.getByText('planned tomorrow')).toBeTruthy();
    expect(container.querySelector('.row.late')).toBeNull();
  });

  it('suppresses the planned chip where the block heading already says today', () => {
    render(TaskRow, {
      props: { task: plannedTask(DAY), day: DAY, showPlanned: false, onselect: () => {} },
    });
    expect(screen.queryByText('planned today')).toBeNull();
  });

  it('remembers out loud: the newest note, dated, on one line', () => {
    const props = { task: taskC(), day: DAY, onselect: () => {} };
    const { container } = render(TaskRow, { props });
    const recall = container.querySelector('.recall');
    expect(recall?.textContent).toContain('Chunk load errors are the safety net');
    /* The newest note wins, and only its first line is shown. */
    expect(recall?.textContent).not.toContain('Polling a static file');
    expect(recall?.textContent).not.toContain('reload recovered it');
    expect(recall?.querySelector('.recall-when')?.textContent).toMatch(/14 Sep|yesterday/);
    expect(recall?.classList.contains('trunc')).toBe(true);
  });

  it('says nothing where there is nothing to remember', () => {
    const { container } = render(TaskRow, { props: { task: taskA(), onselect: () => {} } });
    expect(container.querySelector('.recall')).toBeNull();
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

  it('shows no chips and no progress bar when there is no repo and no checklist', () => {
    const task = { ...taskB(), checklist: [] };
    const { container } = render(TaskRow, { props: { task, onselect: () => {} } });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('.chip')).toBeNull();
    expect(screen.getByText('no checklist yet')).toBeTruthy();
  });

  it('shows no git chips for a repo that has not been scanned', () => {
    const { container } = render(TaskRow, { props: { task: taskA(), onselect: () => {} } });
    expect(container.querySelector('.chip')).toBeNull();
    expect(screen.getByText('app')).toBeTruthy();
  });
});
