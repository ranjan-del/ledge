/**
 * Dragging a card sideways to move the task to another list, and the same move from the
 * keyboard. What is being proved is that the gesture is biased towards reorder, that it shows
 * its destination before the person lets go, that archiving asks first, and that a direction
 * with nowhere to go says so.
 *
 * jsdom has no drag machinery and no layout, so the events and their coordinates are made by
 * hand. That is fine here: every decision the card makes about a drag is made from the travel
 * since `dragstart`, which is exactly what these events carry.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskCard from '../src/components/TaskCard.svelte';
import { SHIFT_PX, clearAsk, endDrag } from '../src/lib/drag.svelte.ts';
import { DAY, taskA, taskB } from './fixtures.ts';

const base = { day: DAY, onselect: () => {} };

/** A live task in a list of three. Add `onmove` for the reorder half, `onshift` for the other. */
const live = { ...base, task: taskA(), index: 1, total: 3 };
/** The grip, whichever of its two promises this card is making. */
const GRIP = /Reorder|to another list/;
/** A parked task. Its list has no order, so the grip's only job is left and right. */
const parked = { ...base, task: taskB() };

function transfer() {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
  };
}

function dragEvent(type: string, x: number, y: number, dataTransfer: unknown): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

/** The whole gesture: press, travel, let go. `dx` and `dy` are the travel from where it began. */
async function gesture(slot: HTMLElement, dx: number, dy: number, release = true) {
  const dt = transfer();
  await fireEvent(slot, dragEvent('dragstart', 100, 100, dt));
  await fireEvent(slot, dragEvent('drag', 100 + dx, 100 + dy, dt));
  if (release) await fireEvent(slot, dragEvent('drop', 100 + dx, 100 + dy, dt));
  await fireEvent(slot, dragEvent('dragend', 100 + dx, 100 + dy, dt));
}

/** The travel so far, without letting go, so the card can be read mid-gesture. */
async function hold(slot: HTMLElement, dx: number, dy: number) {
  const dt = transfer();
  await fireEvent(slot, dragEvent('dragstart', 100, 100, dt));
  await fireEvent(slot, dragEvent('drag', 100 + dx, 100 + dy, dt));
}

function slotOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.slot') as HTMLElement;
}

beforeEach(() => {
  endDrag();
  clearAsk();
});

describe('TaskCard, dragged sideways', () => {
  it('has no sideways move at all in a list that cannot change a status', () => {
    /* Movable but not shiftable: the grip promises reordering and nothing else, and says so. */
    const { container } = render(TaskCard, { props: { ...live, onmove: vi.fn() } });
    expect(slotOf(container).getAttribute('draggable')).toBe('true');
    expect(screen.getByRole('button', { name: /Reorder/ }).getAttribute('title')).toBe(
      'Drag to reorder, or use the arrow keys',
    );
  });

  it('promises both halves on a list that has an order and a status', () => {
    render(TaskCard, { props: { ...live, onmove: vi.fn(), onshift: vi.fn() } });
    const title = screen.getByRole('button', { name: /Reorder/ }).getAttribute('title') ?? '';
    expect(title).toContain('up or down to reorder');
    expect(title).toContain('left or right');
  });

  it('is draggable in the backlog, where there is no order but there is a status', () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...parked, onshift } });
    expect(slotOf(container).getAttribute('draggable')).toBe('true');
    const grip = screen.getByRole('button', { name: /Move .* to another list/ });
    expect(grip.getAttribute('title')).toContain('left or right');
  });

  it('shows nothing and moves nothing while the drag is still a reorder', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await hold(slotOf(container), SHIFT_PX - 10, 4);
    expect(container.querySelector('.shift-aim')).toBeNull();
    await gesture(slotOf(container), SHIFT_PX - 10, 4);
    expect(onshift).not.toHaveBeenCalled();
  });

  it('shows where a live task is going before it is let go', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await hold(slotOf(container), -SHIFT_PX - 20, 4);
    const aim = container.querySelector('.shift-aim') as HTMLElement;
    expect(aim.textContent).toContain('Backlog');
    expect(aim.textContent).toContain('←');
    expect(aim.classList.contains('no')).toBe(false);
    /* And the card is outlined rather than faded, because this is not a reorder. */
    expect(slotOf(container).classList.contains('shifting')).toBe(true);
    expect(onshift).not.toHaveBeenCalled();
  });

  it('writes the status through the store when a live task is dropped to the left', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await gesture(slotOf(container), -SHIFT_PX - 20, 4);
    expect(onshift).toHaveBeenCalledTimes(1);
    expect(onshift.mock.calls[0]?.[1]).toBe('backlog');
    expect((onshift.mock.calls[0]?.[0] as { file: string }).file).toBe(taskA().file);
  });

  it('takes a parked task to live on a drag to the right', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...parked, onshift } });
    await gesture(slotOf(container), SHIFT_PX + 20, 4);
    expect(onshift.mock.calls[0]?.[1]).toBe('current');
  });

  it('changes nothing when the gesture is abandoned rather than released', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await gesture(slotOf(container), -SHIFT_PX - 20, 4, false);
    expect(onshift).not.toHaveBeenCalled();
  });

  it('does not reorder when the gesture turned sideways', async () => {
    const onmove = vi.fn();
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onmove, onshift } });
    await gesture(slotOf(container), -SHIFT_PX - 20, 4);
    expect(onmove).not.toHaveBeenCalled();
    expect(onshift).toHaveBeenCalledTimes(1);
  });
});

describe('TaskCard, dragged towards Done', () => {
  it('asks in place instead of archiving on release', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await hold(slotOf(container), SHIFT_PX + 20, 4);
    expect((container.querySelector('.shift-aim') as HTMLElement).textContent).toContain('Done');
    await gesture(slotOf(container), SHIFT_PX + 20, 4);
    expect(onshift).not.toHaveBeenCalled();
    expect(
      screen.getByRole('group', { name: /Confirm marking .* done/ }),
    ).toBeTruthy();
    expect(screen.getByText('Mark done and archive the file?')).toBeTruthy();
  });

  it('archives on the second press, the same as the Delete control', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await gesture(slotOf(container), SHIFT_PX + 20, 4);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onshift).toHaveBeenCalledTimes(1);
    expect(onshift.mock.calls[0]?.[1]).toBe('done');
    expect(container.querySelector('.shift-ask')).toBeNull();
  });

  it('takes Cancel and Escape as no, and archives nothing', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...live, onshift } });
    await gesture(slotOf(container), SHIFT_PX + 20, 4);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onshift).not.toHaveBeenCalled();
    expect(container.querySelector('.shift-ask')).toBeNull();

    await gesture(slotOf(container), SHIFT_PX + 20, 4);
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(onshift).not.toHaveBeenCalled();
    expect(container.querySelector('.shift-ask')).toBeNull();
  });
});

describe('TaskCard, a direction with nowhere to go', () => {
  it('says why rather than accepting the gesture and doing nothing', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...parked, onshift } });
    await hold(slotOf(container), -SHIFT_PX - 20, 4);
    const aim = container.querySelector('.shift-aim') as HTMLElement;
    expect(aim.classList.contains('no')).toBe(true);
    expect(aim.textContent).toContain('Already parked');
    await gesture(slotOf(container), -SHIFT_PX - 20, 4);
    expect(onshift).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Already parked');
  });

  it('clears the reason when the next gesture starts', async () => {
    const onshift = vi.fn();
    const { container } = render(TaskCard, { props: { ...parked, onshift } });
    await gesture(slotOf(container), -SHIFT_PX - 20, 4);
    expect(screen.queryByRole('alert')).toBeTruthy();
    await hold(slotOf(container), 4, 40);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TaskCard, the grip from the keyboard', () => {
  it('moves a live task left and right, the same two moves the drag makes', async () => {
    const onshift = vi.fn();
    render(TaskCard, { props: { ...live, onshift } });
    const grip = screen.getByRole('button', { name: GRIP });
    await fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(onshift.mock.calls[0]?.[1]).toBe('backlog');
  });

  it('asks the same question about Done as the drag does', async () => {
    const onshift = vi.fn();
    render(TaskCard, { props: { ...live, onshift } });
    await fireEvent.keyDown(screen.getByRole('button', { name: GRIP }), { key: 'ArrowRight' });
    expect(onshift).not.toHaveBeenCalled();
    expect(screen.getByText('Mark done and archive the file?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onshift.mock.calls[0]?.[1]).toBe('done');
  });

  it('keeps up and down doing what they did, on the list that has an order', async () => {
    const onmove = vi.fn();
    const onshift = vi.fn();
    render(TaskCard, { props: { ...live, onmove, onshift } });
    const grip = screen.getByRole('button', { name: /Reorder/ });
    await fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(onmove).toHaveBeenLastCalledWith(1, 0);
    await fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onmove).toHaveBeenLastCalledWith(1, 2);
    expect(onshift).not.toHaveBeenCalled();
  });

  it('says why when the arrow points at nothing', async () => {
    const onshift = vi.fn();
    render(TaskCard, { props: { ...parked, onshift } });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Move .* to another list/ }), {
      key: 'ArrowLeft',
    });
    expect(onshift).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Already parked');
  });

  it('leaves the arrows alone on a card that can neither be reordered nor moved', async () => {
    render(TaskCard, { props: { ...base, task: taskA() } });
    expect(screen.queryByRole('button', { name: /Reorder|to another list/ })).toBeNull();
  });
});
