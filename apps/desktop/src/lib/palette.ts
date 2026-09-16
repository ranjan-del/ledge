/**
 * What the command palette offers, as data. Given the tasks on the desk and whatever has been
 * typed, this returns groups of rows and, on each row, the command choosing it should run. It
 * exists so the palette component holds a query, an index and some markup, and nothing else:
 * what the palette knows how to find is a decision this file takes and tests can read.
 *
 * Two rules the whole file follows. Every row comes from something the store already holds: a
 * task file, a session id recorded on one, a dated note, or an action the panel already has a
 * button for somewhere. And matching is the rule `lib/search.ts` documents, imported from there
 * rather than written again: every term must appear, case is ignored, nothing is ranked and
 * nothing is stemmed, so a person can predict what the palette will show.
 *
 * Group order is Tasks, Sessions, Notes, Actions, and that order is deliberate. The first row
 * is the one Enter runs, and a palette that put "create a task called tab" above the task you
 * were looking for would make the safest key in the list the most destructive one.
 */
import { sessionsFor, type Task } from '@ledge/core/pure';
import { basename } from './paths.ts';
import { matches as matchesAll, searchDesk, terms as queryTerms, type Hit } from './search.ts';
import { dayLabel, relativeTime, todayIso } from './time.ts';

/** The four surfaces, spelled here so this file never has to import the store. */
export type PaletteSurface = 'now' | 'sessions' | 'tasks' | 'memory';

export type PaletteKind = 'task' | 'session' | 'note' | 'action';

/**
 * What choosing a row does, as data rather than as a closure. The panel owns the doing, so
 * this file can be tested without a filesystem and without a window.
 */
export type PaletteCommand =
  | { type: 'add-task'; title: string }
  | { type: 'open-task'; file: string }
  | { type: 'surface'; surface: PaletteSurface }
  | { type: 'rescan' };

export interface PaletteItem {
  /** Stable within one build of the list, so the keyed each block does not re-create rows. */
  id: string;
  kind: PaletteKind;
  /** The line the row shows. */
  label: string;
  /** The quiet caption under it. Absent when there is nothing true to add. */
  sub?: string;
  /** The label is an opaque identifier, so it is set in the mono face. */
  mono?: boolean;
  command: PaletteCommand;
}

export interface PaletteGroup {
  kind: PaletteKind;
  /** The quiet label above the group. */
  label: string;
  items: PaletteItem[];
}

/* Caps per group. The list has to stay walkable with two keys, so a broad query shortens each
   group rather than scrolling for a page and a half. */
const TASK_LIMIT = 6;
const SESSION_LIMIT = 4;
const NOTE_LIMIT = 6;
/** How much of a note's matching line a row shows before it is cut. About two lines. */
const NOTE_CHARS = 84;
/** Tasks shown for an empty query, most recently written first. */
const RECENT_LIMIT = 5;
/** Actions shown for an empty query. A couple, not a menu. */
const IDLE_ACTIONS = 2;
/* Asked of searchDesk before the per-group caps. It returns tasks before notes from one list,
   so a small cap there would starve the notes half on a broad query. */
const HIT_LIMIT = 80;

interface ActionSpec {
  label: string;
  /** Words that should find this action without being written on it. */
  keywords: string;
  sub: string;
  command: PaletteCommand;
}

const SURFACE_ACTIONS: { surface: PaletteSurface; label: string; keywords: string; sub: string }[] =
  [
    { surface: 'now', label: 'Go to Now', keywords: 'home today current working', sub: 'Surface' },
    {
      surface: 'sessions',
      label: 'Go to Sessions',
      keywords: 'claude code session ids resume',
      sub: 'Surface',
    },
    {
      surface: 'tasks',
      label: 'Go to Tasks',
      keywords: 'live done backlog pending archive lists',
      sub: 'Surface',
    },
    {
      surface: 'memory',
      label: 'Go to Memory',
      keywords: 'notes reasoning decisions dead ends',
      sub: 'Surface',
    },
  ];

const RESCAN: ActionSpec = {
  label: 'Refresh the git scan',
  keywords: 'git refresh rescan repositories pending uncommitted unpushed',
  sub: 'Runs the scan now instead of waiting for the interval',
  command: { type: 'rescan' },
};

function taskItem(task: Task, detail: string): PaletteItem {
  const repo = task.repo ? basename(task.repo) : '';
  const sub = [repo, detail].filter((part) => part !== '').join(' · ');
  const item: PaletteItem = {
    id: `task:${task.file}`,
    kind: 'task',
    label: task.title,
    command: { type: 'open-task', file: task.file },
  };
  if (sub !== '') item.sub = sub;
  return item;
}

/** The most recently written tasks, which is what an unasked palette can honestly offer. */
function recentTasks(tasks: Task[], now: number): PaletteItem[] {
  return [...tasks]
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, RECENT_LIMIT)
    .map((task) => taskItem(task, relativeTime(task.updated, now)));
}

/**
 * Tasks a query finds: the title, requirement, checklist and plan through `searchDesk`, and
 * then the repository path, which `searchDesk` does not look at because the task surfaces
 * search text a person wrote rather than where the work lives. A task already found once is
 * not offered twice.
 */
function matchedTasks(tasks: Task[], hits: Hit[], words: string[], now: number): PaletteItem[] {
  const items: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (hit.kind !== 'task' || seen.has(hit.task.file)) continue;
    seen.add(hit.task.file);
    const detail = hit.where === 'title' ? relativeTime(hit.task.updated, now) : hit.where;
    items.push(taskItem(hit.task, detail));
  }
  for (const task of tasks) {
    if (seen.has(task.file) || task.repo === undefined) continue;
    if (!matchesAll(task.repo, words)) continue;
    seen.add(task.file);
    items.push(taskItem(task, 'repository'));
  }
  return items.slice(0, TASK_LIMIT);
}

/**
 * Sessions a query finds, matched on the id, the task's title and the repository, because all
 * three are how a person remembers which session they want. Nothing is offered for an empty
 * query: a bare list of ids answers no question anybody asked.
 */
function matchedSessions(tasks: Task[], words: string[], now: number): PaletteItem[] {
  if (words.length === 0) return [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const items: PaletteItem[] = [];
  for (const ref of sessionsFor(tasks)) {
    const task = byId.get(ref.taskId);
    if (!task) continue;
    if (!matchesAll(`${ref.id} ${ref.taskTitle} ${ref.repo ?? ''}`, words)) continue;
    items.push({
      id: `session:${ref.taskId}:${ref.id}`,
      kind: 'session',
      label: ref.id,
      mono: true,
      sub: `${ref.taskTitle} · last seen ${relativeTime(ref.lastSeen, now)}`,
      command: { type: 'open-task', file: task.file },
    });
    if (items.length === SESSION_LIMIT) break;
  }
  return items;
}

/**
 * A matched line, shortened at a word boundary. A note is prose and its first matching line can
 * run to a paragraph, which at 380 px would give one row four lines and the six rows under it
 * none. The ellipsis is there to say the line was cut rather than to pretend it ended.
 */
export function shorten(text: string, max = NOTE_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Note hits from `searchDesk`, which runs them through `searchMemory` in core. */
function matchedNotes(hits: Hit[], day: string): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const [i, hit] of hits.entries()) {
    if (hit.kind !== 'note') continue;
    items.push({
      id: `note:${hit.task.file}:${hit.date ?? ''}:${i}`,
      kind: 'note',
      label: shorten(hit.text),
      sub: `${dayLabel(hit.date ?? '', day)} · ${hit.task.title}`,
      command: { type: 'open-task', file: hit.task.file },
    });
    if (items.length === NOTE_LIMIT) break;
  }
  return items;
}

/**
 * The actions, every one of which the panel already does somewhere else. Creating a task from
 * the typed text is first, because it is the only one carrying what was typed, and it appears
 * only once something has been typed for it to carry. With an empty query the rest are capped
 * at a couple: an unasked palette should suggest, not present a menu.
 */
function actionItems(query: string, surface: PaletteSurface, words: string[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  const title = query.trim();
  if (title !== '') {
    items.push({
      id: 'action:add-task',
      kind: 'action',
      label: `Create task "${title}"`,
      sub: 'Adds it to your current work with this title',
      command: { type: 'add-task', title },
    });
  }
  const rest: ActionSpec[] = [
    RESCAN,
    ...SURFACE_ACTIONS.filter((entry) => entry.surface !== surface).map((entry) => ({
      label: entry.label,
      keywords: entry.keywords,
      sub: entry.sub,
      command: { type: 'surface', surface: entry.surface } as PaletteCommand,
    })),
  ];
  const offered =
    words.length === 0
      ? rest.slice(0, IDLE_ACTIONS)
      : rest.filter((spec) => matchesAll(`${spec.label} ${spec.keywords}`, words));
  for (const spec of offered) {
    items.push({
      id: `action:${spec.label}`,
      kind: 'action',
      label: spec.label,
      sub: spec.sub,
      command: spec.command,
    });
  }
  return items;
}

export interface PaletteInput {
  tasks: Task[];
  query: string;
  /** The surface you are on, so the palette never offers to take you where you already are. */
  surface: PaletteSurface;
  /** Today as YYYY-MM-DD, for the note captions. A parameter so tests need no clock. */
  day?: string;
  /** Now in milliseconds, for the relative times. A parameter for the same reason. */
  now?: number;
}

/**
 * The palette's whole answer: groups in a fixed order, each one absent when it has no rows.
 * An empty query is answered with the most recent tasks and a couple of actions rather than
 * with nothing, because a palette that says nothing until it is typed into teaches nobody what
 * it can do.
 */
export function buildPalette(input: PaletteInput): PaletteGroup[] {
  const day = input.day ?? todayIso();
  const now = input.now ?? Date.now();
  const words = queryTerms(input.query);
  const hits = words.length === 0 ? [] : searchDesk(input.tasks, input.query, HIT_LIMIT);
  const groups: PaletteGroup[] = [];

  const tasks =
    words.length === 0
      ? recentTasks(input.tasks, now)
      : matchedTasks(input.tasks, hits, words, now);
  if (tasks.length > 0) {
    groups.push({
      kind: 'task',
      label: words.length === 0 ? 'Recent tasks' : 'Tasks',
      items: tasks,
    });
  }

  const sessions = matchedSessions(input.tasks, words, now);
  if (sessions.length > 0) groups.push({ kind: 'session', label: 'Sessions', items: sessions });

  const notes = matchedNotes(hits, day);
  if (notes.length > 0) groups.push({ kind: 'note', label: 'Notes', items: notes });

  const actions = actionItems(input.query, input.surface, words);
  if (actions.length > 0) groups.push({ kind: 'action', label: 'Actions', items: actions });

  return groups;
}

/**
 * The groups as one list, in the order they are drawn. Groups are a visual grouping and
 * nothing more: up and down walk this list straight through them, which is what "keyboard
 * first" has to mean for a list whose headings are not stops.
 */
export function flattenPalette(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((group) => group.items);
}
