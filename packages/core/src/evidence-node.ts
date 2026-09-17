/**
 * The Node half of the evidence check: reading the state a Snapshot records. Only this file runs
 * git, which is why the rule itself lives in ./evidence.ts with no Node import and can be tested,
 * and reasoned about, without a repository anywhere near it.
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandTilde } from './config.ts';
import { snapshotOfTask } from './evidence.ts';
import { parsePorcelainV2 } from './porcelain.ts';
import type { GitSnapshot, Snapshot } from './evidence.ts';
import type { Task } from './types.ts';

function run(repo: string, args: string[]): Promise<string | undefined> {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', repo, ...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string) => done(err ? undefined : stdout),
    );
  });
}

/**
 * Reads the two things about a repository that can show work: how many commits are reachable from
 * HEAD, and which paths git reports as changed or untracked. Returns undefined when the folder is
 * not a repository or git cannot be run, because a missing reading is not a reading of zero: a
 * snapshot with no git half makes the evidence check refuse to judge the repository at all,
 * rather than call an unreadable repo unchanged.
 */
export async function gitSnapshot(repo: string): Promise<GitSnapshot | undefined> {
  const dir = resolve(expandTilde(repo));
  if (!existsSync(join(dir, '.git'))) return undefined;
  const status = await run(dir, ['status', '--porcelain=v2', '--branch']);
  if (status === undefined) return undefined;
  const parsed = parsePorcelainV2(status, dir, '');
  const counted = await run(dir, ['rev-list', '--count', 'HEAD']);
  const commits = Number((counted ?? '').trim());
  return {
    commits: Number.isFinite(commits) ? commits : 0,
    dirty: parsed.dirty.map((entry) => `${entry.code} ${entry.path}`).sort(),
  };
}

/**
 * Takes the snapshot a session is judged against: the task's checklist, notes and plan as the
 * file has them right now, plus the git state of the repository the task names. Called once at
 * session start and once at session end; the difference between the two is the whole evidence.
 */
export async function takeSnapshot(task: Task): Promise<Snapshot> {
  const git = task.repo ? await gitSnapshot(task.repo) : undefined;
  return snapshotOfTask(task, git);
}
