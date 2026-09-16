<script lang="ts">
  /**
   * The floating 44 px mark with a Current count. Press and move drags the window; on release
   * the button snaps to the nearest screen edge and the position is saved. A press without
   * movement toggles the panel.
   *
   * The mark is the orb: a violet sphere lit from the upper left, ringed by a bright halo, with
   * two white capsule eyes and a faint contact shadow under it. It is a face reduced to the two
   * features that still read at 16 px, and it is drawn from the same numbers as the application
   * and menu bar icons (src-tauri/icons/make-icons.mjs) on the same 0 to 1 grid, multiplied by
   * 100 here so the geometry reads as whole numbers. The thing on your desktop and the thing in
   * your dock are one mark and not two drawings of it. Nothing here is a raster: at 44 px a
   * sprite would be soft on every display the app actually runs on.
   *
   * There is no plate. The orb and its halo fill the button, which is what makes it read as an
   * object sitting on the desktop rather than as an application icon parked on one.
   *
   * The blink is the character of the thing, and it is the reason the button is not furniture.
   * Both eyes close together and open again in about 140 ms, quicker shut than open, and the
   * gap between blinks is drawn fresh from a 5 to 7 second range with the occasional double,
   * because a perfectly regular blink reads as a clock. The schedule is in lib/blink.ts; all
   * this component does is put a class on the eyes. Only the eyes move: they scale on a
   * transform, so the orb never shifts and nothing is laid out again.
   *
   * The count badge pulses once when the number changes, so a task arriving while you are in
   * another application is noticeable without being a notification. Both the blink and the
   * pulse stop dead under prefers-reduced-motion, where the eyes simply stay open.
   */
  import { invoke } from '@tauri-apps/api/core';
  import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, untrack } from 'svelte';
  import { startBlinking } from '../lib/blink.ts';
  import { reducedMotion } from '../lib/motion.svelte.ts';
  import { needsFullHeight, panelContent } from '../lib/sizing.ts';
  import {
    attentionRepos,
    currentTasks,
    desk,
    saveConfigFile,
    upNextTasks,
    workingTasks,
  } from '../lib/store.svelte.ts';

  const count = $derived(currentTasks().length);

  let dragging = $state(false);
  /* Bumped whenever the count changes, to restart the badge animation from the top. */
  let pulse = $state(0);
  /* True while the eyes are shut. The only state the blink has. */
  let shut = $state(false);
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

  /**
   * Whether the panel should open at its full height, so it opens at the right size instead of
   * re-sizing a moment after it appears. This is the button window's own answer, and it can
   * only be an answer about NOW: the panel window keeps its own surface and its own open task,
   * and two webviews share no state. The panel corrects this for itself as soon as it has the
   * focus, so a wrong guess costs one resize rather than a wrong-sized panel.
   */
  function panelWantsFullHeight(): boolean {
    const content = panelContent({
      surface: 'now',
      view: 'live',
      detailOpen: false,
      working: workingTasks().length,
      upNext: upNextTasks().length,
      attention: attentionRepos().length,
      sessions: 0,
      notes: 0,
      live: currentTasks().length,
      done: 0,
      backlog: 0,
      pending: desk.pending.length,
    });
    const avail = typeof screen === 'undefined' ? 0 : screen.availHeight;
    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    return needsFullHeight(content, avail, ratio);
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button !== 0 || !dragging) return;
    dragging = false;
    if (!moved) void invoke('toggle_panel', { hasContent: panelWantsFullHeight() });
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    /* The script half of the motion policy: under reduced motion no timer is started at all,
       so the eyes are not merely still, nothing is scheduled. */
    const stopBlinking = reducedMotion() ? null : startBlinking((v) => (shut = v));
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
      stopBlinking?.();
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
    <!-- Every number below is the icon's 0 to 1 geometry multiplied by 100. The viewBox is
         square and centred on the drawing, which runs from the top of the halo to the bottom
         of the contact shadow, so the orb fills the button without the shadow being clipped. -->
    <svg class="logo" width="44" height="44" viewBox="10.75 10.5 78.5 78.5" aria-hidden="true">
      <defs>
        <!-- The sphere: a diagonal sweep from the pink violet upper left through the body to
             the blue lower right, which is the same two-blend construction make-icons uses. -->
        <linearGradient id="ledge-orb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d6a8f2" />
          <stop offset="0.42" stop-color="#8d7bef" />
          <stop offset="1" stop-color="#5063e6" />
        </linearGradient>
        <!-- The halo is brightest against the sphere and gone one halo-width out. -->
        <radialGradient id="ledge-halo">
          <stop offset="0.851" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="0.925" stop-color="#ffffff" stop-opacity="0.45" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ledge-shade">
          <stop offset="0" stop-color="#6d6aa8" stop-opacity="0.3" />
          <stop offset="0.74" stop-color="#6d6aa8" stop-opacity="0.12" />
          <stop offset="1" stop-color="#6d6aa8" stop-opacity="0" />
        </radialGradient>
      </defs>
      <ellipse class="shade" cx="50" cy="85.5" rx="20" ry="3.5" fill="url(#ledge-shade)" />
      <circle class="halo" cx="50" cy="47.5" r="37" fill="url(#ledge-halo)" />
      <circle class="orb" cx="50" cy="47.5" r="31.5" fill="url(#ledge-orb)" />
      <!-- Both eyes in one group, so one transform closes both and the pair can never blink
           out of step. -->
      <g class="eyes" class:shut>
        <rect x="37.6" y="40.75" width="6.2" height="13.5" rx="3.1" fill="#ffffff" />
        <rect x="56.2" y="40.75" width="6.2" height="13.5" rx="3.1" fill="#ffffff" />
      </g>
    </svg>
    {#if count > 0}
      {#key pulse}
        <span class="badge pip">{count}</span>
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
    border-radius: 50%;
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
  /* The halo and the contact shadow are drawn into the mark itself, so there is no plate to
     cast a shadow and nothing here to add one. */
  .logo {
    display: block;
  }
  .badge {
    top: -3px;
    right: -3px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: var(--fs-xs);
    line-height: 18px;
  }

  @media (prefers-reduced-motion: no-preference) {
    /*
      The blink, as two transitions rather than a keyframe, because the schedule that fires it
      is irregular on purpose and a keyframe can only repeat on a fixed period. The close is
      the quicker half and eases in; the open eases out. Together they are about 140 ms.

      Only scaleY is animated, on a group whose transform box is its own bounding box, so the
      eyes shut about their own centre line and neither the orb nor the badge is touched. No
      property here can trigger layout.
    */
    .eyes {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 85ms cubic-bezier(0.2, 0.6, 0.35, 1);
    }
    .eyes.shut {
      transform: scaleY(0.1);
      transition-duration: 55ms;
      transition-timing-function: cubic-bezier(0.45, 0, 0.9, 0.6);
    }
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
