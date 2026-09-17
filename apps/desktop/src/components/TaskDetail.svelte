<script lang="ts">
  /**
   * The whole of one task, inside the panel, and it opens with the facts rather than with
   * prose. The block under the title is everything the git scan and the file itself already
   * know and nobody has to read a paragraph to find: where the repository is, whether it is up
   * to date with its remote, how much is uncommitted, how far ahead and behind the branch is,
   * which branch that is, the day it is planned for and the day it was created. Every row is
   * quoted from the scan or from the frontmatter; a row whose source is silent is left out
   * rather than filled in.
   *
   * Under the facts sit the three bodies of text, each behind its own disclosure and all of
   * them closed: Requirement, what has to be true; Plan, what was decided about it; Today's
   * work, the note written today. They are closed because the owner reads them when the owner
   * wants to, and because the thing this view is opened for is the checklist under them.
   *
   * The checklist is grouped into remaining and done with a count on each, and shows the next
   * three outstanding items with the rest one press away, so a task with thirty open items is
   * still a screen you can use. Ticking an item serializes the whole task with that item
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
  import { paragraphs } from '../lib/prose.ts';
  import { dayLabel, daysBetween, lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import Progress from './Progress.svelte';

  /** Outstanding items shown before the rest are folded behind one line. */
  const OPEN_SHOWN = 3;

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
  /* Every body of text starts closed. The owner's rule for this view: if I want I will read it. */
  let open = $state({ requirement: false, plan: false, today: false, earlier: false });
  /* The rest of the outstanding items, once they have been asked for. */
  let allItems = $state(false);
  /* The index the person just clicked, so the strike-through animation plays exactly once,
     where they clicked it, and never again when the file comes back from the watcher. */
  let ticked = $state<number | null>(null);
  let settle: ReturnType<typeof setTimeout> | null = null;

  /* Both lists keep the index into task.checklist, since that is what a toggle writes back. */
  const numbered = $derived(task.checklist.map((item, index) => ({ item, index })));
  const remaining = $derived(numbered.filter((e) => !e.item.done));
  const finished = $derived(numbered.filter((e) => e.item.done));
  const shownRemaining = $derived(allItems ? remaining : remaining.slice(0, OPEN_SHOWN));
  const moreRemaining = $derived(Math.max(0, remaining.length - shownRemaining.length));
  const lastSession = $derived(task.sessions[task.sessions.length - 1]);
  /* Built as one string: a template with a block in it leaves a space before the comma. */
  const sessionLine = $derived(
    `${task.sessions.length} session${task.sessions.length === 1 ? '' : 's'}` +
      (lastSession ? `, last ${lastSession}` : ''),
  );
  /** The note written today, which is what "today's work" means and all it means. */
  const todayNote = $derived(task.notes.find((n) => n.date === day));
  /** Every other dated note, newest first. On screen the newest is the one you need first. */
  const earlier = $derived([...task.notes].reverse().filter((n) => n.date !== day));
  /* Whatever the file holds that is not a section Ledge knows about, kept and shown. */
  const rest = $derived(task.extra);
  const behind = $derived(task.planned ? daysBetween(task.planned, day) : undefined);

  /**
   * Where the branch stands against its remote, in the words the scan can support. A branch
   * with no upstream is not "behind": it has nowhere to be behind, and saying so is the honest
   * answer. Undefined when the repository has not been scanned, so the row is left out rather
   * than guessed at.
   */
  const remoteLine = $derived.by(() => {
    if (!status) return undefined;
    if (!status.upstream) return 'no remote branch';
    if (status.ahead === 0 && status.behind === 0) return `up to date with ${status.upstream}`;
    return `out of step with ${status.upstream}`;
  });

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
    </div>
    {#if task.parked}
      <p class="quiet parked">Parked: {task.parked}</p>
    {/if}
  </header>

  <!--
    The facts, first, because they are what the view is opened to check and none of them takes
    a sentence to say. Nothing here is computed from anything but the last git scan and the
    task's own frontmatter.
  -->
  <dl class="facts selectable">
    {#if task.repo}
      <div class="fact">
        <dt>Repository</dt>
        <dd class="path mono">{task.repo}</dd>
      </div>
    {/if}
    {#if status}
      <div class="fact">
        <dt>Branch</dt>
        <dd class="mono">{status.branch}</dd>
      </div>
      <div class="fact">
        <dt>Remote</dt>
        <dd class:warn={status.upstream === undefined}>{remoteLine}</dd>
      </div>
      <div class="fact">
        <dt>Ahead</dt>
        <dd class:warn={status.ahead > 0}>
          {status.ahead} {status.ahead === 1 ? 'commit' : 'commits'} not pushed
        </dd>
      </div>
      <div class="fact">
        <dt>Behind</dt>
        <dd>{status.behind} {status.behind === 1 ? 'commit' : 'commits'} to pull</dd>
      </div>
      <div class="fact">
        <dt>Uncommitted</dt>
        <dd class:warn={status.dirty.length > 0}>
          {status.dirty.length} {status.dirty.length === 1 ? 'change' : 'changes'}
        </dd>
      </div>
    {:else if task.repo}
      <div class="fact">
        <dt>Git</dt>
        <dd class="faint">not scanned yet</dd>
      </div>
    {/if}
    {#if task.planned}
      <div class="fact">
        <dt>Planned</dt>
        <dd>
          {dayLabel(task.planned, day)}
          {#if behind !== undefined && behind > 0}<span class="faint">
              ({lateLabel(task.planned, day)})
            </span>{/if}
        </dd>
      </div>
    {/if}
    <div class="fact">
      <dt>Created</dt>
      <dd>{dayLabel(task.created.slice(0, 10), day)}</dd>
    </div>
  </dl>

  <div class="folds">
    <section class="fold">
      <h3>
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.requirement}
          aria-controls="fold-requirement"
          onclick={() => (open.requirement = !open.requirement)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.requirement}
            aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Requirement
        </button>
      </h3>
      <div class="fold-body" id="fold-requirement" hidden={!open.requirement}>
        {#if task.requirement}
          {#each paragraphs(task.requirement) as para, i (i)}
            <p class="prose selectable">{para}</p>
          {/each}
        {:else}
          <p class="quiet faint">No requirement written.</p>
        {/if}
      </div>
    </section>

    <section class="fold">
      <h3>
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.plan}
          aria-controls="fold-plan"
          onclick={() => (open.plan = !open.plan)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.plan} aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Plan
          {#if task.plan.length > 0}<span class="count">{task.plan.length} steps</span>{/if}
        </button>
      </h3>
      <div class="fold-body" id="fold-plan" hidden={!open.plan}>
        {#if task.plan.length > 0}
          <ol class="plan-list selectable">
            {#each task.plan as step, i (i)}
              <li>{step}</li>
            {/each}
          </ol>
        {:else}
          <p class="quiet faint">No plan written.</p>
        {/if}
      </div>
    </section>

    <section class="fold">
      <h3>
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.today}
          aria-controls="fold-today"
          onclick={() => (open.today = !open.today)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.today} aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Today's work
        </button>
      </h3>
      <div class="fold-body" id="fold-today" hidden={!open.today}>
        {#if todayNote}
          {#each paragraphs(todayNote.body) as para, i (i)}
            <p class="note-text selectable">{para}</p>
          {/each}
        {:else}
          <p class="quiet faint">No note written today.</p>
        {/if}
      </div>
    </section>

    {#if earlier.length > 0}
      <section class="fold">
        <h3>
          <button
            type="button"
            class="fold-head motion"
            aria-expanded={open.earlier}
            aria-controls="fold-earlier"
            onclick={() => (open.earlier = !open.earlier)}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.earlier}
              aria-hidden="true">
              <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Earlier notes
            <span class="count">{earlier.length}</span>
          </button>
        </h3>
        <div class="fold-body notes" id="fold-earlier" hidden={!open.earlier}>
          {#each earlier as note, i (note.date + i)}
            <article class="note-card">
              <p class="note-date">
                {dayLabel(note.date, day)}
                {#if i === 0 && earlier.length > 1}<span>latest</span>{/if}
              </p>
              {#each paragraphs(note.body) as para, p (p)}
                <p class="note-text selectable">{para}</p>
              {/each}
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  {#if task.checklist.length > 0}
    <section>
      <h3 class="block-head">Checklist</h3>
      <Progress done={finished.length} total={task.checklist.length} />
      {#if remaining.length > 0}
        <p class="group">Remaining <span>{remaining.length}</span></p>
        <ul class="checklist">
          {#each shownRemaining as entry (entry.index)}
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
        {#if moreRemaining > 0 || allItems}
          <!-- The quiet line that says how many more there are is also the way to them, so
               nothing is hidden behind a number you cannot act on. -->
          <button type="button" class="more-items motion" onclick={() => (allItems = !allItems)}>
            {allItems ? 'Show the next three only' : `and ${moreRemaining} more outstanding`}
          </button>
        {/if}
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
  .parked {
    margin-top: var(--space-2);
  }

  /*
    The facts. A two column list rather than a row of chips, because these are values a person
    reads down and compares, and because the repository path has to be able to take a whole
    line to itself at 320 px without pushing anything off the edge.
  */
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-size: var(--fs-sm);
  }
  .fact {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .fact dt {
    flex: none;
    /* Wide enough for the longest label there is, UNCOMMITTED, so no label is ever clipped
       into the value beside it and every value in the block starts on the same line. */
    width: 88px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .fact dd {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .fact dd.path {
    line-height: 1.35;
  }
  .fact dd.faint,
  .fact .faint {
    color: var(--text-faint);
  }
  /* The two states work can be lost to, and the branch with nowhere to push to. Words carry
     the meaning; this only makes them the darker line in the block. */
  .fact dd.warn {
    color: var(--attention-fg);
    font-weight: 600;
  }

  /* The three bodies of text, each closed until it is asked for. */
  .folds {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fold h3 {
    margin: 0;
  }
  .fold-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .fold-head:hover {
    background: var(--surface);
    color: var(--text);
  }
  .fold-head svg {
    flex: none;
    color: var(--text-faint);
  }
  .fold-head svg.turn {
    transform: rotate(90deg);
  }
  .fold-head .count {
    margin-left: auto;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .fold-body {
    padding: var(--space-1) var(--space-2) var(--space-2) 25px;
  }
  .fold-body.notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  @media (prefers-reduced-motion: no-preference) {
    .fold-head svg {
      transition: transform 140ms ease;
    }
  }

  .prose {
    margin: 0;
    line-height: var(--lh-prose);
    overflow-wrap: break-word;
  }
  .prose + .prose {
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
  /* A count, and the way to what it counts. Quiet, because most of the time the answer to
     "how many more" is all anybody wanted. */
  .more-items {
    align-self: flex-start;
    margin-top: var(--space-1);
    padding: 2px var(--space-2) 2px 0;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .more-items:hover {
    color: var(--accent);
  }

  /* Notes are the session memory. They get prose measure, prose leading and a real date
     line, not a grey footnote at the bottom of the screen. */
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
