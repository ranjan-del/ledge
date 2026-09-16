/**
 * How tall the panel window should be, decided in the webview because the Rust side cannot see
 * what is on the surface. The contract asks for a short panel, 60 percent of the work area, so
 * that the panel reads as a panel rather than as an application window; but a task detail, or a
 * desk with real work on it, has more to say than a short panel can hold, and a list that
 * scrolls when the screen has room going spare is the worse of the two errors.
 *
 * So the answer is: full height when there is enough to fill it, short otherwise. `resize_panel`
 * in Rust takes that as one boolean.
 *
 * The estimate is an estimate and is named one. It counts what is on the surface at one height
 * per shape, a bordered block or a single line, rather than measuring the rendered list,
 * because measuring would mean deciding the window's height from the height the window already
 * has: the panel would grow, stop scrolling, shrink, start scrolling and grow again. Comparing
 * an estimate against the short panel's own height is stable, since neither side of that
 * comparison moves when the window does.
 */

/* The three numbers `panel_height` in src-tauri/src/lib.rs uses, in physical pixels. They are
   duplicated here rather than fetched because the webview has to predict what that function
   will do, and a round trip to ask cannot answer a question about a size it has not set yet. */
export const SHORT_FRACTION = 0.6;
export const SHORT_MIN_PX = 420;
export const SHORT_MAX_PX = 900;

/* One height per shape, in CSS pixels, taken from the rendered panel. A block is a card: a
   task card, a session, a note, a pending repository. A line is a single row: an Up next item,
   the attention line. Chrome is the header, the tab strip, the footer and the padding around
   the scrolling region, which no surface can use. */
export const BLOCK_PX = 84;
export const LINE_PX = 30;
export const CHROME_PX = 130;

/**
 * The short panel's height in CSS pixels, which is what the estimate is compared against.
 *
 * Two conversions, and both matter. The Rust side clamps in physical pixels, so the fraction
 * and the clamp are applied in physical pixels and the result is divided back down: on a
 * Retina display the 900 pixel ceiling is 450 points, and an estimate in CSS pixels compared
 * against 900 would never trigger.
 */
export function shortPanelHeight(availHeight: number, ratio = 1): number {
  const dpr = ratio > 0 ? ratio : 1;
  const physical = availHeight * dpr;
  const wanted = Math.round(physical * SHORT_FRACTION);
  return Math.min(Math.max(wanted, SHORT_MIN_PX), SHORT_MAX_PX) / dpr;
}

export type SizingSurface = 'now' | 'sessions' | 'tasks' | 'memory';
export type SizingView = 'live' | 'done' | 'backlog' | 'pending';

/** What is on the surface, in the two shapes a surface is built from. */
export interface PanelContent {
  /** A task detail is open. It is always taller than a short panel can hold. */
  detailOpen: boolean;
  /** Bordered blocks: task cards, sessions, notes, pending repositories. */
  blocks: number;
  /** Single lines: Up next items, the attention line. */
  lines: number;
}

/** Everything the panel already knows, counted. One field per list a surface can show. */
export interface PanelCounts {
  surface: SizingSurface;
  view: SizingView;
  detailOpen: boolean;
  working: number;
  upNext: number;
  attention: number;
  sessions: number;
  notes: number;
  live: number;
  done: number;
  backlog: number;
  pending: number;
}

/**
 * What the panel is actually showing, as blocks and lines. Only the visible surface counts: a
 * hundred notes do not make the NOW surface taller, and the window is sized for what is in
 * front of the person rather than for what the store happens to hold.
 */
export function panelContent(counts: PanelCounts): PanelContent {
  if (counts.detailOpen) return { detailOpen: true, blocks: 0, lines: 0 };
  if (counts.surface === 'now') {
    return {
      detailOpen: false,
      /* The greeting and the add row are chrome on this surface: both are always there. */
      blocks: counts.working,
      lines: counts.upNext + (counts.attention > 0 ? 1 : 0) + 2,
    };
  }
  if (counts.surface === 'sessions') {
    return { detailOpen: false, blocks: counts.sessions, lines: 1 };
  }
  if (counts.surface === 'memory') {
    return { detailOpen: false, blocks: counts.notes, lines: 1 };
  }
  const rows =
    counts.view === 'done'
      ? counts.done
      : counts.view === 'backlog'
        ? counts.backlog
        : counts.view === 'pending'
          ? counts.pending
          : counts.live;
  /* The view switch and the add row sit above and below the list on this surface. */
  return { detailOpen: false, blocks: rows, lines: 2 };
}

/** The estimated height of that content, in CSS pixels. */
export function contentHeight(content: PanelContent): number {
  if (content.detailOpen) return Number.POSITIVE_INFINITY;
  return CHROME_PX + content.blocks * BLOCK_PX + content.lines * LINE_PX;
}

/**
 * Whether the panel needs its full height: a task detail is open, or the content would not fit
 * in the short panel. An empty or nearly empty surface is short, which is the whole point: a
 * panel with two lines on it at full screen height is mostly empty glass.
 */
export function needsFullHeight(content: PanelContent, availHeight: number, ratio = 1): boolean {
  if (content.detailOpen) return true;
  return contentHeight(content) > shortPanelHeight(availHeight, ratio);
}

/** Default wait before a change of answer is acted on. Longer than the watcher's own 150 ms. */
export const RESIZE_DEBOUNCE_MS = 220;

export interface PanelSizer {
  /** Says what the answer is now. The window is only told when the answer has changed. */
  update(full: boolean): void;
  /** Cancels a pending call. Used on teardown. */
  stop(): void;
}

/**
 * Wraps the resize call so the window is asked to change size only when the answer actually
 * changes, and only after things have stopped moving. A save through the watcher can produce
 * several store updates in a few hundred milliseconds, and a window that re-sizes and re-places
 * itself on each of them is visibly worse than one that waits a moment and does it once.
 *
 * The first answer is applied like any other, so the panel corrects itself as soon as it can
 * see what it is showing.
 */
export function createPanelSizer(
  apply: (full: boolean) => void,
  delayMs = RESIZE_DEBOUNCE_MS,
): PanelSizer {
  let applied: boolean | undefined;
  let pending: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    update(full: boolean): void {
      if (full === applied) {
        /* Back to where we already are, so whatever was queued is no longer wanted. */
        pending = undefined;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      pending = full;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (pending === undefined || pending === applied) return;
        applied = pending;
        pending = undefined;
        apply(applied);
      }, delayMs);
    },
    stop(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = undefined;
    },
  };
}
