/**
 * The one place that watches the desk for changes and remembers what it has already seen. It
 * turns the pure comparison in `lib/observed.ts` into two things the panel can show: a list of
 * notifications with an unread count, and the summary of what changed while you were away.
 *
 * It does not poll. The store's file watcher re-parses a task file when it changes and the scan
 * timer refreshes the git state on its own interval; both of those write to `desk`, and an
 * effect over `desk` is therefore woken by exactly the events that could have changed the
 * answer. Nothing here has a timer of its own except the short wait that keeps a burst of
 * watcher events from writing the observation file several times over.
 *
 * Two observations are kept on disk, in `~/.ledge/.news.json`:
 *
 * - `last` is the most recent look at the desk, and notifications are the difference against
 *   it. It is written every time the desk changes, whether the panel is on screen or not, so a
 *   change is noticed once and never announced twice.
 * - `seen` is the last look taken while the person was actually watching the panel. The return
 *   to work summary is the difference against that one. It is deliberately not updated while
 *   the panel is hidden, because the whole question it answers is what happened while nobody
 *   was looking.
 *
 * A store with no file yet produces no notifications and no summary at all: there is nothing to
 * compare against, so the first run records what it sees and says nothing. This is also why
 * reinstalling the app does not greet you with a hundred announcements.
 */
import { awaySummary, idleThresholdMs, type AwaySummary } from './away.ts';
import { pathExists, readText, writeText } from './io.ts';
import {
  diff,
  nudgedAfter,
  snapshot,
  type Notification,
  type Observation,
} from './observed.ts';
import { join } from './paths.ts';
import { desk, report } from './store.svelte.ts';
import { nowIso, todayIso } from './time.ts';

/** How long to wait for the store to stop changing before writing the observation file. */
export const NEWS_DEBOUNCE_MS = 250;
/** Enough to read at one sitting. Older items fall off the bottom rather than piling up. */
export const NEWS_LIMIT = 40;

export interface News {
  /** Newest first. */
  items: Notification[];
  /** The summary shown on NOW after a stretch away, or undefined when there is nothing. */
  away: AwaySummary | undefined;
  /** True once the summary has been on screen, which is what stops it coming back. */
  awaySeen: boolean;
  /** The centre is open. */
  open: boolean;
}

export const news: News = $state({ items: [], away: undefined, awaySeen: false, open: false });

/** How many notifications have not been read. The number on the header's bell. */
export function unread(): number {
  return news.items.filter((item) => !item.read).length;
}

/** Marks everything read. Called when the centre is opened, not when an item is clicked. */
export function markRead(): void {
  for (const item of news.items) item.read = true;
}

export function setCentreOpen(open: boolean): void {
  news.open = open;
  if (open) markRead();
}

/** Drops one notification for good. The observation it came from stays recorded. */
export function dismiss(id: string): void {
  news.items = news.items.filter((item) => item.id !== id);
}

/** Drops all of them. */
export function dismissAll(): void {
  news.items = [];
}

/**
 * Says the summary has been on screen. The observation behind it is written out straight away,
 * so opening the panel again does not show yesterday's news; the summary itself stays until it
 * is dismissed, since it would be a strange thing to remove from under someone mid sentence.
 */
export function markAwaySeen(): void {
  if (news.awaySeen) return;
  news.awaySeen = true;
  if (current) {
    stored.seen = current;
    void save();
  }
}

/** Takes the summary off the surface. */
export function dismissAway(): void {
  news.away = undefined;
}

interface NewsFile {
  version: 1;
  last?: Observation;
  seen?: Observation;
}

let stored: NewsFile = { version: 1 };
/** The most recent observation taken, whether or not it has been written yet. */
let current: Observation | undefined;
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** The desk as the effect last saw it, so a wake that changes nothing writes nothing. */
let lastStamp = '';

function filePath(): string {
  return join(desk.ledgeHome, '.news.json');
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    if (await pathExists(filePath())) {
      const parsed = JSON.parse(await readText(filePath())) as NewsFile;
      if (parsed && typeof parsed === 'object') stored = { ...parsed, version: 1 };
    }
  } catch (e) {
    /* A bad file is not worth an error line in the panel: the next write replaces it, and the
       only cost is that this launch has nothing to compare against. */
    report('warn', `news: could not read ${filePath()}: ${String(e)}`);
    stored = { version: 1 };
  }
}

async function save(): Promise<void> {
  try {
    await writeText(filePath(), JSON.stringify(stored) + '\n');
  } catch (e) {
    report('warn', `news: could not write ${filePath()}: ${String(e)}`);
  }
}

function push(fired: Notification[]): void {
  if (fired.length === 0) return;
  const known = new Set(news.items.map((item) => item.id));
  const fresh = fired.filter((item) => !known.has(item.id));
  if (fresh.length === 0) return;
  news.items = [...fresh, ...news.items].slice(0, NEWS_LIMIT);
}

/**
 * One cycle: look at the desk, compare, keep what changed. Called from the effect below, after
 * a short wait, and by tests directly.
 *
 * `watching` is whether the person can actually see the panel. It decides two things and only
 * two: whether the `seen` observation keeps up with the desk, and whether a return to work
 * summary may be produced. Notifications are collected either way, which is what makes the
 * centre worth opening when you come back.
 */
export async function sync(watching: boolean, day: string = todayIso()): Promise<void> {
  if (!desk.ready) return;
  await load();
  const next = snapshot({
    tasks: desk.tasks,
    repos: desk.pending,
    archived: desk.archivedCount,
    at: nowIso(),
    nudged: stored.last?.nudged ?? [],
  });

  if (stored.last) {
    const fired = diff(stored.last, next, day);
    push(fired);
    next.nudged = nudgedAfter(stored.last, fired, day);
  }

  /* The summary is offered once per panel session, and only after a gap long enough to have
     been an absence. `idleThresholdMs` works that gap out from the store's own timestamps. */
  if (watching && news.away === undefined && !news.awaySeen && stored.seen) {
    const threshold = idleThresholdMs(Object.values(next.tasks).map((task) => task.updated));
    const idle = Date.parse(next.at) - Date.parse(stored.seen.at);
    if (Number.isFinite(idle) && idle >= threshold) news.away = awaySummary(stored.seen, next);
  }

  current = next;
  stored.last = next;
  /* While the panel is being watched the person is up to date, so `seen` keeps up with the
     desk. It is held back only for as long as a summary is waiting to be looked at. */
  if (watching && (news.away === undefined || news.awaySeen)) stored.seen = next;
  if (!stored.seen) stored.seen = next;
  await save();
}

/**
 * Starts watching the desk. Returns the stop function.
 *
 * The effect reads the four things that mean "the desk has changed" and nothing else, so it is
 * woken by a task file being re-parsed, by a scan finishing, by a task being archived and by
 * the panel gaining or losing the focus. The work itself happens after a short wait, off the
 * effect, so a save that arrives as three watcher events is one observation and one write.
 */
export function startNews(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const ready = desk.ready;
      const watching = desk.panelVisible;
      /* Reading these is what subscribes the effect, and comparing them is what keeps a wake
         that changed nothing from writing the observation file again. Everything a
         notification can be about is in here: which tasks there are and when each was last
         written, each repository's uncommitted and unpushed counts, the archive, and the last
         scan, which moves on the scan interval and is what lets a nudge appear without a
         timer of this module's own. */
      const stamp = [
        desk.tasks.map((task) => `${task.file}@${task.updated}`).join(','),
        desk.pending.map((repo) => `${repo.repo}@${repo.dirty.length}/${repo.ahead}`).join(','),
        String(desk.archivedCount),
        desk.lastScan ?? '',
        watching ? 'watching' : 'hidden',
      ].join('|');
      if (!ready || stamp === lastStamp) return;
      lastStamp = stamp;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void sync(watching);
      }, NEWS_DEBOUNCE_MS);
      return () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
    });
  });
}

/** Forgets everything, so one test cannot see another test's news. */
export function resetNews(): void {
  news.items = [];
  news.away = undefined;
  news.awaySeen = false;
  news.open = false;
  stored = { version: 1 };
  current = undefined;
  loaded = false;
  lastStamp = '';
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
