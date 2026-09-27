// Shared types and error classes for the command handlers. Kept free of runtime dependencies so
// every command file can import from here without pulling in the dispatcher.
import type { Provider } from '@ledge/core';

/** Process exit codes fixed by Contract 3. */
export const EXIT = { ok: 0, usage: 1, notFound: 2, parse: 3 } as const;

/** Flags recognised on the command line. Positional arguments live in CommandContext.args. */
export interface Flags {
  json: boolean;
  context: boolean;
  backlog: boolean;
  /** Confirms a destructive command. Only `delete` reads it, and it refuses to act without it. */
  yes: boolean;
  /** Writes the result into the task file. Only `handoff` reads it. */
  save: boolean;
  repo?: string;
  /** The Claude Code session id. `began`, `capture` and `track` read it. */
  session?: string;
  /** With capture: skip the debounce, as the PreCompact and SessionEnd hooks do. */
  final: boolean;
  /** With capture: run whatever the debounce says. */
  force: boolean;
  /** With summarise: every open task rather than one. */
  all: boolean;
  /** With track: the session has ended. */
  ended: boolean;
  /** With capture and track: the transcript path from the hook payload. */
  transcript?: string;
  /** With capture and track: the session's working directory, when it is not this one. */
  dir?: string;
  /** With sessions: only the sessions attributed to this task. With week add: the linked task. */
  task?: string;
  /** With week add and week move: the day, `YYYY-MM-DD`, a word such as `today`, or `anytime`. */
  day?: string;
  /** With week: the ISO week to act on, `YYYY-Www`, instead of the current one. */
  week?: string;
  /** With week: act on next week instead of the current one. */
  next: boolean;
  /** With summarise: no progress lines on stderr. */
  quiet: boolean;
}

/**
 * Everything a command handler needs: arguments, flags, working directory, output sinks and the
 * inference backend. The provider is handed in rather than constructed, so a test can run the
 * assistant commands end to end against a stand-in and the suite never reaches a model.
 */
export interface CommandContext {
  args: string[];
  flags: Flags;
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  provider: Provider;
  /**
   * The fast model for background work: `capture` and `summarise`. A separate provider rather
   * than a flag on the first, because those two run after every few turns and must pin Haiku,
   * while `ask` and friends leave the model to Claude Code. Tests inject a stand-in for both.
   */
  fastProvider: Provider;
}

/** A command handler: returns the exit code, or throws one of the error classes below. */
export type CommandRunner = (ctx: CommandContext) => Promise<number>;

/** Thrown when arguments are missing or malformed; main() maps it to exit code 1. */
export class UsageError extends Error {
  command: string;

  constructor(message: string, command: string) {
    super(message);
    this.name = 'UsageError';
    this.command = command;
  }
}

/** Thrown when a task, checklist item or store does not exist; main() maps it to exit code 2. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
