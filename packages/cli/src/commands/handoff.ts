import { buildHandoffPrompt, isoDay, observedFacts, sanitizeForNote } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { ask as askProvider, gatherContext } from '../assist.ts';
import { renderAssist, toJson } from '../format.ts';
import type { AssistView } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * How many dated notes of the task are quoted to the model. Higher than the default, because a
 * handoff is the one job where the older reasoning is the point: the decision that must not be
 * revisited is usually two notes back, not in today's.
 */
const HANDOFF_NOTES = 6;

/**
 * `ledge handoff <id> [--save]`: writes the handoff for one task, for the session that picks it
 * up next and will know nothing except the file. Four blocks: what happened, what is done, what
 * remains, and what the next session needs, the last of which carries the paths, branches and
 * the decisions the records say are already settled.
 *
 * Only the named task is quoted to the model, and only its own repository is read. A handoff
 * about one task that was shown four is a handoff that blends them, and a dirty repo belonging
 * to some other piece of work is noise in a note meant to be read weeks later.
 *
 * With --save the answer is appended to that task's notes under today's date, through the same
 * store method `ledge note` uses, so it lands in the file the plugin and the panel already read.
 * It is saved with a line saying which provider wrote it: an unlabelled handoff read back in a
 * week is indistinguishable from something the person wrote by hand, and that is the one
 * confusion this feature must never cause. Markdown headings are stripped on the way in, since a
 * line beginning `##` would be read back as a new section and split the file.
 *
 * With no provider available nothing is saved, the reason is printed in place of the handoff,
 * the observed facts are printed as usual and the exit code is still 0.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id] = ctx.args;
  if (!id) throw new UsageError('handoff needs a task id', 'handoff');
  const store = openStore();
  const day = isoDay();
  const task = requireTask(store, id);
  const context = await gatherContext(store, [task], day, {
    notesPerTask: HANDOFF_NOTES,
    repoScope: 'named',
  });
  const view: AssistView = {
    kind: 'handoff',
    day,
    task: { id: task.id, title: task.title },
    observed: observedFacts(context),
  };
  const result = await askProvider(ctx.provider, buildHandoffPrompt(task, context));
  if (result.answer) {
    view.inference = result.answer;
    if (ctx.flags.save) {
      const header = `Session handoff, written by ${result.answer.provider} from this file.`;
      const body = `${header}\n\n${sanitizeForNote(result.answer.text)}`;
      view.saved = store.addNote(task.id, body, day).file;
    }
  } else {
    view.noInference = ctx.flags.save
      ? `${result.noInference} Nothing was saved to the task file.`
      : result.noInference;
  }
  ctx.out(ctx.flags.json ? toJson(view) : renderAssist(view));
  return EXIT.ok;
}
