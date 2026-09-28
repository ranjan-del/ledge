<script lang="ts">
  /**
   * This week: the first few weekly to-do items that are not ticked yet, as the same cards the
   * To-do view draws, tickable where they are and opened in place to edit their words and
   * description. One line says how many more the week holds, which opens the To-do view. A
   * week with nothing open shows no block at all. It sits on the idle Assistant, where Now had
   * it. The cards do not drag here: this is a preview of the week, not the place to plan it.
   */
  import type { WeekItem } from '@ledge/core/pure';
  import type { WeekItemPatch, WeekRef } from '../lib/week-view.ts';
  import WeekItemRow from './WeekItemRow.svelte';

  interface Props {
    /** The first few unticked items of this week's to-do, each with where it lives in the file. */
    items?: { item: WeekItem; ref: WeekRef }[];
    /** Unticked items elsewhere in this week: Anytime and the other days. */
    more?: number;
    /** Ticks one of the items. */
    ontick?: (ref: WeekRef) => unknown;
    /** Changes an item's words or description. Without it the cards only tick. */
    onupdate?: (ref: WeekRef, patch: WeekItemPatch) => unknown;
    /** Opens the To-do view on this week. */
    onopenweek?: () => void;
    /** A linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: (id: string) => string | undefined;
    onopentask?: (id: string) => void;
  }

  let { items = [], more = 0, ontick, onupdate, onopenweek, taskTitle, onopentask }: Props = $props();

  const show = $derived(items.length + more > 0);
  /** Which card is open, by where its item is. One at a time. */
  let expanded = $state<string | null>(null);
  const refKey = (ref: WeekRef) => `${ref.slot}:${ref.index}`;

  /** A tick is the one edit this block always had; anything else goes to the full update. */
  function update(ref: WeekRef, patch: WeekItemPatch): unknown {
    if (patch.done === true && Object.keys(patch).length === 1) return ontick?.(ref);
    if (!onupdate) throw new Error('This item can only be ticked here.');
    return onupdate(ref, patch);
  }
</script>

{#if show}
  <section class="block week-today" aria-labelledby="today-label">
    <h3 class="section-label" id="today-label">
      This week
      {#if items.length > 0}<span class="count">{items.length}</span>{/if}
    </h3>
    {#if items.length > 0}
      <ul class="today-list">
        {#each items as entry (`${entry.ref.slot}:${entry.ref.index}:${entry.item.text}`)}
          <WeekItemRow
            item={entry.item}
            slot={entry.ref.slot}
            taskTitle={entry.item.taskId ? taskTitle?.(entry.item.taskId) : undefined}
            onupdate={(patch) => update(entry.ref, patch)}
            {onopentask}
            expanded={expanded === refKey(entry.ref)}
            onexpand={(open) => {
              const key = refKey(entry.ref);
              if (open) expanded = key;
              else if (expanded === key) expanded = null;
            }}
          />
        {/each}
      </ul>
    {/if}
    {#if more > 0}
      <button type="button" class="more-week motion" onclick={() => onopenweek?.()}>
        <span class="what">
          {more} more this week
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {/if}
  </section>
{/if}

<style>
  .today-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .more-week {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin-top: 2px;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .more-week:hover {
    background: var(--surface);
    color: var(--text);
  }
  .more-week .what {
    flex: 1;
    min-width: 0;
  }
</style>
