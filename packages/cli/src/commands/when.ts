import { isIsoDay, isoDay, shiftDay } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * Turns what a person types into a calendar day, or undefined for `none`. The words are accepted
 * because typing today's date by hand is the kind of friction that stops a field being used at
 * all. Returns null when the argument is not a day Ledge understands.
 */
export function resolveDay(value: string): string | undefined | null {
  const raw = value.trim().toLowerCase();
  if (raw === 'none' || raw === 'clear') return undefined;
  if (raw === 'today') return isoDay();
  if (raw === 'tomorrow') return shiftDay(isoDay(), 1);
  if (raw === 'yesterday') return shiftDay(isoDay(), -1);
  return isIsoDay(raw) ? raw : null;
}

/**
 * `ledge when <id> <YYYY-MM-DD|today|tomorrow|none>`: sets or clears the day the person intends
 * to work on the task. That day is what makes `ledge today` and the panel's home view possible:
 * without it a task list cannot answer what is on for today.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, raw] = ctx.args;
  if (!id) throw new UsageError('when needs a task id', 'when');
  if (!raw?.trim()) throw new UsageError('when needs a day: YYYY-MM-DD, today, tomorrow or none',
    'when');
  const day = resolveDay(raw);
  if (day === null) {
    throw new UsageError(`"${raw}" is not a day: use YYYY-MM-DD, today, tomorrow or none`, 'when');
  }
  const store = openStore();
  requireTask(store, id);
  const task = store.setPlanned(id, day);
  if (ctx.flags.json) ctx.out(toJson(task));
  else if (day === undefined) ctx.out(`Cleared the planned day for ${task.id}`);
  else ctx.out(`Planned ${task.id} for ${day}`);
  return EXIT.ok;
}
