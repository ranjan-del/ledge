<script lang="ts">
  /**
   * SESSIONS: every Claude Code session Ledge knows of, grouped by the task it worked on and
   * newest first, each one a card that says what the session was rather than which UUID it had.
   *
   * A card leads with the session's title, written by capture from the transcript, and falls
   * back to "Untitled session" when capture has not reached it. Under the title: the summary,
   * when it started, how long it ran, a live dot while it is running, and chips for the files it
   * changed, the commits it made and the todos it ticked. Opening a card lists those, and holds
   * the two things only an expanded card needs: the id, as a copy button, and Resume.
   *
   * Running is derived by `isSessionRunning`: not ended, and active in the last 15 minutes. A
   * session only a task file names (an older one, or one capture never reached) has no record,
   * so it has no times and no counts, and the card says so rather than inventing them.
   */
  import type { Task } from '@ledge/core/pure';
  import { formatDuration, type SessionGroup, type SessionItem } from '../lib/session-view.ts';
  import { relativeTime } from '../lib/time.ts';
  import LiveDot from './LiveDot.svelte';

  interface Props {
    /** From `groupSessions`: grouped by task, newest group and newest session first. */
    groups: SessionGroup[];
    onselect: (task: Task) => void;
    /** Resumes or reopens Claude Code on that session. Absent where launching is not available. */
    onresume?: (task: Task, sessionId: string) => void;
    /** For relative times. A prop so this is testable without touching the clock. */
    now?: number;
    /** The panel is on screen, so the live dots may breathe. */
    awake?: boolean;
  }

  let { groups, onselect, onresume, now = Date.now(), awake = true }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});
  let copied = $state<string | null>(null);

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      copied = id;
      setTimeout(() => {
        if (copied === id) copied = null;
      }, 1400);
    } catch {
      copied = null;
    }
  }

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  function when(item: SessionItem): string {
    if (!item.started) return 'no record yet';
    const parts = [`started ${relativeTime(item.started, now)}`];
    parts.push(item.running ? `running ${formatDuration(item.durationMs)}` : formatDuration(item.durationMs));
    return parts.join(', ');
  }
</script>

<div class="pane">
  <div class="pane-scroll">
    {#if groups.length > 0}
      {#each groups as group (group.key)}
        <section class="group" aria-label={group.title}>
          <h3 class="section-label">
            {#if group.task}
              {@const task = group.task}
              <button type="button" class="linky trunc g-title" onclick={() => onselect(task)}>
                {group.title}
              </button>
            {:else}
              <span class="trunc g-title">{group.title}</span>
            {/if}
            <span class="count">{group.items.length}</span>
          </h3>
          <div class="rows">
            {#each group.items as item (item.id)}
              {@const rec = item.record}
              {@const open = expanded[item.id] === true}
              <article class="card session" class:running={item.running}>
                <button
                  type="button"
                  class="s-head motion"
                  aria-expanded={open}
                  aria-controls="session-{item.id}"
                  onclick={() => (expanded[item.id] = !open)}
                >
                  <span class="s-title" class:untitled={!rec?.title}>
                    {rec?.title ?? 'Untitled session'}
                  </span>
                  {#if item.running}
                    <LiveDot size="sm" {awake} title="Running: active in the last 15 minutes" />
                  {/if}
                  <svg width="9" height="9" viewBox="0 0 10 10" class="s-turn" class:turn={open}
                    aria-hidden="true">
                    <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor"
                      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                {#if !rec?.title && group.task}
                  <p class="s-task sub trunc">{group.task.title}</p>
                {/if}
                {#if rec?.summary}
                  <p class="d-sum">{rec.summary}</p>
                {/if}
                <p class="s-when when-text">{when(item)}</p>
                {#if rec && (rec.filesChanged.length > 0 || rec.commits.length > 0 || rec.todosTicked.length > 0)}
                  <div class="s-chips">
                    {#if rec.filesChanged.length > 0}
                      <span class="chip neutral">{plural(rec.filesChanged.length, 'file', 'files')}</span>
                    {/if}
                    {#if rec.commits.length > 0}
                      <span class="chip info">{plural(rec.commits.length, 'commit', 'commits')}</span>
                    {/if}
                    {#if rec.todosTicked.length > 0}
                      <span class="chip done">{plural(rec.todosTicked.length, 'todo ticked', 'todos ticked')}</span>
                    {/if}
                  </div>
                {/if}
                {#if open}
                  <div class="s-more" id="session-{item.id}">
                    {#if rec && rec.filesChanged.length > 0}
                      <p class="s-label">Files changed</p>
                      <ul class="s-list mono selectable">
                        {#each rec.filesChanged as file (file)}<li>{file}</li>{/each}
                      </ul>
                    {/if}
                    {#if rec && rec.commits.length > 0}
                      <p class="s-label">Commits</p>
                      <ul class="s-list selectable">
                        {#each rec.commits as c (c.sha)}
                          <li><code class="mono">{c.sha.slice(0, 7)}</code> {c.subject}</li>
                        {/each}
                      </ul>
                    {/if}
                    {#if rec && rec.todosTicked.length > 0}
                      <p class="s-label">Ticked</p>
                      <ul class="item-list">
                        {#each rec.todosTicked as t, i (i)}
                          <li><span class="tick" aria-hidden="true">✓</span><span>{t}</span></li>
                        {/each}
                      </ul>
                    {/if}
                    {#if rec && rec.todosAdded.length > 0}
                      <p class="s-label">Added</p>
                      <ul class="item-list">
                        {#each rec.todosAdded as t, i (i)}
                          <li><span class="box" aria-hidden="true"></span><span>{t}</span></li>
                        {/each}
                      </ul>
                    {/if}
                    {#if !rec}
                      <p class="quiet faint">
                        Only the task file names this session, so there is no title, no times and
                        nothing recorded about what it changed.
                      </p>
                    {/if}
                    <div class="row-actions">
                      {#if onresume && group.task}
                        {@const task = group.task}
                        <button
                          type="button"
                          class="btn primary motion"
                          onclick={() => onresume?.(task, item.id)}
                        >
                          Resume in Claude
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="btn motion"
                        title={item.id}
                        onclick={() => void copy(item.id)}
                      >
                        {copied === item.id ? 'Copied' : 'Copy session id'}
                      </button>
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    {:else}
      <div class="empty">
        <h3>No sessions yet</h3>
        <p class="quiet">
          A session appears here once Claude Code has worked in a repository with the Ledge
          plugin installed. Ledge records what each session was for, what it changed and whether
          it is still running, and files it under its task.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .pane-scroll {
    gap: var(--space-3);
  }
  .section-label {
    min-width: 0;
  }
  .g-title {
    min-width: 0;
    text-align: left;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
  }
  .section-label .count {
    margin-left: auto;
  }
  .session {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-2) var(--space-3);
  }
  .session p {
    margin: 0;
  }
  .session.running {
    border-color: var(--done-bg);
  }
  .s-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    text-align: left;
  }
  .s-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .s-title.untitled {
    color: var(--text-muted);
    font-weight: 500;
  }
  .s-head:hover .s-title {
    color: var(--accent);
  }
  .s-turn {
    flex: none;
    color: var(--text-faint);
  }
  .s-turn.turn {
    transform: rotate(90deg);
  }
  .s-when {
    margin: 0;
  }
  .s-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: 2px;
  }
  .s-more {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--rule);
  }
  .s-label {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .s-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-sm);
    line-height: 1.4;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .tick {
    flex: none;
    width: 8px;
    font-size: 9px;
    font-weight: 700;
    color: var(--done-fg);
  }
  .s-more .row-actions {
    margin-top: var(--space-2);
  }
  @media (prefers-reduced-motion: no-preference) {
    .s-turn {
      transition: transform 140ms ease;
    }
  }
</style>
