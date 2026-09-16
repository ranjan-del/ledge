import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLINK_CLOSE_MS,
  BLINK_GAP_MAX_MS,
  BLINK_GAP_MIN_MS,
  BLINK_OPEN_MS,
  DOUBLE_BLINK_CHANCE,
  DOUBLE_BLINK_GAP_MS,
  blinkGap,
  isDoubleBlink,
  startBlinking,
} from '../src/lib/blink.ts';

/** A random that hands back the given numbers in order, then repeats the last one. */
function fakeRandom(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('blink timing', () => {
  it('blinks in about 140 ms, quicker shut than open', () => {
    expect(BLINK_CLOSE_MS + BLINK_OPEN_MS).toBeCloseTo(140, 0);
    expect(BLINK_CLOSE_MS).toBeLessThan(BLINK_OPEN_MS);
  });

  it('draws the gap from the 5 to 7 second range rather than fixing it', () => {
    expect(blinkGap(() => 0)).toBe(BLINK_GAP_MIN_MS);
    expect(blinkGap(() => 1)).toBe(BLINK_GAP_MAX_MS);
    expect(blinkGap(() => 0.5)).toBe(6000);
    expect(BLINK_GAP_MIN_MS).toBe(5000);
    expect(BLINK_GAP_MAX_MS).toBe(7000);
  });

  it('doubles a blink now and then, not usually', () => {
    expect(isDoubleBlink(() => 0)).toBe(true);
    expect(isDoubleBlink(() => 0.99)).toBe(false);
    expect(DOUBLE_BLINK_CHANCE).toBeLessThan(0.5);
  });
});

describe('startBlinking', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits a gap, shuts the eyes, opens them, and waits again', () => {
    const shut: boolean[] = [];
    /* 0.5 asks for a 6 second gap, 0.99 refuses the double, then 0.5 again for the next gap. */
    const stop = startBlinking((v) => shut.push(v), { random: fakeRandom([0.5, 0.99, 0.5]) });
    vi.advanceTimersByTime(5999);
    expect(shut).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(shut).toEqual([true]);
    vi.advanceTimersByTime(BLINK_CLOSE_MS);
    expect(shut).toEqual([true, false]);
    vi.advanceTimersByTime(6000);
    expect(shut).toEqual([true, false, true]);
    stop();
  });

  it('blinks twice in quick succession when the double comes up', () => {
    const shut: boolean[] = [];
    /* 0 asks for the shortest gap and says yes to the double. */
    const stop = startBlinking((v) => shut.push(v), { random: fakeRandom([0]) });
    vi.advanceTimersByTime(BLINK_GAP_MIN_MS + BLINK_CLOSE_MS);
    expect(shut).toEqual([true, false]);
    vi.advanceTimersByTime(BLINK_OPEN_MS + DOUBLE_BLINK_GAP_MS);
    expect(shut).toEqual([true, false, true]);
    /* The second half of a double is never itself doubled, so the next one is a normal gap. */
    vi.advanceTimersByTime(BLINK_CLOSE_MS);
    expect(shut).toEqual([true, false, true, false]);
    vi.advanceTimersByTime(BLINK_GAP_MIN_MS - 1);
    expect(shut).toHaveLength(4);
    stop();
  });

  it('does not fire on a fixed period: two gaps in a row differ', () => {
    const gaps: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const stop = startBlinking(() => {}, { random: fakeRandom([0.1, 0.9, 0.8, 0.9]) });
    vi.advanceTimersByTime(BLINK_GAP_MIN_MS + BLINK_CLOSE_MS + BLINK_GAP_MAX_MS + 200);
    for (const call of spy.mock.calls) {
      const ms = Number(call[1]);
      if (ms >= BLINK_GAP_MIN_MS) gaps.push(ms);
    }
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(gaps).size).toBeGreaterThan(1);
    stop();
  });

  it('stops dead and leaves the eyes open', () => {
    const shut: boolean[] = [];
    const stop = startBlinking((v) => shut.push(v), { random: fakeRandom([0, 0.99]) });
    vi.advanceTimersByTime(BLINK_GAP_MIN_MS);
    expect(shut).toEqual([true]);
    stop();
    expect(shut).toEqual([true, false]);
    vi.advanceTimersByTime(60_000);
    expect(shut).toEqual([true, false]);
  });
});
