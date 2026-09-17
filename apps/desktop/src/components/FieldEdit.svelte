<script lang="ts">
  /**
   * One piece of a task's own text, being changed in place: the title, the requirement, a plan
   * step, a checklist item, today's note, or a pasted reference. It shows the text as it stands
   * in the file, lets a person rewrite it, and hands the result back once, on an explicit
   * action or on leaving the field, never on a keystroke.
   *
   * It exists because all six of those edits need the same five things and would otherwise be
   * written out six times: a labelled control, Enter and Escape meaning commit and cancel, a
   * commit when focus leaves for anything outside this editor, a save that can refuse, and a
   * reason shown in place when it does.
   *
   * What is typed lives here and nowhere else. The parent re-renders whenever the file watcher
   * re-reads the task, and this component is not re-created by that, so a draft survives a
   * watcher event: `draft` is seeded from `value` once, when the editor opens, and is never
   * re-derived from the prop afterwards. That is the whole mechanism, and it is why nothing in
   * this file reads `value` outside its initialiser.
   *
   * Nothing here trims, reflows or reformats. The caller decides what to do with the text,
   * which is what lets References keep a pasted stack trace exactly as it was pasted.
   */
  import { onMount } from 'svelte';

  interface Props {
    /** The text as the file has it. Read once, to seed the draft. */
    value: string;
    /** Accessible name for the control. Required: an unlabelled field is not usable. */
    label: string;
    /** A text area rather than a single line. Enter then inserts a newline. */
    multiline?: boolean;
    /** Rows for the text area. Ignored on a single line. */
    rows?: number;
    placeholder?: string;
    /** What the committing button says. */
    saveLabel?: string;
    /** A quiet line under the buttons saying which keys do what. */
    hint?: string;
    /** Why the last attempt was refused. Shown in place; the text is kept either way. */
    error?: string | null;
    /** Handed the draft exactly as typed. May reject; this stays open when it does. */
    oncommit: (text: string) => void | Promise<void>;
    oncancel: () => void;
  }

  let {
    value,
    label,
    multiline = false,
    rows = 5,
    placeholder = '',
    saveLabel = 'Save',
    hint = '',
    error = null,
    oncommit,
    oncancel,
  }: Props = $props();

  /* Seeded once, and the warning Svelte raises here is the behaviour this component is for:
     capturing the initial value and nothing after it. Re-deriving the draft from `value` is
     exactly the bug that loses a half-typed edit when the watcher re-reads the file. */
  // svelte-ignore state_referenced_locally
  let draft = $state(value);
  let root = $state<HTMLElement | null>(null);
  let control = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);
  /* True while a commit or a cancel is in flight, so a blur cannot fire a second one. */
  let sealed = false;

  onMount(() => {
    control?.focus();
    if (control instanceof HTMLInputElement) control.select();
    else if (control) control.setSelectionRange(draft.length, draft.length);
  });

  async function commit() {
    if (sealed) return;
    sealed = true;
    try {
      await oncommit(draft);
    } finally {
      sealed = false;
    }
  }

  function cancel() {
    if (sealed) return;
    sealed = true;
    oncancel();
  }

  /**
   * Leaving the editor commits. Moving to this editor's own Save or Cancel does not: those
   * would otherwise commit on the way to being pressed, and Cancel would never mean no.
   */
  function onblur(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    void commit();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key !== 'Enter') return;
    /* One line: Enter is the commit. Many lines: Enter is a newline and the chord commits. */
    if (multiline && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void commit();
  }
</script>

<div class="edit" bind:this={root}>
  {#if multiline}
    <textarea
      class="field edit-area"
      bind:this={control}
      bind:value={draft}
      aria-label={label}
      aria-invalid={error ? 'true' : undefined}
      {placeholder}
      {rows}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      onkeydown={onkeydown}
      onblur={onblur}
    ></textarea>
  {:else}
    <input
      class="field edit-line"
      type="text"
      bind:this={control}
      bind:value={draft}
      aria-label={label}
      aria-invalid={error ? 'true' : undefined}
      {placeholder}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      onkeydown={onkeydown}
      onblur={onblur}
    />
  {/if}
  {#if error}
    <p class="edit-error" role="alert">{error}</p>
  {/if}
  <div class="edit-actions">
    <button type="button" class="btn primary motion" onclick={() => void commit()}>
      {saveLabel}
    </button>
    <button type="button" class="btn motion" onclick={cancel}>Cancel</button>
    {#if hint}<span class="edit-hint">{hint}</span>{/if}
  </div>
</div>
