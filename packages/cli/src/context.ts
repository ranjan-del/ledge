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
