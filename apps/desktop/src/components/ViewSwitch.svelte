<script module lang="ts">
  /** One of the lists the TASKS surface can show, and how many things are in it. */
  export interface ViewOption {
    id: string;
    label: string;
    count: number;
  }
</script>

<script lang="ts">
  /**
   * The four lists the TASKS surface can show, as one row of pills: Live, Done, Backlog and
   * Pending. It exists because "current" was quietly answering two questions with one list, and
   * the finished work had nowhere to be seen at all except a count in the footer.
   *
   * It sits directly under the four surface tabs, so the two controls have to be told apart at
   * a glance or they read as one long mess of buttons. The tabs are the chrome: full width, on
   * a sunken track, a white pill for the one you are on. This is content: pills, left aligned,
   * no track, no more than the words need. Same family, different rank.
   *
   * IT IS ALSO WHERE A TASK CAN BE DROPPED. While a card is being dragged, each pill offers
   * itself as a destination, which is the explicit way to do what the sideways gesture does by
   * feel. Three of the four are a task's `status` and take the drop. Pending is not: it is
   * computed from the git scan, the repositories holding work that is neither committed nor
   * pushed, so there is no field on a task that could put one there. It says that instead of
   * taking the gesture and doing nothing, which is the only honest thing a refusal can do.
   * Whether a pill accepts is decided by the caller through `refusalFor`, because this component
   * knows about pills and not about tasks.
   */
  interface Props {
    options: ViewOption[];
    active: string;
    onchange: (id: string) => void;
    /**
     * A drag is in flight and this is the file being dragged, '' when none is. It is what turns
     * the pills into drop targets, and it is a prop rather than read from the drag module so
     * this component stays testable without a gesture.
     */
    dragFile?: string;
    /** Why this view would refuse the task being dragged, or undefined when it would take it. */
    refusalFor?: (view: string) => string | undefined;
    /** The task being dragged was dropped on this view, and this view accepts it. */
    ondropview?: (view: string) => void;
  }

  let { options, active, onchange, dragFile = '', refusalFor, ondropview }: Props = $props();

  const dropping = $derived(dragFile !== '' && refusalFor !== undefined);
  /** The pill the pointer is over mid-drag, so it can show whether it will take the drop. */
  let hover = $state('');
  /** The refusal from the last drop, kept until the next gesture starts or a pill is pressed. */
  let refused = $state('');

  /* A new gesture clears the last answer: the line belongs to one drop, not to the session. */
  $effect(() => {
    if (dragFile !== '') refused = '';
    else hover = '';
  });

  function onDragOver(event: DragEvent, id: string) {
    if (!dropping) return;
    /* Every pill takes the dragover, the refusing one included. A target that will not even
       accept the pointer cannot say why, and "nothing happens" is what this is here to fix. */
    event.preventDefault();
    hover = id;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = refusalFor?.(id) === undefined ? 'move' : 'none';
    }
  }

  function onDrop(event: DragEvent, id: string) {
    if (!dropping) return;
    event.preventDefault();
    hover = '';
    const refusal = refusalFor?.(id);
    if (refusal !== undefined) {
      refused = refusal;
      return;
    }
    ondropview?.(id);
  }
</script>

<div class="wrap">
  <div class="views" role="group" aria-label="Task view">
    {#each options as option (option.id)}
      <button
        type="button"
        class="view motion"
        class:target={dropping && hover === option.id && refusalFor?.(option.id) === undefined}
        class:no={dropping && hover === option.id && refusalFor?.(option.id) !== undefined}
        aria-pressed={option.id === active}
        ondragover={(e) => onDragOver(e, option.id)}
        ondragleave={() => (hover = hover === option.id ? '' : hover)}
        ondrop={(e) => onDrop(e, option.id)}
        onclick={() => {
          refused = '';
          onchange(option.id);
        }}
      >
        {option.label}
        <span class="count" aria-label="{option.count} items">{option.count}</span>
      </button>
    {/each}
  </div>
  {#if refused}
    <p class="refused" role="alert">{refused}</p>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .views {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .view {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-faint);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .view:hover {
    color: var(--text-muted);
  }
  .view[aria-pressed="true"] {
    background: var(--control);
    color: var(--text);
  }
  /* Mid-drag: which pill the task would land in, and which one will not have it. The ring is
     inset so a pill cannot grow and shove the row along as the pointer crosses it. */
  .view.target {
    box-shadow: inset 0 0 0 2px var(--accent);
    color: var(--text);
  }
  .view.no {
    box-shadow: inset 0 0 0 2px var(--danger);
    color: var(--danger);
  }
  /* The reason, under the pills rather than on them: it is a sentence, and a pill is a word. */
  .refused {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.4;
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    opacity: 0.72;
  }
</style>
