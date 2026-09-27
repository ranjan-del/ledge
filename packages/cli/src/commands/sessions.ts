import { SessionStore, sessionsFor } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { renderSessions, toJson } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge sessions [--task <id>] [--json]`: the Claude Code sessions Ledge knows about, newest
 * first.
 *
 * With --json it prints the SessionRecords from `$LEDGE_HOME/sessions/`, the shape of the AI
 * assistant contract, newest `lastActivity` first: start, last activity, whether it ended, the
 * AI title and summary, files, commits and ticks. A session linked to a task before capture
 * existed has no record and is not in this list.
 *
 * As text it prints one row per record, with its title, whether it is running and how long it
 * ran, and then the session ids that tasks record but no record describes, in the older form:
 * the id, `latest` on the newest id of its task, the task title, its repo and the task's
 * `updated` time. With --task both are limited to that task. Archived tasks are not walked.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const records = new SessionStore(store.home).list(ctx.flags.task);
  if (ctx.flags.json) {
    ctx.out(toJson(records));
    return EXIT.ok;
  }
  const known = new Set(records.map((record) => record.id));
  const refs = sessionsFor(store.list()).filter(
    (ref) => !known.has(ref.id) && (ctx.flags.task === undefined || ref.taskId === ctx.flags.task),
  );
  ctx.out(renderSessions(refs, records, new Date()));
  return EXIT.ok;
}
