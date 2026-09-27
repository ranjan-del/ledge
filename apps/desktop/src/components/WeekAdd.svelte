<script lang="ts">
  /**
   * Adding to the week, in one interaction: type, press Enter. The field stays open afterwards,
   * because reminders arrive in groups. Opened on demand, Escape (or leaving it empty) closes it;
   * `persistent` is the always-visible row at the top of the To-do view, which never closes.
   * The task picker beside it is optional; left on `No task`, the item is only words.
   */
  import type { TaskChoice } from './WeekItemRow.svelte';

  interface Props {
    /** Read aloud and shown as the placeholder: `Add to Wednesday`. */
    label: string;
    tasks: TaskChoice[];
    onadd: (text: string, taskId?: string) => unknown;
    onclose?: () => void;
    /** Always shown: no focus on mount, and Escape or blur only clear the error. */
    persistent?: boolean;
  }

  let { label, tasks, onadd, onclose, persistent = false }: Props = $props();

  let text = $state('');
  let taskId = $state('');
  let busy = $state(false);
  let error = $state('');
  let field = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!persistent) field?.focus();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '' || busy) return;
    busy = true;
    error = '';
    try {
      await onadd(trimmed, taskId === '' ? undefined : taskId);
      text = '';
      taskId = '';
      field?.focus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (persistent) field?.blur();
    else onclose?.();
  }

  /* Walking away from an empty field is the same as Escape. A half-typed one stays. */
  function onfocusout(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    if (!persistent && text.trim() === '') onclose?.();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="week-add" bind:this={root} onsubmit={submit} {onkeydown} {onfocusout}>
  <div class="line">
    <input
      class="field"
      bind:this={field}
      bind:value={text}
      type="text"
      placeholder={label}
      aria-label={label}
      autocomplete="off"
      spellcheck="false"
    />
    {#if tasks.length > 0}
      <select class="field pick" bind:value={taskId} aria-label="Link a task" title="Link a task">
        <option value="">No task</option>
        {#each tasks as task (task.id)}
          <option value={task.id}>{task.title}</option>
        {/each}
      </select>
    {/if}
  </div>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else}
    <p class="tip">Enter adds it. Escape closes.</p>
  {/if}
</form>

<style>
  .week-add {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 var(--space-1) var(--space-1);
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .line .field {
    flex: 1;
    font-size: var(--fs-sm);
  }
  .line .pick {
    flex: 0 1 110px;
    max-width: 110px;
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
