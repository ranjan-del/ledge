/**
 * The default Config, with no Node dependency. The platform arrives as an argument so the CLI
 * can pass what `node:os` reports while the desktop app passes what the OS plugin reports, and
 * both get the same shape from the same code.
 */
import type { Config } from './types.ts';

/**
 * Picks the terminal Ledge launches by default for a Node-style platform name (`darwin`,
 * `win32`, anything else). An unknown or unstated platform gets the generic Linux launcher,
 * which is also what a person sees in Settings until they save a terminal of their own.
 */
export function defaultTerminal(platformName: string): string {
  switch (platformName) {
    case 'darwin':
      return 'Terminal.app';
    case 'win32':
      return 'wt';
    default:
      return 'x-terminal-emulator';
  }
}

/**
 * Builds a fresh default Config. Called for every load so callers can mutate the result freely,
 * and so `loadConfig` can deep-merge a partial file over a complete baseline (spec section 8:
 * missing keys get defaults without rewriting the file).
 */
export function defaultConfig(platformName: string = ''): Config {
  return {
    roots: ['~/code'],
    scan: {
      intervalMinutes: 5,
      maxDepth: 4,
      ignore: ['node_modules', '.git', 'dist', 'target'],
      staleDays: 30,
    },
    terminal: defaultTerminal(platformName),
    claude: { command: 'claude', resumeFlag: '--resume' },
    ui: { edge: 'right', theme: 'system' },
  };
}
