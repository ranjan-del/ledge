/**
 * Which tool calls wait for the person's Approve (assistant tab contract, Approvals). Pure.
 *
 * - Never risky: reads, `ledge` commands except `ledge delete`, and read-only shell commands.
 * - Risky: deletes, access or permission grants, pushes, merges, deploys, messages or email to
 *   other people, and writes outside `~/.ledge` and the scratch folder. When unsure, risky.
 */

export interface Verdict {
  risky: boolean;
  reason?: string;
}

export interface PolicyOptions {
  /** The person's home folder, for telling `~/.ledge` paths apart. */
  home?: string;
}

const SAFE: Verdict = { risky: false };
const risky = (reason: string): Verdict => ({ risky: true, reason });

/** Tools that only read, or only organise the agent's own work. */
const READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebSearch',
  'WebFetch',
  'NotebookRead',
  'TodoWrite',
  'TodoRead',
  'Task',
  'Agent',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskOutput',
  'TaskStop',
  'ToolSearch',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  'Skill',
  'ListAgents',
  'CronList',
]);

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ paths */

/** True for a path inside `~/.ledge` or a scratch folder, where writes need no approval. */
export function isSafeWritePath(path: string, home?: string): boolean {
  const p = path.trim().replace(/^["']|["']$/g, '');
  if (p === '' || /(^|\/)\.\.(\/|$)/.test(p)) return false;
  if (p === '/dev/null' || p === '/dev/stdout' || p === '/dev/stderr') return true;
  if (/^(\/private)?\/tmp(\/|$)/.test(p) || /^\/var\/folders\//.test(p) || /^\$TMPDIR(\/|$)/.test(p)) return true;
  if (/^(~|\$HOME|\$\{HOME\})\/\.ledge(\/|$)/.test(p)) return true;
  if (home) {
    const h = home.replace(/\/+$/, '');
    if (p === `${h}/.ledge` || p.startsWith(`${h}/.ledge/`)) return true;
  } else if (/^\/(Users|home)\/[^/]+\/\.ledge(\/|$)/.test(p)) {
    return true;
  }
  // Relative paths resolve in the assistant's working folder, which is ~/.ledge.
  if (!p.startsWith('/') && !p.startsWith('~') && !p.startsWith('$')) return true;
  return false;
}

/* ------------------------------------------------------------------ shell */

/**
 * Splits a command line into its simple commands: on `;`, `&&`, `||`, `|`, `&`, newlines, and
 * into `$( )` and backtick substitutions, with quoted text kept whole. Not a full shell parser,
 * but enough that no risky command can hide behind a harmless one.
 */
export function splitCommands(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  const flush = () => {
    if (cur.trim() !== '') out.push(cur.trim());
    cur = '';
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    const next = command[i + 1];
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '$' && next === '(') {
        // A substitution inside double quotes still runs: take it out as its own command.
        const end = matchParen(command, i + 1);
        out.push(...splitCommands(command.slice(i + 2, end)));
        cur += '$(...)';
        i = end;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '\\' && next !== undefined) {
      cur += ch + next;
      i += 1;
      continue;
    }
    if (ch === '$' && next === '(') {
      const end = matchParen(command, i + 1);
      out.push(...splitCommands(command.slice(i + 2, end)));
      cur += '$(...)';
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1);
      const stop = end === -1 ? command.length : end;
      out.push(...splitCommands(command.slice(i + 1, stop)));
      cur += '`...`';
      i = stop;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      // `2>&1` and `&>` are redirections, not separators.
      if (ch === '&' && (command[i - 1] === '>' || next === '>')) {
        cur += ch;
        continue;
      }
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return s.length;
}

/** The words of one simple command, quotes taken off, and the files it redirects output to. */
export function tokenize(simple: string): { words: string[]; redirects: string[] } {
  const wordsOut: string[] = [];
  const redirects: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  let redirectNext = false;
  const flush = () => {
    if (!started) return;
    if (redirectNext) {
      if (!cur.startsWith('&')) redirects.push(cur);
      redirectNext = false;
    } else wordsOut.push(cur);
    cur = '';
    started = false;
  };
  for (let i = 0; i < simple.length; i += 1) {
    const ch = simple[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < simple.length) cur += simple[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < simple.length) {
      cur += simple[++i];
      started = true;
      continue;
    }
    if (ch === '>' ) {
      // `2>`, `&>` and `>>`: drop the fd digit or & that was read as a word start.
      if (started && /^(\d+|&)$/.test(cur)) {
        cur = '';
        started = false;
      } else flush();
      if (simple[i + 1] === '>') i += 1;
      if (simple[i + 1] === '&') {
        // `>&2`: a descriptor, not a file.
        i += 1;
        while (i + 1 < simple.length && /\d/.test(simple[i + 1]!)) i += 1;
        continue;
      }
      redirectNext = true;
      continue;
    }
    if (ch === '<') {
      flush();
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    cur += ch;
    started = true;
  }
  flush();
  return { words: wordsOut, redirects };
}

/** Words of one simple command, quotes taken off. */
export function words(simple: string): string[] {
  return tokenize(simple).words;
}

/** Leading wrappers that run the next word as the command. */
const WRAPPERS = new Set(['command', 'exec', 'time', 'nohup', 'nice', 'builtin', 'noglob', 'caffeinate']);

/** The command words with environment assignments and wrappers taken off the front. */
function commandWords(simple: string): string[] {
  const w = words(simple);
  let i = 0;
  while (i < w.length) {
    const word = w[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) i += 1;
    else if (WRAPPERS.has(word)) i += 1;
    else if (word === 'env') {
      i += 1;
      while (i < w.length && (/^-/.test(w[i]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!))) i += 1;
    } else break;
  }
  const rest = w.slice(i);
  if (rest[0]) rest[0] = rest[0].replace(/^.*\//, '');
  return rest;
}

/** Programs that only read or print. Their flags are checked where a flag makes them write. */
const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'wc', 'sort', 'uniq', 'cut',
  'tr', 'echo', 'printf', 'pwd', 'which', 'whereis', 'type', 'whoami', 'id', 'date', 'cal', 'du', 'df', 'stat',
  'file', 'tree', 'printenv', 'uname', 'hostname', 'uptime', 'jq', 'yq', 'diff', 'cmp', 'basename', 'dirname',
  'realpath', 'readlink', 'test', '[', 'true', 'false', 'ps', 'lsof', 'top', 'column', 'nl', 'fold', 'rev',
  'md5', 'md5sum', 'shasum', 'sha256sum', 'base64', 'xxd', 'od', 'strings', 'awk', 'sed', 'find', 'fd', 'man',
  'history', 'sw_vers', 'mdfind', 'pgrep', 'tldr', 'bc', 'expr', 'seq', 'sleep', 'cd', 'graphify', 'tsc',
  'vitest', 'open',
]);

type Rule = (w: string[], simple: string) => Verdict | undefined;

const has = (w: string[], ...flags: string[]) => w.some((x) => flags.includes(x));
const hasPrefix = (w: string[], ...prefixes: string[]) => w.some((x) => prefixes.some((p) => x.startsWith(p)));

const GIT_READ = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'reflog', 'grep',
  'ls-remote', 'fetch', 'cat-file', 'whatchanged', 'name-rev', 'merge-base', 'count-objects', 'help', 'version',
  'worktree', 'remote', 'config', 'stash', 'tag', 'branch', 'switch', 'checkout', 'add', 'commit', 'restore',
  'pull', 'init', 'clone', 'mv',
]);

const RULES: Record<string, Rule> = {
  rm: () => risky('Deletes files.'),
  rmdir: () => risky('Deletes folders.'),
  unlink: () => risky('Deletes a file.'),
  shred: () => risky('Destroys files.'),
  trash: () => risky('Moves files to the Trash.'),
  srm: () => risky('Deletes files.'),
  sudo: () => risky('Runs a command as the administrator.'),
  su: () => risky('Runs a command as another user.'),
  dd: () => risky('Writes raw data to a file or disk.'),
  mkfs: () => risky('Formats a disk.'),
  diskutil: () => risky('Changes disks.'),
  chmod: () => risky('Changes file permissions.'),
  chown: () => risky('Changes file ownership.'),
  kill: () => risky('Stops a running program.'),
  killall: () => risky('Stops running programs.'),
  pkill: () => risky('Stops running programs.'),
  launchctl: () => risky('Changes background services.'),
  crontab: () => risky('Changes scheduled jobs.'),
  osascript: () => risky('Runs an AppleScript, which can control other apps.'),
  ssh: () => risky('Runs commands on another machine.'),
  scp: () => risky('Copies files to or from another machine.'),
  rsync: () => risky('Copies or deletes files in bulk.'),
  ledge: (w) => {
    const sub = w[1];
    if (sub === 'delete' || sub === 'rm' || sub === 'purge' || sub === 'reset') return risky('Deletes a task for good.');
    return SAFE;
  },
  git: (w) => {
    const args = w.slice(1).filter((x, i, a) => !(i > 0 && a[i - 1] === '-C') && x !== '-C');
    const sub = args.find((x) => !x.startsWith('-'));
    if (!sub) return SAFE;
    if (sub === 'push') return risky('Pushes commits to a shared remote.');
    if (sub === 'merge') return risky('Merges branches.');
    if (sub === 'rebase') return risky('Rewrites branch history.');
    if (sub === 'reset' && has(args, '--hard', '--merge', '--keep')) return risky('Throws away uncommitted work.');
    if (sub === 'clean') return risky('Deletes untracked files.');
    if (sub === 'rm') return risky('Deletes files from the repository.');
    if (sub === 'branch' && has(args, '-d', '-D', '--delete', '-M', '-m')) return risky('Deletes or renames a branch.');
    if (sub === 'tag' && has(args, '-d', '--delete')) return risky('Deletes a tag.');
    if ((sub === 'checkout' || sub === 'restore') && (has(args, '--', '.', '-f', '--force') || has(args, '--staged')))
      return risky('Throws away changes to files.');
    if (sub === 'stash' && has(args, 'drop', 'clear')) return risky('Deletes stashed work.');
    if (sub === 'remote' && has(args, 'add', 'remove', 'rm', 'set-url', 'rename')) return risky('Changes where the repository pushes.');
    if (sub === 'config' && !has(args, '--get', '--list', '-l', '--get-all', '--get-regexp')) return risky('Changes git settings.');
    if (sub === 'filter-branch' || sub === 'filter-repo' || sub === 'update-ref') return risky('Rewrites repository history.');
    if (sub === 'worktree' && has(args, 'remove', 'prune')) return risky('Deletes a worktree.');
    if (sub === 'cherry-pick' || sub === 'revert' || sub === 'am' || sub === 'apply') return risky('Changes branch history.');
    if (GIT_READ.has(sub)) return SAFE;
    return risky('A git command that is not known to be safe.');
  },
  gh: (w, simple) => {
    const [, group, verb] = w;
    if (group === 'api') {
      const method = methodOf(w);
      if (method !== 'GET' || hasPrefix(w, '-f', '-F', '--field', '--raw-field', '--input')) {
        return risky(/collaborators|permissions|members|teams|keys|secrets/.test(simple) ? 'Changes who has access.' : 'Changes something on GitHub.');
      }
      return SAFE;
    }
    if (verb && ['list', 'view', 'status', 'checks', 'diff', 'search'].includes(verb)) return SAFE;
    if (group === 'auth' && verb === 'status') return SAFE;
    if (group === 'search' || group === 'browse') return SAFE;
    if (group === 'pr' && verb === 'merge') return risky('Merges a pull request.');
    if (group === 'pr' && verb === 'create') return risky('Opens a pull request that others will see.');
    if (group === 'repo' && verb === 'create') return risky('Creates a repository.');
    return risky('Changes something on GitHub.');
  },
  bb: (w, simple) => {
    const verb = w[1];
    if (verb === 'api') {
      if ((w[2] ?? '').toUpperCase() === 'GET') return SAFE;
      return risky(/permission|member|access|ssh-key|deploy-key|restriction/.test(simple) ? 'Changes who has access.' : 'Changes something on Bitbucket.');
    }
    if (verb && ['pr-list', 'pr-info', 'pr-diffstat', 'pr-commits', 'auth-check', 'whoami', 'help', '--help'].includes(verb)) return SAFE;
    if (verb === 'pr-create') return risky('Opens a pull request that others will see.');
    if (verb === 'pr-merge') return risky('Merges a pull request.');
    if (verb === 'repo-create') return risky('Creates a repository.');
    return risky('Changes something on Bitbucket.');
  },
  jira: (w) => {
    const verb = w[1];
    if (verb === 'api') return (w[2] ?? '').toUpperCase() === 'GET' ? SAFE : risky('Changes something in Jira.');
    if (verb && ['get', 'search', 'me', 'auth-check', 'createmeta', 'sprints', 'transitions', 'help', '--help'].includes(verb)) return SAFE;
    if (verb === 'comment' || verb === 'comments') return w.length > 3 ? risky('Posts a Jira comment others will see.') : SAFE;
    return risky('Changes something in Jira.');
  },
  slack: (w) => {
    const args = w.slice(1).filter((x, i, a) => !(x === '--as' || a[i - 1] === '--as'));
    const verb = args[0];
    if (verb && ['search', 'history', 'replies', 'channels', 'users', 'find-channel', 'find-user', 'auth-check', 'download', 'help', '--help'].includes(verb)) return SAFE;
    if (verb === 'post' || verb === 'dm' || verb === 'upload' || verb === 'react') return risky('Sends a Slack message as you.');
    if (verb === 'call') {
      const method = args[1] ?? '';
      if (/\.(list|info|history|replies|get\w*|search\w*|lookup\w*)$/.test(method) || /^search\./.test(method)) return SAFE;
      return risky('Calls Slack in a way that may post or change something as you.');
    }
    return risky('Sends or changes something in Slack as you.');
  },
  gws: (w, simple) => {
    const service = w[1] ?? '';
    const rest = w.slice(2).join(' ');
    if (service === 'auth') return risky('Changes Google sign-in.');
    if (service === 'gmail' && /\+(send|reply|reply-all|forward)\b|\bsend\b|drafts\s+send/.test(rest)) return risky('Sends email as you.');
    if (service === 'calendar' && /\+insert|\+quick|\binsert\b|\bquickAdd\b|\bcreate\b|\bpatch\b|\bupdate\b|\bdelete\b|\bmove\b/.test(rest))
      return risky('Creates or changes a calendar event others may see.');
    if (/permissions?\s+(create|update|delete)|\+share\b|\bacl\b|\bshare\b/.test(rest)) return risky('Changes who has access.');
    if (/\b(delete|trash|remove|clear)\b/.test(rest)) return risky('Deletes something in Google Workspace.');
    if (/\+(agenda|triage|search|read|list|get|standup|week)\b|\b(list|get|search|export|download|read)\b/.test(rest)) return SAFE;
    return risky(/chat|gmail|message/.test(simple) ? 'May send a message as you.' : 'Changes something in Google Workspace.');
  },
  firebase: (w) => {
    const verb = w.slice(1).find((x) => !x.startsWith('-')) ?? '';
    if (verb === 'deploy' || /:deploy$|^hosting:clone$/.test(verb)) return risky('Deploys to Firebase.');
    if (/iam|permission|role|auth:import|users?:/.test(verb)) return risky('Changes who has access to a Firebase project.');
    if (verb === '' || /:(list|sdkconfig|log|get)$/.test(verb) || ['use', 'help', 'login:list', 'emulators:start', 'serve'].includes(verb)) return SAFE;
    return risky('Changes a Firebase project.');
  },
  gcloud: (w) => {
    const rest = w.slice(1).filter((x) => !x.startsWith('-'));
    const verbs = rest.join(' ');
    if (/(add|remove|set)-iam-policy-binding|set-iam-policy|\biam\b.*\b(create|delete|update|add|remove|undelete|enable|disable)\b/.test(verbs))
      return risky('Changes who has access to a Google Cloud project.');
    if (/\b(deploy|create|delete|update|set|add|remove|start|stop|reset|resize|enable|disable|import|ssh|scp|cp|mv|rm|rsync|apply|patch|restore|rollback)\b/.test(verbs))
      return risky('Changes something in Google Cloud.');
    if (/\b(list|describe|get-iam-policy|read|get-value|print-access-token|info|version|help|tail|logs|config list|auth list)\b/.test(verbs)) return SAFE;
    return risky('A Google Cloud command that is not known to be safe.');
  },
  gsutil: (w) => (/^(ls|cat|du|stat|help|version)$/.test(w[1] ?? '') ? SAFE : risky('Changes files in Cloud Storage.')),
  curl: (w) => {
    if (methodOf(w) !== 'GET' || hasPrefix(w, '-d', '--data', '-F', '--form', '-T', '--upload-file', '--json')) {
      return risky('Sends data to a web server.');
    }
    if (hasPrefix(w, '-o', '--output', '-O', '--remote-name')) return risky('Downloads a file to disk.');
    return SAFE;
  },
  wget: () => risky('Downloads files to disk.'),
  mv: (w) => (w.slice(1).filter((x) => !x.startsWith('-')).every((p) => isSafeWritePath(p)) ? SAFE : risky('Moves or renames files outside ~/.ledge.')),
  cp: (w) => {
    const target = w.slice(1).filter((x) => !x.startsWith('-')).pop() ?? '';
    return isSafeWritePath(target) ? SAFE : risky('Copies files over a path outside ~/.ledge.');
  },
  touch: (w) => (w.slice(1).filter((x) => !x.startsWith('-')).every((p) => isSafeWritePath(p)) ? SAFE : risky('Writes files outside ~/.ledge.')),
  mkdir: (w) => (w.slice(1).filter((x) => !x.startsWith('-')).every((p) => isSafeWritePath(p)) ? SAFE : risky('Creates folders outside ~/.ledge.')),
  tee: (w) => (w.slice(1).filter((x) => !x.startsWith('-')).every((p) => isSafeWritePath(p)) ? SAFE : risky('Writes files outside ~/.ledge.')),
  ln: () => risky('Creates links between files.'),
  defaults: (w) => (w[1] === 'read' || w[1] === 'domains' ? SAFE : risky('Changes app settings.')),
  sed: (w) => (has(w, '-i') || hasPrefix(w, '-i', '--in-place') ? risky('Edits files in place.') : SAFE),
  find: (w) => (has(w, '-delete', '-exec', '-execdir', '-ok', '-okdir') ? risky('Runs a command or deletes on every file it finds.') : SAFE),
  xargs: (w) => {
    const inner = w.slice(1).filter((x) => !x.startsWith('-'));
    return inner.length > 0 ? classifySimple(inner.map(quoteWord).join(' ')) : SAFE;
  },
  npm: (w) => (has(w, 'publish', 'unpublish', 'deprecate', 'owner', 'access', 'adduser', 'login') ? risky('Publishes or changes a package on the registry.') : SAFE),
  pnpm: (w) => (has(w, 'publish') ? risky('Publishes a package.') : SAFE),
  yarn: (w) => (has(w, 'publish') ? risky('Publishes a package.') : SAFE),
  cargo: (w) => (has(w, 'publish', 'yank', 'owner', 'login') ? risky('Publishes a crate.') : SAFE),
  docker: (w) => (has(w, 'push', 'rm', 'rmi', 'prune', 'kill', 'stop', 'login') ? risky('Changes containers or images.') : SAFE),
  sh: (w, simple) => shellInline(w, simple),
  bash: (w, simple) => shellInline(w, simple),
  zsh: (w, simple) => shellInline(w, simple),
  eval: (w) => classifyCommand(w.slice(1).join(' ')),
};

function shellInline(w: string[], _simple: string): Verdict {
  const at = w.indexOf('-c');
  if (at !== -1 && w[at + 1] !== undefined) return classifyCommand(w[at + 1]!);
  return risky('Runs a script whose contents are not shown.');
}

function quoteWord(w: string): string {
  return /[\s"'\\]/.test(w) ? `'${w.replace(/'/g, `'\\''`)}'` : w;
}

function methodOf(w: string[]): string {
  for (let i = 0; i < w.length; i += 1) {
    const x = w[i]!;
    if (x === '-X' || x === '--request' || x === '--method') return (w[i + 1] ?? 'GET').toUpperCase();
    const m = /^(?:-X|--request=|--method=)(.+)$/.exec(x);
    if (m) return m[1]!.toUpperCase();
  }
  return 'GET';
}

/** One simple command, no separators. */
function classifySimple(simple: string, options: PolicyOptions = {}): Verdict {
  for (const target of tokenize(simple).redirects) {
    if (!isSafeWritePath(target, options.home)) return risky(`Writes to ${target}, outside ~/.ledge.`);
  }
  const w = commandWords(simple);
  const program = w[0];
  if (!program) return SAFE;
  const rule = RULES[program];
  if (rule) {
    const v = rule(w, simple);
    if (v) return v;
  }
  if (READ_ONLY.has(program)) return SAFE;
  if (/^(\.|\.\.)?\//.test(program) || program.endsWith('.sh')) return risky('Runs a script whose contents are not shown.');
  return risky(`\`${program}\` is not a command known to be safe.`);
}

/** A whole command line: risky when any part of it is. */
export function classifyCommand(command: string, options: PolicyOptions = {}): Verdict {
  for (const part of splitCommands(command)) {
    const v = classifySimple(part, options);
    if (v.risky) return v;
  }
  return SAFE;
}

/* ------------------------------------------------------------------ MCP tools */

const MCP_WRITE =
  /(^|_)(send|post|reply|forward|create|insert|add|delete|remove|trash|untrash|share|grant|revoke|permission|acl|update|modify|write|move|rename|batch|deploy|merge|upload|schedule|set|publish|invite|draft|complete|clear|link|unlink|protect|append|replace|edit|record|toggle|authenticate)(_|$)/i;
const MCP_READ = /(^|_)(get|list|search|read|query|find|fetch|describe|lookup|outline|unfold|timeline|status|context|summary|summaries|details|freebusy|instances|transcript|IMPORTANT)(_|$)/i;

function classifyMcp(tool: string): Verdict {
  const name = tool.split('__').slice(2).join('__') || tool;
  if (MCP_WRITE.test(name)) {
    if (/send|post|reply|forward|message|draft|invite/i.test(name)) return risky('Sends a message or email as you.');
    if (/share|grant|revoke|permission|acl|invite/i.test(name)) return risky('Changes who has access.');
    if (/delete|remove|trash|clear/i.test(name)) return risky('Deletes something.');
    if (/create_event|insert|quick_add|calendar/i.test(name)) return risky('Creates or changes a calendar event.');
    return risky('Changes something outside Ledge.');
  }
  if (MCP_READ.test(name)) return SAFE;
  return risky('An outside tool that is not known to be read only.');
}

/* ------------------------------------------------------------------ entry */

/** Whether a tool call waits for an Approve, and why. */
export function classify(tool: string, input: unknown, options: PolicyOptions = {}): Verdict {
  const args = isObject(input) ? input : {};
  if (READ_TOOLS.has(tool)) return SAFE;
  if (SHELL_TOOLS.has(tool)) {
    const command = typeof args.command === 'string' ? args.command : '';
    if (command.trim() === '') return tool === 'Monitor' ? SAFE : risky('Runs a shell command that is not shown.');
    return classifyCommand(command, options);
  }
  if (WRITE_TOOLS.has(tool)) {
    const path = [args.file_path, args.notebook_path, args.path].find((p): p is string => typeof p === 'string') ?? '';
    return isSafeWritePath(path, options.home) ? SAFE : risky(`Writes ${path || 'a file'}, outside ~/.ledge.`);
  }
  if (tool.startsWith('mcp__')) return classifyMcp(tool);
  if (tool === 'CronCreate' || tool === 'CronDelete' || tool === 'ScheduleWakeup' || tool === 'RemoteTrigger') {
    return risky('Schedules work to run later.');
  }
  if (tool === 'SendMessage' || tool === 'PushNotification') return SAFE;
  return risky(`${tool} is not a tool known to be safe.`);
}

/**
 * What "Always allow this for this chat" remembers: the tool plus the command prefix, so
 * approving `git push origin main` once also lets `git push origin other` through in that chat,
 * but not `git reset --hard`.
 */
export function approvalKey(tool: string, input: unknown): string {
  const args = isObject(input) ? input : {};
  if (SHELL_TOOLS.has(tool) && typeof args.command === 'string') {
    const parts = splitCommands(args.command);
    const riskyPart = parts.find((p) => classifySimple(p).risky) ?? parts[0] ?? '';
    const w = commandWords(riskyPart);
    const prefixLength = ['git', 'gh', 'bb', 'jira', 'slack', 'gws', 'firebase', 'gcloud', 'ledge', 'npm', 'docker'].includes(
      w[0] ?? '',
    )
      ? w[0] === 'gh' || w[0] === 'gws'
        ? 3
        : 2
      : 1;
    return `${tool}:${w.slice(0, prefixLength).join(' ')}`;
  }
  if (WRITE_TOOLS.has(tool)) {
    const path = [args.file_path, args.notebook_path, args.path].find((p): p is string => typeof p === 'string') ?? '';
    return `${tool}:${path}`;
  }
  return tool;
}
