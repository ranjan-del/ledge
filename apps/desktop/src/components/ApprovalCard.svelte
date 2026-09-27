<script module lang="ts">
  /** The input as a person reads it: a shell command as a command, anything else as JSON. */
  export function prettyInput(input: unknown): string {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const o = input as Record<string, unknown>;
      if (typeof o.command === 'string') return o.command;
    }
    if (typeof input === 'string') return input;
    try {
      return JSON.stringify(input, null, 2) ?? '';
    } catch {
      return String(input);
    }
  }

</script>

<script lang="ts">
  /**
   * An action the assistant wants to take that counts as risky: what it wants to run, pretty
   * printed, why it needs a yes, and Approve or Cancel. Approve can carry "Always allow this
   * for this chat", which the engine remembers for this chat only. Once answered the card
   * shrinks to one line saying what was decided.
   */
  import type { ApprovalRequest } from '../lib/assistant/types.ts';

  interface Props {
    request: ApprovalRequest & { decision?: 'approved' | 'denied' };
    /** Answered here, before the engine has echoed the decision back. */
    pending?: 'approved' | 'denied';
    ondecide: (decision: 'approved' | 'denied', always: boolean) => void;
  }

  let { request, pending, ondecide }: Props = $props();

  let always = $state(false);

  const decision = $derived(request.decision ?? pending);

  const shown = $derived(prettyInput(request.input));
</script>

{#if decision}
  <p class="decided" class:denied={decision === 'denied'}>
    <span class="glyph" aria-hidden="true">{decision === 'approved' ? '✓' : '✕'}</span>
    <span class="trunc">{decision === 'approved' ? 'Approved' : 'Cancelled'}: {request.summary}</span>
  </p>
{:else}
  <div class="approval" role="group" aria-label="Approval needed: {request.summary}">
    <p class="a-head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.2 11 10.3H1Z" fill="none" stroke="currentColor" stroke-width="1.3"
          stroke-linejoin="round" />
        <path d="M6 4.6v2.6M6 8.7v.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
      Needs your OK
      <span class="a-tool mono">{request.tool}</span>
    </p>
    <p class="a-sum">{request.summary}</p>
    {#if shown && shown !== request.summary}
      <pre class="a-input selectable">{shown}</pre>
    {/if}
    <p class="a-why">{request.reason}</p>
    <label class="a-always">
      <input type="checkbox" bind:checked={always} />
      Always allow this for this chat
    </label>
    <div class="row-actions">
      <button type="button" class="btn primary motion" onclick={() => ondecide('approved', always)}>
        Approve
      </button>
      <button type="button" class="btn motion" onclick={() => ondecide('denied', false)}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .approval {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--attention-bg);
    border: 1px solid color-mix(in srgb, var(--attention-edge) 45%, transparent);
  }
  .approval p {
    margin: 0;
  }
  .a-head {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--attention-fg);
  }
  .a-tool {
    margin-left: auto;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    opacity: 0.85;
  }
  .a-sum {
    font-size: var(--fs-base);
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .a-input {
    margin: 2px 0 0;
    max-height: 140px;
    overflow: auto;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--field-bg);
    border: 1px solid var(--field-border);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .a-why {
    font-size: var(--fs-sm);
    line-height: 1.45;
    color: var(--text-muted);
  }
  .a-always {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 var(--space-1);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .a-always input {
    margin: 0;
    accent-color: var(--accent);
  }
  .decided {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    min-width: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--done-fg);
  }
  .decided.denied {
    color: var(--text-faint);
  }
  .glyph {
    flex: none;
  }
</style>
