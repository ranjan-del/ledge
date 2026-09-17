import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TaskParseError, claudeCodeProvider } from '@ledge/core';
import type { Provider } from '@ledge/core';
import type { CommandContext, CommandRunner, Flags } from './context.ts';
import { EXIT, NotFoundError, UsageError } from './context.ts';
import { renderCommandHelp, renderHelp } from './help.ts';
import { run as add } from './commands/add.ts';
import { run as app } from './commands/app.ts';
import { run as began } from './commands/began.ts';
import { run as ask } from './commands/ask.ts';
import { run as current } from './commands/current.ts';
import { run as deleteTask } from './commands/delete.ts';
import { run as done } from './commands/done.ts';
import { run as init } from './commands/init.ts';
import { run as link } from './commands/link.ts';
import { run as list } from './commands/list.ts';
import { run as memory } from './commands/memory.ts';
import { run as note } from './commands/note.ts';
import { run as open } from './commands/open.ts';
import { run as park } from './commands/park.ts';
import { run as plan } from './commands/plan.ts';
import { run as scan } from './commands/scan.ts';
import { run as settle } from './commands/settle.ts';
import { run as sessions } from './commands/sessions.ts';
import { run as handoff } from './commands/handoff.ts';
import { run as standup } from './commands/standup.ts';
import { run as start } from './commands/start.ts';
import { run as tick } from './commands/tick.ts';
import { run as today } from './commands/today.ts';
import { run as todo } from './commands/todo.ts';
import { run as untick } from './commands/untick.ts';
import { run as when } from './commands/when.ts';

/**
 * Output sinks, working directory and the inference backend; tests inject these to capture
 * output and to keep the suite away from any model. The provider is built here rather than
 * inside a command because building one is free: nothing runs until a command asks it whether
 * it is available.
 */
export interface MainIo {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
  provider: Provider;
}

const COMMANDS: Record<string, CommandRunner> = {
  list,
  add,
  start,
  park,
  delete: deleteTask,
  done,
  current,
  link,
  began,
  settle,
  todo,
  tick,
  untick,
  plan,
  note,
  when,
  today,
  sessions,
  memory,
  ask,
  standup,
  handoff,
  open,
  scan,
  app,
  init,
};

function defaultIo(): MainIo {
  return {
    out: (text) => process.stdout.write(text + '\n'),
    err: (text) => process.stderr.write(text + '\n'),
    cwd: process.cwd(),
    provider: claudeCodeProvider(),
  };
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return String(pkg.version);
}

/**
 * Parses argv, dispatches to the matching command and maps errors to exit codes: 0 ok, 1 usage,
 * 2 not found, 3 task file parse error (printing file and line). Never throws for user errors
 * and never calls process.exit, so tests can call it directly with a fake io.
 */
export async function main(argv: string[], io: Partial<MainIo> = {}): Promise<number> {
  const { out, err, cwd, provider } = { ...defaultIo(), ...io };

  let values: { json?: boolean; context?: boolean; backlog?: boolean; yes?: boolean;
    save?: boolean; repo?: string; session?: string; help?: boolean; version?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean' },
        context: { type: 'boolean' },
        backlog: { type: 'boolean' },
        yes: { type: 'boolean' },
        save: { type: 'boolean' },
        repo: { type: 'string' },
        session: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    err(`ledge: ${(error as Error).message}`);
    err(renderHelp());
    return EXIT.usage;
  }

  if (values.version) {
    out(version());
    return EXIT.ok;
  }
  const name = positionals[0] ?? 'list';
  if (values.help || name === 'help') {
    const target = name === 'help' ? positionals[1] : positionals[0];
    out(target ? renderCommandHelp(target) : renderHelp());
    return EXIT.ok;
  }

  const runner = COMMANDS[name];
  if (!runner) {
    err(`ledge: unknown command "${name}"`);
    err(renderHelp());
    return EXIT.usage;
  }

  const flags: Flags = {
    json: values.json ?? false,
    context: values.context ?? false,
    backlog: values.backlog ?? false,
    yes: values.yes ?? false,
    save: values.save ?? false,
    repo: values.repo,
    session: values.session,
  };
  const ctx: CommandContext = { args: positionals.slice(1), flags, cwd, out, err, provider };

  try {
    return await runner(ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`ledge: ${error.message}`);
      err(renderCommandHelp(error.command));
      return EXIT.usage;
    }
    if (error instanceof NotFoundError) {
      err(`ledge: ${error.message}`);
      return EXIT.notFound;
    }
    if (error instanceof TaskParseError) {
      const where = error.line === undefined ? error.file : `${error.file}:${error.line}`;
      err(`ledge: cannot parse task file ${where}`);
      err(`  ${error.message}`);
      return EXIT.parse;
    }
    err(`ledge: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.usage;
  }
}
