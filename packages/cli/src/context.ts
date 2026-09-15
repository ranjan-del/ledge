// Shared types and error classes for the command handlers. Kept dependency-free so every command
// file can import from here without pulling in the dispatcher.

/** Process exit codes fixed by Contract 3. */
export const EXIT = { ok: 0, usage: 1, notFound: 2, parse: 3 } as const;

/** Flags recognised on the command line. Positional arguments live in CommandContext.args. */
export interface Flags {
  json: boolean;
  context: boolean;
  backlog: boolean;
  repo?: string;
}

/** Everything a command handler needs: arguments, flags, working directory and output sinks. */
export interface CommandContext {
  args: string[];
  flags: Flags;
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
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
