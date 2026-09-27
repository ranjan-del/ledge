<script module lang="ts">
  /** A task an item can be linked to, as the picker offers it. */
  export interface TaskChoice {
    id: string;
    title: string;
  }

  /** A day, or Anytime, an item can be moved to. */
  export interface SlotChoice {
    slot: string;
    label: string;
  }
</script>

<script lang="ts">
  /**
   * One line of the weekly to-do: a reminder, not a task step. It reads as the tick, the words,
   * and the task it points at when it points at one. Everything else it can do (move to another
   * day, link or unlink a task, delete) is behind one quiet button, so a week of items stays a
   * list you can read rather than a toolbar.
   *
   * The words are a button: pressing it, or Enter on it, turns them into the same in-place
   * editor the task detail uses. Escape closes the tools and the editor alike.
   */
  import type { WeekItem } from '../lib/week.ts';
  import type { WeekItemPatch } from '../lib/week-view.ts';
  import ConfirmButton from './ConfirmButton.svelte';
  import FieldEdit from './FieldEdit.svelte';

  interface Props {
    item: WeekItem;
    /** Where the item is now, so the move menu can leave it out. */
    slot: string;
    /** Every place it could be moved to in this week. */
    slots: SlotChoice[];
    /** Tasks it can be linked to. */
    tasks: TaskChoice[];
    /** The linked task's title, or undefined when that task is not on the desk. */
    taskTitle?: string;
    onupdate: (patch: WeekItemPatch) => unknown;
    onmove: (to: string) => unknown;
    onremove: () => unknown;
    onopentask?: (id: string) => void;
  }

  let { item, slot, slots, tasks, taskTitle, onupdate, onmove, onremove, onopentask }: Props =
    $props();

  let editing = $state(false);
  let tools = $state(false);
  let error = $state<string | null>(null);

  const others = $derived(slots.filter((s) => s.slot !== slot));
  const linkable = $derived(
    item.taskId && !tasks.some((t) => t.id === item.taskId)
      ? [...tasks, { id: item.taskId, title: item.taskId }]
      : tasks,
  );

  function errorOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  /** Runs an edit and keeps its refusal on this row, where the person was looking. */
  function attempt(run: () => unknown) {
    error = null;
    void Promise.resolve()
      .then(run)
      .catch((e: unknown) => (error = errorOf(e)));
  }

  async function commit(text: string) {
    if (text.trim() === item.text) {
      editing = false;
      return;
    }
    try {
      await onupdate({ text });
      error = null;
      editing = false;
    } catch (e) {
      error = errorOf(e);
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !tools) return;
    event.preventDefault();
    event.stopPropagation();
    tools = false;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li class="item" class:ticked={item.done} {onkeydown}>
  {#if editing}
    <FieldEdit
      value={item.text}
      label={`Edit: ${item.text}`}
      {error}
      oncommit={commit}
      oncancel={() => {
        editing = false;
        error = null;
      }}
    />
  {:else}
    <div class="line">
      <input
        type="checkbox"
        class="tick"
        checked={item.done}
        aria-label={item.done ? `Untick: ${item.text}` : `Tick: ${item.text}`}
        onchange={(e) => {
          const done = e.currentTarget.checked;
          attempt(() => onupdate({ done }));
        }}
      />
      <button
        type="button"
        class="text motion"
        title="Edit the text"
        onclick={() => (editing = true)}
      >
        {item.text}
      </button>
      {#if item.taskId}
        <button
          type="button"
          class="chip neutral link motion"
          disabled={taskTitle === undefined || !onopentask}
          title={taskTitle === undefined ? 'That task is not on the desk' : 'Open the task'}
          onclick={() => item.taskId && onopentask?.(item.taskId)}
        >
          <span class="trunc">{taskTitle ?? item.taskId}</span>
        </button>
      {/if}
      <button
        type="button"
        class="drop more motion"
        aria-expanded={tools}
        aria-label={`More for: ${item.text}`}
        onclick={() => (tools = !tools)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="2.5" cy="6" r="1.1" fill="currentColor" />
          <circle cx="6" cy="6" r="1.1" fill="currentColor" />
          <circle cx="9.5" cy="6" r="1.1" fill="currentColor" />
        </svg>
      </button>
    </div>
    {#if error}
      <p class="edit-error row-error" role="alert">{error}</p>
    {/if}
    {#if tools}
      <div class="tools">
        <label>
          <span>Move to</span>
          <select
            class="field"
            aria-label={`Move: ${item.text}`}
            value=""
            onchange={(e) => {
              const to = e.currentTarget.value;
              if (to) {
                tools = false;
                attempt(() => onmove(to));
              }
            }}
          >
            <option value="" disabled>Choose a day</option>
            {#each others as choice (choice.slot)}
              <option value={choice.slot}>{choice.label}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Task</span>
          <select
            class="field"
            aria-label={`Task for: ${item.text}`}
            value={item.taskId ?? ''}
            onchange={(e) => {
              const id = e.currentTarget.value;
              attempt(() => onupdate({ taskId: id === '' ? undefined : id }));
            }}
          >
            <option value="">No task</option>
            {#each linkable as task (task.id)}
              <option value={task.id}>{task.title}</option>
            {/each}
          </select>
        </label>
        <ConfirmButton
          label="Delete"
          question="Delete this item?"
          confirmLabel="Delete"
          groupLabel={`Confirm deleting: ${item.text}`}
          onconfirm={() => attempt(onremove)}
        />
      </div>
    {/if}
  {/if}
</li>

<style>
  .item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    padding: 3px var(--space-1) 3px var(--space-2);
    border-radius: var(--radius-sm);
  }
  .line:hover {
    background: var(--surface);
  }
  .tick {
    flex: none;
    margin: 3px 0 0;
    accent-color: var(--done-fill);
  }
  .text {
    flex: 1;
    min-width: 0;
    padding: 0;
    text-align: left;
    font-size: var(--fs-base);
    line-height: 1.35;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .ticked .text {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .link {
    flex: none;
    max-width: 120px;
    margin-top: 1px;
  }
  .link:hover:not(:disabled) {
    color: var(--accent);
  }
  .link:disabled {
    cursor: default;
  }
  .more {
    width: 20px;
    height: 20px;
    opacity: 0.6;
  }
  .line:hover .more,
  .more:focus-visible,
  .more[aria-expanded="true"] {
    opacity: 1;
  }
  .row-error {
    padding-left: 26px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-1) 26px;
  }
  .tools label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
  }
  .tools select {
    max-width: 150px;
    font-size: var(--fs-sm);
  }
</style>
