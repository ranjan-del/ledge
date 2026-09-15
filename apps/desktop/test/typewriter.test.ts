import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Typewriter from '../src/components/Typewriter.svelte';

const LINE = 'Nothing in progress.';

function prefersReduced(value: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: value, media: query }) as MediaQueryList,
  );
}

/*
 * Order matters here, and deliberately so: "types once" is a promise about module state that
 * survives unmounting, so the reduced-motion case has to be asked first, while the line has
 * never been typed. That is also the real sequence a viewer experiences.
 */
describe('Typewriter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the whole line at once when the viewer asked for less motion', () => {
    prefersReduced(true);
    const { container } = render(Typewriter, { props: { text: LINE } });
    expect(container.textContent).toBe(LINE);
    expect(container.querySelector('.caret')).toBeNull();
  });

  it('types the line out once, then leaves it alone', async () => {
    prefersReduced(false);
    vi.useFakeTimers();
    const first = render(Typewriter, { props: { text: LINE, speed: 10 } });
    expect(first.container.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(130);
    const partial = first.container.textContent as string;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(LINE.length);
    expect(LINE.startsWith(partial)).toBe(true);
    expect(first.container.querySelector('.caret')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(LINE.length * 10 + 200);
    expect(first.container.textContent).toBe(LINE);
    /* A caret that keeps blinking after the line is finished is the irritating version. */
    expect(first.container.querySelector('.caret')).toBeNull();
    first.unmount();

    const second = render(Typewriter, { props: { text: LINE, speed: 10 } });
    expect(second.container.textContent).toBe(LINE);
  });

  it('hides the animated text from assistive technology', () => {
    const { container } = render(Typewriter, { props: { text: LINE } });
    expect(container.querySelector('.typed')?.getAttribute('aria-hidden')).toBe('true');
  });
});
