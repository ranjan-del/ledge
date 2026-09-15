import type { CommandContext } from '../context.ts';
import { EXIT, NotFoundError, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * Shared body of `tick` and `untick`: validates the 1-based item number, flips the item and
 * prints the result. Exit 1 for a non-numeric n, exit 2 when the item does not exist.
 */
export async function setItem(ctx: CommandContext, done: boolean): Promise<number> {
  const name = done ? 'tick' : 'untick';
  const [id, raw] = ctx.args;
  if (!id) throw new UsageError(`${name} needs a task id`, name);
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    throw new UsageError(`${name} needs a 1-based item number`, name);
  }
  const store = openStore();
  const before = requireTask(store, id);
  if (n > before.checklist.length) {
    throw new NotFoundError(`No checklist item ${n} in ${id}`);
  }
  const task = store.setTodo(id, n - 1, done);
  const verb = done ? 'Ticked' : 'Unticked';
  const text = task.checklist[n - 1].text;
  ctx.out(ctx.flags.json ? toJson(task) : `${verb} ${task.id} item ${n}: ${text}`);
  return EXIT.ok;
}

/** `ledge tick <id> <n>`: marks checklist item n (1-based) as done. */
export async function run(ctx: CommandContext): Promise<number> {
  return setItem(ctx, true);
}
