<script lang="ts">
  /**
   * The to-do calendar: one month as a grid, Monday first, opened from the week header. Today
   * is marked, a day with to-do items carries a dot, a week with any item at all is shaded,
   * and the week on screen is outlined. Choosing a day shows its week. The arrows step through
   * months; the arrow keys walk the days; Escape and a press outside close it.
   *
   * It knows nothing about files. The caller hands it the weeks it has read and is told which
   * weeks a month shows, so it can read the ones it has not.
   */
  import type { WeekFile } from '@ledge/core/pure';
  import { isoWeekOf, weekDays } from '@ledge/core/pure';
  import { onMount, tick, untrack } from 'svelte';
  import {
    addDays,
    dayHasItems,
    monthGrid,
    monthLabel,
    monthOf,
    shiftMonth,
    weekHasItems,
  } from '../lib/week-view.ts';

  interface Props {
    /** Today as YYYY-MM-DD. */
    day: string;
    /** The week the To-do view is showing. The calendar opens on its month. */
    week: string;
    /** Week files read so far, by week. */
    weeks: Record<string, WeekFile>;
    /** The weeks a month shows, so the caller can read the ones not read yet. */
    onmonth?: (weeks: string[]) => unknown;
    onpick: (day: string) => void;
    onclose: () => void;
  }

  let { day, week, weeks, onmonth, onpick, onclose }: Props = $props();

  const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  /* The month shown, and the day the keyboard is on. Seeded from the week on screen: on this
     week that is today, on another week its Monday. */
  function startDay(): string {
    return isoWeekOf(day) === week ? day : weekDays(week)[0]!;
  }

  let focusDay = $state(untrack(startDay));
  let month = $state(untrack(() => monthOf(focusDay)));
  let root = $state<HTMLElement | null>(null);

  const rows = $derived(monthGrid(month));

  $effect(() => {
    void onmonth?.(rows.map((r) => r.week));
  });

  onMount(() => {
    void tick().then(() => focusCell());
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (root && t && !root.contains(t) && !t.closest('[data-calendar-toggle]')) onclose();
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  });

  function focusCell() {
    root?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }

  function step(n: number) {
    month = shiftMonth(month, n);
    const first = `${month}-01`;
    focusDay = monthOf(focusDay) === month ? focusDay : first;
  }

  async function moveFocus(n: number) {
    focusDay = addDays(focusDay, n);
    if (monthOf(focusDay) !== month) month = monthOf(focusDay);
    await tick();
    focusCell();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.dataset.day) return;
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const n = moves[event.key];
    if (n === undefined) return;
    event.preventDefault();
    void moveFocus(n);
  }

  function label(d: string, dot: boolean): string {
    const date = new Date(`${d}T12:00:00`);
    const words = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${words}${d === day ? ', today' : ''}${dot ? ', has to-do items' : ''}`;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="calendar" role="dialog" aria-label="Pick a day" bind:this={root} onkeydown={onKeydown} tabindex="-1">
  <div class="c-head">
    <button type="button" class="drop c-step motion" aria-label="Previous month" onclick={() => step(-1)}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M6.5 1.5 3 5l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <p class="c-title" aria-live="polite">{monthLabel(month)}</p>
    <button type="button" class="drop c-step motion" aria-label="Next month" onclick={() => step(1)}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
  <div class="grid" role="grid" aria-label={monthLabel(month)}>
    <div class="row names" role="row">
      {#each WEEKDAYS as name (name)}
        <span class="name" role="columnheader">{name}</span>
      {/each}
    </div>
    {#each rows as row (row.week)}
      {@const file = weeks[row.week]}
      <div
        class="row"
        role="row"
        class:shaded={weekHasItems(file)}
        class:shown={row.week === week}
        data-week={row.week}
      >
        {#each row.days as cell (cell.day)}
          {@const dot = dayHasItems(file, cell.day)}
          <button
            type="button"
            role="gridcell"
            class="cell motion"
            class:out={!cell.inMonth}
            class:today={cell.day === day}
            class:dot
            data-day={cell.day}
            aria-label={label(cell.day, dot)}
            aria-current={cell.day === day ? 'date' : undefined}
            aria-selected={cell.day === focusDay}
            tabindex={cell.day === focusDay ? 0 : -1}
            onfocus={() => (focusDay = cell.day)}
            onclick={() => onpick(cell.day)}
          >
            {Number(cell.day.slice(8, 10))}
          </button>
        {/each}
      </div>
    {/each}
  </div>
  <p class="c-key">
    <span><span class="k-dot" aria-hidden="true"></span>to-do items</span>
    <span><span class="k-week" aria-hidden="true"></span>week with items</span>
  </p>
</div>

<style>
  .calendar {
    position: absolute;
    z-index: 6;
    top: calc(100% + 4px);
    right: 0;
    width: 236px;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--overlay);
    border: 1px solid var(--surface-border);
    box-shadow: var(--overlay-shadow);
  }
  .calendar:focus {
    outline: none;
  }
  .c-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
  }
  .c-step {
    width: 24px;
    height: 24px;
  }
  .c-step:hover {
    background: var(--control);
  }
  .c-title {
    flex: 1;
    margin: 0;
    text-align: center;
    font-size: var(--fs-sm);
    font-weight: 700;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    border-radius: var(--radius-sm);
  }
  .row.shaded {
    background: var(--info-bg);
  }
  .row.shown {
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .name {
    padding: 2px 0 3px;
    text-align: center;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
  }
  .cell {
    position: relative;
    height: 28px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .cell:hover {
    background: var(--control);
  }
  .cell.out {
    color: var(--text-faint);
  }
  .cell.today {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
  }
  .cell.dot::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--accent);
  }
  .cell.today.dot::after {
    background: var(--accent-text);
  }
  .c-key {
    display: flex;
    justify-content: center;
    gap: var(--space-3);
    margin: var(--space-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .c-key > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .k-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
  }
  .k-week {
    width: 10px;
    height: 8px;
    border-radius: 2px;
    background: var(--info-bg);
  }
</style>
