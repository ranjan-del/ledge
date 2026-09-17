<script lang="ts">
  /**
   * A control that takes something away, and the question it asks first. The button becomes the
   * question and its two answers, in the same place and at the same size, and nothing is
   * destroyed until the second press. Escape on either answer means no.
   *
   * It is one component because the panel now has three of these: deleting a task, removing a
   * plan step and removing a checklist item. It is not a `confirm()` dialog, because a native
   * modal on a panel that hides when it loses focus is a trap, and because the answer belongs
   * beside the thing it is about rather than in the middle of the screen.
   */
  interface Props {
    /** The resting button's accessible name, and its text unless `icon` is set. */
    label: string;
    /** The question, asked in full, e.g. "Remove this step?" */
    question: string;
    /** What the answer that goes ahead says. */
    confirmLabel: string;
    /** Accessible name for the group the question and its two answers form. */
    groupLabel: string;
    /** Tooltip on the resting button. */
    title?: string;
    /** Draw the resting button as a small cross instead of a word. Rows use this. */
    icon?: boolean;
    onconfirm: () => void;
  }

  let { label, question, confirmLabel, groupLabel, title, icon = false, onconfirm }: Props =
    $props();

  let asking = $state(false);

  /** Cancels the question from the keyboard, so Escape always means "no". */
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    asking = false;
  }
</script>

{#if asking}
  <span class="confirm" role="group" aria-label={groupLabel}>
    <span class="ask">{question}</span>
    <button
      type="button"
      class="btn danger motion"
      onclick={() => {
        asking = false;
        onconfirm();
      }}
      onkeydown={onkeydown}
    >
      {confirmLabel}
    </button>
    <button type="button" class="btn motion" onclick={() => (asking = false)} onkeydown={onkeydown}>
      Cancel
    </button>
  </span>
{:else if icon}
  <button
    type="button"
    class="drop tool motion"
    aria-label={label}
    {title}
    onclick={() => (asking = true)}
  >
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" />
    </svg>
  </button>
{:else}
  <button type="button" class="btn motion" {title} onclick={() => (asking = true)}>{label}</button>
{/if}

<style>
  /* The question and its two answers travel together, so the row cannot wrap the word
     "Delete" away from what it is asking about. */
  .confirm {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: 2px 2px 2px var(--space-2);
    border-radius: var(--radius-sm);
    /* Outlined rather than filled, so the one button that destroys something is the
       reddest thing in the row and cannot be mistaken for the question or for Cancel. */
    border: 1px solid var(--late-edge);
  }
  .ask {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--danger);
  }
  .tool:hover {
    color: var(--danger);
  }
</style>
