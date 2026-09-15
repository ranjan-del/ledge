/**
 * Reading of `git status --porcelain=v2 --branch` output, and the rule that decides what counts
 * as pending work. Pure string handling with no Node imports, so the desktop app can run git
 * through the Tauri shell plugin and still agree with the CLI about what it sees.
 */
import type { RepoStatus } from './types.ts';

const MAIN_BRANCHES = new Set(['main', 'master']);
const DETACHED = '(detached)';

/**
 * Parses the output of `git status --porcelain=v2 --branch` into a RepoStatus. That one command
 * yields branch, upstream, ahead/behind and every changed path, so the scanner never needs a
 * second git call per repo. Ignored files (`!`) are dropped; untracked files carry code `??`.
 */
export function parsePorcelainV2(output: string, repo: string, lastActivity: string): RepoStatus {
  const status: RepoStatus = {
    repo,
    branch: '',
    ahead: 0,
    behind: 0,
    dirty: [],
    lastActivity,
  };
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '') continue;
    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.head') status.branch = value;
      else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          status.ahead = Number(m[1]);
          status.behind = Number(m[2]);
        }
      }
      continue;
    }
    const entry = parseEntry(line);
    if (entry) status.dirty.push(entry);
  }
  return status;
}

function parseEntry(line: string): { path: string; code: string } | undefined {
  const kind = line[0];
  const tokens = line.split(' ');
  switch (kind) {
    case '1':
      return { code: tokens[1]!, path: unquote(tokens.slice(8).join(' ')) };
    case '2':
      return { code: tokens[1]!, path: unquote(tokens.slice(9).join(' ').split('\t')[0]!) };
    case 'u':
      return { code: tokens[1]!, path: unquote(tokens.slice(10).join(' ')) };
    case '?':
      return { code: '??', path: unquote(line.slice(2)) };
    default:
      return undefined;
  }
}

function unquote(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\(["\\tn])/g, (_, c: string) => {
      if (c === 't') return '\t';
      if (c === 'n') return '\n';
      return c;
    });
  }
  return p;
}

/**
 * Decides whether a repo belongs in the Pending tab: it has uncommitted changes, unpushed
 * commits, or sits on a non-main branch that has no upstream at all (work that exists only on
 * this machine). Being behind the remote is not pending; a detached HEAD only counts when dirty
 * or ahead, since there is no branch to push.
 */
export function isPending(status: RepoStatus): boolean {
  if (status.dirty.length > 0) return true;
  if (status.ahead > 0) return true;
  if (status.upstream === undefined) {
    const branch = status.branch;
    return branch !== '' && branch !== DETACHED && !MAIN_BRANCHES.has(branch);
  }
  return false;
}
