<script lang="ts">
  /**
   * What a task card shows once you open it, and nothing that belongs on the closed card. It
   * answers three questions in the order the owner asked for them: where the task stands right
   * now, what the plan was, and what is already finished.
   *
   * It exists because the card used to tip three checklist items and a truncated note straight
   * onto the surface, so a list of four tasks was forty lines of half-sentences and the project
   * they belonged to was the one thing you could not see. Everything here is the file's own
   * text: the newest dated note, the plan steps as written, and the ticked items as ticked.
   * Where the file has nothing to say, this says so rather than filling the space.
   */
  import { memoryFor, type Task } from '@ledge/core/pure';
  import { paragraphs } from '../lib/prose.ts';
  import { dayLabel, todayIso } from '../lib/time.ts';

  /** Ticked items shown in full before the rest are counted instead. */
  const DONE_SHOWN = 5;
  /**
   * Outstanding items shown before the rest are counted instead. Three, because the open card
   * is a glance at where a project stands and a checklist of thirty unticked items answers
   * that question no better than three do while costing the whole panel to scroll past. The
   * full list is one click further on, in the task itself.
   */
  const OPEN_SHOWN = 3;

  interface Props {
    task: Task;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
  }

  let { task, day = todayIso() }: Props = $props();

  /* `memoryFor` sorts newest date first, so one task's newest note is simply the first entry.
     Going through core rather than reading task.notes directly keeps one definition of which
     note is the newest. */
  const note = $derived(memoryFor([task])[0]);
  const remaining = $derived(task.checklist.filter((i) => !i.done));
  const finished = $derived(task.checklist.filter((i) => i.done));
  const shownDone = $derived(finished.slice(-DONE_SHOWN).reverse());
  const moreDone = $derived(Math.max(0, finished.length - shownDone.length));
  /* The next few, in the file's own order, so the three shown are the three that come next. */
  const shownOpen = $derived(remaining.slice(0, OPEN_SHOWN));
  const moreOpen = $derived(Math.max(0, remaining.length - shownOpen.length));
</script>

<div class="detail">
  <section>
    <h4 class="section-label">Where it stands</h4>
    {#if note}
      <p class="sub stamp">{dayLabel(note.date, day)}</p>
      {#each paragraphs(note.body) as para, i (i)}
        <p class="prose selectable">{para}</p>
      {/each}
    {:else}
      <p class="quiet faint">No note yet. Claude Code writes one when it makes a decision.</p>
    {/if}
  </section>

  <section>
    <h4 class="section-label">
      Planned steps
      {#if task.plan.length > 0}<span class="count">{task.plan.length}</span>{/if}
    </h4>
    {#if task.plan.length > 0}
      <ol class="plan-list selectable">
        {#each task.plan as step, i (i)}
          <li>{step}</li>
        {/each}
      </ol>
    {:else if remaining.length > 0}
      <p class="quiet faint">No plan written. What is next, from the checklist:</p>
      <ul class="item-list">
        {#each shownOpen as item, i (i)}
          <li><span class="box" aria-hidden="true"></span><span>{item.text}</span></li>
        {/each}
      </ul>
      {#if moreOpen > 0}
        <p class="quiet faint">and {moreOpen} more still to do</p>
      {/if}
    {:else}
      <p class="quiet faint">No plan written.</p>
    {/if}
  </section>

  <section>
    <h4 class="section-label">
      Already done
      <span class="count">{finished.length} of {task.checklist.length}</span>
    </h4>
    {#if finished.length > 0}
      <ul class="item-list">
        {#each shownDone as item, i (i)}
          <li class="ticked"><span class="tick" aria-hidden="true">✓</span><span>{item.text}</span></li>
        {/each}
      </ul>
      {#if moreDone > 0}
        <p class="quiet faint">and {moreDone} more, earlier in the checklist</p>
      {/if}
    {:else}
      <p class="quiet faint">Nothing ticked off yet.</p>
    {/if}
  </section>
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* Indented to the title, so the open card reads as one thing with a body rather than as
       a card with a second card inside it. */
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--rule);
  }
  .stamp {
    margin: 0 0 3px;
    font-weight: 700;
  }
  .prose {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: var(--lh-prose);
    color: var(--text-muted);
    overflow-wrap: break-word;
  }
  .prose + .prose {
    margin-top: var(--space-2);
  }
  .plan-list {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .tick {
    flex: none;
    width: 8px;
    font-size: 9px;
    font-weight: 700;
    color: var(--done-fg);
  }
  .ticked span:last-child {
    color: var(--text-faint);
  }
</style>
