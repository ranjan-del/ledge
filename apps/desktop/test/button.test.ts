import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: 'button',
    onMoved: vi.fn(async () => () => {}),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    startDragging: vi.fn(async () => undefined),
  }),
  currentMonitor: vi.fn(async () => null),
}));

import Button from '../src/components/Button.svelte';
import { BLINK_CLOSE_MS, BLINK_GAP_MAX_MS } from '../src/lib/blink.ts';
import { desk } from '../src/lib/store.svelte.ts';
import { taskA } from './fixtures.ts';

/**
 * The icon geometry, on the 0 to 1 grid src-tauri/icons/make-icons.mjs draws it from, times
 * 100. If these numbers and that file ever disagree, the desktop and the dock are showing two
 * different creatures.
 */
const ORB = { cx: 50, cy: 47.5, r: 31.5 };
const EYE = { dx: 9.3, cy: 47.5, w: 6.2, h: 13.5, r: 3.1 };
const SHADOW = { cx: 50, cy: 85.5, rx: 20, ry: 3.5 };
const HALO_WIDTH = 5.5;

function num(el: Element | null, attr: string): number {
  return Number(el?.getAttribute(attr));
}

/**
 * Runs the fake clock forward in small steps until the eyes are shut, and says whether they
 * ever were. Stepping rather than jumping is the point: the gap between blinks is deliberately
 * unpredictable, so a test that jumped a fixed distance would land at random inside the blink
 * and pass or fail by luck.
 */
async function blinked(container: HTMLElement): Promise<boolean> {
  const step = 25;
  for (let waited = 0; waited <= BLINK_GAP_MAX_MS + BLINK_CLOSE_MS; waited += step) {
    if (container.querySelector('.eyes.shut')) return true;
    await vi.advanceTimersByTimeAsync(step);
  }
  return false;
}

describe('Button, the mark', () => {
  it('draws the orb: a contact shadow, a halo, the sphere, two eyes, and no plate', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    expect(svg.querySelector('.shade')).toBeTruthy();
    expect(svg.querySelector('.halo')).toBeTruthy();
    expect(svg.querySelector('.orb')).toBeTruthy();
    expect(svg.querySelectorAll('.eyes rect')).toHaveLength(2);
    expect(svg.querySelector('.plate')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('matches the icon geometry exactly, so the desktop and the dock show one mark', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;

    const orb = svg.querySelector('.orb');
    expect(num(orb, 'cx')).toBeCloseTo(ORB.cx, 2);
    expect(num(orb, 'cy')).toBeCloseTo(ORB.cy, 2);
    expect(num(orb, 'r')).toBeCloseTo(ORB.r, 2);

    /* The halo is one halo-width of ring outside the sphere. */
    expect(num(svg.querySelector('.halo'), 'r')).toBeCloseTo(ORB.r + HALO_WIDTH, 2);

    const shade = svg.querySelector('.shade');
    expect(num(shade, 'cx')).toBeCloseTo(SHADOW.cx, 2);
    expect(num(shade, 'cy')).toBeCloseTo(SHADOW.cy, 2);
    expect(num(shade, 'rx')).toBeCloseTo(SHADOW.rx, 2);
    expect(num(shade, 'ry')).toBeCloseTo(SHADOW.ry, 2);

    const [left, right] = [...svg.querySelectorAll('.eyes rect')];
    for (const eye of [left, right]) {
      expect(num(eye, 'width')).toBeCloseTo(EYE.w, 2);
      expect(num(eye, 'height')).toBeCloseTo(EYE.h, 2);
      expect(num(eye, 'rx')).toBeCloseTo(EYE.r, 2);
      expect(num(eye, 'y') + EYE.h / 2).toBeCloseTo(EYE.cy, 2);
    }
    expect(num(left, 'x') + EYE.w / 2).toBeCloseTo(ORB.cx - EYE.dx, 2);
    expect(num(right, 'x') + EYE.w / 2).toBeCloseTo(ORB.cx + EYE.dx, 2);
  });

  it('fills the button with the orb rather than parking it on a plate', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    /* Square, so nothing is letterboxed into the square button. */
    expect(w).toBeCloseTo(h as number, 5);
    /* Tight: the halo reaches most of the way across, and the shadow is not clipped. */
    expect(2 * (ORB.r + HALO_WIDTH)).toBeGreaterThan((w as number) * 0.9);
    expect((y as number) + (h as number)).toBeGreaterThanOrEqual(SHADOW.cy + SHADOW.ry);
    expect(x as number).toBeLessThanOrEqual(ORB.cx - ORB.r - HALO_WIDTH);
  });

  it('paints the orb in the icon colours, the eyes and the halo white', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    const stops = [...svg.querySelectorAll('#ledge-orb stop')].map((s) =>
      s.getAttribute('stop-color'),
    );
    expect(stops).toEqual(['#d6a8f2', '#8d7bef', '#5063e6']);
    for (const eye of svg.querySelectorAll('.eyes rect')) {
      expect(eye.getAttribute('fill')).toBe('#ffffff');
    }
    for (const stop of svg.querySelectorAll('#ledge-halo stop')) {
      expect(stop.getAttribute('stop-color')).toBe('#ffffff');
    }
  });

  it('draws the sphere over its halo and its shadow, and the eyes over the sphere', () => {
    const { container } = render(Button);
    const order = [...(container.querySelector('svg.logo') as SVGElement).children].map(
      (el) => el.classList[0] ?? el.tagName,
    );
    expect(order.indexOf('halo')).toBeGreaterThan(order.indexOf('shade'));
    expect(order.indexOf('orb')).toBeGreaterThan(order.indexOf('halo'));
    expect(order.indexOf('eyes')).toBeGreaterThan(order.indexOf('orb'));
  });

  it('blinks both eyes together, and moves nothing but the eyes', async () => {
    vi.useFakeTimers();
    const { container } = render(Button);
    const eyes = container.querySelector('.eyes') as SVGElement;
    expect(eyes.classList.contains('shut')).toBe(false);
    expect(await blinked(container)).toBe(true);
    /* The class is on the pair, so one eye can never be shut while the other is open. */
    expect(container.querySelectorAll('.eyes.shut rect')).toHaveLength(2);
    /* Nothing that could move the orb: no state class of its own, no inline transform. The
       remaining class is the one Svelte adds to scope the component's CSS. */
    const orbClasses = [...(container.querySelector('.orb')?.classList ?? [])];
    expect(container.querySelector('.orb')?.getAttribute('style')).toBeNull();
    expect(orbClasses.filter((c) => !c.startsWith('svelte-'))).toEqual(['orb']);
    /* And they open again on their own, so a blink cannot leave the face shut. */
    await vi.advanceTimersByTimeAsync(BLINK_CLOSE_MS);
    expect(eyes.classList.contains('shut')).toBe(false);
    vi.useRealTimers();
  });

  it('never starts the blink at all for someone who asked for less motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: true, media: query }) as MediaQueryList,
    );
    vi.useFakeTimers();
    const { container } = render(Button);
    expect(vi.getTimerCount()).toBe(0);
    expect(await blinked(container)).toBe(false);
    vi.useRealTimers();
  });

  it('counts the current tasks in the label, and shows the badge only when there are any', () => {
    desk.tasks = [];
    const { container, unmount } = render(Button);
    expect(container.querySelector('.mark')?.getAttribute('aria-label')).toBe(
      'Ledge: 0 current tasks',
    );
    expect(container.querySelector('.badge')).toBeNull();
    unmount();

    desk.tasks = [taskA()];
    const one = render(Button);
    expect(one.container.querySelector('.mark')?.getAttribute('aria-label')).toBe(
      'Ledge: 1 current task',
    );
    expect(one.container.querySelector('.badge')?.textContent).toBe('1');
    desk.tasks = [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
