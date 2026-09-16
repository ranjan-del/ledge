import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Notifications from '../src/components/Notifications.svelte';
import type { Notification } from '../src/lib/observed.ts';
import { TASK_A_FILE, HOME } from './fixtures.ts';

function item(over: Partial<Notification> = {}): Notification {
  return {
    id: 'checklist:a',
    kind: 'checklist-complete',
    tone: 'done',
    title: 'Teacher Corner Web consolidation',
    detail: 'Checklist complete, all 13 items ticked',
    at: '2026-09-15T11:00:00+05:30',
    file: TASK_A_FILE,
    ...over,
  };
}

const several: Notification[] = [
  item(),
  item({
    id: 'pile:unlab',
    kind: 'repo-pile',
    tone: 'attention',
    title: 'unlab-web',
    detail: '333 uncommitted files on feature/teacher-corner-parity',
    at: '2026-09-15T12:00:00+05:30',
    file: undefined,
    repo: `${HOME}/code/unlab-web`,
  }),
  item({
    id: 'ahead:app',
    kind: 'repo-unpushed',
    tone: 'attention',
    title: 'app',
    detail: '7 commits not pushed on feature/banner',
    at: '2026-09-15T10:30:00+05:30',
    file: undefined,
    repo: `${HOME}/code/app`,
  }),
  item({
    id: 'planned:b',
    kind: 'planned-untouched',
    tone: 'attention',
    title: 'Visit Tracker nightly sync',
    detail: 'Planned for today, nothing ticked yet of 2',
    at: '2026-09-15T09:00:00+05:30',
  }),
  item({
    id: 'note:c',
    kind: 'note-added',
    tone: 'neutral',
    title: 'Platform spec renderer',
    detail: 'Note written under today',
    at: '2026-09-15T08:00:00+05:30',
  }),
];

const base = {
  items: several,
  onopen: () => {},
  ondismiss: () => {},
  ondismissall: () => {},
  onclose: () => {},
};

describe('Notifications', () => {
  it('groups what happened by subject, with a label and a count on each group', () => {
    const { container } = render(Notifications, { props: { ...base } });
    const labels = [...container.querySelectorAll('.sheet-list .section-label')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['Repositories 2', 'Checklists 1', 'Planned 1', 'Notes 1']);
  });

  it('says what happened in words as well as in colour', () => {
    const { container } = render(Notifications, { props: { ...base } });
    expect(screen.getByText('333 uncommitted files on feature/teacher-corner-parity')).toBeTruthy();
    expect(screen.getByText('Checklist complete, all 13 items ticked')).toBeTruthy();
    /* Every row carries its detail line, so none of them relies on the dot alone. */
    expect(container.querySelectorAll('.item')).toHaveLength(5);
    expect(container.querySelectorAll('.item .sub')).toHaveLength(5);
  });

  it('opens what a row is about', async () => {
    const onopen = vi.fn();
    render(Notifications, { props: { ...base, onopen } });
    await fireEvent.click(screen.getByText('Teacher Corner Web consolidation'));
    expect(onopen).toHaveBeenCalledWith(expect.objectContaining({ file: TASK_A_FILE }));
  });

  it('dismisses one row by its own control, naming what it is dropping', async () => {
    const ondismiss = vi.fn();
    render(Notifications, { props: { ...base, ondismiss } });
    const drop = screen.getByLabelText(/^Dismiss: unlab-web/);
    await fireEvent.click(drop);
    expect(ondismiss).toHaveBeenCalledWith('pile:unlab');
  });

  it('dismisses all of them at once', async () => {
    const ondismissall = vi.fn();
    render(Notifications, { props: { ...base, ondismissall } });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(ondismissall).toHaveBeenCalledTimes(1);
  });

  it('offers to clear only when there is something to clear', () => {
    render(Notifications, { props: { ...base, items: [] } });
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('marks unread rows without using colour as the only signal', () => {
    const { container } = render(Notifications, {
      props: { ...base, items: [item({ read: false }), item({ id: 'x', read: true })] },
    });
    expect(container.querySelectorAll('.item.unread')).toHaveLength(1);
  });

  it('explains itself when nothing has happened, and claims nothing it cannot detect', () => {
    render(Notifications, { props: { ...base, items: [] } });
    expect(screen.getByRole('heading', { name: 'Nothing new' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('compares the store against the last time it looked');
    expect(text).not.toMatch(/session (started|ended|running)/i);
  });

  it('closes on Escape and on a click outside it', async () => {
    const onclose = vi.fn();
    const { container } = render(Notifications, { props: { ...base, onclose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.click(container.querySelector('.scrim') as HTMLElement);
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
