/**
 * Editing a task from the panel. Every test here asserts on the Markdown that reaches
 * `onsave`, because the file is the source of truth and a change that does not reach it did
 * not happen. Two things are checked over and over on purpose: that one edit writes one field
 * and leaves the rest of the file alone, and that what a person has typed is never thrown away
 * by anything the app does to itself.
 */
import { parseTask, type Task } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { DAY, HOME, taskA, taskC } from './fixtures.ts';

/** Lets the commit chain (a click, an await on onsave, a state change) finish. */
async function settle(): Promise<void> {
  await tick();
  await tick();
  await tick();
}

function open(task: Task = taskA(), onsave = vi.fn()) {
  const view = render(TaskDetail, {
    props: { task, day: DAY, home: HOME, onback: () => {}, onsave },
  });
  return { ...view, onsave };
}

/** The task as it would come back off disk after the one write the test just made. */
function saved(onsave: ReturnType<typeof vi.fn>, call = 0): Task {
  const [file, markdown] = onsave.mock.calls[call] as [string, string];
  return parseTask(markdown, file, { home: HOME });
}

async function type(el: HTMLElement, value: string): Promise<void> {
  await fireEvent.input(el, { target: { value } });
}

describe('TaskDetail, the title', () => {
  const TITLE = 'Release watch banner for stale tabs';

  it('turns into a field when the title itself is pressed', async () => {
    open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const field = screen.getByLabelText('Task title') as HTMLInputElement;
    expect(field.value).toBe(TITLE);
  });

  it('commits on Enter and writes only the title', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const field = screen.getByLabelText('Task title');
    await type(field, 'Release watch banner v2');
    await fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(onsave).toHaveBeenCalledTimes(1);
    const next = saved(onsave);
    expect(next.title).toBe('Release watch banner v2');
    expect(next.id).toBe('release-watch-banner');
    expect(next.checklist).toHaveLength(5);
    expect(next.requirement).toContain('Users keep old code in open tabs');
    expect(next.sessions).toEqual(['b13e8b5e', '071729a1']);
  });

  it('commits when focus leaves the field', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const field = screen.getByLabelText('Task title');
    await type(field, 'Renamed by blur');
    await fireEvent.blur(field);
    await settle();
    expect(saved(onsave).title).toBe('Renamed by blur');
  });

  it('takes Escape as cancel and writes nothing', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const field = screen.getByLabelText('Task title');
    await type(field, 'Never saved');
    await fireEvent.keyDown(field, { key: 'Escape' });
    await settle();
    expect(onsave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: TITLE })).toBeTruthy();
  });

  it('refuses an empty title, says why, and keeps the field open', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const field = screen.getByLabelText('Task title');
    await type(field, '   ');
    await fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(onsave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('needs a title');
    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('   ');
  });

  it('writes nothing at all when the title comes back unchanged', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: TITLE }));
    await fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Enter' });
    await settle();
    expect(onsave).not.toHaveBeenCalled();
  });
});

describe('TaskDetail, the requirement', () => {
  it('opens the section and the field together from the section head', async () => {
    const { container } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit the requirement' }));
    expect((container.querySelector('#fold-requirement') as HTMLElement).hidden).toBe(false);
    const field = screen.getByLabelText('Requirement') as HTMLTextAreaElement;
    expect(field.value).toContain('Users keep old code in open tabs');
  });

  it('does not write on a keystroke, and writes once on Save', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit the requirement' }));
    const field = screen.getByLabelText('Requirement');
    await type(field, 'One');
    await type(field, 'One and two');
    expect(onsave).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(onsave).toHaveBeenCalledTimes(1);
    const next = saved(onsave);
    expect(next.requirement).toBe('One and two');
    expect(next.checklist).toHaveLength(5);
  });

  it('keeps what was typed when the watcher re-reads the file mid-edit', async () => {
    const { onsave, rerender } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit the requirement' }));
    await type(screen.getByLabelText('Requirement'), 'Half a sentence that is not saved yet');

    /* What the store does when the file watcher fires: the same task, re-parsed, handed back
       with someone else's change in it. The draft must survive that untouched. */
    await rerender({
      task: { ...taskA(), requirement: 'Rewritten in another editor', updated: '2026-09-16T10:00:00+05:30' },
    });
    await settle();
    const field = screen.getByLabelText('Requirement') as HTMLTextAreaElement;
    expect(field.value).toBe('Half a sentence that is not saved yet');
    expect(onsave).not.toHaveBeenCalled();
  });

  it('says a refused write out loud and keeps the text', async () => {
    const onsave = vi.fn().mockRejectedValue('Permission denied');
    open(taskA(), onsave);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit the requirement' }));
    await type(screen.getByLabelText('Requirement'), 'Worth keeping');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Permission denied');
    expect((screen.getByLabelText('Requirement') as HTMLTextAreaElement).value).toBe(
      'Worth keeping',
    );
  });
});

describe('TaskDetail, the plan', () => {
  it('adds a step to a task that has none', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a plan step' }));
    await type(screen.getByLabelText('New plan step'), 'Write the build step');
    await fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await settle();
    expect(saved(onsave).plan).toEqual(['Write the build step']);
  });

  it('edits one step and leaves the others as they were', async () => {
    const { onsave } = open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Poll it on an interval and on window focus' }));
    await type(screen.getByLabelText('Plan step 2'), 'Poll it on focus only');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(saved(onsave).plan).toEqual([
      'Write version.json in the build step',
      'Poll it on focus only',
      'Show the banner and reload only when the tab is idle',
    ]);
  });

  it('asks before it removes a step, and removes it on the second press', async () => {
    const { onsave } = open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(onsave).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm removing step 1' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await settle();
    expect(saved(onsave).plan).toEqual([
      'Poll it on an interval and on window focus',
      'Show the banner and reload only when the tab is idle',
    ]);
  });

  it('takes Escape as no when it has asked about a step', async () => {
    const { onsave } = open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(onsave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeTruthy();
  });

  it('reorders a step from the keyboard-reachable move controls', async () => {
    const { onsave } = open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    await settle();
    expect(saved(onsave).plan).toEqual([
      'Write version.json in the build step',
      'Show the banner and reload only when the tab is idle',
      'Poll it on an interval and on window focus',
    ]);
  });

  it('will not move the first step up or the last step down', async () => {
    open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    expect((screen.getByRole('button', { name: 'Move step 1 up' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole('button', { name: 'Move step 3 down' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});

describe('TaskDetail, the checklist', () => {
  function longTask(): Task {
    const task = taskA();
    const extra = Array.from({ length: 6 }, (_, i) => ({
      text: `Extra item ${i + 1}`,
      done: false,
    }));
    return { ...task, checklist: [...task.checklist, ...extra] };
  }

  it('edits an item and keeps every other item and its tick', async () => {
    const { onsave } = open();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Edit item: Build step that writes version.json' }),
    );
    await type(screen.getByLabelText(/^Checklist item:/), 'Build step writes version.json');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    const next = saved(onsave);
    expect(next.checklist.map((i) => i.text)[2]).toBe('Build step writes version.json');
    expect(next.checklist.map((i) => i.done)).toEqual([true, true, false, false, false]);
  });

  it('asks before it removes an item, and removes it on the second press', async () => {
    const { onsave } = open();
    const name = 'Remove item: Build step that writes version.json';
    await fireEvent.click(screen.getByRole('button', { name }));
    expect(onsave).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await settle();
    const next = saved(onsave);
    expect(next.checklist).toHaveLength(4);
    expect(next.checklist.map((i) => i.text)).not.toContain('Build step that writes version.json');
  });

  it('adds an item to the end of the list', async () => {
    const { onsave } = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));
    await type(screen.getByLabelText('New checklist item'), 'Open the pull request');
    await fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await settle();
    const next = saved(onsave);
    expect(next.checklist).toHaveLength(6);
    expect(next.checklist[5]).toEqual({ text: 'Open the pull request', done: false });
  });

  it('adds the first item to a task whose checklist is empty', async () => {
    const { onsave } = open({ ...taskA(), checklist: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));
    await type(screen.getByLabelText('New checklist item'), 'Start somewhere');
    await fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await settle();
    expect(saved(onsave).checklist).toEqual([{ text: 'Start somewhere', done: false }]);
  });

  it('edits an item that was behind the show more control', async () => {
    const { onsave } = open(longTask());
    await fireEvent.click(screen.getByRole('button', { name: 'and 6 more outstanding' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Edit item: Extra item 6' }));
    await type(screen.getByLabelText(/^Checklist item:/), 'The last one, corrected');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    const next = saved(onsave);
    expect(next.checklist).toHaveLength(11);
    expect(next.checklist[10]?.text).toBe('The last one, corrected');
  });

  it('still ticks an item, which is what the view was built for', async () => {
    const { onsave } = open();
    await fireEvent.click(
      screen.getByRole('checkbox', { name: 'Build step that writes version.json' }),
    );
    await settle();
    expect(saved(onsave).checklist.map((i) => i.done)).toEqual([true, true, true, false, false]);
  });
});

describe("TaskDetail, today's work", () => {
  it('appends a note under today and leaves every earlier note alone', async () => {
    const { onsave } = open(taskC());
    await fireEvent.click(screen.getByRole('button', { name: "Add to today's note" }));
    await type(screen.getByLabelText("New note for today"), 'Poll landed, banner still quiet.');
    await fireEvent.click(screen.getByRole('button', { name: 'Add to today' }));
    await settle();
    const next = saved(onsave);
    expect(next.notes.map((n) => n.date)).toEqual(['2026-09-12', '2026-09-14', DAY]);
    expect(next.notes[2]?.body).toBe('Poll landed, banner still quiet.');
    expect(next.notes[0]?.body).toContain('Polling a static file beats a service worker');
    expect(next.notes[1]?.body).toContain('Chunk load errors are the safety net');
  });

  it('adds to the note already written today rather than replacing it', async () => {
    const task = { ...taskC(), notes: [...taskC().notes, { date: DAY, body: 'First thought.' }] };
    const { onsave } = open(task);
    await fireEvent.click(screen.getByRole('button', { name: "Add to today's note" }));
    await type(screen.getByLabelText("New note for today"), 'Second thought.');
    await fireEvent.click(screen.getByRole('button', { name: 'Add to today' }));
    await settle();
    const next = saved(onsave);
    expect(next.notes).toHaveLength(3);
    expect(next.notes[2]?.body).toBe('First thought.\n\nSecond thought.');
  });

  it("rewrites today's entry without touching the days before it", async () => {
    const task = { ...taskC(), notes: [...taskC().notes, { date: DAY, body: 'Typo heer.' }] };
    const { onsave } = open(task);
    await fireEvent.click(screen.getByRole('button', { name: /Today's work/ }));
    await fireEvent.click(screen.getByRole('button', { name: "Edit today's note" }));
    await type(screen.getByLabelText("Today's note"), 'Typo here.');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    const next = saved(onsave);
    expect(next.notes.map((n) => n.body)).toEqual([
      task.notes[0]?.body,
      task.notes[1]?.body,
      'Typo here.',
    ]);
  });
});

describe('TaskDetail, what an edit must never disturb', () => {
  /** A file with a frontmatter key and a body section that @ledge/core does not model. */
  const ODD = `---
id: odd-one
title: A task with more in it than Ledge knows
status: backlog
order: 1
sessions: []
created: 2026-09-10T09:00:00+05:30
updated: 2026-09-10T09:00:00+05:30
jira: TECHNOLOGY-4212
---

## Requirement

Nothing yet.

## Checklist

- [ ] Only item

## Rollout

Behind a flag for the first week.
`;

  it('keeps unknown frontmatter keys and unknown sections through an edit', async () => {
    const task = parseTask(ODD, `${HOME}/.ledge/tasks/2026-09-10-odd-one.md`, { home: HOME });
    const onsave = vi.fn();
    render(TaskDetail, {
      props: { task, day: DAY, home: HOME, onback: () => {}, onsave },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: 'A task with more in it than Ledge knows' }),
    );
    await type(screen.getByLabelText('Task title'), 'Renamed, everything else untouched');
    await fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Enter' });
    await settle();
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('jira: TECHNOLOGY-4212');
    expect(markdown).toContain('## Rollout');
    expect(markdown).toContain('Behind a flag for the first week.');
    const next = saved(onsave);
    expect(next.title).toBe('Renamed, everything else untouched');
    expect(next.status).toBe('backlog');
    expect(next.checklist).toEqual([{ text: 'Only item', done: false }]);
  });
});
