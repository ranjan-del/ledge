import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** `ledge todo <id> "text"`: appends an unchecked checklist item to the task. */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, text] = ctx.args;
  if (!id) throw new UsageError('todo needs a task id', 'todo');
  if (!text?.trim()) throw new UsageError('todo needs the item text', 'todo');
  const store = openStore();
  requireTask(store, id);
  const task = store.addTodo(id, text.trim());
  const n = task.checklist.length;
  ctx.out(ctx.flags.json ? toJson(task) : `Added item ${n} to ${task.id}: ${text.trim()}`);
  return EXIT.ok;
}
