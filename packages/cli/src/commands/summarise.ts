import {
  InsightStore,
  buildSummarisePrompt,
  fitSummaryBatch,
  mergeInsights,
  missingInsights,
  parseSummariseResult,
} from '@ledge/core';
import type { Task } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, requireTask } from '../store.ts';

/** What `summarise` did for one task. */
interface SummariseRow {
  taskId: string;
  status: 'summarised' | 'nothing' | 'failed';
  notes: number;
  plan: number;
  /** Items that did not fit this run's prompt and wait for the next one. */
  left: number;
  reason?: string;
}

/**
 * `ledge summarise [<id>] [--all] [--json]`: writes AI titles and summaries for the notes and
 * plan steps that have no current insight, one fast model call per task. With no id and no
 * --all it takes the current task for this folder.
 *
 * Only `insights/<id>.json` is written. The task file is read and never touched, which is the
 * contract's rule for old notes and plan: a title goes next to the original, and the original
 * stays exactly as the person wrote it. A task with nothing missing costs no model call, so
 * running it twice is cheap, and a task whose call fails is reported and left for next time
 * while the others carry on. Exits 0 unless the arguments are wrong or the task is not found.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  let tasks: Task[];
  if (ctx.args[0]) tasks = [requireTask(store, ctx.args[0])];
  else if (ctx.flags.all) tasks = store.list();
  else {
    const current = store.currentFor(ctx.cwd);
    if (!current) {
      throw new UsageError(
        'summarise needs a task id, --all, or a current task for this folder',
        'summarise',
      );
    }
    tasks = [current];
  }

  const insights = new InsightStore(store.home);
  const rows: SummariseRow[] = [];
  let checked = false;
  for (const task of tasks) {
    const previous = insights.get(task.id);
    const missing = missingInsights(task, previous);
    if (missing.length === 0) {
      rows.push({ taskId: task.id, status: 'nothing', notes: 0, plan: 0, left: 0 });
      continue;
    }
    const { batch, rest } = fitSummaryBatch(missing);
    const row: SummariseRow = { taskId: task.id, status: 'failed', notes: 0, plan: 0, left: rest.length };
    try {
      if (!checked && !(await ctx.fastProvider.available())) {
        row.reason = ctx.fastProvider.unavailableReason?.() ?? 'the provider is not available';
        rows.push(row);
        continue;
      }
      checked = true;
      const answer = await ctx.fastProvider.ask(buildSummarisePrompt(task, batch));
      const parsed = parseSummariseResult(answer.text, batch);
      if (parsed.error !== undefined) {
        row.reason = `answer refused: ${parsed.error}`;
      } else {
        insights.put(
          mergeInsights(
            previous,
            task,
            {
              notes: parsed.notes,
              plan: parsed.plan,
              model: ctx.fastProvider.model ?? ctx.fastProvider.name,
            },
            new Date(),
          ),
        );
        row.status = 'summarised';
        row.notes = Object.keys(parsed.notes).length;
        row.plan = Object.keys(parsed.plan).length;
      }
    } catch (error) {
      row.reason = `model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    rows.push(row);
  }

  if (ctx.flags.json) {
    ctx.out(toJson(rows));
    return EXIT.ok;
  }
  for (const row of rows) {
    if (row.status === 'nothing') ctx.out(`${row.taskId}: nothing to summarise`);
    else if (row.status === 'failed') ctx.out(`${row.taskId}: not summarised, ${row.reason}`);
    else {
      const left = row.left > 0 ? `, ${row.left} left for the next run` : '';
      ctx.out(`${row.taskId}: titled ${row.notes} notes and ${row.plan} plan steps${left}`);
    }
  }
  if (rows.length === 0) ctx.out('No tasks to summarise.');
  return EXIT.ok;
}
