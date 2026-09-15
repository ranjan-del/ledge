import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/**
 * `ledge plan <id> "step" "step" ...`: replaces the plan, the ordered steps written before work
 * starts. Replacing rather than appending is deliberate: a plan that changed is a new plan, and
 * the checklist is where incremental tracking belongs.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const [id, ...steps] = ctx.args;
  if (!id) throw new UsageError('plan needs a task id', 'plan');
  const wanted = steps.map((step) => step.trim()).filter((step) => step !== '');
  if (wanted.length === 0) throw new UsageError('plan needs at least one step', 'plan');
  const store = openStore();
  requireTask(store, id);
  const task = store.setPlan(id, wanted);
  if (ctx.flags.json) ctx.out(toJson(task));
  else {
    ctx.out(`Plan for ${task.id}:`);
    task.plan.forEach((step, i) => ctx.out(`  ${i + 1}. ${step}`));
  }
  return EXIT.ok;
}
