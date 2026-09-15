import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge open <id>`: prints the absolute path of the task file, so the plugin can hand Claude
 * the file to edit. Prints nothing else, to keep it safe for command substitution.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const id = ctx.args[0];
  if (!id) throw new UsageError('open needs a task id', 'open');
  const task = requireTask(openStore(), id);
  ctx.out(task.file);
  return EXIT.ok;
}
