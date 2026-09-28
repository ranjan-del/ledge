import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseWeek } from '@ledge/core/pure';
import TodayTodos from '../src/components/TodayTodos.svelte';
import WeekView from '../src/components/WeekView.svelte';
import { DOMINANCE as TASK_DOMINANCE, SHIFT_PX as TASK_SHIFT_PX } from '../src/lib/drag.svelte.ts';
import {
  DOMINANCE,
  SHIFT_PX,
  dragStarted,
  dropIndex,
  gapShift,
  gapSize,
  landingOffset,
  readWeekDrag,
} from '../src/lib/week-drag.ts';
import {
  appendAnytime,
  itemNumber,
  locateItem,
  openEntries,
  reorderItem,
  reorderOpen,
  updateItem,
} from '../src/lib/week-view.ts';

const W39 = `---
week: 2026-W39
---

## Anytime

- [ ] Renew the domain
  > Before it lapses on Friday.
  >
  > Card ending 4411.

## Mon 2026-09-21

- [x] Call the vendor about invoices
- [ ] Review Teacher Corner PR {task: teacher-corner}

## Thu 2026-09-24

- [ ] Sprint demo prep
`;

const week = () => parseWeek(W39, '2026-W39');
const texts = (w: ReturnType<typeof week>) => openEntries(w).map((e) => e.item.text);

function props(over: Record<string, unknown> = {}) {
  return {
    week: week(),
    day: '2026-09-24',
    tasks: [{ id: 'teacher-corner', title: 'Teacher Corner consolidation' }],
    taskTitle: (id: string) => (id === 'teacher-corner' ? 'Teacher Corner consolidation' : undefined),
    onbrowse: vi.fn(),
    onadd: vi.fn(async () => {}),
    onupdate: vi.fn(async () => {}),
    onmove: vi.fn(async () => {}),
    onremove: vi.fn(async () => {}),
    onreorder: vi.fn(async () => {}),
    onweekmove: vi.fn(async () => {}),
    onopentask: vi.fn(),
    ...over,
  };
}

const openList = () => screen.getByRole('list', { name: 'To do this week' });
const cards = () => [...openList().querySelectorAll<HTMLElement>(':scope > li')];

/** Lays the open cards out 40px apart, since jsdom has no layout of its own. */
function layOut() {
  cards().forEach((li, i) => {
    li.getBoundingClientRect = () => ({ top: i * 40, height: 36, bottom: i * 40 + 36, left: 0, right: 300, width: 300, x: 0, y: i * 40, toJSON() {} }) as DOMRect;
  });
}

async function dragCard(li: HTMLElement, moves: [number, number][], end = true) {
  const surface = li.querySelector('.week-card') as HTMLElement;
  await fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  for (const [dx, dy] of moves) {
    await fireEvent.pointerMove(li, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  }
  const [dx, dy] = moves[moves.length - 1]!;
  if (end) await fireEvent.pointerUp(li, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
}

describe('week cards, the pure half', () => {
  it('numbers items the way ledge week does', () => {
    const w = week();
    expect(itemNumber(w, { slot: 'anytime', index: 0 })).toBe(1);
    expect(itemNumber(w, { slot: '2026-09-21', index: 1 })).toBe(3);
    expect(itemNumber(w, { slot: '2026-09-24', index: 0 })).toBe(4);
    expect(itemNumber(w, { slot: '2026-09-24', index: 3 })).toBeUndefined();
  });

  it('reorders among open items only, through core numbering', () => {
    const w = week();
    expect(reorderOpen(w, 0, 2)).toEqual({ n: 1, to: 4 });
    expect(reorderOpen(w, 1, 1)).toBeUndefined();
    expect(reorderOpen(w, 0, 9)).toBeUndefined();
    const down = reorderItem(w, 0, 2);
    expect(texts(down)).toEqual(['Review Teacher Corner PR', 'Sprint demo prep', 'Renew the domain']);
    const up = reorderItem(w, 2, 1);
    expect(texts(up)).toEqual(['Renew the domain', 'Sprint demo prep', 'Review Teacher Corner PR']);
    /* The ticked item keeps its place in the file. */
    expect(up.days['2026-09-21']![0]!.text).toBe('Call the vendor about invoices');
    expect(down.anytime).toEqual([]);
  });

  it('sets and clears a description with the title in one edit', () => {
    const w = week();
    const set = updateItem(w, { slot: '2026-09-24', index: 0 }, {
      text: 'Sprint demo slides',
      description: '\nFive slides.  \nOne demo.\n\n',
    });
    expect(set.days['2026-09-24']![0]).toEqual({
      text: 'Sprint demo slides',
      done: false,
      description: 'Five slides.\nOne demo.',
    });
    const cleared = updateItem(w, { slot: 'anytime', index: 0 }, { description: '' });
    expect(cleared.anytime[0]).toEqual({ text: 'Renew the domain', done: false });
  });

  it('finds an item again after the file moved it, and appends to Anytime', () => {
    const w = week();
    const item = w.days['2026-09-24']![0]!;
    expect(locateItem(w, { slot: '2026-09-24', index: 0 }, item)).toEqual({ slot: '2026-09-24', index: 0 });
    const moved = reorderItem(w, 2, 0);
    expect(locateItem(moved, { slot: '2026-09-24', index: 0 }, item)).toEqual({ slot: 'anytime', index: 0 });
    expect(locateItem(moved, { slot: 'anytime', index: 0 }, { text: 'gone', done: false })).toBeUndefined();
    expect(appendAnytime(w, item).anytime.map((i) => i.text)).toEqual(['Renew the domain', 'Sprint demo prep']);
  });

  it('reads a drag with the same thresholds as the task cards', () => {
    expect(SHIFT_PX).toBe(TASK_SHIFT_PX);
    expect(DOMINANCE).toBe(TASK_DOMINANCE);
    expect(dragStarted(2, 2)).toBe(false);
    expect(dragStarted(0, 6)).toBe(true);
    expect(readWeekDrag(SHIFT_PX - 1, 0)).toEqual({ axis: 'y', direction: 0 });
    expect(readWeekDrag(SHIFT_PX, 10)).toEqual({ axis: 'x', direction: 1 });
    expect(readWeekDrag(-SHIFT_PX - 20, 10)).toEqual({ axis: 'x', direction: -1 });
    /* Diagonal is a reorder: not sideways enough. */
    expect(readWeekDrag(SHIFT_PX, SHIFT_PX)).toEqual({ axis: 'y', direction: 0 });
  });

  it('finds where a card lands and opens the gap for it', () => {
    const mids = [18, 58, 98, 138];
    expect(dropIndex(mids, 0, 18)).toBe(0);
    expect(dropIndex(mids, 0, 70)).toBe(1);
    expect(dropIndex(mids, 0, 200)).toBe(3);
    expect(dropIndex(mids, 3, 10)).toBe(0);
    expect([0, 1, 2, 3].map((i) => gapShift(i, 0, 2, 40))).toEqual([0, -40, -40, 0]);
    expect([0, 1, 2, 3].map((i) => gapShift(i, 3, 1, 40))).toEqual([0, 40, 40, 0]);
    const boxes = [0, 40, 80, 120].map((top) => ({ top, height: 36 }));
    expect(gapSize(boxes, 1)).toBe(40);
    expect(landingOffset(boxes, 0, 2)).toBe(80);
    expect(landingOffset(boxes, 3, 1)).toBe(-80);
  });
});

describe('week cards, in the To-do view', () => {
  it('shows each open item as a card with its description under the title', () => {
    render(WeekView, { props: props() });
    const first = cards()[0]!;
    expect(first.querySelector('.card')).toBeTruthy();
    const desc = first.querySelector('.desc') as HTMLElement;
    expect(desc.textContent).toBe('Before it lapses on Friday.\n\nCard ending 4411.');
    const title = within(first).getByRole('button', { name: 'Renew the domain' });
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(title.getAttribute('aria-describedby')).toBe(desc.id);
  });

  it('opens a card on a click, with the title as a field and a description area', async () => {
    render(WeekView, { props: props() });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Sprint demo prep');
    await waitFor(() => expect(document.activeElement).toBe(title));
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    expect(area.placeholder).toBe('Add a description, what has to be done');
    expect(screen.getByRole('button', { name: 'Done' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens from a press on the card surface too', async () => {
    render(WeekView, { props: props() });
    await fireEvent.click(cards()[1]!.querySelector('.week-card') as HTMLElement);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Review Teacher Corner PR');
  });

  it('ticks without opening', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByLabelText('Tick: Sprint demo prep'));
    await waitFor(() => expect(p.onupdate).toHaveBeenCalledWith({ slot: '2026-09-24', index: 0 }, { done: true }));
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('keeps one card open at a time', async () => {
    render(WeekView, { props: props() });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Renew the domain' }));
    await waitFor(() => expect(screen.getAllByLabelText('Title')).toHaveLength(1));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Renew the domain');
  });

  it('puts everything back and closes on Escape', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Renew the domain' }));
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Something else' } });
    const area = screen.getByLabelText('Description');
    await fireEvent.input(area, { target: { value: 'Changed my mind' } });
    await fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(p.onupdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Renew the domain' })).toBeTruthy();
  });

  it('saves the description with Cmd or Ctrl and Enter, and Enter alone is a new line', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    const area = screen.getByLabelText('Description');
    await fireEvent.input(area, { target: { value: 'Five slides\nOne live demo' } });
    await fireEvent.keyDown(area, { key: 'Enter' });
    expect(p.onupdate).not.toHaveBeenCalled();
    await fireEvent.keyDown(area, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(p.onupdate).toHaveBeenCalledWith(
        { slot: '2026-09-24', index: 0 },
        { description: 'Five slides\nOne live demo' },
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
  });

  it('saves the title on Enter, and both on a press outside the card', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Sprint demo slides' } });
    await fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' });
    expect(p.onupdate).toHaveBeenLastCalledWith({ slot: '2026-09-24', index: 0 }, { text: 'Sprint demo slides' });

    await fireEvent.click(screen.getByRole('button', { name: 'Renew the domain' }));
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Due Friday' } });
    await fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(p.onupdate).toHaveBeenLastCalledWith({ slot: 'anytime', index: 0 }, { description: 'Due Friday' }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
  });

  it('stays open and says why when a save is refused', async () => {
    const p = props({ onupdate: vi.fn(async () => Promise.reject(new Error('An item needs some text.'))) });
    render(WeekView, { props: p });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: '   ' } });
    await fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('needs some text'));
    expect(screen.getByLabelText('Title')).toBeTruthy();
  });

  it('gives open cards a labelled grip, and Completed none', () => {
    render(WeekView, { props: props() });
    expect(screen.getByRole('button', { name: /^Move Renew the domain, 1 of 3/ })).toBeTruthy();
    const done = screen.getByRole('region', { name: 'Completed' });
    expect(done.querySelector('.grip')).toBeNull();
  });

  it('moves a focused card with Alt and the arrow keys, and with the grip', async () => {
    const p = props();
    render(WeekView, { props: p });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Renew the domain' }), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(p.onreorder).toHaveBeenCalledWith(0, 1));
    await fireEvent.keyDown(screen.getByRole('button', { name: /^Move Sprint demo prep/ }), { key: 'ArrowUp' });
    await waitFor(() => expect(p.onreorder).toHaveBeenLastCalledWith(2, 1));
    /* Nowhere above the first card. */
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Renew the domain' }), { key: 'ArrowUp', altKey: true });
    expect(p.onreorder).toHaveBeenCalledTimes(2);
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Renew the domain' }), { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(p.onweekmove).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }, '2026-W40'));
  });

  it('reorders on a vertical drag, with a lifted card and a gap, and the click after is not an open', async () => {
    const p = props();
    render(WeekView, { props: p });
    layOut();
    const first = cards()[0]!;
    await dragCard(first, [[0, 3], [0, 50], [0, 85]], false);
    expect(first.classList.contains('lifted')).toBe(true);
    expect(first.style.transform).toBe('translate(0px, 85px)');
    expect(cards()[1]!.style.transform).toBe('translateY(-40px)');
    expect(cards()[2]!.style.transform).toBe('translateY(-40px)');
    await fireEvent.pointerUp(first, { pointerId: 1, clientX: 100, clientY: 185 });
    await fireEvent.click(first.querySelector('.title-btn') as HTMLElement);
    await waitFor(() => expect(p.onreorder).toHaveBeenCalledWith(0, 2));
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('treats a tiny wobble as a click, which opens the card', async () => {
    const p = props();
    render(WeekView, { props: p });
    await dragCard(cards()[2]!, [[1, 2]]);
    await fireEvent.click(cards()[2]!.querySelector('.title-btn') as HTMLElement);
    expect(p.onreorder).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Sprint demo prep');
  });

  it('sends a card to the next week on a clear drag right, saying where first and after', async () => {
    const p = props();
    const { container } = render(WeekView, { props: p });
    layOut();
    const last = cards()[2]!;
    await dragCard(last, [[20, 0], [SHIFT_PX + 30, 8]], false);
    const hint = container.querySelector('.edge-hint') as HTMLElement;
    expect(hint.classList.contains('right')).toBe(true);
    expect(hint.textContent).toContain('Next week');
    expect(hint.textContent).toContain('Week 40, 28 Sep to 4 Oct');
    await fireEvent.pointerUp(last, { pointerId: 1, clientX: 100 + SHIFT_PX + 30, clientY: 108 });
    await waitFor(() => expect(p.onweekmove).toHaveBeenCalledWith({ slot: '2026-09-24', index: 0 }, '2026-W40'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moved to Week 40, 28 Sep to 4 Oct'));
    expect(p.onreorder).not.toHaveBeenCalled();
    await fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Show' }));
    expect(p.onbrowse).toHaveBeenCalledWith('2026-W40');
  });

  it('sends a card to the previous week on a clear drag left, and Escape lets go of nothing', async () => {
    const p = props();
    const { container } = render(WeekView, { props: p });
    layOut();
    await dragCard(cards()[0]!, [[-(SHIFT_PX + 10), 0]], false);
    expect(container.querySelector('.edge-hint')?.textContent).toContain('Previous week');
    expect(container.querySelector('.edge-hint')?.textContent).toContain('Week 38, 14 to 20 Sep');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.edge-hint')).toBeNull();
    await fireEvent.pointerUp(cards()[0]!, { pointerId: 1, clientX: 20, clientY: 100 });
    expect(p.onweekmove).not.toHaveBeenCalled();

    await dragCard(cards()[0]!, [[-(SHIFT_PX + 10), 0]]);
    await waitFor(() => expect(p.onweekmove).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }, '2026-W38'));
  });

  it('says why a move to another week was refused', async () => {
    const p = props({ onweekmove: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    render(WeekView, { props: p });
    layOut();
    await dragCard(cards()[0]!, [[SHIFT_PX + 10, 0]]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('disk full'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not drag a ticked item', async () => {
    const p = props();
    const { container } = render(WeekView, { props: p });
    const done = screen.getByRole('region', { name: 'Completed' }).querySelector('li') as HTMLElement;
    await dragCard(done, [[SHIFT_PX + 10, 0]]);
    expect(container.querySelector('.edge-hint')).toBeNull();
    expect(p.onweekmove).not.toHaveBeenCalled();
  });

  it('uses no em or en dash in its words, open or closed', async () => {
    const { container } = render(WeekView, { props: props() });
    await fireEvent.click(screen.getByRole('button', { name: 'Sprint demo prep' }));
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
    expect(document.body.innerHTML).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('week cards, on the Assistant', () => {
  const items = () => [
    { item: { text: 'Call the bank', done: false, description: 'About the card' }, ref: { slot: 'anytime', index: 0 } },
    { item: { text: 'Pay rent', done: false }, ref: { slot: 'anytime', index: 1 } },
  ];

  it('draws the same cards, ticks through ontick, and edits through onupdate', async () => {
    const ontick = vi.fn();
    const onupdate = vi.fn(async () => {});
    const { container } = render(TodayTodos, { props: { items: items(), ontick, onupdate } });
    expect(container.querySelector('.week-card .desc')?.textContent).toBe('About the card');
    expect(container.querySelector('.grip')).toBeNull();
    expect(screen.queryByRole('button', { name: /More for/ })).toBeNull();

    await fireEvent.click(screen.getByLabelText('Tick: Pay rent'));
    await waitFor(() => expect(ontick).toHaveBeenCalledWith({ slot: 'anytime', index: 1 }));
    expect(screen.queryByLabelText('Title')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Call the bank' }));
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    expect(area.value).toBe('About the card');
    await fireEvent.input(area, { target: { value: 'About the new card' } });
    await fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    await waitFor(() =>
      expect(onupdate).toHaveBeenCalledWith({ slot: 'anytime', index: 0 }, { description: 'About the new card' }),
    );
  });
});
