<script lang="ts">
  /**
   * One repository from the git scan, on the Pending tab. Nobody types this tab: it is computed,
   * so the row's whole job is to say which repo, which branch, and what is unfinished there, in
   * the same words the home view uses. The git state comes from the shared GitChips so a repo
   * cannot describe itself one way here and another way on a task row.
   */
  import type { RepoStatus } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';
  import GitChips from './GitChips.svelte';

  interface Props {
    status: RepoStatus;
    taskTitle?: string;
    review?: string;
    deployed?: string;
  }

  let { status, taskTitle, review, deployed }: Props = $props();
  const name = $derived(basename(status.repo));
</script>

<article class="row card" data-repo={status.repo}>
  <div class="head">
    <h3 class="title trunc" title={status.repo}>{name}</h3>
    <span class="when-text">{relativeTime(status.lastActivity)}</span>
  </div>
  <GitChips repo={status.repo} {status} branch {review} {deployed} />
  {#if taskTitle}
    <p class="quiet trunc">{taskTitle}</p>
  {/if}
</article>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: var(--space-2) var(--space-3);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .title {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 600;
  }
</style>
