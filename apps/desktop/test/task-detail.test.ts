import { parseTask } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { DAY, TASK_A_FILE, repoStatus, taskA, taskC } from './fixtures.ts';

function boxNamed(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement;
}

describe('TaskDetail', () => {
  it('renders requirement, checklist and sessions', () => {
    render(TaskDetail, {
      props: { task: taskA(), status: repoStatus(), onback: () => {}, onsave: () => {} },
    });
    const title = 'Release watch banner for stale tabs';
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(/Users keep old code in open tabs/)).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText(/2 sessions/)).toBeTruthy();
    expect(screen.getByText(/last 071729a1/)).toBeTruthy();
  });
});

describe('TaskDetail, the facts block', () => {
  function facts(container: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of container.querySelectorAll('.fact')) {
      const key = row.querySelector('dt')?.textContent?.trim() ?? '';
      out[key] = row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }
    return out;
  }

  it('leads with the facts, above every word of prose', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskC(), status: repoStatus(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    const block = container.querySelector('.facts') as HTMLElement;
    const folds = container.querySelector('.folds') as HTMLElement;
    expect(block.compareDocumentPosition(folds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states the repository in full, the branch, the remote and the counts', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskA(), status: repoStatus(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    expect(facts(container)).toEqual({
      Repository: '/home/t/code/app',
      Branch: 'feature/banner',
      Remote: 'out of step with origin/feature/banner',
      Ahead: '2 commits not pushed',
      Behind: '0 commits to pull',
      Uncommitted: '2 changes',
      Created: 'yesterday',
    });
  });

  it('says a branch is up to date only when it really is', () => {
    const clean = repoStatus({ ahead: 0, behind: 0, dirty: [] });
    const { container } = render(TaskDetail, {
      props: { task: taskA(), status: clean, day: DAY, onback: () => {}, onsave: () => {} },
    });
    expect(facts(container).Remote).toBe('up to date with origin/feature/banner');
  });

  it('will not call a branch with no upstream behind anything', () => {
    const local = repoStatus({ upstream: undefined, ahead: 0, behind: 0, dirty: [] });
    const { container } = render(TaskDetail, {
      props: { task: taskA(), status: local, day: DAY, onback: () => {}, onsave: () => {} },
    });
    expect(facts(container).Remote).toBe('no remote branch');
  });

  it('shows nothing it cannot source, and says so where the scan has not run', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskA(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    const rows = facts(container);
    expect(rows.Branch).toBeUndefined();
    expect(rows.Ahead).toBeUndefined();
    expect(rows.Uncommitted).toBeUndefined();
    expect(rows.Git).toBe('not scanned yet');
    /* taskA names no planned day, so there is no planned row to show. */
    expect(rows.Planned).toBeUndefined();
    expect(rows.Repository).toBe('/home/t/code/app');
  });

  it('gives the planned day and how late it is, when the file names one', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    /* The month name comes from the host locale, so match loosely on purpose. */
    expect(facts(container).Planned).toMatch(/11 Sept? \(4 days late\)/);
  });
});

describe('TaskDetail, the three collapsed sections', () => {
  const props = { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} };

  it('offers Requirement, Plan and Today’s work, every one of them closed', () => {
    const { container } = render(TaskDetail, { props });
    const heads = [...container.querySelectorAll('.fold-head')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(heads[0]).toBe('Requirement');
    expect(heads[1]).toBe('Plan 3 steps');
    expect(heads[2]).toBe("Today's work");
    for (const head of container.querySelectorAll('.fold-head')) {
      expect(head.getAttribute('aria-expanded')).toBe('false');
    }
    for (const body of container.querySelectorAll('.fold-body')) {
      expect((body as HTMLElement).hidden).toBe(true);
    }
  });

  it('opens one without opening the others', async () => {
    const { container } = render(TaskDetail, { props });
    await fireEvent.click(screen.getByRole('button', { name: /Requirement/ }));
    const bodies = [...container.querySelectorAll('.fold-body')] as HTMLElement[];
    expect(bodies[0].hidden).toBe(false);
    expect(bodies[1].hidden).toBe(true);
    expect(bodies[2].hidden).toBe(true);
    expect(screen.getByText(/Every app writes version.json at build/)).toBeTruthy();
  });

  it('puts today’s note under Today’s work, and says so when there is none', async () => {
    const withNote = { ...taskC(), notes: [{ date: DAY, body: 'Wrote the poll today.' }] };
    const { container, unmount } = render(TaskDetail, { props: { ...props, task: withNote } });
    await fireEvent.click(screen.getByRole('button', { name: /Today's work/ }));
    expect(container.querySelector('#fold-today')?.textContent).toContain('Wrote the poll today.');
    unmount();

    /* taskC's newest note is yesterday's, so today's section has nothing to show. */
    const quiet = render(TaskDetail, { props });
    await fireEvent.click(screen.getByRole('button', { name: /Today's work/ }));
    expect(quiet.container.querySelector('#fold-today')?.textContent).toContain(
      'No note written today',
    );
  });
});

describe('TaskDetail, the outstanding list', () => {
  /** taskA with eight items open, which is the shape that made the view too long. */
  function longTask() {
    const task = taskA();
    const extra = Array.from({ length: 6 }, (_, i) => ({ text: `Extra item ${i + 1}`, done: false }));
    return { ...task, checklist: [...task.checklist, ...extra] };
  }

  it('shows the next three and counts the rest', () => {
    render(TaskDetail, { props: { task: longTask(), onback: () => {}, onsave: () => {} } });
    /* Nine open items: three drawn, six counted, plus the two that are already ticked. */
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'and 6 more outstanding' })).toBeTruthy();
    expect(screen.queryByText('Extra item 6')).toBeNull();
  });

  it('shows the rest when the count is pressed, and folds them away again', async () => {
    render(TaskDetail, { props: { task: longTask(), onback: () => {}, onsave: () => {} } });
    await fireEvent.click(screen.getByRole('button', { name: 'and 6 more outstanding' }));
    expect(screen.getByText('Extra item 6')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(11);
    await fireEvent.click(screen.getByRole('button', { name: 'Show the next three only' }));
    expect(screen.queryByText('Extra item 6')).toBeNull();
  });

  it('counts nothing when three is the whole of what is left', () => {
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {} } });
    expect(screen.queryByRole('button', { name: /more outstanding/ })).toBeNull();
  });
});

describe('TaskDetail, actions', () => {

  it('groups the checklist into remaining and done with counts', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskA(), onback: () => {}, onsave: () => {} },
    });
    const groups = [...container.querySelectorAll('.group')].map((g) =>
      g.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(groups).toEqual(['Remaining 3', 'Done 2']);
    expect(boxNamed('Investigated caching setup and why open tabs break').checked).toBe(true);
    expect(boxNamed('Build step that writes version.json').checked).toBe(false);
  });

  it('shows the plan as a numbered list and the notes newest first with their dates', () => {
    const { container } = render(TaskDetail, {
      props: { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} },
    });
    const steps = [...container.querySelectorAll('.plan-list li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Write version.json in the build step',
      'Poll it on an interval and on window focus',
      'Show the banner and reload only when the tab is idle',
    ]);
    const dates = [...container.querySelectorAll('.note-date')].map((p) =>
      p.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(dates[0]).toContain('yesterday');
    expect(dates[0]).toContain('latest');
    /* The month name comes from the host locale, so match loosely on purpose. */
    expect(dates[1]).toMatch(/12 Sep/);
    expect(screen.getByText(/Chunk load errors are the safety net/)).toBeTruthy();
  });

  it('shows how late the planned day is', () => {
    render(TaskDetail, { props: { task: taskC(), day: DAY, onback: () => {}, onsave: () => {} } });
    expect(screen.getByText('4 days late')).toBeTruthy();
  });

  it('ticking an item emits the serialized file with that item done', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave } });
    const box = boxNamed('Build step that writes version.json');
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    expect(onsave).toHaveBeenCalledTimes(1);
    const [file, markdown] = onsave.mock.calls[0] as [string, string];
    expect(file).toBe(TASK_A_FILE);
    expect(markdown).toContain('- [x] Build step that writes version.json');
    expect(markdown).toContain('- [ ] ReleaseWatchService with polling and focus listener');
    const reparsed = parseTask(markdown, file);
    expect(reparsed.checklist.map((i) => i.done)).toEqual([true, true, true, false, false]);
    expect(reparsed.title).toBe('Release watch banner for stale tabs');
  });

  it('unticking an item emits the file with that item open', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave } });
    await fireEvent.click(boxNamed('Investigated caching setup and why open tabs break'));
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('- [ ] Investigated caching setup and why open tabs break');
  });

  it('keeps the plan and the notes in the file when a checklist item is ticked', async () => {
    const onsave = vi.fn();
    render(TaskDetail, { props: { task: taskC(), onback: () => {}, onsave } });
    await fireEvent.click(boxNamed('Poll on focus'));
    const markdown = onsave.mock.calls[0][1] as string;
    expect(markdown).toContain('## Plan');
    expect(markdown).toContain('## Notes');
    expect(markdown).toContain('### 2026-09-14');
    expect(markdown).toContain('planned: 2026-09-11');
  });

  it('asks before it deletes, and does nothing at all on the first press', async () => {
    const ondelete = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this task?')).toBeTruthy();
    expect(screen.getByRole('group', { name: /Confirm deleting/ })).toBeTruthy();
  });

  it('deletes on the second press, and only then', async () => {
    const ondelete = vi.fn();
    const task = taskA();
    render(TaskDetail, { props: { task, onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ondelete).toHaveBeenCalledTimes(1);
    expect(ondelete).toHaveBeenCalledWith(task);
  });

  it('takes Cancel and Escape as no, and puts the question away', async () => {
    const ondelete = vi.fn();
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {}, ondelete } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this task?')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this task?')).toBeNull();
  });

  it('offers no delete control at all when the view was given no way to delete', () => {
    render(TaskDetail, { props: { task: taskA(), onback: () => {}, onsave: () => {} } });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('wires back, resume, done and park actions', async () => {
    const onback = vi.fn();
    const onresume = vi.fn();
    const ondone = vi.fn();
    const onpark = vi.fn();
    const task = taskA();
    render(TaskDetail, { props: { task, onback, onsave: () => {}, onresume, ondone, onpark } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onback).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Resume in Claude' }));
    expect(onresume).toHaveBeenCalledWith(task, true);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(ondone).toHaveBeenCalledWith(task);
    await fireEvent.click(screen.getByRole('button', { name: 'Park' }));
    const input = screen.getByPlaceholderText('Why is this parked?') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Blocked on API' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Park it' }));
    expect(onpark).toHaveBeenCalledWith(task, 'Blocked on API');
  });
});
