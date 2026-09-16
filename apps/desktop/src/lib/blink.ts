/**
 * The floating button's blink, as a schedule rather than as a keyframe. It exists because a
 * CSS animation can only repeat on a fixed period, and a face that blinks exactly every six
 * seconds reads as a machine keeping time rather than as something that is awake. The gap is
 * drawn fresh each time, and now and then two blinks come close together, which is what eyes
 * actually do.
 *
 * The loop only decides when. What a blink looks like is two CSS transitions on the eyes, with
 * the close quicker than the open, so nothing here touches the DOM and nothing here can move
 * the orb: the caller is handed a boolean and sets a class with it.
 *
 * Every number is exported so the component and the tests read the same ones, and `random` is a
 * parameter so a test can decide what "now and then" means instead of hoping.
 */

/** Eyes closing. Quicker than the open, which is the half that reads as a real blink. */
export const BLINK_CLOSE_MS = 55;
/** Eyes opening again. Close plus open is the whole blink, about 140 ms. */
export const BLINK_OPEN_MS = 85;
/** The gap between blinks is drawn from this range, never fixed. */
export const BLINK_GAP_MIN_MS = 5000;
export const BLINK_GAP_MAX_MS = 7000;
/** The pause in the middle of a double blink, once the eyes are open again. */
export const DOUBLE_BLINK_GAP_MS = 120;
/** How often a blink is a double one. Roughly one in five, which is enough to notice. */
export const DOUBLE_BLINK_CHANCE = 0.22;

/** A gap in the 5 to 7 second range. */
export function blinkGap(random: () => number = Math.random): number {
  return BLINK_GAP_MIN_MS + random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
}

/** Whether the next blink should be a double. */
export function isDoubleBlink(random: () => number = Math.random): boolean {
  return random() < DOUBLE_BLINK_CHANCE;
}

export interface BlinkOptions {
  /** Defaults to Math.random. A test passes its own so the schedule is not a coin toss. */
  random?: () => number;
}

/**
 * Starts blinking, calling `set(true)` when the eyes should be shut and `set(false)` when they
 * should be open. Returns the stop function, which clears the pending timer and leaves the eyes
 * open, so a window that closes mid blink cannot leave a face with its eyes shut.
 *
 * Callers must not start this when the viewer has asked for less motion. That check lives with
 * the rest of the motion policy in `lib/motion.svelte.ts` and is the caller's to make: this
 * file has no opinion about preferences, only about timing.
 */
export function startBlinking(
  set: (shut: boolean) => void,
  options: BlinkOptions = {},
): () => void {
  const random = options.random ?? Math.random;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function at(ms: number, run: () => void): void {
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) run();
    }, ms);
  }

  function close(double: boolean): void {
    set(true);
    at(BLINK_CLOSE_MS, () => open(double));
  }

  function open(double: boolean): void {
    set(false);
    if (double) at(BLINK_OPEN_MS + DOUBLE_BLINK_GAP_MS, () => close(false));
    else at(blinkGap(random), () => close(isDoubleBlink(random)));
  }

  at(blinkGap(random), () => close(isDoubleBlink(random)));

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    set(false);
  };
}
