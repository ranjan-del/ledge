<script lang="ts">
  /**
   * Checklist progress as a proportion you can read without counting. It exists because the
   * hairline it replaces was 3 px of accent colour that said "some" rather than "two of five":
   * up to ten items the bar is one segment per item, so the eye reads the actual fraction, and
   * beyond that it falls back to a filled proportion because segments would be thinner than the
   * gaps between them. The count is always spelled out beside it, since colour and length are
   * both unreliable on their own. Renders nothing when there is no checklist.
   *
   * The change is animated rather than jumped: a segment fills, or the bar grows to its new
   * width, so ticking something off registers as progress instead of as a redraw.
   */
  interface Props {
    done: number;
    total: number;
    /** Hide the "2 of 5" label where the surrounding block already states it. */
    label?: boolean;
  }

  let { done, total, label = true }: Props = $props();

  const pct = $derived(total === 0 ? 0 : Math.round((done / total) * 100));
  const segmented = $derived(total > 0 && total <= 10);
  const complete = $derived(total > 0 && done >= total);
</script>

{#if total > 0}
  <div class="progress">
    <div
      class="track"
      class:complete
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={pct}
      aria-label="{done} of {total} checklist items done"
    >
      {#if segmented}
        {#each Array.from({ length: total }, (_, i) => i) as i (i)}
          <span class="seg" class:on={i < done}></span>
        {/each}
      {:else}
        <span class="fill" style:width="{pct}%"></span>
      {/if}
    </div>
    {#if label}
      <span class="count">{done} of {total}</span>
    {/if}
  </div>
{/if}

<style>
  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .track {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 2px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--progress-track);
    overflow: hidden;
  }
  .seg {
    flex: 1;
    min-width: 1px;
    background: transparent;
  }
  .seg.on {
    background: var(--progress-fill);
  }
  .fill {
    height: 100%;
    background: var(--progress-fill);
    border-radius: var(--radius-pill);
  }
  @media (prefers-reduced-motion: no-preference) {
    .seg {
      transition: background-color 240ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    .fill {
      transition: width 280ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
  }
  .count {
    flex: none;
    font-size: var(--fs-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .track.complete + .count {
    color: var(--done-fg);
  }
</style>
