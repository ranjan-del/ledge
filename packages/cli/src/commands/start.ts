import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** `ledge start <id>`: sets status current and order 1, shifting other current tasks down. */
export async function run(ctx: CommandContext): Promise<number> {
  const id = ctx.args[0];
  if (!id) throw new UsageError('start needs a task id', 'start');
  const store = openStore();
  requireTask(store, id);
  const task = store.start(id);
  ctx.out(ctx.flags.json ? toJson(task) : `Started ${task.id}: ${task.title}`);
  return EXIT.ok;
}
