<script module lang="ts">
  /**
   * Session flag, deliberately outside the component instance: the line types itself the first
   * time it is ever shown and never again, however many times the view is mounted. A
   * typewriter that replays every time you switch tabs is an irritation, not a feature.
   */
  let alreadyTyped = false;
</script>

<script lang="ts">
  /**
   * Types one short line out, once, with a caret that blinks while it is typing and then goes
   * away. Used in exactly one place, the empty home view's opening line, where the panel has
   * nothing to report and a sign of life is worth more than an instant label.
   *
   * The visible text is `aria-hidden`; the caller puts the full string on the heading, so
   * assistive technology reads the finished sentence and never a half-typed one. Under reduced
   * motion, and on every mount after the first, the full text renders immediately.
   */
  import { onMount, untrack } from 'svelte';
  import { reducedMotion } from '../lib/motion.svelte.ts';

  interface Props {
    text: string;
    /** Milliseconds per character. */
    speed?: number;
  }

  let { text, speed = 32 }: Props = $props();

  const instant = alreadyTyped || reducedMotion();
  /* The line is typed once from the text it was given; untrack says so, because a later
     change to the prop must not rewind a sentence that is already on screen. */
  let shown = $state(instant ? untrack(() => text) : '');
  let typing = $state(false);

  onMount(() => {
    if (instant) return;
    alreadyTyped = true;
    typing = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let i = 0;
    const tick = () => {
      i += 1;
      shown = text.slice(0, i);
      if (i < text.length) timer = setTimeout(tick, speed);
      else typing = false;
    };
    timer = setTimeout(tick, 100);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  });
</script>

<span class="typed" aria-hidden="true">{shown}{#if typing}<span class="caret"></span>{/if}</span>

<style>
  .typed {
    /* The line must not reflow as it grows, so it keeps its own baseline box. */
    display: inline;
    white-space: pre-wrap;
  }
  .caret {
    display: inline-block;
    width: 2px;
    height: 0.95em;
    margin-left: 1px;
    vertical-align: -0.12em;
    background: var(--accent);
  }
  @media (prefers-reduced-motion: no-preference) {
    .caret {
      animation: caret 900ms steps(1, end) infinite;
    }
    @keyframes caret {
      50% {
        opacity: 0;
      }
    }
  }
</style>
