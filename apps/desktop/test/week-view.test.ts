import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import WeekView from '../src/components/WeekView.svelte';
import { addDays, dayHasItems, monthGrid, monthLabel, shiftMonth, weekHasItems } from '../src/lib/week-view.ts';
import { parseWeek } from '@ledge/core/pure';

const W39 = `---
week: 2026-W39
---

## Anytime

- [ ] Renew the domain

## Mon 2026-09-21

- [x] Call the vendor about invoices
- [ ] Review Teacher Corner PR {task: teacher-corner}

## Thu 2026-09-24

- [ ] Sprint demo prep
`;

const tasks = [
  { id: 'teacher-corner', title: 'Teacher Corner consolidation' },
  { id: 'release-watch', title: 'Release watch banner' },
];

function props(over: Record<string, unknown> = {}) {
  return {
    week: parseWeek(W39, '2026-W39'),
    day: '2026-09-24',
    tasks,
    taskTitle: (id: string) => tasks.find((t) => t.id === id)?.title,
    onbrowse: vi.fn(),
    onadd: vi.fn(async () => {}),
    onupdate: vi.fn(async () => {}),
    onmove: vi.fn(async () => {}),
    onremove: vi.fn(async () => {}),
    onopentask: vi.fn(),
    ...over,
  };
}

describe('To-do, the week', () => {
  it('names the week and lists Anytime then Monday to Sunday', () => {
    const { container } = render(WeekView, { props: props() });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Week 39, 21 to 27 Sep');
    const titles = [...container.querySelectorAll('.day-title')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Anytime this week',
      'Mon 21 Sep',
      'Tue 22 Sep',
      'Wed 23 Sep',
      'Thu 24 Sep',
      'Fri 25 Sep',
      'Sat 26 Sep',
      'Sun 27 Sep',
    ]);
  });

  it('highlights today and mutes the days of this week that have passed', () => {
    const { container } = render(WeekView, { props: props() });
    const sections = [...container.querySelectorAll('section.day')];
    expect(sections[4]!.classList.contains('today')).toBe(true);
    expect(sections[4]!.textContent).toContain('Today');
    expect(sections.filter((s) => s.classList.contains('past'))).toHaveLength(3);
    expect(sections[5]!.classList.contains('past')).toBe(false);
    expect(sections[0]!.classList.contains('past')).toBe(false);
  });

  it('mutes nothing and highlights nothing in another week', () => {
    const { container } = render(WeekView, { props: props({ day: '2026-10-07' }) });
    expect(container.querySelector('.today')).toBeNull();
    expect(container.querySelector('.past')).toBeNull();
    expect(screen.getByRole('button', { name: 'This week' }).hasAttribute('disabled')).toBe(false);
  });

  it('steps back, forward and home', async () => {
    const p = props({ day: '2026-10-07' });
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    expect(p.onbrowse.mock.calls).toEqual([['2026-W38'], ['2026-W40'], ['2026-W41']]);
  });

  it('draws an empty day as one line with a quiet add', () => {
    const { container } = render(WeekView, { props: props() });
    const tue = container.querySelectorAll('section.day')[2] as HTMLElement;
    expect(tue.classList.contains('empty')).toBe(true);
    expect(tue.querySelector('ul')).toBeNull();
    expect(within(tue).getByRole('button', { name: 'Add to Tuesday' })).toBeTruthy();
  });

  it('adds by typing and Enter, to the day it was opened on, with an optional task', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to Friday' }));
    const field = screen.getByLabelText('Add to Friday');
    expect(document.activeElement).toBe(field);
    await fireEvent.input(field, { target: { value: 'Pay rent' } });
    await fireEvent.change(screen.getByLabelText('Link a task'), { target: { value: 'release-watch' } });
    await fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(p.onadd).toHaveBeenCalledWith('2026-09-25', 'Pay rent', 'release-watch');
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));

    await fireEvent.input(field, { target: { value: 'Buy stamps' } });
    await fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(p.onadd).toHaveBeenLastCalledWith('2026-09-25', 'Buy stamps', undefined);
    await fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Add to Friday' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to Friday' })).toBeTruthy();
  });

  it('adds to Anytime from its own row', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Add for anytime this week' }));
    const field = screen.getByLabelText('Add for anytime this week');
    await fireEvent.input(field, { target: { value: 'Water the plants' } });
    await fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(p.onadd).toHaveBeenCalledWith('anytime', 'Water the plants', undefined);
  });

  it('shows why an add was refused and keeps the text', async () => {
    const p = props({ onadd: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to Friday' }));
    const field = screen.getByLabelText('Add to Friday') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: 'Pay rent' } });
    await fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('disk full'));
    expect(field.value).toBe('Pay rent');
  });

  it('ticks and unticks by where the item is', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByLabelText('Tick: Sprint demo prep'));
    await fireEvent.click(screen.getByLabelText('Untick: Call the vendor about invoices'));
    await waitFor(() => expect(p.onupdate).toHaveBeenCalledTimes(2));
    expect(p.onupdate).toHaveBeenNthCalledWith(1, { slot: '2026-09-24', index: 0 }, { done: true });
    expect(p.onupdate).toHaveBeenNthCalledWith(2, { slot: '2026-09-21', index: 0 }, { done: false });
  });

  it('edits the text in place', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    const field = screen.getByLabelText('Edit: Sprint demo prep');
    await fireEvent.input(field, { target: { value: 'Sprint demo slides' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(p.onupdate).toHaveBeenCalledWith({ slot: '2026-09-24', index: 0 }, { text: 'Sprint demo slides' });
  });

  it('shows a linked task as a chip that opens it', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Teacher Corner consolidation' }));
    expect(p.onopentask).toHaveBeenCalledWith('teacher-corner');
  });

  it('keeps a link to a task that is not on the desk, but cannot open it', () => {
    render(WeekView, { props: props({ taskTitle: () => undefined }) });
    const chip = screen.getByRole('button', { name: 'teacher-corner' });
    expect(chip.hasAttribute('disabled')).toBe(true);
  });

  it('moves, links, unlinks and deletes from the item menu', async () => {
    const p = props();
    render(WeekView, { props: p });
    const more = () => screen.getByRole('button', { name: 'More for: Renew the domain' });

    await fireEvent.click(more());
    const move = screen.getByLabelText('Move: Renew the domain') as HTMLSelectElement;
    expect([...move.options].map((o) => o.value)).not.toContain('anytime');
    await fireEvent.change(move, { target: { value: '2026-09-26' } });
    await waitFor(() =>
      expect(p.onmove).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }, '2026-09-26'),
    );

    await fireEvent.click(more());
    await fireEvent.change(screen.getByLabelText('Task for: Renew the domain'), {
      target: { value: 'release-watch' },
    });
    await waitFor(() =>
      expect(p.onupdate).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }, { taskId: 'release-watch' }),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'More for: Review Teacher Corner PR' }));
    await fireEvent.change(screen.getByLabelText('Task for: Review Teacher Corner PR'), {
      target: { value: '' },
    });
    await waitFor(() =>
      expect(p.onupdate).toHaveBeenCalledWith({ slot: '2026-09-21', index: 1 }, { taskId: undefined }),
    );

    const group = screen.getByLabelText('Task for: Renew the domain').closest('.tools') as HTMLElement;
    await fireEvent.click(within(group).getByRole('button', { name: 'Delete' }));
    await fireEvent.click(within(group).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(p.onremove).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }));
  });

  it('closes the item menu with Escape', async () => {
    render(WeekView, { props: props() });
    const more = screen.getByRole('button', { name: 'More for: Renew the domain' });
    await fireEvent.click(more);
    const move = screen.getByLabelText('Move: Renew the domain');
    await fireEvent.keyDown(move, { key: 'Escape' });
    expect(screen.queryByLabelText('Move: Renew the domain')).toBeNull();
  });

  it('says on the row when an edit was refused', async () => {
    const p = props({ onupdate: vi.fn(async () => Promise.reject('forbidden path')) });
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByLabelText('Tick: Sprint demo prep'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('forbidden path'));
  });

  it('uses no em or en dash anywhere in its words', () => {
    const { container } = render(WeekView, { props: props() });
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('To-do, the calendar', () => {
  const W41 = parseWeek('---\nweek: 2026-W41\n---\n\n## Anytime\n\n- [ ] Book travel\n', '2026-W41');
  const weeks = () => ({ '2026-W39': parseWeek(W39, '2026-W39'), '2026-W41': W41 });
  const open = async (over: Record<string, unknown> = {}) => {
    const onloadweeks = vi.fn();
    const p = { ...props({ weeks: weeks(), onloadweeks, ...over }), onloadweeks };
    const view = render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
    return { ...view, p, dialog: screen.getByRole('dialog', { name: 'Pick a day' }) };
  };

  it('has no calendar unless the panel hands it the weeks', () => {
    render(WeekView, { props: props() });
    expect(screen.queryByRole('button', { name: 'Pick a day' })).toBeNull();
  });

  it("opens on the shown week's month with today marked, dots on days with items, weeks shaded", async () => {
    const { dialog, p } = await open();
    expect(within(dialog).getByText('September 2026')).toBeTruthy();
    const today = dialog.querySelector('[aria-current="date"]') as HTMLElement;
    expect(today.dataset.day).toBe('2026-09-24');
    const dots = [...dialog.querySelectorAll<HTMLElement>('.cell.dot')].map((c) => c.dataset.day);
    expect(dots).toEqual(['2026-09-21', '2026-09-24']);
    const shaded = [...dialog.querySelectorAll<HTMLElement>('.row.shaded')].map((r) => r.dataset.week);
    expect(shaded).toEqual(['2026-W39']);
    expect(dialog.querySelector('.row.shown')?.getAttribute('data-week')).toBe('2026-W39');
    expect(p.onloadweeks).toHaveBeenCalledWith(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40']);
  });

  it('steps through months and asks for the weeks each one shows', async () => {
    const { dialog, p } = await open();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    expect(within(dialog).getByText('October 2026')).toBeTruthy();
    expect([...dialog.querySelectorAll<HTMLElement>('.row.shaded')].map((r) => r.dataset.week)).toEqual(['2026-W41']);
    expect(p.onloadweeks).toHaveBeenLastCalledWith(['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    expect(within(dialog).getByText('August 2026')).toBeTruthy();
  });

  it('shows the week of a day picked, then scrolls to it and lights it briefly', async () => {
    vi.useFakeTimers();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      const { dialog, p, container } = await open();
      await fireEvent.click(within(dialog).getByRole('gridcell', { name: /\b22 September 2026/ }));
      expect(p.onbrowse).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Pick a day' })).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      const day = container.querySelector('[data-day="2026-09-22"]') as HTMLElement;
      expect(day.classList.contains('flash')).toBe(true);
      expect(scroll).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1300);
      expect(day.classList.contains('flash')).toBe(false);

      await fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
      const again = screen.getByRole('dialog', { name: 'Pick a day' });
      await fireEvent.click(within(again).getByRole('button', { name: 'Next month' }));
      await fireEvent.click(within(again).getByRole('gridcell', { name: /\b8 October 2026/ }));
      expect(p.onbrowse).toHaveBeenCalledWith('2026-W41');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on Escape and on a press outside it', async () => {
    const { dialog } = await open();
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Pick a day' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
    expect(screen.getByRole('dialog', { name: 'Pick a day' })).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Pick a day' })).toBeNull();
  });

  it('walks the days with the arrow keys, across into the next month', async () => {
    const { dialog } = await open();
    const today = dialog.querySelector('[data-day="2026-09-24"]') as HTMLElement;
    await fireEvent.keyDown(today, { key: 'ArrowDown' });
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.day).toBe('2026-10-01'));
    expect(within(dialog).getByText('October 2026')).toBeTruthy();
  });
});

describe('the month grid', () => {
  it('lists every ISO week with a day in the month, Monday first, marking days outside it', () => {
    const rows = monthGrid('2026-09');
    expect(rows.map((r) => r.week)).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40']);
    expect(rows[0]!.days[0]).toEqual({ day: '2026-08-31', inMonth: false });
    expect(rows[0]!.days[1]).toEqual({ day: '2026-09-01', inMonth: true });
    expect(rows[4]!.days[6]).toEqual({ day: '2026-10-04', inMonth: false });
  });

  it('crosses years, and steps months and days in the calendar rather than by 30s', () => {
    expect(monthGrid('2026-12').at(-1)!.week).toBe('2026-W53');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(monthLabel('2026-09')).toBe('September 2026');
  });

  it('says which days and weeks hold items', () => {
    const w = parseWeek(W39, '2026-W39');
    expect(dayHasItems(w, '2026-09-21')).toBe(true);
    expect(dayHasItems(w, '2026-09-22')).toBe(false);
    expect(weekHasItems(w)).toBe(true);
    expect(weekHasItems(parseWeek('', '2026-W40'))).toBe(false);
    expect(weekHasItems(undefined)).toBe(false);
  });
});
