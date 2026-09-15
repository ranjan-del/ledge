<script lang="ts">
  /**
   * One repository from the git scan. Chips: unpushed (amber), dirty (red), and, for later
   * connectors, in review (teal) and deployed (green). Shows the referencing task's title.
   */
  import type { RepoStatus } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';

  interface Props {
    status: RepoStatus;
    taskTitle?: string;
    review?: string;
    deployed?: string;
  }

  let { status, taskTitle, review, deployed }: Props = $props();
  const name = $derived(basename(status.repo));
  const noUpstream = $derived(!status.upstream && status.branch !== 'main' && status.branch !== 'master');
</script>

<article class="row" data-repo={status.repo}>
  <div class="head">
    <h3 class="title" title={status.repo}>{name}</h3>
    <span class="time">{relativeTime(status.lastActivity)}</span>
  </div>
  <div class="meta">
    <span class="branch">{status.branch}</span>
    {#if status.ahead > 0}
      <span class="chip amber">{status.ahead} unpushed</span>
    {/if}
    {#if noUpstream}
      <span class="chip amber">no upstream</span>
    {/if}
    {#if status.behind > 0}
      <span class="chip grey">{status.behind} behind</span>
    {/if}
    {#if status.dirty.length > 0}
      <span class="chip red">{status.dirty.length} dirty</span>
    {/if}
    {#if review}
      <span class="chip teal">{review}</span>
    {/if}
    {#if deployed}
      <span class="chip green">{deployed}</span>
    {/if}
  </div>
  {#if taskTitle}
    <p class="task">{taskTitle}</p>
  {/if}
</article>

<style>
  .row {
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-card);
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--text-faint);
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
  .branch {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .task {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .chip {
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .amber { background: var(--chip-amber-bg); color: var(--chip-amber-fg); }
  .red { background: var(--chip-red-bg); color: var(--chip-red-fg); }
  .teal { background: var(--chip-teal-bg); color: var(--chip-teal-fg); }
  .green { background: var(--chip-green-bg); color: var(--chip-green-fg); }
  .grey { background: var(--chip-grey-bg); color: var(--chip-grey-fg); }
</style>
