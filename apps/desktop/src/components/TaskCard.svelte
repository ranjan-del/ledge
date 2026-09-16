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
   * it is, and the single most useful line on the whole surface: the next action, taken from
   * the file and labelled with where it was taken from. Everything else, including the note
   * that says where the task stands, is behind the disclosure, closed by default.
   *
   * It replaces a row that put three checklist items and half a note on the surface of every
   * card, which buried the project under the step. The rule this card follows is that the
   * closed state answers "which project, what state, what next" and nothing more.
   *
   * No claim here is invented. The state pill and the next action are derived in lib/derive.ts,
   * the git chips come from the last scan, and the agent chip appears only for a task that
   * genuinely has Claude Code session ids recorded against it.
   */
  import { nextActionFor, type RepoStatus } from '@ledge/core/pure';
  import { progressOf, taskState } from '../lib/derive.ts';
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
    /** Opens the full task view. */
    onselect: (task: Task) => void;
  }

  let { task, status, day = todayIso(), open = false, actions = [], onselect }: Props = $props();

  /* `open` seeds this once. untrack says so out loud: a card that reopened itself whenever its
     props changed would fight the person who just closed it. */
  let expanded = $state(untrack(() => open));
  let menuOpen = $state(false);

  const pill = $derived(taskState(task, day));
  /* Only two states get a colour of their own, and both are chips ui.css already defines:
     the green live chip for work in hand, the blue one for work that has started. Everything
     else is neutral, so this component owns no chip colours of its own. */
  const tone = $derived(
    pill.id === 'working' ? 'live' : pill.id === 'progress' ? 'info' : 'neutral',
  );
  const next = $derived(nextActionFor(task));
  const progress = $derived(progressOf(task));
  const repoName = $derived(task.repo ? basename(task.repo) : '');
  const late = $derived(task.planned !== undefined ? lateLabel(task.planned, day) : '');
  const sessions = $derived(task.sessions.length);

  function pick(action: CardAction) {
    menuOpen = false;
    action.run(task);
  }

  /** Escape closes the menu from anywhere inside it, so it is never a trap on a hidden panel. */
  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    menuOpen = false;
  }
</script>

<article class="card task" class:late={late !== ''} data-id={task.id}>
  <div class="face">
  <div class="top">
    <span class="glyph {pill.id}" aria-hidden="true"></span>
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
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More actions for {task.title}"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
          <circle cx="2" cy="2" r="1.4" fill="currentColor" />
          <circle cx="7" cy="2" r="1.4" fill="currentColor" />
          <circle cx="12" cy="2" r="1.4" fill="currentColor" />
        </svg>
      </button>
    {/if}
  </div>

  {#if menuOpen}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="menu" role="menu" tabindex="-1" onkeydown={onMenuKeydown}>
      {#each actions as action (action.label)}
        <button type="button" role="menuitem" class="menu-item motion" class:danger={action.danger}
          onclick={() => pick(action)}>{action.label}</button>
      {/each}
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

  {#if next}
    <p class="next">
      <span class="next-label">Next</span>
      <span class="next-text">{next.text}</span>
      <span class="next-source">
        from the {next.source === 'checklist' ? 'checklist' : 'plan'}
      </span>
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

<style>
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
  .menu {
    align-self: flex-end;
    display: flex;
    flex-direction: column;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--control-active);
    border: 1px solid var(--surface-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
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

  /* The next action. One line, labelled, with its source spelled out so nobody can mistake
     it for the panel's opinion about what you should do. */
  .next {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) 6px;
    margin: 2px 0 0;
    font-size: var(--fs-sm);
    line-height: 1.35;
  }
  .next-label {
    flex: none;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .next-text {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .next-source {
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
