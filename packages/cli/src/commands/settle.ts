import { clearIntent, evidenceOfWork, intentFor, takeSnapshot } from '@ledge/core';
import type { Task } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore, resolveRepo } from '../store.ts';

/** What settle decided. The Stop hook reads this field and stays silent unless it is promoted. */
type Decision = 'none' | 'gone' | 'settled' | 'kept' | 'promoted';

interface Outcome {
  decision: Decision;
  taskId?: string;
  worked?: boolean;
  reasons?: string[];
  message: string;
}

function report(ctx: CommandContext, outcome: Outcome): number {
  ctx.out(ctx.flags.json ? toJson(outcome) : outcome.message);
  return EXIT.ok;
}

/**
 * `ledge settle [--repo path] [--json]`: closes the loop opened by `ledge began`. It finds the
 * live intent record for the folder, compares the snapshot taken before the session with the one
 * it takes now, and promotes the task out of the backlog only when that comparison shows work.
 *
 * It prints what it decided and why, because a promotion nobody can audit is one nobody can
 * trust. It is safe to run repeatedly: a record is cleared the moment it has done its job, so a
 * second run finds nothing and says so. With no record it does nothing at all, which is the
 * answer for every session that was not launched from Ledge.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = openStore();
  const repo = ctx.flags.repo ? resolveRepo(ctx.flags.repo, ctx.cwd) : ctx.cwd;
  const record = intentFor(repo, { home: store.home });
  if (!record) {
    return report(ctx, {
      decision: 'none',
      message: `Nothing to settle: no live Ledge intent record for ${repo}.`,
    });
  }

  let task: Task;
  try {
    task = store.get(record.taskId);
  } catch {
    clearIntent(record.taskId, { home: store.home });
    return report(ctx, {
      decision: 'gone',
      taskId: record.taskId,
      message: `Cleared the intent record for ${record.taskId}: that task no longer exists.`,
    });
  }

  if (task.status !== 'backlog') {
    clearIntent(task.id, { home: store.home });
    return report(ctx, {
      decision: 'settled',
      taskId: task.id,
      message: `${task.id} is already ${task.status}; cleared the intent record.`,
    });
  }

  if (!record.before) {
    // Without a before snapshot there is nothing to compare, and guessing would be exactly the
    // false promotion this whole mechanism exists to avoid.
    return report(ctx, {
      decision: 'kept',
      taskId: task.id,
      worked: false,
      reasons: ['no snapshot was taken before the session, so nothing could be compared'],
      message: `Left ${task.id} in the backlog: nothing was recorded before the session.`,
    });
  }

  const after = await takeSnapshot(task);
  const evidence = evidenceOfWork(record.before, after);
  const why = evidence.reasons.join('; ');
  if (!evidence.worked) {
    return report(ctx, {
      decision: 'kept',
      taskId: task.id,
      worked: false,
      reasons: evidence.reasons,
      message: `Left ${task.id} in the backlog: ${why}.`,
    });
  }

  store.start(task.id);
  if (record.sessionId) store.link(task.id, record.sessionId);
  clearIntent(task.id, { home: store.home });
  return report(ctx, {
    decision: 'promoted',
    taskId: task.id,
    worked: true,
    reasons: evidence.reasons,
    message: `Ledge moved ${task.id} from the backlog to your current tasks, because ${why}.`,
  });
}
