import { resolve } from 'node:path';
import { logCapture, runCapture } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge capture --session <id> --transcript <path> [--cwd <dir>] [--final] [--force]`: reads
 * a Claude Code transcript, asks the fast model what the session amounted to, and keeps the
 * task and both sidecars current. The plugin's Stop, PreCompact and SessionEnd hooks start it
 * detached; a person runs it by hand only to debug, usually with --force.
 *
 * Debounced unless --final or --force: fewer than 40 new transcript lines and less than 10
 * minutes since the last capture is a skip, because the Stop hook fires after every turn.
 * Nothing is written when the model cannot be asked or answers with something that does not
 * check out. Every run, skipped or not, leaves one line in `$LEDGE_HOME/capture.log`.
 *
 * Exits 0 whatever the capture decided, and prints one line saying what that was, or the outcome
 * as JSON with --json. Only a missing flag is a usage error and only a missing store is exit 2.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const sessionId = ctx.flags.session;
  const transcript = ctx.flags.transcript;
  if (!sessionId) throw new UsageError('capture needs --session <id>', 'capture');
  if (!transcript) throw new UsageError('capture needs --transcript <path>', 'capture');
  const store = openStore();
  const cwd = resolve(ctx.cwd, ctx.flags.dir ?? ctx.cwd);
  let outcome;
  try {
    outcome = await runCapture({
      sessionId,
      transcriptPath: resolve(ctx.cwd, transcript),
      cwd,
      provider: ctx.fastProvider,
      final: ctx.flags.final,
      force: ctx.flags.force,
      home: store.home,
    });
  } catch (error) {
    // A bug, not a hook problem. It still goes in the log, because a detached capture has no
    // terminal to print it to, and the exit code stays 0 so a hook never reports a failure.
    const message = error instanceof Error ? error.message : String(error);
    logCapture(store.home, `failed session=${sessionId} task=- error: ${message}`);
    ctx.err(`ledge: capture failed: ${message}`);
    return EXIT.ok;
  }
  if (ctx.flags.json) {
    ctx.out(toJson(outcome));
    return EXIT.ok;
  }
  const task = outcome.taskId ? ` (${outcome.taskId}${outcome.created ? ', created' : ''})` : '';
  ctx.out(`Capture ${outcome.status}${task}: ${outcome.reason}`);
  return EXIT.ok;
}
