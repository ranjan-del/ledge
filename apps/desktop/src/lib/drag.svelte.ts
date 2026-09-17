/**
 * The one drag in flight, and what a sideways one means.
 *
 * A card can be dragged for two different reasons and the person has to know which one is
 * happening before they let go. Up and down reorders the live list. Left and right moves the
 * task to another list, which writes `status` to the file. The two must never be confused, so a
 * drag starts as a reorder and only becomes a list move once it has travelled a deliberate
 * distance sideways AND is clearly more sideways than up or down. A task that changed status
 * because a hand wandered is worse than no gesture at all, so the bias is the whole design.
 *
 * The session lives in a module rather than in a card because the card being dragged is not
 * the card being dragged over: every other card has to stop offering itself as a drop position
 * the moment the gesture turns horizontal, and the view switch has to know a drag is happening
 * at all so it can offer itself as a destination.
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
  /**
   * The move is bigger than the gesture that asks for it, so it has to be confirmed in place
   * rather than done on release. Only marking done is: it archives the file.
   */
  confirm?: boolean;
}

export interface DragSession {
  /** The file of the task being dragged, '' when nothing is. */
  file: string;
  /** Its index in the list it started in, -1 when nothing is being dragged. */
  from: number;
  axis: DragAxis;
  /** -1 for left, 1 for right, 0 while the drag is still a reorder. */
  direction: -1 | 0 | 1;
  /**
   * A drop target took the gesture. Escape and a release over nothing both leave this false,
   * which is the only way to tell "let go here" from "changed my mind": the browser reports
   * both as the same `dragend` with no drop effect.
   */
  released: boolean;
}

export const drag: DragSession = $state({
  file: '',
  from: -1,
  axis: 'none',
  direction: 0,
  released: false,
});

/** Starts a session. A drag begins as a reorder and has to earn the right to be anything else. */
export function beginDrag(file: string, from: number): void {
  drag.file = file;
  drag.from = from;
  drag.axis = 'y';
  drag.direction = 0;
  drag.released = false;
}

/** Said by whichever drop target accepted the gesture, before the source hears `dragend`. */
export function releaseDrag(): void {
  if (drag.file !== '') drag.released = true;
}

/**
 * The one move waiting to be confirmed, and which task it belongs to. It lives here rather
 * than on the card because a drop on the view switch asks the same question as a sideways drag
 * and must get the same answer in the same place: on the card, where the person can see what
 * they are about to archive. One at a time, by construction.
 */
export const ask: { file: string; to: ShiftTo | null } = $state({ file: '', to: null });

export function askShift(file: string, to: ShiftTo): void {
  ask.file = file;
  ask.to = to;
}

export function clearAsk(): void {
  ask.file = '';
  ask.to = null;
}

/**
 * Reads the gesture so far, from the travel since it started. Called on every `drag` event.
 * Committing to an axis is not permanent: coming back towards the middle makes it a reorder
 * again, because the person is allowed to change their mind before they let go.
 */
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
  drag.released = false;
}

/**
 * What left and right mean for a task in this status. One axis, read the way the work reads:
 * the backlog behind, done ahead, so Backlog and Done are never adjacent and reaching the
 * archive from the backlog takes two deliberate gestures rather than one long swipe.
 *
 * A direction with nowhere to go says so rather than doing nothing, because a gesture that
 * silently fails teaches the person the gesture is broken.
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
  if (status === 'done') {
    /* Done tasks live in archive/ and are not shown in a list that can be dragged. Saying so
       is better than offering a move that has nowhere to write it. */
    const refuse = 'This one is archived. Reopening it is not a drag.';
    return { left: { label: 'Backlog', refuse }, right: { label: 'Done', refuse } };
  }
  return {
    left: { label: 'Backlog', to: 'backlog' },
    /* Marking done archives the file, which is a bigger act than a drag implies, so the drop
       asks first in the same place and the same way the Delete control does. */
    right: { label: 'Done', to: 'done', confirm: true },
  };
}

/** The target for the direction a drag has committed to, or undefined while it is a reorder. */
export function shiftAim(status: TaskStatus, direction: -1 | 0 | 1): ShiftTarget | undefined {
  if (direction === 0) return undefined;
  const targets = shiftTargets(status);
  return direction === -1 ? targets.left : targets.right;
}

/**
 * Why a view refuses a task dropped on it, or undefined when it accepts one. There are two
 * refusals and only one of them is a rule anybody chose.
 *
 * Pending is not a status. It is computed from the git scan, the repositories holding work
 * that is neither committed nor pushed, so there is no field on a task that could put a task
 * into it or take one out. Nothing can be dragged there and the gesture has to say why.
 *
 * The other is dropping a task on the list it is already in, which is not a failure so much as
 * nothing to do, and is still worth one line rather than a shrug.
 */
export function viewRefusal(view: string, status?: TaskStatus): string | undefined {
  if (view === 'pending') {
    return 'Pending is read from git, not set on a task. Nothing can be moved into it.';
  }
  const to = viewStatus(view);
  if (to === undefined) return `${view} is not a list a task can be moved into.`;
  if (status !== undefined && to === status) {
    return view === 'live' ? 'Already live.' : `Already in ${view}.`;
  }
  return undefined;
}

/** The status a drop on a view writes, or undefined when that view is not a status. */
export function viewStatus(view: string): ShiftTo | undefined {
  if (view === 'live') return 'current';
  if (view === 'backlog') return 'backlog';
  if (view === 'done') return 'done';
  return undefined;
}
