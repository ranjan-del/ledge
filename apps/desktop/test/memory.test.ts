import { memoryFor } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Memory from '../src/components/Memory.svelte';
import { DAY, taskA, taskC } from './fixtures.ts';

const tasks = [taskA(), taskC()];
const taskFor = (id: string) => tasks.find((t) => t.id === id);
const entries = memoryFor(tasks);
const base = { taskFor, day: DAY, onselect: () => {} };

describe('Memory, empty', () => {
  it('says what writes a note rather than showing an empty list', () => {
    const { container } = render(Memory, { props: { ...base, entries: [] } });
    expect(screen.getByRole('heading', { name: /No notes yet/ })).toBeTruthy();
    expect(screen.getByText(/makes a decision, hits a dead end/)).toBeTruthy();
    /* No field either: there is nothing to search. */
    expect(container.querySelector('.finder')).toBeNull();
  });
});

describe('Memory, with notes', () => {
  it('groups notes under their day, newest day first', () => {
    const { container } = render(Memory, { props: { ...base, entries } });
    const days = [...container.querySelectorAll('.day .section-label')].map((el) =>
      el.textContent?.trim(),
    );
    expect(days).toHaveLength(2);
    /* 14 Sep is newer than 12 Sep, so it comes first. */
    expect(days[0]).toMatch(/14 Sep|yesterday/);
    expect(days[1]).toMatch(/12 Sep/);
  });

  it('shows each note as written, under the task it belongs to', () => {
    const { container } = render(Memory, { props: { ...base, entries } });
    const first = container.querySelector('.note-card') as HTMLElement;
    expect(first.querySelector('.who')?.textContent?.trim()).toBe(
      'Roll the version file out to every app',
    );
    expect(first.textContent).toContain('Chunk load errors are the safety net');
  });

  it('filters to the notes carrying every word typed', async () => {
    const { container } = render(Memory, { props: { ...base, entries } });
    await fireEvent.input(screen.getByLabelText('Search notes'), {
      target: { value: 'service worker' },
    });
    expect(container.querySelectorAll('.note-card')).toHaveLength(1);
    expect(screen.getByText(/Polling a static file/)).toBeTruthy();
  });

  it('says so plainly when a query matches nothing', async () => {
    render(Memory, { props: { ...base, entries } });
    await fireEvent.input(screen.getByLabelText('Search notes'), {
      target: { value: 'kubernetes' },
    });
    expect(screen.getByText(/Nothing matches "kubernetes"/)).toBeTruthy();
  });

  it('opens the task a note belongs to', async () => {
    const onselect = vi.fn();
    render(Memory, { props: { ...base, entries, onselect } });
    await fireEvent.click(screen.getAllByText('Roll the version file out to every app')[0]);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'version-file-rollout' }));
  });
});
