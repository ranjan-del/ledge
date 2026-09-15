import { isoDay } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge note <id> "text"`: appends text to today's note subsection, creating it when absent.
 * Notes carry the reasoning, the decisions and the dead ends that the checklist cannot, which is
 * what the next session needs and what a list of ticked boxes never explains.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, text] = ctx.args;
  if (!id) throw new UsageError('note needs a task id', 'note');
  if (!text?.trim()) throw new UsageError('note needs the note text', 'note');
  const store = openStore();
  requireTask(store, id);
  const day = isoDay();
  const task = store.addNote(id, text.trim(), day);
  ctx.out(ctx.flags.json ? toJson(task) : `Added a note to ${task.id} under ${day}`);
  return EXIT.ok;
}
