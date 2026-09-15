<script lang="ts">
  /**
   * The glass sheet: header with pin, refresh and settings, segmented tabs, then whichever of
   * the three lists, the home view or the task detail is in front. The Current tab is handed to
   * Home, which owns the three blocks of contract section 7; Backlog and Pending stay plain
   * lists, because a list is all they are.
   *
   * The panel is a short window now (60 percent of the work area, 420 px to 900 px), so the
   * chrome is fixed and exactly one region scrolls. Parse warnings and errors sit under the
   * tabs rather than inside a list, so they are visible whichever tab you are on.
   *
   * The sheet slides and fades in from whichever edge it is docked to, and it plays that in
   * reverse before the window is actually hidden: the hide is delayed by exactly as long as
   * the animation, and not at all for someone who asked for less motion. The live dot beside
   * the name is the panel saying it is still watching.
   */
  import { collapseTilde, type Task as CoreTask } from '@ledge/core/pure';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open } from '@tauri-apps/plugin-shell';
  import { onMount } from 'svelte';
  import { PANEL_MS, reducedMotion } from '../lib/motion.svelte.ts';
  import { openInClaude, type LaunchResult } from '../lib/platform.ts';
  import {
    addTask,
    attentionRepos,
    backlogTasks,
    currentTasks,
    desk,
    markDone,
    parkTask,
    removeTask,
    saveConfigFile,
    scanNow,
    select,
    selectedTask,
    setPanelVisible,
    setTab,
    startTask,
    statusForRepo,
    taskTitleForRepo,
    todayPlan,
    type Tab,
  } from '../lib/store.svelte.ts';
  import { writeText } from '../lib/io.ts';
  import AddTask from './AddTask.svelte';
  import Agenda from './Agenda.svelte';
  import Home from './Home.svelte';
  import LiveDot from './LiveDot.svelte';
  import PendingRow from './PendingRow.svelte';
  import Settings from './Settings.svelte';
  import Tabs from './Tabs.svelte';
  import TaskDetail from './TaskDetail.svelte';
  import TaskRow from './TaskRow.svelte';

  let pinned = $state(false);
  let showSettings = $state(false);
  let launch = $state<LaunchResult | null>(null);
  /* False for the first frame and for the 160 ms before the window hides, which is what
     gives the sheet something to animate from and to. */
  let onScreen = $state(false);

  const tabs = $derived([
    { id: 'current', label: 'Current', count: currentTasks().length },
    { id: 'backlog', label: 'Backlog', count: backlogTasks().length },
    { id: 'pending', label: 'Pending', count: desk.pending.length },
  ]);
  const selected = $derived(selectedTask());

  /* A task planned for today belongs in the Today block, so it is not repeated below it. */
  const plan = $derived(todayPlan());
  const onToday = $derived(new Set([...plan.today, ...plan.overdue].map((t) => t.file)));
  const working = $derived(currentTasks().filter((t) => !onToday.has(t.file)));
  const plannedToday = $derived(currentTasks().length - working.length);
  const store = $derived(collapseTilde(desk.tasksDir, desk.home));
  /* Docked right, the sheet leaves to the right. Docked left, it leaves to the left. */
  const slide = $derived(desk.config.ui.edge === 'left' ? '-10px' : '10px');

  function clockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function resume(task: CoreTask, useResume: boolean) {
    launch = null;
    const result = await openInClaude(task, useResume);
    if (!result.ok) launch = result;
  }

  async function openFolder(task: CoreTask) {
    if (task.repo) await open(task.repo).catch(() => undefined);
  }

  /** Deletes the task and its file, then returns to the list. */
  async function destroy(task: CoreTask) {
    await removeTask(task.id);
    select(null);
  }

  /** Plays the sheet out, then hides the window. Instant when motion is not wanted. */
  function dismiss() {
    const win = getCurrentWindow();
    if (reducedMotion()) {
      void win.hide();
      return;
    }
    onScreen = false;
    setTimeout(() => void win.hide(), PANEL_MS);
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    const raf = requestAnimationFrame(() => (onScreen = true));
    try {
      void getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          setPanelVisible(focused);
          if (focused) onScreen = true;
          else if (!pinned) dismiss();
        })
        .then((u) => (unlisten = u));
    } catch {
      /* Outside Tauri (a browser, a screenshot harness) there is no window to listen to. */
      setPanelVisible(true);
    }
    return () => {
      cancelAnimationFrame(raf);
      unlisten?.();
    };
  });
</script>

<div class="panel" class:offscreen={!onScreen} style:--slide={slide}>
  <header class="header">
    <h1 class="brand">Ledge</h1>
    <LiveDot scanning={desk.scanning} awake={desk.panelVisible} />
    <span class="spacer"></span>
    <div class="tools">
      <button
        type="button"
        class="tool motion"
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin panel' : 'Pin panel'}
        title={pinned ? 'Unpin' : 'Pin'}
        onclick={() => (pinned = !pinned)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M9 1.5 12.5 5 9.5 6 8 9.5 4.5 6 8 4.5z M4.5 9.5 1.5 12.5"
            fill={pinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="tool motion"
        aria-label="Refresh git"
        title="Refresh git"
        disabled={desk.scanning}
        onclick={() => void scanNow()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M12 7a5 5 0 1 1-1.5-3.6M12 1.5V4.5H9" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        type="button"
        class="tool motion"
        aria-label="Settings"
        title="Settings"
        aria-pressed={showSettings}
        onclick={() => {
          showSettings = !showSettings;
          select(null);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4
               M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </header>

  {#if showSettings}
    <div class="body">
      <Settings
        config={desk.config}
        onback={() => (showSettings = false)}
        onsave={(c) => {
          void saveConfigFile(c);
          showSettings = false;
        }}
      />
    </div>
  {:else if selected}
    <div class="body">
      <TaskDetail
        task={selected}
        status={statusForRepo(selected.repo)}
        home={desk.home}
        onback={() => select(null)}
        onsave={(file, markdown) => void writeText(file, markdown)}
        onpark={(t, reason) => {
          void parkTask(t, reason);
          select(null);
        }}
        ondone={(t) => {
          void markDone(t);
          select(null);
        }}
        onresume={resume}
        onopenfolder={openFolder}
        ondelete={destroy}
      />
    </div>
  {:else}
    <div class="tabs">
      <Tabs {tabs} active={desk.tab} onchange={(id) => setTab(id as Tab)} />
    </div>
    <Agenda />

    {#if desk.error || desk.broken.length > 0}
      <div class="notices">
        {#if desk.error}
          <p class="notice">{desk.error}</p>
        {/if}
        {#each desk.broken as b (b.file)}
          <p class="warn" title={b.file}>
            Could not parse {b.file.split('/').pop()}{b.line ? ` (line ${b.line})` : ''}:
            {b.error}
          </p>
        {/each}
      </div>
    {/if}

    {#if desk.tab === 'current'}
      <Home
        current={working}
        today={plan.today}
        overdue={plan.overdue}
        {plannedToday}
        {store}
        attention={attentionRepos().length}
        backlog={backlogTasks().length}
        statusFor={statusForRepo}
        onselect={(t) => select(t.file)}
        onadd={addTask}
        onpending={() => setTab('pending')}
        onbacklog={() => setTab('backlog')}
      />
    {:else if desk.tab === 'backlog'}
      <div class="pane">
        <div class="pane-scroll rows">
          {#each backlogTasks() as task (task.file)}
            <TaskRow
              {task}
              status={statusForRepo(task.repo)}
              onselect={(t) => select(t.file)}
              onstart={(t) => void startTask(t)}
              onopen={(t) => void resume(t, false)}
            />
          {:else}
            <p class="quiet">
              Nothing parked yet. Anything you add here waits until you start it, and
              <code>/ledge park "reason"</code> in Claude Code moves a task you have set aside.
            </p>
          {/each}
        </div>
        <div class="pane-foot">
          <AddTask status="backlog" onadd={addTask} />
        </div>
      </div>
    {:else}
      <div class="body list">
        {#each desk.pending as status (status.repo)}
          <PendingRow {status} taskTitle={taskTitleForRepo(status.repo)} />
        {:else}
          <p class="quiet">
            {desk.scanning
              ? 'Scanning repositories'
              : 'Nothing pending. Everything is pushed and clean.'}
          </p>
        {/each}
      </div>
    {/if}
  {/if}

  {#if launch && !launch.ok}
    <div class="launch" role="alert">
      <p>Could not open the terminal. Run this in <code>{launch.dir}</code>:</p>
      <pre>{launch.command}</pre>
      <button type="button" class="btn motion" onclick={() => (launch = null)}>Dismiss</button>
    </div>
  {/if}

  <footer class="footer">
    <span>{desk.archivedCount} done and archived</span>
    <span>
      {#if desk.scanning}
        checking repositories
      {:else if desk.lastScan}
        git checked {clockTime(desk.lastScan)}
      {:else}
        watching {store}
      {/if}
    </span>
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
  @media (prefers-reduced-motion: no-preference) {
    .panel {
      transition:
        opacity var(--panel-ms) ease-out,
        transform var(--panel-ms) ease-out;
    }
    .panel.offscreen {
      opacity: 0;
      transform: translateX(var(--slide));
    }
  }
  .header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }
  .brand {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .spacer {
    flex: 1;
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
    flex: none;
    padding: 0 var(--space-3) var(--space-3);
  }
  .notices {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-3) var(--space-2);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 var(--space-3) var(--space-3);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .notice,
  .warn {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .warn {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--attention-bg);
    color: var(--attention-fg);
  }
  .notice {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--late-bg);
    color: var(--late-fg);
  }
  code,
  pre {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .launch {
    flex: none;
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
  .footer {
    flex: none;
    display: flex;
    justify-content: space-between;
    /* The list scrolls right up to this line, so the line has to be there: without it the
       last row looks cut off rather than scrolled. */
    border-top: 1px solid var(--rule);
    padding: 5px var(--space-3) var(--space-2);
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
</style>
