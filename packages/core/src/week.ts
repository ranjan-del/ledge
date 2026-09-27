/**
 * The weekly to-do list, pure half (weekly to-do contract, "File" and "Core API"). One Markdown
 * file per ISO week holds the things a person wants to remember that week, grouped by day plus
 * an Anytime bucket. An item is a reminder, not a step of a task, though it may point at one.
 *
 * Nothing here touches the filesystem or `node:` anything, so both entries of @ledge/core export
 * it and the desktop WebView reads and writes week files through exactly the code the CLI uses.
 * The store that puts the text on disk lives in ./week-node.ts.
 *
 * Every date here is a calendar day, `YYYY-MM-DD`, and all arithmetic is done in UTC on those
 * days. That is deliberate: a week is a run of seven calendar days, not a span of instants, so
 * the local time zone and daylight saving must not be able to move a day from one week into
 * another. "Which day is today" is the caller's question (see isoDay in ./planning.ts).
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isIsoDay } from './planning.ts';
import { splitSections } from './task-file.ts';

/** One line of a week file: the reminder, whether it is done, and the task it points at. */
export interface WeekItem {
  text: string;
  done: boolean;
  /** Id of a task the item links to, written as a trailing ` {task: <id>}` in the file. */
  taskId?: string;
}

/**
 * One parsed week file. `days` holds only days inside the week that have at least one item, so
 * a caller asking about a day should use itemsFor rather than index `days` directly.
 */
export interface WeekFile {
  /** The ISO week, `YYYY-Www`, e.g. `2026-W39`. */
  week: string;
  anytime: WeekItem[];
  /** Items per day, keyed `YYYY-MM-DD`. Only days inside the week are ever read into it. */
  days: Record<string, WeekItem[]>;
  updated?: string;
  /** Text the parser did not understand, kept verbatim and written after the known sections. */
  extra: string;
  /** Frontmatter keys other than `week` and `updated`, in their original order. */
  meta?: Record<string, unknown>;
}

/** Where a numbered item sits: `anytime`, or the `YYYY-MM-DD` day it is under. */
export type WeekSlot = 'anytime' | string;

/**
 * An item with the 1-based number `ledge week` prints next to it, and where it lives in the
 * file. `index` is the position inside its own list, so a caller can change exactly that item.
 */
export interface NumberedWeekItem extends WeekItem {
  n: number;
  day: WeekSlot;
  index: number;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WEEK = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;
/** Day names as the file writes them, Monday first, which is where an ISO week starts. */
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const ANYTIME_HEADING = '## Anytime';
const DAY_HEADING = /^##\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4}-\d{2}-\d{2})$/;
/** The same task-list syntax as a checklist item, so a week file reads like any GitHub list. */
const ITEM = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
/** The link suffix. It is taken off the text only when it ends the line. */
const TASK_LINK = /\s*\{task:\s*([^\s{}]+)\s*\}$/;
/** An indented line that starts no new item, so it is the wrapped tail of the item above. */
const CONTINUATION = /^\s+\S/;
const KNOWN_KEYS = new Set(['week', 'updated']);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Milliseconds since the epoch of a `YYYY-MM-DD` day at UTC midnight. Throws on a non-day. */
function dayMs(day: string): number {
  if (!isIsoDay(day)) throw new RangeError(`Not a YYYY-MM-DD day: ${day}`);
  const m = ISO_DAY.exec(day)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dayOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 0 for Monday through 6 for Sunday, the ISO order, rather than JavaScript's Sunday-first. */
function isoWeekday(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * The Monday that starts week 1 of an ISO year. Week 1 is the week that contains 4 January, so
 * its Monday can fall as early as 29 December of the year before.
 */
function firstMonday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - isoWeekday(jan4) * DAY_MS;
}

/** 52 or 53: how many ISO weeks the ISO year has, which is where its 28 December falls. */
function weeksIn(year: number): number {
  const dec28 = Date.UTC(year, 11, 28);
  return Math.floor((dec28 - firstMonday(year)) / (7 * DAY_MS)) + 1;
}

/**
 * True when a value is a real ISO week spelled `YYYY-Www`: two digits of week, from 01 up to the
 * 52 or 53 that year has. `2026-W53` is false because 2026 has 52 weeks, and `2020-W53` is true.
 */
export function isIsoWeek(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_WEEK.exec(value);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= weeksIn(Number(m[1]));
}

/**
 * The ISO week a calendar day belongs to, e.g. `2026-09-27` gives `2026-W39` (it is that week's
 * Sunday). The week's year is the year its Thursday falls in, which is why `2027-01-01` gives
 * `2026-W53` and `2021-01-03` gives `2020-W53`, while `2024-12-30` gives `2025-W01`. Throws a
 * RangeError for anything that is not a real `YYYY-MM-DD` day.
 */
export function isoWeekOf(day: string): string {
  const ms = dayMs(day);
  const thursday = ms + (3 - isoWeekday(ms)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - firstMonday(year)) / (7 * DAY_MS)) + 1;
  return `${year}-W${pad(week)}`;
}

/**
 * The seven days of an ISO week, Monday first, as `YYYY-MM-DD`. The days of week 1 or of week
 * 53 can belong to two calendar years, and they are listed as they fall. Throws a RangeError for
 * a value isIsoWeek refuses.
 */
export function weekDays(week: string): string[] {
  if (!isIsoWeek(week)) throw new RangeError(`Not a YYYY-Www week: ${week}`);
  const m = ISO_WEEK.exec(week)!;
  const monday = firstMonday(Number(m[1])) + (Number(m[2]) - 1) * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => dayOf(monday + i * DAY_MS));
}

/**
 * The week `n` weeks after `week`, or before it for a negative `n`. It moves the Monday and asks
 * which week that is, so a year with 53 weeks is stepped through rather than skipped.
 */
export function shiftWeek(week: string, n: number): string {
  const monday = dayMs(weekDays(week)[0]!);
  return isoWeekOf(dayOf(monday + Math.trunc(n) * 7 * DAY_MS));
}

/** The three-letter day name the file writes for a day, `Mon` to `Sun`. */
export function weekdayName(day: string): string {
  return WEEKDAY_NAMES[isoWeekday(dayMs(day))]!;
}

/** A week with nothing in it, which is also what a missing file reads as. */
export function emptyWeek(week: string): WeekFile {
  return { week, anytime: [], days: {}, extra: '' };
}

/** Reads one item line, taking a trailing `{task: <id>}` off the text into `taskId`. */
function readItem(mark: string, rest: string): WeekItem {
  let text = rest.trim();
  const item: WeekItem = { text, done: mark.toLowerCase() === 'x' };
  const link = TASK_LINK.exec(text);
  if (link) {
    text = text.slice(0, link.index).trim();
    item.text = text;
    item.taskId = link[1]!;
  }
  return item;
}

/**
 * Reads the items of one known section into `into`. A wrapped line continues the item above it,
 * as it does in a task checklist. Any other non-blank line is not an item and goes to `extra`,
 * so hand-written prose under a day heading is kept rather than dropped. Blank lines between
 * such lines go with them, so a paragraph break in the prose survives the move; blank lines
 * around items are only spacing and are not kept.
 */
function readItems(lines: string[], into: WeekItem[], extra: string[]): void {
  let last: WeekItem | undefined;
  const stray: string[] = [];
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (m) {
      last = readItem(m[1]!, m[2]!);
      into.push(last);
    } else if (last !== undefined && CONTINUATION.test(line)) {
      // The link suffix, when there is one, is on the line that ends the item, so the text is
      // joined first and the suffix read again from the whole of it.
      const joined = readItem(last.done ? 'x' : ' ', `${last.text} ${line.trim()}`);
      if (joined.taskId === undefined && last.taskId !== undefined) joined.taskId = last.taskId;
      Object.assign(last, joined);
    } else if (line.trim() !== '') {
      stray.push(line);
      last = undefined;
    } else if (stray.length > 0) {
      stray.push(line);
    }
  }
  while (stray.length > 0 && stray[stray.length - 1]!.trim() === '') stray.pop();
  extra.push(...stray);
}

/**
 * Splits a leading `---` block off the lines. A file with no frontmatter, or with frontmatter
 * that is not a YAML mapping, is read as all body, so a hand-damaged header costs the header and
 * nothing under it: the lines end up in `extra` and are written back.
 */
function splitFront(lines: string[]): { data: Record<string, unknown>; bodyStart: number } {
  if (lines[0]?.trim() !== '---') return { data: {}, bodyStart: 0 };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return { data: {}, bodyStart: 0 };
  const yamlText = lines.slice(1, end).join('\n');
  try {
    const data: unknown = yamlText.trim() === '' ? {} : parseYaml(yamlText);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { data: {}, bodyStart: 0 };
    }
    return { data: data as Record<string, unknown>, bodyStart: end + 1 };
  } catch {
    return { data: {}, bodyStart: 0 };
  }
}

/**
 * Parses the text of a week file for `week`. It never throws on content: a week file is a list
 * a person keeps by hand as well as through Ledge, and an unreadable reminder list is worse than
 * one with some lines moved to the end.
 *
 * - `week` comes from the argument, which is the file's name, not from the frontmatter.
 * - `## Anytime` and `## <Ddd> <YYYY-MM-DD>` for a day inside this week are known sections. The
 *   date decides the day; the name in front of it is written fresh on the next save. A section
 *   that appears twice has its items merged in file order.
 * - Everything else, a day outside the week included, is kept verbatim in `extra`, as task
 *   files do, and so are unknown frontmatter keys in `meta`.
 * - A line inside a fenced code block is never a heading, by the same rule task files follow.
 */
export function parseWeek(text: string, week: string): WeekFile {
  const days = new Set(weekDays(week));
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const { data, bodyStart } = splitFront(lines);

  const file = emptyWeek(week);
  const updated = data.updated;
  if (updated instanceof Date) file.updated = updated.toISOString();
  else if (updated !== undefined && updated !== null) file.updated = String(updated);
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) meta[key] = value;
  }
  if (Object.keys(meta).length > 0) file.meta = meta;

  const extra: string[] = [];
  for (const section of splitSections(lines.slice(bodyStart))) {
    if (section.heading === ANYTIME_HEADING) {
      readItems(section.lines, file.anytime, extra);
      continue;
    }
    const day = DAY_HEADING.exec(section.heading)?.[2];
    if (day !== undefined && days.has(day)) {
      const items = file.days[day] ?? [];
      readItems(section.lines, items, extra);
      if (items.length > 0) file.days[day] = items;
      continue;
    }
    if (section.raw !== '') extra.push(section.raw);
    extra.push(...section.lines);
  }
  file.extra = extra.join('\n').trim();
  return file;
}

/** One item as a task-list line. A line break in the text would end the item, so it is folded. */
function itemLine(item: WeekItem): string {
  const text = item.text.replace(/\s*\n\s*/g, ' ').trim();
  const id = item.taskId?.trim() ?? '';
  const link = id !== '' ? ` {task: ${id}}` : '';
  return `- [${item.done ? 'x' : ' '}] ${text}${link}`;
}

/**
 * Serializes a week back to its file, the inverse of parseWeek. Frontmatter is `week`, then
 * `updated` when there is one, then the `meta` keys in their order. Then `## Anytime` and each
 * day inside the week, Monday first, and only those that hold an item, so an empty day costs the
 * file nothing. A day key outside the week, which parseWeek never produces, is still written,
 * after the week's own days, because dropping a caller's items silently is the one thing this
 * must not do. `extra` comes last. Output ends with a single newline, and parsing it gives back
 * the same WeekFile, so a file Ledge wrote round trips byte for byte.
 */
export function serializeWeek(w: WeekFile): string {
  const front: Record<string, unknown> = { week: w.week };
  if (w.updated !== undefined) front.updated = w.updated;
  for (const [key, value] of Object.entries(w.meta ?? {})) {
    if (!KNOWN_KEYS.has(key)) front[key] = value;
  }
  const yamlText = stringifyYaml(front, { lineWidth: 0, indentSeq: true }).trimEnd();
  const parts: string[] = ['---', yamlText, '---', ''];

  const section = (heading: string, items: WeekItem[]) => {
    if (items.length === 0) return;
    parts.push(heading, '', ...items.map(itemLine), '');
  };
  section(ANYTIME_HEADING, w.anytime);
  const inWeek = isIsoWeek(w.week) ? weekDays(w.week) : [];
  const outside = Object.keys(w.days).filter((day) => !inWeek.includes(day)).sort();
  for (const day of [...inWeek, ...outside]) {
    const items = w.days[day] ?? [];
    const name = isIsoDay(day) ? `${weekdayName(day)} ${day}` : day;
    section(`## ${name}`, items);
  }
  if (w.extra.trim() !== '') parts.push(w.extra.trim(), '');
  return parts.join('\n').replace(/\n+$/, '\n');
}

/** That day's items, not Anytime, in file order. A day with none gives an empty list. */
export function itemsFor(w: WeekFile, day: string): WeekItem[] {
  return w.days[day] ?? [];
}

/**
 * Every item with the number `ledge week` shows for it: Anytime first, then the days Monday to
 * Sunday, items in file order. The numbers are stable for a given file, so a number printed a
 * moment ago still names the same item when it is ticked, as long as nothing wrote in between.
 */
export function numberWeek(w: WeekFile): NumberedWeekItem[] {
  const numbered: NumberedWeekItem[] = [];
  const push = (day: WeekSlot, items: WeekItem[]) => {
    items.forEach((item, index) => numbered.push({ ...item, n: numbered.length + 1, day, index }));
  };
  push('anytime', w.anytime);
  const inWeek = isIsoWeek(w.week) ? weekDays(w.week) : [];
  const outside = Object.keys(w.days).filter((day) => !inWeek.includes(day)).sort();
  for (const day of [...inWeek, ...outside]) push(day, w.days[day] ?? []);
  return numbered;
}
