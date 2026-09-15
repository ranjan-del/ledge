import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TodayBlock from '../src/components/TodayBlock.svelte';
import { DAY, DAY_PAST, plannedTask, repoStatus } from './fixtures.ts';

describe('TodayBlock', () => {
  it('renders nothing at all when nothing is planned', () => {
    const { container } = render(TodayBlock, {
      props: { today: [], overdue: [], day: DAY, onselect: () => {} },
    });
    expect(container.querySelector('section')).toBeNull();
  });

  it('heads the block with the day and the number of things on it', () => {
    render(TodayBlock, {
      props: {
        today: [plannedTask(DAY, { file: 'a.md' }), plannedTask(DAY, { file: 'b.md' })],
        overdue: [plannedTask(DAY_PAST, { file: 'c.md' })],
        day: DAY,
        onselect: () => {},
      },
    });
    const head = screen.getByRole('heading', { level: 2 });
    expect(head.textContent).toContain('Today');
    expect(head.textContent).toMatch(/15 Sep/);
    expect(head.textContent).toContain('3');
  });

  it('counts the late ones in the heading itself', () => {
    render(TodayBlock, {
      props: {
        today: [plannedTask(DAY, { file: 'a.md' })],
        overdue: [plannedTask(DAY_PAST, { file: 'b.md' })],
        day: DAY,
        onselect: () => {},
      },
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('1 late');
  });

  it('numbers its rows from the rank it is given, in the order it shows them', () => {
    const { container } = render(TodayBlock, {
      props: {
        today: [plannedTask(DAY, { file: 'a.md' })],
        overdue: [plannedTask(DAY_PAST, { file: 'b.md' })],
        day: DAY,
        startRank: 4,
        onselect: () => {},
      },
    });
    const ranks = [...container.querySelectorAll('.rank')].map((el) => el.textContent);
    expect(ranks).toEqual(['4', '5']);
  });

  it('puts overdue tasks first, counted and marked late in words', () => {
    const { container } = render(TodayBlock, {
      props: {
        today: [plannedTask(DAY, { file: 'today.md', title: 'On for today' })],
        overdue: [plannedTask(DAY_PAST, { file: 'late.md', title: 'Missed on Friday' })],
        day: DAY,
        onselect: () => {},
      },
    });
    expect(screen.getByText('4 days late')).toBeTruthy();
    const titles = [...container.querySelectorAll('.row h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Missed on Friday', 'On for today']);
    expect(container.querySelectorAll('.row.late')).toHaveLength(1);
  });

  it('does not label every on-time row "today" when the heading already says it', () => {
    render(TodayBlock, {
      props: { today: [plannedTask(DAY)], overdue: [], day: DAY, onselect: () => {} },
    });
    expect(screen.queryByText('planned today')).toBeNull();
  });

  it('hands each row the git status of its own repo', () => {
    render(TodayBlock, {
      props: {
        today: [plannedTask(DAY)],
        overdue: [],
        day: DAY,
        statusFor: () => repoStatus(),
        onselect: () => {},
      },
    });
    expect(screen.getByText('2 uncommitted')).toBeTruthy();
  });
});
