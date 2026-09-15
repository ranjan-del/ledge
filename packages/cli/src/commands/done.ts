import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** `ledge done <id>`: sets status done and moves the file to the archive folder. */
export async function run(ctx: CommandContext): Promise<number> {
  const id = ctx.args[0];
  if (!id) throw new UsageError('done needs a task id', 'done');
  const store = openStore();
  requireTask(store, id);
  const task = store.done(id);
  ctx.out(ctx.flags.json ? toJson(task) : `Done ${task.id}: ${task.title}\n  ${task.file}`);
  return EXIT.ok;
}
