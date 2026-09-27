/**
 * The weekly to-do, as the panel shows and edits it. Everything here is pure: the words on the
 * week header, which day is which, and the edits (add, change, move, remove) as functions from
 * one WeekFile to the next. The store applies them to the file on disk; the views only call the
 * store. The file format itself belongs to core (./week.ts until the merge).
 */
import { isoWeekOf, shiftWeek, weekDays, type WeekFile, type WeekItem } from '@ledge/core/pure';

/** Where an item lives: `anytime`, or a `YYYY-MM-DD` day inside the week. */
export type WeekSlot = 'anytime' | string;

/** One item and where it is, which is how an edit names what it changes. */
export interface WeekRef {
  slot: WeekSlot;
  index: number;
}

export const ANYTIME: WeekSlot = 'anytime';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An empty week, which is what a missing file is. */
export function emptyWeek(week: string): WeekFile {
  return { week, anytime: [], days: {}, extra: '' };
}

function dayParts(day: string): { month: number; date: number } {
  return { month: Number(day.slice(5, 7)) - 1, date: Number(day.slice(8, 10)) };
}

/** `Week 39, 21 to 27 Sep`, or `Week 40, 28 Sep to 4 Oct` across a month. */
export function weekLabel(week: string): string {
  const days = weekDays(week);
  const a = dayParts(days[0]!);
  const b = dayParts(days[6]!);
  const n = Number(week.slice(-2));
  const from = a.month === b.month ? `${a.date}` : `${a.date} ${MONTHS[a.month]}`;
  return `Week ${n}, ${from} to ${b.date} ${MONTHS[b.month]}`;
}

/** `Mon 21 Sep`, the heading a day section wears. */
export function dayHeading(day: string): string {
  const i = weekDays(isoWeekOf(day)).indexOf(day);
  const { month, date } = dayParts(day);
  return `${DAY_NAMES[i]} ${date} ${MONTHS[month]}`;
}

/** `Monday`, for labels read aloud. */
export function dayName(day: string): string {
  return LONG_DAY_NAMES[weekDays(isoWeekOf(day)).indexOf(day)] ?? day;
}

/** The items in one slot. */
export function slotItems(w: WeekFile, slot: WeekSlot): WeekItem[] {
  return slot === ANYTIME ? w.anytime : (w.days[slot] ?? []);
}

function withSlot(w: WeekFile, slot: WeekSlot, items: WeekItem[]): WeekFile {
  if (slot === ANYTIME) return { ...w, anytime: items };
  const days = { ...w.days };
  if (items.length === 0) delete days[slot];
  else days[slot] = items;
  /* Calendar order, so what the store writes is what the file format says. */
  const ordered: Record<string, WeekItem[]> = {};
  for (const day of weekDays(w.week)) if (days[day]) ordered[day] = days[day]!;
  return { ...w, days: ordered };
}

/** True when a slot names Anytime or a day inside this week. */
export function isSlotOf(week: string, slot: WeekSlot): boolean {
  return slot === ANYTIME || weekDays(week).includes(slot);
}

/** A text as one line: an item is one line of the file, so newlines become spaces. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function addItem(w: WeekFile, slot: WeekSlot, text: string, taskId?: string): WeekFile {
  const clean = cleanText(text);
  if (clean === '') throw new Error('An item needs some text.');
  if (!isSlotOf(w.week, slot)) throw new Error(`${slot} is not in ${w.week}.`);
  const item: WeekItem = taskId ? { text: clean, done: false, taskId } : { text: clean, done: false };
  return withSlot(w, slot, [...slotItems(w, slot), item]);
}

/** What an edit may change on one item. A `taskId` key set to undefined unlinks it. */
export type WeekItemPatch = Partial<WeekItem>;

/** Changes one item's text, tick or link. */
export function updateItem(w: WeekFile, ref: WeekRef, patch: WeekItemPatch): WeekFile {
  const items = slotItems(w, ref.slot);
  const item = items[ref.index];
  if (!item) return w;
  const next: WeekItem = { ...item, ...patch };
  if ('text' in patch) {
    next.text = cleanText(patch.text ?? '');
    if (next.text === '') throw new Error('An item needs some text.');
  }
  if ('taskId' in patch && !patch.taskId) delete next.taskId;
  return withSlot(w, ref.slot, items.map((it, i) => (i === ref.index ? next : it)));
}

export function removeItem(w: WeekFile, ref: WeekRef): WeekFile {
  const items = slotItems(w, ref.slot);
  if (!items[ref.index]) return w;
  return withSlot(w, ref.slot, items.filter((_, i) => i !== ref.index));
}

/** Moves an item to the end of another slot in the same week. */
export function moveItem(w: WeekFile, ref: WeekRef, to: WeekSlot): WeekFile {
  const item = slotItems(w, ref.slot)[ref.index];
  if (!item || to === ref.slot || !isSlotOf(w.week, to)) return w;
  const removed = removeItem(w, ref);
  return withSlot(removed, to, [...slotItems(removed, to), item]);
}

/** One item and where it lives in the file. */
export interface WeekEntry {
  item: WeekItem;
  ref: WeekRef;
}

/**
 * Every item in the week as one list, in file order: Anytime first, then any day sections. The
 * panel shows a week as a single list of things to get done this week, not as seven days, so an
 * item written to a day by an older Ledge or by `ledge week add --day` still shows here.
 */
export function weekEntries(w: WeekFile): WeekEntry[] {
  const out: WeekEntry[] = w.anytime.map((item, index) => ({ item, ref: { slot: ANYTIME, index } }));
  for (const day of weekDays(w.week)) {
    (w.days[day] ?? []).forEach((item, index) => out.push({ item, ref: { slot: day, index } }));
  }
  return out;
}

/** The week's items that are not ticked yet, the list at the top of the To-do view. */
export function openEntries(w: WeekFile): WeekEntry[] {
  return weekEntries(w).filter((e) => !e.item.done);
}

/** The week's ticked items, the Completed list under the open ones. */
export function doneEntries(w: WeekFile): WeekEntry[] {
  return weekEntries(w).filter((e) => e.item.done);
}

/** Today's items that are not ticked yet, each with where it lives. */
export function openToday(w: WeekFile, day: string): { item: WeekItem; ref: WeekRef }[] {
  return slotItems(w, day)
    .map((item, index) => ({ item, ref: { slot: day, index } }))
    .filter((e) => !e.item.done);
}

/** Unticked items this week outside today: Anytime and the other days. */
export function openElsewhere(w: WeekFile, day: string): number {
  const other = Object.entries(w.days)
    .filter(([d]) => d !== day)
    .flatMap(([, items]) => items);
  return [...w.anytime, ...other].filter((i) => !i.done).length;
}

/** Every unticked item in the week. */
export function openCount(w: WeekFile): number {
  return [...w.anytime, ...Object.values(w.days).flat()].filter((i) => !i.done).length;
}

/**
 * The week as `ledge week` numbers it, one line per item: Anytime first, then days in order,
 * items in file order, 1-based. The assistant's context quotes this so the model can tick or
 * remove by the same number the command line would print.
 */
export function numberedLines(w: WeekFile): string[] {
  const out: string[] = [];
  let n = 0;
  const push = (label: string, items: WeekItem[]) => {
    for (const item of items) {
      n += 1;
      const link = item.taskId ? ` (task ${item.taskId})` : '';
      out.push(`${n}. [${item.done ? 'x' : ' '}] ${label}: ${item.text}${link}`);
    }
  };
  push('anytime', w.anytime);
  weekDays(w.week).forEach((day, i) => push(`${DAY_NAMES[i]} ${day}`, w.days[day] ?? []));
  return out;
}

/** The week before or after, and this week, for the header's three buttons. */
export function neighbours(week: string): { prev: string; next: string } {
  return { prev: shiftWeek(week, -1), next: shiftWeek(week, 1) };
}

/* ------------------------------------------------------------------ the month calendar */

const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_MS = 86_400_000;

function utcDay(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function dayFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The month a day is in, `YYYY-MM`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The month `n` months after `month`, or before it for a negative `n`. */
export function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** `September 2026`. */
export function monthLabel(month: string): string {
  return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** A day moved by `n` days. */
export function addDays(day: string, n: number): string {
  return dayFromUtc(utcDay(day) + n * DAY_MS);
}

export interface MonthWeek {
  /** The ISO week this row is. */
  week: string;
  /** Seven days, Monday first, each with whether it falls inside the month. */
  days: { day: string; inMonth: boolean }[];
}

/** The rows of a month grid: every ISO week that has a day in the month, Monday first. */
export function monthGrid(month: string): MonthWeek[] {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const rows: MonthWeek[] = [];
  let week = isoWeekOf(first);
  while (true) {
    const days = weekDays(week);
    rows.push({ week, days: days.map((day) => ({ day, inMonth: monthOf(day) === month })) });
    if (days[6]! >= last) break;
    week = shiftWeek(week, 1);
  }
  return rows;
}

/** A day in the week file has at least one item, ticked or not. */
export function dayHasItems(w: WeekFile | undefined, day: string): boolean {
  return (w?.days[day]?.length ?? 0) > 0;
}

/** The week file holds any item at all, Anytime included. */
export function weekHasItems(w: WeekFile | undefined): boolean {
  if (!w) return false;
  return w.anytime.length > 0 || Object.values(w.days).some((items) => items.length > 0);
}
