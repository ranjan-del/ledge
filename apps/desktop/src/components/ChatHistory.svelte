<script lang="ts">
  /**
   * The saved chats, newest first, with a field that filters them by title. A row opens its
   * chat; the cross on a row asks once and then deletes it. Escape and a press outside close
   * the list, which hangs under the button that opened it.
   */
  import { filterChats, type ChatSummary } from '../lib/assistant-chat.svelte.ts';
  import { relativeTime } from '../lib/time.ts';
  import ConfirmButton from './ConfirmButton.svelte';

  interface Props {
    chats: ChatSummary[];
    /** The chat on screen, marked in the list. */
    current?: string;
    now?: number;
    onopen: (id: string) => void;
    ondelete: (id: string) => void;
    onclose: () => void;
  }

  let { chats, current, now = Date.now(), onopen, ondelete, onclose }: Props = $props();

  let query = $state('');
  let root = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);

  const shown = $derived(filterChats(chats, query));

  $effect(() => {
    field?.focus();
  });

  $effect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (root && t && !root.contains(t) && !t.closest('[data-history-toggle]')) onclose();
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    /* A delete question answers its own Escape first. */
    if ((event.target as HTMLElement).closest('[role="group"]')) return;
    event.preventDefault();
    event.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="history" role="dialog" aria-label="Chat history" bind:this={root} onkeydown={onKeydown} tabindex="-1">
  <input
    class="field"
    type="search"
    bind:this={field}
    bind:value={query}
    placeholder="Search chats"
    aria-label="Search chats"
    autocomplete="off"
    spellcheck="false"
  />
  <ul class="list">
    {#each shown as chat (chat.id)}
      <li class="row" class:current={chat.id === current}>
        <button type="button" class="open motion" onclick={() => onopen(chat.id)}>
          <span class="title trunc">{chat.title}</span>
          <span class="when-text">{relativeTime(chat.updated, now)}</span>
        </button>
        <ConfirmButton
          label="Delete {chat.title}"
          title="Delete this chat"
          question="Delete?"
          confirmLabel="Delete"
          groupLabel="Delete {chat.title}"
          icon
          onconfirm={() => ondelete(chat.id)}
        />
      </li>
    {:else}
      <li class="none quiet">{chats.length === 0 ? 'No saved chats yet.' : `Nothing matches "${query}".`}</li>
    {/each}
  </ul>
</div>

<style>
  .history {
    position: absolute;
    z-index: 6;
    top: calc(100% + 4px);
    right: 0;
    width: min(300px, calc(100vw - 32px));
    max-height: 320px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--overlay);
    border: 1px solid var(--surface-border);
    box-shadow: var(--overlay-shadow);
  }
  .history:focus {
    outline: none;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-sm);
    padding-right: 2px;
  }
  .row:hover,
  .row.current {
    background: var(--control);
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    text-align: left;
    font-size: var(--fs-sm);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .current .title {
    font-weight: 600;
  }
  .none {
    padding: var(--space-2);
  }
  .row :global(.drop) {
    width: 22px;
    height: 22px;
    opacity: 0;
  }
  .row:hover :global(.drop),
  .row :global(.drop:focus-visible) {
    opacity: 1;
  }
</style>
