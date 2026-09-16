import { sessionsFor } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Sessions from '../src/components/Sessions.svelte';
import { taskA, taskB, taskC } from './fixtures.ts';

const tasks = [taskA(), taskB(), taskC()];
const taskFor = (id: string) => tasks.find((t) => t.id === id);
const base = { taskFor, onselect: () => {} };

describe('Sessions, empty', () => {
  it('explains what would make a session appear instead of looking like a failure', () => {
    const { container } = render(Sessions, { props: { ...base, sessions: [] } });
    expect(screen.getByRole('heading', { name: /No sessions linked yet/ })).toBeTruthy();
    expect(screen.getByText(/Stop hook writes the session id/)).toBeTruthy();
    expect(screen.getByText(/Nothing is missing and nothing has failed/)).toBeTruthy();
    expect(container.querySelector('.session')).toBeNull();
  });
});

describe('Sessions, with linked ids', () => {
  /* taskA carries two ids and taskC one; taskB has none, so it must not appear. */
  const sessions = sessionsFor(tasks);

  it('lists one row per recorded id, and nothing for a task with none', () => {
    const { container } = render(Sessions, { props: { ...base, sessions } });
    expect(container.querySelectorAll('.session')).toHaveLength(3);
    expect(screen.queryByText('Optimistic CRUD for the admin grid')).toBeNull();
  });

  it('shows the id itself, since that is the only thing the files record', () => {
    const { container } = render(Sessions, { props: { ...base, sessions } });
    const ids = [...container.querySelectorAll('.id')].map((el) => el.textContent);
    expect(ids).toContain('071729a1');
    expect(ids).toContain('b13e8b5e');
    expect(ids).toContain('4c1d9a2b');
  });

  it('marks the newest id of a task, and only that one', () => {
    const { container } = render(Sessions, { props: { ...base, sessions } });
    const latest = [...container.querySelectorAll('.session')].filter((row) =>
      row.querySelector('.chip'),
    );
    /* One per task that has any id: two tasks here. */
    expect(latest).toHaveLength(2);
  });

  it('calls the timestamp "last seen" and never claims a session is running', () => {
    const { container } = render(Sessions, { props: { ...base, sessions } });
    const row = container.querySelector('.session') as HTMLElement;
    expect(row.textContent).toContain('last seen');
    expect(row.textContent).not.toMatch(/active|running|live/i);
    expect(screen.getByText(/no way to tell whether a session is still running/)).toBeTruthy();
  });

  it('opens the task a session worked on', async () => {
    const onselect = vi.fn();
    render(Sessions, { props: { ...base, sessions, onselect } });
    await fireEvent.click(screen.getAllByText('Release watch banner for stale tabs')[0]);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-watch-banner' }));
  });

  it('offers Resume only for the id that resuming would actually reach', () => {
    render(Sessions, { props: { ...base, sessions, onresume: () => {} } });
    /* One per task with ids, not one per id. */
    expect(screen.getAllByRole('button', { name: 'Resume in Claude' })).toHaveLength(2);
  });

  it('offers no Resume at all when the panel cannot launch one', () => {
    render(Sessions, { props: { ...base, sessions } });
    expect(screen.queryByRole('button', { name: 'Resume in Claude' })).toBeNull();
  });
});
