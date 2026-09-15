<script lang="ts">
  /**
   * The glass sheet: header with pin, refresh and settings, segmented tabs, and the list or
   * detail for the active tab. Hides when focus leaves unless pinned.
   */
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open } from '@tauri-apps/plugin-shell';
  import { onMount } from 'svelte';
  import type { Task } from '@ledge/core/pure';
  import { openInClaude, type LaunchResult } from '../lib/platform.ts';
  import {
    backlogTasks,
    currentTasks,
    desk,
    markDone,
    parkTask,
    saveConfigFile,
    scanNow,
    select,
    selectedTask,
    setPanelVisible,
    setTab,
    startTask,
    statusForRepo,
    taskTitleForRepo,
    type Tab,
  } from '../lib/store.svelte.ts';
  import { writeText } from '../lib/io.ts';
  import Agenda from './Agenda.svelte';
  import PendingRow from './PendingRow.svelte';
  import Settings from './Settings.svelte';
  import Tabs from './Tabs.svelte';
  import TaskDetail from './TaskDetail.svelte';
  import TaskRow from './TaskRow.svelte';

  let pinned = $state(false);
  let showSettings = $state(false);
  let launch = $state<LaunchResult | null>(null);

  const tabs = $derived([
    { id: 'current', label: 'Current', count: currentTasks().length },
    { id: 'backlog', label: 'Backlog', count: backlogTasks().length },
    { id: 'pending', label: 'Pending', count: desk.pending.length },
  ]);
  const selected = $derived(selectedTask());

  async function resume(task: Task, useResume: boolean) {
    launch = null;
    const result = await openInClaude(task, useResume);
    if (!result.ok) launch = result;
  }

  async function openFolder(task: Task) {
    if (task.repo) await open(task.repo).catch(() => undefined);
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setPanelVisible(focused);
        if (!focused && !pinned) void getCurrentWindow().hide();
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  });
</script>

<div class="panel">
  <header class="header">
    <h1 class="brand">Ledge</h1>
    <div class="tools">
      <button type="button" class="tool" aria-pressed={pinned} aria-label={pinned ? 'Unpin panel' : 'Pin panel'} title={pinned ? 'Unpin' : 'Pin'} onclick={() => (pinned = !pinned)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M9 1.5 12.5 5 9.5 6 8 9.5 4.5 6 8 4.5z M4.5 9.5 1.5 12.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
      </button>
      <button type="button" class="tool" aria-label="Refresh git" title="Refresh git" disabled={desk.scanning} onclick={() => void scanNow()}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M12 7a5 5 0 1 1-1.5-3.6M12 1.5V4.5H9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button type="button" class="tool" aria-label="Settings" title="Settings" aria-pressed={showSettings} onclick={() => { showSettings = !showSettings; select(null); }}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </header>

  {#if showSettings}
    <div class="body">
      <Settings config={desk.config} onback={() => (showSettings = false)} onsave={(c) => { void saveConfigFile(c); showSettings = false; }} />
    </div>
  {:else if selected}
    <div class="body">
      <TaskDetail
        task={selected}
        status={statusForRepo(selected.repo)}
        home={desk.home}
        onback={() => select(null)}
        onsave={(file, markdown) => void writeText(file, markdown)}
        onpark={(t, reason) => { void parkTask(t, reason); select(null); }}
        ondone={(t) => { void markDone(t); select(null); }}
        onresume={resume}
        onopenfolder={openFolder}
      />
    </div>
  {:else}
    <div class="tabs">
      <Tabs {tabs} active={desk.tab} onchange={(id) => setTab(id as Tab)} />
    </div>
    <Agenda />
    <div class="body list">
      {#if desk.error}
        <p class="notice">{desk.error}</p>
      {/if}
      {#if desk.tab === 'current'}
        {#each currentTasks() as task (task.file)}
          <TaskRow {task} status={statusForRepo(task.repo)} onselect={(t) => select(t.file)} />
        {:else}
          <p class="empty">Nothing in progress. Type <code>/ledge start "title"</code> in Claude Code.</p>
        {/each}
      {:else if desk.tab === 'backlog'}
        {#each backlogTasks() as task (task.file)}
          <TaskRow {task} onselect={(t) => select(t.file)} onstart={(t) => void startTask(t)} onopen={(t) => void resume(t, false)} />
        {:else}
          <p class="empty">Backlog is empty.</p>
        {/each}
      {:else}
        {#each desk.pending as status (status.repo)}
          <PendingRow {status} taskTitle={taskTitleForRepo(status.repo)} />
        {:else}
          <p class="empty">{desk.scanning ? 'Scanning repositories' : 'Nothing pending. Everything is pushed and clean.'}</p>
        {/each}
      {/if}
      {#each desk.broken as b (b.file)}
        <p class="warn" title={b.file}>Could not parse {b.file.split('/').pop()}{b.line ? ` (line ${b.line})` : ''}: {b.error}</p>
      {/each}
    </div>
  {/if}

  {#if launch && !launch.ok}
    <div class="launch" role="alert">
      <p>Could not open the terminal. Run this in <code>{launch.dir}</code>:</p>
      <pre>{launch.command}</pre>
      <button type="button" onclick={() => (launch = null)}>Dismiss</button>
    </div>
  {/if}

  <footer class="footer">
    <span>{desk.archivedCount} done</span>
    {#if desk.lastScan}<span>scanned {new Date(desk.lastScan).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{/if}
  </footer>
</div>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--glass);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
    backdrop-filter: blur(var(--glass-blur)) saturate(150%);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-3) var(--space-2);
  }
  .brand {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .tool {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .tool:hover,
  .tool[aria-pressed="true"] {
    background: var(--control);
    color: var(--text);
  }
  .tool:disabled {
    opacity: 0.5;
  }
  .tabs {
    padding: 0 var(--space-3) var(--space-2);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--space-3) var(--space-3);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .empty,
  .notice,
  .warn {
    margin: var(--space-2) 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .warn {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--chip-amber-bg);
    color: var(--chip-amber-fg);
  }
  .notice {
    color: var(--danger);
  }
  code,
  pre {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .launch {
    margin: 0 var(--space-3) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-size: var(--fs-sm);
  }
  .launch pre {
    margin: var(--space-1) 0;
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
    -webkit-user-select: text;
  }
  .launch button {
    padding: 3px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--control);
    font-weight: 600;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) var(--space-3) var(--space-2);
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
</style>
