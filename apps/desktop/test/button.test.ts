import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

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
import { desk } from '../src/lib/store.svelte.ts';
import { taskA } from './fixtures.ts';

/** The icon geometry, on the 0 to 1 grid src-tauri/icons/make-icons.mjs draws it from. */
const GRID = 44;
const PLATE_CORNER = 0.219;
const STEM = { x0: 0.285, y0: 0.235, x1: 0.42, y1: 0.7, r: 0.026 };
const FOOT = { x0: 0.285, y0: 0.615, x1: 0.63, y1: 0.7, r: 0.026 };
const DOT = { cx: 0.675, cy: 0.672, r: 0.088 };

function num(el: Element | null, attr: string): number {
  return Number(el?.getAttribute(attr));
}

describe('Button, the mark', () => {
  it('draws the logo: a plate, the two bars of the L, the dot, and nothing raster', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 44 44');
    expect(svg.querySelector('.plate')).toBeTruthy();
    expect(svg.querySelector('.stem')).toBeTruthy();
    expect(svg.querySelector('.foot')).toBeTruthy();
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('matches the icon geometry exactly, so the desktop and the dock show one mark', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    expect(num(svg.querySelector('.plate'), 'rx')).toBeCloseTo(PLATE_CORNER * GRID, 1);

    const stem = svg.querySelector('.stem');
    expect(num(stem, 'x')).toBeCloseTo(STEM.x0 * GRID, 1);
    expect(num(stem, 'y')).toBeCloseTo(STEM.y0 * GRID, 1);
    expect(num(stem, 'width')).toBeCloseTo((STEM.x1 - STEM.x0) * GRID, 1);
    expect(num(stem, 'height')).toBeCloseTo((STEM.y1 - STEM.y0) * GRID, 1);

    const foot = svg.querySelector('.foot');
    expect(num(foot, 'x')).toBeCloseTo(FOOT.x0 * GRID, 1);
    expect(num(foot, 'y')).toBeCloseTo(FOOT.y0 * GRID, 1);
    expect(num(foot, 'width')).toBeCloseTo((FOOT.x1 - FOOT.x0) * GRID, 1);
    expect(num(foot, 'height')).toBeCloseTo((FOOT.y1 - FOOT.y0) * GRID, 1);

    const dot = svg.querySelector('.dot');
    expect(num(dot, 'cx')).toBeCloseTo(DOT.cx * GRID, 1);
    expect(num(dot, 'cy')).toBeCloseTo(DOT.cy * GRID, 1);
    expect(num(dot, 'r')).toBeCloseTo(DOT.r * GRID, 1);
  });

  it('paints the mark in the icon colours, with the dot over the end of the foot', () => {
    const { container } = render(Button);
    const svg = container.querySelector('svg.logo') as SVGElement;
    expect(svg.querySelector('.plate')?.getAttribute('fill')).toBe('#1b1c20');
    expect(svg.querySelector('.stem')?.getAttribute('fill')).toBe('#ffffff');
    expect(svg.querySelector('.dot')?.getAttribute('fill')).toBe('#30c75e');
    /* Painted last, which is what puts it over the foot rather than under it. */
    const order = [...svg.children].map((el) => el.classList[0]);
    expect(order.indexOf('dot')).toBeGreaterThan(order.indexOf('foot'));
  });

  it('holds its silhouette with a hairline inside the edge as well as a shadow under it', () => {
    const { container } = render(Button);
    const rim = container.querySelector('svg.logo .rim');
    expect(rim?.getAttribute('stroke')).toContain('255, 255, 255');
    /* Inset by half the stroke, so the line sits inside the plate instead of straddling it. */
    expect(num(rim, 'x')).toBeCloseTo(0.5, 5);
    expect(num(rim, 'width')).toBeCloseTo(GRID - 1, 5);
  });

  it('has nothing that animates on its own, so the panel keeps the only live motion', () => {
    const { container } = render(Button);
    expect(container.querySelector('.eyes')).toBeNull();
    /* The dot carries no state class, so nothing can switch an animation on for it. */
    expect(container.querySelector('.dot')?.classList).toHaveLength(2);
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
