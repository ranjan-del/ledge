<script module lang="ts">
  /**
   * One shared cycle for every dot in the app. A dot that mounts late would otherwise start
   * its own timer and breathe out of step with the ones already on screen, which is what
   * turns a quiet signal into a row of blinking lights. Each dot instead computes how far
   * into the shared cycle the app already is and starts there, with a negative delay, so
   * twenty dots animate as one.
   */
  export const BREATHE_MS = 3200;

  const EPOCH = typeof performance === 'undefined' ? 0 : performance.now();

  /** Negative delay, in ms, that puts a dot mounting now at the shared cycle's position. */
  export function sharedPhase(): number {
    if (typeof performance === 'undefined') return 0;
    return -((performance.now() - EPOCH) % BREATHE_MS);
  }
</script>

<script lang="ts">
  /**
   * A small dot that breathes. It says two different things in two places, and the size is
   * what tells them apart. Beside the panel name it is the app itself: the file watcher is
   * up, and it becomes a spinner for as long as a git scan is actually running, because a
   * panel that is watching your files and a panel that has quietly died look identical when
   * nothing has changed recently. On a task row it is smaller and it means this particular
   * piece of work is live, which is the one thing the Live view claims that the row's own
   * words do not.
   *
   * It is the only continuous animation in the app, so it is kept cheap however many are on
   * screen: one element each, transform and opacity only, one shared keyframe on one shared
   * phase, and the whole thing paused outright while the panel is off screen, so a hidden
   * window costs nothing.
   */
  interface Props {
    /** A git scan is in flight: the dot becomes a spinner. Only the header dot uses this. */
    scanning?: boolean;
    /** The panel is on screen. When false the animation is paused, not merely invisible. */
    awake?: boolean;
    /** `md` beside the panel name, `sm` on a task row. */
    size?: 'sm' | 'md';
    /** What it means here. Read out on hover; the dot itself stays decoration. */
    title?: string;
  }

  let { scanning = false, awake = true, size = 'md', title }: Props = $props();

  const label = $derived(
    title ?? (scanning ? 'Scanning repositories' : 'Watching your task files'),
  );
  /* Read once, at creation: re-reading it on every update would restart the cycle. */
  const delay = sharedPhase();
</script>

<span
  class="live {size}"
  class:scanning
  class:paused={!awake}
  style:animation-delay={scanning ? null : `${delay}ms`}
  title={label}
  aria-hidden="true"
></span>

<style>
  .live {
    flex: none;
    border-radius: 50%;
    background: var(--done-fill);
    /* A still dot is the honest resting state: if motion is off, this is all you get. */
    opacity: 0.75;
  }
  .live.md {
    width: 9px;
    height: 9px;
  }
  .live.sm {
    width: 6px;
    height: 6px;
  }
  .live.scanning {
    background: transparent;
    border: 1.5px solid var(--accent);
    border-top-color: transparent;
    opacity: 1;
  }
  .live.sm.scanning {
    border-width: 1px;
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
