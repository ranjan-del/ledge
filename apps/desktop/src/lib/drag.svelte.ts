/**
 * The one drag in flight, and what a sideways one means.
 *
 * A card can be dragged for two different reasons and the person has to know which one is
 * happening before they let go. Up and down reorders the live list. Left and right changes
 * which list the task is in, which writes `status` to the file. The two must never be
 * confused, so a drag is biased towards reorder and only becomes a list move when it has
 * travelled a deliberate distance sideways and is clearly more sideways than vertical.
 *
 * The session lives in a module rather than in a card because the card being dragged is not
 * the card being dragged over: every other card has to know to stop offering itself as a drop
 * position the moment the gesture turns horizontal, and the view switch has to know a drag is
 * happening at all.
 */
import type { TaskStatus } from '@ledge/core/pure';

/** How far sideways a drag must travel before it stops being a reorder. */
export const SHIFT_PX = 64;
/** And how much more sideways than up or down, so a diagonal wander cannot count. */
export const DOMINANCE = 1.5;

/** Which way a drag is being read. `none` means nothing is being dragged. */
export type DragAxis = 'none' | 'y' | 'x';

/** A status a task can be moved into by a gesture. */
export type ShiftTo = 'current' | 'backlog' | 'done';

export interface ShiftTarget {
  /** What the destination is called on screen. */
  label: string;
  /** The status a drop writes. Absent when this direction has nowhere to go. */
  to?: ShiftTo;
  /** Why it refuses. Present exactly when `to` is absent. */
  refuse?: string;
}

export interface DragSession {
  /** The file of the task being dragged, '' when nothing is. */
  file: string;
  /** Its index in the list it started in, -1 when nothing is being dragged. */
  from: number;
  axis: DragAxis;
  /** -1 for left, 1 for right, 0 while the drag is still a reorder. */
  direction: -1 | 0 | 1;
}

export const drag: DragSession = $state({ file: '', from: -1, axis: 'none', direction: 0 });

/** Starts a session. A drag begins as a reorder and has to earn the right to be anything else. */
export function beginDrag(file: string, from: number): void {
  drag.file = file;
  drag.from = from;
  drag.axis = 'y';
  drag.direction = 0;
}

/** Reads the gesture so far. Called on every `drag` event with the travel since it started. */
export function trackDrag(dx: number, dy: number): void {
  if (drag.file === '') return;
  if (Math.abs(dx) >= SHIFT_PX && Math.abs(dx) > Math.abs(dy) * DOMINANCE) {
    drag.axis = 'x';
    drag.direction = dx < 0 ? -1 : 1;
  } else {
    drag.axis = 'y';
    drag.direction = 0;
  }
}

export function endDrag(): void {
  drag.file = '';
  drag.from = -1;
  drag.axis = 'none';
  drag.direction = 0;
}

/**
 * What left and right mean for a task in this status. One axis, read the way the work reads:
 * the backlog behind, done ahead. A direction with nowhere to go says so rather than doing
 * nothing, because a gesture that silently fails teaches the person the gesture is broken.
 */
export function shiftTargets(status: TaskStatus): { left: ShiftTarget; right: ShiftTarget } {
  if (status === 'backlog') {
    return {
      left: {
        label: 'Backlog',
        refuse: 'Already parked. There is nothing further back than the backlog.',
      },
      right: { label: 'Live', to: 'current' },
    };
  }
  return {
    left: { label: 'Backlog', to: 'backlog' },
    right: { label: 'Done', to: 'done' },
  };
}

/**
 * Why a view refuses a task dropped on it, or undefined when it accepts one. Pending is the
 * only refusal there is, and it is not a rule anybody chose: Pending is computed from git, so
 * there is no field on a task that could put it there or take it out.
 */
export function viewRefusal(view: string): string | undefined {
  if (view !== 'pending') return undefined;
  return 'Pending is read from git, not set on a task. Nothing can be moved into it.';
}

/** The status a drop on a view writes, or undefined when that view is not a status. */
export function viewStatus(view: string): ShiftTo | undefined {
  if (view === 'live') return 'current';
  if (view === 'backlog') return 'backlog';
  if (view === 'done') return 'done';
  return undefined;
}
