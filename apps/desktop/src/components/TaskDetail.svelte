<script lang="ts">
  /**
   * The whole of one task, inside the panel. Requirement says what has to be true, Plan says
   * what you decided to do about it, the Checklist tracks it, and Notes carry the reasoning
   * between sessions. Contract section 2 added the last two, and they are the reason this view
   * was rebuilt: the plan used to arrive as an unparsed blob of leftover Markdown, and the
   * notes as a grey pre block under the heading "Notes", which is the wrong weight for the most
   * valuable text on the screen. Notes are now newest first, dated, and set as prose.
   *
   * The checklist is grouped into remaining and done with a count on each, so "what is left"
   * is one glance rather than a scan. Ticking an item serializes the whole task with that item
   * flipped and hands the Markdown to `onsave(file, markdown)`; the store writes it and the
   * watcher confirms; the item strikes through and settles so the change is felt rather than
   * merely reported. `home` is what a `~` in `repo` stands for, so the file keeps the short
   * form it was written with.
   *
   * Actions: Resume or Open in Claude, Park, Mark done, Open folder, and Delete. Delete is the
   * only one that cannot be undone, so it asks in place: the button becomes the question and
   * two answers, and nothing is destroyed until the second press. There is no `confirm()`
   * dialog, because a native modal on a panel that hides when it loses focus is a trap.
   */
  import { serializeTask, type RepoStatus, type Task } from '@ledge/core/pure';
  import { reducedMotion } from '../lib/motion.svelte.ts';
  import { basename } from '../lib/paths.ts';
  import { dayLabel, daysBetween, lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import GitChips from './GitChips.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    task: Task;
    status?: RepoStatus;
    /** The user's home folder; an empty string writes every path in full. */
    home?: string;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    onback: () => void;
    onsave: (file: string, markdown: string) => void;
    onpark?: (task: Task, reason: string) => void;
    ondone?: (task: Task) => void;
    onresume?: (task: Task, resume: boolean) => void;
    onopenfolder?: (task: Task) => void;
    /** Deletes the task and its file for good. Asked twice before it is called. */
    ondelete?: (task: Task) => void;
  }

  let {
    task,
    status,
    home = '',
    day = todayIso(),
    onback,
    onsave,
    onpark,
    ondone,
    onresume,
    onopenfolder,
    ondelete,
  }: Props = $props();

  let parking = $state(false);
  let reason = $state('');
  let confirmingDelete = $state(false);
  /* The index the person just clicked, so the strike-through animation plays exactly once,
     where they clicked it, and never again when the file comes back from the watcher. */
  let ticked = $state<number | null>(null);
  let settle: ReturnType<typeof setTimeout> | null = null;

  /* Both lists keep the index into task.checklist, since that is what a toggle writes back. */
  const numbered = $derived(task.checklist.map((item, index) => ({ item, index })));
  const remaining = $derived(numbered.filter((e) => !e.item.done));
  const finished = $derived(numbered.filter((e) => e.item.done));
  const lastSession = $derived(task.sessions[task.sessions.length - 1]);
  /* Built as one string: a template with a block in it leaves a space before the comma. */
  const sessionLine = $derived(
    `${task.sessions.length} session${task.sessions.length === 1 ? '' : 's'}` +
      (lastSession ? `, last ${lastSession}` : ''),
  );
  /** Notes are stored oldest last; on screen the newest is the one you need first. */
  const notes = $derived([...task.notes].reverse());
  /* Whatever the file holds that is not a section Ledge knows about, kept and shown. */
  const rest = $derived(task.extra);
  const behind = $derived(task.planned ? daysBetween(task.planned, day) : undefined);

  /**
   * Markdown prose from a file is hard-wrapped by whoever wrote it, and `white-space: pre-wrap`
   * turns those wraps into breaks in the middle of sentences. This rejoins each paragraph so it
   * reflows at the panel's width, keeping blank lines as paragraph breaks and keeping the line
   * break before a list item, a quote or a heading, which are the only lines that mean it.
   */
  function paragraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((block) =>
        block
          .split('\n')
          .reduce<string[]>((lines, raw) => {
            const line = raw.trim();
            if (lines.length === 0 || /^([-*+]|\d+[.)]|>|#)/.test(line)) lines.push(line);
            else lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`.trim();
            return lines;
          }, [])
          .join('\n')
          .trim(),
      )
      .filter((block) => block !== '');
  }

  function toggle(index: number, done: boolean) {
    if (done && !reducedMotion()) {
      ticked = index;
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        ticked = null;
      }, 320);
    }
    const checklist = task.checklist.map((item, i) => (i === index ? { ...item, done } : item));
    onsave(task.file, serializeTask({ ...task, checklist }, { home }));
  }

  /** Cancels the delete question from the keyboard, so Escape always means "no". */
  function onConfirmKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    confirmingDelete = false;
  }

  function submitPark() {
    if (!onpark) return;
    onpark(task, reason.trim() || 'Parked from the panel');
    parking = false;
    reason = '';
  }
</script>

<section class="detail" aria-labelledby="detail-title">
  <button type="button" class="back" onclick={onback}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    Back
  </button>

  <header>
    <h2 id="detail-title" class="title selectable">{task.title}</h2>
    <div class="meta">
      <span class="chip neutral">{task.status}</span>
      {#if task.planned && behind !== undefined && behind > 0}
        <span class="chip late">{lateLabel(task.planned, day)}</span>
      {:else if task.planned}
        <span class="chip neutral">planned {dayLabel(task.planned, day)}</span>
      {/if}
      {#if task.repo}
        <span class="repo trunc" title={task.repo}>{basename(task.repo)}</span>
      {/if}
      <GitChips repo={task.repo} {status} branch />
    </div>
    {#if task.parked}
      <p class="quiet parked">Parked: {task.parked}</p>
    {/if}
  </header>

  {#if task.requirement}
    <section>
      <h3 class="block-head">Requirement</h3>
      {#each paragraphs(task.requirement) as para, i (i)}
        <p class="prose selectable">{para}</p>
      {/each}
    </section>
  {/if}

  {#if task.plan.length > 0}
    <section>
      <h3 class="block-head">Plan<span class="count">{task.plan.length} steps</span></h3>
      <ol class="plan-list selectable">
        {#each task.plan as step, i (i)}
          <li>{step}</li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if task.checklist.length > 0}
    <section>
      <h3 class="block-head">Checklist</h3>
      <Progress done={finished.length} total={task.checklist.length} />
      {#if remaining.length > 0}
        <p class="group">Remaining <span>{remaining.length}</span></p>
        <ul class="checklist">
          {#each remaining as entry (entry.index)}
            <li class:settling={ticked === entry.index}>
              <label class="motion">
                <input
                  type="checkbox"
                  checked={false}
                  onchange={(e) => toggle(entry.index, e.currentTarget.checked)}
                />
                <span>{entry.item.text}</span>
              </label>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet ticked-all">Everything is ticked.</p>
      {/if}
      {#if finished.length > 0}
        <p class="group">Done <span>{finished.length}</span></p>
        <ul class="checklist">
          {#each finished as entry (entry.index)}
            <li class="ticked" class:settling={ticked === entry.index}>
              <label class="motion">
                <input
                  type="checkbox"
                  checked={true}
                  onchange={(e) => toggle(entry.index, e.currentTarget.checked)}
                />
                <span>{entry.item.text}</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if notes.length > 0}
    <section>
      <h3 class="block-head">Notes<span class="count">{notes.length}</span></h3>
      <div class="notes">
        {#each notes as note, i (note.date + i)}
          <article class="note-card">
            <p class="note-date">
              {dayLabel(note.date, day)}
              {#if i === 0 && notes.length > 1}<span>latest</span>{/if}
            </p>
            {#each paragraphs(note.body) as para, i (i)}
              <p class="note-text selectable">{para}</p>
            {/each}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if rest}
    <section>
      <h3 class="block-head">Also in the file</h3>
      <p class="quiet rest selectable">{rest}</p>
    </section>
  {/if}

  <p class="quiet faint">
    {sessionLine}
    <br />updated {relativeTime(task.updated)}
  </p>

  <div class="row-actions">
    {#if onresume}
      <button
        type="button"
        class="btn primary motion"
        onclick={() => onresume?.(task, Boolean(lastSession))}
      >
        {lastSession ? 'Resume in Claude' : 'Open in Claude'}
      </button>
    {/if}
    {#if onpark && task.status !== 'backlog'}
      <button type="button" class="btn motion" onclick={() => (parking = true)}>Park</button>
    {/if}
    {#if ondone}
      <button type="button" class="btn motion" onclick={() => ondone?.(task)}>Mark done</button>
    {/if}
    {#if onopenfolder && task.repo}
      <button type="button" class="btn motion" onclick={() => onopenfolder?.(task)}>
        Open folder
      </button>
    {/if}
    {#if ondelete}
      {#if confirmingDelete}
        <span class="confirm" role="group" aria-label="Confirm deleting this task">
          <span class="ask">Delete this task?</span>
          <button
            type="button"
            class="btn danger motion"
            onclick={() => {
              confirmingDelete = false;
              ondelete?.(task);
            }}
            onkeydown={onConfirmKeydown}
          >
            Delete
          </button>
          <button
            type="button"
            class="btn motion"
            onclick={() => (confirmingDelete = false)}
            onkeydown={onConfirmKeydown}
          >
            Cancel
          </button>
        </span>
      {:else}
        <button
          type="button"
          class="btn motion"
          title="Delete the task and its file"
          onclick={() => (confirmingDelete = true)}
        >
          Delete
        </button>
      {/if}
    {/if}
  </div>

  {#if parking}
    <form class="row-actions park" onsubmit={(e) => { e.preventDefault(); submitPark(); }}>
      <label for="park-reason" class="visually-hidden">Reason for parking</label>
      <input id="park-reason" class="field" type="text" placeholder="Why is this parked?"
        bind:value={reason} />
      <button type="submit" class="btn primary motion">Park it</button>
      <button type="button" class="btn motion" onclick={() => (parking = false)}>Cancel</button>
    </form>
  {/if}
</section>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-1);
  }
  .title {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .meta :global(.git) {
    display: contents;
  }
  .block-head .count {
    font-weight: 500;
  }
  .prose {
    margin: 0;
    line-height: var(--lh-prose);
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .prose + .prose {
    margin-top: var(--space-2);
  }
  .parked {
    margin-top: var(--space-2);
  }

  .group {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .group span {
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .checklist label {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    line-height: 1.35;
  }
  .checklist label:hover {
    background: var(--surface-hover);
  }
  .checklist input {
    margin: 2px 0 0;
    accent-color: var(--done-fill);
  }
  .checklist li.ticked span {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .ticked-all {
    margin-top: var(--space-2);
    color: var(--done-fg);
  }

  /* Notes are the session memory. They get prose measure, prose leading and a real date
     line, not a grey footnote at the bottom of the screen. */
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .note-date {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 3px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .note-date span {
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--text-faint);
  }
  .rest {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .park .field {
    flex: 1;
    min-width: 140px;
  }
  /* The question and its two answers travel together, so the row cannot wrap the word
     "Delete" away from what it is asking about. */
  .confirm {
    display: inline-flex;
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

  @media (prefers-reduced-motion: no-preference) {
    .checklist li {
      transition: opacity 160ms ease;
    }
    .checklist li.settling {
      animation: settle 320ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .checklist li.settling span {
      /* Draws the line on rather than switching it on. */
      animation: strike 260ms ease-out both;
    }
    @keyframes settle {
      0% {
        transform: translateY(0) scale(1);
      }
      35% {
        transform: translateY(-1.5px) scale(1.012);
      }
      100% {
        transform: translateY(0) scale(1);
      }
    }
    @keyframes strike {
      from {
        color: var(--text);
        text-decoration-color: transparent;
      }
      to {
        color: var(--text-muted);
        text-decoration-color: currentColor;
      }
    }
  }
</style>
