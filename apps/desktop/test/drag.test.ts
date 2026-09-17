/**
 * The rules a sideways drag follows, tested on the module that holds them rather than through a
 * gesture, because the whole point of the module is that these are decidable without one.
 *
 * Two of them matter more than the rest. A drag is biased towards reorder: it must travel a
 * deliberate distance sideways AND be clearly more sideways than vertical before it becomes a
 * list move, because a task that changes status because a hand wandered is worse than no
 * gesture. And a direction with nowhere to go refuses out loud, since a gesture that silently
 * does nothing teaches the person the gesture is broken.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DOMINANCE,
  SHIFT_PX,
  ask,
  askShift,
  beginDrag,
  clearAsk,
  drag,
  endDrag,
  releaseDrag,
  shiftAim,
  shiftTargets,
  trackDrag,
  viewRefusal,
  viewStatus,
} from '../src/lib/drag.svelte.ts';

const FILE = '/home/t/.ledge/tasks/2026-09-14-release-watch-banner.md';

beforeEach(() => {
  endDrag();
  clearAsk();
});

describe('the axis a drag commits to', () => {
  it('starts as a reorder, which is what most drags are', () => {
    beginDrag(FILE, 2);
    expect(drag.axis).toBe('y');
    expect(drag.direction).toBe(0);
    expect(drag.file).toBe(FILE);
    expect(drag.from).toBe(2);
  });

  it('stays a reorder until the sideways travel passes the threshold', () => {
    beginDrag(FILE, 0);
    trackDrag(SHIFT_PX - 1, 0);
    expect(drag.axis).toBe('y');
    trackDrag(SHIFT_PX, 0);
    expect(drag.axis).toBe('x');
    expect(drag.direction).toBe(1);
  });

  it('stays a reorder when the drag is only a little more sideways than vertical', () => {
    beginDrag(FILE, 0);
    /* Far enough sideways, but a diagonal wander is not a sideways gesture. */
    trackDrag(SHIFT_PX + 40, (SHIFT_PX + 40) / DOMINANCE);
    expect(drag.axis).toBe('y');
  });

  it('reads left as left and right as right', () => {
    beginDrag(FILE, 0);
    trackDrag(-SHIFT_PX * 2, 4);
    expect(drag.direction).toBe(-1);
    trackDrag(SHIFT_PX * 2, 4);
    expect(drag.direction).toBe(1);
  });

  it('lets a person change their mind and come back to a reorder', () => {
    beginDrag(FILE, 0);
    trackDrag(SHIFT_PX * 2, 0);
    expect(drag.axis).toBe('x');
    trackDrag(4, 40);
    expect(drag.axis).toBe('y');
    expect(drag.direction).toBe(0);
  });

  it('ignores travel reported when nothing is being dragged', () => {
    trackDrag(SHIFT_PX * 4, 0);
    expect(drag.axis).toBe('none');
  });

  it('tells a release apart from a change of mind, which the browser does not', () => {
    beginDrag(FILE, 0);
    expect(drag.released).toBe(false);
    releaseDrag();
    expect(drag.released).toBe(true);
    endDrag();
    /* And a release reported with no drag in flight is not a release of anything. */
    releaseDrag();
    expect(drag.released).toBe(false);
  });
});

describe('what left and right mean', () => {
  it('moves a live task back to the backlog and forward to done', () => {
    const { left, right } = shiftTargets('current');
    expect(left.to).toBe('backlog');
    expect(left.label).toBe('Backlog');
    expect(right.to).toBe('done');
    /* Archiving is bigger than the gesture that asks for it, so it is asked about first. */
    expect(right.confirm).toBe(true);
    expect(left.confirm).toBeUndefined();
  });

  it('moves a parked task forward to live, and refuses to park it twice', () => {
    const { left, right } = shiftTargets('backlog');
    expect(right.to).toBe('current');
    expect(left.to).toBeUndefined();
    expect(left.refuse).toContain('Already parked');
  });

  it('keeps the backlog and done apart, so the archive is never one gesture away', () => {
    /* From the backlog, right is Live. Reaching Done takes a second, separate gesture. */
    expect(shiftTargets('backlog').right.to).toBe('current');
    expect(shiftTargets('current').right.to).toBe('done');
  });

  it('refuses both directions for a task that is already archived', () => {
    const { left, right } = shiftTargets('done');
    expect(left.to).toBeUndefined();
    expect(right.to).toBeUndefined();
    expect(left.refuse).toContain('archived');
  });

  it('aims at nothing while the drag is still a reorder', () => {
    expect(shiftAim('current', 0)).toBeUndefined();
    expect(shiftAim('current', -1)?.to).toBe('backlog');
    expect(shiftAim('current', 1)?.to).toBe('done');
  });
});

describe('a view as a place to drop a task', () => {
  it('will not take one into Pending, and says why rather than shrugging', () => {
    const refusal = viewRefusal('pending', 'current');
    expect(refusal).toContain('read from git');
    expect(refusal).toContain('Nothing can be moved into it');
    expect(viewStatus('pending')).toBeUndefined();
  });

  it('maps the three lists that are a status onto that status', () => {
    expect(viewStatus('live')).toBe('current');
    expect(viewStatus('backlog')).toBe('backlog');
    expect(viewStatus('done')).toBe('done');
  });

  it('takes a live task into the backlog and into done', () => {
    expect(viewRefusal('backlog', 'current')).toBeUndefined();
    expect(viewRefusal('done', 'current')).toBeUndefined();
  });

  it('says a task is already where it was dropped rather than writing the same status', () => {
    expect(viewRefusal('live', 'current')).toBe('Already live.');
    expect(viewRefusal('backlog', 'backlog')).toContain('Already in backlog');
  });

  it('refuses a view that is not a list of tasks at all', () => {
    expect(viewRefusal('memory', 'current')).toContain('not a list a task can be moved into');
  });
});

describe('the one move waiting to be confirmed', () => {
  it('belongs to one file at a time and is cleared by an answer', () => {
    askShift(FILE, 'done');
    expect(ask.file).toBe(FILE);
    expect(ask.to).toBe('done');
    askShift('/other.md', 'done');
    expect(ask.file).toBe('/other.md');
    clearAsk();
    expect(ask.file).toBe('');
    expect(ask.to).toBeNull();
  });
});
