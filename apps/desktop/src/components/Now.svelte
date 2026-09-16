<script lang="ts">
  /**
   * NOW: the surface the panel opens on, and the only one that answers "what am I doing".
   * It reads top to bottom as one sentence: who you are and what time it is, how much is on,
   * what is being worked on right now, what comes after that, and one line to add something.
   *
   * It replaces a home view whose three headings each needed reading before the first task was
   * visible. The greeting and the summary line are one line each and then get out of the way;
   * the cards below them are the content. Every block disappears when it has no answer, so the
   * surface is never padded with empty headings.
   *
   * The scroll region holds the blocks and the add row sits below it, so a task is always one
   * interaction away however far down you are. When there is nothing at all, the add row moves
   * up under the heading and that is the entire empty state.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import { onMount } from 'svelte';
  import { greeting } from '../lib/derive.ts';
  import { startStaggerWindow, staggering } from '../lib/motion.svelte.ts';
  import { basename } from '../lib/paths.ts';
  import type { NewTask } from '../lib/store.svelte.ts';
  import { todayIso } from '../lib/time.ts';
  import AddTask from './AddTask.svelte';
  import TaskCard, { type CardAction } from './TaskCard.svelte';
  import Typewriter from './Typewriter.svelte';

  interface Props {
    /** Current tasks planned for today or earlier, in priority order. */
    working: Task[];
    /** The current tasks that are not in `working`, in priority order. */
    upNext: Task[];
    /** Who to greet. An empty string greets nobody. */
    name?: string;
    /** Clauses for the thin line under the greeting, already worded and already true. */
    summary?: string[];
    /** Repositories with uncommitted or unpushed work. Zero hides the attention line. */
    attention?: number;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** Bumping this opens the add row and focuses it, which is what the ⌘N shortcut does. */
    addKey?: number;
    /** The keyboard hint shown on the add row, already spelled for this platform. */
    addShortcut?: string;
    defaultRepo?: string;
    statusFor?: (repo: string | undefined) => RepoStatus | undefined;
    actionsFor?: (task: Task) => CardAction[];
    onselect: (task: Task) => void;
    onadd: (input: NewTask) => unknown;
    onpending?: () => void;
  }

  let {
    working,
    upNext,
    name = '',
    summary = [],
    attention = 0,
    day = todayIso(),
    addKey = 0,
    addShortcut,
    defaultRepo = '',
    statusFor,
    actionsFor,
    onselect,
    onadd,
    onpending,
  }: Props = $props();

  const empty = $derived(working.length + upNext.length === 0);
  /* Read once at render rather than held in state: the panel is short-lived, and a greeting
     that re-reads the clock would be the one animation in the app nobody asked for. */
  const hello = $derived(name === '' ? greeting() : `${greeting()}, ${name}`);
  const EMPTY_LINE = 'Nothing in progress.';

  onMount(startStaggerWindow);
</script>

<div class="pane">
  <div class="pane-scroll">
    {#if empty}
      <section class="start" aria-labelledby="start-heading">
        <h2 id="start-heading" aria-label={EMPTY_LINE}><Typewriter text={EMPTY_LINE} /></h2>
        <AddTask {onadd} {defaultRepo} open hint={false} />
      </section>
    {:else}
      <div class="greet">
        <h2 class="hello">
          {hello}
          <span class="wave" aria-hidden="true">👋</span>
        </h2>
        {#if summary.length > 0}
          <p class="summary">{summary.join(' · ')}</p>
        {/if}
      </div>

      {#if working.length > 0}
        <section class="block" aria-labelledby="working-label">
          <h3 class="section-label" id="working-label">
            Currently working
            <span class="count">{working.length}</span>
          </h3>
          <div class="rows" class:enter={staggering()}>
            {#each working as task (task.file)}
              <TaskCard
                {task}
                {day}
                status={statusFor?.(task.repo)}
                actions={actionsFor?.(task) ?? []}
                {onselect}
              />
            {/each}
          </div>
        </section>
      {/if}

      {#if upNext.length > 0}
        <section class="block" aria-labelledby="next-label">
          <h3 class="section-label" id="next-label">
            Up next
            <span class="count">{upNext.length}</span>
          </h3>
          <ul class="next-list">
            {#each upNext as task (task.file)}
              <li>
                <button type="button" class="next-item motion" onclick={() => onselect(task)}>
                  <span class="box" aria-hidden="true"></span>
                  <span class="what">{task.title}</span>
                  {#if task.repo}
                    <span class="sub where trunc">{basename(task.repo)}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if attention > 0 && onpending}
        <button type="button" class="attention" onclick={() => onpending?.()}>
          <span class="dot" aria-hidden="true"></span>
          <span class="what">
            {attention}
            {attention === 1 ? 'repository has' : 'repositories have'} uncommitted or unpushed work
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
    {/if}
  </div>

  {#if !empty}
    <div class="pane-foot">
      <AddTask {onadd} {defaultRepo} shortcut={addShortcut} focusKey={addKey} />
    </div>
  {/if}
</div>

<style>
  .pane-scroll {
    gap: var(--space-4);
  }

  /* Empty state. Three things: what is true, the field, the button. Top-aligned, because a
     question centred in a tall panel reads as an error page. */
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-1);
  }
  .start h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .greet {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hello {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .wave {
    font-size: var(--fs-lg);
  }
  /* One thin line, and only clauses that are true. It is a caption, not a dashboard. */
  .summary {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-faint);
  }

  /* Up next is a list of things not started, so it is drawn as unchecked items rather than as
     cards: a card claims state, and these have none yet. */
  .next-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .next-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-base);
  }
  .next-item:hover {
    background: var(--surface-hover);
  }
  .next-item .what {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .where {
    flex: none;
    max-width: 110px;
  }

  /* The attention line is deliberately quiet: one line, no card, no count badge. */
  .attention {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .attention:hover {
    background: var(--surface);
    color: var(--text);
  }
  .attention .what {
    flex: 1;
    min-width: 0;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--attention-edge);
  }
</style>
