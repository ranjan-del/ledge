/**
 * Git scan for the Pending tab: discover repositories under the configured roots, run
 * `git status --porcelain=v2 --branch` with a small concurrency pool, and parse each result
 * with @ledge/core so the CLI and the app agree on what "pending" means.
 */
import { parsePorcelainV2, type Config, type RepoStatus } from '@ledge/core/pure';
import { gitStatus, listDir, mtimeIso, pathExists } from './io.ts';
import { expandTilde, join } from './paths.ts';

export const GIT_CONCURRENCY = 4;

/**
 * Walks each root to `maxDepth` looking for folders that contain `.git`, skipping ignored
 * names and hidden folders. A folder that is itself a repo is not descended into.
 */
export async function discoverRepos(config: Config, home: string): Promise<string[]> {
  const found = new Set<string>();
  const ignore = new Set(config.scan.ignore);

  async function walk(dir: string, depth: number): Promise<void> {
    if (await pathExists(join(dir, '.git'))) {
      found.add(dir);
      return;
    }
    if (depth >= config.scan.maxDepth) return;
    const entries = await listDir(dir);
    const children = entries
      .filter((e) => e.isDirectory && !e.name.startsWith('.') && !ignore.has(e.name))
      .map((e) => join(dir, e.name));
    await Promise.all(children.map((c) => walk(c, depth + 1)));
  }

  for (const root of config.roots) {
    await walk(expandTilde(root, home), 0);
  }
  return [...found].sort();
}

/** Runs `fn` over `items` with at most `limit` in flight. Order of results is preserved. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface ScanOptions {
  /** Repos referenced by tasks; these are scanned even when stale. */
  referenced?: string[];
  now?: Date;
}

/**
 * Scans the given repos and returns a status per repo that could be read. Repos whose
 * `.git/index` is older than `config.scan.staleDays` are skipped unless referenced by a
 * task. Git failures (not a repo, no commits, git missing) drop the repo quietly.
 */
export async function scanRepoList(
  repos: string[],
  config: Config,
  opts: ScanOptions = {},
): Promise<RepoStatus[]> {
  const referenced = new Set(opts.referenced ?? []);
  const now = (opts.now ?? new Date()).getTime();
  const staleMs = config.scan.staleDays * 24 * 60 * 60 * 1000;

  const results = await pool(repos, GIT_CONCURRENCY, async (repo): Promise<RepoStatus | null> => {
    const lastActivity = (await mtimeIso(join(repo, '.git', 'index'))) ?? new Date(now).toISOString();
    const age = now - Date.parse(lastActivity);
    if (age > staleMs && !referenced.has(repo)) return null;
    try {
      const out = await gitStatus(repo);
      if (out.code !== 0) return null;
      return parsePorcelainV2(out.stdout, repo, lastActivity);
    } catch {
      return null;
    }
  });
  return results.filter((r): r is RepoStatus => r !== null);
}
