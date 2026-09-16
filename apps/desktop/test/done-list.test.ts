import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DoneList from '../src/components/DoneList.svelte';
import { archived } from './fixtures.ts';

/* The day after the newest archived task was finished, so its date reads as a word. */
const DAY_AFTER = '2026-09-09';

describe('DoneList', () => {
  it('shows finished work in the order it was given, newest first', () => {
    const { container } = render(DoneList, { props: { tasks: archived(), day: DAY_AFTER } });
    const titles = [...container.querySelectorAll('.done .title')].map((el) => el.textContent);
    expect(titles).toEqual([
      'Retry the nightly sync once before giving up',
      'Version file in the build step',
    ]);
  });

  it('says when each was finished', () => {
    const { container } = render(DoneList, { props: { tasks: archived(), day: DAY_AFTER } });
    expect(screen.getByText('yesterday')).toBeTruthy();
    expect(container.querySelectorAll('.done .when-text')).toHaveLength(2);
  });

  it('keeps the checklist as it stood, so a task finished with work left still says so', () => {
    const { container } = render(DoneList, { props: { tasks: archived(), day: DAY_AFTER } });
    const bars = [...container.querySelectorAll('[role="progressbar"]')];
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['50', '100']);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('2 of 2')).toBeTruthy();
  });

  it('says so when a finished task never had a checklist', () => {
    const [newest] = archived();
    render(DoneList, { props: { tasks: [{ ...newest, checklist: [] }], day: DAY_AFTER } });
    expect(screen.getByText('no checklist')).toBeTruthy();
  });

  it('is one short line while it reads, and one short line when there is nothing', () => {
    const { unmount } = render(DoneList, { props: { tasks: [], loading: true } });
    expect(screen.getByText('Reading the archive.')).toBeTruthy();
    unmount();
    render(DoneList, { props: { tasks: [] } });
    expect(screen.getByText('Nothing finished yet.')).toBeTruthy();
  });

  it('has nothing to click: the archive is a record, not a workbench', () => {
    const { container } = render(DoneList, { props: { tasks: archived(), day: DAY_AFTER } });
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
