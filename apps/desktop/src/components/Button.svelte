<script lang="ts">
  /**
   * The floating 44 px circle with a Current count. Press and move drags the window; on release
   * the button snaps to the nearest screen edge and the position is saved. A press without
   * movement toggles the panel.
   *
   * The mark is a friendly monoline robot face, drawn inline rather than loaded, and it blinks
   * once every six seconds or so. That blink is the whole point of the thing: a button that
   * never moves is furniture, and this one is supposed to read as something that is awake and
   * keeping an eye on your work. The count badge pulses once when the number changes, so a task
   * arriving while you are in another application is noticeable without being a notification.
   * Both stop dead under prefers-reduced-motion.
   */
  import { invoke } from '@tauri-apps/api/core';
  import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, untrack } from 'svelte';
  import { currentTasks, desk, saveConfigFile } from '../lib/store.svelte.ts';

  const count = $derived(currentTasks().length);

  let dragging = $state(false);
  /* Bumped whenever the count changes, to restart the badge animation from the top. */
  let pulse = $state(0);
  let moved = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  /* Where the count was when this window opened: the badge should not pulse for the tasks
     that were already there. */
  let seen = untrack(() => count);

  $effect(() => {
    if (count === seen) return;
    seen = count;
    pulse += 1;
  });

  async function snap() {
    const win = getCurrentWindow();
    const [pos, monitor] = await Promise.all([win.outerPosition(), currentMonitor()]);
    let edge: 'left' | 'right' = desk.config.ui.edge;
    if (monitor) {
      const mid = monitor.position.x + monitor.size.width / 2;
      edge = pos.x + 24 < mid ? 'left' : 'right';
    }
    const snapped = await invoke<{ edge: 'left' | 'right'; y: number }>('snap_button', {
      edge,
      y: pos.y,
    });
    if (snapped.edge !== desk.config.ui.edge || snapped.y !== desk.config.ui.y) {
      const ui = { ...desk.config.ui, edge: snapped.edge, y: snapped.y };
      await saveConfigFile({ ...desk.config, ui });
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    moved = false;
    dragging = true;
    void getCurrentWindow().startDragging();
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button !== 0 || !dragging) return;
    dragging = false;
    if (!moved) void invoke('toggle_panel');
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onMoved(() => {
        if (!dragging) return;
        moved = true;
        if (settle !== null) clearTimeout(settle);
        settle = setTimeout(() => {
          settle = null;
          dragging = false;
          void snap();
        }, 200);
      })
      .then((u) => (unlisten = u));
    return () => {
      unlisten?.();
      if (settle !== null) clearTimeout(settle);
    };
  });
</script>

<div class="wrap">
  <button
    type="button"
    class="ball motion"
    class:dragging
    aria-label="Ledge: {count} current task{count === 1 ? '' : 's'}"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
  >
    <svg class="face" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <!-- Antenna, head, eyes, mouth: four strokes, one weight, no fill. -->
      <path
        d="M11 2.4V4.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="11" cy="1.9" r="1.1" fill="currentColor" />
      <rect
        x="3.6"
        y="4.8"
        width="14.8"
        height="12.4"
        rx="4.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <g class="eyes">
        <circle cx="8.2" cy="10.2" r="1.25" fill="currentColor" />
        <circle cx="13.8" cy="10.2" r="1.25" fill="currentColor" />
      </g>
      <path
        d="M8.4 13.9h5.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    {#if count > 0}
      {#key pulse}
        <span class="badge">{count}</span>
      {/key}
    {/if}
  </button>
</div>

<style>
  .wrap {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    background: transparent;
  }
  .ball {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--button-bg);
    color: var(--button-fg);
    box-shadow: var(--shadow-button);
    display: grid;
    place-items: center;
    cursor: grab;
  }
  .ball:hover {
    filter: brightness(1.06);
  }
  .ball:active,
  .ball.dragging {
    cursor: grabbing;
    transform: scale(0.96);
  }
  .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-pill);
    background: var(--badge-bg);
    color: var(--badge-fg);
    font-size: var(--fs-xs);
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: no-preference) {
    /* One blink, roughly every six seconds. The eyes are the only thing that moves, and
       they move on transform, so nothing around them is laid out again. */
    .eyes {
      transform-origin: 11px 10.2px;
      animation: blink 6.4s ease-in-out infinite;
    }
    .badge {
      animation: badge-pulse 420ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    @keyframes blink {
      0%,
      95.5%,
      100% {
        transform: scaleY(1);
      }
      97.2% {
        transform: scaleY(0.08);
      }
    }
    @keyframes badge-pulse {
      0% {
        transform: scale(0.7);
        opacity: 0.4;
      }
      55% {
        transform: scale(1.18);
        opacity: 1;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }
  }
</style>
