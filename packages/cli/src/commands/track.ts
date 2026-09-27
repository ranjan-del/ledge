import { resolve } from 'node:path';
import { trackSession } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT, UsageError } from '../context.ts';
import { toJson } from '../format.ts';
import { openStore } from '../store.ts';

/**
 * `ledge track --session <id> [--transcript <path>] [--cwd <dir>] [--ended]`: writes what a hook
 * can see about a session without asking any model. SessionStart runs it to create the record
 * skeleton (started, repo, transcript), and SessionEnd runs it with --ended. Without --ended an
 * earlier end mark is cleared, since a session that starts again has been resumed. Silent
 * unless --json, because its callers are hooks.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const sessionId = ctx.flags.session;
  if (!sessionId) throw new UsageError('track needs --session <id>', 'track');
  const store = openStore();
  const record = trackSession(
    {
      sessionId,
      cwd: resolve(ctx.cwd, ctx.flags.dir ?? ctx.cwd),
      transcriptPath: ctx.flags.transcript ? resolve(ctx.cwd, ctx.flags.transcript) : undefined,
      ended: ctx.flags.ended,
    },
    { home: store.home },
  );
  if (ctx.flags.json) ctx.out(toJson(record));
  return EXIT.ok;
}
