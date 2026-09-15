<script lang="ts">
  /**
   * Segmented control. Arrow keys move between tabs, Home and End jump, each tab shows a count.
   */
  export interface TabItem {
    id: string;
    label: string;
    count?: number;
  }

  interface Props {
    tabs: TabItem[];
    active: string;
    onchange: (id: string) => void;
  }

  let { tabs, active, onchange }: Props = $props();

  function onKeydown(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    onchange(tabs[next].id);
    const el = (event.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined;
    el?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label="Sections">
  {#each tabs as tab, i (tab.id)}
    <button
      type="button"
      role="tab"
      class="tab motion"
      class:active={tab.id === active}
      aria-selected={tab.id === active}
      tabindex={tab.id === active ? 0 : -1}
      onclick={() => onchange(tab.id)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      <span class="label">{tab.label}</span>
      {#if tab.count !== undefined}
        <span class="count" aria-label="{tab.count} items">{tab.count}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--control);
    border-radius: var(--radius-sm);
  }
  .tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: 5px var(--space-2);
    border-radius: calc(var(--radius-sm) - 1px);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .tab.active {
    background: var(--control-active);
    color: var(--text);
    box-shadow: var(--shadow-card);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    color: var(--text-faint);
  }
  .tab.active .count {
    color: var(--text-muted);
  }
</style>
