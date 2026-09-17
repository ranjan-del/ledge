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
   * No claim here is invented. The state pill, CURRENT and NEXT are derived in lib/derive.ts,
   * the git chips come from the last scan, and the agent chip appears only for a task that
   * genuinely has Claude Code session ids recorded against it.
   */
  import type { RepoStatus } from '@ledge/core/pure';
  import { progressOf, taskState, workLines } from '../lib/derive.ts';
  import { untrack } from 'svelte';
  import { basename } from '../lib/paths.ts';
  import { lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import CardDetail from './CardDetail.svelte';
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

  /* ---------------------------------------------------------------- reordering */

  function onDragStart(event: DragEvent) {
    if (!movable) return;
    dragging = true;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event: DragEvent) {
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

  function onDragEnd() {
    dragging = false;
    over = '';
  }

  /** The same move from the keyboard, since every other control on this panel is reachable. */
  function onGripKeydown(event: KeyboardEvent) {
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
  draggable={movable}
  role={movable ? 'listitem' : undefined}
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  ondragend={onDragEnd}
>
<article class="card task" class:late={late !== ''} data-id={task.id}>
  <div class="face">
  <div class="top">
    {#if movable}
      <button
        type="button"
        class="grip motion"
        aria-label="Reorder {task.title}, {index + 1} of {total}"
        title="Drag to reorder, or use the arrow keys"
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
