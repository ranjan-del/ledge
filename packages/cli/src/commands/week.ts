import {
  WeekStore,
  isIsoDay,
  isIsoWeek,
  isoDay,
  isoWeekOf,
  moveWeekItem,
  numberWeek,
  setWeekItemDescription,
  shiftDay,
  shiftWeek,
  weekDays,
} from '@ledge/core';
import type { NumberedWeekItem, WeekFile, WeekItem } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, NotFoundError, UsageError } from '../context.ts';
import { renderWeek, toJson, weekItemLabel } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** Day words `--day` accepts for a day of the target week, Monday first. */
const WEEKDAYS: readonly (readonly string[])[] = [
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
  ['sun', 'sunday'],
];

const DAY_HELP = 'YYYY-MM-DD, today, tomorrow, mon to sun, or anytime';

/**
 * What `--day` resolved to: `anytime`, a day that is a fixed date whatever the week (a
 * `YYYY-MM-DD`, `today` or `tomorrow`), or a weekday that means that day of whichever week is
 * being acted on.
 */
type DayArg = { kind: 'anytime' } | { kind: 'date'; day: string } | { kind: 'weekday'; index: number };

/**
 * Reads what a person typed after `--day`. Returns undefined when it is none of the accepted
 * forms, so the caller can name the forms in its usage error. `today` and `tomorrow` are read
 * against `today`, the local calendar day, which a test can pin.
 */
export function parseDayArg(value: string, today: string): DayArg | undefined {
  const raw = value.trim().toLowerCase();
  if (raw === 'anytime') return { kind: 'anytime' };
  if (raw === 'today') return { kind: 'date', day: today };
  if (raw === 'tomorrow') return { kind: 'date', day: shiftDay(today, 1) };
  if (isIsoDay(raw)) return { kind: 'date', day: raw };
  const index = WEEKDAYS.findIndex((names) => names.includes(raw));
  return index === -1 ? undefined : { kind: 'weekday', index };
}

/** Reads `--week`, accepting `2026W40` as well as `2026-W40`, or undefined when it is not given. */
function weekFlag(ctx: CommandContext, name: string): string | undefined {
  const { week } = ctx.flags;
  if (week === undefined) return undefined;
  const spelled = week.trim().toUpperCase().replace(/^(\d{4})W/, '$1-W');
  if (!isIsoWeek(spelled)) {
    throw new UsageError(`"${week}" is not a week: use YYYY-Www, e.g. 2026-W40`, name);
  }
  return spelled;
}

/**
 * The week a command acts on: `--week`, or next week with `--next`, or last week with `--prev`,
 * or the current one. With none of them, a `--day` that is a fixed date picks its own week, so
 * `ledge week add "x" --day 2026-10-02` lands in the week that holds 2 October without the
 * person working out its number.
 */
function targetWeek(ctx: CommandContext, name: string, today: string, day?: DayArg): string {
  const { week, next, prev } = ctx.flags;
  if ([week !== undefined, next, prev].filter(Boolean).length > 1) {
    throw new UsageError('--week, --next and --prev are exclusive', name);
  }
  const spelled = weekFlag(ctx, name);
  if (spelled !== undefined) return spelled;
  if (next) return shiftWeek(isoWeekOf(today), 1);
  if (prev) return shiftWeek(isoWeekOf(today), -1);
  if (day?.kind === 'date') return isoWeekOf(day.day);
  return isoWeekOf(today);
}

/**
 * Turns a DayArg into the slot it names inside `week`: `anytime` or one of its seven days. A
 * fixed date that falls outside the week is a usage error rather than a silent move, because the
 * person asked for both and they disagree.
 */
function slotIn(week: string, day: DayArg, name: string): string {
  if (day.kind === 'anytime') return 'anytime';
  const days = weekDays(week);
  if (day.kind === 'weekday') return days[day.index]!;
  if (!days.includes(day.day)) {
    throw new UsageError(`${day.day} is not in ${week} (${days[0]} to ${days[6]})`, name);
  }
  return day.day;
}

/** Reads `--day` for a subcommand, failing with the accepted forms when it is not one of them. */
function dayFlag(ctx: CommandContext, name: string, today: string): DayArg | undefined {
  const raw = ctx.flags.day;
  if (raw === undefined) return undefined;
  const day = parseDayArg(raw, today);
  if (day === undefined) throw new UsageError(`"${raw}" is not a day: use ${DAY_HELP}`, name);
  return day;
}

/** The list a slot names, created on the WeekFile when a day has no list yet. */
function listFor(file: WeekFile, slot: string): WeekItem[] {
  if (slot === 'anytime') return file.anytime;
  file.days[slot] ??= [];
  return file.days[slot]!;
}

/** Drops day lists that have become empty, so the file and the JSON carry only real days. */
function pruneDays(file: WeekFile): void {
  for (const [day, items] of Object.entries(file.days)) {
    if (items.length === 0) delete file.days[day];
  }
}

/** A deep enough copy that changing its lists leaves the one that was read alone. */
function copyWeek(file: WeekFile): WeekFile {
  const days: Record<string, WeekItem[]> = {};
  for (const [day, items] of Object.entries(file.days)) days[day] = items.map((i) => ({ ...i }));
  return { ...file, anytime: file.anytime.map((i) => ({ ...i })), days };
}

/** The `--json` shape: the WeekFile as stored, plus every item with its number. */
function weekJson(file: WeekFile, today: string): unknown {
  return { ...file, today, numbered: numberWeek(file) };
}

/** Reads item number `n` from the arguments, 1-based, as `ledge week` printed it. */
function itemNumber(raw: string | undefined, name: string): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    throw new UsageError(`week ${name} needs a 1-based item number`, `week`);
  }
  return n;
}

/** The numbered item `n` names, or a NotFoundError that says how many there are. */
function findItem(file: WeekFile, n: number): NumberedWeekItem {
  const numbered = numberWeek(file);
  const item = numbered[n - 1];
  if (!item) {
    const count = numbered.length === 0 ? 'no items' : `items 1 to ${numbered.length}`;
    throw new NotFoundError(`No item ${n} in ${file.week}, which has ${count}`);
  }
  return item;
}

/**
 * The unticked items for `day` in its week, numbered as `ledge week` numbers them. Used by
 * `ledge today` and `ledge current --context`, where the week list is an extra: a week file that
 * cannot be read gives no items rather than taking the task context down with it.
 */
export function todaysWeekItems(day: string, store: WeekStore = new WeekStore()): NumberedWeekItem[] {
  try {
    const file = store.get(isoWeekOf(day));
    return numberWeek(file).filter((item) => item.day === day && !item.done);
  } catch {
    return [];
  }
}

/**
 * `ledge week [add|tick|untick|rm|move|describe]`: the personal list of things to do this week,
 * one file per ISO week under `$LEDGE_HOME/weeks/`. Bare, it prints the week grouped by day with
 * each item's number; the subcommands change one item by that number and print the result.
 * Items are only ever added here, when someone asks: the capture engine never writes a week file.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [sub, ...rest] = ctx.args;
  const today = isoDay();
  const store = openStore();
  const weeks = new WeekStore(store.home);

  const done = (file: WeekFile, message: string): number => {
    ctx.out(ctx.flags.json ? toJson(weekJson(file, today)) : message);
    return EXIT.ok;
  };

  if (ctx.flags.desc !== undefined && sub !== 'add') {
    throw new UsageError('--desc is for week add', 'week');
  }

  if (sub === undefined || sub === 'show') {
    if (ctx.flags.day !== undefined) {
      throw new UsageError('--day is for week add and week move', 'week');
    }
    const file = weeks.get(targetWeek(ctx, 'week', today));
    ctx.out(ctx.flags.json ? toJson(weekJson(file, today)) : renderWeek(file, today));
    return EXIT.ok;
  }

  if (sub === 'add') {
    const text = rest.join(' ').replace(/\s+/g, ' ').trim();
    if (text === '') throw new UsageError('week add needs the text of the item', 'week');
    const day = dayFlag(ctx, 'week', today) ?? { kind: 'anytime' as const };
    const week = targetWeek(ctx, 'week', today, day);
    const slot = slotIn(week, day, 'week');
    const taskId = ctx.flags.task?.trim();
    if (ctx.flags.task !== undefined && !taskId) {
      throw new UsageError('--task needs a task id', 'week');
    }
    const file = copyWeek(weeks.get(week));
    const item: WeekItem = { text, done: false };
    if (taskId) item.taskId = requireTask(store, taskId).id;
    const description = ctx.flags.desc?.trim() ?? '';
    if (description !== '') item.description = description;
    const list = listFor(file, slot);
    list.push(item);
    const saved = weeks.put(file);
    const n = numberWeek(saved).find((i) => i.day === slot && i.index === list.length - 1)!.n;
    return done(saved, `Added item ${n} to ${week}, ${weekItemLabel(slot)}: ${text}`);
  }

  if (sub === 'tick' || sub === 'untick' || sub === 'rm') {
    if (ctx.flags.day !== undefined) {
      throw new UsageError('--day is for week add and week move', 'week');
    }
    const n = itemNumber(rest[0], sub);
    const week = targetWeek(ctx, 'week', today);
    const file = copyWeek(weeks.get(week));
    const found = findItem(file, n);
    const list = listFor(file, found.day);
    if (sub === 'rm') {
      list.splice(found.index, 1);
      pruneDays(file);
      return done(weeks.put(file), `Removed item ${n} from ${week}: ${found.text}`);
    }
    list[found.index] = { ...list[found.index]!, done: sub === 'tick' };
    const verb = sub === 'tick' ? 'Ticked' : 'Unticked';
    return done(weeks.put(file), `${verb} item ${n} in ${week}: ${found.text}`);
  }

  if (sub === 'describe') {
    if (ctx.flags.day !== undefined) {
      throw new UsageError('--day is for week add and week move', 'week');
    }
    const n = itemNumber(rest[0], 'describe');
    if (rest.length < 2) {
      throw new UsageError('week describe needs the text, or "" to clear it', 'week');
    }
    const week = targetWeek(ctx, 'week', today);
    const file = weeks.get(week);
    const found = findItem(file, n);
    const saved = weeks.put(setWeekItemDescription(file, n, rest.slice(1).join(' ')));
    const verb = numberWeek(saved)[n - 1]!.description ? 'Described' : 'Cleared the description of';
    return done(saved, `${verb} item ${n} in ${week}: ${found.text}`);
  }

  if (sub === 'move' && rest[1] !== undefined) {
    // `move <n> <to>` reorders inside one week, so --next and --prev pick that week as they do
    // for tick and rm.
    if (ctx.flags.day !== undefined) {
      throw new UsageError('week move takes a position or --day, not both', 'week');
    }
    const n = itemNumber(rest[0], 'move');
    const to = itemNumber(rest[1], 'move');
    const week = targetWeek(ctx, 'week', today);
    const file = weeks.get(week);
    const found = findItem(file, n);
    const target = findItem(file, to);
    if (n === to) return done(file, `Item ${n} in ${week} is already there: ${found.text}`);
    const saved = weeks.put(moveWeekItem(file, n, to));
    return done(saved, `Moved "${found.text}" to item ${to}, ${weekItemLabel(target.day)}, in ${week}`);
  }

  if (sub === 'move' && ctx.flags.day === undefined && (ctx.flags.next || ctx.flags.prev)) {
    // With no position and no day, --next and --prev say where the item goes, and the item is
    // numbered in the week --week names, or in this one.
    if (ctx.flags.next && ctx.flags.prev) {
      throw new UsageError('--next and --prev are exclusive', 'week');
    }
    const n = itemNumber(rest[0], 'move');
    const from = weekFlag(ctx, 'week') ?? isoWeekOf(today);
    const to = shiftWeek(from, ctx.flags.next ? 1 : -1);
    const found = findItem(weeks.get(from), n);
    const moved = weeks.moveItem(from, n, to);
    return done(moved.from, `Moved "${found.text}" from ${from} to ${to}, Anytime`);
  }

  if (sub === 'move') {
    const n = itemNumber(rest[0], 'move');
    const day = dayFlag(ctx, 'week', today);
    if (day === undefined) {
      throw new UsageError(`week move needs a position <to>, --next, --prev or --day: ${DAY_HELP}`, 'week');
    }
    // The item is found by its number in the week being shown, so a fixed date never picks the
    // week here: it has to be inside the week the number came from.
    const week = targetWeek(ctx, 'week', today);
    const slot = slotIn(week, day, 'week');
    const file = copyWeek(weeks.get(week));
    const found = findItem(file, n);
    const [item] = listFor(file, found.day).splice(found.index, 1);
    listFor(file, slot).push(item!);
    pruneDays(file);
    const saved = weeks.put(file);
    return done(saved, `Moved "${found.text}" to ${weekItemLabel(slot)} in ${week}`);
  }

  throw new UsageError(`unknown week subcommand "${sub}"`, 'week');
}
