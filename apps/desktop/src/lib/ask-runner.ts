/**
 * Runs one Ask Ledge question through Claude Code and streams the answer back as events. The
 * program is started through the shell plugin by its allow-listed name, `claude-ask`, and the
 * arguments below must match that entry in `src-tauri/capabilities/default.json` exactly or the
 * plugin refuses to start it; a test holds the two together.
 *
 * Why a shell in front of `claude`. An app started from the Dock or at login gets the system's
 * short PATH, which does not include `~/.local/bin` where Claude Code installs itself, nor
 * Homebrew where `ledge` usually lives. The script puts the usual install places in front of
 * PATH, marks the run with LEDGE_CAPTURE=1 so no Ledge hook can capture it, and pipes the
 * prompt in on stdin, which the shell plugin itself cannot close.
 *
 * The flags keep the run to what the contract allows: Sonnet, none of the person's own settings
 * or hooks, no MCP servers, no saved session, Bash as the only tool, and Bash for `ledge` only:
 * `dontAsk` refuses anything not allowed instead of waiting for a prompt nobody will answer.
 */
import { Command } from '@tauri-apps/plugin-shell';
import { parseStreamLine, type AskEvent } from './ask.ts';

export const ASK_PROGRAM = 'claude-ask';

/**
 * Commands Claude Code would otherwise run without asking because it judges them read only.
 * `--permission-mode dontAsk` refuses everything not allowed, but that auto-approval sits
 * outside it, so these are refused by name; `ledge delete` is refused because the contract's
 * edits never include deleting a task.
 */
export const ASK_DENIED = [
  'ledge delete',
  ...['git', 'ls', 'cat', 'head', 'tail', 'find', 'grep', 'rg', 'sed', 'awk', 'less', 'more'],
  ...['tree', 'stat', 'file', 'wc', 'sort', 'uniq', 'cut', 'xargs', 'echo', 'printf', 'pwd'],
  ...['cd', 'env', 'printenv', 'which', 'whoami', 'date', 'du', 'df', 'open', 'ps', 'lsof'],
  ...['curl', 'wget', 'node', 'python', 'python3', 'npm', 'npx'],
];

/** The fixed script. `$1` is the prompt. Exit 127 means `claude` was not found. */
export const ASK_SCRIPT =
  'PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"; ' +
  'export PATH LEDGE_CAPTURE=1; ' +
  'command -v claude >/dev/null 2>&1 || exit 127; ' +
  'printf \'%s\' "$1" | claude -p --model sonnet --setting-sources \'\' --strict-mcp-config ' +
  '--no-session-persistence --tools Bash --permission-mode dontAsk ' +
  "--allowedTools 'Bash(ledge:*)' " +
  `--disallowedTools ${ASK_DENIED.map((c) => `'Bash(${c}:*)'`).join(' ')} ` +
  '--output-format stream-json --verbose --include-partial-messages';

/** Arguments for `/bin/sh`, in the order the capability entry lists them. */
export function askArgs(prompt: string): string[] {
  return ['-c', ASK_SCRIPT, 'ledge-ask', prompt];
}

export interface AskOutcome {
  code: number | null;
  stderr: string;
  /** True when the run was stopped by `cancel`. */
  cancelled: boolean;
}

export interface AskRun {
  done: Promise<AskOutcome>;
  cancel: () => void;
}

/** What the chat surface calls. Tests hand in a stub with the same shape. */
export type AskRunner = (prompt: string, onEvent: (event: AskEvent) => void, cwd?: string) => AskRun;

/** The real runner, over the shell plugin. Never throws: a failure to start is an outcome. */
export const shellAskRunner: AskRunner = (prompt, onEvent, cwd) => {
  let cancelled = false;
  let kill: (() => Promise<void>) | null = null;
  const done = new Promise<AskOutcome>((resolve) => {
    let stderr = '';
    let pending = '';
    const feed = (chunk: string) => {
      pending += chunk.endsWith('\n') ? chunk : `${chunk}\n`;
      let at = pending.indexOf('\n');
      while (at !== -1) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        for (const event of parseStreamLine(line)) onEvent(event);
        at = pending.indexOf('\n');
      }
    };
    try {
      const cmd = Command.create(ASK_PROGRAM, askArgs(prompt), cwd ? { cwd } : undefined);
      cmd.stdout.on('data', (line: string) => feed(line));
      cmd.stderr.on('data', (line: string) => {
        stderr += `${line}\n`;
      });
      cmd.on('close', ({ code }) => resolve({ code, stderr, cancelled }));
      cmd.on('error', (e: string) => resolve({ code: null, stderr: `${stderr}${e}`, cancelled }));
      void cmd
        .spawn()
        .then((child) => {
          kill = () => child.kill();
          if (cancelled) void kill();
        })
        .catch((e: unknown) =>
          resolve({ code: null, stderr: e instanceof Error ? e.message : String(e), cancelled }),
        );
    } catch (e) {
      resolve({ code: null, stderr: e instanceof Error ? e.message : String(e), cancelled });
    }
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      if (kill) void kill().catch(() => {});
    },
  };
};
