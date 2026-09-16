<script lang="ts">
  /**
   * The sheet that floats over the panel, and the dimmed ground behind it. It exists because
   * the panel has two things that must appear without losing what you were looking at, the
   * command palette and the notification centre, and both of them need the same scrim, the
   * same border, the same shadow and the same way out. Written twice they would drift apart.
   *
   * Everything else in the panel takes the whole scrolling region rather than floating, and
   * that stays true: these two are floating precisely because they are transient. The palette
   * is a question you are in the middle of asking, and the centre is a glance at what changed;
   * hiding the surface under either of them would cost you the context you opened it from.
   *
   * Escape closes, and so does a click on the ground, because a sheet at 380 px wide with no
   * visible way out is a trap. The entrance is a fade and a very small scale, which is the
   * only motion in here, and it does not happen at all for someone who asked for less.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** Names the dialog for a screen reader. */
    label: string;
    /**
     * `top` fills the panel's width just under its top edge, for the palette. `under-header`
     * hangs a narrower sheet from the header's right, under the control that opened it.
     */
    align?: 'top' | 'under-header';
    onclose: () => void;
    children: Snippet;
  }

  let { label, align = 'top', onclose, children }: Props = $props();

  /* Escape is handled here rather than in each sheet, so there is one way out and it works
     whether the focus is in a field, on a row or nowhere at all. */
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
  class="sheet"
  class:under-header={align === 'under-header'}
  role="dialog"
  aria-modal="true"
  aria-label={label}
>
  {@render children()}
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: var(--scrim);
  }
  .sheet {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    inset: var(--space-2) var(--space-2) auto;
    max-height: calc(100% - var(--space-4));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    background: var(--overlay);
    box-shadow: var(--overlay-shadow);
    overflow: hidden;
  }
  /* Hung from the header's right edge, so it reads as belonging to the control that opened
     it rather than as a second panel. */
  .sheet.under-header {
    inset: 42px var(--space-2) auto auto;
    width: min(320px, calc(100% - var(--space-4)));
    max-height: calc(100% - 42px - var(--space-4));
  }

  @media (prefers-reduced-motion: no-preference) {
    .scrim {
      animation: scrim-in 120ms ease-out both;
    }
    .sheet {
      animation: sheet-in 140ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    @keyframes scrim-in {
      from {
        opacity: 0;
      }
    }
    @keyframes sheet-in {
      from {
        opacity: 0;
        transform: scale(0.98);
      }
    }
  }
</style>
