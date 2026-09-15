import { isoDay } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, NotFoundError, UsageError } from '../context.ts';
import { renderContext, renderTaskMarkdown, toJson } from '../format.ts';
import { openStore, resolveRepo } from '../store.ts';

/**
 * `ledge current [--repo path] [--json|--context]`: prints the current task whose repo contains
 * the given folder (default: the working directory). --json prints the task object, --context
 * prints the block the SessionStart hook injects (title, planned day, requirement, plan,
 * unchecked items and the latest note), capped at 40 lines. Exit 2 when nothing matches so hook
 * scripts can branch on it.
 */
export async function run(ctx: CommandContext): Promise<number> {
  if (ctx.flags.json && ctx.flags.context) {
    throw new UsageError('--json and --context are exclusive', 'current');
  }
  const repo = ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : ctx.cwd;
  const store = openStore();
  const task = store.currentFor(repo);
  if (!task) throw new NotFoundError(`No current task for ${repo}`);
  if (ctx.flags.json) ctx.out(toJson(task));
  else if (ctx.flags.context) ctx.out(renderContext(task, isoDay()));
  else ctx.out(renderTaskMarkdown(task));
  return EXIT.ok;
}
