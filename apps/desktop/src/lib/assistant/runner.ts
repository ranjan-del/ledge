/**
 * Starts the one long-lived Claude Code process the assistant talks to, through the shell
 * plugin by its allow-listed name `claude-agent`. The arguments must match that entry in
 * `src-tauri/capabilities/default.json` exactly or the plugin refuses to start it; a test holds
 * the two together.
 *
 * The script does what Ask Ledge's does (PATH fix for an app started from the Dock, and
 * LEDGE_CAPTURE=1 so Ledge's own hooks stay silent), then runs Claude Code in `~/.ledge` with the
 * Agent SDK's stdio protocol. Unlike Ask Ledge it loads the person's own settings, MCP servers
 * and CLAUDE.md (no `--setting-sources ''`), so the assistant has the tools their terminal has.
 *
 * `--permission-mode default` sends every tool call the person's settings do not already allow
 * to Ledge as a `can_use_tool` request (`--permission-prompt-tool stdio`), so Ledge's policy,
 * not the person's everyday auto mode, decides what waits for an Approve.
 *
 * `$1` is the model alias, `$2` the appended system prompt, `$3` a session id to resume or
 * empty. The person's `~/.claude/identity.md`, when there is one, is added to the system prompt
 * by the script itself, since the webview may not read outside `~/.ledge`.
 */
import { Command } from '@tauri-apps/plugin-shell';
import type { ResolvedModel } from './types.ts';

export const AGENT_PROGRAM = 'claude-agent';

export const AGENT_SCRIPT =
  'PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"; ' +
  'export PATH LEDGE_CAPTURE=1; ' +
  'command -v claude >/dev/null 2>&1 || exit 127; ' +
  'cd "$HOME/.ledge" 2>/dev/null || cd "$HOME"; ' +
  'sp="$2"; if [ -r "$HOME/.claude/identity.md" ]; then ' +
  'sp="$sp\n\nWho the person is, from ~/.claude/identity.md:\n$(cat "$HOME/.claude/identity.md")"; fi; ' +
  'exec claude -p --input-format stream-json --output-format stream-json --verbose ' +
  '--include-partial-messages --permission-prompt-tool stdio --permission-mode default ' +
  '--model "$1" --append-system-prompt "$sp" ${3:+--resume "$3"}';

/** The validators the capability entry holds for `$1`, `$2` and `$3`. */
export const AGENT_ARG_VALIDATORS = ['(haiku|sonnet|opus)', '[\\s\\S]+', '([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})?'];

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export interface AgentLaunch {
  model: ResolvedModel;
  systemPrompt: string;
  /** A Claude Code session id to continue. Ignored unless it is a UUID. */
  resume?: string;
}

/** Arguments for `/bin/sh`, in the order the capability entry lists them. */
export function agentArgs(launch: AgentLaunch): string[] {
  const resume = launch.resume && UUID.test(launch.resume) ? launch.resume : '';
  return ['-c', AGENT_SCRIPT, 'ledge-assistant', launch.model, launch.systemPrompt || ' ', resume];
}

export interface AgentHandlers {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
  /** The process ended. `code` is null when it never started or was killed. */
  close(code: number | null, detail?: string): void;
}

export interface AgentProcess {
  write(data: string): Promise<void>;
  kill(): Promise<void>;
}

/** Starts a process. Tests hand in a fake with the same shape. */
export type AgentRunner = (launch: AgentLaunch, handlers: AgentHandlers) => Promise<AgentProcess>;

/** The real runner, over the shell plugin (spawn, then stdin writes). */
export const shellAgentRunner: AgentRunner = async (launch, handlers) => {
  const cmd = Command.create(AGENT_PROGRAM, agentArgs(launch));
  let closed = false;
  cmd.stdout.on('data', (line: string) => handlers.stdout(line));
  cmd.stderr.on('data', (line: string) => handlers.stderr(`${line}\n`));
  cmd.on('close', ({ code }) => {
    if (closed) return;
    closed = true;
    handlers.close(code);
  });
  cmd.on('error', (e: string) => {
    if (closed) return;
    closed = true;
    handlers.close(null, e);
  });
  const child = await cmd.spawn();
  return {
    write: (data) => child.write(data),
    kill: () => child.kill(),
  };
};
