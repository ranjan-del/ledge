<script lang="ts">
  /**
   * One note, read at a glance: a bold title on one line, a muted summary of at most two lines,
   * and the original words behind a disclosure. It is the answer to notes that were walls of
   * text: the reasoning is still all there, in the file and one press away, but the first thing
   * the eye meets is what the note is about.
   *
   * The title and summary are a digest from `lib/digest.ts`, from the insights sidecar when it
   * holds a current entry and from the text itself when it does not. A title the model wrote is
   * marked as such, because Ledge keeps what the person wrote and what a model inferred apart.
   * The original is rendered only while it is open, so a closed digest is one line of text and
   * not a hidden copy of the whole note.
   */
  import type { Digest } from '../lib/digest.ts';
  import { paragraphs } from '../lib/prose.ts';

  interface Props {
    digest: Digest;
    /** The full original text, shown as written when the disclosure is open. */
    original: string;
    /** What the thing is called in the disclosure's label: "note", "step". */
    noun?: string;
  }

  let { digest, original, noun = 'note' }: Props = $props();

  let open = $state(false);
</script>

<div class="digest">
  <p class="d-title">
    <span>{digest.title}</span>
    {#if digest.fromInsight}
      <span class="d-ai" title="Title and summary written by a model from this {noun}">AI</span>
    {/if}
  </p>
  {#if digest.summary}
    <p class="d-sum">{digest.summary}</p>
  {/if}
  {#if digest.hasMore}
    <button
      type="button"
      class="d-more motion"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {open ? `Hide the full ${noun}` : `Show the full ${noun}`}
    </button>
    {#if open}
      <div class="d-full">
        {#each paragraphs(original) as para, i (i)}
          <p class="note-text selectable">{para}</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>
