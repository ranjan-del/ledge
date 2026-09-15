import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { renderDesk, toJson } from '../format.ts';
import { collectPending } from '../pending.ts';
import { openStore } from '../store.ts';

/**
 * Bare `ledge` and `ledge list`: prints the Current, Backlog and Pending sections. Pending comes
 * from the git scan filtered by isPending, with the referencing task's title when one matches.
 * With --json prints `{ current, backlog, pending }`.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const current = store.list('current');
  const backlog = store.list('backlog');
  const pending = await collectPending(store, [...current, ...backlog]);
  const desk = { current, backlog, pending };
  ctx.out(ctx.flags.json ? toJson(desk) : renderDesk(desk));
  return EXIT.ok;
}
