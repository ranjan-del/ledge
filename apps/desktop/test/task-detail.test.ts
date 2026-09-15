import { parseTask } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { TASK_A_FILE, repoStatus, taskA } from './fixtures.ts';

describe('TaskDetail', () => {
  it('renders requirement, checklist, sessions and git state', () => {
    render(TaskDetail, {
      props: { task: taskA(), status: repoStatus(), onback: () => {}, onsave: () => {} },
    });
    expect(screen.getByRole('heading', { name: 'Release watch banner for stale tabs' })).toBeTruthy();
    expect(screen.getByText(/Users keep old code in open tabs/)).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText(/2 sessions/)).toBeTruthy();
    expect(screen.getByText(/last 071729a1/)).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
  });

  it('ticking an item emits the serialized file with that item done', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave } });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[2].checked).toBe(false);
    await fireEvent.click(boxes[2]);
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
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    await fireEvent.click(boxes[0]);
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('- [ ] Investigated caching setup and why open tabs break');
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
