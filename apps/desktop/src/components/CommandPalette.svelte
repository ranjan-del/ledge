<script lang="ts">
  /**
   * The command palette: one field, and everything on the desk that answers what is typed into
   * it. It exists because the search pill in the header and the key written on it were a
   * promise, and because the four surfaces are a good way to read the desk and a slow way to
   * reach one thing on it. Typing is the fastest route to a task, a session, a note or an
   * action, and this is the only control in the panel that does not need the mouse at all.
   *
   * What it shows comes from `lib/palette.ts` and nothing else: tasks by title, requirement,
   * checklist, plan and repository, session ids, dated notes through `searchMemory` in core,
   * and the handful of actions the panel already has a button for. There is no "ask" entry,
   * because no provider is wired and a row that cannot do what it says is worse than no row.
   *
   * Keyboard first, and that is a shape rather than a feature. The field holds the focus for
   * the whole life of the palette; up and down move a highlight through one flat list, so the
   * group headings are labels rather than stops; Enter runs the highlighted row; Escape closes.
   * The pointer can hover and click, and doing so moves the same highlight, so the two ways in
   * never disagree about which row is next.
   */
  import type { Task } from '@ledge/core/pure';
  import {
    buildPalette,
    flattenPalette,
    type PaletteCommand,
    type PaletteSurface,
  } from '../lib/palette.ts';
  import { todayIso } from '../lib/time.ts';
  import Overlay from './Overlay.svelte';

  interface Props {
    tasks: Task[];
    /** The surface you are on, so the palette does not offer to take you where you are. */
    surface: PaletteSurface;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    /** The modifier written in the hint, already spelled for this platform. */
    modifier?: string;
    onrun: (command: PaletteCommand) => void;
    onclose: () => void;
  }

  let { tasks, surface, day = todayIso(), modifier = '⌘', onrun, onclose }: Props = $props();

  let query = $state('');
  let active = $state(0);
  let field = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLElement | null>(null);

  const groups = $derived(buildPalette({ tasks, query, surface, day }));
  const items = $derived(flattenPalette(groups));

  /* The field takes the focus the moment the palette exists. Nothing else in here is
     focusable, which is what lets the arrow keys mean "move the highlight" rather than
     "move the focus". */
  $effect(() => {
    field?.focus();
  });

  /* A new query is a new list, so the highlight goes back to the top rather than pointing at
     whatever happens to be in that position now. */
  $effect(() => {
    query;
    active = 0;
  });

  /* Keeps the highlighted row on screen when the arrows walk past the bottom of the list.
     `nearest` scrolls by the least it can, so the list does not jump under the eye. */
  $effect(() => {
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  });

  function move(delta: number) {
    if (items.length === 0) return;
    active = (active + delta + items.length) % items.length;
  }

  function run(index: number) {
    const item = items[index];
    if (!item) return;
    onrun(item.command);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'Home') active = 0;
    else if (event.key === 'End') active = Math.max(0, items.length - 1);
    else if (event.key === 'Enter') run(active);
    else return;
    event.preventDefault();
  }
</script>

<Overlay label="Command palette" {onclose}>
  <div class="sheet-head head">
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5.2" cy="5.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M7.8 7.8 10.6 10.6" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round" />
    </svg>
    <input
      class="input selectable"
      type="text"
      role="combobox"
      bind:this={field}
      bind:value={query}
      onkeydown={onKeydown}
      placeholder="Search or run a command"
      aria-label="Search tasks, sessions and notes, or run a command"
      aria-expanded={items.length > 0}
      aria-controls="palette-list"
      aria-activedescendant={items[active] ? `palette-row-${active}` : undefined}
      autocomplete="off"
      spellcheck="false"
    />
    <span class="kbd">esc</span>
  </div>

  <div class="sheet-list list" id="palette-list" role="listbox" aria-label="Results" bind:this={list}>
    {#if items.length === 0}
      <p class="quiet">
        Nothing on the desk matches "{query}". Type a title and the first action creates it.
      </p>
    {:else}
      {#each groups as group (group.kind)}
        <div class="sheet-group" role="group" aria-label={group.label}>
          <h3 class="section-label">{group.label}</h3>
          {#each group.items as item (item.id)}
            {@const index = items.indexOf(item)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="sheet-row row"
              id="palette-row-{index}"
              role="option"
              tabindex="-1"
              aria-selected={index === active}
              onclick={() => run(index)}
              onmousemove={() => (active = index)}
            >
              <span class="what" class:mono={item.mono}>{item.label}</span>
              {#if item.sub}
                <span class="sub trunc">{item.sub}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  <p class="foot">
    <span><span class="kbd">↑</span> <span class="kbd">↓</span> move</span>
    <span><span class="kbd">↵</span> run</span>
    <span><span class="kbd">{modifier}K</span> close</span>
  </p>
</Overlay>

<style>
  /* The palette's head is the shared one, minus the right-hand padding the field fills. */
  .head {
    padding-right: var(--space-3);
    color: var(--text-faint);
  }
  /* The field is the sheet's top edge rather than a box inside it: a palette is a line you
     type on, and a bordered input in a bordered sheet is two frames around one thing. */
  .input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 2px 0;
    font-size: var(--fs-base);
    color: var(--text);
  }
  .input::placeholder {
    color: var(--text-faint);
  }
  .list {
    padding-bottom: var(--space-1);
  }
  .quiet {
    padding: var(--space-2) var(--space-1) var(--space-3);
  }
  /* One highlight, whether the arrows or the pointer put it there, so the list can never show
     two candidates for what Enter will do. */
  .row[aria-selected="true"] {
    background: var(--control);
  }
  .what {
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .what.mono {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-1) var(--space-3) 5px;
    border-top: 1px solid var(--rule);
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
</style>
