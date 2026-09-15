<script lang="ts">
  /**
   * "What is on for today", the first thing the home view answers (contract section 7.1). It
   * exists because a list of tasks cannot say when you meant to do any of them: this block is
   * the only place the `planned` day shows up as an answer rather than as a field.
   *
   * Overdue tasks come first, because a day you have already missed outranks the day you are
   * in, and they are marked in three ways that survive greyscale: a count in the heading, the
   * word "late" with the number of days on the row, and a stripe down its left edge. The block
   * renders nothing at all when nothing is planned, rather than an empty heading.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import { staggering } from '../lib/motion.svelte.ts';
  import { parseDay, todayIso } from '../lib/time.ts';
  import TaskRow from './TaskRow.svelte';

  interface Props {
    /** Planned for `day`, in priority order. */
    today: Task[];
    /** Planned before `day` and still not done, oldest first. */
    overdue: Task[];
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** The number the first row in this block is given. Rows are numbered as displayed. */
    startRank?: number;
    statusFor?: (repo: string | undefined) => RepoStatus | undefined;
    onselect: (task: Task) => void;
  }

  let { today, overdue, day = todayIso(), startRank = 1, statusFor, onselect }: Props = $props();

  const total = $derived(today.length + overdue.length);
  const heading = $derived(
    parseDay(day)?.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) ??
      day,
  );
</script>

{#if total > 0}
  <section class="block" aria-labelledby="today-heading">
    <h2 class="block-head" id="today-heading">
      Today
      {#if overdue.length > 0}
        <span class="chip late">{overdue.length} late</span>
      {/if}
      <span class="when">{heading}</span>
      <span class="count">{total}</span>
    </h2>

    {#if overdue.length > 0}
      <div class="rows" class:enter={staggering()}>
        {#each overdue as task, i (task.file)}
          <TaskRow
            {task}
            {day}
            rank={startRank + i}
            status={statusFor?.(task.repo)}
            {onselect}
          />
        {/each}
      </div>
    {/if}

    {#if today.length > 0}
      <div class="rows" class:spaced={overdue.length > 0} class:enter={staggering()}>
        {#each today as task, i (task.file)}
          <TaskRow
            {task}
            {day}
            rank={startRank + overdue.length + i}
            showPlanned={false}
            status={statusFor?.(task.repo)}
            {onselect}
          />
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .rows.spaced {
    margin-top: var(--space-2);
  }
</style>
