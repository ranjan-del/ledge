/**
 * How a to-do card reads a drag, kept pure so the feel can be tested without a pointer.
 *
 * It is the task card's gesture, not a new one: up and down reorders, and only a drag that has
 * travelled SHIFT_PX sideways and is DOMINANCE times more sideways than up or down counts as a
 * move to another week. The same two numbers, so a hand that knows one list knows the other.
 * The week cards use pointer events rather than the browser's drag and drop, so a press has to
 * travel START_PX before it is a drag at all; anything shorter is a click and opens the card.
 */
import { DOMINANCE, SHIFT_PX } from './drag.svelte.ts';

export { DOMINANCE, SHIFT_PX };

/** How far a press travels before it is a drag rather than a click. */
export const START_PX = 5;

/** A drag that has started, read one way or the other. */
export interface WeekDragRead {
  axis: 'x' | 'y';
  /** -1 for the previous week, 1 for the next, 0 while it is a reorder. */
  direction: -1 | 0 | 1;
}

/** True once a press has travelled far enough to be a drag. */
export function dragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= START_PX;
}

/**
 * Reads the travel so far. Like the task card, coming back towards the middle makes it a
 * reorder again, so the person can change their mind before letting go.
 */
export function readWeekDrag(dx: number, dy: number): WeekDragRead {
  if (Math.abs(dx) >= SHIFT_PX && Math.abs(dx) > Math.abs(dy) * DOMINANCE) {
    return { axis: 'x', direction: dx < 0 ? -1 : 1 };
  }
  return { axis: 'y', direction: 0 };
}

/**
 * Where a card being dragged would land, as an index in the list it came from. `mids` are the
 * vertical middles of every card as laid out when the drag began, and `centre` is where the
 * dragged card's middle is now. It lands after every other card whose middle it has passed.
 */
export function dropIndex(mids: number[], from: number, centre: number): number {
  let to = 0;
  mids.forEach((mid, i) => {
    if (i !== from && mid < centre) to += 1;
  });
  return to;
}

/**
 * How far a card that is not being dragged steps aside to open the gap, in pixels: the height
 * of the dragged card, up or down, for the cards between where it was and where it would land.
 */
export function gapShift(i: number, from: number, to: number, size: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -size;
  if (to < from && i >= to && i < from) return size;
  return 0;
}

/** One card as laid out when a drag began. */
export interface CardBox {
  top: number;
  height: number;
}

/**
 * How far the other cards step aside: the dragged card's height and the gap under it, so the
 * hole they open is exactly the card that will fill it.
 */
export function gapSize(boxes: CardBox[], from: number): number {
  const box = boxes[from];
  if (!box) return 0;
  const a = boxes[0];
  const b = boxes[1];
  const gap = a && b ? Math.max(0, b.top - (a.top + a.height)) : 0;
  return box.height + gap;
}

/**
 * Where the dragged card ends up, as a vertical offset from where it started, so it can ease
 * into the hole once it is let go rather than jump there when the file is written.
 */
export function landingOffset(boxes: CardBox[], from: number, to: number): number {
  const a = boxes[from];
  const b = boxes[to];
  if (!a || !b || from === to) return 0;
  return to > from ? b.top + b.height - (a.top + a.height) : b.top - a.top;
}
