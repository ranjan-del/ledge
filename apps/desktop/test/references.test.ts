/**
 * The References section: the raw material a person pastes into a task. Two things are being
 * proved here. One, that a paste survives a round trip through the task file byte for byte,
 * including the characters Markdown would otherwise eat. Two, that adding a second reference
 * never rewrites the first, since appending is the common act and re-editing is not.
 */
import { parseTask, serializeTask } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskDetail from '../src/components/TaskDetail.svelte';
import {
  appendReference,
  carve,
  referencesOf,
  restOf,
  withReferences,
} from '../src/lib/references.ts';
import { DAY, HOME, taskA } from './fixtures.ts';

const PASTE = `Sonal wrote:

> the tabs are wrong for FLN, it says TnT not TNT

    TypeError: cannot read tabLayout of undefined
        at resource-page.ts:118

\`\`\`ts
## not a heading, it is inside a fence
const tabs = config().resourceNames;
\`\`\``;

async function settle(): Promise<void> {
  await tick();
  await tick();
  await tick();
}

describe('references, carved out of the file', () => {
  it('finds nothing when the file has no such section', () => {
    expect(referencesOf(taskA())).toBe('');
    expect(carve('')).toEqual({ references: '', rest: '' });
  });

  it('keeps a paste through a full parse and serialize, exactly as pasted', () => {
    const task = withReferences(taskA(), PASTE);
    const markdown = serializeTask(task, { home: HOME });
    expect(markdown).toContain('## References');
    const back = parseTask(markdown, taskA().file, { home: HOME });
    expect(referencesOf(back)).toBe(PASTE);
  });

  it('does not let a fenced ## line end the section', () => {
    const task = withReferences(taskA(), PASTE);
    const back = parseTask(serializeTask(task, { home: HOME }), taskA().file, { home: HOME });
    expect(referencesOf(back)).toContain('## not a heading, it is inside a fence');
    expect(restOf(back)).toBe('');
  });

  it('appends under what is already there and leaves the first paste alone', () => {
    const one = withReferences(taskA(), 'First message.');
    const two = appendReference(one, 'Second message,\nover two lines.');
    expect(referencesOf(two)).toBe('First message.\n\nSecond message,\nover two lines.');
  });

  it('keeps other unknown sections out of the references and in "also in the file"', () => {
    const odd = { ...taskA(), extra: '## Rollout\n\nBehind a flag.' };
    const withRefs = withReferences(odd, 'A link: https://example.test/x');
    expect(referencesOf(withRefs)).toBe('A link: https://example.test/x');
    expect(restOf(withRefs)).toBe('## Rollout\n\nBehind a flag.');
    const back = parseTask(serializeTask(withRefs, { home: HOME }), taskA().file, { home: HOME });
    expect(restOf(back)).toBe('## Rollout\n\nBehind a flag.');
  });

  it('removes the section when the references are emptied', () => {
    const task = withReferences(taskA(), 'Something');
    expect(restOf(withReferences(task, ''))).toBe('');
    expect(referencesOf(withReferences(task, ''))).toBe('');
  });

  it('refuses to append nothing', () => {
    const task = withReferences(taskA(), 'Only this');
    expect(referencesOf(appendReference(task, '   \n  '))).toBe('Only this');
  });
});

describe('TaskDetail, the References section', () => {
  function open(task = taskA(), onsave = vi.fn()) {
    render(TaskDetail, { props: { task, day: DAY, home: HOME, onback: () => {}, onsave } });
    return onsave;
  }

  it('is there, closed, and says so when nothing has been pasted', async () => {
    const { container } = render(TaskDetail, {
      props: { task: taskA(), day: DAY, home: HOME, onback: () => {}, onsave: () => {} },
    });
    const head = screen.getByRole('button', { name: /^References/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(head);
    expect((container.querySelector('#fold-references') as HTMLElement).hidden).toBe(false);
    expect(container.querySelector('#fold-references')?.textContent).toContain('Nothing pasted');
  });

  it('pastes raw material in and writes it to the file unchanged', async () => {
    const onsave = open();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a reference' }));
    await fireEvent.input(screen.getByLabelText('New reference'), { target: { value: PASTE } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
    await settle();
    const [file, markdown] = onsave.mock.calls[0] as [string, string];
    const next = parseTask(markdown, file, { home: HOME });
    expect(referencesOf(next)).toBe(PASTE);
    /* One field changed, and nothing else in the file moved. */
    expect(next.title).toBe(taskA().title);
    expect(next.checklist).toHaveLength(5);
    expect(next.requirement).toBe(taskA().requirement);
  });

  it('shows a paste verbatim rather than as Markdown', async () => {
    const task = withReferences(taskA(), PASTE);
    const { container } = render(TaskDetail, {
      props: { task, day: DAY, home: HOME, onback: () => {}, onsave: () => {} },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^References/ }));
    const block = container.querySelector('#fold-references pre') as HTMLElement;
    expect(block.textContent).toContain('> the tabs are wrong for FLN');
    expect(block.textContent).toContain('## not a heading, it is inside a fence');
    /* Nothing was interpreted: no heading and no emphasis was made out of the paste. */
    expect(block.querySelector('h1, h2, h3, strong, em, code')).toBeNull();
  });

  it('folds a long paste behind a count and opens it again', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = render(TaskDetail, {
      props: {
        task: withReferences(taskA(), long),
        day: DAY,
        home: HOME,
        onback: () => {},
        onsave: () => {},
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^References/ }));
    const block = () => container.querySelector('#fold-references pre') as HTMLElement;
    expect(block().textContent).toContain('line 12');
    expect(block().textContent).not.toContain('line 13');
    await fireEvent.click(screen.getByRole('button', { name: 'and 18 more lines' }));
    expect(block().textContent).toContain('line 30');
  });

  it('adds a second reference without re-editing the first', async () => {
    const onsave = open(withReferences(taskA(), 'The first message.'));
    await fireEvent.click(screen.getByRole('button', { name: 'Add a reference' }));
    await fireEvent.input(screen.getByLabelText('New reference'), {
      target: { value: 'The second message.' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
    await settle();
    const [file, markdown] = onsave.mock.calls[0] as [string, string];
    expect(referencesOf(parseTask(markdown, file, { home: HOME }))).toBe(
      'The first message.\n\nThe second message.',
    );
  });

  it('keeps a paste in progress when the watcher re-reads the file', async () => {
    const onsave = vi.fn();
    const { rerender } = render(TaskDetail, {
      props: { task: taskA(), day: DAY, home: HOME, onback: () => {}, onsave },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add a reference' }));
    await fireEvent.input(screen.getByLabelText('New reference'), {
      target: { value: 'Half a pasted message' },
    });
    await rerender({ task: { ...taskA(), updated: '2026-09-16T12:00:00+05:30' } });
    await settle();
    expect((screen.getByLabelText('New reference') as HTMLTextAreaElement).value).toBe(
      'Half a pasted message',
    );
    expect(onsave).not.toHaveBeenCalled();
  });

  it('says a refused write out loud and keeps the paste', async () => {
    open(taskA(), vi.fn().mockRejectedValue('Read-only file system'));
    await fireEvent.click(screen.getByRole('button', { name: 'Add a reference' }));
    await fireEvent.input(screen.getByLabelText('New reference'), {
      target: { value: 'Do not lose me' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Read-only file system');
    expect((screen.getByLabelText('New reference') as HTMLTextAreaElement).value).toBe(
      'Do not lose me',
    );
  });
});
