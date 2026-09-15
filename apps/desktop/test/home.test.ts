import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Home from '../src/components/Home.svelte';
import { DAY, DAY_PAST, plannedTask, taskA, taskB } from './fixtures.ts';

const base = { current: [], today: [], overdue: [], day: DAY, onselect: () => {}, onadd: () => {} };

describe('Home, empty', () => {
  it('says where tasks live and offers the field, rather than just "nothing here"', () => {
    render(Home, { props: { ...base, store: '~/.ledge/tasks' } });
    expect(screen.getByRole('heading', { name: 'Nothing in progress.' })).toBeTruthy();
    expect(screen.getByText(/Tasks are Markdown files in/)).toBeTruthy();
    expect(screen.getByText('~/.ledge/tasks')).toBeTruthy();
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });

  it('points at the backlog when there is one, and stays quiet when there is not', async () => {
    const onbacklog = vi.fn();
    render(Home, { props: { ...base, backlog: 2, onbacklog } });
    await fireEvent.click(screen.getByRole('button', { name: /2 in the backlog/ }));
    expect(onbacklog).toHaveBeenCalled();
  });

  it('shows no attention line and no second add row when the desk is empty', () => {
    const { container } = render(Home, { props: { ...base, attention: 3 } });
    expect(container.querySelector('.attention')).toBeNull();
    expect(container.querySelector('.pane-foot')).toBeNull();
    expect(screen.getAllByLabelText('Task title')).toHaveLength(1);
  });
});

describe('Home, with work on it', () => {
  it('answers today, then working on, then what needs attention, in that order', () => {
    const { container } = render(Home, {
      props: {
        ...base,
        today: [plannedTask(DAY, { file: 'today.md', title: 'Planned for today' })],
        overdue: [plannedTask(DAY_PAST, { file: 'late.md', title: 'Missed it' })],
        current: [taskA()],
        plannedToday: 1,
        attention: 3,
        onpending: () => {},
      },
    });
    const headings = [...container.querySelectorAll('h2')].map((h) =>
      h.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(headings[0]).toContain('Today');
    expect(headings[1]).toContain('Working on');
    const blocks = [...container.querySelectorAll('.pane-scroll > *')].map((el) => el.className);
    expect(blocks[blocks.length - 1]).toContain('attention');
  });

  it('counts every current task in the Working on heading, wherever it is shown', () => {
    render(Home, { props: { ...base, current: [taskA()], plannedToday: 2 } });
    const head = screen.getByRole('heading', { name: /Working on/ });
    expect(head.textContent).toContain('3');
  });

  it('numbers the rows it shows in display order, with no holes in the sequence', () => {
    const { container } = render(Home, {
      props: { ...base, current: [taskA()], plannedToday: 2, today: [plannedTask(DAY)] },
    });
    const ranks = [...container.querySelectorAll('.block .rank')].map((el) => el.textContent);
    expect(ranks).toEqual(['1', '2']);
  });

  it('explains an empty Working on block instead of leaving a gap', () => {
    render(Home, { props: { ...base, today: [plannedTask(DAY)], current: [], plannedToday: 1 } });
    expect(screen.getByText(/Everything you are working on is on today's list/)).toBeTruthy();
  });

  it('takes you to Pending from one quiet line, and hides it when nothing is pending', async () => {
    const onpending = vi.fn();
    const { unmount } = render(Home, {
      props: { ...base, current: [taskA()], attention: 3, onpending },
    });
    await fireEvent.click(screen.getByRole('button', { name: /3 repositories have/ }));
    expect(onpending).toHaveBeenCalled();
    unmount();
    const { container } = render(Home, {
      props: { ...base, current: [taskA()], attention: 0, onpending },
    });
    expect(container.querySelector('.attention')).toBeNull();
  });

  it('says "repository has" for one, so the line reads as English', () => {
    render(Home, { props: { ...base, current: [taskA()], attention: 1, onpending: () => {} } });
    expect(screen.getByRole('button', { name: /1 repository has/ })).toBeTruthy();
  });

  it('keeps the add row out of the scrolling list once there is work to scroll', () => {
    const { container } = render(Home, { props: { ...base, current: [taskA(), taskB()] } });
    expect(container.querySelector('.pane-foot')).toBeTruthy();
    expect(container.querySelector('.pane-scroll .pane-foot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeTruthy();
  });

  it('opens the task that was clicked', async () => {
    const onselect = vi.fn();
    const task = taskA();
    render(Home, { props: { ...base, current: [task], onselect } });
    await fireEvent.click(screen.getByRole('button', { name: /Open Release watch/ }));
    expect(onselect).toHaveBeenCalledWith(task);
  });
});
