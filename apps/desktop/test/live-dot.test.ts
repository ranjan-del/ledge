import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LiveDot from '../src/components/LiveDot.svelte';

describe('LiveDot', () => {
  it('breathes while it is watching and says so on hover', () => {
    const { container } = render(LiveDot, { props: {} });
    const dot = container.querySelector('.live') as HTMLElement;
    expect(dot.classList.contains('scanning')).toBe(false);
    expect(dot.classList.contains('paused')).toBe(false);
    expect(dot.getAttribute('title')).toBe('Watching your task files');
  });

  it('becomes a spinner only while a scan is actually running', () => {
    const { container } = render(LiveDot, { props: { scanning: true } });
    const dot = container.querySelector('.live') as HTMLElement;
    expect(dot.classList.contains('scanning')).toBe(true);
    expect(dot.getAttribute('title')).toBe('Scanning repositories');
  });

  it('pauses when the panel is not on screen, rather than animating out of sight', () => {
    const { container } = render(LiveDot, { props: { awake: false } });
    expect(container.querySelector('.live')?.classList.contains('paused')).toBe(true);
  });

  it('is decoration: the words next to it carry the meaning', () => {
    const { container } = render(LiveDot, { props: {} });
    expect(container.querySelector('.live')?.getAttribute('aria-hidden')).toBe('true');
  });
});
