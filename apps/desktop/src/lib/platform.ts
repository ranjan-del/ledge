/**
 * Platform glue: which OS we are on (drives `data-os` on <html>), how to open a terminal there,
 * and the one action that ties it together, `openInClaude`. Terminal launches go through the
 * shell plugin by allow-listed name; if that fails the Rust `open_terminal` command is tried,
 * and if that fails too the caller receives the exact command to copy and run.
 */
import { buildResumePrompt, type Config, type Task } from '@ledge/core/pure';
import { invoke } from '@tauri-apps/api/core';
import { platform as osPlatform } from '@tauri-apps/plugin-os';
import { runAllowed } from './io.ts';
import { desk } from './store.svelte.ts';

export type Os = 'macos' | 'windows' | 'linux';

/** Detects the OS from the os plugin, falling back to the user agent outside Tauri. */
export function detectOs(): Os {
  try {
    const p = osPlatform();
    if (p === 'macos' || p === 'windows' || p === 'linux') return p;
  } catch {
    /* not running inside Tauri (tests, vite preview) */
  }
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macos';
  if (/Win/i.test(ua)) return 'windows';
  return 'linux';
}

/** Sets `data-os` on <html> so tokens.css can pick radius and tint. */
export function applyOs(os: Os = detectOs()): Os {
  if (typeof document !== 'undefined') document.documentElement.dataset.os = os;
  return os;
}

/** POSIX single-quote so any path or prompt survives `sh -c` untouched. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export interface LaunchSpec {
  /** Allow-list entry name in capabilities/default.json, also the program name. */
  name: 'osascript' | 'wt' | 'x-terminal-emulator';
  args: string[];
  /** Human-readable command to show when launching fails. */
  display: string;
}

/**
 * Builds the terminal launch for a given OS and configured terminal. First release ships
 * Terminal.app (macOS), Windows Terminal `wt` and Debian's `x-terminal-emulator`; other
 * terminal names fall back to the platform default so the button still does something.
 */
export function terminalLaunch(os: Os, terminal: string, dir: string, command: string): LaunchSpec {
  const shellLine = `cd ${shellQuote(dir)} && ${command}`;
  if (os === 'macos' || terminal === 'Terminal.app') {
    const script = `tell application "Terminal" to do script "${appleScriptString(shellLine)}"`;
    return {
      name: 'osascript',
      args: ['-e', script, '-e', 'tell application "Terminal" to activate'],
      display: shellLine,
    };
  }
  if (os === 'windows' || terminal === 'wt') {
    return {
      name: 'wt',
      args: ['-d', dir, 'cmd', '/k', command],
      display: `cd /d "${dir}" && ${command}`,
    };
  }
  return {
    name: 'x-terminal-emulator',
    args: ['-e', 'sh', '-c', `${shellLine}; exec "\${SHELL:-sh}"`],
    display: shellLine,
  };
}

/**
 * The claude invocation for a task: `claude --resume <id>` when resuming a known session,
 * otherwise `claude '<prompt>'` with the title, requirement and unchecked items.
 */
export function claudeCommand(task: Task, resume: boolean, claude: Config['claude']): string {
  const last = task.sessions[task.sessions.length - 1];
  if (resume && last) return `${claude.command} ${claude.resumeFlag} ${shellQuote(last)}`;
  return `${claude.command} ${shellQuote(buildResumePrompt(task).trimEnd())}`;
}

export type LaunchResult = { ok: true } | { ok: false; command: string; dir: string; error: string };

/**
 * Opens the configured terminal in the task's repo (or the home folder) running Claude Code,
 * resuming the last session when `resume` is true and one exists. Never throws: a failure
 * returns the command so the panel can show it for copy and paste.
 */
export async function openInClaude(task: Task, resume: boolean): Promise<LaunchResult> {
  const os = detectOs();
  const dir = task.repo ?? desk.home;
  const command = claudeCommand(task, resume, desk.config.claude);
  const spec = terminalLaunch(os, desk.config.terminal, dir, command);
  try {
    await runAllowed(spec.name, spec.args);
    return { ok: true };
  } catch (first) {
    try {
      await invoke('open_terminal', { dir, command });
      return { ok: true };
    } catch (second) {
      const error = `${(first as Error).message ?? first}; ${(second as Error).message ?? second}`;
      return { ok: false, command: spec.display, dir, error };
    }
  }
}
