import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_MS,
  ROW_STEP_MS,
  STAGGER_MS,
  reducedMotion,
  settleNow,
  staggering,
  startStaggerWindow,
} from '../src/lib/motion.svelte.ts';

function prefersReduced(value: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: value, media: query }) as MediaQueryList,
  );
}

describe('motion policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settleNow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    settleNow();
  });

  it('keeps the durations the brief asked for', () => {
    expect(PANEL_MS).toBe(160);
    expect(ROW_STEP_MS).toBeLessThanOrEqual(30);
    expect(STAGGER_MS).toBeGreaterThan(PANEL_MS);
  });

  it('reads the viewer preference, and assumes less motion when it cannot', () => {
    prefersReduced(true);
    expect(reducedMotion()).toBe(true);
    prefersReduced(false);
    expect(reducedMotion()).toBe(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new Error('no media queries here');
    });
    expect(reducedMotion()).toBe(true);
  });

  it('lets rows in for one short window and then never again', () => {
    prefersReduced(false);
    settleNow();
    expect(staggering()).toBe(false);
    /* A fresh window is only opened by the first view that mounts. */
    vi.resetModules();
  });
});

describe('the entrance window', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens once, closes on its own, and is never open under reduced motion', async () => {
    vi.resetModules();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: false, media: query }) as MediaQueryList,
    );
    vi.useFakeTimers();
    /* resetModules above means this import re-evaluates the module, so the entrance window
       is genuinely unopened rather than left over from another test. */
    const motion = await import('../src/lib/motion.svelte.ts');
    expect(motion.staggering()).toBe(true);
    motion.startStaggerWindow();
    expect(motion.staggering()).toBe(true);
    await vi.advanceTimersByTimeAsync(motion.STAGGER_MS + 10);
    expect(motion.staggering()).toBe(false);
    motion.startStaggerWindow();
    expect(motion.staggering()).toBe(false);
  });

  it('never opens the window at all when the viewer asked for less motion', async () => {
    vi.resetModules();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: true, media: query }) as MediaQueryList,
    );
    const motion = await import('../src/lib/motion.svelte.ts');
    motion.startStaggerWindow();
    expect(motion.staggering()).toBe(false);
  });
});

describe('startStaggerWindow', () => {
  it('is safe to call from every view that mounts', () => {
    expect(() => {
      startStaggerWindow();
      startStaggerWindow();
    }).not.toThrow();
  });
});
