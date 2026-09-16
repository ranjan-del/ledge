<script lang="ts">
  /**
   * What changed while you were away, at the top of NOW, with one button back into the work.
   * It exists because the panel is closed most of the day and the store keeps moving without
   * it: Claude Code ticks items and writes notes, the scan notices commits, tasks get archived.
   * Coming back to a list that looks exactly as it did before, but is not, is how a person
   * loses track of their own week.
   *
   * Every line is a count of something observed, produced by `lib/away.ts` from the difference
   * between two observations of the store. There is no line for anything the files do not
   * record: no time spent, no sessions run, no files named. When nothing happened at all it
   * says so in one sentence rather than padding the space with zeroes, which is the reason
   * `lines` can be empty and still be the truth.
   *
   * It does not linger. `onseen` fires as soon as it has been on screen, which is what records
   * the absence as reported, and the dismiss and the resume button both take it away. Coming
   * back in five minutes shows nothing; coming back after another afternoon shows that
   * afternoon.
   */
  import { onMount } from 'svelte';
  import type { AwaySummary } from '../lib/away.ts';
  import { relativeTime } from '../lib/time.ts';

  interface Props {
    summary: AwaySummary;
    /** Opens the task the resume button names. */
    onresume: (file: string) => void;
    /** Takes the summary off the surface. */
    ondismiss: () => void;
    /** Called once, after the first paint, to record the absence as reported. */
    onseen?: () => void;
  }

  let { summary, onresume, ondismiss, onseen }: Props = $props();

  const quiet = $derived(summary.lines.length === 0);

  onMount(() => onseen?.());
</script>

<section class="away note-card" aria-labelledby="away-heading">
  <h3 class="section-label" id="away-heading">
    While you were away
    <span class="count">{relativeTime(summary.since)}</span>
  </h3>
  <button type="button" class="drop motion" aria-label="Dismiss this summary" onclick={ondismiss}>
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
      <path d="M1 1 8 8M8 1 1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  </button>

  {#if quiet}
    <p class="quiet">No activity in the store while the panel was closed.</p>
  {:else}
    <ul class="item-list">
      {#each summary.lines as line (line)}
        <li>
          <span class="state-dot" aria-hidden="true"></span>
          <span>{line}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if summary.resumeFile && summary.resumeTitle}
    <button
      type="button"
      class="btn primary motion back"
      onclick={() => summary.resumeFile && onresume(summary.resumeFile)}
    >
      <span class="trunc">Back to {summary.resumeTitle}</span>
    </button>
  {/if}
</section>

<style>
  /* The cross sits over the top right corner rather than in a row of its own: the summary is
     three short things, and a header bar around one of them would be the fourth. */
  .away {
    position: relative;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
  }
  .away .section-label {
    margin: 0;
  }
  .drop {
    position: absolute;
    top: 5px;
    right: 5px;
    padding: 2px;
  }
  /* The one filled button on the surface, because it is the one thing to do next. */
  .back {
    align-self: flex-start;
    max-width: 100%;
  }
</style>
