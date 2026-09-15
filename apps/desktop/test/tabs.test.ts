import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Tabs from '../src/components/Tabs.svelte';

const tabs = [
  { id: 'current', label: 'Current', count: 2 },
  { id: 'backlog', label: 'Backlog', count: 1 },
  { id: 'pending', label: 'Pending', count: 0 },
];

describe('Tabs', () => {
  it('renders a segmented control with counts and marks the active tab', () => {
    render(Tabs, { props: { tabs, active: 'backlog', onchange: () => {} } });
    const items = screen.getAllByRole('tab');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute('aria-selected')).toBe('true');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
    expect(items[0].textContent).toContain('Current');
    expect(items[0].textContent).toContain('2');
  });

  it('emits the tab id on click', async () => {
    const onchange = vi.fn();
    render(Tabs, { props: { tabs, active: 'current', onchange } });
    await fireEvent.click(screen.getByRole('tab', { name: /Pending/ }));
    expect(onchange).toHaveBeenCalledWith('pending');
  });

  it('moves with arrow keys and wraps around', async () => {
    const onchange = vi.fn();
    render(Tabs, { props: { tabs, active: 'pending', onchange } });
    const active = screen.getByRole('tab', { name: /Pending/ });
    await fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(onchange).toHaveBeenLastCalledWith('current');
    await fireEvent.keyDown(active, { key: 'ArrowLeft' });
    expect(onchange).toHaveBeenLastCalledWith('backlog');
    await fireEvent.keyDown(active, { key: 'Home' });
    expect(onchange).toHaveBeenLastCalledWith('current');
  });
});
