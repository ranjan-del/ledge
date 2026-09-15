<script lang="ts">
  /**
   * Root. Both windows load the same bundle; the Tauri window label decides which face to show.
   * The button window keeps a live count, so both windows boot the store.
   */
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';
  import Button from './components/Button.svelte';
  import Panel from './components/Panel.svelte';
  import { applyOs } from './lib/platform.ts';
  import { boot, desk } from './lib/store.svelte.ts';

  let label = $state('panel');

  onMount(() => {
    applyOs();
    try {
      label = getCurrentWindow().label;
    } catch {
      label = 'panel';
    }
    void boot().catch((e: Error) => (desk.error = e.message));
  });
</script>

{#if label === 'button'}
  <Button />
{:else}
  <Panel />
{/if}
