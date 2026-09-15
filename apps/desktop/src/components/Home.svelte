<script lang="ts">
  /**
   * The home view: the Current tab, which is what the panel opens on and therefore the only
   * screen most people will ever read. It answers three questions in the order contract
   * section 7 puts them in, and nothing else: what is on for today, what I am working on, and
   * what needs attention. Each block disappears when it has no answer, so the view is never
   * padded with empty headings.
   *
   * The list scrolls; the add row does not, so a task is always one interaction away however
   * far down you are. When there is nothing at all, the add row moves up into the empty state
   * and sits under one sentence explaining what a task actually is, because an empty panel that
   * only says "nothing here" teaches you nothing about how to fill it.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import { onMount } from 'svelte';
  import { startStaggerWindow, staggering } from '../lib/motion.svelte.ts';
  import type { NewTask } from '../lib/store.svelte.ts';
  import { todayIso } from '../lib/time.ts';
  import AddTask from './AddTask.svelte';
  import TaskRow from './TaskRow.svelte';
  import TodayBlock from './TodayBlock.svelte';
  import Typewriter from './Typewriter.svelte';

  interface Props {
    /** Current tasks in priority order, minus any already shown in the Today block. */
    current: Task[];
    today: Task[];
    overdue: Task[];
    /** How many current tasks are on today's list. Only used to explain an empty Current. */
    plannedToday?: number;
    /** Repositories with uncommitted or unpushed work. Zero hides the attention line. */
    attention?: number;
    backlog?: number;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** Where task files live, shown in the empty state as the short `~` form. */
    store?: string;
    defaultRepo?: string;
    statusFor?: (repo: string | undefined) => RepoStatus | undefined;
    onselect: (task: Task) => void;
    onadd: (input: NewTask) => unknown;
    onpending?: () => void;
    onbacklog?: () => void;
  }

  let {
    current,
    today,
    overdue,
    plannedToday = 0,
    attention = 0,
    backlog = 0,
    day = todayIso(),
    store = '~/.ledge/tasks',
    defaultRepo = '',
    statusFor,
    onselect,
    onadd,
    onpending,
    onbacklog,
  }: Props = $props();

  const empty = $derived(current.length + today.length + overdue.length === 0);
  /* Rows are numbered in the order they are shown, across blocks, so the sequence has no
     holes in it: a number that skips from 1 to 3 reads as a bug, not as a priority. */
  const shown = $derived(today.length + overdue.length);
  const EMPTY_LINE = 'Nothing in progress.';

  onMount(startStaggerWindow);
</script>

<div class="pane">
  <div class="pane-scroll">
    {#if empty}
      <section class="start" aria-labelledby="start-heading">
        <h2 id="start-heading" aria-label={EMPTY_LINE}><Typewriter text={EMPTY_LINE} /></h2>
        <p class="sentence">
          Tasks are Markdown files in <code>{store}</code>, so whatever you add here is a file
          you can edit, commit or hand to Claude Code.
        </p>
        <AddTask {onadd} {defaultRepo} open />
        {#if backlog > 0}
          <p class="quiet faint">
            <button type="button" class="link" onclick={() => onbacklog?.()}>
              {backlog} in the backlog
            </button>
            waiting to be started.
          </p>
        {/if}
        <p class="quiet faint">
          Or type <code>/ledge start "title"</code> in Claude Code and it writes the requirement
          and a first checklist for you.
        </p>
      </section>
    {:else}
      <TodayBlock {today} {overdue} {day} {statusFor} {onselect} />

      <section class="block" aria-labelledby="current-heading">
        <h2 class="block-head" id="current-heading">
          Working on
          <span class="count">{current.length + plannedToday}</span>
        </h2>
        {#if current.length > 0}
          <div class="rows" class:enter={staggering()}>
            {#each current as task, i (task.file)}
              <TaskRow
                {task}
                {day}
                rank={shown + i + 1}
                status={statusFor?.(task.repo)}
                {onselect}
              />
            {/each}
          </div>
        {:else}
          <p class="quiet">Everything you are working on is on today's list.</p>
        {/if}
      </section>

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
      <AddTask {onadd} {defaultRepo} />
    </div>
  {/if}
</div>

<style>
  /* Blocks, not rows: the home view breathes more than a plain list. */
  .pane-scroll {
    gap: var(--space-4);
  }

  /* Empty state. Top-aligned, not centred: the sentence and the field are the content. */
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-2);
  }
  .start h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .sentence {
    margin: 0;
    font-size: var(--fs-base);
    line-height: var(--lh-prose);
    color: var(--text-muted);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .faint code {
    color: inherit;
  }
  .link {
    color: var(--accent);
    font-size: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
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
