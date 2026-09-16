import { memoryFor, searchMemory } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { renderMemory, toJson } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge memory [query]`: the dated notes of every task in one list, newest day first. The notes
 * are where a session's reasoning is written down, and no single task file can show what was
 * learned across them.
 *
 * With a query, the list is filtered to entries matching every whitespace-separated term in the
 * note body or the task title, ignoring case. Several arguments are joined with spaces, so
 * `ledge memory service worker` and `ledge memory "service worker"` ask the same thing. There is
 * no ranking: matching entries come back in the same order they would have been listed in, so
 * the filtered list is the full list with rows removed. Archived tasks are not walked, matching
 * every other listing command. With --json it prints the MemoryEntry array as core returns it.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const query = ctx.args.join(' ').trim();
  const all = memoryFor(store.list());
  const entries = query === '' ? all : searchMemory(all, query);
  ctx.out(ctx.flags.json ? toJson(entries) : renderMemory(entries));
  return EXIT.ok;
}
