import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { toJson } from '../format.ts';
import { collectPending } from '../pending.ts';
import { openStore } from '../store.ts';

/**
 * `ledge scan`: runs the git scan once and prints Pending as JSON, as the spec requires. Each
 * entry is a RepoStatus plus `task` when a current or backlog task references the repo.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const tasks = [...store.list('current'), ...store.list('backlog')];
  ctx.out(toJson(await collectPending(store, tasks)));
  return EXIT.ok;
}
