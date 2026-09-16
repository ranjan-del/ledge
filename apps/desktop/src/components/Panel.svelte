<script lang="ts">
  /**
   * The glass sheet, and the only component that knows about the store. It owns the four
   * surfaces, the chrome around them and every action a surface can trigger, so the surfaces
   * themselves take plain data and callbacks and can be rendered in a test without a filesystem.
   *
   * The shape is fixed: a header that never scrolls, the four-surface tab strip, then exactly
   * one region that scrolls, then a footer. Parse warnings and errors sit under the tabs rather
   * than inside a list, so they are visible whichever surface you are on. Settings, a task
   * detail and the search each take the whole scrolling region rather than floating over it,
   * because 380 px has no room for an overlay that leaves anything useful behind it.
   *
   * The sheet slides and fades in from whichever edge it is docked to, and it plays that in
   * reverse before the window is actually hidden: the hide is delayed by exactly as long as the
   * animation, and not at all for someone who asked for less motion.
   */
  import {
    collapseTilde,
    memoryFor,
    sessionsFor,
    type Task as CoreTask,
  } from '@ledge/core/pure';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open } from '@tauri-apps/plugin-shell';
  import { onMount } from 'svelte';
  import { personName, summaryParts } from '../lib/derive.ts';
  import {
    dismiss as dismissNews,
    dismissAll as dismissAllNews,
    dismissAway,
    markAwaySeen,
    news,
    setCentreOpen,
    startNews,
    unread,
  } from '../lib/news.svelte.ts';
  import type { Notification } from '../lib/observed.ts';
  import { writeText } from '../lib/io.ts';
  import { PANEL_MS, reducedMotion } from '../lib/motion.svelte.ts';
  import type { PaletteCommand } from '../lib/palette.ts';
  import {
    createPanelSizer,
    needsFullHeight,
    panelContent,
    type PanelCounts,
  } from '../lib/sizing.ts';
  import { detectOs, openInClaude, type LaunchResult } from '../lib/platform.ts';
  import {
    addTask,
    attentionRepos,
    backlogTasks,
    counts,
    currentTasks,
    desk,
    doneCount,
    doneTasks,
    doneToday,
    errorText,
    lastUpdated,
    markDone,
    parkTask,
    removeTask,
    saveConfigFile,
    scanNow,
    select,
    selectedTask,
    setPanelVisible,
    setSearching,
    setSurface,
    setView,
    startTask,
    statusForRepo,
    taskTitleForRepo,
    upNextTasks,
    workingTasks,
    type Surface,
    type TaskView,
  } from '../lib/store.svelte.ts';
  import type { CardAction } from './TaskCard.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import Header from './Header.svelte';
  import Memory from './Memory.svelte';
  import Notifications from './Notifications.svelte';
  import Now from './Now.svelte';
  import Sessions from './Sessions.svelte';
  import Settings from './Settings.svelte';
  import Tabs from './Tabs.svelte';
  import TaskDetail from './TaskDetail.svelte';
  import Tasks from './Tasks.svelte';

  let pinned = $state(false);
  let showSettings = $state(false);
  let launch = $state<LaunchResult | null>(null);
  /* Bumped by the add shortcut. Now passes it down; AddTask opens and focuses when it changes. */
  let addKey = $state(0);
  /* False for the first frame and for the 160 ms before the window hides, which is what
     gives the sheet something to animate from and to. */
  let onScreen = $state(false);

  const count = $derived(counts());
  const tabs = $derived([
    { id: 'now', label: 'Now', count: count.now },
    { id: 'sessions', label: 'Sessions', count: count.sessions },
    { id: 'tasks', label: 'Tasks', count: count.tasks },
    { id: 'memory', label: 'Memory', count: count.memory },
  ]);
  const selected = $derived(selectedTask());
  const working = $derived(workingTasks());
  const upNext = $derived(upNextTasks());
  const sessions = $derived(sessionsFor(desk.tasks));
  const notes = $derived(memoryFor(desk.tasks));
  const summary = $derived(
    summaryParts({
      sessions: count.sessions,
      working: working.length,
      pending: upNext.length + backlogTasks().length,
    }),
  );
  /*
   * How tall the window should be. The counts are the ones this component already derives, so
   * the sizing rule reads the same lists the surfaces do; the rule itself is in lib/sizing.ts.
   */
  const counted = $derived<PanelCounts>({
    surface: desk.surface,
    view: desk.view,
    detailOpen: selected !== undefined,
    working: working.length,
    upNext: upNext.length,
    attention: attentionRepos().length,
    sessions: sessions.length,
    notes: notes.length,
    live: currentTasks().length,
    done: doneCount(),
    backlog: backlogTasks().length,
    pending: desk.pending.length,
  });
  const full = $derived(
    needsFullHeight(
      panelContent(counted),
      typeof screen === 'undefined' ? 0 : screen.availHeight,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    ),
  );
  const name = $derived(personName(desk.config, desk.home));
  const store = $derived(collapseTilde(desk.tasksDir, desk.home));
  /* Docked right, the sheet leaves to the right. Docked left, it leaves to the left. */
  const slide = $derived(desk.config.ui.edge === 'left' ? '-10px' : '10px');
  const mac = detectOs() === 'macos';
  const modifier = mac ? '⌘' : 'Ctrl';

  function clockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function taskById(id: string): CoreTask | undefined {
    return desk.tasks.find((t) => t.id === id);
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

  /**
   * The overflow menu on a card. Every entry here is an action that already existed in the task
   * detail view; the menu is a short cut to them, not a second set of powers.
   */
  function actionsFor(task: CoreTask): CardAction[] {
    const actions: CardAction[] = [{ label: 'Open task', run: (t) => select(t.file) }];
    const last = task.sessions[task.sessions.length - 1];
    actions.push({
      label: last ? 'Resume in Claude' : 'Open in Claude',
      run: (t) => void resume(t, Boolean(last)),
    });
    if (task.status === 'backlog') {
      actions.push({ label: 'Start', run: (t) => void startTask(t) });
    } else {
      actions.push({ label: 'Park', run: (t) => void parkTask(t, 'Parked from the panel') });
    }
    actions.push({ label: 'Mark done', run: (t) => void markDone(t) });
    return actions;
  }

  /**
   * Runs what a palette row asked for. Every branch is an action the panel already performs
   * from a button somewhere, which is the rule the palette's own rows are built to: it is a
   * faster way to the app's verbs, not a second set of them.
   */
  function runCommand(command: PaletteCommand) {
    setSearching(false);
    if (command.type === 'open-task') select(command.file);
    else if (command.type === 'surface') setSurface(command.surface);
    else if (command.type === 'rescan') void scanNow();
    else if (command.type === 'add-task') {
      showSettings = false;
      select(null);
      setSurface('now');
      void addTask({ title: command.title }).catch((e: unknown) => (desk.error = errorText(e)));
    }
  }

  /**
   * Opens what a notification is about. A task notification opens that task; a repository one
   * goes to the Pending view, which is the only place the panel says anything about a
   * repository. Either way the centre closes, because it was a way in rather than a place.
   */
  function openNotification(item: Notification) {
    setCentreOpen(false);
    if (item.file) {
      showSettings = false;
      select(item.file);
    } else if (item.repo) {
      setSurface('tasks');
      setView('pending');
    }
  }

  /*
   * One sizer for the life of the window. It swallows an answer that has not changed and waits
   * for the dust to settle before it calls, so a burst of watcher events cannot make the window
   * re-size and re-place itself several times over.
   */
  const sizer = createPanelSizer((hasContent) => {
    void invoke('resize_panel', { hasContent }).catch(() => {
      /* Outside Tauri, or a window that has since been hidden: the size is not worth an error
         line in the panel. */
    });
  });

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

  /**
   * The two shortcuts the chrome promises: the search pill's own key, and the one written on
   * the add row. Both are only claimed where they work, which is why the modifier is spelled
   * for this platform rather than assumed.
   */
  function onKeydown(event: KeyboardEvent) {
    const chord = mac ? event.metaKey : event.ctrlKey;
    if (!chord || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'k') {
      event.preventDefault();
      setCentreOpen(false);
      setSearching(!desk.searching);
    } else if (key === 'n') {
      event.preventDefault();
      setSearching(false);
      showSettings = false;
      select(null);
      if (desk.surface !== 'now' && desk.surface !== 'tasks') setSurface('now');
      addKey += 1;
    }
  }

  /* Nothing is asked of a window nobody can see: a hidden panel is re-sized and re-placed by
     `toggle_panel` on its way back on screen, and this corrects it a moment later if the button
     guessed wrong. A pinned panel counts as on screen even while another application has the
     focus, because it stays visible. */
  $effect(() => {
    if (desk.panelVisible || pinned) sizer.update(full);
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    const raf = requestAnimationFrame(() => (onScreen = true));
    /* Only this window watches for news. The button window boots the same store, and two
       writers of one observation file would each undo the other's record of what it had
       already seen. */
    const stopNews = startNews();
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
      sizer.stop();
      stopNews();
      unlisten?.();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="panel" class:offscreen={!onScreen} style:--slide={slide}>
  <Header
    scanning={desk.scanning}
    awake={desk.panelVisible}
    {pinned}
    settingsOpen={showSettings}
    searchOpen={desk.searching}
    unread={unread()}
    notifyOpen={news.open}
    {modifier}
    onpin={() => (pinned = !pinned)}
    onnotify={() => setCentreOpen(!news.open)}
    onsearch={() => {
      setCentreOpen(false);
      setSearching(!desk.searching);
    }}
    onsettings={() => {
      showSettings = !showSettings;
      setSearching(false);
      select(null);
    }}
  />

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
      <Tabs {tabs} active={desk.surface} onchange={(id) => setSurface(id as Surface)} />
    </div>

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

    {#if desk.surface === 'now'}
      <Now
        {working}
        {upNext}
        {name}
        {summary}
        {addKey}
        addShortcut="{modifier}N"
        attention={attentionRepos().length}
        statusFor={statusForRepo}
        {actionsFor}
        onselect={(t) => select(t.file)}
        onadd={addTask}
        onpending={() => {
          setSurface('tasks');
          setView('pending');
        }}
        away={news.away}
        onresumeaway={(file) => {
          dismissAway();
          select(file);
        }}
        ondismissaway={dismissAway}
        onawayseen={markAwaySeen}
      />
    {:else if desk.surface === 'sessions'}
      <Sessions
        {sessions}
        taskFor={taskById}
        onselect={(t) => select(t.file)}
        onresume={(t) => void resume(t, true)}
      />
    {:else if desk.surface === 'tasks'}
      <Tasks
        view={desk.view}
        live={currentTasks()}
        backlog={backlogTasks()}
        done={doneTasks()}
        pending={desk.pending}
        doneCount={doneCount()}
        archiveLoading={desk.archiveLoading}
        scanning={desk.scanning}
        statusFor={statusForRepo}
        titleForRepo={taskTitleForRepo}
        {actionsFor}
        onview={(v) => setView(v as TaskView)}
        onselect={(t) => select(t.file)}
        onadd={addTask}
      />
    {:else}
      <Memory entries={notes} taskFor={taskById} onselect={(t) => select(t.file)} />
    {/if}
  {/if}

  {#if desk.searching}
    <CommandPalette
      tasks={desk.tasks}
      surface={desk.surface}
      {modifier}
      onrun={runCommand}
      onclose={() => setSearching(false)}
    />
  {/if}

  {#if news.open}
    <Notifications
      items={news.items}
      onopen={openNotification}
      ondismiss={dismissNews}
      ondismissall={dismissAllNews}
      onclose={() => setCentreOpen(false)}
    />
  {/if}

  {#if launch && !launch.ok}
    <div class="launch" role="alert">
      <p>Could not open the terminal. Run this in <code>{launch.dir}</code>:</p>
      <pre>{launch.command}</pre>
      <button type="button" class="btn motion" onclick={() => (launch = null)}>Dismiss</button>
    </div>
  {/if}

  <footer class="footer">
    <span>
      {#if desk.surface === 'now'}
        {@const today = doneToday()}
        {today === undefined ? `${desk.archivedCount} done and archived` : `${today} done today`}
      {:else if desk.surface === 'sessions'}
        {count.sessions} linked {count.sessions === 1 ? 'session' : 'sessions'}
      {:else if desk.surface === 'memory'}
        {count.memory} {count.memory === 1 ? 'note' : 'notes'}
      {:else}
        {desk.archivedCount} done and archived
      {/if}
    </span>
    {#if desk.scanning}
      <span>checking repositories</span>
    {:else}
      {@const at = lastUpdated()}
      <button type="button" class="refresh motion" title="Refresh git" onclick={() => void scanNow()}>
        {at ? `Last updated ${clockTime(at)}` : `watching ${store}`}
      </button>
    {/if}
  </footer>
</div>

<style>
  .panel {
    position: relative;
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
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    /* The list scrolls right up to this line, so the line has to be there: without it the
       last row looks cut off rather than scrolled. */
    border-top: 1px solid var(--rule);
    padding: 4px var(--space-3) var(--space-2);
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  /* The timestamp is the refresh button: the thing it reports is the thing pressing it
     renews, so there is no need for a second icon that means the same. */
  .refresh {
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .refresh:hover {
    background: var(--control);
    color: var(--text-muted);
  }
</style>
