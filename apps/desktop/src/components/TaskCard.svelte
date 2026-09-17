<script module lang="ts">
  import type { Task } from '@ledge/core/pure';

  /** One entry in a card's overflow menu. The card draws it; the caller decides what it does. */
  export interface CardAction {
    label: string;
    run: (task: Task) => void;
    /** Destructive, so it is set apart from the rest. */
    danger?: boolean;
  }
</script>

<script lang="ts">
  /**
   * One task, as the project it belongs to rather than as the piece of work in front of you.
   * The closed card carries the project name, the state it is in, where it lives, how far along
   * it is, and the two lines that say what is actually happening: CURRENT, the item in hand,
   * and NEXT, the one after it, each labelled with the section of the file it was quoted from.
   * Everything else, including the note that says where the task stands, is behind the
   * disclosure, closed by default.
   *
   * It replaces a row that put three checklist items and half a note on the surface of every
   * card, which buried the project under the step. The rule this card follows is that the
   * closed state answers "which project, what state, what now, what next" and nothing more.
   *
   * Where a list is ordered by the person rather than by the clock, the card is also the thing
   * that gets moved: it is draggable, and its grip is a real button so the same move can be
   * made with the arrow keys. Both routes report the same "from index, to index" and leave the
   * writing of `order` to whoever owns the list.
   *
   * A drag also goes sideways, and that means something else: left and right move the task to
   * another list, which writes `status`. The two readings of one gesture are kept apart by
   * lib/drag.svelte.ts, which will not call a drag horizontal until it has travelled a
   * deliberate distance sideways and is clearly more sideways than vertical, and the card shows
   * the destination on itself before the person lets go. Dropping into Done does not archive on
   * release: it asks, in place, with the same control the Delete action uses, because archiving
   * a file is a bigger act than a flick of the wrist. The grip's left and right arrows do the
   * same move and ask the same question, so nothing here needs a pointer.
   *
   * No claim here is invented. The state pill, CURRENT and NEXT are derived in lib/derive.ts,
   * the git chips come from the last scan, and the agent chip appears only for a task that
   * genuinely has Claude Code session ids recorded against it.
   */
  import type { RepoStatus } from '@ledge/core/pure';
  import { progressOf, taskState, workLines } from '../lib/derive.ts';
  import { untrack } from 'svelte';
  import {
    ask,
    askShift,
    beginDrag,
    clearAsk,
    drag,
    endDrag,
    releaseDrag,
    shiftAim,
    shiftTargets,
    trackDrag,
    type ShiftTarget,
  } from '../lib/drag.svelte.ts';
  import type { ShiftTo } from '../lib/drag.svelte.ts';
  import { basename } from '../lib/paths.ts';
  import { lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import CardDetail from './CardDetail.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import GitChips from './GitChips.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    task: Task;
    /** Git state for the task's repo from the last scan, when it was scanned. */
    status?: RepoStatus;
    /** Today as YYYY-MM-DD. A prop so the card is testable without touching the clock. */
    day?: string;
    /** Start with the disclosure open. Off everywhere; used by tests and by search results. */
    open?: boolean;
    /** Entries for the overflow menu. No entries, no menu button. */
    actions?: CardAction[];
    /** This card's place in the list it is drawn in, counting from zero. */
    index?: number;
    /** How many cards are in that list, so the keyboard move knows where the ends are. */
    total?: number;
    /**
     * Moves this card from one position to another. Its presence is what makes the card
     * draggable and gives it a grip; a list that has no order of its own passes nothing.
     */
    onmove?: (from: number, to: number) => void;
    /**
     * Moves this task into another list, writing `status` through the store. Its presence is
     * what makes the sideways half of the gesture live and gives the grip its left and right
     * arrows; a list whose tasks cannot change status passes nothing.
     */
    onshift?: (task: Task, to: ShiftTo) => void;
    /** Opens the full task view. */
    onselect: (task: Task) => void;
  }

  let {
    task,
    status,
    day = todayIso(),
    open = false,
    actions = [],
    index = 0,
    total = 0,
    onmove,
    onshift,
    onselect,
  }: Props = $props();

  /* `open` seeds this once. untrack says so out loud: a card that reopened itself whenever its
     props changed would fight the person who just closed it. */
  let expanded = $state(untrack(() => open));
  let menuOpen = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  let moreEl = $state<HTMLButtonElement | null>(null);
  let dragging = $state(false);
  let over = $state<'' | 'before' | 'after'>('');
  /* Where the pointer was when the drag started, so the travel since can be measured. */
  let origin = { x: 0, y: 0 };
  /** Why the last sideways gesture went nowhere. Said on the card, cleared by the next drag. */
  let refused = $state('');

  const pill = $derived(taskState(task, day));
  /* Only two states get a colour of their own, and both are chips ui.css already defines:
     the green live chip for work in hand, the blue one for work that has started. Everything
     else is neutral, so this component owns no chip colours of its own. */
  const tone = $derived(
    pill.id === 'working' ? 'live' : pill.id === 'progress' ? 'info' : 'neutral',
  );
  const work = $derived(workLines(task));
  const progress = $derived(progressOf(task));
  const repoName = $derived(task.repo ? basename(task.repo) : '');
  const late = $derived(task.planned !== undefined ? lateLabel(task.planned, day) : '');
  const sessions = $derived(task.sessions.length);
  const movable = $derived(onmove !== undefined && total > 1);
  /** This card can change list, which is the other half of what a drag can mean. */
  const shiftable = $derived(onshift !== undefined);
  const draggable = $derived(movable || shiftable);
  /** What a release would do right now, while this card is the one being dragged sideways. */
  const aim = $derived(
    dragging && drag.axis === 'x' ? shiftAim(task.status, drag.direction) : undefined,
  );
  /** The move waiting on this card's answer, whether the drag or the view switch asked it. */
  const asking = $derived(ask.file === task.file ? ask.to : null);
  let askEl = $state<HTMLElement | null>(null);

  /* A question asked at the bottom of a short list is a question nobody can read. The list is
     what scrolls, so the question asks it to, once, when it appears. */
  $effect(() => {
    if (asking === null || !askEl) return;
    askEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  });

  function sourceWord(source: 'checklist' | 'plan'): string {
    return source === 'checklist' ? 'checklist' : 'plan';
  }

  function closeMenu(refocus = true) {
    menuOpen = false;
    if (refocus) moreEl?.focus();
  }

  function pick(action: CardAction) {
    closeMenu();
    action.run(task);
  }

  /*
   * Puts the menu where it fits. It is `position: fixed` so that neither the card, whose
   * overflow is hidden, nor the scrolling list, whose overflow is the scrollbar, can clip it:
   * at the panel's minimum height the list is under a hundred pixels tall and a menu confined
   * to it would have nowhere at all to be. The panel is the one box it must stay inside, so
   * the panel is what it is fitted against, flipping above the button when there is no room
   * below and sliding along the edge when there is none to the side.
   *
   * The offsets are worked out by zeroing them and reading where that lands. A fixed element's
   * containing block is not always the viewport, and the panel's own backdrop filter makes one
   * of it; measuring the origin is the only way to learn the difference without guessing which
   * ancestor is responsible.
   */
  function place() {
    const menu = menuEl;
    const anchor = moreEl;
    if (!menu || !anchor || typeof window === 'undefined') return;
    const panel = anchor.closest('.panel');
    const clip = panel
      ? panel.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const box = anchor.getBoundingClientRect();
    menu.style.top = '0px';
    menu.style.left = '0px';
    const origin = menu.getBoundingClientRect();
    const gap = 4;
    let top = box.bottom + gap;
    if (top + origin.height > clip.bottom - gap) {
      top = Math.max(clip.top + gap, box.top - gap - origin.height);
    }
    let left = box.right - origin.width;
    if (left + origin.width > clip.right - gap) left = clip.right - gap - origin.width;
    if (left < clip.left + gap) left = clip.left + gap;
    menu.style.top = `${top - origin.top}px`;
    menu.style.left = `${left - origin.left}px`;
  }

  /* Placed after it is drawn, because where it fits cannot be measured before it is real. */
  $effect(() => {
    if (!menuOpen || !menuEl) return;
    place();
  });

  /* The menu takes the focus when it opens, which is what makes it reachable without a mouse,
     and gives it back to the button it came from when it closes. */
  $effect(() => {
    if (!menuOpen) return;
    menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });

  /*
   * Escape anywhere, and a press anywhere outside, both close it. The listeners exist only
   * while the menu does: a list of forty cards must not carry forty idle window listeners.
   */
  $effect(() => {
    if (!menuOpen) return;
    const onDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (menuEl?.contains(target) || moreEl?.contains(target))) return;
      closeMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    };
    /* A menu pinned to the window cannot follow a list that moves under it, so a scroll or a
       resize closes it rather than leaving it hanging beside the wrong row. */
    const onMoved = () => closeMenu(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMoved, true);
    window.addEventListener('resize', onMoved);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMoved, true);
      window.removeEventListener('resize', onMoved);
    };
  });

  /** Up, down, first and last through the menu, so it is a menu rather than a list of buttons. */
  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let to = at;
    if (event.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (event.key === 'ArrowUp') to = (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = items.length - 1;
    else return;
    event.preventDefault();
    items[to]?.focus();
  }

  /* ---------------------------------------------------------------- dragging */

  function onDragStart(event: DragEvent) {
    if (!draggable) return;
    dragging = true;
    refused = '';
    clearAsk();
    origin = { x: event.clientX, y: event.clientY };
    beginDrag(task.file, index);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  /**
   * Reads the gesture as it happens. Chromium sends a last `drag` at the origin with zeroed
   * coordinates, which would read as a gesture that never left the start; ignoring it keeps the
   * destination on screen right up to the release.
   */
  function onDrag(event: DragEvent) {
    if (!dragging) return;
    if (event.clientX === 0 && event.clientY === 0) return;
    trackDrag(event.clientX - origin.x, event.clientY - origin.y);
  }

  function onDragOver(event: DragEvent) {
    /* A gesture that has turned sideways is not asking for a position in this list, so no card
       offers itself as one. Taking the drop is still necessary: it is how the source learns the
       person let go here rather than pressing Escape. Everything else is the reorder, unchanged
       and not conditional on a session, so a drop arriving from outside this list still lands. */
    if (drag.axis === 'x') {
      over = '';
      if (!shiftable) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return;
    }
    if (!movable || dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    over = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
  }

  function onDragLeave() {
    over = '';
  }

  function onDrop(event: DragEvent) {
    if (drag.axis === 'x') {
      /* The card the pointer happens to be over is not the card being moved, so all this drop
         does is say the gesture was released. The source acts on it in `dragend`. */
      event.preventDefault();
      releaseDrag();
      return;
    }
    if (!movable) return;
    event.preventDefault();
    const half = over;
    over = '';
    const from = Number(event.dataTransfer?.getData('text/plain'));
    if (!Number.isInteger(from) || from === index) return;
    /* Dropping on the lower half of a row means taking the place after it. The row being
       dragged vacates its own slot on the way, so a move downward lands one place earlier
       than the raw arithmetic says. */
    let to = half === 'after' ? index + 1 : index;
    if (from < to) to -= 1;
    if (to !== from) onmove?.(from, to);
  }

  /**
   * The end of the gesture, and where a sideways one is acted on. It has to be here rather than
   * in the drop, because the card being dropped on is not the card being moved. A release that
   * no target took, which is what Escape and a release over the panel's own padding both look
   * like, changes nothing.
   */
  function onDragEnd() {
    const sideways = dragging && drag.axis === 'x' && drag.released;
    const target = sideways ? shiftAim(task.status, drag.direction) : undefined;
    dragging = false;
    over = '';
    endDrag();
    if (target) requestShift(target);
  }

  /** One route for both the drag and the arrow keys: go, or ask first, or say why not. */
  function requestShift(target: ShiftTarget) {
    refused = '';
    clearAsk();
    if (target.to === undefined) {
      refused = target.refuse ?? 'There is nowhere to move this.';
      return;
    }
    if (target.confirm) {
      askShift(task.file, target.to);
      return;
    }
    onshift?.(task, target.to);
  }

  /** The same moves from the keyboard, since every other control on this panel is reachable. */
  function onGripKeydown(event: KeyboardEvent) {
    if (shiftable && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      const targets = shiftTargets(task.status);
      requestShift(event.key === 'ArrowLeft' ? targets.left : targets.right);
      return;
    }
    if (!movable) return;
    let to = index;
    if (event.key === 'ArrowUp') to = index - 1;
    else if (event.key === 'ArrowDown') to = index + 1;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = total - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (to === index || to < 0 || to > total - 1) return;
    onmove?.(index, to);
  }

  /** What the grip's tooltip and name can honestly promise, which depends on the list. */
  const gripHint = $derived(
    movable && shiftable
      ? 'Drag up or down to reorder, left or right to move it to another list, or use the arrow keys'
      : movable
        ? 'Drag to reorder, or use the arrow keys'
        : 'Drag left or right to move it to another list, or use the arrow keys',
  );
  const gripName = $derived(
    movable
      ? `Reorder ${task.title}, ${index + 1} of ${total}`
      : `Move ${task.title} to another list`,
  );
</script>

<!--
  The card and its menu are siblings inside one positioned box. That is what lets the menu be
  taken out of the flow: drawn inside the card it would claim a row of the card's own column
  and leave a band of empty card where the metadata had been.
-->
<div
  class="slot"
  class:dragging
  class:over-before={over === 'before'}
  class:over-after={over === 'after'}
  class:shifting={aim !== undefined}
  draggable={draggable}
  role={movable ? 'listitem' : undefined}
  ondragstart={onDragStart}
  ondrag={onDrag}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  ondragend={onDragEnd}
>
<article class="card task" class:late={late !== ''} data-id={task.id}>
  <div class="face">
  <div class="top">
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
    {:else}
      <span class="glyph {pill.id}" aria-hidden="true"></span>
    {/if}
    <button type="button" class="title" onclick={() => onselect(task)}>
      {task.title}
    </button>
    <span class="chip {tone}" title="Derived from this task's status, planned day and checklist">
      <span aria-hidden="true">{pill.glyph}</span>
      {pill.label}
    </span>
    {#if actions.length > 0}
      <button
        type="button"
        class="more motion"
        bind:this={moreEl}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More actions for {task.title}"
        onclick={() => (menuOpen ? closeMenu(false) : (menuOpen = true))}
      >
        <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
          <circle cx="2" cy="2" r="1.4" fill="currentColor" />
          <circle cx="7" cy="2" r="1.4" fill="currentColor" />
          <circle cx="12" cy="2" r="1.4" fill="currentColor" />
        </svg>
      </button>
    {/if}
  </div>

  <!--
    What the gesture is about to do, said on the card before the person lets go. A destination
    that has nowhere to write it says so here as well, in the same place, so a refusal reads as
    an answer to the gesture rather than as nothing happening.
  -->
  {#if aim}
    <p class="shift-aim" class:no={aim.to === undefined} aria-live="polite">
      {#if aim.to === undefined}
        {aim.refuse}
      {:else}
        {drag.direction === -1 ? '←' : '→'} {aim.label}
      {/if}
    </p>
  {:else if refused}
    <p class="shift-aim no" role="alert">{refused}</p>
  {/if}

  <!--
    A drop into Done asks rather than archives. The gesture was the first press; this is the
    second, in the same control the Delete action uses and in the row it was asked about.
  -->
  {#if asking !== null}
    <div class="shift-ask" bind:this={askEl}>
      <ConfirmButton
        armed
        label="Mark done"
        question="Mark done and archive the file?"
        confirmLabel="Mark done"
        groupLabel={`Confirm marking ${task.title} done`}
        onconfirm={() => {
          const to = asking;
          clearAsk();
          if (to) onshift?.(task, to);
        }}
        oncancel={clearAsk}
      />
    </div>
  {/if}

  {#if repoName || status || late !== ''}
    <div class="meta">
      {#if late !== ''}
        <span class="chip late">{late}</span>
      {/if}
      {#if repoName}
        <span class="repo trunc" title={task.repo}>{repoName}</span>
      {/if}
      {#if status}
        <span class="branch mono trunc" title="branch">{status.branch}</span>
      {/if}
    </div>
  {/if}

  {#if work.current}
    <p class="work current">
      <span class="work-label">Current</span>
      <span class="work-text">{work.current.text}</span>
      <span class="work-source">from the {sourceWord(work.current.source)}</span>
    </p>
  {/if}

  {#if work.next}
    <p class="work next">
      <span class="work-label">Next</span>
      <span class="work-text">{work.next.text}</span>
      <span class="work-source">from the {sourceWord(work.next.source)}</span>
    </p>
  {/if}

  {#if progress.total > 0}
    <div class="bar">
      <Progress done={progress.done} total={progress.total} />
      <span class="when-text">{relativeTime(task.updated)}</span>
    </div>
  {:else}
    <div class="bar">
      <span class="nolist">no checklist yet</span>
      <span class="when-text">{relativeTime(task.updated)}</span>
    </div>
  {/if}

  {#if sessions > 0 || status}
    <div class="foot">
      {#if sessions > 0}
        <span class="chip neutral" title="{sessions} linked Claude Code session ids">
          Claude Code
        </span>
      {/if}
      <GitChips repo={task.repo} {status} />
    </div>
  {/if}

  {#if task.status === 'backlog' && task.parked}
    <p class="quiet parked">Parked: {task.parked}</p>
  {/if}
  </div>

  <button
    type="button"
    class="disclose motion"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <svg width="9" height="9" viewBox="0 0 10 10" class:turn={expanded} aria-hidden="true">
      <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    {expanded ? 'Hide detail' : 'Detail'}
  </button>

  {#if expanded}
    <CardDetail {task} {day} />
  {/if}
</article>

{#if menuOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    bind:this={menuEl}
    onkeydown={onMenuKeydown}
  >
    {#each actions as action (action.label)}
      <button type="button" role="menuitem" class="menu-item motion" class:danger={action.danger}
        onclick={() => pick(action)}>{action.label}</button>
    {/each}
  </div>
{/if}
</div>

<style>
  /* The card's positioned box, and nothing else: it exists so the menu has something to be
     absolute against that is not the card, whose own overflow is hidden to keep its corners. */
  .slot {
    position: relative;
  }
  .slot.dragging {
    opacity: 0.4;
  }
  /* Where the row would land, drawn on the edge it would land against. */
  .slot.over-before::before,
  .slot.over-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .slot.over-before::before {
    top: -5px;
  }
  .slot.over-after::after {
    bottom: -5px;
  }
  /* A sideways drag is a different act from a reorder, so it does not look like one: the card
     stays legible rather than fading, and the accent outlines the whole of it. The person is
     choosing a list, not a slot, so there is no edge for the marker to sit on. */
  .slot.shifting {
    opacity: 1;
  }
  .slot.shifting .task {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* The destination, or the reason there is not one. It sits inside the card because that is
     what the gesture is about, and it is a line of words rather than an arrow alone because
     "Done" and "nothing can go here" are not the same news. */
  .shift-aim {
    margin: 0;
    padding: 0 var(--space-3) var(--space-1);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .shift-aim.no {
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--danger);
  }
  .shift-ask {
    padding: 0 var(--space-3) var(--space-2);
  }

  .task {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* A stripe, not a tint: late has to survive a translucent ground and greyscale. It is a
     border rather than a pseudo-element so the padding inside is stated once. */
  .task.late {
    border-left: 3px solid var(--late-edge);
  }
  /* Everything the closed card says, in one padded block. The disclosure and the detail below
     it are full bleed, which is what makes the open card read as one thing with a body. */
  .face {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: var(--space-2) var(--space-3) 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  /* The square is the state in a shape, for anyone reading the card in greyscale. */
  .glyph {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--text-faint);
  }
  .glyph.working {
    background: var(--done-fill);
  }
  .glyph.progress {
    background: var(--accent);
  }
  .glyph.parked,
  .glyph.fresh {
    background: transparent;
    border: 1.5px solid var(--text-faint);
  }
  /* The grip takes the state square's place in a list you can order, because the two want the
     same spot and only one of them is something to take hold of. */
  .grip {
    flex: none;
    width: 14px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    cursor: grab;
  }
  .grip:hover {
    background: var(--control);
    color: var(--text-muted);
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-size: var(--fs-base);
    font-weight: 600;
    line-height: 1.3;
    /* Wrap rather than truncate: a title the panel cannot show is a project you cannot find. */
    overflow-wrap: anywhere;
  }
  .title:hover {
    color: var(--accent);
  }
  .more {
    flex: none;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
  }
  .more:hover,
  .more[aria-expanded="true"] {
    background: var(--control);
    color: var(--text);
  }
  /* Out of the flow entirely, and out of every box that could clip it. Drawn in the flow it
     pushed the card's own content down and left a band of empty card where the metadata had
     been; drawn inside the scrolling list it had nowhere to go on a short panel. `place()`
     writes top and left; the zeroes here are only what it measures from. */
  .menu {
    position: fixed;
    z-index: 4;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 3px;
    border-radius: var(--radius-sm);
    /* The tokens the palette and the notification centre use. A menu that now covers a card
       instead of pushing it down has to be opaque enough to be read over it, which the
       translucent control fill was not in the dark theme. */
    background: var(--overlay);
    border: 1px solid var(--glass-border);
    box-shadow: var(--overlay-shadow);
  }
  .menu-item {
    padding: 4px var(--space-3);
    border-radius: 4px;
    text-align: left;
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
  }
  .menu-item:hover {
    background: var(--control);
  }
  .menu-item.danger {
    color: var(--danger);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    min-width: 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .branch {
    max-width: 140px;
  }

  /* The two work lines. Each is one line, labelled, with its source spelled out so neither can
     be mistaken for the panel's opinion about what you should do. */
  .work {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) 6px;
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.35;
  }
  .work.current {
    margin-top: 2px;
  }
  .work-label {
    flex: none;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  /* NEXT is the quieter of the two: it is not what is happening, it is what happens after. */
  .work.next .work-label,
  .work.next .work-text {
    color: var(--text-muted);
  }
  .work-text {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .work-source {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bar :global(.progress) {
    flex: 1;
    min-width: 0;
  }
  .nolist {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) 6px;
    min-width: 0;
  }
  .parked {
    margin: 0;
  }

  .disclose {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 5px var(--space-3);
    color: var(--text-faint);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .disclose:hover {
    background: var(--surface-hover);
    color: var(--text-muted);
  }
  .disclose svg.turn {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: no-preference) {
    .disclose svg {
      transition: transform 140ms ease;
    }
  }
</style>
