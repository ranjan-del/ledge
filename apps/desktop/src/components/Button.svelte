<script lang="ts">
  /**
   * The floating 44 px circle with a Current count. Press and move drags the window; on release
   * the button snaps to the nearest screen edge and the position is saved. A press without
   * movement toggles the panel.
   */
  import { invoke } from '@tauri-apps/api/core';
  import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';
  import { currentTasks, desk, saveConfigFile } from '../lib/store.svelte.ts';

  const count = $derived(currentTasks().length);

  let dragging = $state(false);
  let moved = false;
  let settle: ReturnType<typeof setTimeout> | null = null;

  async function snap() {
    const win = getCurrentWindow();
    const [pos, monitor] = await Promise.all([win.outerPosition(), currentMonitor()]);
    let edge: 'left' | 'right' = desk.config.ui.edge;
    if (monitor) {
      const mid = monitor.position.x + monitor.size.width / 2;
      edge = pos.x + 24 < mid ? 'left' : 'right';
    }
    const snapped = await invoke<{ edge: 'left' | 'right'; y: number }>('snap_button', { edge, y: pos.y });
    if (snapped.edge !== desk.config.ui.edge || snapped.y !== desk.config.ui.y) {
      await saveConfigFile({ ...desk.config, ui: { ...desk.config.ui, edge: snapped.edge, y: snapped.y } });
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
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 4h12M3 9h8M3 14h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    {#if count > 0}
      <span class="badge">{count}</span>
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
  .ball.dragging {
    cursor: grabbing;
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
</style>
