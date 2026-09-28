<script lang="ts">
  /**
   * TO-DO: the week, as one list of things to get done this week. There are no day sections: the
   * person picks up these items whenever they work, so the week is the only date that matters.
   * A header names the week and steps through weeks; the calendar jumps further. Under it, one
   * add row, then the open items, then the ticked ones in a Completed list, so ticking an item
   * moves it down out of the way while keeping it for the week's record.
   *
   * It is separate from task checklists on purpose: an item may point at a task, and ticking it
   * changes nothing on that task. Each week keeps its own items; a new week starts empty and the
   * old one is still there to browse.
   *
   * Each item is a card, and one card at a time opens in place to edit its words and its
   * description. The open cards can be dragged: up and down reorders them, and a drag clearly
   * to the left or right sends the card to the week before or after, with the same thresholds
   * the task cards use. Completed keeps its order, since it is a record rather than a plan.
   */
  import type { WeekFile } from '@ledge/core/pure';
  import { isoWeekOf } from '@ledge/core/pure';
  import { tick, untrack } from 'svelte';
  import {
    dropIndex,
    gapShift,
    gapSize,
    landingOffset,
    readWeekDrag,
    type CardBox,
  } from '../lib/week-drag.ts';
  import {
    ANYTIME,
    doneEntries,
    neighbours,
    openEntries,
    weekLabel,
    type WeekItemPatch,
    type WeekRef,
  } from '../lib/week-view.ts';
  import { todayIso } from '../lib/time.ts';
  import MonthPicker from './MonthPicker.svelte';
  import WeekAdd from './WeekAdd.svelte';
  import WeekItemRow, { type CardGesture, type CardKeyMove, type TaskChoice } from './WeekItemRow.svelte';

  interface Props {
    week: WeekFile;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** Tasks an item can be linked to. */
    tasks?: TaskChoice[];
    /** A linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: (id: string) => string | undefined;
    onbrowse: (week: string) => void;
    onadd: (slot: string, text: string, taskId?: string) => unknown;
    onupdate: (ref: WeekRef, patch: WeekItemPatch) => unknown;
    onmove: (ref: WeekRef, to: string) => unknown;
    onremove: (ref: WeekRef) => unknown;
    /** Moves the open item at `from` to where the open item at `to` is, counting open items. */
    onreorder?: (from: number, to: number) => unknown;
    /** Sends an item to the end of Anytime in another week. */
    onweekmove?: (ref: WeekRef, week: string) => unknown;
    onopentask?: (id: string) => void;
    /** Week files read so far, for the calendar's dots and shading. Without it, no calendar. */
    weeks?: Record<string, WeekFile>;
    /** The calendar shows these weeks: read the ones that have a file and are not read yet. */
    onloadweeks?: (weeks: string[]) => unknown;
  }

  let {
    week,
    day = todayIso(),
    tasks = [],
    taskTitle,
    onbrowse,
    onadd,
    onupdate,
    onmove,
    onremove,
    onreorder,
    onweekmove,
    onopentask,
    weeks,
    onloadweeks,
  }: Props = $props();

  let calendarOpen = $state(false);
  let toggle = $state<HTMLButtonElement | null>(null);

  /** Shows the week a day picked in the calendar is in. */
  function pickDay(d: string) {
    calendarOpen = false;
    toggle?.focus();
    const target = isoWeekOf(d);
    if (target !== week.week) onbrowse(target);
  }

  const thisWeek = $derived(isoWeekOf(day));
  const current = $derived(week.week === thisWeek);
  const around = $derived(neighbours(week.week));
  const open = $derived(openEntries(week));
  const done = $derived(doneEntries(week));
  /** The Completed list starts open, so a tick visibly lands somewhere. */
  let showDone = $state(true);

  /* ---------------------------------------------------------------- one open card */

  /** Which card is open, by where its item is. One at a time, by construction. */
  let expanded = $state<string | null>(null);
  const refKey = (ref: WeekRef) => `${ref.slot}:${ref.index}`;

  function setExpanded(ref: WeekRef, open: boolean) {
    const key = refKey(ref);
    if (open) expanded = key;
    else if (expanded === key) expanded = null;
  }

  /* Another week is another list, so nothing stays open across the step. */
  const weekId = $derived(week.week);
  $effect(() => {
    void weekId;
    expanded = null;
  });

  /* ---------------------------------------------------------------- dragging */

  interface Drag {
    from: number;
    dx: number;
    dy: number;
    axis: 'x' | 'y';
    direction: -1 | 0 | 1;
    to: number;
    boxes: CardBox[];
    size: number;
    /** Let go: the cards hold where they landed until the file says so. */
    settling: boolean;
  }

  let dragging = $state<Drag | null>(null);
  /* The week the drag was measured against. Once the file says otherwise the offsets mean
     nothing, so they are dropped in the same frame the new order is drawn. */
  let dragWeek: WeekFile | null = null;
  const sorting = $derived(dragging !== null && week === dragWeek);
  let list = $state<HTMLUListElement | null>(null);
  /** A short line saying where a card went, since it has left the list being looked at. */
  let notice = $state('');
  let noticeWeek = $state('');
  let moveError = $state('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const canDrag = $derived(onreorder !== undefined || onweekmove !== undefined);
  const aimWeek = $derived(
    dragging && !dragging.settling && dragging.axis === 'x'
      ? dragging.direction < 0
        ? around.prev
        : around.next
      : undefined,
  );
  const weekNames = $derived({ prev: weekLabel(around.prev), next: weekLabel(around.next) });

  function measure(): CardBox[] {
    const cards = list ? [...list.querySelectorAll<HTMLElement>(':scope > li')] : [];
    return cards.map((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
  }

  function onGesture(index: number, g: CardGesture) {
    if (g.phase === 'start') {
      const boxes = measure();
      dragWeek = week;
      dragging = {
        from: index,
        dx: 0,
        dy: 0,
        axis: 'y',
        direction: 0,
        to: index,
        boxes,
        size: gapSize(boxes, index),
        settling: false,
      };
      expanded = null;
      moveError = '';
      return;
    }
    const d = dragging;
    if (!d || d.settling || d.from !== index) return;
    if (g.phase === 'cancel') {
      dragging = null;
      return;
    }
    const read = readWeekDrag(g.dx, g.dy);
    d.dx = g.dx;
    d.dy = g.dy;
    d.axis = onweekmove ? read.axis : 'y';
    d.direction = onweekmove ? read.direction : 0;
    const box = d.boxes[index];
    d.to =
      d.axis === 'y' && box && onreorder
        ? dropIndex(
            d.boxes.map((b) => b.top + b.height / 2),
            index,
            box.top + box.height / 2 + g.dy,
          )
        : index;
    if (g.phase === 'end') drop(d);
  }

  function drop(d: Drag) {
    const entry = open[d.from];
    if (!entry) {
      dragging = null;
      return;
    }
    if (d.axis === 'x' && d.direction !== 0) {
      const target = d.direction < 0 ? around.prev : around.next;
      d.settling = true;
      sendToWeek(entry.ref, target).finally(() => (dragging = null));
      return;
    }
    if (d.to === d.from) {
      dragging = null;
      return;
    }
    d.settling = true;
    d.dx = 0;
    d.dy = landingOffset(d.boxes, d.from, d.to);
    void Promise.resolve()
      .then(() => onreorder?.(d.from, d.to))
      .catch((e: unknown) => (moveError = errorOf(e)))
      .finally(() => (dragging = null));
  }

  /* The file changed under the settled cards, so the list now draws the new order itself. */
  $effect(() => {
    void week;
    untrack(() => {
      if (dragging?.settling) dragging = null;
    });
  });

  /* Escape lets go without moving anything, as it does for the task cards. */
  $effect(() => {
    if (!dragging || dragging.settling) return;
    const onkey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      dragging = null;
    };
    window.addEventListener('keydown', onkey, true);
    return () => window.removeEventListener('keydown', onkey, true);
  });

  function offsetFor(i: number): string | undefined {
    const d = dragging;
    if (!d || !sorting) return undefined;
    if (i === d.from) {
      if (d.axis === 'x') return `translate(${d.dx}px, ${d.settling ? 0 : d.dy}px)`;
      return `translate(${d.settling ? 0 : d.dx}px, ${d.dy}px)`;
    }
    const shift = d.axis === 'y' ? gapShift(i, d.from, d.to, d.size) : 0;
    return shift === 0 ? undefined : `translateY(${shift}px)`;
  }

  function errorOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function sendToWeek(ref: WeekRef, target: string) {
    moveError = '';
    try {
      await onweekmove?.(ref, target);
      clearTimeout(noticeTimer);
      notice = `Moved to ${weekLabel(target)}`;
      noticeWeek = target;
      noticeTimer = setTimeout(() => (notice = ''), 5000);
    } catch (e) {
      moveError = errorOf(e);
    }
  }

  /** The same moves from the keyboard, and the focus follows the card to where it went. */
  async function keyMove(index: number, move: CardKeyMove) {
    const entry = open[index];
    if (!entry || dragging) return;
    if (move === 'prev' || move === 'next') {
      if (!onweekmove) return;
      await sendToWeek(entry.ref, move === 'prev' ? around.prev : around.next);
      await tick();
      focusCard(Math.min(index, open.length - 1), false);
      return;
    }
    const to = move === 'up' ? index - 1 : index + 1;
    if (!onreorder || to < 0 || to > open.length - 1) return;
    const onGrip = document.activeElement?.classList.contains('grip') ?? false;
    moveError = '';
    try {
      await onreorder(index, to);
    } catch (e) {
      moveError = errorOf(e);
      return;
    }
    await tick();
    focusCard(to, onGrip);
  }

  function focusCard(index: number, grip: boolean) {
    const card = list?.querySelectorAll<HTMLElement>(':scope > li')[index];
    card?.querySelector<HTMLElement>(grip ? '.grip' : '.title-btn')?.focus();
  }

  $effect(() => () => clearTimeout(noticeTimer));
</script>

<div class="pane">
  <div class="pane-scroll week">
    <div class="week-head">
      <button
        type="button"
        class="drop step motion"
        aria-label="Previous week"
        title="Previous week"
        onclick={() => onbrowse(around.prev)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M6.5 1.5 3 5l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <h2 class="week-title" aria-live="polite">{weekLabel(week.week)}</h2>
      <button
        type="button"
        class="drop step motion"
        aria-label="Next week"
        title="Next week"
        onclick={() => onbrowse(around.next)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {#if weeks}
        <button
          type="button"
          class="drop step cal motion"
          bind:this={toggle}
          data-calendar-toggle
          aria-label="Pick a week"
          aria-haspopup="dialog"
          aria-expanded={calendarOpen}
          title="Pick a week"
          onclick={() => (calendarOpen = !calendarOpen)}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.8" y="2.8" width="10.4" height="9.4" rx="2" fill="none" stroke="currentColor"
              stroke-width="1.3" />
            <path d="M1.8 5.8h10.4M4.7 1.5v2.6M9.3 1.5v2.6" stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" />
            <circle cx="7" cy="9" r="1" fill="currentColor" />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="btn this-week motion"
        disabled={current}
        onclick={() => onbrowse(thisWeek)}
      >
        This week
      </button>
      {#if calendarOpen && weeks}
        <MonthPicker
          {day}
          week={week.week}
          {weeks}
          onmonth={onloadweeks}
          onpick={(d) => pickDay(d)}
          onclose={() => (calendarOpen = false)}
        />
      {/if}
    </div>

    <WeekAdd
      label={current ? 'Add something for this week' : `Add to ${weekLabel(week.week)}`}
      {tasks}
      onadd={(text, taskId) => onadd(ANYTIME, text, taskId)}
      persistent
    />

    {#if open.length > 0}
      <ul class="items" class:sorting aria-label="To do this week" bind:this={list}>
        {#each open as entry, i (`${entry.ref.slot}:${entry.ref.index}:${entry.item.text}`)}
          <WeekItemRow
            item={entry.item}
            slot={entry.ref.slot}
            slots={[]}
            {tasks}
            taskTitle={entry.item.taskId ? taskTitle?.(entry.item.taskId) : undefined}
            onupdate={(patch) => onupdate(entry.ref, patch)}
            onmove={(to) => onmove(entry.ref, to)}
            onremove={() => {
              expanded = null;
              return onremove(entry.ref);
            }}
            {onopentask}
            expanded={expanded === refKey(entry.ref)}
            onexpand={(o) => setExpanded(entry.ref, o)}
            draggable={canDrag}
            position={{ index: i, total: open.length }}
            weekNames={onweekmove ? weekNames : undefined}
            lifted={sorting && dragging?.from === i}
            settling={sorting && dragging?.from === i && dragging.settling}
            leaving={sorting && dragging?.from === i && dragging.settling && dragging.axis === 'x'}
            offset={offsetFor(i)}
            ongesture={(g) => onGesture(i, g)}
            onkeymove={(m) => void keyMove(i, m)}
          />
        {/each}
      </ul>
    {:else}
      <p class="empty-note">
        {done.length > 0 ? 'Everything for this week is done.' : 'Nothing planned for this week yet.'}
      </p>
    {/if}

    {#if moveError}
      <p class="edit-error move-error" role="alert">{moveError}</p>
    {/if}
    {#if notice}
      <p class="moved" role="status">
        <span class="what">{notice}</span>
        <button type="button" class="moved-go motion" onclick={() => {
          notice = '';
          onbrowse(noticeWeek);
        }}>Show</button>
      </p>
    {/if}

    {#if done.length > 0}
      <section class="completed" aria-label="Completed">
        <button
          type="button"
          class="completed-head motion"
          aria-expanded={showDone}
          onclick={() => (showDone = !showDone)}
        >
          <svg class="chev" class:open={showDone} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Completed</span>
          <span class="count">{done.length}</span>
        </button>
        {#if showDone}
          <ul class="items done-items">
            {#each done as entry (`${entry.ref.slot}:${entry.ref.index}:${entry.item.text}`)}
              <WeekItemRow
                item={entry.item}
                slot={entry.ref.slot}
                slots={[]}
                {tasks}
                taskTitle={entry.item.taskId ? taskTitle?.(entry.item.taskId) : undefined}
                onupdate={(patch) => onupdate(entry.ref, patch)}
                onmove={(to) => onmove(entry.ref, to)}
                onremove={() => {
                  expanded = null;
                  return onremove(entry.ref);
                }}
                {onopentask}
                expanded={expanded === refKey(entry.ref)}
                onexpand={(o) => setExpanded(entry.ref, o)}
              />
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>

  <!--
    Where a sideways drag is about to send the card, said at the edge it is heading for before
    the person lets go, so a week move is never a surprise.
  -->
  {#if aimWeek && dragging}
    <div class="edge-hint" class:left={dragging.direction < 0} class:right={dragging.direction > 0} aria-live="polite">
      <span class="edge-name">{dragging.direction < 0 ? 'Previous week' : 'Next week'}</span>
      <span class="edge-week">{weekLabel(aimWeek)}</span>
    </div>
  {/if}
</div>

<style>
  .week {
    gap: var(--space-1);
  }
  .week-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .step {
    width: 24px;
    height: 24px;
  }
  .step:hover {
    background: var(--control);
  }
  .week-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    text-align: center;
    font-size: var(--fs-base);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .cal[aria-expanded='true'] {
    background: var(--control);
    color: var(--text);
  }
  .this-week {
    padding: 3px var(--space-2);
    font-size: var(--fs-xs);
  }

  .empty-note {
    margin: var(--space-2) var(--space-2) 0;
    font-size: var(--fs-sm);
    color: var(--text-faint);
  }
  .items {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .items.sorting {
    cursor: grabbing;
  }
  .move-error {
    margin: var(--space-1) var(--space-2) 0;
  }
  /* The confirmation after a card leaves for another week. It says where, and offers to go. */
  .moved {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--info-bg);
    color: var(--info-fg);
    font-size: var(--fs-sm);
  }
  .moved .what {
    flex: 1;
    min-width: 0;
  }
  .moved-go {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: inherit;
    font-weight: 700;
  }
  .moved-go:hover {
    background: var(--surface);
  }
  .pane {
    position: relative;
  }
  /* The destination of a sideways drag, pinned to the edge the card is heading for. */
  .edge-hint {
    position: absolute;
    top: 50%;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 45%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--overlay);
    box-shadow: var(--overlay-shadow);
    border: 2px solid var(--accent);
    transform: translateY(-50%);
    pointer-events: none;
  }
  .edge-hint.left {
    left: var(--space-2);
  }
  .edge-hint.right {
    right: var(--space-2);
    text-align: right;
  }
  .edge-name {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .edge-week {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
  }
  .completed {
    margin-top: var(--space-3);
    border-top: 1px solid var(--surface-border);
    padding-top: var(--space-2);
  }
  .completed-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 2px var(--space-2);
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 700;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .completed-head:hover {
    background: var(--control);
  }
  .completed-head .count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .chev {
    transition: transform 150ms ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
  .done-items {
    opacity: 0.7;
  }
  @media (prefers-reduced-motion: no-preference) {
    .edge-hint {
      animation: edge-in 140ms ease both;
    }
    @keyframes edge-in {
      from {
        opacity: 0;
      }
    }
  }
</style>
