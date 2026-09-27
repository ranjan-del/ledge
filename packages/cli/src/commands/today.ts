import { WeekStore, isoDay, plannedFor } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { renderToday, toJson } from '../format.ts';
import { openStore } from '../store.ts';
import type { Today } from '../format.ts';
import { todaysWeekItems } from './week.ts';

/**
 * `ledge today`: the tasks planned for today, then the ones planned earlier and still not done
 * labelled as overdue, then the current tasks. This is the home view in the terminal, and it is
 * the reason `planned` exists: a list of tasks alone cannot say what is on for today. Current
 * tasks already shown above are not repeated, so each task appears exactly once. Today's
 * unticked items from the weekly to-do list follow the planned tasks, at most five lines of them,
 * numbered as `ledge week` numbers them so they can be ticked from here.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const day = isoDay();
  const all = store.list();
  const { today, overdue } = plannedFor(all, day);
  const shown = new Set([...today, ...overdue].map((task) => task.id));
  const current = all.filter((task) => task.status === 'current' && !shown.has(task.id));
  const week = todaysWeekItems(day, new WeekStore(store.home));
  const view: Today = { day, planned: today, overdue, current, week };
  ctx.out(ctx.flags.json ? toJson(view) : renderToday(view));
  return EXIT.ok;
}
