<script lang="ts">
  /**
   * Today: the weekly to-do items for this day that are not ticked yet, tickable where they
   * are, and one line saying how many more the week holds, which opens the To-do view. A week
   * with nothing in it shows no block at all. It sits on the idle Assistant, where Now had it.
   */
  import type { WeekItem } from '@ledge/core/pure';
  import type { WeekRef } from '../lib/week-view.ts';

  interface Props {
    /** Today's weekly to-do items that are not ticked, each with where it lives in the file. */
    items?: { item: WeekItem; ref: WeekRef }[];
    /** Unticked items elsewhere in this week: Anytime and the other days. */
    more?: number;
    /** Ticks one of today's items. */
    ontick?: (ref: WeekRef) => unknown;
    /** Opens the To-do view on this week. */
    onopenweek?: () => void;
    /** A linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: (id: string) => string | undefined;
    onopentask?: (id: string) => void;
  }

  let { items = [], more = 0, ontick, onopenweek, taskTitle, onopentask }: Props = $props();

  const show = $derived(items.length + more > 0);
  let error = $state('');

  function tick(ref: WeekRef) {
    error = '';
    void Promise.resolve()
      .then(() => ontick?.(ref))
      .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
  }
</script>

{#if show}
  <section class="block week-today" aria-labelledby="today-label">
    <h3 class="section-label" id="today-label">
      Today
      {#if items.length > 0}<span class="count">{items.length}</span>{/if}
    </h3>
    {#if items.length > 0}
      <ul class="today-list">
        {#each items as entry (`${entry.ref.index}:${entry.item.text}`)}
          <li>
            <label class="today-item motion">
              <input
                type="checkbox"
                checked={false}
                aria-label={`Tick: ${entry.item.text}`}
                onchange={() => tick(entry.ref)}
              />
              <span class="what">{entry.item.text}</span>
            </label>
            {#if entry.item.taskId}
              {@const title = taskTitle?.(entry.item.taskId)}
              <button
                type="button"
                class="chip neutral task-chip motion"
                disabled={title === undefined || !onopentask}
                title={title === undefined ? 'That task is not on the desk' : 'Open the task'}
                onclick={() => entry.item.taskId && onopentask?.(entry.item.taskId)}
              >
                <span class="trunc">{title ?? entry.item.taskId}</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}
      <p class="edit-error" role="alert">{error}</p>
    {/if}
    {#if more > 0}
      <button type="button" class="more-week motion" onclick={() => onopenweek?.()}>
        <span class="what">
          {items.length === 0 ? 'Nothing for today. ' : ''}{more} more this week
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
  /* Today's reminders are drawn like checklist items: they are things to tick, not tasks. */
  .today-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .today-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .today-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-size: var(--fs-base);
    line-height: 1.35;
  }
  .today-item:hover {
    background: var(--surface-hover);
  }
  .today-item input {
    margin: 2px 0 0;
    accent-color: var(--done-fill);
  }
  .today-item .what {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .task-chip {
    flex: none;
    max-width: 120px;
  }
  .task-chip:hover:not(:disabled) {
    color: var(--accent);
  }
  .task-chip:disabled {
    cursor: default;
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
