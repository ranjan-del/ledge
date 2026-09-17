import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskCard from '../src/components/TaskCard.svelte';
import { DAY, DAY_PAST, plannedTask, repoStatus, taskA, taskB, taskC } from './fixtures.ts';

const base = { day: DAY, onselect: () => {} };

/*
 * jsdom builds a plain Event for drag types, which carries neither a pointer position nor a
 * data transfer, so both have to be put there by hand. A MouseEvent is the closest thing jsdom
 * has to a DragEvent and it carries the one coordinate the drop arithmetic reads.
 */
function dragEvent(type: string, clientY: number, dataTransfer: unknown): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function dragOverAt(el: HTMLElement, clientY: number, dataTransfer: unknown) {
  return fireEvent(el, dragEvent('dragover', clientY, dataTransfer));
}

function dropOn(el: HTMLElement, dataTransfer: unknown) {
  return fireEvent(el, dragEvent('drop', 0, dataTransfer));
}

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
    /* The old row dumped three checklist items and a truncated note here. Only the two work
       lines survive, and only because they are the two lines worth having. */
    expect(screen.queryByText('Build step writes version.json')).toBeNull();
    expect(screen.queryByText(/Polling a static file/)).toBeNull();
    expect(container.querySelectorAll('.work')).toHaveLength(2);
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

describe('TaskCard, current and next', () => {
  it('quotes the first unticked item as Current and the one after it as Next', () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskA() } });
    const current = container.querySelector('.work.current');
    const next = container.querySelector('.work.next');
    expect(current?.textContent).toContain('Build step that writes version.json');
    expect(current?.textContent).toContain('from the checklist');
    expect(next?.textContent).toContain('ReleaseWatchService with polling and focus listener');
    expect(next?.textContent).toContain('from the checklist');
  });

  it('skips over items already ticked when it looks for the one after', () => {
    /* Only the second and the fifth are open, so Next is the fifth rather than the third. */
    const task = taskA();
    const checklist = task.checklist.map((item, i) => ({ ...item, done: i !== 1 && i !== 4 }));
    const { container } = render(TaskCard, { props: { ...base, task: { ...task, checklist } } });
    expect(container.querySelector('.work.current')?.textContent).toContain(
      'Design agreed: version.json polling, banner, idle reload',
    );
    expect(container.querySelector('.work.next')?.textContent).toContain(
      'Banner component in the shell',
    );
  });

  it('shows Current alone when it is the last item left, rather than inventing a Next', () => {
    const task = taskA();
    const checklist = task.checklist.map((item, i) => ({ ...item, done: i !== 0 }));
    const { container } = render(TaskCard, { props: { ...base, task: { ...task, checklist } } });
    expect(container.querySelector('.work.current')).toBeTruthy();
    expect(container.querySelector('.work.next')).toBeNull();
  });

  it('falls back to the plan, both lines, only when there is no checklist at all', () => {
    const planOnly = { ...taskC(), checklist: [] };
    const { container } = render(TaskCard, { props: { ...base, task: planOnly } });
    expect(container.querySelector('.work.current')?.textContent).toContain(
      'Write version.json in the build step',
    );
    expect(container.querySelector('.work.current')?.textContent).toContain('from the plan');
    expect(container.querySelector('.work.next')?.textContent).toContain(
      'Poll it on an interval and on window focus',
    );
  });

  it('shows nothing at all rather than inventing one', () => {
    const allTicked = {
      ...taskC(),
      checklist: taskC().checklist.map((i) => ({ ...i, done: true })),
    };
    const { container } = render(TaskCard, { props: { ...base, task: allTicked } });
    expect(container.querySelector('.work')).toBeNull();

    const bare = render(TaskCard, {
      props: { ...base, task: { ...taskA(), checklist: [], plan: [] } },
    });
    expect(bare.container.querySelector('.work')).toBeNull();
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

  it('shows only the next three outstanding items, and counts the rest', async () => {
    const task = taskA();
    const extra = Array.from({ length: 4 }, (_, i) => ({ text: `Extra ${i + 1}`, done: false }));
    /* No plan, so the open card falls back to what is left on the checklist. */
    const { container } = render(TaskCard, {
      props: { ...base, task: { ...task, plan: [], checklist: [...task.checklist, ...extra] } },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    /* The first list in the detail is what is left; the second is what is already ticked. */
    const open = container.querySelectorAll('.detail .item-list')[0] as HTMLElement;
    const items = [...open.querySelectorAll('li')].map((li) => li.textContent?.trim());
    expect(items).toEqual([
      'Build step that writes version.json',
      'ReleaseWatchService with polling and focus listener',
      'Banner component in the shell',
    ]);
    expect(screen.getByText('and 4 more still to do')).toBeTruthy();
  });

  it('counts nothing when three is the whole of what is left', async () => {
    render(TaskCard, { props: { ...base, task: { ...taskA(), plan: [] } } });
    await fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    expect(screen.queryByText(/more still to do/)).toBeNull();
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

  it('closes on a press outside it, and leaves a press inside it alone', async () => {
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), actions: [{ label: 'Park', run: () => {} }] },
    });
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    await fireEvent.pointerDown(container.querySelector('.menu') as HTMLElement);
    expect(container.querySelector('.menu')).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    expect(container.querySelector('.menu')).toBeNull();
  });

  it('overlays the card instead of displacing it, so no band of empty card is left', async () => {
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), status: repoStatus(), actions: [{ label: 'Park', run: () => {} }] },
    });
    const before = container.querySelectorAll('.face > *').length;
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    const menu = container.querySelector('.menu') as HTMLElement;
    /* Out of the card's own column entirely: it is a sibling of the card, not a row in it. */
    expect(menu.closest('.face')).toBeNull();
    expect(menu.closest('.task')).toBeNull();
    expect(menu.parentElement?.classList.contains('slot')).toBe(true);
    expect(container.querySelectorAll('.face > *').length).toBe(before);
  });

  it('puts the focus in the menu, and hands it back to the button on Escape', async () => {
    const { container } = render(TaskCard, {
      props: { ...base, task: taskA(), actions: [{ label: 'Park', run: () => {} }] },
    });
    const more = screen.getByRole('button', { name: /More actions/ });
    await fireEvent.click(more);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Park' }));
    await fireEvent.keyDown(container.querySelector('.menu') as HTMLElement, { key: 'Escape' });
    expect(document.activeElement).toBe(more);
  });

  it('walks the menu with the arrow keys', async () => {
    const actions = [
      { label: 'Open task', run: () => {} },
      { label: 'Park', run: () => {} },
      { label: 'Mark done', run: () => {} },
    ];
    const { container } = render(TaskCard, { props: { ...base, task: taskA(), actions } });
    await fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    const menu = container.querySelector('.menu') as HTMLElement;
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Park' }));
    await fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Mark done' }));
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open task' }));
  });
});

describe('TaskCard, moving a row', () => {
  const movable = { ...base, task: taskA(), index: 1, total: 3 };

  it('has no grip at all in a list whose order nobody owns', () => {
    const { container } = render(TaskCard, { props: { ...base, task: taskA() } });
    expect(container.querySelector('.grip')).toBeNull();
    expect(container.querySelector('.slot')?.getAttribute('draggable')).toBe('false');
  });

  it('is draggable and gripped once it is given somewhere to move to', () => {
    const { container } = render(TaskCard, { props: { ...movable, onmove: () => {} } });
    expect(container.querySelector('.slot')?.getAttribute('draggable')).toBe('true');
    expect(screen.getByRole('button', { name: /Reorder .*2 of 3/ })).toBeTruthy();
  });

  it('moves up and down from the keyboard, and refuses to walk off either end', async () => {
    const onmove = vi.fn();
    const { unmount } = render(TaskCard, { props: { ...movable, onmove } });
    const grip = screen.getByRole('button', { name: /Reorder/ });
    await fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(onmove).toHaveBeenLastCalledWith(1, 0);
    await fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onmove).toHaveBeenLastCalledWith(1, 2);
    await fireEvent.keyDown(grip, { key: 'Home' });
    expect(onmove).toHaveBeenLastCalledWith(1, 0);
    await fireEvent.keyDown(grip, { key: 'End' });
    expect(onmove).toHaveBeenLastCalledWith(1, 2);
    expect(onmove).toHaveBeenCalledTimes(4);
    unmount();

    const first = render(TaskCard, { props: { ...movable, index: 0, onmove } });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Reorder/ }), { key: 'ArrowUp' });
    expect(onmove).toHaveBeenCalledTimes(4);
    first.unmount();

    render(TaskCard, { props: { ...movable, index: 2, onmove } });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Reorder/ }), { key: 'ArrowDown' });
    expect(onmove).toHaveBeenCalledTimes(4);
  });

  it('reports where a dropped row lands, counting the slot it vacated', async () => {
    const onmove = vi.fn();
    const { container } = render(TaskCard, { props: { ...movable, onmove } });
    const slot = container.querySelector('.slot') as HTMLElement;
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: 'move',
      dropEffect: 'move',
    };

    /* Dragged from the bottom, dropped on the upper half of this row: it takes this row's
       place. jsdom has no layout, so every box is at the origin and "above the middle" is any
       negative y. */
    data.set('text/plain', '2');
    await dragOverAt(slot, -1, dataTransfer);
    await dropOn(slot, dataTransfer);
    expect(onmove).toHaveBeenLastCalledWith(2, 1);

    /* Dragged from the top, dropped on the lower half: it takes the place after this row,
       which is index 1 rather than 2 because it vacated the slot above on the way. */
    data.set('text/plain', '0');
    await dragOverAt(slot, 10_000, dataTransfer);
    await dropOn(slot, dataTransfer);
    expect(onmove).toHaveBeenLastCalledWith(0, 1);
    expect(onmove).toHaveBeenCalledTimes(2);
  });

  it('says nothing when the drop would not move the row anywhere', async () => {
    const onmove = vi.fn();
    const { container } = render(TaskCard, { props: { ...movable, onmove } });
    const slot = container.querySelector('.slot') as HTMLElement;
    const dataTransfer = { setData: () => {}, getData: () => '1' };
    /* Dropped on itself. */
    await dropOn(slot, dataTransfer);
    /* Dropped just above itself by the row already above it, which is where it already is. */
    await dragOverAt(slot, -1, { setData: () => {}, getData: () => '0' });
    await dropOn(slot, { setData: () => {}, getData: () => '0' });
    expect(onmove).not.toHaveBeenCalled();
  });
});
