import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  daysBetween,
  lateLabel,
  parseDay,
  relativeTime,
  todayIso,
} from '../src/lib/time.ts';

describe('day helpers', () => {
  it('formats a local calendar day', () => {
    expect(todayIso(new Date(2026, 8, 15, 23, 40))).toBe('2026-09-15');
    expect(todayIso(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
  });

  it('parses a day and refuses anything else', () => {
    expect(parseDay('2026-09-15')?.getFullYear()).toBe(2026);
    expect(parseDay('2026-09-15')?.getMonth()).toBe(8);
    expect(parseDay(' 2026-09-15 ')).toBeTruthy();
    expect(parseDay('tomorrow')).toBeUndefined();
    expect(parseDay('2026-09')).toBeUndefined();
    expect(parseDay('')).toBeUndefined();
  });

  it('counts whole days in both directions and across a month boundary', () => {
    expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
    expect(daysBetween('2026-09-11', '2026-09-15')).toBe(4);
    expect(daysBetween('2026-09-15', '2026-09-11')).toBe(-4);
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
    expect(daysBetween('nonsense', '2026-09-15')).toBe(0);
  });

  it('names the days a person has words for and dates the rest', () => {
    expect(dayLabel('2026-09-15', '2026-09-15')).toBe('today');
    expect(dayLabel('2026-09-16', '2026-09-15')).toBe('tomorrow');
    expect(dayLabel('2026-09-14', '2026-09-15')).toBe('yesterday');
    expect(dayLabel('2026-09-20', '2026-09-15')).toMatch(/20 Sep/);
    expect(dayLabel('2025-09-20', '2026-09-15')).toMatch(/2025/);
    expect(dayLabel('not a day', '2026-09-15')).toBe('not a day');
  });

  it('says how late something is in words', () => {
    expect(lateLabel('2026-09-15', '2026-09-15')).toBe('');
    expect(lateLabel('2026-09-16', '2026-09-15')).toBe('');
    expect(lateLabel('2026-09-14', '2026-09-15')).toBe('1 day late');
    expect(lateLabel('2026-09-11', '2026-09-15')).toBe('4 days late');
    expect(lateLabel('2026-08-15', '2026-09-15')).toBe('4 weeks late');
    expect(lateLabel('2026-01-15', '2026-09-15')).toMatch(/months late/);
  });

  it('still reports coarse relative times', () => {
    const now = Date.parse('2026-09-15T12:00:00Z');
    expect(relativeTime('2026-09-15T11:58:00Z', now)).toBe('2 min ago');
    expect(relativeTime('2026-09-15T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('nonsense', now)).toBe('');
  });
});
