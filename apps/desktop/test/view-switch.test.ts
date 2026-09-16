import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ViewSwitch from '../src/components/ViewSwitch.svelte';

import type { ViewOption } from '../src/components/ViewSwitch.svelte';

const options: [ViewOption, ViewOption] = [
  { id: 'live', label: 'Live', count: 4 },
  { id: 'done', label: 'Done', count: 12 },
];

describe('ViewSwitch', () => {
  it('offers exactly two views, each carrying its own count', () => {
    const { container } = render(ViewSwitch, {
      props: { options, active: 'live', onchange: () => {} },
    });
    const buttons = [...container.querySelectorAll('.view')];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Live 4',
      'Done 12',
    ]);
  });

  it('says which one you are looking at, and does not say it of the other', () => {
    render(ViewSwitch, { props: { options, active: 'done', onchange: () => {} } });
    expect(screen.getByRole('button', { name: /Done/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Live/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the view that was pressed', async () => {
    const onchange = vi.fn();
    render(ViewSwitch, { props: { options, active: 'live', onchange } });
    await fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onchange).toHaveBeenCalledWith('done');
  });

  it('is a group, not a second set of tabs, so the tab ring above it keeps its meaning', () => {
    const { container } = render(ViewSwitch, {
      props: { options, active: 'live', onchange: () => {} },
    });
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Task view',
    );
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });
});
