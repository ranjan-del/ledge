<script lang="ts">
  /**
   * One message in the conversation. The person's words sit on the right in a bubble. The
   * assistant's sit on the left as light Markdown, with a quiet line under them naming the
   * model that answered, version and all. What it ran to get there stays out of sight: an
   * approval is drawn inline only while it waits for an answer, and a failed answer says why
   * and offers Retry.
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

  const user = $derived(message.role === 'user');
  /** Only an approval still waiting for a yes or no is shown; an answered one leaves no trace. */
  const open = $derived(message.approvals.filter((a) => !a.decision && !answered[a.id]));
  const waiting = $derived(streaming && message.text === '' && open.length === 0);
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

    {#each open as request (request.id)}
      <ApprovalCard
        {request}
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

    {#if message.model && !streaming}
      <p class="meta"><span class="model">{modelLabel(message.model, message.modelId)}</span></p>
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
    margin: 0;
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
