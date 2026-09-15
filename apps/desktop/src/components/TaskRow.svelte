<script lang="ts">
  /**
   * One task, as the smallest thing that still answers "does this matter and what state is it
   * in". Three lines at most, each one earning its height: the priority number and the title;
   * then where it lives and what git says about it; then how far along it is and when it was
   * last touched. It exists because the old row put a timestamp where the state belonged and
   * drew progress as a 3 px hairline, so every row looked the same at a glance.
   *
   * Lateness is spelled out ("3 days late") and carries a stripe down the left edge, so it is
   * never colour alone that tells you. Backlog rows add the parked reason and the two actions
   * that only make sense there.
   *
   * When a task has notes, the newest one shows here as a single truncated line. That line is
   * the assistant remembering: it is the difference between a row that names a task and a row
   * that tells you where you left off.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { dayLabel, daysBetween, lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import GitChips from './GitChips.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    task: Task;
    status?: RepoStatus;
    /** Position in the list it is shown in, 1 is top. Omitted where order means nothing. */
    rank?: number;
    /** Today, as YYYY-MM-DD. A prop so the row is testable without touching the clock. */
    day?: string;
    /**
     * Show the "planned tomorrow" chip. The Today block turns it off because its own heading
     * already says today; the late chip is never suppressed, because that is a warning.
     */
    showPlanned?: boolean;
    review?: string;
    deployed?: string;
    onselect: (task: Task) => void;
    onstart?: (task: Task) => void;
    onopen?: (task: Task) => void;
  }

  let {
    task,
    status,
    rank,
    day = todayIso(),
    showPlanned = true,
    review,
    deployed,
    onselect,
    onstart,
    onopen,
  }: Props = $props();

  const done = $derived(task.checklist.filter((i) => i.done).length);
  const total = $derived(task.checklist.length);
  const repoName = $derived(task.repo ? basename(task.repo) : '');
  /** Positive when the planned day has passed, 0 when it is today, negative when it is ahead. */
  const behind = $derived(task.planned ? daysBetween(task.planned, day) : undefined);
  const late = $derived(behind !== undefined && behind > 0);
  const latest = $derived(task.notes[task.notes.length - 1]);
  /* One line, so only the note's first line is worth reading out. */
  const recall = $derived(latest ? latest.body.split('\n')[0].trim() : '');
</script>

<article class="row card motion" class:late data-id={task.id}>
  <button type="button" class="main" onclick={() => onselect(task)} aria-label="Open {task.title}">
    <div class="head">
      {#if rank !== undefined}
        <span class="rank" aria-hidden="true">{rank}</span>
      {/if}
      <h3 class="title">{task.title}</h3>
    </div>

    {#if late || (showPlanned && behind !== undefined) || repoName || status}
      <div class="meta">
        {#if late && task.planned}
          <span class="chip late">
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.2" />
              <path d="M5 2.6V5l1.8 1.1" fill="none" stroke="currentColor" stroke-width="1.2"
                stroke-linecap="round" />
            </svg>
            {lateLabel(task.planned, day)}
          </span>
        {:else if showPlanned && behind !== undefined && task.planned}
          <span class="chip neutral">planned {dayLabel(task.planned, day)}</span>
        {/if}
        {#if repoName}
          <span class="repo trunc" title={task.repo}>{repoName}</span>
        {/if}
        <GitChips repo={task.repo} {status} branch {review} {deployed} />
      </div>
    {/if}

    {#if recall}
      <p class="recall trunc">
        <span class="recall-when">{dayLabel(latest.date, day)}</span>
        {recall}
      </p>
    {/if}

    <div class="foot">
      {#if total > 0}
        <Progress {done} {total} />
      {:else}
        <span class="nolist">no checklist yet</span>
      {/if}
      <span class="when-text">{relativeTime(task.updated)}</span>
    </div>

    {#if task.status === 'backlog' && task.parked}
      <p class="quiet">Parked: {task.parked}</p>
    {/if}
  </button>

  {#if task.status === 'backlog' && (onstart || onopen)}
    <div class="row-actions actions">
      {#if onstart}
        <button type="button" class="btn" onclick={() => onstart?.(task)}>Start</button>
      {/if}
      {#if onopen}
        <button type="button" class="btn" onclick={() => onopen?.(task)}>Open in Claude</button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .row {
    position: relative;
    overflow: hidden;
  }
  .row:hover {
    background: var(--surface-hover);
  }
  /* A stripe, not a tint: late has to survive a translucent ground and greyscale. */
  .row.late::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--late-edge);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
  }
  .row.late .main {
    padding-left: calc(var(--space-3) + 3px);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .rank {
    flex: none;
    min-width: 12px;
    font-size: var(--fs-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .title {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 600;
    line-height: 1.3;
    /* Wrap rather than truncate: a title the panel cannot show is a task you cannot find. */
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    min-width: 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .repo {
    max-width: 150px;
    font-weight: 500;
  }
  /* The chips join this line's wrapping instead of wrapping as one block of their own,
     which is the difference between two tidy lines and three ragged ones. */
  .meta :global(.git) {
    display: contents;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .foot :global(.progress) {
    flex: 1;
    min-width: 0;
  }
  .nolist {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  /* The most recent note, one line of it. Never two: this is a reminder, not the note. */
  .recall {
    margin: 0;
    max-width: 100%;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .recall-when {
    font-weight: 600;
    color: var(--text-faint);
  }
  .actions {
    padding: 0 var(--space-3) var(--space-2);
  }
</style>
