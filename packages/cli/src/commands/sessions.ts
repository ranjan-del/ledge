import { sessionsFor } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { renderSessions, toJson } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge sessions`: every Claude Code session id recorded across the tasks, newest first, with
 * the task it belongs to. A session id on its own is not enough to act on, and until now the
 * only way to see one was to open a task file.
 *
 * It reports only what the files record. The task files hold no start time, no end time and no
 * transcript, so this does not say whether a session is still running or what it did; the
 * timestamp is the task's `updated`. Archived tasks are not walked, matching every other listing
 * command. With --json it prints the SessionRef array as core returns it.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const sessions = sessionsFor(store.list());
  ctx.out(ctx.flags.json ? toJson(sessions) : renderSessions(sessions));
  return EXIT.ok;
}
