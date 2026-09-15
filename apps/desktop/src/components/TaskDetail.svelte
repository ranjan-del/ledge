<script lang="ts">
  /**
   * Full task view inside the panel. Checklist toggles serialize the whole task with the item
   * flipped and hand the Markdown to `onsave(file, markdown)`; the store writes it and the
   * watcher confirms. `home` is what a `~` in `repo` stands for, so the file keeps the short
   * form it was written with. Actions: Park, Mark done, Resume or Open in Claude, Open folder.
   */
  import { serializeTask, type RepoStatus, type Task } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';

  interface Props {
    task: Task;
    status?: RepoStatus;
    /** The user's home folder; an empty string writes every path in full. */
    home?: string;
    onback: () => void;
    onsave: (file: string, markdown: string) => void;
    onpark?: (task: Task, reason: string) => void;
    ondone?: (task: Task) => void;
    onresume?: (task: Task, resume: boolean) => void;
    onopenfolder?: (task: Task) => void;
  }

  let { task, status, home = '', onback, onsave, onpark, ondone, onresume, onopenfolder }: Props =
    $props();

  let parking = $state(false);
  let reason = $state('');

  const doneItems = $derived(task.checklist.filter((i) => i.done));
  const pendingItems = $derived(task.checklist.filter((i) => !i.done));
  const lastSession = $derived(task.sessions[task.sessions.length - 1]);

  function toggle(index: number, done: boolean) {
    const checklist = task.checklist.map((item, i) => (i === index ? { ...item, done } : item));
    onsave(task.file, serializeTask({ ...task, checklist }, { home }));
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
      <path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    Back
  </button>

  <header>
    <h2 id="detail-title" class="title">{task.title}</h2>
    <div class="meta">
      <span class="chip grey">{task.status}</span>
      {#if task.repo}
        <span title={task.repo}>{basename(task.repo)}</span>
      {/if}
      {#if status}
        <span class="branch">{status.branch}</span>
        {#if status.ahead > 0}<span class="chip amber">{status.ahead} unpushed</span>{/if}
        {#if status.dirty.length > 0}<span class="chip red">{status.dirty.length} dirty</span>{/if}
      {/if}
    </div>
    {#if task.parked}
      <p class="parked">Parked: {task.parked}</p>
    {/if}
  </header>

  {#if task.requirement}
    <h4>Requirement</h4>
    <p class="requirement">{task.requirement}</p>
  {/if}

  {#if task.checklist.length > 0}
    <h4>Checklist <span class="muted">{doneItems.length}/{task.checklist.length}</span></h4>
    <ul class="checklist">
      {#each task.checklist as item, i (i)}
        <li class:done={item.done}>
          <label>
            <input
              type="checkbox"
              checked={item.done}
              onchange={(e) => toggle(i, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span>{item.text}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if pendingItems.length === 0}
      <p class="muted">Everything is ticked.</p>
    {/if}
  {/if}

  {#if task.extra}
    <h4>Notes</h4>
    <pre class="extra">{task.extra}</pre>
  {/if}

  <p class="sessions muted">
    {task.sessions.length} session{task.sessions.length === 1 ? '' : 's'}
    {#if lastSession}, last {lastSession}{/if}
    <br />updated {relativeTime(task.updated)}
  </p>

  <div class="actions">
    {#if onresume}
      <button type="button" class="primary" onclick={() => onresume?.(task, Boolean(lastSession))}>
        {lastSession ? 'Resume in Claude' : 'Open in Claude'}
      </button>
    {/if}
    {#if onpark && task.status !== 'backlog'}
      <button type="button" onclick={() => (parking = true)}>Park</button>
    {/if}
    {#if ondone}
      <button type="button" onclick={() => ondone?.(task)}>Mark done</button>
    {/if}
    {#if onopenfolder && task.repo}
      <button type="button" onclick={() => onopenfolder?.(task)}>Open folder</button>
    {/if}
  </div>

  {#if parking}
    <form class="park" onsubmit={(e) => { e.preventDefault(); submitPark(); }}>
      <label for="park-reason" class="visually-hidden">Reason for parking</label>
      <input id="park-reason" type="text" placeholder="Why is this parked?" bind:value={reason} />
      <button type="submit" class="primary">Park it</button>
      <button type="button" onclick={() => (parking = false)}>Cancel</button>
    </form>
  {/if}
</section>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-1);
  }
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2) 3px var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .title {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    line-height: 1.3;
    user-select: text;
    -webkit-user-select: text;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-1);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .branch {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  h4 {
    margin: var(--space-2) 0 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .requirement,
  .extra {
    margin: 0;
    white-space: pre-wrap;
    user-select: text;
    -webkit-user-select: text;
  }
  .extra {
    font-family: inherit;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .parked {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
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
  }
  .checklist label:hover {
    background: var(--surface-hover);
  }
  .checklist input {
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  .checklist li.done span {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-sm);
    font-weight: 500;
  }
  .sessions {
    margin: var(--space-1) 0 0;
  }
  .actions,
  .park {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .actions button,
  .park button {
    padding: 5px var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--control);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .actions button:hover,
  .park button:hover {
    background: var(--control-active);
  }
  .primary {
    background: var(--accent) !important;
    color: var(--accent-text) !important;
  }
  .park input {
    flex: 1;
    min-width: 140px;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--surface-border);
    background: var(--surface);
    user-select: text;
    -webkit-user-select: text;
  }
  .chip {
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .amber { background: var(--chip-amber-bg); color: var(--chip-amber-fg); }
  .red { background: var(--chip-red-bg); color: var(--chip-red-fg); }
  .grey { background: var(--chip-grey-bg); color: var(--chip-grey-fg); }
</style>
