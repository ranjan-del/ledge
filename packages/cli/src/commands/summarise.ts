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

/** Batches one task may take in a single run, a bound in case a model keeps refusing items. */
const MAX_ROUNDS = 10;

/** Elapsed time for a progress line, e.g. `4.2s`. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

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
 * `ledge summarise [<id>] [--all] [--json] [--quiet]`: writes AI titles and summaries for the notes and
 * plan steps that have no current insight, one fast model call per task. With no id and no
 * --all it takes the current task for this folder.
 *
 * Only `insights/<id>.json` is written. The task file is read and never touched, which is the
 * contract's rule for old notes and plan: a title goes next to the original, and the original
 * stays exactly as the person wrote it. A task with nothing missing costs no model call, so
 * running it twice is cheap, and a task whose call fails is reported and left for next time
 * while the others carry on. Progress goes to stderr, one line per task and per batch, so
 * `--json` on stdout stays clean; `--quiet` turns it off. Exits 0 unless the arguments are wrong or the task is not found.
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
  const quiet = Boolean(ctx.flags.quiet);
  const total = tasks.length;
  const began = Date.now();
  let checked = false;
  for (const [index, task] of tasks.entries()) {
    const step = `[${index + 1}/${total}]`;
    const row: SummariseRow = { taskId: task.id, status: 'nothing', notes: 0, plan: 0, left: 0 };
    let missing = missingInsights(task, insights.get(task.id));
    if (missing.length === 0) {
      if (!quiet) ctx.err(`${step} ${task.title}: already titled`);
      rows.push(row);
      continue;
    }
    if (!quiet) ctx.err(`${step} ${task.title}: ${missing.length} items to title`);
    const taskBegan = Date.now();
    // One call per batch that fits the prompt, repeated until nothing is left, so one run of
    // --all finishes a long task instead of leaving part of it for the next run.
    for (let round = 1; missing.length > 0 && round <= MAX_ROUNDS; round++) {
      const { batch, rest } = fitSummaryBatch(missing);
      row.left = rest.length;
      try {
        if (!checked && !(await ctx.fastProvider.available())) {
          row.status = 'failed';
          row.reason = ctx.fastProvider.unavailableReason?.() ?? 'the provider is not available';
          break;
        }
        checked = true;
        if (!quiet && (round > 1 || rest.length > 0)) {
          ctx.err(`      batch ${round}: ${batch.length} items, ${rest.length} after this`);
        }
        const answer = await ctx.fastProvider.ask(buildSummarisePrompt(task, batch));
        const parsed = parseSummariseResult(answer.text, batch);
        if (parsed.error !== undefined) {
          row.status = 'failed';
          row.reason = `answer refused: ${parsed.error}`;
          break;
        }
        const previous = insights.get(task.id);
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
        row.notes += Object.keys(parsed.notes).length;
        row.plan += Object.keys(parsed.plan).length;
        // Only items that did not fit the prompt earn another call. Items the model skipped
        // stay for the next run, and a batch that titled nothing never loops on the same items.
        if (rest.length === 0) break;
        const next = missingInsights(task, insights.get(task.id));
        if (next.length >= missing.length) break;
        missing = next;
        row.left = missing.length;
      } catch (error) {
        row.status = 'failed';
        row.reason = `model call failed: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
    if (!quiet) {
      const took = seconds(Date.now() - taskBegan);
      if (row.status === 'failed') ctx.err(`      failed after ${took}: ${row.reason}`);
      else ctx.err(`      done in ${took}: ${row.notes} notes, ${row.plan} plan steps`);
    }
    rows.push(row);
  }
  if (!quiet && total > 0) {
    const done = rows.filter((r) => r.status === 'summarised').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    ctx.err(`Finished in ${seconds(Date.now() - began)}: ${done} titled, ${failed} failed, ${total - done - failed} already done`);
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
