import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** `ledge link <id> <sessionId>`: appends a Claude Code session id to the task if absent. */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, sessionId] = ctx.args;
  if (!id) throw new UsageError('link needs a task id', 'link');
  if (!sessionId) throw new UsageError('link needs a session id', 'link');
  const store = openStore();
  requireTask(store, id);
  const task = store.link(id, sessionId);
  ctx.out(ctx.flags.json ? toJson(task) : `Linked ${sessionId} to ${task.id}`);
  return EXIT.ok;
}
