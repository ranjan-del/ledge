<script lang="ts">
  /**
   * Adding a task from the home view, in one interaction. It exists because until now the only
   * way to put work on the desk was to open Claude Code and type a slash command, which is a
   * strange thing to require of a panel whose whole job is to hold your work.
   *
   * Closed, it is a single row. Clicking or focusing it turns that row into a text field:
   * Enter submits, Escape closes and clears, and a title on its own is enough. The two things
   * that are sometimes worth saying (which repository, which day) sit behind a "more" toggle,
   * so the common case stays one field and one key. The field stays open after a submit, since
   * tasks arrive in groups; Escape is how you say you are finished.
   *
   * One component serves both lists: `status` decides whether the task joins Current or goes
   * straight to the Backlog, and the words change with it so the row says which list it is
   * adding to. The Pending tab has none of this, because those rows are computed from git.
   */
  import { untrack } from 'svelte';
  import type { NewTask } from '../lib/store.svelte.ts';

  interface Props {
    /** Creates the task. Whatever it returns is ignored; a rejection becomes the error line. */
    onadd: (input: NewTask) => unknown;
    /** Which list the new task joins. */
    status?: 'current' | 'backlog';
    /** Pre-fills the repository field, e.g. the repo of the task you were last in. */
    defaultRepo?: string;
    /** Start expanded. The empty home view uses this so the field is already there. */
    open?: boolean;
  }

  let { onadd, status = 'current', defaultRepo = '', open = false }: Props = $props();

  const backlog = $derived(status === 'backlog');
  const label = $derived(backlog ? 'Add to the backlog' : 'Add a task');

  /* `open` and `defaultRepo` seed this row once. untrack says so out loud: a later change to
     either must not reach in and retype what someone is in the middle of writing. */
  let expanded = $state(untrack(() => open));
  let more = $state(false);
  let title = $state('');
  let repo = $state(untrack(() => defaultRepo));
  let planned = $state('');
  let busy = $state(false);
  let error = $state('');
  let field = $state<HTMLInputElement | null>(null);

  /* Focus follows the field into existence, so the one interaction really is one interaction. */
  $effect(() => {
    if (expanded && field) field.focus();
  });

  function reset(close: boolean) {
    title = '';
    planned = '';
    repo = defaultRepo;
    more = false;
    error = '';
    if (close) expanded = false;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;
    busy = true;
    error = '';
    try {
      const chosen = planned || undefined;
      await onadd({ title: trimmed, status, repo: repo.trim() || undefined, planned: chosen });
      reset(false);
      field?.focus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    reset(true);
  }
</script>

{#if !expanded}
  <button type="button" class="open motion" onclick={() => (expanded = true)}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" />
    </svg>
    {label}
  </button>
{:else}
  <!-- A form is interactive by definition, and Escape has to work from any field in it,
       not only from the one the handler happens to be attached to. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form class="add" onsubmit={submit} onkeydown={onKeydown}>
    <div class="line">
      <input
        class="field"
        bind:this={field}
        bind:value={title}
        type="text"
        placeholder={backlog ? 'What should wait for later?' : 'What needs doing?'}
        aria-label="Task title"
        autocomplete="off"
        spellcheck="false"
      />
      <button
        type="button"
        class="more"
        aria-expanded={more}
        aria-label="More fields: repository and planned day"
        title="Repository and planned day"
        onclick={() => (more = !more)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button type="submit" class="btn primary" disabled={title.trim() === '' || busy}>Add</button>
    </div>
    {#if more}
      <div class="fields">
        <label>
          <span>Repository</span>
          <input class="field" type="text" bind:value={repo} placeholder="~/code/app"
            autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span>Planned</span>
          <input class="field" type="date" bind:value={planned} min="2000-01-01" />
        </label>
      </div>
    {/if}
    {#if error}
      <p class="error">{error}</p>
    {:else}
      <p class="tip">
        Enter {backlog ? 'parks it' : 'adds it'}. Escape closes. A title is enough.
      </p>
    {/if}
  </form>
{/if}

<style>
  .open {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 7px var(--space-3);
    border: 1px dashed var(--field-border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--fs-base);
    font-weight: 500;
    text-align: left;
  }
  .open:hover {
    background: var(--surface);
    color: var(--text);
    border-style: solid;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .line .field {
    flex: 1;
  }
  .more {
    flex: none;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .more:hover,
  .more[aria-expanded="true"] {
    background: var(--control);
    color: var(--text);
  }
  .more[aria-expanded="true"] svg {
    transform: rotate(180deg);
  }
  .fields {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .fields label {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .fields .field {
    width: 100%;
    font-size: var(--fs-sm);
  }
  .tip,
  .error {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .error {
    color: var(--danger);
  }
</style>
