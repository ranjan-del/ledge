<script lang="ts">
  /**
   * Finished work, newest first. It shows the title, the day it was finished and the checklist
   * as it stood when it was, because a task marked done with two of five items ticked is a
   * different memory from one that was finished to the letter, and this is the only place that
   * record survives.
   *
   * "Finished" means a task whose status is done, not a file that happens to live in
   * `~/.ledge/archive`. Most of them are in the archive, because marking one done moves it
   * there; the store hands over any whose move has not happened as well, so a task can never be
   * finished and invisible at the same time.
   *
   * These are records, not a workbench: hairlines rather than cards, nothing to hover, nothing
   * to click. The rows say what happened and then get out of the way.
   */
  import type { Task } from '@ledge/core/pure';
  import { dayLabel, todayIso } from '../lib/time.ts';
  import Progress from './Progress.svelte';

  interface Props {
    /** Archived tasks, newest first. The store sorts them; this only draws them. */
    tasks: Task[];
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** The archive is being read. True only on the first switch to this view. */
    loading?: boolean;
  }

  let { tasks, day = todayIso(), loading = false }: Props = $props();

  /** The day a task was finished: the last time it was written, which is when it was done. */
  function finishedOn(task: Task): string {
    return dayLabel(task.updated.slice(0, 10), day);
  }

  function ticked(task: Task): number {
    return task.checklist.filter((i) => i.done).length;
  }
</script>

<div class="pane">
  <div class="pane-scroll">
    {#if tasks.length > 0}
      <div class="done-rows">
        {#each tasks as task (task.file)}
          <article class="done">
            <div class="head">
              <h3 class="title">{task.title}</h3>
              <span class="when-text">{finishedOn(task)}</span>
            </div>
            {#if task.checklist.length > 0}
              <Progress done={ticked(task)} total={task.checklist.length} />
            {:else}
              <span class="nolist">no checklist</span>
            {/if}
          </article>
        {/each}
      </div>
    {:else if loading}
      <p class="quiet">Reading the archive.</p>
    {:else}
      <p class="quiet">Nothing finished yet.</p>
    {/if}
  </div>
</div>

<style>
  .done-rows {
    display: flex;
    flex-direction: column;
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-1);
  }
  /* A rule between records, not a card each: forty finished tasks as forty cards is a wall. */
  .done + .done {
    border-top: 1px solid var(--rule);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .title {
    flex: 1;
    margin: 0;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 500;
    line-height: 1.3;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  /* A short bar, not a full-width one. Stretched across the panel, four finished checklists
     read as four green banners, which is a lot of emphasis for work nobody has to do. */
  .done :global(.progress) {
    max-width: 150px;
  }
  .nolist {
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
</style>
