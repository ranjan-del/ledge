<script module lang="ts">
  import type { ModelChoice } from '../lib/assistant/types.ts';

  export const MODEL_CHOICES: { id: ModelChoice; label: string; hint: string }[] = [
    { id: 'auto', label: 'Auto', hint: 'Picks per question' },
    { id: 'haiku', label: 'Haiku', hint: 'Quick general questions' },
    { id: 'sonnet', label: 'Sonnet', hint: 'Work questions and actions' },
    { id: 'opus', label: 'Opus', hint: 'Analysis and planning' },
  ];
</script>

<script lang="ts">
  /**
   * Where the person talks to the assistant: a field that grows with what is typed, the model
   * picker, and Send, which becomes Stop while an answer is being written. Enter sends,
   * Shift+Enter adds a line, and Escape stops a running answer or, with nothing running, lets
   * go of the field.
   */
  import { onMount, untrack } from 'svelte';

  interface Props {
    running?: boolean;
    model: ModelChoice;
    onmodel: (model: ModelChoice) => void;
    /** Sends the text. Resolves true when it went, and only then is the field cleared. */
    onsend: (text: string) => Promise<boolean> | boolean;
    onstop: () => void;
    /** Docked at the bottom of a conversation, where the model menu opens upwards. */
    docked?: boolean;
    placeholder?: string;
    /** Take the focus when this appears. */
    autofocus?: boolean;
    /** Bumping this focuses the field. */
    focusKey?: number;
    /** Reports whether the field holds the focus, so a caller can carry it across a re-mount. */
    onfocuschange?: (focused: boolean) => void;
    /** Text to start with, carried across a re-mount. */
    value?: string;
  }

  let {
    running = false,
    model,
    onmodel,
    onsend,
    onstop,
    docked = false,
    placeholder = 'Ask anything, or tell Ledge what to do',
    autofocus = false,
    focusKey = 0,
    onfocuschange,
    value = $bindable(''),
  }: Props = $props();

  let field = $state<HTMLTextAreaElement | null>(null);
  let menuOpen = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  let pickerEl = $state<HTMLButtonElement | null>(null);

  const current = $derived(MODEL_CHOICES.find((c) => c.id === model) ?? MODEL_CHOICES[0]!);
  const canSend = $derived(value.trim() !== '');

  const MAX_PX = 140;
  function fit() {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_PX)}px`;
  }

  $effect(() => {
    value;
    fit();
  });

  onMount(() => {
    if (autofocus) field?.focus();
  });

  let handledKey = untrack(() => focusKey);
  $effect(() => {
    if (focusKey !== handledKey) {
      handledKey = focusKey;
      field?.focus();
    }
  });

  async function submit() {
    const text = value;
    if (text.trim() === '' || running) return;
    value = '';
    const sent = await onsend(text);
    if (!sent && value === '') value = text;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (running) onstop();
      else field?.blur();
    }
  }

  function choose(id: ModelChoice) {
    onmodel(id);
    menuOpen = false;
    pickerEl?.focus();
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Escape') {
      menuOpen = false;
      pickerEl?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  /* The menu closes on a press anywhere outside it. */
  $effect(() => {
    if (!menuOpen) return;
    queueMicrotask(() => menuEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuEl?.contains(t) && !pickerEl?.contains(t)) menuOpen = false;
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  });
</script>

<div class="composer" class:docked class:running>
  <textarea
    class="input selectable"
    rows="1"
    bind:this={field}
    bind:value
    {placeholder}
    aria-label="Message the assistant"
    spellcheck="true"
    onkeydown={onKeydown}
    onfocus={() => onfocuschange?.(true)}
    onblur={() => onfocuschange?.(false)}
  ></textarea>
  <div class="bar">
    <div class="picker-wrap">
      <button
        type="button"
        class="picker motion"
        bind:this={pickerEl}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Model: {current.label}"
        title="Which model answers"
        onclick={() => (menuOpen = !menuOpen)}
      >
        {current.label}
        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5l3-3" fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if menuOpen}
        <div
          class="menu"
          class:up={docked}
          role="menu"
          aria-label="Model"
          tabindex="-1"
          bind:this={menuEl}
          onkeydown={onMenuKeydown}
        >
          {#each MODEL_CHOICES as choice (choice.id)}
            <button
              type="button"
              class="m-item motion"
              role="menuitemradio"
              aria-checked={choice.id === model}
              onclick={() => choose(choice.id)}
            >
              <span class="m-check" aria-hidden="true">{choice.id === model ? '✓' : ''}</span>
              <span class="m-label">{choice.label}</span>
              <span class="m-hint">{choice.hint}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="keys" aria-hidden="true">
      {running ? 'esc to stop' : 'shift ↵ for a new line'}
    </span>
    {#if running}
      <button type="button" class="send stop motion" aria-label="Stop" title="Stop (esc)" onclick={onstop}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    {:else}
      <button
        type="button"
        class="send motion"
        aria-label="Send"
        title="Send (↵)"
        disabled={!canSend}
        onclick={() => void submit()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 10V2.2M2.6 5.4 6 2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px var(--space-2) 5px var(--space-3);
    border-radius: 12px;
    background: var(--field-bg);
    border: 1px solid var(--field-border);
    box-shadow: var(--shadow-card);
  }
  .composer:focus-within {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--field-border));
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent),
      var(--shadow-card);
  }
  .input {
    width: 100%;
    min-height: 20px;
    max-height: 140px;
    padding: 1px 0;
    border: 0;
    outline: none;
    resize: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-base);
    line-height: 1.45;
  }
  .input:focus-visible {
    outline: none;
  }
  .input::placeholder {
    color: var(--text-faint);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .picker-wrap {
    position: relative;
  }
  .picker {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: -5px;
    padding: 2px 6px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-muted);
  }
  .picker:hover,
  .picker[aria-expanded='true'] {
    background: var(--control);
    color: var(--text);
  }
  .menu {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: -6px;
    min-width: 210px;
    padding: 4px;
    border-radius: var(--radius-sm);
    background: var(--overlay);
    border: 1px solid var(--surface-border);
    box-shadow: var(--overlay-shadow);
  }
  .menu.up {
    top: auto;
    bottom: calc(100% + 4px);
  }
  .m-item {
    display: grid;
    grid-template-columns: 12px auto 1fr;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 4px var(--space-2) 4px 4px;
    border-radius: 4px;
    text-align: left;
    font-size: var(--fs-sm);
  }
  .m-item:hover,
  .m-item:focus-visible {
    background: var(--control);
    outline: none;
  }
  .m-check {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent);
  }
  .m-label {
    font-weight: 600;
  }
  .m-hint {
    justify-self: end;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .keys {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    font-size: var(--fs-xs);
    color: var(--text-faint);
    opacity: 0;
  }
  .composer:focus-within .keys,
  .running .keys {
    opacity: 1;
  }
  .send {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  }
  .send:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .send:disabled {
    background: var(--control);
    color: var(--text-faint);
    box-shadow: none;
    cursor: default;
  }
  .send.stop {
    background: var(--text);
    color: var(--overlay);
  }
  @media (prefers-reduced-motion: no-preference) {
    .keys {
      transition: opacity 140ms ease;
    }
    .composer {
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease;
    }
  }
</style>
