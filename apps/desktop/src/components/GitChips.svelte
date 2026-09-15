<script lang="ts">
  /**
   * Live git state for one repository, as words first and colour second: "3 uncommitted",
   * "2 unpushed", "in review", "clean". It exists so the same state reads the same way on a
   * task row, in task detail and on a Pending row, and so that the two states a person can
   * lose work to (uncommitted, unpushed) are never told apart by hue alone. The small arrows
   * are the one place an icon carries meaning the word does not: which direction the work has
   * yet to travel. A task with no repository renders nothing at all, rather than empty chips.
   */
  import type { RepoStatus } from '@ledge/core/pure';

  interface Props {
    /** Absent when the task has no repository: nothing is rendered. */
    repo?: string;
    /** Absent when the repo has not been scanned yet: only the repo name is known. */
    status?: RepoStatus;
    /** Show the branch name before the chips. */
    branch?: boolean;
    /** Optional connector states (contract phase 3). */
    review?: string;
    deployed?: string;
  }

  let { repo, status, branch = false, review, deployed }: Props = $props();

  const dirty = $derived(status ? status.dirty.length : 0);
  const ahead = $derived(status?.ahead ?? 0);
  const behind = $derived(status?.behind ?? 0);
  const noUpstream = $derived(
    !!status && !status.upstream && status.branch !== 'main' && status.branch !== 'master',
  );
  /* Behind is not dirty, but it is not "clean" either: something is waiting to come in. */
  const clean = $derived(!!status && dirty === 0 && ahead === 0 && behind === 0 && !noUpstream);
</script>

{#if repo && status}
  <span class="git">
    {#if branch}
      <span class="mono trunc" title="branch">{status.branch}</span>
    {/if}
    {#if dirty > 0}
      <span class="chip attention">
        <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
          <circle cx="4" cy="4" r="3" fill="currentColor" />
        </svg>
        {dirty} uncommitted
      </span>
    {/if}
    {#if ahead > 0}
      <span class="chip attention">
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M4 7V1.6M1.6 4 4 1.4 6.4 4" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {ahead} unpushed
      </span>
    {/if}
    {#if noUpstream}
      <span class="chip attention">no remote branch</span>
    {/if}
    {#if behind > 0}
      <span class="chip neutral">
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M4 1v5.4M1.6 4 4 6.6 6.4 4" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {behind} behind
      </span>
    {/if}
    {#if review}
      <span class="chip review">{review}</span>
    {/if}
    {#if deployed}
      <span class="chip done">{deployed}</span>
    {/if}
    {#if clean && !review && !deployed}
      <span class="chip done">
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.2 4.4 3 6.2l3.8-4.4" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        clean
      </span>
    {/if}
  </span>
{/if}

<style>
  .git {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) 6px;
    min-width: 0;
  }
  .mono {
    max-width: 120px;
    color: var(--text-muted);
  }
</style>
