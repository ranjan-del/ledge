import {
  activeTask,
  collectActivity,
  explainActivity,
  formatAge,
  formatIso,
  rankWithEvidence,
} from '@ledge/core';
import type { ActivityRank, Task, TaskActivity } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import type { ActiveRow, ActiveSignalRow, ActiveView } from '../format.ts';
import { activeJson, renderActive, toJson } from '../format.ts';
import { openStore } from '../store.ts';

/** How old each signal is at `now`, and whether the ranking counted it. */
function signalRows(rank: ActivityRank, now: Date): ActiveSignalRow[] {
  return rank.signals.map((signal) => {
    const at = Date.parse(signal.at);
    const age = Number.isFinite(at) ? Math.max(0, now.getTime() - at) : 0;
    return { signal, counted: rank.live.includes(signal), age: formatAge(age) };
  });
}

/** Repositories named by more than one of the ranked tasks, which is where a signal goes blind. */
function sharedRepos(tasks: Task[]): { repo: string; taskIds: string[] }[] {
  const byRepo = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.repo) continue;
    const ids = byRepo.get(task.repo);
    if (ids) ids.push(task.id);
    else byRepo.set(task.repo, [task.id]);
  }
  return [...byRepo]
    .filter(([, ids]) => ids.length > 1)
    .map(([repo, taskIds]) => ({ repo, taskIds }));
}

/**
 * `ledge active [--json]`: the current tasks ordered by what has actually been observed
 * happening to them, each with the evidence that put it there, plus which one looks active right
 * now. It exists so the ranking is inspectable from a terminal without the panel, and so a
 * person who disagrees with the order can see the reading that produced it rather than having to
 * trust it.
 *
 * Signals come from three places: the Claude Code session transcript folder for a task's
 * repository, the newest tracked file in that repository, and the task file's own time, which is
 * the only signal a task without a repository has. Reading is read-only; nothing is written and
 * no status is changed, which is the whole contract of this command.
 *
 * Only `current` tasks are ranked. The backlog is a decision the person made, and reordering it
 * by warmth would quietly re-prioritise work they parked on purpose; promoting a backlog task on
 * evidence is what `began` and `settle` already do, deliberately and one task at a time.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const tasks = store.list('current');
  const activity: TaskActivity[] = await collectActivity(tasks);
  const now = new Date();
  const ranks = rankWithEvidence(tasks, activity);
  const byId = new Map(activity.map((entry) => [entry.taskId, entry]));

  const rows: ActiveRow[] = ranks.map((rank, index) => ({
    rank: index + 1,
    task: rank.task,
    score: rank.score,
    reason: explainActivity(byId.get(rank.task.id), now),
    signals: signalRows(rank, now),
  }));
  const view: ActiveView = {
    now: formatIso(now),
    rows,
    sharedRepos: sharedRepos(tasks),
  };
  const reference = ranks[0]?.reference;
  if (reference !== undefined) view.reference = reference;
  const active = activeTask(tasks, activity, now);
  if (active) view.active = active;

  ctx.out(ctx.flags.json ? toJson(activeJson(view)) : renderActive(view));
  return EXIT.ok;
}
