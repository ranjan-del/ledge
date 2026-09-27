import { InsightStore, SessionStore, buildBrief } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge brief <id> [--json]`: prints the resume briefing for a task, the prompt the panel hands
 * a new Claude Code session when there is no recent session to resume. Title, where it stands,
 * the current phase, the requirement, the open items, the last session and the last note, capped
 * at forty lines. Built from the task file and the sidecars only; no model is asked.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id] = ctx.args;
  if (!id) throw new UsageError('brief needs a task id', 'brief');
  const store = openStore();
  const task = requireTask(store, id);
  const insights = new InsightStore(store.home).get(task.id);
  const sessions = new SessionStore(store.home).list(task.id);
  const text = buildBrief(task, { insights, sessions });
  ctx.out(ctx.flags.json ? toJson({ taskId: task.id, brief: text }) : text);
  return EXIT.ok;
}
