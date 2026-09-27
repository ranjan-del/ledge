<script lang="ts">
  /**
   * Draws an answer's light Markdown from the tree `lib/markdown.ts` reads it into. Every piece
   * is drawn as text, never as HTML, so nothing in an answer can become markup. Links open
   * through the caller, which sends them to the system browser rather than into the panel.
   */
  import { parseMarkdown, type Inline } from '../lib/markdown.ts';

  interface Props {
    text: string;
    /** Opens a link. Without it a link is drawn but a click does nothing. */
    onopenlink?: (href: string) => void;
  }

  let { text, onopenlink }: Props = $props();

  const blocks = $derived(parseMarkdown(text));

  function follow(event: MouseEvent, href: string) {
    event.preventDefault();
    onopenlink?.(href);
  }
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as node, i (i)}
    {#if node.type === 'text'}{node.text}{:else if node.type === 'code'}<code class="md-code">{node.text}</code>{:else if node.type === 'strong'}<strong>{@render inline(node.children)}</strong>{:else if node.type === 'em'}<em>{@render inline(node.children)}</em>{:else}<a
        class="md-link"
        href={node.href}
        title={node.href}
        rel="noreferrer noopener"
        target="_blank"
        onclick={(e) => follow(e, node.href)}>{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

<div class="md selectable">
  {#each blocks as block, i (i)}
    {#if block.type === 'p'}
      <p>{@render inline(block.inlines)}</p>
    {:else if block.type === 'heading'}
      <p class="md-heading"><strong>{@render inline(block.inlines)}</strong></p>
    {:else if block.type === 'code'}
      <pre class="md-pre"><code>{block.text}</code></pre>
    {:else if block.ordered}
      <ol start={block.start}>
        {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
      </ol>
    {:else}
      <ul>
        {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .md {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--fs-base);
    line-height: var(--lh-prose);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .md p,
  .md ul,
  .md ol,
  .md pre {
    margin: 0;
  }
  .md ul,
  .md ol {
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .md li::marker {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .md-heading {
    margin-top: var(--space-1) !important;
  }
  .md strong {
    font-weight: 650;
  }
  .md-code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--control);
    font-family: var(--font-mono);
    font-size: 0.88em;
  }
  .md-pre {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--control);
    border: 1px solid var(--surface-border);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre;
  }
  .md-link {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
  }
  .md-link:hover {
    text-decoration-color: var(--accent);
  }
</style>
