import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ReturnToWork from '../src/components/ReturnToWork.svelte';
import Now from '../src/components/Now.svelte';
import type { AwaySummary } from '../src/lib/away.ts';
import { DAY, TASK_A_FILE, taskA } from './fixtures.ts';

const summary: AwaySummary = {
  since: new Date(Date.now() - 5 * 3600_000).toISOString(),
  lines: ['333 files changed in 1 repository', '2 tasks finished', '1 note written'],
  resumeFile: TASK_A_FILE,
  resumeTitle: 'Teacher Corner Web consolidation',
};

const base = { summary, onresume: () => {}, ondismiss: () => {} };

describe('ReturnToWork', () => {
  it('leads with what changed, one line per thing that actually did', () => {
    const { container } = render(ReturnToWork, { props: { ...base } });
    expect(screen.getByRole('heading', { name: /While you were away/ })).toBeTruthy();
    const lines = [...container.querySelectorAll('.item-list li')].map((li) =>
      li.textContent?.trim(),
    );
    expect(lines).toEqual(summary.lines);
  });

  it('says how long ago that was, from the timestamp it was given', () => {
    render(ReturnToWork, { props: { ...base } });
    expect(screen.getByRole('heading', { name: /5 h ago/ })).toBeTruthy();
  });

  it('says there was no activity rather than filling the space with zeroes', () => {
    const { container } = render(ReturnToWork, {
      props: { ...base, summary: { ...summary, lines: [] } },
    });
    expect(container.querySelector('.item-list')).toBeNull();
    expect(screen.getByText('No activity in the store while the panel was closed.')).toBeTruthy();
  });

  it('takes you back to the most recent task, by name', async () => {
    const onresume = vi.fn();
    render(ReturnToWork, { props: { ...base, onresume } });
    await fireEvent.click(
      screen.getByRole('button', { name: 'Back to Teacher Corner Web consolidation' }),
    );
    expect(onresume).toHaveBeenCalledWith(TASK_A_FILE);
  });

  it('offers no way back when the store has no task to go back to', () => {
    render(ReturnToWork, {
      props: {
        ...base,
        summary: { since: summary.since, lines: summary.lines },
      },
    });
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
  });

  it('reports itself as seen as soon as it has been on screen, so it does not linger', () => {
    const onseen = vi.fn();
    render(ReturnToWork, { props: { ...base, onseen } });
    expect(onseen).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', async () => {
    const ondismiss = vi.fn();
    render(ReturnToWork, { props: { ...base, ondismiss } });
    await fireEvent.click(screen.getByLabelText('Dismiss this summary'));
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Now, returning to it', () => {
  const props = {
    working: [taskA()],
    upNext: [],
    day: DAY,
    name: 'Ranjan',
    onselect: () => {},
    onadd: () => {},
  };

  it('puts the summary above the greeting, because it is the perishable part', () => {
    const { container } = render(Now, {
      props: {
        ...props,
        away: summary,
        onresumeaway: () => {},
        ondismissaway: () => {},
      },
    });
    const blocks = [...container.querySelectorAll('.pane-scroll > *')].map((el) => el.className);
    expect(blocks[0]).toContain('away');
    expect(blocks[1]).toContain('greet');
  });

  it('shows nothing of the sort when there was no absence to report', () => {
    const { container } = render(Now, { props: { ...props } });
    expect(container.querySelector('.away')).toBeNull();
  });
});
