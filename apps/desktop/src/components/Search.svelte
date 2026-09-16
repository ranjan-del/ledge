<script lang="ts">
  /**
   * What the search pill opens: one field and the lines that match it, across every task on the
   * desk and every dated note in them. It exists because the pill in the header is a promise,
   * and a header ornament that does nothing is worse than no ornament.
   *
   * It takes the whole panel while it is open rather than floating over the surface behind it.
   * At 380 px wide there is no room for an overlay that leaves useful context visible, and a
   * translucent sheet over a translucent sheet is unreadable.
   *
   * Nothing is ranked. Hits come back in the order `searchDesk` finds them, tasks before notes,
   * and choosing one opens the task it came from.
   */
  import type { Task } from '@ledge/core/pure';
  import { searchDesk } from '../lib/search.ts';
  import { dayLabel, todayIso } from '../lib/time.ts';

  interface Props {
    tasks: Task[];
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    onselect: (task: Task) => void;
    onclose: () => void;
  }

  let { tasks, day = todayIso(), onselect, onclose }: Props = $props();

  let query = $state('');
  let field = $state<HTMLInputElement | null>(null);

  const hits = $derived(searchDesk(tasks, query));

  $effect(() => {
    field?.focus();
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    /* Enter takes the first hit, which is what a person who has already typed the answer
       expects, and does nothing at all when there is no hit to take. */
    if (event.key === 'Enter' && hits.length > 0) {
      event.preventDefault();
      onselect(hits[0].task);
    }
  }
</script>

<div class="pane search">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="finder" role="search" onkeydown={onKeydown}>
    <input
      class="field"
      type="text"
      bind:this={field}
      bind:value={query}
      placeholder="Search tasks and notes"
      aria-label="Search tasks and notes"
      autocomplete="off"
      spellcheck="false"
    />
    <button type="button" class="btn motion" onclick={onclose}>Close</button>
  </div>

  <div class="pane-scroll">
    {#if query.trim() === ''}
      <p class="quiet faint">
        Type to search every task title, requirement, plan step, checklist item and note.
      </p>
    {:else if hits.length === 0}
      <p class="quiet">Nothing matches "{query}".</p>
    {:else}
      <div class="rows">
        {#each hits as hit, i (hit.kind + hit.task.file + i)}
          <button type="button" class="hit card motion" onclick={() => onselect(hit.task)}>
            <span class="line">{hit.text}</span>
            <span class="sub trunc">
              {#if hit.kind === 'note'}
                note, {dayLabel(hit.date ?? '', day)} · {hit.where}
              {:else}
                {hit.task.title} · {hit.where}
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .hit {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    text-align: left;
  }
  .hit:hover {
    background: var(--surface-hover);
  }
  .line {
    font-size: var(--fs-sm);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
</style>
