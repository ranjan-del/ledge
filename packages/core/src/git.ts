/**
 * Repository discovery and scanning: the Node half of Ledge's git support. The reading of git's
 * output lives in ./porcelain.ts, which has no Node imports and is re-exported here so existing
 * importers of @ledge/core keep working unchanged.
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandTilde } from './config.ts';
import { parsePorcelainV2 } from './porcelain.ts';
import type { Config, RepoStatus } from './types.ts';

export { isPending, parsePorcelainV2 } from './porcelain.ts';

const CONCURRENCY = 4;

/** The `code` a failed child process or filesystem call carries, without the NodeJS namespace. */
interface ErrnoError extends Error {
  code?: string;
}

/**
 * Walks each root to `maxDepth` looking for folders that contain `.git` (a directory or, for
 * worktrees, a file). Names in `ignore` are skipped, symlinks are never followed, and the walk
 * does not descend into a repo it found, so nested checkouts and vendored trees do not inflate
 * the scan. Missing roots are ignored. Results are absolute, de-duplicated and sorted.
 */
export function findRepos(roots: string[], maxDepth: number, ignore: string[]): string[] {
  const skip = new Set(ignore);
  const found = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (existsSync(join(dir, '.git'))) {
      found.add(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || skip.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  for (const root of roots) {
    const abs = resolve(expandTilde(root));
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) walk(abs, 0);
  }
  return [...found].sort();
}

function lastActivityOf(repo: string): Date | undefined {
  for (const candidate of [join(repo, '.git', 'index'), join(repo, '.git')]) {
    try {
      return statSync(candidate).mtime;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function runGitStatus(repo: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-C', repo, 'status', '--porcelain=v2', '--branch'],
      { maxBuffer: 16 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string) => {
        if (err) reject(err);
        else resolvePromise(stdout);
      },
    );
  });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.error(`ledge: ${message}`);
}

/**
 * Runs one git scan: discovers repos under `config.roots`, skips those whose `.git/index` is
 * older than `scan.staleDays` unless a task references them, always includes referenced repos
 * even outside the roots, and runs `git status --porcelain=v2 --branch` in each with at most
 * four git processes at a time. Repos git cannot read are skipped with a single warning per
 * process. Results are sorted by repo path.
 */
export async function scanRepos(
  config: Config,
  opts: { referenced?: string[]; now?: Date } = {},
): Promise<RepoStatus[]> {
  const now = opts.now ?? new Date();
  const referenced = new Set((opts.referenced ?? []).map((p) => resolve(expandTilde(p))));
  const staleMs = config.scan.staleDays * 24 * 60 * 60 * 1000;

  const candidates = new Set(findRepos(config.roots, config.scan.maxDepth, config.scan.ignore));
  for (const repo of referenced) {
    if (existsSync(join(repo, '.git'))) candidates.add(repo);
  }

  const jobs: { repo: string; lastActivity: string }[] = [];
  for (const repo of [...candidates].sort()) {
    const activity = lastActivityOf(repo) ?? now;
    const stale = now.getTime() - activity.getTime() > staleMs;
    if (stale && !referenced.has(repo)) continue;
    jobs.push({ repo, lastActivity: activity.toISOString() });
  }

  const results = await mapLimit(jobs, CONCURRENCY, async (job) => {
    try {
      const out = await runGitStatus(job.repo);
      return parsePorcelainV2(out, job.repo, job.lastActivity);
    } catch (err) {
      const code = (err as ErrnoError).code;
      if (code === 'ENOENT') warnOnce('git is not installed or not on PATH; skipping scan');
      else warnOnce(`skipping ${job.repo}: ${(err as Error).message.split('\n')[0]}`);
      return undefined;
    }
  });
  return results.filter((r): r is RepoStatus => r !== undefined);
}
