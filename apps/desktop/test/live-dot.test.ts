import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import LiveDot, { BREATHE_MS, sharedPhase } from '../src/components/LiveDot.svelte';

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

describe('LiveDot sizing and phase', () => {
  it('is the header size by default and a row size when asked', () => {
    const { container, unmount } = render(LiveDot, { props: {} });
    expect(container.querySelector('.live')?.classList.contains('md')).toBe(true);
    unmount();
    const small = render(LiveDot, { props: { size: 'sm' } });
    expect(small.container.querySelector('.live')?.classList.contains('sm')).toBe(true);
  });

  it('says what it means here when the meaning is not the default one', () => {
    const { container } = render(LiveDot, { props: { size: 'sm', title: 'Live work' } });
    expect(container.querySelector('.live')?.getAttribute('title')).toBe('Live work');
  });

  it('joins the cycle in progress instead of starting its own', () => {
    const { container } = render(LiveDot, { props: {} });
    const delay = (container.querySelector('.live') as HTMLElement).style.animationDelay;
    const ms = Number(delay.replace('ms', ''));
    expect(delay.endsWith('ms')).toBe(true);
    expect(ms).toBeLessThanOrEqual(0);
    expect(ms).toBeGreaterThan(-BREATHE_MS);
  });

  it('moves every dot by exactly the time that passed, so they stay in step', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(10_000);
    const first = sharedPhase();
    now.mockReturnValue(11_000);
    const second = sharedPhase();
    /* A second dot one second later starts one second further into the same cycle. */
    expect((((first - second) % BREATHE_MS) + BREATHE_MS) % BREATHE_MS).toBe(1000);
  });

  it('does not offset the spinner, which is one element with no one to stay in step with', () => {
    const { container } = render(LiveDot, { props: { scanning: true } });
    expect((container.querySelector('.live') as HTMLElement).style.animationDelay).toBe('');
  });
});
