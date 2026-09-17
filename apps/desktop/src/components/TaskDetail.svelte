<script lang="ts">
  /**
   * The whole of one task, inside the panel, and it opens with the facts rather than with
   * prose. The block under the title is everything the git scan and the file itself already
   * know and nobody has to read a paragraph to find: where the repository is, whether it is up
   * to date with its remote, how much is uncommitted, how far ahead and behind the branch is,
   * which branch that is, the day it is planned for and the day it was created. Every row is
   * quoted from the scan or from the frontmatter; a row whose source is silent is left out
   * rather than filled in.
   *
   * Under the facts sit the bodies of text, each behind its own disclosure and all of them
   * closed: Requirement, what has to be true; Plan, what was decided about it; Today's work,
   * the note written today; References, the raw material pasted in while the work happens.
   * They are closed because the owner reads them when the owner wants to, and because the
   * thing this view is opened for is the checklist under them.
   *
   * The checklist is grouped into remaining and done with a count on each, and shows the next
   * three outstanding items with the rest one press away, so a task with thirty open items is
   * still a screen you can use.
   *
   * EDITING. Every one of those is editable here, because the alternative was opening the
   * Markdown file in another program to fix a word. The title, the requirement, each plan step,
   * each checklist item, today's note and the references can all be changed in place, and
   * steps and items can be added, removed and, for the plan, reordered. Four rules hold
   * throughout:
   *
   * - One write, one changed field. Every save is `{ ...task, <the one field> }` handed to
   *   `serializeTask`, so the frontmatter keys Ledge does not model, the sections it does not
   *   parse and every other section of the file are written back exactly as they were read. A
   *   value that has not actually changed is not written at all.
   * - An edit in progress survives a file watcher event. The store re-reads the file when the
   *   watcher fires and hands this component a new `task`; what is being typed lives inside the
   *   open `FieldEdit`, seeded once when the editor opened and never re-derived from the task,
   *   so a re-render cannot overwrite it. The editor is never keyed on task content, which is
   *   the other half of the same guarantee.
   * - Nothing destructive happens without a second press. Removing a plan step or a checklist
   *   item asks in place, the same way Delete does, and for the same reason: a native
   *   `confirm()` on a panel that hides when it loses focus is a trap.
   * - A refused write is said out loud, where it happened, with the typed text still in the
   *   field. Nothing typed is ever discarded to report a failure.
   *
   * Ticking an item serializes the whole task with that item flipped and hands the Markdown to
   * `onsave(file, markdown)`; the store writes it and the watcher confirms; the item strikes
   * through and settles so the change is felt rather than merely reported. `home` is what a `~`
   * in `repo` stands for, so the file keeps the short form it was written with.
   *
   * Actions: Resume or Open in Claude, Park, Mark done, Open folder, and Delete.
   */
  import { appendNote, serializeTask, setPlan, type RepoStatus, type Task } from '@ledge/core/pure';
  import { reducedMotion } from '../lib/motion.svelte.ts';
  import { paragraphs } from '../lib/prose.ts';
  import { appendReference } from '@ledge/core/pure';
  import { dayLabel, daysBetween, lateLabel, relativeTime, todayIso } from '../lib/time.ts';
  import ConfirmButton from './ConfirmButton.svelte';
  import FieldEdit from './FieldEdit.svelte';
  import Progress from './Progress.svelte';

  /** Outstanding items shown before the rest are folded behind one line. */
  const OPEN_SHOWN = 3;
  /** Lines of pasted references shown before the rest are folded behind one line. */
  const REF_LINES = 12;

  interface Props {
    task: Task;
    status?: RepoStatus;
    /** The user's home folder; an empty string writes every path in full. */
    home?: string;
    /** Today as YYYY-MM-DD. A prop so this is testable without touching the clock. */
    day?: string;
    onback: () => void;
    /**
     * Writes the task file. May return a promise, and may reject: a rejection is shown in
     * place and the editor that caused it stays open with what was typed still in it.
     */
    onsave: (file: string, markdown: string) => void | Promise<void>;
    onpark?: (task: Task, reason: string) => void;
    ondone?: (task: Task) => void;
    onresume?: (task: Task, resume: boolean) => void;
    onopenfolder?: (task: Task) => void;
    /** Deletes the task and its file for good. Asked twice before it is called. */
    ondelete?: (task: Task) => void;
  }

  let {
    task,
    status,
    home = '',
    day = todayIso(),
    onback,
    onsave,
    onpark,
    ondone,
    onresume,
    onopenfolder,
    ondelete,
  }: Props = $props();

  /** Which single piece of text is open for editing. At most one at a time, deliberately. */
  type Editing =
    | { kind: 'title' }
    | { kind: 'requirement' }
    | { kind: 'note' }
    | { kind: 'note-edit' }
    | { kind: 'step'; index: number }
    | { kind: 'new-step' }
    | { kind: 'item'; index: number }
    | { kind: 'new-item' }
    | { kind: 'references' }
    | { kind: 'new-reference' };

  let parking = $state(false);
  let reason = $state('');
  /* Every body of text starts closed. The owner's rule for this view: if I want I will read it. */
  let open = $state({
    requirement: false,
    plan: false,
    today: false,
    references: false,
    earlier: false,
  });
  /* The rest of the outstanding items, once they have been asked for. */
  let allItems = $state(false);
  /* The rest of the pasted references, once they have been asked for. */
  let allRefs = $state(false);
  let editing = $state<Editing | null>(null);
  /** Why the open editor's last attempt was refused. Shown inside that editor. */
  let editError = $state<string | null>(null);
  /** Why a write with no editor open was refused, and which block it belonged to. */
  let saveError = $state<{ where: string; text: string } | null>(null);
  /* Bumped after a successful add, so the next add starts from an empty field rather than
     from the text just saved. Nothing else re-creates an editor, which is what keeps a draft
     safe from the watcher. */
  let addKey = $state(0);
  /* The index the person just clicked, so the strike-through animation plays exactly once,
     where they clicked it, and never again when the file comes back from the watcher. */
  let ticked = $state<number | null>(null);
  let settle: ReturnType<typeof setTimeout> | null = null;

  /* Both lists keep the index into task.checklist, since that is what a toggle writes back. */
  const numbered = $derived(task.checklist.map((item, index) => ({ item, index })));
  const remaining = $derived(numbered.filter((e) => !e.item.done));
  const finished = $derived(numbered.filter((e) => e.item.done));
  const shownRemaining = $derived(allItems ? remaining : remaining.slice(0, OPEN_SHOWN));
  const moreRemaining = $derived(Math.max(0, remaining.length - shownRemaining.length));
  const lastSession = $derived(task.sessions[task.sessions.length - 1]);
  /* Built as one string: a template with a block in it leaves a space before the comma. */
  const sessionLine = $derived(
    `${task.sessions.length} session${task.sessions.length === 1 ? '' : 's'}` +
      (lastSession ? `, last ${lastSession}` : ''),
  );
  /** The note written today, which is what "today's work" means and all it means. */
  const todayNote = $derived(task.notes.find((n) => n.date === day));
  /** Every other dated note, newest first. On screen the newest is the one you need first. */
  const earlier = $derived([...task.notes].reverse().filter((n) => n.date !== day));
  /** The pasted raw material, exactly as it sits in the file. */
  const references = $derived(task.references);
  const refLines = $derived(references === '' ? [] : references.split('\n'));
  const shownRefs = $derived(
    allRefs ? references : refLines.slice(0, REF_LINES).join('\n'),
  );
  const moreRefLines = $derived(Math.max(0, refLines.length - REF_LINES));
  /* Whatever the file holds that is not a section Ledge knows about, the references aside. */
  const rest = $derived(task.extra);
  const behind = $derived(task.planned ? daysBetween(task.planned, day) : undefined);

  /**
   * Where the branch stands against its remote, in the words the scan can support. A branch
   * with no upstream is not "behind": it has nowhere to be behind, and saying so is the honest
   * answer. Undefined when the repository has not been scanned, so the row is left out rather
   * than guessed at.
   */
  const remoteLine = $derived.by(() => {
    if (!status) return undefined;
    if (!status.upstream) return 'no remote branch';
    if (status.ahead === 0 && status.behind === 0) return `up to date with ${status.upstream}`;
    return `out of step with ${status.upstream}`;
  });

  /**
   * Turns anything thrown into readable text. The filesystem plugin rejects with a plain
   * string rather than an Error, so reading `.message` blindly renders "undefined" and hides
   * the only clue about what actually failed.
   */
  function message(e: unknown): string {
    if (e instanceof Error && e.message) return e.message;
    if (typeof e === 'string' && e !== '') return e;
    if (e && typeof e === 'object') {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string' && m !== '') return m;
    }
    return String(e);
  }

  function startEdit(next: Editing) {
    editing = next;
    editError = null;
    saveError = null;
  }

  function stopEdit() {
    editing = null;
    editError = null;
  }

  /**
   * Serializes one changed task and hands it to the store. True when it landed. A refusal is
   * reported where it happened: inside the open editor, or against `where` when the write came
   * from a button rather than a field.
   */
  async function write(next: Task, where: string | null = null): Promise<boolean> {
    editError = null;
    saveError = null;
    try {
      await onsave(task.file, serializeTask(next, { home }));
      return true;
    } catch (e) {
      const text = `Could not save: ${message(e)}`;
      if (where === null) editError = text;
      else saveError = { where, text };
      return false;
    }
  }

  function toggle(index: number, done: boolean) {
    if (done && !reducedMotion()) {
      ticked = index;
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        ticked = null;
      }, 320);
    }
    const checklist = task.checklist.map((item, i) => (i === index ? { ...item, done } : item));
    void write({ ...task, checklist }, 'checklist');
  }

  /* ---------------------------------------------------------------- title */

  async function commitTitle(text: string) {
    const title = text.trim();
    if (title === '') {
      editError = 'A task needs a title, so this one was not saved.';
      return;
    }
    if (title === task.title) {
      stopEdit();
      return;
    }
    if (await write({ ...task, title })) stopEdit();
  }

  /* ---------------------------------------------------------------- requirement */

  async function commitRequirement(text: string) {
    const requirement = text.trim();
    if (requirement === task.requirement) {
      stopEdit();
      return;
    }
    if (await write({ ...task, requirement })) stopEdit();
  }

  /* ---------------------------------------------------------------- plan */

  async function commitStep(index: number, text: string) {
    const step = text.trim();
    if (step === '') {
      editError = 'A step needs some words. Remove it instead.';
      return;
    }
    if (step === task.plan[index]) {
      stopEdit();
      return;
    }
    const steps = task.plan.map((s, i) => (i === index ? step : s));
    if (await write(setPlan(task, steps))) stopEdit();
  }

  async function commitNewStep(text: string) {
    const step = text.trim();
    if (step === '') {
      stopEdit();
      return;
    }
    if (await write(setPlan(task, [...task.plan, step]))) {
      addKey += 1;
      stopEdit();
    }
  }

  function removeStep(index: number) {
    void write(
      setPlan(
        task,
        task.plan.filter((_, i) => i !== index),
      ),
      'plan',
    );
  }

  /** Moves one step by one place. The bounds are checked here so the buttons can be simple. */
  function moveStep(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= task.plan.length) return;
    const steps = [...task.plan];
    const [moved] = steps.splice(index, 1);
    if (moved === undefined) return;
    steps.splice(to, 0, moved);
    void write(setPlan(task, steps), 'plan');
  }

  /* ---------------------------------------------------------------- checklist */

  async function commitItem(index: number, text: string) {
    const next = text.trim();
    if (next === '') {
      editError = 'An item needs some words. Remove it instead.';
      return;
    }
    if (next === task.checklist[index]?.text) {
      stopEdit();
      return;
    }
    const checklist = task.checklist.map((item, i) =>
      i === index ? { ...item, text: next } : item,
    );
    if (await write({ ...task, checklist })) stopEdit();
  }

  async function commitNewItem(text: string) {
    const next = text.trim();
    if (next === '') {
      stopEdit();
      return;
    }
    const checklist = [...task.checklist, { text: next, done: false }];
    if (await write({ ...task, checklist })) {
      addKey += 1;
      stopEdit();
    }
  }

  function removeItem(index: number) {
    void write(
      { ...task, checklist: task.checklist.filter((_, i) => i !== index) },
      'checklist',
    );
  }

  /* ---------------------------------------------------------------- today's note */

  async function commitNote(text: string) {
    const body = text.trim();
    if (body === '') {
      stopEdit();
      return;
    }
    /* `appendNote` is what keeps the dated structure the file format defines: it finds today's
       subsection or makes one at the end, and copies every other entry through untouched. */
    if (await write(appendNote(task, body, day))) {
      addKey += 1;
      stopEdit();
    }
  }

  /**
   * Rewrites today's entry and only today's. Every other dated note is copied through by
   * identity, so correcting a word written this morning cannot reach last week's reasoning.
   */
  async function commitNoteEdit(text: string) {
    const body = text.trim();
    if (body === (todayNote?.body ?? '')) {
      stopEdit();
      return;
    }
    const notes = task.notes
      .map((note) => (note.date === day ? { ...note, body } : note))
      .filter((note) => note.body.trim() !== '');
    if (await write({ ...task, notes })) stopEdit();
  }

  /* ---------------------------------------------------------------- references */

  async function commitReference(text: string) {
    if (text.trim() === '') {
      stopEdit();
      return;
    }
    /* Appended exactly as pasted: no trimming of what is inside it, no reformatting. */
    if (await write(appendReference(task, text))) {
      addKey += 1;
      stopEdit();
    }
  }

  async function commitReferences(text: string) {
    if (text === references) {
      stopEdit();
      return;
    }
    if (await write({ ...task, references: text })) stopEdit();
  }

  /* ---------------------------------------------------------------- chrome */

  /** Opens a fold and starts the editor that belongs to it, in one press. */
  function openAndEdit(fold: keyof typeof open, next: Editing) {
    open[fold] = true;
    startEdit(next);
  }

  function submitPark() {
    if (!onpark) return;
    onpark(task, reason.trim() || 'Parked from the panel');
    parking = false;
    reason = '';
  }
</script>

<section class="detail" aria-labelledby="detail-title">
  <span id="edit-hint" class="visually-hidden">Press to edit this text</span>
  <button type="button" class="back" onclick={onback}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    Back
  </button>

  <header>
    {#if editing?.kind === 'title'}
      <!-- The heading stays in the tree while the field replaces it on screen: it is what
           names this whole region, and a region that loses its name mid-edit is worse than
           one whose name is briefly invisible. -->
      <h2 id="detail-title" class="title visually-hidden">{task.title}</h2>
      <FieldEdit
        value={task.title}
        label="Task title"
        saveLabel="Rename"
        hint="Enter saves, Escape cancels"
        error={editError}
        oncommit={commitTitle}
        oncancel={stopEdit}
      />
    {:else}
      <h2 id="detail-title" class="title">
        <button
          type="button"
          class="title-edit motion"
          aria-describedby="edit-hint"
          onclick={() => startEdit({ kind: 'title' })}
        >{task.title}</button>
      </h2>
    {/if}
    <div class="meta">
      <span class="chip neutral">{task.status}</span>
      {#if task.planned && behind !== undefined && behind > 0}
        <span class="chip late">{lateLabel(task.planned, day)}</span>
      {:else if task.planned}
        <span class="chip neutral">planned {dayLabel(task.planned, day)}</span>
      {/if}
    </div>
    {#if task.parked}
      <p class="quiet parked">Parked: {task.parked}</p>
    {/if}
    {#if saveError?.where === 'top'}
      <p class="edit-error" role="alert">{saveError.text}</p>
    {/if}
  </header>

  <!--
    The facts, first, because they are what the view is opened to check and none of them takes
    a sentence to say. Nothing here is computed from anything but the last git scan and the
    task's own frontmatter.
  -->
  <dl class="facts selectable">
    {#if task.repo}
      <div class="fact">
        <dt>Repository</dt>
        <dd class="path mono">{task.repo}</dd>
      </div>
    {/if}
    {#if status}
      <div class="fact">
        <dt>Branch</dt>
        <dd class="mono">{status.branch}</dd>
      </div>
      <div class="fact">
        <dt>Remote</dt>
        <dd class:warn={status.upstream === undefined}>{remoteLine}</dd>
      </div>
      <div class="fact">
        <dt>Ahead</dt>
        <dd class:warn={status.ahead > 0}>
          {status.ahead} {status.ahead === 1 ? 'commit' : 'commits'} not pushed
        </dd>
      </div>
      <div class="fact">
        <dt>Behind</dt>
        <dd>{status.behind} {status.behind === 1 ? 'commit' : 'commits'} to pull</dd>
      </div>
      <div class="fact">
        <dt>Uncommitted</dt>
        <dd class:warn={status.dirty.length > 0}>
          {status.dirty.length} {status.dirty.length === 1 ? 'change' : 'changes'}
        </dd>
      </div>
    {:else if task.repo}
      <div class="fact">
        <dt>Git</dt>
        <dd class="faint">not scanned yet</dd>
      </div>
    {/if}
    {#if task.planned}
      <div class="fact">
        <dt>Planned</dt>
        <dd>
          {dayLabel(task.planned, day)}
          {#if behind !== undefined && behind > 0}<span class="faint">
              ({lateLabel(task.planned, day)})
            </span>{/if}
        </dd>
      </div>
    {/if}
    <div class="fact">
      <dt>Created</dt>
      <dd>{dayLabel(task.created.slice(0, 10), day)}</dd>
    </div>
  </dl>

  <div class="folds">
    <section class="fold">
      <h3 class="fold-row">
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.requirement}
          aria-controls="fold-requirement"
          onclick={() => (open.requirement = !open.requirement)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.requirement}
            aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Requirement
        </button>
        <button
          type="button"
          class="fold-tool motion"
          aria-label="Edit the requirement"
          onclick={() => openAndEdit('requirement', { kind: 'requirement' })}
        >
          Edit
        </button>
      </h3>
      <div class="fold-body" id="fold-requirement" hidden={!open.requirement}>
        {#if editing?.kind === 'requirement'}
          <FieldEdit
            value={task.requirement}
            label="Requirement"
            placeholder="What has to be true when this is finished?"
            multiline
            rows={6}
            hint="Leaving the field saves it"
            error={editError}
            oncommit={commitRequirement}
            oncancel={stopEdit}
          />
        {:else if task.requirement}
          {#each paragraphs(task.requirement) as para, i (i)}
            <p class="prose selectable">{para}</p>
          {/each}
        {:else}
          <p class="quiet faint">No requirement written.</p>
        {/if}
      </div>
    </section>

    <section class="fold">
      <h3 class="fold-row">
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.plan}
          aria-controls="fold-plan"
          onclick={() => (open.plan = !open.plan)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.plan} aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Plan
          {#if task.plan.length > 0}<span class="count">
              {task.plan.length} {task.plan.length === 1 ? 'step' : 'steps'}
            </span>{/if}
        </button>
        <button
          type="button"
          class="fold-tool motion"
          aria-label="Add a plan step"
          onclick={() => openAndEdit('plan', { kind: 'new-step' })}
        >
          Add
        </button>
      </h3>
      <div class="fold-body" id="fold-plan" hidden={!open.plan}>
        {#if task.plan.length > 0}
          <ol class="plan-list selectable">
            {#each task.plan as step, i (i)}
              <li>{#if editing?.kind === 'step' && editing.index === i}<FieldEdit
                    value={step}
                    label={`Plan step ${i + 1}`}
                    multiline
                    rows={2}
                    error={editError}
                    oncommit={(text) => commitStep(i, text)}
                    oncancel={stopEdit}
                  />{:else}<button
                    type="button"
                    class="line-edit"
                    aria-describedby="edit-hint"
                    onclick={() => startEdit({ kind: 'step', index: i })}
                  >{step}</button><span class="tools"><button
                      type="button"
                      class="drop tool motion"
                      aria-label={`Move step ${i + 1} up`}
                      disabled={i === 0}
                      onclick={() => moveStep(i, -1)}
                    ><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor"
                          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      </svg></button><button
                      type="button"
                      class="drop tool motion"
                      aria-label={`Move step ${i + 1} down`}
                      disabled={i === task.plan.length - 1}
                      onclick={() => moveStep(i, 1)}
                    ><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor"
                          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      </svg></button><ConfirmButton
                      icon
                      label={`Remove step ${i + 1}`}
                      question="Remove this step?"
                      confirmLabel="Remove"
                      groupLabel={`Confirm removing step ${i + 1}`}
                      onconfirm={() => removeStep(i)}
                    /></span>{/if}</li>
            {/each}
          </ol>
        {:else if editing?.kind !== 'new-step'}
          <p class="quiet faint">No plan written.</p>
        {/if}
        {#if saveError?.where === 'plan'}
          <p class="edit-error" role="alert">{saveError.text}</p>
        {/if}
        {#if editing?.kind === 'new-step'}
          {#key addKey}
            <FieldEdit
              value=""
              label="New plan step"
              placeholder="What happens next?"
              multiline
              rows={2}
              saveLabel="Add step"
              error={editError}
              oncommit={commitNewStep}
              oncancel={stopEdit}
            />
          {/key}
        {:else if editing === null}
          <!-- One editor at a time, so the other ways in are not offered while one is open:
               pressing them would commit what is being typed on the way past. -->
          <button
            type="button"
            class="add-line motion"
            onclick={() => startEdit({ kind: 'new-step' })}
          >
            Add a step
          </button>
        {/if}
      </div>
    </section>

    <section class="fold">
      <h3 class="fold-row">
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.today}
          aria-controls="fold-today"
          onclick={() => (open.today = !open.today)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.today} aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Today's work
        </button>
        <button
          type="button"
          class="fold-tool motion"
          aria-label="Add to today's note"
          onclick={() => openAndEdit('today', { kind: 'note' })}
        >
          Add
        </button>
      </h3>
      <div class="fold-body" id="fold-today" hidden={!open.today}>
        {#if editing?.kind === 'note-edit'}
          <FieldEdit
            value={todayNote?.body ?? ''}
            label="Today's note"
            multiline
            rows={6}
            error={editError}
            oncommit={commitNoteEdit}
            oncancel={stopEdit}
          />
        {:else if todayNote}
          {#each paragraphs(todayNote.body) as para, i (i)}
            <p class="note-text selectable">{para}</p>
          {/each}
          {#if editing === null}
            <button
              type="button"
              class="add-line motion"
              onclick={() => startEdit({ kind: 'note-edit' })}
            >
              Edit today's note
            </button>
          {/if}
        {:else if editing?.kind !== 'note'}
          <p class="quiet faint">No note written today.</p>
        {/if}
        {#if saveError?.where === 'today'}
          <p class="edit-error" role="alert">{saveError.text}</p>
        {/if}
        {#if editing?.kind === 'note'}
          {#key addKey}
            <FieldEdit
              value=""
              label="New note for today"
              placeholder="What happened, and what was decided?"
              multiline
              rows={5}
              saveLabel="Add to today"
              error={editError}
              oncommit={commitNote}
              oncancel={stopEdit}
            />
          {/key}
        {:else if !todayNote && editing === null}
          <button
            type="button"
            class="add-line motion"
            onclick={() => startEdit({ kind: 'note' })}
          >
            Write today's note
          </button>
        {/if}
      </div>
    </section>

    <!--
      References: the raw material of the work. A message somebody sent, a link, an error, a
      snippet. It is shown exactly as it was pasted, never interpreted as Markdown, because the
      things people paste here are the things Markdown would eat: hashes, backticks, brackets.
      Adding another is the easy path; rewriting the whole block is the deliberate one.
    -->
    <section class="fold">
      <h3 class="fold-row">
        <button
          type="button"
          class="fold-head motion"
          aria-expanded={open.references}
          aria-controls="fold-references"
          onclick={() => (open.references = !open.references)}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.references}
            aria-hidden="true">
            <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          References
          {#if refLines.length > 0}<span class="count">
              {refLines.length} {refLines.length === 1 ? 'line' : 'lines'}
            </span>{/if}
        </button>
        <button
          type="button"
          class="fold-tool motion"
          aria-label="Add a reference"
          onclick={() => openAndEdit('references', { kind: 'new-reference' })}
        >
          Add
        </button>
      </h3>
      <div class="fold-body" id="fold-references" hidden={!open.references}>
        {#if editing?.kind === 'references'}
          <FieldEdit
            value={references}
            label="All references"
            multiline
            rows={10}
            error={editError}
            oncommit={commitReferences}
            oncancel={stopEdit}
          />
        {:else if references}
          <pre class="ref-text selectable">{shownRefs}</pre>
          {#if moreRefLines > 0}
            <button type="button" class="more-items motion" onclick={() => (allRefs = !allRefs)}>
              {allRefs
                ? 'Show the first twelve lines only'
                : `and ${moreRefLines} more ${moreRefLines === 1 ? 'line' : 'lines'}`}
            </button>
          {/if}
          {#if editing === null}
            <button
              type="button"
              class="add-line motion"
              onclick={() => startEdit({ kind: 'references' })}
            >
              Edit all references
            </button>
          {/if}
        {:else if editing?.kind !== 'new-reference'}
          <p class="quiet faint">Nothing pasted here yet.</p>
        {/if}
        {#if saveError?.where === 'references'}
          <p class="edit-error" role="alert">{saveError.text}</p>
        {/if}
        {#if editing?.kind === 'new-reference'}
          {#key addKey}
            <FieldEdit
              value=""
              label="New reference"
              placeholder="Paste a message, a link, an error, a snippet"
              multiline
              rows={6}
              saveLabel="Add reference"
              error={editError}
              oncommit={commitReference}
              oncancel={stopEdit}
            />
          {/key}
        {:else if editing === null}
          <button
            type="button"
            class="add-line motion"
            onclick={() => startEdit({ kind: 'new-reference' })}
          >
            Paste a reference
          </button>
        {/if}
      </div>
    </section>

    {#if earlier.length > 0}
      <section class="fold">
        <h3 class="fold-row">
          <button
            type="button"
            class="fold-head motion"
            aria-expanded={open.earlier}
            aria-controls="fold-earlier"
            onclick={() => (open.earlier = !open.earlier)}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" class:turn={open.earlier}
              aria-hidden="true">
              <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Earlier notes
            <span class="count">{earlier.length}</span>
          </button>
        </h3>
        <div class="fold-body notes" id="fold-earlier" hidden={!open.earlier}>
          {#each earlier as note, i (note.date + i)}
            <article class="note-card">
              <p class="note-date">
                {dayLabel(note.date, day)}
                {#if i === 0 && earlier.length > 1}<span>latest</span>{/if}
              </p>
              {#each paragraphs(note.body) as para, p (p)}
                <p class="note-text selectable">{para}</p>
              {/each}
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  <section>
    <h3 class="block-head">Checklist</h3>
    {#if task.checklist.length > 0}
      <Progress done={finished.length} total={task.checklist.length} />
    {/if}
    {#if saveError?.where === 'checklist'}
      <p class="edit-error" role="alert">{saveError.text}</p>
    {/if}
    {#if remaining.length > 0}
      <p class="group">Remaining <span>{remaining.length}</span></p>
      <ul class="checklist">
        {#each shownRemaining as entry (entry.index)}
          <li class:settling={ticked === entry.index}>
            {#if editing?.kind === 'item' && editing.index === entry.index}
              <FieldEdit
                value={entry.item.text}
                label={`Checklist item: ${entry.item.text}`}
                error={editError}
                oncommit={(text) => commitItem(entry.index, text)}
                oncancel={stopEdit}
              />
            {:else}
              <label class="motion">
                <input
                  type="checkbox"
                  checked={false}
                  onchange={(e) => toggle(entry.index, e.currentTarget.checked)}
                />
                <span>{entry.item.text}</span>
              </label>
              <span class="tools">
                <button
                  type="button"
                  class="drop tool motion"
                  aria-label={`Edit item: ${entry.item.text}`}
                  onclick={() => startEdit({ kind: 'item', index: entry.index })}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M8.3 1.7 10.3 3.7 4 10H2V8z" fill="none" stroke="currentColor"
                      stroke-width="1.3" stroke-linejoin="round" />
                  </svg>
                </button>
                <ConfirmButton
                  icon
                  label={`Remove item: ${entry.item.text}`}
                  question="Remove this item?"
                  confirmLabel="Remove"
                  groupLabel={`Confirm removing: ${entry.item.text}`}
                  onconfirm={() => removeItem(entry.index)}
                />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if moreRemaining > 0 || allItems}
        <!-- The quiet line that says how many more there are is also the way to them, so
             nothing is hidden behind a number you cannot act on. -->
        <button type="button" class="more-items motion" onclick={() => (allItems = !allItems)}>
          {allItems ? 'Show the next three only' : `and ${moreRemaining} more outstanding`}
        </button>
      {/if}
    {:else if task.checklist.length > 0}
      <p class="quiet ticked-all">Everything is ticked.</p>
    {/if}
    {#if finished.length > 0}
      <p class="group">Done <span>{finished.length}</span></p>
      <ul class="checklist">
        {#each finished as entry (entry.index)}
          <li class="ticked" class:settling={ticked === entry.index}>
            {#if editing?.kind === 'item' && editing.index === entry.index}
              <FieldEdit
                value={entry.item.text}
                label={`Checklist item: ${entry.item.text}`}
                error={editError}
                oncommit={(text) => commitItem(entry.index, text)}
                oncancel={stopEdit}
              />
            {:else}
              <label class="motion">
                <input
                  type="checkbox"
                  checked={true}
                  onchange={(e) => toggle(entry.index, e.currentTarget.checked)}
                />
                <span>{entry.item.text}</span>
              </label>
              <span class="tools">
                <button
                  type="button"
                  class="drop tool motion"
                  aria-label={`Edit item: ${entry.item.text}`}
                  onclick={() => startEdit({ kind: 'item', index: entry.index })}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M8.3 1.7 10.3 3.7 4 10H2V8z" fill="none" stroke="currentColor"
                      stroke-width="1.3" stroke-linejoin="round" />
                  </svg>
                </button>
                <ConfirmButton
                  icon
                  label={`Remove item: ${entry.item.text}`}
                  question="Remove this item?"
                  confirmLabel="Remove"
                  groupLabel={`Confirm removing: ${entry.item.text}`}
                  onconfirm={() => removeItem(entry.index)}
                />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if editing?.kind === 'new-item'}
      {#key addKey}
        <FieldEdit
          value=""
          label="New checklist item"
          placeholder="What has to be done?"
          saveLabel="Add item"
          error={editError}
          oncommit={commitNewItem}
          oncancel={stopEdit}
        />
      {/key}
    {:else if editing === null}
      <button
        type="button"
        class="add-line motion"
        onclick={() => startEdit({ kind: 'new-item' })}
      >
        Add an item
      </button>
    {/if}
  </section>

  {#if rest}
    <section>
      <h3 class="block-head">Also in the file</h3>
      <p class="quiet rest selectable">{rest}</p>
    </section>
  {/if}

  <p class="quiet faint">
    {sessionLine}
    <br />updated {relativeTime(task.updated)}
  </p>

  <div class="row-actions">
    {#if onresume}
      <button
        type="button"
        class="btn primary motion"
        onclick={() => onresume?.(task, Boolean(lastSession))}
      >
        {lastSession ? 'Resume in Claude' : 'Open in Claude'}
      </button>
    {/if}
    {#if onpark && task.status !== 'backlog'}
      <button type="button" class="btn motion" onclick={() => (parking = true)}>Park</button>
    {/if}
    {#if ondone}
      <button type="button" class="btn motion" onclick={() => ondone?.(task)}>Mark done</button>
    {/if}
    {#if onopenfolder && task.repo}
      <button type="button" class="btn motion" onclick={() => onopenfolder?.(task)}>
        Open folder
      </button>
    {/if}
    {#if ondelete}
      <ConfirmButton
        label="Delete"
        question="Delete this task?"
        confirmLabel="Delete"
        groupLabel="Confirm deleting this task"
        title="Delete the task and its file"
        onconfirm={() => ondelete?.(task)}
      />
    {/if}
  </div>

  {#if parking}
    <form class="row-actions park" onsubmit={(e) => { e.preventDefault(); submitPark(); }}>
      <label for="park-reason" class="visually-hidden">Reason for parking</label>
      <input id="park-reason" class="field" type="text" placeholder="Why is this parked?"
        bind:value={reason} />
      <button type="submit" class="btn primary motion">Park it</button>
      <button type="button" class="btn motion" onclick={() => (parking = false)}>Cancel</button>
    </form>
  {/if}
</section>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-1);
  }
  .title {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  /* The title is the control that edits the title, so it has to look like the title and
     answer to the pointer. A rule under it on hover, and nothing else. */
  .title-edit {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
  }
  .title-edit:hover {
    box-shadow: inset 0 -1px 0 var(--text-faint);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .parked {
    margin-top: var(--space-2);
  }

  /*
    The facts. A two column list rather than a row of chips, because these are values a person
    reads down and compares, and because the repository path has to be able to take a whole
    line to itself at 320 px without pushing anything off the edge.
  */
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-size: var(--fs-sm);
  }
  .fact {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .fact dt {
    flex: none;
    /* Wide enough for the longest label there is, UNCOMMITTED, so no label is ever clipped
       into the value beside it and every value in the block starts on the same line. */
    width: 88px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .fact dd {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .fact dd.path {
    line-height: 1.35;
  }
  .fact dd.faint,
  .fact .faint {
    color: var(--text-faint);
  }
  /* The two states work can be lost to, and the branch with nowhere to push to. Words carry
     the meaning; this only makes them the darker line in the block. */
  .fact dd.warn {
    color: var(--attention-fg);
    font-weight: 600;
  }

  /* The bodies of text, each closed until it is asked for. */
  .folds {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fold-row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0;
  }
  .fold-head {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .fold-head:hover {
    background: var(--surface);
    color: var(--text);
  }
  .fold-head svg {
    flex: none;
    color: var(--text-faint);
  }
  .fold-head svg.turn {
    transform: rotate(90deg);
  }
  .fold-head .count {
    margin-left: auto;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  /* The way into a section without reading it first. Quiet until it is wanted. */
  .fold-tool {
    flex: none;
    padding: 4px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  .fold-tool:hover {
    background: var(--surface);
    color: var(--accent);
  }
  .fold-body {
    padding: var(--space-1) var(--space-2) var(--space-2) 25px;
  }
  .fold-body.notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  @media (prefers-reduced-motion: no-preference) {
    .fold-head svg {
      transition: transform 140ms ease;
    }
  }

  .prose {
    margin: 0;
    line-height: var(--lh-prose);
    overflow-wrap: break-word;
  }
  .prose + .prose {
    margin-top: var(--space-2);
  }

  /*
    A plan step, and the three things that can be done to it. The row wraps, and the step keeps
    a floor under its width, because the tools are not always three small icons: when one of
    them asks "Remove this step?" the group is suddenly wider than the panel. Without the floor
    the step is squeezed to one letter per line and the question runs off the glass.
  */
  .plan-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-1);
  }
  /* Basis zero, floor eight rems. Flexbox decides where a line breaks from the basis, not from
     the shrunk width, so an `auto` basis here put the three small tools on their own line under
     every step. Zero keeps them beside the step, and the floor is what makes the row break when
     the tools become a question wider than the panel. */
  .line-edit {
    flex: 1 1 0;
    min-width: 8rem;
    text-align: left;
    line-height: 1.4;
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
  }
  .line-edit:hover {
    color: var(--accent);
  }
  .tools {
    flex: none;
    max-width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1px;
  }
  .tools :global(.tool) {
    width: 20px;
    height: 20px;
  }
  .tools :global(.tool:disabled) {
    opacity: 0.3;
    pointer-events: none;
  }

  .group {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .group span {
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .checklist li {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1px;
  }
  /* The same basis and the same floor as a plan step, for the same reasons. */
  .checklist label {
    display: flex;
    flex: 1 1 0;
    min-width: 8rem;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    line-height: 1.35;
  }
  .checklist label:hover {
    background: var(--surface-hover);
  }
  .checklist input {
    margin: 2px 0 0;
    accent-color: var(--done-fill);
  }
  .checklist li.ticked span {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .ticked-all {
    margin-top: var(--space-2);
    color: var(--done-fg);
  }
  /* A count, and the way to what it counts. Quiet, because most of the time the answer to
     "how many more" is all anybody wanted. */
  .more-items {
    align-self: flex-start;
    margin-top: var(--space-1);
    padding: 2px var(--space-2) 2px 0;
    font-size: var(--fs-xs);
    color: var(--text-faint);
  }
  .more-items:hover {
    color: var(--accent);
  }

  /* Notes are the session memory. They get prose measure, prose leading and a real date
     line, not a grey footnote at the bottom of the screen. */
  .note-date {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 3px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .note-date span {
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--text-faint);
  }
  /*
    Pasted material, shown as it was pasted. Monospace and pre-wrap say "this is quoted, not
    written", which is the whole promise of the section: a stack trace keeps its indentation
    and a line of Markdown stays a line of Markdown instead of becoming a heading. It wraps
    rather than scrolling sideways, because a panel 320 px wide has no room for two axes.
  */
  .ref-text {
    margin: 0;
    padding: var(--space-2);
    max-width: 100%;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  .rest {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .park .field {
    flex: 1;
    min-width: 140px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .checklist li {
      transition: opacity 160ms ease;
    }
    .checklist li.settling {
      animation: settle 320ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .checklist li.settling span {
      /* Draws the line on rather than switching it on. */
      animation: strike 260ms ease-out both;
    }
    @keyframes settle {
      0% {
        transform: translateY(0) scale(1);
      }
      35% {
        transform: translateY(-1.5px) scale(1.012);
      }
      100% {
        transform: translateY(0) scale(1);
      }
    }
    @keyframes strike {
      from {
        color: var(--text);
        text-decoration-color: transparent;
      }
      to {
        color: var(--text-muted);
        text-decoration-color: currentColor;
      }
    }
  }
</style>
