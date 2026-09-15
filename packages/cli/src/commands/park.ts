import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** `ledge park <id> "reason"`: moves the task to the backlog and records why it was parked. */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, reason] = ctx.args;
  if (!id) throw new UsageError('park needs a task id', 'park');
  if (!reason?.trim()) throw new UsageError('park needs a reason', 'park');
  const store = openStore();
  requireTask(store, id);
  const task = store.park(id, reason.trim());
  ctx.out(ctx.flags.json ? toJson(task) : `Parked ${task.id}: ${task.parked}`);
  return EXIT.ok;
}
