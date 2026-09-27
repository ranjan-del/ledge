<script lang="ts">
  /**
   * Ask Ledge: a short conversation about the desk, floating over the panel the way the command
   * palette does, because a question is something you are in the middle of rather than a place
   * you go. It is opened from the palette (type a question, choose "Ask Ledge") and keeps its
   * conversation in memory, so closing it and opening it again finds the thread where it was.
   *
   * Each question is one Claude Code run with Sonnet over the desk's context. The answer streams
   * in as clean text. When the model changed a task it did so by running `ledge`, and those
   * commands are listed under the answer; the task itself re-renders from its file, like any
   * other edit. When Claude Code is missing, signed out or fails, the turn says so in words.
   */
  import { paragraphs } from '../lib/prose.ts';
  import type { AskRunner } from '../lib/ask-runner.ts';
  import { ask, cancelAsk, chat, clearChat } from '../lib/ask-state.svelte.ts';
  import Overlay from './Overlay.svelte';

  interface Props {
    runner: AskRunner;
    /** Builds the context block when a question is asked. */
    context: () => string;
    /** Where Claude Code runs. A neutral folder, never a repository. */
    cwd?: string;
    /** A question to ask as soon as the sheet opens, from the palette. */
    initial?: string;
    onclose: () => void;
  }

  let { runner, context, cwd, initial = '', onclose }: Props = $props();

  let draft = $state('');
  let field = $state<HTMLTextAreaElement | null>(null);
  let log = $state<HTMLElement | null>(null);

  function send(text: string = draft) {
    const q = text.trim();
    if (q === '' || chat.busy) return;
    draft = '';
    void ask(q, { runner, context, cwd });
  }

  /* The palette hands over what was typed there, and it is asked straight away: typing the
     question twice would be the palette getting in the way. Read once, at open. */
  let asked = false;
  $effect(() => {
    if (asked) return;
    asked = true;
    if (initial.trim() !== '') send(initial);
    field?.focus();
  });

  /* Keep the newest words in view while they stream in. */
  $effect(() => {
    const last = chat.turns[chat.turns.length - 1];
    void last?.answer;
    void last?.status;
    if (log) log.scrollTop = log.scrollHeight;
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }
</script>

<Overlay label="Ask Ledge" {onclose}>
  <div class="sheet-head">
    <h2 class="section-label">Ask Ledge</h2>
    {#if chat.turns.length > 0 && !chat.busy}
      <button type="button" class="head-btn motion" onclick={() => clearChat()}>Clear</button>
    {/if}
    <span class="kbd">esc</span>
  </div>

  <div class="sheet-list log" bind:this={log} aria-live="polite">
    {#if chat.turns.length === 0}
      <div class="intro">
        <p class="quiet">
          Ask about your tasks, notes, sessions and repositories, or ask for a change: add a
          todo, tick one, write a note, park or finish a task, set a plan or a day.
        </p>
        <p class="quiet faint">
          Answers come from Claude Code (Sonnet) reading your Ledge records. It can run
          <code>ledge</code> and nothing else, so it cannot touch code or git.
        </p>
      </div>
    {/if}
    {#each chat.turns as turn (turn.id)}
      <article class="turn" data-status={turn.status}>
        <p class="q selectable">{turn.question}</p>
        <div class="a">
          {#if turn.status === 'thinking'}
            <p class="thinking quiet" role="status">
              <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              Thinking
            </p>
          {/if}
          {#if turn.answer}
            {#each paragraphs(turn.answer) as para, i (i)}
              <p class="answer selectable">{para}</p>
            {/each}
          {/if}
          {#if turn.status === 'cancelled'}
            <p class="quiet faint">Stopped.</p>
          {/if}
          {#if turn.error}
            <p class="edit-error" role="alert">{turn.error}</p>
          {/if}
          {#if turn.commands.length > 0}
            <ul class="ran" aria-label="Commands Ledge ran">
              {#each turn.commands as c (c.id)}
                <li class:failed={c.ok === false}>
                  <span class="mark" aria-hidden="true">{c.ok === false ? '✕' : '›'}</span>
                  <code class="mono">{c.command}</code>
                  {#if c.ok === false}<span class="sub">refused or failed</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </article>
    {/each}
  </div>

  <form
    class="compose"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <label for="ask-field" class="visually-hidden">Your question</label>
    <textarea
      id="ask-field"
      class="field selectable"
      rows="2"
      bind:this={field}
      bind:value={draft}
      onkeydown={onKeydown}
      placeholder="What should I pick up next?"
      spellcheck="true"
    ></textarea>
    {#if chat.busy}
      <button type="button" class="btn motion" onclick={cancelAsk}>Stop</button>
    {:else}
      <button type="submit" class="btn primary motion" disabled={draft.trim() === ''}>Ask</button>
    {/if}
  </form>
</Overlay>

<style>
  .head-btn {
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
  }
  .head-btn:hover {
    background: var(--control);
    color: var(--text);
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 120px;
    padding: var(--space-3);
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .intro code {
    font-family: var(--font-mono);
  }
  .turn {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* The question is the person's own words, set as a quiet bubble to the right; the answer is
     the body text, full width, because it is the thing being read. */
  .q {
    align-self: flex-end;
    max-width: 85%;
    margin: 0;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--info-bg);
    color: var(--text);
    font-size: var(--fs-sm);
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .a {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .answer {
    margin: 0;
    font-size: var(--fs-base);
    line-height: var(--lh-prose);
    color: var(--text);
    overflow-wrap: anywhere;
    white-space: pre-line;
  }
  .ran {
    list-style: none;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
  }
  .ran li {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
    color: var(--text-muted);
  }
  .ran code {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .ran .mark {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--done-fg);
  }
  .ran li.failed .mark {
    color: var(--danger);
  }
  .thinking {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  @media (prefers-reduced-motion: no-preference) {
    .dots i {
      animation: blink 1s ease-in-out infinite;
    }
    .dots i:nth-child(2) {
      animation-delay: 150ms;
    }
    .dots i:nth-child(3) {
      animation-delay: 300ms;
    }
    @keyframes blink {
      0%,
      100% {
        opacity: 0.25;
      }
      50% {
        opacity: 1;
      }
    }
  }
  .compose {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--rule);
  }
  .compose .field {
    flex: 1;
    resize: none;
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
</style>
