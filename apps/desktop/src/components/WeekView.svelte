<script lang="ts">
  /**
   * TO-DO: the week, as one list of things to get done this week. There are no day sections: the
   * person picks up these items whenever they work, so the week is the only date that matters.
   * A header names the week and steps through weeks; the calendar jumps further. Under it, one
   * add row, then the open items, then the ticked ones in a Completed list, so ticking an item
   * moves it down out of the way while keeping it for the week's record.
   *
   * It is separate from task checklists on purpose: an item may point at a task, and ticking it
   * changes nothing on that task. Each week keeps its own items; a new week starts empty and the
   * old one is still there to browse.
   */
  import type { WeekFile } from '@ledge/core/pure';
  import { isoWeekOf } from '@ledge/core/pure';
  import {
    ANYTIME,
    doneEntries,
    neighbours,
    openEntries,
    weekLabel,
    type WeekItemPatch,
    type WeekRef,
  } from '../lib/week-view.ts';
  import { todayIso } from '../lib/time.ts';
  import MonthPicker from './MonthPicker.svelte';
  import WeekAdd from './WeekAdd.svelte';
  import WeekItemRow, { type TaskChoice } from './WeekItemRow.svelte';

  interface Props {
    week: WeekFile;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** Tasks an item can be linked to. */
    tasks?: TaskChoice[];
    /** A linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: (id: string) => string | undefined;
    onbrowse: (week: string) => void;
    onadd: (slot: string, text: string, taskId?: string) => unknown;
    onupdate: (ref: WeekRef, patch: WeekItemPatch) => unknown;
    onmove: (ref: WeekRef, to: string) => unknown;
    onremove: (ref: WeekRef) => unknown;
    onopentask?: (id: string) => void;
    /** Week files read so far, for the calendar's dots and shading. Without it, no calendar. */
    weeks?: Record<string, WeekFile>;
    /** The calendar shows these weeks: read the ones that have a file and are not read yet. */
    onloadweeks?: (weeks: string[]) => unknown;
  }

  let {
    week,
    day = todayIso(),
    tasks = [],
    taskTitle,
    onbrowse,
    onadd,
    onupdate,
    onmove,
    onremove,
    onopentask,
    weeks,
    onloadweeks,
  }: Props = $props();

  let calendarOpen = $state(false);
  let toggle = $state<HTMLButtonElement | null>(null);

  /** Shows the week a day picked in the calendar is in. */
  function pickDay(d: string) {
    calendarOpen = false;
    toggle?.focus();
    const target = isoWeekOf(d);
    if (target !== week.week) onbrowse(target);
  }

  const thisWeek = $derived(isoWeekOf(day));
  const current = $derived(week.week === thisWeek);
  const around = $derived(neighbours(week.week));
  const open = $derived(openEntries(week));
  const done = $derived(doneEntries(week));
  /** The Completed list starts open, so a tick visibly lands somewhere. */
  let showDone = $state(true);
</script>

<div class="pane">
  <div class="pane-scroll week">
    <div class="week-head">
      <button
        type="button"
        class="drop step motion"
        aria-label="Previous week"
        title="Previous week"
        onclick={() => onbrowse(around.prev)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M6.5 1.5 3 5l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <h2 class="week-title" aria-live="polite">{weekLabel(week.week)}</h2>
      <button
        type="button"
        class="drop step motion"
        aria-label="Next week"
        title="Next week"
        onclick={() => onbrowse(around.next)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if weeks}
        <button
          type="button"
          class="drop step cal motion"
          bind:this={toggle}
          data-calendar-toggle
          aria-label="Pick a week"
          aria-haspopup="dialog"
          aria-expanded={calendarOpen}
          title="Pick a week"
          onclick={() => (calendarOpen = !calendarOpen)}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.8" y="2.8" width="10.4" height="9.4" rx="2" fill="none" stroke="currentColor"
              stroke-width="1.3" />
            <path d="M1.8 5.8h10.4M4.7 1.5v2.6M9.3 1.5v2.6" stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" />
            <circle cx="7" cy="9" r="1" fill="currentColor" />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="btn this-week motion"
        disabled={current}
        onclick={() => onbrowse(thisWeek)}
      >
        This week
      </button>
      {#if calendarOpen && weeks}
        <MonthPicker
          {day}
          week={week.week}
          {weeks}
          onmonth={onloadweeks}
          onpick={(d) => pickDay(d)}
          onclose={() => (calendarOpen = false)}
        />
      {/if}
    </div>

    <WeekAdd
      label={current ? 'Add something for this week' : `Add to ${weekLabel(week.week)}`}
      {tasks}
      onadd={(text, taskId) => onadd(ANYTIME, text, taskId)}
      persistent
    />

    {#if open.length > 0}
      <ul class="items" aria-label="To do this week">
        {#each open as entry (`${entry.ref.slot}:${entry.ref.index}:${entry.item.text}`)}
          <WeekItemRow
            item={entry.item}
            slot={entry.ref.slot}
            slots={[]}
            {tasks}
            taskTitle={entry.item.taskId ? taskTitle?.(entry.item.taskId) : undefined}
            onupdate={(patch) => onupdate(entry.ref, patch)}
            onmove={(to) => onmove(entry.ref, to)}
            onremove={() => onremove(entry.ref)}
            {onopentask}
          />
        {/each}
      </ul>
    {:else}
      <p class="empty-note">
        {done.length > 0 ? 'Everything for this week is done.' : 'Nothing planned for this week yet.'}
      </p>
    {/if}

    {#if done.length > 0}
      <section class="completed" aria-label="Completed">
        <button
          type="button"
          class="completed-head motion"
          aria-expanded={showDone}
          onclick={() => (showDone = !showDone)}
        >
          <svg class="chev" class:open={showDone} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Completed</span>
          <span class="count">{done.length}</span>
        </button>
        {#if showDone}
          <ul class="items done-items">
            {#each done as entry (`${entry.ref.slot}:${entry.ref.index}:${entry.item.text}`)}
              <WeekItemRow
            item={entry.item}
            slot={entry.ref.slot}
            slots={[]}
            {tasks}
            taskTitle={entry.item.taskId ? taskTitle?.(entry.item.taskId) : undefined}
            onupdate={(patch) => onupdate(entry.ref, patch)}
            onmove={(to) => onmove(entry.ref, to)}
            onremove={() => onremove(entry.ref)}
            {onopentask}
          />
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .week {
    gap: var(--space-1);
  }
  .week-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .step {
    width: 24px;
    height: 24px;
  }
  .step:hover {
    background: var(--control);
  }
  .week-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    text-align: center;
    font-size: var(--fs-base);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .cal[aria-expanded='true'] {
    background: var(--control);
    color: var(--text);
  }
  .this-week {
    padding: 3px var(--space-2);
    font-size: var(--fs-xs);
  }

  .empty-note {
    margin: var(--space-2) var(--space-2) 0;
    font-size: var(--fs-sm);
    color: var(--text-faint);
  }
  .items {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .completed {
    margin-top: var(--space-3);
    border-top: 1px solid var(--surface-border);
    padding-top: var(--space-2);
  }
  .completed-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 2px var(--space-2);
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 700;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .completed-head:hover {
    background: var(--control);
  }
  .completed-head .count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .chev {
    transition: transform 150ms ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
  .done-items {
    opacity: 0.7;
  }
</style>
