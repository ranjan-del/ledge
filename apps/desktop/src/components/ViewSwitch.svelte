<script module lang="ts">
  /** One of the two views the Current tab can show, and how many tasks are in it. */
  export interface ViewOption {
    id: string;
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  /**
   * The Current tab's two halves: Live, which is the work in progress, and Done, which is the
   * archive. It exists because "current" was quietly answering two questions with one list,
   * and the finished work had nowhere to be seen at all except a count in the footer.
   *
   * It sits directly under the four surface tabs, so the two controls have to be told apart at
   * a glance or they read as one long mess of buttons. The tabs are the chrome: full width, on
   * a sunken track, a white pill for the one you are on. This is content: pills, left aligned,
   * no track, no more than the words need. Same family, different rank.
   *
   * It takes a list rather than a pair because the TASKS surface has four of these, Live, Done,
   * Backlog and Pending, where the Current tab once had two.
   */
  interface Props {
    options: ViewOption[];
    active: string;
    onchange: (id: string) => void;
  }

  let { options, active, onchange }: Props = $props();
</script>

<div class="views" role="group" aria-label="Task view">
  {#each options as option (option.id)}
    <button
      type="button"
      class="view motion"
      aria-pressed={option.id === active}
      onclick={() => onchange(option.id)}
    >
      {option.label}
      <span class="count" aria-label="{option.count} items">{option.count}</span>
    </button>
  {/each}
</div>

<style>
  .views {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .view {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-faint);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .view:hover {
    color: var(--text-muted);
  }
  .view[aria-pressed="true"] {
    background: var(--control);
    color: var(--text);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    opacity: 0.72;
  }
</style>
