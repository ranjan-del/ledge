import { buildStandupPrompt, isoDay, observedFacts } from '@ledge/core';
import type { Task } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { ask as askProvider, gatherContext } from '../assist.ts';
import { renderAssist, toJson } from '../format.ts';
import type { AssistView } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge standup`: the morning summary. Where each current task stands, and the one action worth
 * taking next on it, with the reason it was chosen over the others.
 *
 * `ledge today` already answers what is on; this answers what happened and what to do, which no
 * field in a file holds. The observed rows still carry each task's own next step, the first
 * unticked item, so the reasoned choice printed underneath can be compared against the
 * mechanical one rather than replacing it silently.
 *
 * Current tasks come first and parked ones after, in each list's own order, so the prompt and
 * the printed rows agree on what "the order the context lists them" means. When no provider is
 * available the rows are printed unchanged with the reason in place of the summary, and the exit
 * code stays 0.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const day = isoDay();
  const all = store.list();
  const tasks: Task[] = [
    ...all.filter((task) => task.status === 'current'),
    ...all.filter((task) => task.status !== 'current'),
  ];
  const context = await gatherContext(store, tasks, day);
  const view: AssistView = { kind: 'standup', day, observed: observedFacts(context) };
  if (tasks.length === 0) {
    view.noInference = 'There are no tasks in the store, so there is nothing to summarise.';
  } else {
    const result = await askProvider(ctx.provider, buildStandupPrompt(context));
    if (result.answer) view.inference = result.answer;
    else view.noInference = result.noInference;
  }
  ctx.out(ctx.flags.json ? toJson(view) : renderAssist(view));
  return EXIT.ok;
}
