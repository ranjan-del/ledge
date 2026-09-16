<script lang="ts">
  /**
   * The floating 44 px mark with a Current count. Press and move drags the window; on release
   * the button snaps to the nearest screen edge and the position is saved. A press without
   * movement toggles the panel.
   *
   * The mark is the Ledge logo: a near-black rounded square carrying a white L, with a green dot
   * resting in the crook of the letter. It is drawn from the same numbers as the application and
   * menu bar icons (src-tauri/icons/make-icons.mjs) on the same 0 to 1 grid, scaled by 44, so
   * the thing on your desktop and the thing in your dock are one mark and not two drawings of
   * it. Nothing here is a raster: an L at this size needs its stem and foot thicker than any
   * real typeface would set them, so the letter is two overlapping rounded bars.
   *
   * The dot is the same green the panel uses for live work, so it already carries meaning, and
   * it is drawn last so it sits over the end of the foot. It does not move. The per-task dots in
   * the panel are the app's one continuous animation, and a second breathing dot on the desktop
   * would compete with them for the same meaning; a steady dot says the same thing and says it
   * without motion.
   *
   * The plate is near-black on a desktop of unknown colour, so it carries both a light hairline
   * inside its edge and a soft shadow under it: the hairline is what holds the silhouette
   * against a dark wallpaper, the shadow against a light one.
   *
   * The count badge pulses once when the number changes, so a task arriving while you are in
   * another application is noticeable without being a notification. That is the only motion
   * here, and it stops dead under prefers-reduced-motion.
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
    try {
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
    } catch {
      /* Outside Tauri (a browser, a screenshot harness) there is no window to listen to. */
    }
    return () => {
      unlisten?.();
      if (settle !== null) clearTimeout(settle);
    };
  });
</script>

<div class="wrap">
  <button
    type="button"
    class="mark motion"
    class:dragging
    aria-label="Ledge: {count} current task{count === 1 ? '' : 's'}"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
  >
    <!-- Every number below is the icon's 0 to 1 geometry multiplied by 44. -->
    <svg class="logo" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <rect class="plate" x="0" y="0" width="44" height="44" rx="9.64" fill="#1b1c20" />
      <rect class="stem" x="12.54" y="10.34" width="5.94" height="20.46" rx="1.14"
        fill="#ffffff" />
      <rect class="foot" x="12.54" y="27.06" width="15.18" height="3.74" rx="1.14"
        fill="#ffffff" />
      <circle class="dot" cx="29.7" cy="29.57" r="3.87" fill="#30c75e" />
      <!-- Drawn last and inset by half its own width, so the silhouette survives a dark
           wallpaper without the stroke straddling the plate's edge. -->
      <rect class="rim" x="0.5" y="0.5" width="43" height="43" rx="9.14" fill="none"
        stroke="rgba(255, 255, 255, 0.18)" stroke-width="1" />
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
  .mark {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    cursor: grab;
  }
  .mark:hover {
    filter: brightness(1.12);
  }
  .mark:active,
  .mark.dragging {
    cursor: grabbing;
    transform: scale(0.96);
  }
  .logo {
    display: block;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.42));
  }
  .badge {
    position: absolute;
    top: -3px;
    right: -3px;
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
    .badge {
      animation: badge-pulse 420ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
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
