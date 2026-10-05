import { similarTitle } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, resolveRepo } from '../store.ts';

/**
 * `ledge add "title" [--repo path] [--backlog] [--force]`: creates a task file. Tasks land in
 * Current unless --backlog is given. The repo path is resolved against the working directory.
 *
 * A title that reads like a task already open is refused, naming that task, because the usual
 * cause is a session making a new task for a step of work that already has one. `--force`
 * creates it anyway, for the rare second task that really is a different goal.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const title = ctx.args[0]?.trim();
  if (!title) throw new UsageError('add needs a title', 'add');
  const store = openStore();
  if (!ctx.flags.force) {
    const open = store.list().filter((t) => t.status !== 'done');
    const same = open[similarTitle(open.map((t) => t.title), title)];
    if (same) {
      ctx.out(
        [
          `An open task already reads like this one: ${same.id}  "${same.title}"`,
          `Add this work to it instead: ledge todo ${same.id} "[${title}] item"`,
          'If it really is a different goal, re-run with --force.',
        ].join('\n'),
      );
      return EXIT.usage;
    }
  }
  const task = store.add({
    title,
    repo: ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : undefined,
    status: ctx.flags.backlog ? 'backlog' : 'current',
  });
  ctx.out(ctx.flags.json ? toJson(task) : `Added ${task.status} task ${task.id}\n  ${task.file}`);
  return EXIT.ok;
}
