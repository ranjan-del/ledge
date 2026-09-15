import { resolve, sep } from 'node:path';
import { isPending, loadConfig, scanRepos } from '@ledge/core';
import type { Task, TaskStore } from '@ledge/core';
import type { PendingRow } from './format.ts';

/**
 * Finds the task that references a repo folder: the folder equals the task repo or sits inside
 * it, and the deepest task repo wins. Used to label Pending rows with a task title.
 */
export function taskForRepo(tasks: Task[], repo: string): Task | undefined {
  const target = resolve(repo);
  let best: Task | undefined;
  for (const task of tasks) {
    if (!task.repo) continue;
    const taskRepo = resolve(task.repo);
    if (target !== taskRepo && !target.startsWith(taskRepo + sep)) continue;
    if (!best || taskRepo.length > resolve(best.repo as string).length) best = task;
  }
  return best;
}

/**
 * Runs the git scan once and returns only the repos with pending work, each labelled with the
 * current or backlog task that references it. Repos referenced by tasks are passed to the scan
 * so stale ones are still included.
 */
export async function collectPending(store: TaskStore, tasks: Task[]): Promise<PendingRow[]> {
  const config = loadConfig(store.home);
  const referenced = tasks.map((t) => t.repo).filter((r): r is string => Boolean(r));
  const statuses = await scanRepos(config, { referenced });
  return statuses.filter(isPending).map((status) => {
    const task = taskForRepo(tasks, status.repo);
    return task ? { ...status, task: { id: task.id, title: task.title } } : { ...status };
  });
}
