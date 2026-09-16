<script lang="ts">
  /**
   * SESSIONS: every Claude Code session id the task files record, newest first, each beside the
   * task it worked on. It exists so "resume where I left off" is one surface rather than a hunt
   * through task detail views, and so the ids the Stop hook writes are visible at all.
   *
   * What it deliberately does not show, because nothing in the store records it: whether a
   * session is running, when it started, how long it lasted, what it changed, or what it ran.
   * The one timestamp here is the task's own `updated` time, labelled "last seen" and nothing
   * stronger, because for an older id on a task that value is an upper bound rather than a
   * measurement. This surface will not grow a live indicator until the plugin writes one.
   *
   * With no linked sessions at all, which is what a store filled in by hand looks like, the
   * surface says so and says what would make one appear.
   */
  import type { SessionRef, Task } from '@ledge/core/pure';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';

  interface Props {
    /** From `sessionsFor` in core: newest `lastSeen` first, newest id first within a task. */
    sessions: SessionRef[];
    /** Resolves a session's task, so opening one lands on the task rather than nowhere. */
    taskFor: (taskId: string) => Task | undefined;
    onselect: (task: Task) => void;
    /** Opens Claude Code on that session id. Absent where resuming is not available. */
    onresume?: (task: Task) => void;
  }

  let { sessions, taskFor, onselect, onresume }: Props = $props();
</script>

<div class="pane">
  <div class="pane-scroll">
    {#if sessions.length > 0}
      <div class="rows">
        {#each sessions as ref (ref.taskId + ref.id)}
          {@const task = taskFor(ref.taskId)}
          <article class="card session">
            <div class="top">
              <code class="id">{ref.id}</code>
              {#if ref.isLatest}
                <span class="chip neutral" title="The newest session id on this task">latest</span>
              {/if}
              <span class="when-text" title="The task's updated time, not a measured session">
                last seen {relativeTime(ref.lastSeen)}
              </span>
            </div>
            <button
              type="button"
              class="what linky"
              disabled={task === undefined}
              onclick={() => task && onselect(task)}
            >
              {ref.taskTitle}
            </button>
            <div class="foot">
              {#if ref.repo}
                <span class="repo trunc" title={ref.repo}>{basename(ref.repo)}</span>
              {/if}
              {#if onresume && ref.isLatest && task}
                <button type="button" class="btn motion" onclick={() => onresume?.(task)}>
                  Resume in Claude
                </button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
      <p class="quiet faint">
        A task file records a session id and nothing else, so there is no start time, no
        duration and no way to tell whether a session is still running.
      </p>
    {:else}
      <div class="empty">
        <h3>No sessions linked yet</h3>
        <p class="quiet">
          A session appears here when Claude Code finishes working in a repository that has a
          Ledge task. The plugin's Stop hook writes the session id into that task file, and this
          surface reads it back.
        </p>
        <p class="quiet faint">
          Nothing is missing and nothing has failed: neither of your task files was written from
          a session, so neither carries an id.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .session {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: var(--space-2) var(--space-3);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  /* The id is the fact this row is built on, so it is set in the face that makes an opaque
     string readable rather than being hidden as a caption. */
  .id {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  .top .when-text {
    margin-left: auto;
  }
  .what {
    min-width: 0;
    text-align: left;
    font-size: var(--fs-base);
    font-weight: 500;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    color: var(--text-faint);
  }
  .foot .btn {
    margin-left: auto;
  }
</style>
