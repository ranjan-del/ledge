<script module lang="ts">
  /** How long the idle desk takes to step aside when a conversation starts. */
  export const LEAVE_MS = 180;

  /** The suggestion chips on the idle desk. Each one is sent as it is written. */
  export const SUGGESTIONS = ['What is pending?', 'Plan my day', 'Summarise this week', 'What did I do yesterday?'];
</script>

<script lang="ts">
  /**
   * ASSISTANT: the first tab, and the one the panel opens on. Idle, it is the desk at a glance
   * with a question field under the greeting: the tasks worked on most recently, today's
   * to-dos, the one line about repositories with unsaved work, and a few things worth asking.
   * Once something is asked, the desk steps aside, the conversation fills the tab and the field
   * docks at the bottom, under a header row with the chat's title, New chat and History.
   *
   * It draws an AssistantChat and calls its methods. The engine behind it is whichever one the
   * panel handed that chat, so this renders in a test on the scripted fake exactly as it does
   * over the real Claude Code process.
   */
  import type { RepoStatus, Task, WeekItem } from '@ledge/core/pure';
  import { onMount, tick, untrack } from 'svelte';
  import type { AwaySummary } from '../lib/away.ts';
  import { problemFor, type AssistantChat } from '../lib/assistant-chat.svelte.ts';
  import { greeting, taskState, type RecentTask } from '../lib/derive.ts';
  import { reducedMotion, startStaggerWindow, staggering } from '../lib/motion.svelte.ts';
  import { basename } from '../lib/paths.ts';
  import { relativeTime } from '../lib/time.ts';
  import type { WeekRef } from '../lib/week-view.ts';
  import ChatBubble from './ChatBubble.svelte';
  import ChatHistory from './ChatHistory.svelte';
  import Composer from './Composer.svelte';
  import ReturnToWork from './ReturnToWork.svelte';
  import TodayTodos from './TodayTodos.svelte';

  interface Props {
    chat: AssistantChat;
    /** Who to greet. An empty string greets nobody. */
    name?: string;
    /** Clauses for the thin line under the greeting, already worded and already true. */
    summary?: string[];
    /** The tasks worked on most recently, by activity. Two or three are shown. */
    recent?: RecentTask[];
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day: string;
    /** Now in milliseconds, for the relative times. */
    now?: number;
    statusFor?: (repo: string | undefined) => RepoStatus | undefined;
    onselect: (task: Task) => void;
    /** Repositories with uncommitted or unpushed work. Zero hides the Pending line. */
    attention?: number;
    onpending?: () => void;
    weekToday?: { item: WeekItem; ref: WeekRef }[];
    weekMore?: number;
    onweektick?: (ref: WeekRef) => unknown;
    onopenweek?: () => void;
    taskTitle?: (id: string) => string | undefined;
    onopentask?: (id: string) => void;
    /** What changed while the panel was closed. Absent unless there was a real absence. */
    away?: AwaySummary;
    onresumeaway?: (file: string) => void;
    ondismissaway?: () => void;
    onawayseen?: () => void;
    onopenlink?: (href: string) => void;
    /** Bumping this focuses the field, which is what the palette's Ask row does. */
    focusKey?: number;
  }

  let {
    chat,
    name = '',
    summary = [],
    recent = [],
    day,
    now = Date.now(),
    statusFor,
    onselect,
    attention = 0,
    onpending,
    weekToday = [],
    weekMore = 0,
    onweektick,
    onopenweek,
    taskTitle,
    onopentask,
    away,
    onresumeaway,
    ondismissaway,
    onawayseen,
    onopenlink,
    focusKey = 0,
  }: Props = $props();

  const hello = $derived(name === '' ? greeting() : `${greeting()}, ${name}`);
  const cards = $derived(recent.slice(0, 3));
  const problem = $derived(problemFor(chat.status, chat.detail));
  const lastId = $derived(chat.messages[chat.messages.length - 1]?.id);

  /* idle -> leaving -> chat. `leaving` is the few frames the desk takes to step aside. */
  let phase = $state<'idle' | 'leaving' | 'chat'>(untrack(() => (chat.chatting ? 'chat' : 'idle')));
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let focused = $state(false);
  let draft = $state('');
  let historyOpen = $state(false);
  let scroller = $state<HTMLElement | null>(null);
  let stick = true;

  $effect(() => {
    const talking = chat.chatting;
    untrack(() => {
      if (talking && phase === 'idle') {
        historyOpen = false;
        if (reducedMotion()) phase = 'chat';
        else {
          phase = 'leaving';
          leaveTimer = setTimeout(() => (phase = 'chat'), LEAVE_MS);
        }
      } else if (!talking && phase !== 'idle') {
        clearTimeout(leaveTimer);
        phase = 'idle';
      }
    });
  });

  /* The newest words stay in view while they arrive, unless the person scrolled up to read. */
  $effect(() => {
    chat.messages;
    if (phase !== 'chat') return;
    void tick().then(() => {
      if (scroller && stick) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  $effect(() => {
    if (phase === 'chat') stick = true;
  });

  function onScroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  }

  onMount(() => {
    startStaggerWindow();
    void chat.refreshChats();
    return () => clearTimeout(leaveTimer);
  });

  async function send(text: string): Promise<boolean> {
    return chat.send(text);
  }

  function openHistory() {
    historyOpen = !historyOpen;
    if (historyOpen) void chat.refreshChats();
  }

  async function openChat(id: string) {
    historyOpen = false;
    await chat.open(id);
  }

  function newChat() {
    historyOpen = false;
    chat.newChat();
    focusBump += 1;
  }

  let focusBump = $state(0);
  const composerKey = $derived(focusKey + focusBump);
</script>

<div class="assistant" class:chatting={phase === 'chat'}>
  {#if phase === 'chat'}
    <header class="chat-head">
      <h2 class="chat-title trunc" title={chat.title}>{chat.title}</h2>
      <button type="button" class="head-btn motion" onclick={newChat} title="Start a new chat">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2.2v7.6M2.2 6h7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        New chat
      </button>
      {@render historyButton()}
    </header>
  {/if}

  {#if problem}
    <div class="problem" role="alert">
      <div class="p-text">
        <p class="p-title">{problem.title}</p>
        <p class="p-detail selectable">{problem.detail}</p>
      </div>
      <button type="button" class="btn motion" onclick={() => chat.warm()}>Retry</button>
    </div>
  {:else if chat.status === 'starting' && chat.detail}
    <p class="restarting" role="status">Restarting Claude Code. {chat.detail}</p>
  {/if}

  {#if phase === 'chat'}
    <div class="conversation" bind:this={scroller} onscroll={onScroll} aria-live="polite">
      {#each chat.messages as message (message.id)}
        <ChatBubble
          {message}
          streaming={chat.running && message.id === lastId && message.role === 'assistant'}
          answered={chat.answered}
          ondecide={(id, d, always) => chat.decide(id, d, always)}
          onretry={(id) => void chat.retry(id)}
          {onopenlink}
        />
      {/each}
    </div>
    <div class="dock">
      {@render composer(true)}
    </div>
  {:else}
    <div class="pane-scroll idle" class:leaving={phase === 'leaving'}>
      {#if away && onresumeaway && ondismissaway}
        <div class="fade">
          <ReturnToWork summary={away} onresume={onresumeaway} ondismiss={ondismissaway} onseen={onawayseen} />
        </div>
      {/if}

      <div class="greet">
        <div class="greet-row">
          <h2 class="hello">{hello} <span class="wave" aria-hidden="true">👋</span></h2>
          {#if chat.chats.length > 0}
            {@render historyButton()}
          {/if}
        </div>
        {#if summary.length > 0}
          <p class="summary">{summary.join(' · ')}</p>
        {/if}
      </div>

      <div class="ask">
        {@render composer(false)}
        <div class="chips fade" role="group" aria-label="Suggestions">
          {#each SUGGESTIONS as s (s)}
            <button type="button" class="suggest motion" disabled={chat.running} onclick={() => void send(s)}>{s}</button>
          {/each}
        </div>
        {#if chat.sendError}
          <p class="edit-error" role="alert">{chat.sendError}</p>
        {/if}
      </div>

      {#if cards.length > 0}
        <section class="block fade" aria-labelledby="recent-label">
          <h3 class="section-label" id="recent-label">Recent</h3>
          <div class="rows recent" class:enter={staggering()}>
            {#each cards as entry (entry.task.file)}
              {@const state = taskState(entry.task, day)}
              {@const git = statusFor?.(entry.task.repo)}
              <button type="button" class="mini card motion" onclick={() => onselect(entry.task)}>
                <span class="mini-top">
                  <span class="mini-dot {state.id}" aria-hidden="true"></span>
                  <span class="mini-title trunc">{entry.task.title}</span>
                  {#if git && (git.dirty.length > 0 || git.ahead > 0)}
                    <span class="chip attention" title="Uncommitted or unpushed work">unsaved</span>
                  {/if}
                </span>
                <span class="mini-sub">
                  <span>{state.label}</span>
                  {#if entry.task.repo}<span class="trunc">{basename(entry.task.repo)}</span>{/if}
                  <span class="when-text">{relativeTime(entry.at, now)}</span>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if weekToday.length + weekMore > 0}
      <div class="fade">
        <TodayTodos
          items={weekToday}
          more={weekMore}
          ontick={onweektick}
          {onopenweek}
          {taskTitle}
          {onopentask}
        />
      </div>
      {/if}

      {#if attention > 0 && onpending}
        <button type="button" class="pending-line fade" onclick={() => onpending?.()}>
          <span class="state-dot attention" aria-hidden="true"></span>
          <span class="what">
            {attention}
            {attention === 1 ? 'repository has' : 'repositories have'} uncommitted or unpushed work
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
</div>

{#snippet composer(docked: boolean)}
  <Composer
    {docked}
    bind:value={draft}
    running={chat.running}
    model={chat.model}
    onmodel={(m) => (chat.model = m)}
    onsend={send}
    onstop={() => chat.stop()}
    autofocus={focused}
    focusKey={composerKey}
    onfocuschange={(f) => (focused = f)}
    placeholder={docked ? 'Reply, or ask something else' : undefined}
  />
  {#if docked && chat.sendError}
    <p class="edit-error dock-error" role="alert">{chat.sendError}</p>
  {/if}
{/snippet}

{#snippet historyButton()}
  <div class="history-wrap">
    <button
      type="button"
      class="head-btn icon motion"
      data-history-toggle
      aria-label="Chat history"
      aria-expanded={historyOpen}
      title="Chat history"
      onclick={openHistory}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2.3 7a4.7 4.7 0 1 0 1.4-3.3" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" />
        <path d="M2 2.2v2.3h2.3" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round" />
        <path d="M7 4.6V7l1.7 1.1" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    {#if historyOpen}
      <ChatHistory
        chats={chat.chats}
        current={chat.chatId}
        {now}
        onopen={(id) => void openChat(id)}
        ondelete={(id) => void chat.remove(id)}
        onclose={() => (historyOpen = false)}
      />
    {/if}
  </div>
{/snippet}

<style>
  .assistant {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* ---------------------------------------------------------------- idle */
  .idle {
    gap: var(--space-4);
    padding-top: var(--space-1);
  }
  .greet {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .greet-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hello {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .wave {
    font-size: var(--fs-lg);
  }
  .summary {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-faint);
  }
  @media (max-height: 420px) {
    .summary {
      display: none;
    }
  }
  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: calc(-1 * var(--space-1));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .suggest {
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-muted);
  }
  .suggest:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--surface-border));
    color: var(--text);
  }
  .suggest:disabled {
    opacity: 0.5;
  }

  .recent {
    gap: 6px;
  }
  .mini {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px var(--space-3);
    text-align: left;
  }
  .mini:hover {
    background: var(--surface-hover);
  }
  .mini-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .mini-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .mini:hover .mini-title {
    color: var(--accent);
  }
  .mini-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .mini-dot.working {
    background: var(--done-fill);
  }
  .mini-dot.progress {
    background: var(--accent);
  }
  .mini-dot.parked {
    background: transparent;
    border: 1.5px solid var(--text-faint);
  }
  .mini-sub {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding-left: 15px;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .mini-sub > span + span::before {
    content: '·';
    margin-right: 6px;
  }
  .mini-sub .when-text {
    margin-left: auto;
  }
  .mini-sub .when-text::before {
    content: none;
  }

  .pending-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin-top: calc(-1 * var(--space-2));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .pending-line:hover {
    background: var(--surface);
    color: var(--text);
  }
  .pending-line .what {
    flex: 1;
    min-width: 0;
  }

  /* ---------------------------------------------------------------- chatting */
  .chat-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--rule);
  }
  .chat-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .head-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .head-btn.icon {
    width: 24px;
    padding: 0;
    justify-content: center;
  }
  .head-btn:hover,
  .head-btn[aria-expanded='true'] {
    background: var(--control);
    color: var(--text);
  }
  .history-wrap {
    position: relative;
    flex: none;
  }
  .conversation {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-3) var(--space-4);
  }
  .conversation > :global(*) {
    flex: none;
  }
  .dock {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) var(--space-2);
    border-top: 1px solid var(--rule);
  }
  .dock-error {
    padding: 0 var(--space-1);
  }

  /* ---------------------------------------------------------------- problems */
  .problem {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0 var(--space-3) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--late-bg);
    color: var(--late-fg);
  }
  .chatting .problem {
    margin-top: var(--space-2);
    margin-bottom: 0;
  }
  .p-text {
    flex: 1;
    min-width: 0;
  }
  .problem p {
    margin: 0;
  }
  .p-title {
    font-size: var(--fs-sm);
    font-weight: 700;
  }
  .p-detail {
    font-size: var(--fs-xs);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .restarting {
    flex: none;
    margin: 0 var(--space-3) var(--space-2);
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }

  /* ---------------------------------------------------------------- motion */
  @media (prefers-reduced-motion: no-preference) {
    .idle .fade,
    .idle .greet {
      transition:
        opacity 180ms ease,
        transform 180ms cubic-bezier(0.4, 0, 0.6, 1);
    }
    .idle.leaving .fade,
    .idle.leaving .greet {
      opacity: 0;
      transform: translateY(8px);
    }
    .chatting .conversation,
    .chatting .chat-head {
      animation: chat-in 200ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .chatting .dock {
      animation: dock-in 220ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
  }
  @keyframes chat-in {
    from {
      opacity: 0;
    }
  }
  @keyframes dock-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
</style>
