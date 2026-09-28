<script module lang="ts">
  /** A task an item can be linked to, as the picker offers it. */
  export interface TaskChoice {
    id: string;
    title: string;
  }

  /** A day, or Anytime, an item can be moved to. */
  export interface SlotChoice {
    slot: string;
    label: string;
  }

  /**
   * A pointer drag on the card, as the list hears it. The card only decides when a press has
   * become a drag; what the travel means, and where the card lands, is the list's business,
   * because only the list knows where the other cards are.
   */
  export interface CardGesture {
    phase: 'start' | 'move' | 'end' | 'cancel';
    dx: number;
    dy: number;
  }

  /** A move asked for from the keyboard: up and down the list, or to another week. */
  export type CardKeyMove = 'up' | 'down' | 'prev' | 'next';
</script>

<script lang="ts">
  /**
   * One card of the weekly to-do: a reminder, not a task step. Closed, it reads as the tick,
   * the words, two muted lines of its description when it has one, and the task it points at.
   * Everything else it can do (link or unlink a task, delete) is behind one quiet button, so a
   * week of items stays a list you can read rather than a toolbar.
   *
   * Pressing the card opens it in place: the words become a field and the description a text
   * area that grows as it is typed into. Enter in the title saves, and so does leaving the
   * card; in the description Enter is a new line and Cmd or Ctrl with Enter saves. Escape puts
   * both back as they were. Only one card is open at a time, which the list decides, so the
   * open state is a prop rather than something the card keeps.
   *
   * An unticked item can be dragged. A press that travels a few pixels is a drag and not a click,
   * so opening a card and moving it never get in each other's way.
   */
  import { tick, untrack } from 'svelte';
  import type { WeekItem } from '@ledge/core/pure';
  import { reducedMotion } from '../lib/motion.svelte.ts';
  import { dragStarted } from '../lib/week-drag.ts';
  import { cleanText, type WeekItemPatch } from '../lib/week-view.ts';
  import ConfirmButton from './ConfirmButton.svelte';

  interface Props {
    item: WeekItem;
    /** Where the item is now, so the move menu can leave it out. */
    slot: string;
    /** Every place it could be moved to in this week. */
    slots?: SlotChoice[];
    /** Tasks it can be linked to. */
    tasks?: TaskChoice[];
    /** The linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: string;
    onupdate: (patch: WeekItemPatch) => unknown;
    onmove?: (to: string) => unknown;
    /** Without it the card has no menu: the Assistant's cards only tick and edit. */
    onremove?: () => unknown;
    onopentask?: (id: string) => void;
    /** Open in place. The list holds which card is open, so opening one closes the other. */
    expanded?: boolean;
    onexpand?: (open: boolean) => void;
    /** The card can be dragged, and has a grip. Open items only: Completed keeps its order. */
    draggable?: boolean;
    /** Where it is in the list it can be dragged in, for the grip's name. */
    position?: { index: number; total: number };
    /** The week before and after, as the grip's name says them. */
    weekNames?: { prev: string; next: string };
    /** Being dragged: drawn lifted above the others. */
    lifted?: boolean;
    /** Let go, and easing into where it landed while the file is written. */
    settling?: boolean;
    /** Faded, because it is leaving for another week. */
    leaving?: boolean;
    /** Where the list has put it for now: the lifted card follows the pointer, others step aside. */
    offset?: string;
    ongesture?: (g: CardGesture) => void;
    onkeymove?: (move: CardKeyMove) => void;
  }

  let {
    item,
    slot,
    slots = [],
    tasks = [],
    taskTitle,
    onupdate,
    onmove,
    onremove,
    onopentask,
    expanded = false,
    onexpand,
    draggable = false,
    position,
    weekNames,
    lifted = false,
    settling = false,
    leaving = false,
    offset,
    ongesture,
    onkeymove,
  }: Props = $props();

  /* A card nobody controls still opens and closes, on its own. */
  let ownOpen = $state(false);
  const isOpen = $derived(onexpand ? expanded : ownOpen);

  let tools = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  let description = $state('');
  let root = $state<HTMLLIElement | null>(null);
  let card = $state<HTMLElement | null>(null);
  let titleField = $state<HTMLInputElement | null>(null);
  let opener = $state<HTMLButtonElement | null>(null);
  /* True while a save or a cancel is in flight, so a blur cannot fire a second one. */
  let sealed = false;

  const descId = `week-desc-${Math.random().toString(36).slice(2, 9)}`;
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  const saveKeys = mac ? '⌘ Enter' : 'Ctrl Enter';

  const others = $derived(slots.filter((s) => s.slot !== slot));
  const linkable = $derived(
    item.taskId && !tasks.some((t) => t.id === item.taskId)
      ? [...tasks, { id: item.taskId, title: item.taskId }]
      : tasks,
  );
  const gripName = $derived(
    position
      ? `Move ${item.text}, ${position.index + 1} of ${position.total}. Drag, or use the arrow keys`
      : `Move ${item.text}`,
  );
  const gripHint = $derived(
    weekNames
      ? `Drag up or down to reorder, left to ${weekNames.prev}, right to ${weekNames.next}. Alt and the arrow keys do the same.`
      : 'Drag up or down to reorder. Alt and the arrow keys do the same.',
  );

  function errorOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  /** Runs an edit and keeps its refusal on this card, where the person was looking. */
  function attempt(run: () => unknown) {
    error = null;
    void Promise.resolve()
      .then(run)
      .catch((e: unknown) => (error = errorOf(e)));
  }

  function setOpen(open: boolean) {
    if (onexpand) onexpand(open);
    else ownOpen = open;
  }

  /* ---------------------------------------------------------------- opening and closing */

  /**
   * The card grows and shrinks rather than jumping. The height before the change is read here,
   * before the DOM updates, and the height after it once it has; the card then animates from
   * one to the other. Opening also seeds the fields from the item, once, so a watcher re-read
   * while the card is open cannot throw away what is being typed.
   */
  let wasOpen = false;
  $effect.pre(() => {
    const now = isOpen;
    untrack(() => {
      if (now === wasOpen) return;
      wasOpen = now;
      const from = card?.offsetHeight ?? 0;
      if (now) {
        title = item.text;
        description = item.description ?? '';
        error = null;
        tools = false;
      }
      void tick().then(() => {
        grow(from);
        if (now) {
          titleField?.focus();
          titleField?.setSelectionRange(title.length, title.length);
        }
      });
    });
  });

  function grow(from: number) {
    const el = card;
    if (!el || reducedMotion() || typeof el.animate !== 'function') return;
    const to = el.offsetHeight;
    if (from === 0 || from === to) return;
    el.style.overflow = 'hidden';
    const run = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
    const done = () => {
      if (card === el) el.style.overflow = '';
    };
    run.onfinish = done;
    run.oncancel = done;
  }

  function expand() {
    if (!isOpen) setOpen(true);
  }

  /** Closes and gives the focus back to the card, as a closed disclosure should. */
  function collapse(refocus: boolean) {
    setOpen(false);
    if (refocus) void tick().then(() => opener?.focus());
  }

  /** Saves what changed, if anything did, and closes. A refusal keeps the card open. */
  async function save(refocus = false) {
    if (sealed || !isOpen) return;
    const patch: WeekItemPatch = {};
    if (cleanText(title) !== item.text) patch.text = title;
    const nextDescription = description.trim();
    if (nextDescription !== (item.description ?? '').trim()) patch.description = nextDescription;
    if (Object.keys(patch).length === 0) {
      error = null;
      collapse(refocus);
      return;
    }
    sealed = true;
    try {
      await onupdate(patch);
      error = null;
      collapse(refocus);
    } catch (e) {
      error = errorOf(e);
    } finally {
      sealed = false;
    }
  }

  function cancel() {
    if (sealed) return;
    error = null;
    collapse(true);
  }

  function onTitleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      void save(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  function onDescriptionKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  /** A press anywhere outside an open card closes it, keeping what was typed. */
  $effect(() => {
    if (!isOpen) return;
    const away = (event: PointerEvent) => {
      if (root && event.target instanceof Node && !root.contains(event.target)) void save();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  });

  /* Tabbing out saves too. A blur with nowhere to go is the window losing focus, which is not
     the person leaving the card, so that one leaves it open. */
  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (!isOpen || !(next instanceof Node) || root?.contains(next)) return;
    void save();
  }

  /** Grows the text area with its text, so a long description never scrolls inside a box. */
  function autogrow(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }

  /** A press on the card's own surface opens it. Its controls keep their own meaning. */
  function onCardClick(event: MouseEvent) {
    if (isOpen) return;
    const target = event.target as Element | null;
    if (target?.closest('input, select, textarea, a, button, .tools')) return;
    expand();
  }

  /* ---------------------------------------------------------------- dragging */

  let press: { id: number; x: number; y: number; started: boolean } | null = null;
  /* A drag ends in a click on whatever was under the pointer. That click is not a request to
     open the card, so the next one is swallowed, and only for the moment it takes to arrive. */
  let swallow = false;

  function onPointerDown(event: PointerEvent) {
    if (!draggable || isOpen || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('input, select, textarea, a, .chip, .more, .tools')) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false };
  }

  function onPointerMove(event: PointerEvent) {
    if (!press || event.pointerId !== press.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.started) {
      if (!dragStarted(dx, dy)) return;
      press.started = true;
      tools = false;
      try {
        root?.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer has nothing to capture */
      }
      ongesture?.({ phase: 'start', dx, dy });
    }
    event.preventDefault();
    ongesture?.({ phase: 'move', dx, dy });
  }

  function finish(event: PointerEvent, phase: 'end' | 'cancel') {
    if (!press || event.pointerId !== press.id) return;
    const started = press.started;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    press = null;
    if (!started) return;
    swallow = true;
    setTimeout(() => (swallow = false), 0);
    ongesture?.({ phase, dx, dy });
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const KEY_MOVES: Record<string, CardKeyMove> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'prev',
    ArrowRight: 'next',
  };

  /** The grip moves with the plain arrow keys, since moving is all it is for. */
  function onGripKeydown(event: KeyboardEvent) {
    const move = KEY_MOVES[event.key];
    if (!move || !onkeymove || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    onkeymove(move);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && tools) {
      event.preventDefault();
      event.stopPropagation();
      tools = false;
      return;
    }
    /* Alt and an arrow move the focused card from anywhere on it, except inside a text field,
       where Alt and an arrow already mean a word at a time. */
    const move = KEY_MOVES[event.key];
    if (!move || !event.altKey || !onkeymove) return;
    const target = event.target as Element | null;
    if (target?.closest('textarea, select, input:not([type="checkbox"])')) return;
    event.preventDefault();
    event.stopPropagation();
    onkeymove(move);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class="slot"
  class:ticked={item.done}
  class:open={isOpen}
  class:lifted
  class:settling
  class:leaving
  class:draggable
  style:transform={offset}
  bind:this={root}
  data-week-card
  {onkeydown}
  onfocusout={onFocusOut}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={(e) => finish(e, 'end')}
  onpointercancel={(e) => finish(e, 'cancel')}
  onclickcapture={onClickCapture}
>
  <!-- The surface opens the card for a pointer; the keyboard has the title button for that. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="card week-card" bind:this={card} onclick={onCardClick}>
    <div class="line">
      {#if draggable}
        <button
          type="button"
          class="grip motion"
          aria-label={gripName}
          title={gripHint}
          onkeydown={onGripKeydown}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
            <circle cx="2" cy="2" r="1" fill="currentColor" />
            <circle cx="6" cy="2" r="1" fill="currentColor" />
            <circle cx="2" cy="6" r="1" fill="currentColor" />
            <circle cx="6" cy="6" r="1" fill="currentColor" />
            <circle cx="2" cy="10" r="1" fill="currentColor" />
            <circle cx="6" cy="10" r="1" fill="currentColor" />
          </svg>
        </button>
      {/if}
      <input
        type="checkbox"
        class="tick"
        checked={item.done}
        aria-label={item.done ? `Untick: ${item.text}` : `Tick: ${item.text}`}
        onchange={(e) => {
          const done = e.currentTarget.checked;
          attempt(() => onupdate({ done }));
        }}
      />
      <div class="body">
        {#if isOpen}
          <input
            class="field title-field"
            bind:this={titleField}
            bind:value={title}
            aria-label="Title"
            onkeydown={onTitleKeydown}
          />
        {:else}
          <button
            type="button"
            class="title-btn"
            bind:this={opener}
            aria-expanded={false}
            aria-describedby={item.description ? descId : undefined}
            title="Open to edit"
            onclick={expand}
          >
            {item.text}
          </button>
          {#if item.description}
            <p class="desc" id={descId}>{item.description}</p>
          {/if}
        {/if}
      </div>
      {#if item.taskId}
        <button
          type="button"
          class="chip neutral link motion"
          disabled={taskTitle === undefined || !onopentask}
          title={taskTitle === undefined ? 'That task is not on the desk' : 'Open the task'}
          onclick={() => item.taskId && onopentask?.(item.taskId)}
        >
          <span class="trunc">{taskTitle ?? item.taskId}</span>
        </button>
      {/if}
      {#if onremove}
        <button
          type="button"
          class="drop more motion"
          aria-expanded={tools}
          aria-label={`More for: ${item.text}`}
          onclick={() => (tools = !tools)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="2.5" cy="6" r="1.1" fill="currentColor" />
            <circle cx="6" cy="6" r="1.1" fill="currentColor" />
            <circle cx="9.5" cy="6" r="1.1" fill="currentColor" />
          </svg>
        </button>
      {/if}
    </div>

    {#if isOpen}
      <div class="edit">
        <textarea
          class="field desc-field"
          rows="2"
          bind:value={description}
          use:autogrow
          aria-label="Description"
          placeholder="Add a description, what has to be done"
          onkeydown={onDescriptionKeydown}
        ></textarea>
        <div class="edit-foot">
          <span class="hint">Enter saves the title, {saveKeys} the description, Esc cancels</span>
          <button
            type="button"
            class="btn done-edit"
            aria-expanded={true}
            onclick={() => void save(true)}
          >
            Done
          </button>
        </div>
      </div>
    {/if}

    {#if error}
      <p class="edit-error row-error" role="alert">{error}</p>
    {/if}
    {#if tools && onremove}
      <div class="tools">
        {#if others.length > 0 && onmove}
          <label>
            <span>Move to</span>
            <select
              class="field"
              aria-label={`Move: ${item.text}`}
              value=""
              onchange={(e) => {
                const to = e.currentTarget.value;
                if (to) {
                  tools = false;
                  attempt(() => onmove?.(to));
                }
              }}
            >
              <option value="" disabled>Choose a day</option>
              {#each others as choice (choice.slot)}
                <option value={choice.slot}>{choice.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label>
          <span>Task</span>
          <select
            class="field"
            aria-label={`Task for: ${item.text}`}
            value={item.taskId ?? ''}
            onchange={(e) => {
              const id = e.currentTarget.value;
              attempt(() => onupdate({ taskId: id === '' ? undefined : id }));
            }}
          >
            <option value="">No task</option>
            {#each linkable as task (task.id)}
              <option value={task.id}>{task.title}</option>
            {/each}
          </select>
        </label>
        <ConfirmButton
          label="Delete"
          question="Delete this item?"
          confirmLabel="Delete"
          groupLabel={`Confirm deleting: ${item.text}`}
          onconfirm={() => attempt(() => onremove?.())}
        />
      </div>
    {/if}
  </div>
</li>

<style>
  .slot {
    position: relative;
    min-width: 0;
  }
  .slot.draggable {
    touch-action: none;
  }
  /* Lifted above its neighbours, with the shadow the overlays use, so it reads as held. The
     list moves it with a transform, so it never takes its place in the flow until it lands. */
  .slot.lifted {
    z-index: 2;
  }
  .slot.leaving {
    opacity: 0;
  }
  .slot.lifted .week-card {
    box-shadow: var(--overlay-shadow);
    background: var(--surface-hover);
    cursor: grabbing;
  }

  .week-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-2);
    cursor: pointer;
  }
  .week-card:hover {
    background: var(--surface-hover);
  }
  .open .week-card {
    cursor: default;
    background: var(--surface-hover);
    border-color: var(--field-border);
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }
  .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 12px;
    height: 18px;
    margin-left: -2px;
    padding: 0;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    opacity: 0;
    cursor: grab;
  }
  .week-card:hover .grip,
  .grip:focus-visible,
  .lifted .grip {
    opacity: 1;
  }
  .tick {
    flex: none;
    margin: 3px 0 0;
    accent-color: var(--done-fill);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title-btn {
    padding: 0;
    text-align: left;
    font-size: var(--fs-base);
    font-weight: 500;
    line-height: 1.35;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  /* Two lines of the description, muted, so a card says what has to be done without becoming
     the description. The rest is one press away. */
  .desc {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.4;
    color: var(--text-muted);
    white-space: pre-line;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .ticked .title-btn {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .ticked .desc {
    color: var(--text-faint);
  }
  .title-field {
    width: 100%;
    margin: -3px 0 0 -3px;
    padding: 2px 3px;
    font-weight: 500;
    line-height: 1.35;
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-left: 21px;
  }
  .draggable .edit {
    padding-left: 39px;
  }
  .desc-field {
    width: 100%;
    min-height: 40px;
    resize: none;
    overflow: hidden;
    font-family: inherit;
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
  .edit-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hint {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .done-edit {
    padding: 2px var(--space-2);
    font-size: var(--fs-xs);
  }
  .link {
    flex: none;
    max-width: 120px;
    margin-top: 1px;
  }
  .link:hover:not(:disabled) {
    color: var(--accent);
  }
  .link:disabled {
    cursor: default;
  }
  .more {
    width: 20px;
    height: 20px;
    opacity: 0.6;
  }
  .week-card:hover .more,
  .more:focus-visible,
  .more[aria-expanded="true"] {
    opacity: 1;
  }
  .row-error {
    padding-left: 21px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
    padding: 0 0 var(--space-1) 21px;
    cursor: default;
  }
  .tools label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
  }
  .tools select {
    max-width: 150px;
    font-size: var(--fs-sm);
  }
  /* The others step aside with a short slide; the lifted card follows the pointer exactly,
     and only eases into its place once it has been let go. Only while the list is sorting:
     when the new order is drawn, the offsets go in the same frame as the transition, so no
     card slides back from where it was held. */
  @media (prefers-reduced-motion: no-preference) {
    .grip,
    .more {
      transition: opacity 120ms ease;
    }
    :global(.sorting) > .slot {
      transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 160ms ease;
    }
    :global(.sorting) > .slot.lifted {
      transition: none;
    }
    :global(.sorting) > .slot.lifted.settling {
      transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 160ms ease;
    }
  }
</style>
