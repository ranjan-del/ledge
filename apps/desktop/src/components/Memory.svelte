<script lang="ts">
  /**
   * MEMORY: every dated note from every task file, in one place, grouped by the day it was
   * written and newest day first. Notes are the only part of the store that carries reasoning
   * rather than state, so read across tasks they are the thing a new session would otherwise
   * have to rediscover: the decisions, the dead ends and the things already ruled out.
   *
   * It exists because a note was previously only visible inside the one task it belonged to,
   * which is the wrong shape for the question people actually ask, "why did we do it that way".
   *
   * Nothing is scored or rewritten here. A note is shown as a digest, a bold title and a short
   * summary from its task's insights or from its own first sentences, with the words as they
   * were written one press away, under its day, beside its task. The filter is `searchMemory` from core, which requires every term
   * to appear and ranks nothing, so what the field returns is predictable.
   *
   * Above the notes sits a switch, `Notes | Sessions`. Sessions was a tab of its own; it is the
   * other record of what the work left behind, so it lives here now, drawn exactly as it was.
   * The panel hands the Sessions view in as a snippet, so this component stays about notes.
   */
  import { searchMemory, type MemoryEntry, type Task } from '@ledge/core/pure';
  import { noteDigest } from '../lib/digest.ts';
  import type { TaskInsights } from '@ledge/core/pure';
  import type { Snippet } from 'svelte';
  import { dayLabel, todayIso } from '../lib/time.ts';
  import Digest from './Digest.svelte';
  import ViewSwitch, { type ViewOption } from './ViewSwitch.svelte';

  interface Props {
    /** From `memoryFor` in core: newest date first. */
    entries: MemoryEntry[];
    /** Resolves a note's task so its title can open the task itself. */
    taskFor: (taskId: string) => Task | undefined;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    onselect: (task: Task) => void;
    /** A task's insights, for the note titles. Absent means every note uses the fallback. */
    insightsFor?: (taskId: string) => TaskInsights | undefined;
    /** Notes or Sessions. Without `onmode` there is no switch, and this is the notes only. */
    mode?: 'notes' | 'sessions';
    onmode?: (mode: 'notes' | 'sessions') => void;
    /** The Sessions view, drawn when `mode` is `sessions`. */
    sessions?: Snippet;
    /** How many sessions there are, for the switch. */
    sessionCount?: number;
  }

  let {
    entries,
    taskFor,
    day = todayIso(),
    onselect,
    insightsFor,
    mode = 'notes',
    onmode,
    sessions,
    sessionCount,
  }: Props = $props();

  const modes = $derived<ViewOption[]>([
    { id: 'notes', label: 'Notes', count: entries.length },
    { id: 'sessions', label: 'Sessions', count: sessionCount },
  ]);
  const showSessions = $derived(onmode !== undefined && mode === 'sessions');

  let query = $state('');

  const found = $derived(searchMemory(entries, query));
  /* Grouping is presentation: core returns one flat list, newest date first, and this walks it
     into day blocks without reordering anything. */
  const days = $derived(
    found.reduce<{ date: string; notes: MemoryEntry[] }[]>((groups, entry) => {
      const last = groups[groups.length - 1];
      if (last && last.date === entry.date) last.notes.push(entry);
      else groups.push({ date: entry.date, notes: [entry] });
      return groups;
    }, []),
  );
</script>

{#if onmode}
  <div class="views">
    <ViewSwitch
      options={modes}
      active={mode}
      variant="segmented"
      label="Notes or sessions"
      onchange={(id) => onmode?.(id as 'notes' | 'sessions')}
    />
  </div>
{/if}

{#if showSessions}
  {@render sessions?.()}
{:else}
<div class="pane">
  {#if entries.length > 0}
    <div class="finder">
      <input
        class="field"
        type="search"
        bind:value={query}
        placeholder="Search notes"
        aria-label="Search notes"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  {/if}

  <div class="pane-scroll">
    {#if entries.length === 0}
      <div class="empty">
        <h3>No notes yet</h3>
        <p class="quiet">
          A note is written into a task file when Claude Code makes a decision, hits a dead end,
          or closes a session. Every one of them appears here, newest first, and stays
          searchable long after the task it belongs to is finished.
        </p>
      </div>
    {:else if days.length === 0}
      <p class="quiet">Nothing matches "{query}".</p>
    {:else}
      {#each days as group (group.date)}
        <section class="day">
          <h3 class="section-label">{dayLabel(group.date, day)}</h3>
          <div class="rows">
            {#each group.notes as note, i (note.taskId + i)}
              {@const task = taskFor(note.taskId)}
              <article class="note-card">
                <button
                  type="button"
                  class="who linky trunc"
                  disabled={task === undefined}
                  onclick={() => task && onselect(task)}
                >
                  {note.taskTitle}
                </button>
                <Digest
                  digest={noteDigest(note, insightsFor?.(note.taskId))}
                  original={note.body}
                />
              </article>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>
{/if}

<style>
  /* The switch sits on its own line under the tabs, as it does on TASKS. */
  .views {
    flex: none;
    padding: 0 var(--space-3) var(--space-2);
  }
  .pane-scroll {
    gap: var(--space-3);
  }
  /* The task is the label on the note, not its heading: the note is the content. */
  .who {
    max-width: 100%;
    text-align: left;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
  }
</style>
