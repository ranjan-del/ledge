<script lang="ts">
  /**
   * TO-DO: the week, as a list of reminders. A header that names the week and steps through
   * weeks, then `Anytime this week` and the seven days, Monday first. It is separate from task
   * checklists on purpose: an item is something to remember this week, though it may point at a
   * task, and ticking it changes nothing on that task.
   *
   * Today is highlighted and the days of this week that have passed are muted, so the eye lands
   * on what is still ahead. A day with nothing on it is one line, its name and a quiet Add, not
   * an empty box; seven empty boxes would be a calendar, and this is a list.
   *
   * Each week keeps its own items. A new week starts empty and the old one is still there to
   * browse; nothing is carried over, because carrying it over is a decision the person makes by
   * moving or re-adding an item, not one the panel makes for them.
   */
  import type { WeekFile } from '../lib/week.ts';
  import { isoWeekOf, weekDays } from '../lib/week.ts';
  import {
    ANYTIME,
    dayHeading,
    dayName,
    neighbours,
    slotItems,
    weekLabel,
    type WeekItemPatch,
    type WeekRef,
  } from '../lib/week-view.ts';
  import { todayIso } from '../lib/time.ts';
  import WeekAdd from './WeekAdd.svelte';
  import WeekItemRow, { type SlotChoice, type TaskChoice } from './WeekItemRow.svelte';

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
  }: Props = $props();

  const thisWeek = $derived(isoWeekOf(day));
  const current = $derived(week.week === thisWeek);
  const around = $derived(neighbours(week.week));

  interface Section {
    slot: string;
    title: string;
    /** How the add row names it: `Add to Wednesday`. */
    name: string;
    today: boolean;
    past: boolean;
  }

  const sections = $derived<Section[]>([
    { slot: ANYTIME, title: 'Anytime this week', name: 'Add for anytime this week', today: false, past: false },
    ...weekDays(week.week).map((d) => ({
      slot: d,
      title: dayHeading(d),
      name: `Add to ${dayName(d)}`,
      today: d === day,
      past: current && d < day,
    })),
  ]);

  const slots = $derived<SlotChoice[]>(
    sections.map((s) => ({ slot: s.slot, label: s.slot === ANYTIME ? 'Anytime' : s.title })),
  );

  /** The section whose add row is open, if one is. */
  let adding = $state<string | null>(null);
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
      <button
        type="button"
        class="btn this-week motion"
        disabled={current}
        onclick={() => onbrowse(thisWeek)}
      >
        This week
      </button>
    </div>

    {#each sections as section (section.slot)}
      {@const items = slotItems(week, section.slot)}
      {@const open = items.filter((i) => !i.done).length}
      <section
        class="day"
        class:today={section.today}
        class:past={section.past}
        class:empty={items.length === 0}
        aria-label={section.today ? `Today, ${section.title}` : section.title}
      >
        <div class="day-head">
          <h3 class="day-title">{section.title}</h3>
          {#if section.today}
            <span class="chip info">Today</span>
          {/if}
          {#if open > 0}
            <span class="day-count" aria-label="{open} open">{open}</span>
          {/if}
          {#if adding !== section.slot}
            <button
              type="button"
              class="add-line day-add motion"
              aria-label={section.name}
              onclick={() => (adding = section.slot)}
            >
              + Add
            </button>
          {/if}
        </div>
        {#if items.length > 0}
          <ul class="items">
            {#each items as item, index (`${section.slot}:${index}:${item.text}`)}
              <WeekItemRow
                {item}
                slot={section.slot}
                {slots}
                {tasks}
                taskTitle={item.taskId ? taskTitle?.(item.taskId) : undefined}
                onupdate={(patch) => onupdate({ slot: section.slot, index }, patch)}
                onmove={(to) => onmove({ slot: section.slot, index }, to)}
                onremove={() => onremove({ slot: section.slot, index })}
                {onopentask}
              />
            {/each}
          </ul>
        {/if}
        {#if adding === section.slot}
          <WeekAdd
            label={section.name}
            {tasks}
            onadd={(text, taskId) => onadd(section.slot, text, taskId)}
            onclose={() => (adding = null)}
          />
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .week {
    gap: var(--space-1);
  }
  .week-head {
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
  .this-week {
    padding: 3px var(--space-2);
    font-size: var(--fs-xs);
  }

  .day {
    display: flex;
    flex-direction: column;
    padding: var(--space-1) var(--space-2) var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
  }
  .day:not(.empty) {
    padding-bottom: var(--space-2);
  }
  /* Today is the one section drawn as a card, with the accent down its side. */
  .day.today {
    background: var(--surface);
    border-color: var(--surface-border);
    box-shadow: inset 2px 0 0 var(--accent), var(--shadow-card);
  }
  .day.past {
    opacity: 0.55;
  }
  .day.past:hover,
  .day.past:focus-within {
    opacity: 1;
  }
  .day-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 22px;
  }
  .day-title {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-muted);
  }
  .today .day-title {
    color: var(--text);
  }
  .day-count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .day-add {
    margin: 0 0 0 auto;
    padding: 2px 0 2px var(--space-2);
  }
  /* An empty day's Add is quieter still until the row is pointed at or reached by Tab. */
  .empty .day-add {
    opacity: 0.7;
  }
  .empty:hover .day-add,
  .day-add:focus-visible {
    opacity: 1;
  }
  .items {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .day .items {
    margin-left: calc(-1 * var(--space-2));
  }
</style>
