import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Now from '../src/components/Now.svelte';
import { DAY, DAY_PAST, plannedTask, taskA, taskB } from './fixtures.ts';

const base = {
  working: [],
  upNext: [],
  day: DAY,
  onselect: () => {},
  onadd: () => {},
};

describe('Now, empty', () => {
  it('is a heading, a field and a button, and nothing else', () => {
    const { container } = render(Now, { props: { ...base } });
    expect(screen.getByRole('heading', { name: 'Nothing in progress.' })).toBeTruthy();
    expect(screen.getByLabelText('Task title')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    const start = container.querySelector('.start') as HTMLElement;
    expect([...start.children].map((el) => el.tagName)).toEqual(['H2', 'FORM']);
  });

  it('greets nobody and counts nothing when there is nothing to count', () => {
    const { container } = render(Now, { props: { ...base, name: 'Ranjan', attention: 3 } });
    expect(container.querySelector('.greet')).toBeNull();
    expect(container.querySelector('.attention-line')).toBeNull();
    expect(container.querySelector('.pane-foot')).toBeNull();
  });

  it('adds the task the field was given', async () => {
    const onadd = vi.fn();
    render(Now, { props: { ...base, onadd } });
    await fireEvent.input(screen.getByLabelText('Task title'), {
      target: { value: 'Write the release notes' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onadd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Write the release notes', status: 'current' }),
    );
  });
});

describe('Now, with work on it', () => {
  const loaded = {
    ...base,
    working: [plannedTask(DAY, { file: 'today.md', title: 'Teacher Corner Web consolidation' })],
    upNext: [taskA()],
    name: 'Ranjan',
    summary: ['2 active tasks', '6 pending tasks'],
  };

  it('reads greeting, summary, currently working, up next, add row, in that order', () => {
    const { container } = render(Now, { props: { ...loaded } });
    const blocks = [...container.querySelectorAll('.pane-scroll > *')].map((el) => el.className);
    expect(blocks[0]).toContain('greet');
    const labels = [...container.querySelectorAll('.section-label')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels[0]).toContain('Currently working');
    expect(labels[1]).toContain('Up next');
    expect(container.querySelector('.pane-foot')).toBeTruthy();
  });

  it('greets the person by name at whatever hour it is', () => {
    render(Now, { props: { ...loaded } });
    const hello = screen.getByRole('heading', { level: 2 });
    expect(hello.textContent).toMatch(/^Good (morning|afternoon|evening), Ranjan/);
  });

  it('shows the summary clauses it was given and invents none of its own', () => {
    const { container } = render(Now, { props: { ...loaded } });
    expect(container.querySelector('.summary')?.textContent).toBe('2 active tasks · 6 pending tasks');
    const bare = render(Now, { props: { ...loaded, summary: [] } });
    expect(bare.container.querySelector('.summary')).toBeNull();
  });

  it('draws currently working as cards and up next as unchecked items', () => {
    const { container } = render(Now, { props: { ...loaded } });
    expect(container.querySelectorAll('.task')).toHaveLength(1);
    expect(container.querySelectorAll('.next-list .box')).toHaveLength(1);
    expect(screen.getByText('Release watch banner for stale tabs')).toBeTruthy();
  });

  it('hides a block that has no answer rather than showing an empty heading', () => {
    const { container } = render(Now, { props: { ...loaded, upNext: [] } });
    const labels = [...container.querySelectorAll('.section-label')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels.some((l) => l?.startsWith('Up next'))).toBe(false);
  });

  it('opens a task from either block', async () => {
    const onselect = vi.fn();
    const task = taskA();
    render(Now, { props: { ...loaded, upNext: [task], onselect } });
    await fireEvent.click(screen.getByRole('button', { name: /Release watch banner/ }));
    expect(onselect).toHaveBeenCalledWith(task);
  });

  it('takes you to Pending from one quiet line, and hides it when nothing is pending', async () => {
    const onpending = vi.fn();
    const { unmount } = render(Now, { props: { ...loaded, attention: 3, onpending } });
    await fireEvent.click(screen.getByRole('button', { name: /3 repositories have/ }));
    expect(onpending).toHaveBeenCalled();
    unmount();
    const quiet = render(Now, { props: { ...loaded, attention: 0, onpending } });
    expect(quiet.container.querySelector('.attention-line')).toBeNull();
  });

  it('spells the add shortcut out only when it was given one that works', () => {
    const { container, unmount } = render(Now, { props: { ...loaded, addShortcut: '⌘N' } });
    expect(container.querySelector('.pane-foot .kbd')?.textContent).toBe('⌘N');
    unmount();
    const plain = render(Now, { props: { ...loaded } });
    expect(plain.container.querySelector('.pane-foot .kbd')).toBeNull();
  });

  it('opens and focuses the add field when the shortcut key is bumped', async () => {
    const { rerender } = render(Now, { props: { ...loaded, addKey: 0 } });
    expect(screen.queryByLabelText('Task title')).toBeNull();
    await rerender({ ...loaded, addKey: 1 });
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });

  it('gives each card the actions it was handed, and none if it was handed none', async () => {
    const run = vi.fn();
    render(Now, { props: { ...loaded, upNext: [taskB()], actionsFor: () => [{ label: 'Park', run }] } });
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    expect(screen.getByRole('menuitem', { name: 'Park' })).toBeTruthy();
  });
});
