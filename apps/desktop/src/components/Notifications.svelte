<script lang="ts">
  /**
   * The notification centre: the changes Ledge has actually observed since it last looked at
   * the store, grouped by what they are about. It exists because the panel is hidden most of
   * the time, and a checklist finishing, a note being written or three hundred uncommitted
   * files appearing in a repository are all worth knowing about without the panel open.
   *
   * Every row here came from comparing two observations of the store (lib/observed.ts). None of
   * it is generated, scheduled or predicted: there is no row for a session starting, for how
   * long one ran or for what it changed, because nothing in the store records any of that. The
   * detail line is always the numbers that moved, in words, so the coloured dot beside it is
   * the second signal rather than the only one.
   *
   * Grouping is by subject rather than by day. A centre that has not been opened for a week
   * should answer "has anything happened to my repositories", not "what happened on Tuesday".
   * Dismissing a row drops it for good; the observation behind it stays recorded, so nothing
   * dismissed can come back on the next launch.
   */
  import { groupNotifications, type Notification } from '../lib/observed.ts';
  import { relativeTime } from '../lib/time.ts';
  import Overlay from './Overlay.svelte';

  interface Props {
    /** Newest first, as `news.items` holds them. */
    items: Notification[];
    /** Opens what the row is about: the task, or the Pending view for a repository. */
    onopen: (item: Notification) => void;
    ondismiss: (id: string) => void;
    ondismissall: () => void;
    onclose: () => void;
  }

  let { items, onopen, ondismiss, ondismissall, onclose }: Props = $props();

  const groups = $derived(groupNotifications(items));
</script>

<Overlay label="Notifications" align="under-header" {onclose}>
  <div class="sheet-head">
    <h2 class="section-label">Notifications</h2>
    {#if items.length > 0}
      <button type="button" class="drop clear motion" onclick={ondismissall}>Clear all</button>
    {/if}
  </div>

  <div class="sheet-list">
    {#if groups.length === 0}
      <div class="empty">
        <h3>Nothing new</h3>
        <p class="quiet">
          A notification appears when Ledge sees something change: a checklist finishing, a note
          being written, a task planned for today still untouched, or a repository gaining
          uncommitted or unpushed work.
        </p>
        <p class="quiet faint">
          It compares the store against the last time it looked, so nothing is announced twice
          and a first run says nothing at all.
        </p>
      </div>
    {:else}
      {#each groups as group (group.label)}
        <section class="sheet-group">
          <h3 class="section-label">
            {group.label}
            <span class="count">{group.items.length}</span>
          </h3>
          {#each group.items as item (item.id)}
            <div class="item" class:unread={!item.read}>
              <button type="button" class="sheet-row subject motion" onclick={() => onopen(item)}>
                <span class="line">
                  <span class="state-dot {item.tone}" aria-hidden="true"></span>
                  <span class="what trunc">{item.title}</span>
                  <span class="when-text">{relativeTime(item.at)}</span>
                </span>
                <span class="sub">{item.detail}</span>
              </button>
              <button
                type="button"
                class="drop motion"
                aria-label="Dismiss: {item.title}, {item.detail}"
                onclick={() => ondismiss(item.id)}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                  <path d="M1 1 8 8M8 1 1 8" stroke="currentColor" stroke-width="1.4"
                    stroke-linecap="round" />
                </svg>
              </button>
            </div>
          {/each}
        </section>
      {/each}
    {/if}
  </div>
</Overlay>

<style>
  /* Quiet, because clearing the lot is not what most people came here to do. The two words
     stay on one line: the label beside it grows, and a wrapped control would be squeezed out
     of the sheet's right edge. */
  .clear {
    padding: 2px var(--space-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 2px;
    border-radius: var(--radius-sm);
  }
  .item:hover {
    background: var(--surface-hover);
  }
  .subject {
    flex: 1;
    min-width: 0;
    padding: 5px var(--space-1) 5px var(--space-2);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .what {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  /* Unread is weight and a filled dot, never colour alone. */
  .item:not(.unread) .what {
    font-weight: 500;
    color: var(--text-muted);
  }
  .item:not(.unread) .state-dot {
    opacity: 0.45;
  }
  .subject .sub {
    padding-left: 13px;
  }
  /* The row's dismiss control is a fixed square aligned with the row's first line. Scoped to
     the row on purpose: the sheet's own Clear all control is also a `.drop`, and it is as wide
     as its two words. */
  .item .drop {
    width: 20px;
    height: 20px;
    margin: 5px 3px 0 0;
  }
  .drop:hover {
    background: var(--control);
  }
</style>
