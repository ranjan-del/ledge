import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge ref <id> "text"`: adds raw material under the task's `## References`, below whatever is
 * already there. References is what somebody handed you rather than what you decided: a message,
 * a link, an error, a snippet. It appends rather than replaces because the common act is having
 * one more thing to look at, and replacing would mean re-pasting the first one to keep it.
 *
 * Whatever the text is, the file gives it back unchanged: a heading, a fence or a line of
 * dashes in a paste is text and stays text, because the serializer escapes the few lines the
 * reader would otherwise act on. So there is nothing here to warn about and no shape of paste
 * this command will refuse.
 *
 * References is deliberately kept out of `ledge current --context`: that block has forty lines
 * for the requirement and the open items, and a long paste would push both out of the session.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, text] = ctx.args;
  if (!id) throw new UsageError('ref needs a task id', 'ref');
  if (!text?.trim()) throw new UsageError('ref needs the text to add', 'ref');
  const store = openStore();
  requireTask(store, id);
  const task = store.addReference(id, text);
  if (ctx.flags.json) ctx.out(toJson(task));
  else {
    const lines = task.references.split('\n').length;
    ctx.out(`Added a reference to ${task.id} (${lines} lines in References now)`);
  }
  return EXIT.ok;
}

