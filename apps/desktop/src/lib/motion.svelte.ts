/**
 * The panel's motion policy, in one place, so that "does this move, and for how long" is a
 * decision taken once rather than in nine components. Two rules hold everywhere:
 *
 * - Nothing moves for someone who asked for less motion. `reducedMotion()` is checked in
 *   script where a timer or a delay is involved, and every keyframe and transition in CSS
 *   lives inside `@media (prefers-reduced-motion: no-preference)`. Both halves are needed:
 *   CSS alone would still leave the 160 ms wait before the window hides.
 * - Entrances happen once. `staggering()` is true only for a short window after the panel
 *   first paints, so rows fade in when you open the panel and stay put afterwards. A file
 *   watcher that fires every few seconds must never make the list twitch.
 */

/** Panel slide in and out. Also how long the window waits before it actually hides. */
export const PANEL_MS = 160;
/** Gap between one row's entrance and the next. Contract: no more than 30 ms. */
export const ROW_STEP_MS = 30;
/** How long after the first paint entrances are still allowed. */
export const STAGGER_MS = 700;

/** True when the viewer has asked for less motion, and when we cannot tell. */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

let settled = $state(false);
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Opens the entrance window, once per session. Called from the first view that mounts; later
 * calls do nothing, which is what keeps a tab switch from replaying the whole list.
 */
export function startStaggerWindow(): void {
  if (settled || timer !== null) return;
  if (reducedMotion()) {
    settled = true;
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    settled = true;
  }, STAGGER_MS);
}

/** True while rows are still allowed to fade in. */
export function staggering(): boolean {
  return !settled && !reducedMotion();
}

/** Ends the entrance window now. Used by tests so one test cannot animate the next. */
export function settleNow(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  settled = true;
}
