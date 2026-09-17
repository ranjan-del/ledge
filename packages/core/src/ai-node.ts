/**
 * The one Provider implementation Ledge ships: the Claude Code command line tool, run as a
 * child process. It lives apart from ./ai.ts because it spawns programs, and ./ai.ts has to
 * stay free of `node:` imports for the desktop bundle.
 *
 * Why this provider first. The person running Ledge already has `claude` installed and already
 * pays for it, so inference costs no API key, no second account and nothing new to install.
 * There is no network code here at all: this file starts a process and reads its output, and
 * whatever that process does about models, auth and endpoints is its own business.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AskResult, Provider } from './ai.ts';

/** How long `ask` waits for a completion before killing the child, when the caller says nothing. */
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * The arguments Ledge runs `claude` with. `-p` with the prompt on stdin is the whole of the
 * contract; the rest is isolation, and every one of them is there for a reason.
 *
 * `--output-format text` pins the shape of stdout so a future change of default cannot turn an
 * answer into JSON. `--setting-sources ''` drops the person's own user, project and local
 * settings, which matters more than it looks: Ledge's own Claude Code plugin registers
 * SessionStart and Stop hooks, so without this an inference call would fire the hooks and the
 * Stop hook would write a session id into a task file. Asking a question must not edit the
 * records the question is about. `--strict-mcp-config` keeps MCP servers out of a call that has
 * no use for them. The denied tool list is the honesty rule made real: the prompt says to
 * answer from the context alone, and a model that can read files and run git could quietly
 * answer from something Ledge never showed it and never labelled.
 */
const DEFAULT_ARGS = [
  '-p',
  '--output-format',
  'text',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disallowedTools',
  'Bash Read Write Edit Glob Grep WebFetch WebSearch Task NotebookEdit',
];

/** Knobs for claudeCodeProvider. Every one has a working default; passing none is normal. */
export interface ClaudeCodeOptions {
  /** Program to run. Defaults to `claude`, resolved on PATH. */
  command?: string;
  /** Arguments before stdin. Defaults to DEFAULT_ARGS; replace the whole list to change it. */
  args?: string[];
  /** Milliseconds `ask` waits before killing the child. Defaults to 90000. */
  timeoutMs?: number;
  /**
   * Working directory of the child. Defaults to the system temp folder, deliberately: a
   * neutral folder means the call cannot pick up a CLAUDE.md, a repository or a task from
   * wherever the person happened to run `ledge`.
   */
  cwd?: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the program could not be started at all, e.g. it is not on PATH. */
  spawnError?: Error;
}

/** Runs a program with `input` on stdin and collects its output, killing it after `timeoutMs`. */
function run(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: Error) =>
      finish({ code: null, stdout, stderr, timedOut, spawnError: error }),
    );
    child.on('close', (code: number | null) => finish({ code, stdout, stderr, timedOut }));
    // A child that exits before the prompt is fully written gives EPIPE on this end. That is
    // not a separate failure: the close handler above already has the exit code and stderr,
    // which say far more about what went wrong than a broken pipe does.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function firstLines(text: string, count = 3): string {
  const lines = text.trim().split('\n').filter((line) => line.trim() !== '');
  return lines.slice(0, count).join(' ').trim();
}

/**
 * Builds the Claude Code provider. Nothing is run until `available()` or `ask()` is called, so
 * constructing one is free and a command can hold one it never uses.
 *
 * `available()` answers honestly rather than assuming: it runs `claude auth status`, which is a
 * local call that returns in well under a second, and reports true only when that program
 * starts, exits cleanly and says it is logged in. A missing binary, a binary too old to know
 * the subcommand, and an installed but signed out binary are three different answers, and
 * `unavailableReason()` says which one happened and what to do about it. The answer is cached
 * for the life of the provider, because a single `ledge` run should not ask twice.
 *
 * When the provider is missing, nothing here throws on the way to that discovery: `available()`
 * returns false and callers print their observed facts without inference. `ask()` is the one
 * method that throws, and only when it was called and genuinely failed.
 */
export function claudeCodeProvider(options: ClaudeCodeOptions = {}): Provider {
  const command = options.command ?? 'claude';
  const args = options.args ?? DEFAULT_ARGS;
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? tmpdir();
  let cached: boolean | undefined;
  let reason: string | undefined;

  const install =
    `Install Claude Code (https://claude.com/claude-code) and run "${command} auth login", ` +
    'or point Ledge at another provider.';

  return {
    name: 'claude-code',

    async available(): Promise<boolean> {
      if (cached !== undefined) return cached;
      const probe = await run(command, ['auth', 'status'], '', 10_000, cwd);
      if (probe.spawnError) {
        reason = `The "${command}" command is not on PATH, so nothing could be asked. ${install}`;
        cached = false;
        return cached;
      }
      if (probe.timedOut) {
        reason =
          `"${command} auth status" did not answer within 10 seconds, so Ledge asked it nothing.`;
        cached = false;
        return cached;
      }
      if (probe.code !== 0) {
        const detail = firstLines(probe.stderr || probe.stdout) || `exit code ${probe.code}`;
        reason =
          `"${command} auth status" failed, so Ledge cannot tell whether it is signed in: ` +
          `${detail}. Run "${command} auth login".`;
        cached = false;
        return cached;
      }
      let loggedIn: unknown;
      try {
        loggedIn = (JSON.parse(probe.stdout) as { loggedIn?: unknown }).loggedIn;
      } catch {
        reason =
          `"${command} auth status" printed something Ledge could not read, so it did not ask ` +
          'it anything. Run that command yourself to see what it says.';
        cached = false;
        return cached;
      }
      if (loggedIn !== true) {
        reason = `"${command}" is installed but not signed in. Run "${command} auth login".`;
        cached = false;
        return cached;
      }
      reason = undefined;
      cached = true;
      return cached;
    },

    unavailableReason(): string | undefined {
      return reason;
    },

    async ask(prompt: string, opts: { timeoutMs?: number } = {}): Promise<AskResult> {
      const timeoutMs = opts.timeoutMs ?? defaultTimeout;
      const result = await run(command, args, prompt, timeoutMs, cwd);
      if (result.spawnError) {
        throw new Error(`Could not run "${command}": ${result.spawnError.message}`);
      }
      if (result.timedOut) {
        throw new Error(`"${command}" did not answer within ${Math.round(timeoutMs / 1000)}s.`);
      }
      if (result.code !== 0) {
        const detail = firstLines(result.stderr) || `exit code ${result.code}`;
        throw new Error(`"${command} ${args.join(' ')}" failed: ${detail}`);
      }
      const text = result.stdout.trim();
      if (text === '') throw new Error(`"${command}" answered with nothing.`);
      return { text, provider: 'claude-code' };
    },
  };
}
