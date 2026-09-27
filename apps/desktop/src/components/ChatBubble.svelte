<script lang="ts">
  /**
   * One message in the conversation. The person's words sit on the right in a bubble. The
   * assistant's sit on the left as light Markdown, with a quiet line under them naming the
   * model that answered and a collapsible list of what it did, one tool call per line. An
   * approval the answer is waiting on is drawn inline, where it happened, and a failed answer
   * says why and offers Retry.
   */
  import type { ChatMessage } from '../lib/assistant/types.ts';
  import { modelLabel } from '../lib/assistant/router.ts';
  import ApprovalCard from './ApprovalCard.svelte';
  import Markdown from './Markdown.svelte';

  interface Props {
    message: ChatMessage;
    /** This is the answer being written right now. */
    streaming?: boolean;
    /** Approvals answered here that the engine has not echoed yet. */
    answered?: Record<string, 'approved' | 'denied'>;
    ondecide?: (approvalId: string, decision: 'approved' | 'denied', always: boolean) => void;
    onretry?: (messageId: string) => void;
    onopenlink?: (href: string) => void;
  }

  let { message, streaming = false, answered = {}, ondecide, onretry, onopenlink }: Props = $props();

  let toolsOpen = $state(false);

  const user = $derived(message.role === 'user');
  const running = $derived(message.tools.filter((t) => t.status === 'running'));
  const toolLabel = $derived.by(() => {
    const n = message.tools.length;
    if (running.length > 0) return running.length === n ? `Doing ${n === 1 ? '1 thing' : `${n} things`}` : `Did ${n - running.length} of ${n} things`;
    return n === 1 ? 'Did 1 thing' : `Did ${n} things`;
  });
  const waiting = $derived(streaming && message.text === '' && message.tools.length === 0 && message.approvals.length === 0);

  function glyph(status: string): string {
    if (status === 'done') return '✓';
    if (status === 'error') return '!';
    if (status === 'denied') return '✕';
    return '';
  }
</script>

{#if user}
  <div class="msg user">
    <p class="bubble selectable">{message.text}</p>
  </div>
{:else}
  <div class="msg assistant" aria-busy={streaming}>
    {#if waiting}
      <p class="thinking" aria-label="Thinking">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </p>
    {/if}
    {#if message.text !== ''}
      <div class="answer" class:streaming>
        <Markdown text={message.text} {onopenlink} />
      </div>
    {/if}

    {#each message.approvals as request (request.id)}
      <ApprovalCard
        {request}
        pending={answered[request.id]}
        ondecide={(d, always) => ondecide?.(request.id, d, always)}
      />
    {/each}

    {#if message.error}
      <div class="failed" role="alert">
        <p>{message.error}</p>
        {#if onretry}
          <button type="button" class="btn motion" onclick={() => onretry?.(message.id)}>Retry</button>
        {/if}
      </div>
    {/if}

    {#if message.model || message.tools.length > 0}
      <div class="meta">
        {#if message.model}
          <span class="model">{modelLabel(message.model)}</span>
        {/if}
        {#if message.tools.length > 0}
          {#if message.model}<span class="sep" aria-hidden="true">·</span>{/if}
          <button
            type="button"
            class="tools-toggle motion"
            aria-expanded={toolsOpen}
            onclick={() => (toolsOpen = !toolsOpen)}
          >
            {#if running.length > 0}<span class="spin" aria-hidden="true"></span>{/if}
            {toolLabel}
            <svg width="8" height="8" viewBox="0 0 10 10" class="turn" class:open={toolsOpen} aria-hidden="true">
              <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        {/if}
      </div>
      {#if toolsOpen && message.tools.length > 0}
        <ul class="tools" aria-label="What the assistant did">
          {#each message.tools as tool (tool.id)}
            <li class="tool {tool.status}">
              <span class="t-state" aria-label={tool.status}>
                {#if tool.status === 'running'}<span class="spin"></span>{:else}{glyph(tool.status)}{/if}
              </span>
              <span class="t-name">{tool.name}</span>
              <span class="t-sum mono selectable">{tool.summary}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .msg {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .msg p {
    margin: 0;
  }
  .user {
    align-items: flex-end;
    padding-left: 15%;
  }
  .bubble {
    max-width: 100%;
    padding: 6px var(--space-3);
    border-radius: 14px 14px 4px 14px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--fs-base);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .assistant {
    align-items: stretch;
    padding-right: 4%;
  }
  .thinking {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .failed {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--late-bg);
    color: var(--late-fg);
    font-size: var(--fs-sm);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: -2px;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .model {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .tools-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px;
    margin-left: -4px;
    border-radius: 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
  }
  .sep + .tools-toggle {
    margin-left: 0;
  }
  .tools-toggle:hover {
    color: var(--text-muted);
    background: var(--control);
  }
  .turn.open {
    transform: rotate(90deg);
  }
  .tools {
    list-style: none;
    margin: -2px 0 0;
    padding: var(--space-1) 0 var(--space-1) var(--space-2);
    border-left: 2px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tool {
    display: grid;
    grid-template-columns: 12px auto minmax(0, 1fr);
    align-items: baseline;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .t-state {
    font-weight: 700;
    color: var(--done-fg);
    text-align: center;
  }
  .tool.error .t-state {
    color: var(--danger);
  }
  .tool.denied .t-state {
    color: var(--text-faint);
  }
  .t-name {
    font-weight: 600;
  }
  .t-sum {
    overflow-wrap: anywhere;
    color: var(--text-muted);
  }
  .spin {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--text-faint);
    border-top-color: transparent;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dot {
      animation: pulse 1.1s ease-in-out infinite;
    }
    .dot:nth-child(2) {
      animation-delay: 0.15s;
    }
    .dot:nth-child(3) {
      animation-delay: 0.3s;
    }
    .spin {
      animation: spin 0.8s linear infinite;
    }
    .turn {
      transition: transform 140ms ease;
    }
    .answer.streaming :global(.md > :last-child)::after {
      content: '';
      display: inline-block;
      width: 6px;
      height: 1em;
      margin-left: 2px;
      vertical-align: -2px;
      border-radius: 1px;
      background: var(--accent);
      animation: caret 1s steps(2, start) infinite;
    }
    .msg {
      animation: msg-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
  }
  @keyframes pulse {
    0%,
    80%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes caret {
    to {
      visibility: hidden;
    }
  }
  @keyframes msg-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
