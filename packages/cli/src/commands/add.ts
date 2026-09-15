import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, resolveRepo } from '../store.ts';

/**
 * `ledge add "title" [--repo path] [--backlog]`: creates a task file. Tasks land in Current
 * unless --backlog is given. The repo path is resolved against the working directory.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const title = ctx.args[0]?.trim();
  if (!title) throw new UsageError('add needs a title', 'add');
  const store = openStore();
  const task = store.add({
    title,
    repo: ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : undefined,
    status: ctx.flags.backlog ? 'backlog' : 'current',
  });
  ctx.out(ctx.flags.json ? toJson(task) : `Added ${task.status} task ${task.id}\n  ${task.file}`);
  return EXIT.ok;
}
