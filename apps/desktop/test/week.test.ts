import { describe, expect, it } from 'vitest';
import {
  isoWeekOf,
  itemsFor,
  parseWeek,
  serializeWeek,
  shiftWeek,
  weekDays,
  type WeekFile,
} from '@ledge/core/pure';
import {
  addItem,
  dayHeading,
  emptyWeek,
  moveItem,
  numberedLines,
  openCount,
  openElsewhere,
  openToday,
  removeItem,
  updateItem,
  weekLabel,
} from '../src/lib/week-view.ts';

/** The contract's own example, which is a file Ledge wrote. */
const W39 = `---
week: 2026-W39
updated: 2026-09-27T12:40:00+05:30
---

## Anytime

- [ ] Renew the domain

## Mon 2026-09-21

- [x] Call the vendor about invoices
- [ ] Review Teacher Corner PR {task: teacher-corner-web-consolidation}

## Thu 2026-09-24

- [ ] Sprint demo prep
`;

describe('ISO weeks', () => {
  it('finds the week a day is in, Monday first', () => {
    expect(isoWeekOf('2026-09-27')).toBe('2026-W39');
    expect(isoWeekOf('2026-09-21')).toBe('2026-W39');
    expect(isoWeekOf('2026-09-28')).toBe('2026-W40');
  });

  it('puts the days around New Year in the week their Thursday belongs to', () => {
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
    expect(isoWeekOf('2024-12-30')).toBe('2025-W01');
  });

  it('lists the seven days of a week', () => {
    expect(weekDays('2026-W39')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(weekDays('2025-W01')[0]).toBe('2024-12-30');
  });

  it('steps weeks back and forward, across years', () => {
    expect(shiftWeek('2026-W39', 1)).toBe('2026-W40');
    expect(shiftWeek('2026-W39', -1)).toBe('2026-W38');
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    expect(shiftWeek('2027-W01', -1)).toBe('2026-W53');
  });
});

describe('the week file', () => {
  it('reads the contract example', () => {
    const w = parseWeek(W39, '2026-W39');
    expect(w.week).toBe('2026-W39');
    expect(w.updated).toBe('2026-09-27T12:40:00+05:30');
    expect(w.anytime).toEqual([{ text: 'Renew the domain', done: false }]);
    expect(w.days['2026-09-21']).toEqual([
      { text: 'Call the vendor about invoices', done: true },
      {
        text: 'Review Teacher Corner PR',
        done: false,
        taskId: 'teacher-corner-web-consolidation',
      },
    ]);
    expect(itemsFor(w, '2026-09-24')).toEqual([{ text: 'Sprint demo prep', done: false }]);
    expect(itemsFor(w, '2026-09-25')).toEqual([]);
    expect(w.extra).toBe('');
  });

  it('gives the same bytes back for a file Ledge wrote', () => {
    expect(serializeWeek(parseWeek(W39, '2026-W39'))).toBe(W39);
  });

  it('keeps what it does not understand, after the known sections, and unknown keys', () => {
    const text = `---
week: 2026-W39
owner: ranjan
tags:
  - home
---

## Tue 2026-09-22

- [ ] Book the car service

## Notes

Anything goes here.

- [ ] not an item of the week

## Mon 2026-09-28

- [ ] next week, wrongly filed
`;
    const w = parseWeek(text, '2026-W39');
    expect(w.meta).toEqual({ owner: 'ranjan', tags: ['home'] });
    expect(w.days['2026-09-22']).toHaveLength(1);
    expect(Object.keys(w.days)).toEqual(['2026-09-22']);
    expect(w.extra).toContain('## Notes\n\nAnything goes here.');
    expect(w.extra).toContain('## Mon 2026-09-28');
    const again = serializeWeek(w);
    expect(again).toContain('owner: ranjan\ntags:\n  - home\n---');
    expect(parseWeek(again, '2026-W39')).toEqual(w);
    expect(serializeWeek(parseWeek(again, '2026-W39'))).toBe(again);
  });

  it('writes Anytime first and days in calendar order, and leaves empty ones out', () => {
    const w: WeekFile = {
      week: '2026-W39',
      anytime: [],
      days: {
        '2026-09-25': [{ text: 'Friday', done: false }],
        '2026-09-22': [{ text: 'Tuesday', done: true }],
        '2026-09-23': [],
      },
      extra: '',
    };
    expect(serializeWeek(w)).toBe(
      '---\nweek: 2026-W39\n---\n\n## Tue 2026-09-22\n\n- [x] Tuesday\n\n## Fri 2026-09-25\n\n- [ ] Friday\n',
    );
  });

  it('never refuses: no frontmatter and garbage are an empty week plus what was there', () => {
    const w = parseWeek('just some words\n', '2026-W39');
    expect(w.anytime).toEqual([]);
    expect(w.days).toEqual({});
    expect(w.extra).toBe('just some words');
    expect(parseWeek('', '2026-W39')).toMatchObject({ anytime: [], days: {}, extra: '' });
  });
});

describe('editing a week', () => {
  const w = () => parseWeek(W39, '2026-W39');

  it('adds to the end of a slot, one line of text, optionally linked', () => {
    const next = addItem(w(), '2026-09-25', '  Pay \n rent ', 'rent');
    expect(next.days['2026-09-25']).toEqual([{ text: 'Pay rent', done: false, taskId: 'rent' }]);
    expect(Object.keys(next.days)).toEqual(['2026-09-21', '2026-09-24', '2026-09-25']);
    expect(addItem(w(), 'anytime', 'Water plants').anytime).toHaveLength(2);
    expect(() => addItem(w(), 'anytime', '   ')).toThrow();
    expect(() => addItem(w(), '2026-10-01', 'Outside')).toThrow();
  });

  it('ticks, retypes, links and unlinks', () => {
    const ref = { slot: '2026-09-21', index: 1 };
    expect(updateItem(w(), ref, { done: true }).days['2026-09-21']![1]!.done).toBe(true);
    expect(updateItem(w(), ref, { text: 'Review it' }).days['2026-09-21']![1]!.text).toBe('Review it');
    const unlinked = updateItem(w(), ref, { taskId: undefined }).days['2026-09-21']![1]!;
    expect('taskId' in unlinked).toBe(false);
    const linked = updateItem(w(), { slot: 'anytime', index: 0 }, { taskId: 'domain' });
    expect(linked.anytime[0]!.taskId).toBe('domain');
    expect(() => updateItem(w(), ref, { text: ' ' })).toThrow();
  });

  it('moves an item to another day and drops a day that empties', () => {
    const next = moveItem(w(), { slot: '2026-09-24', index: 0 }, 'anytime');
    expect(next.days['2026-09-24']).toBeUndefined();
    expect(next.anytime.map((i) => i.text)).toEqual(['Renew the domain', 'Sprint demo prep']);
    expect(moveItem(w(), { slot: '2026-09-24', index: 0 }, '2026-10-05')).toEqual(w());
  });

  it('removes an item', () => {
    expect(removeItem(w(), { slot: 'anytime', index: 0 }).anytime).toEqual([]);
  });

  it('counts what is open today and elsewhere in the week', () => {
    expect(openToday(w(), '2026-09-21').map((e) => e.item.text)).toEqual(['Review Teacher Corner PR']);
    expect(openToday(w(), '2026-09-21')[0]!.ref).toEqual({ slot: '2026-09-21', index: 1 });
    expect(openElsewhere(w(), '2026-09-21')).toBe(2);
    expect(openCount(w())).toBe(3);
    expect(openCount(emptyWeek('2026-W39'))).toBe(0);
  });

  it('numbers items the way ledge week does', () => {
    expect(numberedLines(w())).toEqual([
      '1. [ ] anytime: Renew the domain',
      '2. [x] Mon 2026-09-21: Call the vendor about invoices',
      '3. [ ] Mon 2026-09-21: Review Teacher Corner PR (task teacher-corner-web-consolidation)',
      '4. [ ] Thu 2026-09-24: Sprint demo prep',
    ]);
  });

  it('words the header and the day headings', () => {
    expect(weekLabel('2026-W39')).toBe('Week 39, 21 to 27 Sep');
    expect(weekLabel('2026-W40')).toBe('Week 40, 28 Sep to 4 Oct');
    expect(dayHeading('2026-09-24')).toBe('Thu 24 Sep');
  });
});
