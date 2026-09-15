import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge delete <id> --yes`: destroys a task and its file. This is the only command that
 * loses data, so it refuses to run without `--yes` and says what it was about to delete.
 * Use `done` instead when the work actually finished, since that keeps the file in the
 * archive folder and leaves the notes readable.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const id = ctx.args[0];
  if (!id) throw new UsageError('delete needs a task id', 'delete');
  const store = openStore();
  const task = requireTask(store, id);

  if (!ctx.flags.yes) {
    ctx.out(
      [
        `This would permanently delete "${task.title}" and its file:`,
        `  ${task.file}`,
        '',
        'There is no undo. Re-run with --yes to go ahead,',
        `or use "ledge done ${task.id}" to finish it and keep the file in the archive.`,
      ].join('\n'),
    );
    return EXIT.usage;
  }

  const removed = store.remove(id);
  ctx.out(
    ctx.flags.json
      ? toJson(removed)
      : `Deleted ${removed.id}: ${removed.title}\n  ${removed.file} is gone`,
  );
  return EXIT.ok;
}
