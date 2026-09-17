import { recordIntent, takeSnapshot, updateIntent, intentFor } from '@ledge/core';
import type { IntentRecord, Task } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, NotFoundError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask, resolveRepo } from '../store.ts';

/**
 * The one line injected into a session that was launched for a backlog task. It is a nudge and
 * not the mechanism: if the assistant ignores it, `ledge settle` still promotes the task at the
 * end of the session when the evidence says work happened.
 */
function nudgeFor(task: Task): string {
  return (
    `Ledge: this task is in the backlog (id: ${task.id}). Run \`ledge start ${task.id}\` ` +
    'as soon as you make a real change to it, so the desk shows what is being worked on.'
  );
}

/** Records the intent for a named task, with the snapshot the session will be judged against. */
async function recordFor(ctx: CommandContext, id: string): Promise<number> {
  const store = openStore();
  const task = requireTask(store, id);
  const repo = ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : task.repo ?? ctx.cwd;
  if (task.status !== 'backlog') {
    const text = `${task.id} is already ${task.status}; there is nothing to promote.`;
    const json = { taskId: task.id, recorded: false, status: task.status };
    ctx.out(ctx.flags.json ? toJson(json) : text);
    return EXIT.ok;
  }
  const before = await takeSnapshot({ ...task, repo });
  const input: { taskId: string; repo: string; before: typeof before; sessionId?: string } = {
    taskId: task.id,
    repo,
    before,
  };
  if (ctx.flags.session) input.sessionId = ctx.flags.session;
  const record = recordIntent(input, { home: store.home });
  const text =
    `Recorded that work on ${task.id} began. It stays in the backlog until the work shows: ` +
    'run `ledge settle` at the end of the session, or let the Stop hook do it.';
  ctx.out(ctx.flags.json ? toJson(record) : text);
  return EXIT.ok;
}

/**
 * Arms the live record for this folder: attaches the session id, takes the before snapshot once
 * per session, and prints the nudge. Exits 2 with nothing printed when no record matches, which
 * is the normal case for a session nobody launched from Ledge.
 */
async function armFor(ctx: CommandContext, repo: string): Promise<number> {
  const store = openStore();
  const record = intentFor(repo, { home: store.home });
  if (!record) throw new NotFoundError(`No live Ledge intent record for ${repo}`);
  let task: Task;
  try {
    task = store.get(record.taskId);
  } catch {
    throw new NotFoundError(`The intent record names a task that is gone: ${record.taskId}`);
  }
  if (task.status !== 'backlog') {
    throw new NotFoundError(`${task.id} is already ${task.status}; there is nothing to promote.`);
  }
  const session = ctx.flags.session;
  // The before snapshot is taken once per session. Retaking it when SessionStart fires again for
  // the same session, on a resume or a clear, would erase the evidence already earned.
  const newSession = session !== undefined && session !== record.sessionId;
  const fresh = record.before === undefined || newSession;
  let current: IntentRecord = record;
  if (fresh) {
    const before = await takeSnapshot(task);
    const patch: { before: typeof before; sessionId?: string } = { before };
    if (session !== undefined) patch.sessionId = session;
    current = updateIntent(task.id, patch, { home: store.home }) ?? record;
  }
  const nudge = nudgeFor(task);
  ctx.out(ctx.flags.json ? toJson({ ...current, nudge }) : nudge);
  return EXIT.ok;
}

/**
 * `ledge began [id] [--repo path] [--session id]`: records that a session was launched for a
 * task, because a session knows only its folder and several tasks can share a repository.
 *
 * With an id, it writes the intent record and the snapshot the session will be judged against;
 * this is what the desktop calls before it opens Claude on a backlog row. Without an id, it finds
 * the live record for the folder, attaches the session id, and prints the one line the
 * SessionStart hook injects. It never moves a task: only evidence of work does that.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const id = ctx.args[0];
  if (id) return recordFor(ctx, id);
  const repo = ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : ctx.cwd;
  return armFor(ctx, repo);
}
