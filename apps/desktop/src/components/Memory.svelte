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
   * Nothing is summarised, scored or rewritten here. A note is shown as it was written, under
   * its day, beside its task. The filter is `searchMemory` from core, which requires every term
   * to appear and ranks nothing, so what the field returns is predictable.
   */
  import { searchMemory, type MemoryEntry, type Task } from '@ledge/core/pure';
  import { paragraphs } from '../lib/prose.ts';
  import { dayLabel, todayIso } from '../lib/time.ts';

  interface Props {
    /** From `memoryFor` in core: newest date first. */
    entries: MemoryEntry[];
    /** Resolves a note's task so its title can open the task itself. */
    taskFor: (taskId: string) => Task | undefined;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    onselect: (task: Task) => void;
  }

  let { entries, taskFor, day = todayIso(), onselect }: Props = $props();

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
                {#each paragraphs(note.body) as para, p (p)}
                  <p class="note-text selectable">{para}</p>
                {/each}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
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
