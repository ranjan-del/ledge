import { parseTask } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { DAY, TASK_A_FILE, repoStatus, taskA, taskC } from './fixtures.ts';

function boxNamed(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement;
}

describe('TaskDetail', () => {
  it('renders requirement, checklist, sessions and git state', () => {
    render(TaskDetail, {
      props: { task: taskA(), status: repoStatus(), onback: () => {}, onsave: () => {} },
    });
    const title = 'Release watch banner for stale tabs';
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(/Users keep old code in open tabs/)).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText(/2 sessions/)).toBeTruthy();
    expect(screen.getByText(/last 071729a1/)).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
  });

  it('groups the checklist into remaining and done with counts', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskA(), onback: () => {}, onsave: () => {} },
    });
    const groups = [...container.querySelectorAll('.group')].map((g) =>
      g.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(groups).toEqual(['Remaining 3', 'Done 2']);
    expect(boxNamed('Investigated caching setup and why open tabs break').checked).toBe(true);
    expect(boxNamed('Build step that writes version.json').checked).toBe(false);
  });

  it('shows the plan as a numbered list and the notes newest first with their dates', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    const steps = [...container.querySelectorAll('.plan-list li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Write version.json in the build step',
      'Poll it on an interval and on window focus',
      'Show the banner and reload only when the tab is idle',
    ]);
    const dates = [...container.querySelectorAll('.note-date')].map((p) =>
      p.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(dates[0]).toContain('yesterday');
    expect(dates[0]).toContain('latest');
    /* The month name comes from the host locale, so match loosely on purpose. */
    expect(dates[1]).toMatch(/12 Sep/);
    expect(screen.getByText(/Chunk load errors are the safety net/)).toBeTruthy();
  });

  it('shows how late the planned day is', () => {
    render(TaskDetail, { props: { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} } });
    expect(screen.getByText('4 days late')).toBeTruthy();
  });

  it('ticking an item emits the serialized file with that item done', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave } });
    const box = boxNamed('Build step that writes version.json');
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    expect(onsave).toHaveBeenCalledTimes(1);
    const [file, markdown] = onsave.mock.calls[0] as [string, string];
    expect(file).toBe(TASK_A_FILE);
    expect(markdown).toContain('- [x] Build step that writes version.json');
    expect(markdown).toContain('- [ ] ReleaseWatchService with polling and focus listener');
    const reparsed = parseTask(markdown, file);
    expect(reparsed.checklist.map((i) => i.done)).toEqual([true, true, true, false, false]);
    expect(reparsed.title).toBe('Release watch banner for stale tabs');
  });

  it('unticking an item emits the file with that item open', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave } });
    await fireEvent.click(boxNamed('Investigated caching setup and why open tabs break'));
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('- [ ] Investigated caching setup and why open tabs break');
  });

  it('keeps the plan and the notes in the file when a checklist item is ticked', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskC(), onback: () => {}, onsave } });
    await fireEvent.click(boxNamed('Poll on focus'));
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('## Plan');
    expect(markdown).toContain('## Notes');
    expect(markdown).toContain('### 2026-09-14');
    expect(markdown).toContain('planned: 2026-09-11');
  });

  it('asks before it deletes, and does nothing at all on the first press', async () => {
    const ondelete = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this task?')).toBeTruthy();
    expect(screen.getByRole('group', { name: /Confirm deleting/ })).toBeTruthy();
  });

  it('deletes on the second press, and only then', async () => {
    const ondelete = vi.fn();
    const task = taskA();
    render(TaskDetail, { props: { task, onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ondelete).toHaveBeenCalledTimes(1);
    expect(ondelete).toHaveBeenCalledWith(task);
  });

  it('takes Cancel and Escape as no, and puts the question away', async () => {
    const ondelete = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this task?')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this task?')).toBeNull();
  });

  it('offers no delete control at all when the view was given no way to delete', () => {
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {} } });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('wires back, resume, done and park actions', async () => {
    const onback = vi.fn();
    const onresume = vi.fn();
    const ondone = vi.fn();
    const onpark = vi.fn();
    const task = taskA();
    render(TaskDetail, { props: { task, onback, onsave: () => {}, onresume, ondone, onpark } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onback).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Resume in Claude' }));
    expect(onresume).toHaveBeenCalledWith(task, true);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(ondone).toHaveBeenCalledWith(task);
    await fireEvent.click(screen.getByRole('button', { name: 'Park' }));
    const input = screen.getByPlaceholderText('Why is this parked?') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Blocked on API' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Park it' }));
    expect(onpark).toHaveBeenCalledWith(task, 'Blocked on API');
  });
});
