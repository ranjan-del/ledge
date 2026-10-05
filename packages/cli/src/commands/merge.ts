import { InsightStore, SessionStore } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge merge <into> <from> [<from>...] --yes`: folds tasks that are really parts of one piece
 * of work into the task that owns it. Each child's checklist moves into the parent marked with
 * the child's title, its notes keep their days, the rest goes under References, its sessions
 * are attributed to the parent and its file is deleted. Without `--yes` it only says what it
 * would do, the way `delete` does, because the child files do not come back.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [intoId, ...fromIds] = ctx.args;
  if (!intoId || fromIds.length === 0) {
    throw new UsageError('merge needs the task to keep and at least one task to fold into it', 'merge');
  }
  const store = openStore();
  const into = requireTask(store, intoId);
  const from = fromIds.map((id) => requireTask(store, id));
  if (from.some((task) => task.id === into.id)) throw new UsageError('a task cannot be merged into itself', 'merge');

  if (!ctx.flags.yes) {
    ctx.out(
      [
        `This would fold ${from.length} task${from.length === 1 ? '' : 's'} into "${into.title}" (${into.id}):`,
        ...from.map((task) => `  ${task.id}  ${task.title}  (${task.checklist.length} items, ${task.notes.length} notes)`),
        '',
        'Their checklists move in marked with their titles and their files are deleted.',
        'Re-run with --yes to go ahead.',
      ].join('\n'),
    );
    return EXIT.usage;
  }

  const { task, merged } = store.merge(into.id, from.map((t) => t.id));
  const ids = merged.map((t) => t.id);
  const sessions = new SessionStore(store.home).reassign(ids, task.id);
  const insights = new InsightStore(store.home);
  for (const id of ids) insights.remove(id);
  if (ctx.flags.json) {
    ctx.out(toJson({ task, merged: ids, sessionsReassigned: sessions }));
  } else {
    ctx.out(
      [
        `Merged ${ids.length} task${ids.length === 1 ? '' : 's'} into ${task.id}: ${task.title}`,
        ...ids.map((id) => `  ${id}`),
        `  ${task.checklist.length} checklist items now, ${sessions} session record${sessions === 1 ? '' : 's'} reassigned`,
      ].join('\n'),
    );
  }
  return EXIT.ok;
}
