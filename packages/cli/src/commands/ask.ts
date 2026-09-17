import { buildAskPrompt, isoDay, observedFacts } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { ask as askProvider, gatherContext } from '../assist.ts';
import { renderAssist, toJson } from '../format.ts';
import type { AssistView } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge ask "question"`: answers a question about the person's own work from their task files,
 * their notes and the git state of the repositories those tasks name. Every other Ledge command
 * prints a field out of a file; this one is the first that reads the work and says something
 * back, which is why it is also the one that has to be most careful about saying it honestly.
 *
 * The observed facts are printed first and the answer second, under a heading naming the
 * provider, so the two can never be mistaken for each other. When no provider is available the
 * facts are printed exactly as they would have been, the reason is printed in place of the
 * answer, and the exit code is still 0: a question that cannot reach a model is not a failure of
 * the command, and the rows are worth reading on their own.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const question = ctx.args.join(' ').trim();
  if (question === '') throw new UsageError('ask needs a question', 'ask');
  const store = openStore();
  const day = isoDay();
  const tasks = store.list();
  const context = await gatherContext(store, tasks, day);
  const view: AssistView = { kind: 'ask', day, question, observed: observedFacts(context) };
  if (tasks.length === 0) {
    view.noInference = 'There are no tasks in the store, so there was nothing to ask about.';
  } else {
    const result = await askProvider(ctx.provider, buildAskPrompt(question, context));
    if (result.answer) view.inference = result.answer;
    else view.noInference = result.noInference;
  }
  ctx.out(ctx.flags.json ? toJson(view) : renderAssist(view));
  return EXIT.ok;
}
