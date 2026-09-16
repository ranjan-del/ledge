import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESIZE_DEBOUNCE_MS,
  SHORT_MAX_PX,
  SHORT_MIN_PX,
  contentHeight,
  createPanelSizer,
  needsFullHeight,
  panelContent,
  shortPanelHeight,
  type PanelCounts,
} from '../src/lib/sizing.ts';

const base: PanelCounts = {
  surface: 'now',
  view: 'live',
  detailOpen: false,
  working: 0,
  upNext: 0,
  attention: 0,
  sessions: 0,
  notes: 0,
  live: 0,
  done: 0,
  backlog: 0,
  pending: 0,
};

/** A 1055 point work area at 2x, which is a Retina laptop: 900 physical is 450 points. */
const RETINA = { avail: 1055, ratio: 2 };

describe('shortPanelHeight', () => {
  it('is 60 percent of the work area, in the physical pixels Rust clamps in', () => {
    expect(shortPanelHeight(1000)).toBe(600);
    expect(shortPanelHeight(1000, 1)).toBe(600);
  });

  it('honours the floor and the ceiling the contract asks for', () => {
    expect(shortPanelHeight(500)).toBe(SHORT_MIN_PX);
    expect(shortPanelHeight(3000)).toBe(SHORT_MAX_PX);
  });

  it('comes back in CSS pixels, so a Retina panel is 450 points and not 900', () => {
    expect(shortPanelHeight(RETINA.avail, RETINA.ratio)).toBe(SHORT_MAX_PX / 2);
  });
});

describe('panelContent', () => {
  it('counts only what the surface you are on is showing', () => {
    const now = panelContent({ ...base, surface: 'now', working: 2, notes: 40 });
    expect(now.blocks).toBe(2);
    const memory = panelContent({ ...base, surface: 'memory', working: 2, notes: 40 });
    expect(memory.blocks).toBe(40);
  });

  it('reads the view you are in on the tasks surface', () => {
    const counts = { ...base, surface: 'tasks' as const, live: 3, done: 9, backlog: 1, pending: 5 };
    expect(panelContent({ ...counts, view: 'live' }).blocks).toBe(3);
    expect(panelContent({ ...counts, view: 'done' }).blocks).toBe(9);
    expect(panelContent({ ...counts, view: 'backlog' }).blocks).toBe(1);
    expect(panelContent({ ...counts, view: 'pending' }).blocks).toBe(5);
  });

  it('counts Up next and the attention line as lines rather than blocks', () => {
    const content = panelContent({ ...base, working: 1, upNext: 3, attention: 2 });
    expect(content.blocks).toBe(1);
    /* Three items, one attention line, and the two the surface always has. */
    expect(content.lines).toBe(6);
  });

  it('stops counting when a task detail is open, because that always needs the room', () => {
    const content = panelContent({ ...base, detailOpen: true, working: 9 });
    expect(content).toEqual({ detailOpen: true, blocks: 0, lines: 0 });
    expect(contentHeight(content)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('needsFullHeight', () => {
  it('is false for an empty desk, so an empty panel is not a screen of glass', () => {
    const content = panelContent(base);
    expect(needsFullHeight(content, RETINA.avail, RETINA.ratio)).toBe(false);
  });

  it('is false for a nearly empty one', () => {
    const content = panelContent({ ...base, working: 1, upNext: 1 });
    expect(needsFullHeight(content, RETINA.avail, RETINA.ratio)).toBe(false);
  });

  it('is true once the short panel would have to scroll', () => {
    const content = panelContent({ ...base, working: 4, upNext: 2, attention: 1 });
    expect(needsFullHeight(content, RETINA.avail, RETINA.ratio)).toBe(true);
  });

  it('is true whenever a task detail is open, whatever the screen', () => {
    const content = panelContent({ ...base, detailOpen: true });
    expect(needsFullHeight(content, 400, 1)).toBe(true);
    expect(needsFullHeight(content, 4000, 2)).toBe(true);
  });
});

describe('createPanelSizer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies the first answer, once the dust has settled', () => {
    const apply = vi.fn();
    const sizer = createPanelSizer(apply);
    sizer.update(true);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    expect(apply).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('never asks the window for a size it is already at', () => {
    const apply = vi.fn();
    const sizer = createPanelSizer(apply);
    sizer.update(true);
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    sizer.update(true);
    sizer.update(true);
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 5);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of changes into the one answer that is still true', () => {
    const apply = vi.fn();
    const sizer = createPanelSizer(apply);
    for (const value of [true, false, true, false, true]) sizer.update(value);
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 3);
    expect(apply).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('drops a change that has undone itself before the wait was out', () => {
    const apply = vi.fn();
    const sizer = createPanelSizer(apply);
    sizer.update(true);
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    apply.mockClear();
    sizer.update(false);
    sizer.update(true);
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 3);
    expect(apply).not.toHaveBeenCalled();
  });

  it('cancels what was queued when it is stopped', () => {
    const apply = vi.fn();
    const sizer = createPanelSizer(apply);
    sizer.update(true);
    sizer.stop();
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 3);
    expect(apply).not.toHaveBeenCalled();
  });
});
