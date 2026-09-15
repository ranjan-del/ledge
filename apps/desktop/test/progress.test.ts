import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Progress from '../src/components/Progress.svelte';

describe('Progress', () => {
  it('renders nothing when there is no checklist', () => {
    const { container } = render(Progress, { props: { done: 0, total: 0 } });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('draws one segment per item and fills the done ones', () => {
    const { container } = render(Progress, { props: { done: 2, total: 5 } });
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.querySelectorAll('.seg')).toHaveLength(5);
    expect(bar?.querySelectorAll('.seg.on')).toHaveLength(2);
    expect(bar?.getAttribute('aria-valuenow')).toBe('40');
    expect(bar?.getAttribute('aria-label')).toBe('2 of 5 checklist items done');
    expect(screen.getByText('2 of 5')).toBeTruthy();
  });

  it('falls back to a filled proportion when segments would be thinner than the gaps', () => {
    const { container } = render(Progress, { props: { done: 9, total: 24 } });
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.querySelectorAll('.seg')).toHaveLength(0);
    expect(bar?.querySelector('.fill')?.getAttribute('style')).toContain('38%');
  });

  it('marks a finished checklist as complete', () => {
    const { container } = render(Progress, { props: { done: 3, total: 3 } });
    expect(container.querySelector('.track.complete')).toBeTruthy();
  });

  it('can be asked to leave the count out', () => {
    render(Progress, { props: { done: 1, total: 4, label: false } });
    expect(screen.queryByText('1 of 4')).toBeNull();
  });
});
