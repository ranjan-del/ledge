<script lang="ts">
  /**
   * One task as a soft card: title, repo short name, branch and ahead count when the repo was
   * scanned, a thin progress bar, and the parked reason plus actions for backlog rows.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';

  interface Props {
    task: Task;
    status?: RepoStatus;
    onselect: (task: Task) => void;
    onstart?: (task: Task) => void;
    onopen?: (task: Task) => void;
  }

  let { task, status, onselect, onstart, onopen }: Props = $props();

  const done = $derived(task.checklist.filter((i) => i.done).length);
  const total = $derived(task.checklist.length);
  const pct = $derived(total === 0 ? 0 : Math.round((done / total) * 100));
  const repoName = $derived(task.repo ? basename(task.repo) : '');
</script>

<article class="row motion" data-id={task.id}>
  <button type="button" class="main" onclick={() => onselect(task)} aria-label="Open {task.title}">
    <div class="head">
      <h3 class="title">{task.title}</h3>
      <span class="time">{relativeTime(task.updated)}</span>
    </div>
    <div class="meta">
      {#if repoName}
        <span class="repo" title={task.repo}>{repoName}</span>
      {/if}
      {#if status}
        <span class="branch" title="branch">{status.branch}</span>
        {#if status.ahead > 0}
          <span class="chip amber">{status.ahead} unpushed</span>
        {/if}
        {#if status.dirty.length > 0}
          <span class="chip red">{status.dirty.length} dirty</span>
        {/if}
      {/if}
      {#if total > 0}
        <span class="progress-text">{done}/{total}</span>
      {/if}
    </div>
    {#if total > 0}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
        <div class="fill" style:width="{pct}%"></div>
      </div>
    {/if}
    {#if task.status === 'backlog' && task.parked}
      <p class="parked">Parked: {task.parked}</p>
    {/if}
  </button>
  {#if task.status === 'backlog' && (onstart || onopen)}
    <div class="actions">
      {#if onstart}
        <button type="button" class="action" onclick={() => onstart?.(task)}>Start</button>
      {/if}
      {#if onopen}
        <button type="button" class="action" onclick={() => onopen?.(task)}>Open in Claude</button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .row {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-card);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .main {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .title {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin-top: 3px;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .repo {
    font-weight: 500;
  }
  .branch {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .progress-text {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .bar {
    height: 3px;
    margin-top: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--progress-track);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--progress-fill);
    border-radius: var(--radius-pill);
  }
  .parked {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-2);
  }
  .action {
    padding: 3px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--control);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
  }
  .action:hover {
    background: var(--control-active);
  }
  .chip {
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .chip.amber {
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
  }
  .chip.red {
    background: var(--chip-red-bg);
    color: var(--chip-red-fg);
  }
</style>
