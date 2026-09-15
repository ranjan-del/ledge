<script lang="ts">
  /**
   * The one thing on the panel that is always moving: a small dot that breathes to say the
   * file watcher is up, and becomes a spinner for as long as a git scan is actually running.
   * It exists because a panel that is watching your files and a panel that has quietly died
   * look identical when nothing has changed recently.
   *
   * It is deliberately the only continuous animation in the app, so it is kept cheap: one
   * element, transform and opacity only, no layout properties, and the animation is paused
   * outright while the panel is not on screen, so a hidden window costs nothing.
   */
  interface Props {
    /** A git scan is in flight: the dot becomes a spinner. */
    scanning?: boolean;
    /** The panel is on screen. When false the animation is paused, not merely invisible. */
    awake?: boolean;
  }

  let { scanning = false, awake = true }: Props = $props();
</script>

<span
  class="live"
  class:scanning
  class:paused={!awake}
  title={scanning ? 'Scanning repositories' : 'Watching your task files'}
  aria-hidden="true"
></span>

<style>
  .live {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--done-fill);
    /* A still dot is the honest resting state: if motion is off, this is all you get. */
    opacity: 0.75;
  }
  .live.scanning {
    background: transparent;
    border: 1.5px solid var(--accent);
    border-top-color: transparent;
    opacity: 1;
  }

  @media (prefers-reduced-motion: no-preference) {
    .live {
      animation: breathe 3.2s ease-in-out infinite;
      will-change: transform, opacity;
    }
    .live.scanning {
      animation: spin 720ms linear infinite;
    }
    .live.paused {
      animation-play-state: paused;
    }
    @keyframes breathe {
      0%,
      100% {
        opacity: 0.45;
        transform: scale(0.82);
      }
      50% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  }
</style>
