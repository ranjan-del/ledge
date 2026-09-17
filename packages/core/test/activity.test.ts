import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_WINDOW_MS,
  ACTIVITY_HORIZON_MS,
  activeTask,
  claudeProjectDirName,
  explainActivity,
  formatAge,
  rankByActivity,
  rankWithEvidence,
} from '../src/index.ts';
import type { ActivitySignal, Task, TaskActivity } from '../src/index.ts';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'demo',
    title: 'Demo',
    status: 'current',
    order: 1,
    sessions: [],
    created: '2026-09-17T09:00:00+05:30',
    updated: '2026-09-17T09:00:00+05:30',
    requirement: '',
    plan: [],
    checklist: [],
    notes: [],
    references: '',
    extra: '',
    file: '',
    ...over,
  };
}

const NOW = new Date('2026-09-17T18:00:00+05:30');

/** An ISO timestamp `minutes` before NOW, in the same offset the task files use. */
function ago(minutes: number): string {
  const ms = NOW.getTime() - minutes * 60 * 1000;
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

function signal(
  kind: ActivitySignal['kind'],
  minutes: number,
  detail = 'evidence',
): ActivitySignal {
  return { kind, at: ago(minutes), detail };
}

function activity(taskId: string, ...signals: ActivitySignal[]): TaskActivity {
  const entry: TaskActivity = { taskId, signals };
  if (signals.length > 0) entry.lastActive = signals[0]!.at;
  return entry;
}

test('claudeProjectDirName matches what Claude Code writes on disk', () => {
  assert.equal(claudeProjectDirName('/Users/thinktac/code'), '-Users-thinktac-code');
  assert.equal(
    claudeProjectDirName('/Users/thinktac/.claude-mem/observer-sessions'),
    '-Users-thinktac--claude-mem-observer-sessions',
    'a dot becomes a hyphen, so a dotted folder yields two in a row',
  );
  assert.equal(claudeProjectDirName('/private/tmp'), '-private-tmp');
  assert.equal(
    claudeProjectDirName('/Users/me/my_repo (old)'),
    '-Users-me-my-repo--old-',
    'underscores, spaces and brackets all become hyphens too',
  );
  assert.equal(claudeProjectDirName('/Users/me/code/'), '-Users-me-code-', 'nothing is trimmed');
  assert.equal(claudeProjectDirName('relative/path'), 'relative-path', 'no leading hyphen added');
});

test('rankByActivity puts the freshest evidence first and leaves the input alone', () => {
  const tasks = [
    task({ id: 'quiet', order: 1 }),
    task({ id: 'warm', order: 2 }),
    task({ id: 'warmer', order: 3 }),
  ];
  const before = structuredClone(tasks);
  const ranked = rankByActivity(tasks, [
    activity('quiet'),
    activity('warm', signal('session', 120)),
    activity('warmer', signal('session', 3)),
  ]);
  assert.deepEqual(ranked.map((t) => t.id), ['warmer', 'warm', 'quiet']);
  assert.deepEqual(tasks, before, 'the task list handed in is not reordered or edited');
  assert.equal(ranked[0], tasks[2], 'the same task objects come back, not copies');
});

test('a task with no signal keeps its manual place among the other quiet tasks', () => {
  const tasks = [
    task({ id: 'first', order: 1 }),
    task({ id: 'active', order: 2 }),
    task({ id: 'second', order: 3 }),
  ];
  const ranked = rankByActivity(tasks, [activity('active', signal('taskfile', 2))]);
  assert.deepEqual(
    ranked.map((t) => t.id),
    ['active', 'first', 'second'],
    'the two quiet tasks keep the order the person gave them, neither sinking below the other',
  );
});

test('a signal beyond the horizon is ignored and the task keeps the manual order', () => {
  const tasks = [task({ id: 'yesterday', order: 1 }), task({ id: 'today', order: 2 })];
  const horizonMinutes = ACTIVITY_HORIZON_MS / 60000;
  const ranks = rankWithEvidence(tasks, [
    activity('yesterday', signal('session', horizonMinutes + 60)),
    activity('today', signal('taskfile', 5)),
  ]);
  assert.deepEqual(ranks.map((r) => r.task.id), ['today', 'yesterday']);
  const stale = ranks[1]!;
  assert.equal(stale.score, 0, 'nothing inside the horizon means no score at all');
  assert.equal(stale.strongest, undefined, 'and no signal is named as the reason');
  assert.deepEqual(stale.live, [], 'the stale signal is not counted as live');
  assert.equal(stale.signals.length, 1, 'but it is still reported, so a reader can see it');
});

test('ages are measured from the newest signal, so an old store still ranks and repeats', () => {
  const tasks = [task({ id: 'older', order: 1 }), task({ id: 'newer', order: 2 })];
  const week = 7 * 24 * 60;
  const activityList = [
    activity('older', signal('session', week + 120)),
    activity('newer', signal('session', week)),
  ];
  const first = rankByActivity(tasks, activityList).map((t) => t.id);
  const second = rankByActivity(tasks, activityList).map((t) => t.id);
  assert.deepEqual(first, ['newer', 'older'], 'the newest signal is the reference moment');
  assert.deepEqual(second, first, 'no clock is read, so the same input always ranks the same');
});

test('a fresh weak signal outranks a stale strong one, and kind breaks a tie', () => {
  const tasks = [task({ id: 'session-3h', order: 1 }), task({ id: 'file-now', order: 2 })];
  assert.deepEqual(
    rankByActivity(tasks, [
      activity('session-3h', signal('session', 180)),
      activity('file-now', signal('taskfile', 0)),
    ]).map((t) => t.id),
    ['file-now', 'session-3h'],
    'a task file saved now beats a session folder last written to three hours ago',
  );

  const pair = [task({ id: 'tree', order: 1 }), task({ id: 'session', order: 2 })];
  assert.deepEqual(
    rankByActivity(pair, [
      activity('tree', signal('worktree', 10)),
      activity('session', signal('session', 10)),
    ]).map((t) => t.id),
    ['session', 'tree'],
    'at the same age a running session outweighs a touched working tree',
  );
});

test('signals do not add up: the strongest single one is the score', () => {
  const tasks = [task({ id: 'three-weak', order: 1 }), task({ id: 'one-strong', order: 2 })];
  const ranks = rankWithEvidence(tasks, [
    activity(
      'three-weak',
      signal('worktree', 12),
      signal('taskfile', 12),
      signal('worktree', 13),
    ),
    activity('one-strong', signal('session', 12)),
  ]);
  assert.deepEqual(ranks.map((r) => r.task.id), ['one-strong', 'three-weak']);
  assert.equal(ranks[1]!.strongest?.kind, 'worktree', 'the best of the weak ones, not their sum');
  assert.ok(ranks[1]!.score < ranks[0]!.score);
});

test('two tasks sharing a repository tie, and the tie keeps the person s order', () => {
  const shared = signal('session', 4, 'a Claude Code session in ~/code/mono');
  const tasks = [task({ id: 'second', order: 5 }), task({ id: 'first', order: 6 })];
  const ranks = rankWithEvidence(tasks, [activity('second', shared), activity('first', shared)]);
  assert.deepEqual(ranks.map((r) => r.task.id), ['second', 'first'], 'given order decides');
  assert.equal(ranks[0]!.score, ranks[1]!.score, 'the folder signal cannot separate them');
  assert.equal(ranks[0]!.strongest?.detail, ranks[1]!.strongest?.detail, 'same evidence on both');
});

test('a signal whose timestamp cannot be read is dropped rather than guessed at', () => {
  const tasks = [task({ id: 'broken', order: 1 }), task({ id: 'fine', order: 2 })];
  const ranks = rankWithEvidence(tasks, [
    activity('broken', { kind: 'session', at: 'whenever', detail: 'nonsense' }),
    activity('fine', signal('taskfile', 30)),
  ]);
  assert.deepEqual(ranks.map((r) => r.task.id), ['fine', 'broken']);
  assert.deepEqual(ranks[1]!.signals, [], 'an unreadable timestamp is not reported as evidence');
});

test('ranking never touches status, and a done or parked task is only reordered', () => {
  const tasks = [
    task({ id: 'parked', status: 'backlog', order: 1, parked: 'waiting on review' }),
    task({ id: 'open', status: 'current', order: 2 }),
  ];
  const ranked = rankByActivity(tasks, [activity('parked', signal('session', 1))]);
  assert.deepEqual(ranked.map((t) => t.id), ['parked', 'open']);
  assert.equal(ranked[0]!.status, 'backlog', 'activity does not promote anything');
  assert.equal(ranked[0]!.parked, 'waiting on review');
});

test('activeTask names a task only on evidence inside the active window', () => {
  const tasks = [task({ id: 'cold', order: 1 }), task({ id: 'warm', order: 2 })];
  const inside = ACTIVE_WINDOW_MS / 60000 - 1;
  const outside = ACTIVE_WINDOW_MS / 60000 + 1;
  assert.equal(
    activeTask(tasks, [activity('warm', signal('session', inside))], NOW)?.id,
    'warm',
  );
  assert.equal(
    activeTask(tasks, [activity('warm', signal('session', outside))], NOW),
    undefined,
    'a session that stopped before the window opens claims nothing',
  );
  assert.equal(activeTask(tasks, [], NOW), undefined, 'no signals at all means no answer');
  assert.equal(
    activeTask(tasks, [activity('cold', signal('taskfile', 400))], NOW),
    undefined,
    'an old task file does not make a task active',
  );
});

test('activeTask prefers the strongest evidence and the earlier task on a tie', () => {
  const tasks = [task({ id: 'top', order: 1 }), task({ id: 'next', order: 2 })];
  const shared = signal('session', 2, 'a Claude Code session in ~/code/mono');
  assert.equal(
    activeTask(tasks, [activity('top', shared), activity('next', shared)], NOW)?.id,
    'top',
    'a shared folder cannot single one out, so the order the person gave wins',
  );
  assert.equal(
    activeTask(
      tasks,
      [activity('top', signal('taskfile', 2)), activity('next', signal('session', 2))],
      NOW,
    )?.id,
    'next',
    'a running session outranks a task file save of the same age',
  );
});

test('explainActivity says what was seen, in the present tense only when it is present', () => {
  const live = activity('x', signal('session', 3, 'a Claude Code session in ~/code/unlab-web'));
  assert.equal(
    explainActivity(live, NOW),
    'active now, a Claude Code session in ~/code/unlab-web',
  );
  const tree = 'the newest tracked file in ~/AI/loomrun';
  const earlier = activity('x', signal('worktree', 190, tree));
  assert.equal(
    explainActivity(earlier, NOW),
    'last seen 3h 10m ago, the newest tracked file in ~/AI/loomrun',
  );
  assert.equal(explainActivity(undefined, NOW), 'no signal in the last 12h, keeping your order');
  const stale = activity('x', signal('session', 24 * 60));
  assert.equal(explainActivity(stale, NOW), 'no signal in the last 12h, keeping your order');
});

test('formatAge rounds down and never invents precision', () => {
  assert.equal(formatAge(0), 'under a minute');
  assert.equal(formatAge(59_000), 'under a minute');
  assert.equal(formatAge(60_000), '1m');
  assert.equal(formatAge(90 * 60_000), '1h 30m');
  assert.equal(formatAge(2 * 60 * 60_000), '2h');
  assert.equal(formatAge(26 * 60 * 60_000), '1d 2h');
  assert.equal(formatAge(48 * 60 * 60_000), '2d');
  assert.equal(formatAge(-5), 'under a minute', 'a signal from the future is not negative age');
});
