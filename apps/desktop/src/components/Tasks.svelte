<script lang="ts">
  /**
   * TASKS: every list of work there is, behind one switch. Live is what you are carrying, Done
   * is the archive, Backlog is what you parked and why, and Pending is the repositories git says
   * have work in them that is neither committed nor pushed.
   *
   * It exists because Current, Backlog and Pending were three top-level tabs answering the same
   * question, "which task", while the surfaces that answer different questions, what is on now
   * and what has been learned, had nowhere to be. Folding the four lists into one surface is
   * what freed the top level to be NOW, SESSIONS, TASKS and MEMORY.
   *
   * Nothing was dropped in the fold: the Live and Done switch is the one that already existed,
   * Backlog keeps its add row and its Start and Open actions, and Pending is still computed from
   * the git scan and typed by nobody.
   *
   * It is also what decides where a dragged task may go. Live and Backlog are both a task's
   * `status`, so a card can move between them. Done is a status too, but marking it archives the
   * file, so the card asks before it happens rather than doing it on release. Pending is not a
   * status at all and cannot be dropped into, and this is where that refusal is worded, because
   * this is the component that knows which list is which.
   */
  import type { RepoStatus, Task } from '@ledge/core/pure';
  import {
    askShift,
    drag,
    viewRefusal,
    viewStatus,
    type ShiftTo,
  } from '../lib/drag.svelte.ts';
  import type { NewTask, TaskView } from '../lib/store.svelte.ts';
  import { todayIso } from '../lib/time.ts';
  import AddTask from './AddTask.svelte';
  import DoneList from './DoneList.svelte';
  import PendingRow from './PendingRow.svelte';
  import TaskCard, { type CardAction } from './TaskCard.svelte';
  import ViewSwitch, { type ViewOption } from './ViewSwitch.svelte';

  interface Props {
    view: TaskView;
    /** Current tasks in priority order. */
    live: Task[];
    /** Parked tasks, most recently updated first. */
    backlog: Task[];
    /** Archived tasks, newest first. Empty until the archive has been read. */
    done: Task[];
    /** Repositories from the last git scan that hold unfinished work. */
    pending: RepoStatus[];
    /** What the Done button claims before the archive has been parsed. */
    doneCount: number;
    /** The archive is being read. True only on the first switch to Done. */
    archiveLoading?: boolean;
    /** A git scan is in flight, which is why Pending may still be empty. */
    scanning?: boolean;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    statusFor?: (repo: string | undefined) => RepoStatus | undefined;
    titleForRepo?: (repo: string) => string | undefined;
    actionsFor?: (task: Task) => CardAction[];
    onview: (view: TaskView) => void;
    onselect: (task: Task) => void;
    onadd: (input: NewTask) => unknown;
    /**
     * Moves a live task from one place in the list to another. Only Live has an order a person
     * chose, so it is the only view that is given one; without this the rows are not draggable
     * and carry no grip.
     */
    onreorder?: (from: number, to: number) => void;
    /**
     * Moves a task into another list by writing `status` through the store. Without it the
     * sideways half of the drag is inert and the pills take no drops.
     */
    onshift?: (task: Task, to: ShiftTo) => void;
  }

  let {
    view,
    live,
    backlog,
    done,
    pending,
    doneCount,
    archiveLoading = false,
    scanning = false,
    day = todayIso(),
    statusFor,
    titleForRepo,
    actionsFor,
    onview,
    onselect,
    onadd,
    onreorder,
    onshift,
  }: Props = $props();

  const options = $derived<ViewOption[]>([
    { id: 'live', label: 'Live', count: live.length },
    { id: 'done', label: 'Done', count: doneCount },
    { id: 'backlog', label: 'Backlog', count: backlog.length },
    { id: 'pending', label: 'Pending', count: pending.length },
  ]);

  /** The task currently under the pointer's drag, looked up in the two lists that hold one. */
  const dragged = $derived([...live, ...backlog].find((t) => t.file === drag.file));

  /** Why a pill would turn this task away. Undefined means it takes it. */
  function refusalFor(id: string): string | undefined {
    if (!dragged) return 'Nothing is being dragged.';
    return viewRefusal(id, dragged.status);
  }

  /**
   * A drop on a pill. It goes through the same two routes the gesture does, so dropping on Done
   * asks on the card exactly as dragging right does, rather than archiving because a pill was
   * the target instead of the air.
   */
  function dropOnView(id: string) {
    const task = dragged;
    const to = viewStatus(id);
    if (!task || to === undefined) return;
    if (to === 'done') askShift(task.file, to);
    else onshift?.(task, to);
  }
</script>

<div class="views">
  <ViewSwitch
    {options}
    active={view}
    onchange={(id) => onview(id as TaskView)}
    dragFile={drag.file}
    refusalFor={onshift ? refusalFor : undefined}
    ondropview={dropOnView}
  />
</div>

{#if view === 'done'}
  <DoneList tasks={done} {day} loading={archiveLoading} />
{:else if view === 'pending'}
  <div class="pane">
    <div class="pane-scroll">
      {#each pending as status (status.repo)}
        <PendingRow {status} taskTitle={titleForRepo?.(status.repo)} />
      {:else}
        <p class="quiet">
          {scanning
            ? 'Scanning repositories'
            : 'Nothing pending. Everything is pushed and clean.'}
        </p>
      {/each}
    </div>
  </div>
{:else if view === 'backlog'}
  <div class="pane">
    <div class="pane-scroll">
      {#each backlog as task (task.file)}
        <!-- No order of its own, so no reorder and no up and down. The sideways move is all
             this list's grip does, which is why it still has one. -->
        <TaskCard
          {task}
          {day}
          status={statusFor?.(task.repo)}
          actions={actionsFor?.(task) ?? []}
          {onshift}
          {onselect}
        />
      {:else}
        <p class="quiet">Nothing parked.</p>
      {/each}
    </div>
    <div class="pane-foot">
      <AddTask status="backlog" {onadd} />
    </div>
  </div>
{:else}
  <div class="pane">
    <div class="pane-scroll">
      {#if live.length > 0}
        <!-- A real list, because the rows in it can be moved and a screen reader has to be
             told that this one has an order the person owns. -->
        <div class="rows" role="list" aria-label="Live tasks in priority order">
          {#each live as task, i (task.file)}
            <TaskCard
              {task}
              {day}
              status={statusFor?.(task.repo)}
              actions={actionsFor?.(task) ?? []}
              index={i}
              total={live.length}
              onmove={onreorder}
              {onshift}
              {onselect}
            />
          {/each}
        </div>
      {:else}
        <p class="quiet">Nothing live. Everything you have is parked or finished.</p>
      {/if}
    </div>
    <div class="pane-foot">
      <AddTask {onadd} />
    </div>
  </div>
{/if}

<style>
  /* The same step above and below, so the switch belongs to neither the tabs nor the first
     row: it is its own line, and the eye stops on it once. */
  .views {
    flex: none;
    padding: 0 var(--space-3) var(--space-2);
  }
</style>
