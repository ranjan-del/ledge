import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';

/**
 * Where a released Ledge lands on each platform, in the order worth trying. `LEDGE_APP` names
 * one explicitly and skips the search, for an installation somewhere unusual and so a test can
 * decide what is installed instead of depending on the machine it runs on.
 */
function candidates(): string[] {
  const explicit = process.env.LEDGE_APP;
  if (explicit) return [explicit];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  switch (platform()) {
    case 'darwin':
      return ['/Applications/Ledge.app', join(home, 'Applications', 'Ledge.app')];
    case 'win32':
      return [
        join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Ledge', 'Ledge.exe'),
        join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Ledge', 'Ledge.exe'),
      ];
    default:
      return [
        '/usr/bin/ledge-desktop',
        '/usr/local/bin/ledge-desktop',
        join(home, '.local', 'bin', 'ledge-desktop'),
      ];
  }
}

/**
 * `ledge app`: starts the desktop panel, detached, so closing the terminal does not take it
 * with it. This exists because the panel is meant to be running all the time and there was no
 * way to start it from a terminal: you either clicked it in the dock or let the login item do
 * it. It also gives someone who turned launch at login off a one word way back in.
 *
 * It looks for a released build rather than a development one. A development build has to come
 * from the repository with its own toolchain, and pretending otherwise would fail confusingly,
 * so when nothing is installed this says exactly what to do instead of guessing.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const found = candidates().find((p) => existsSync(p));
  if (!found) {
    ctx.err('ledge: the desktop app is not installed.');
    ctx.err('');
    ctx.err('Install a release from https://github.com/ranjan-del/ledge/releases,');
    ctx.err('or build one from a clone of the repository:');
    ctx.err('  npm install && npm run desktop:build');
    return EXIT.notFound;
  }

  const child =
    platform() === 'darwin'
      ? spawn('open', ['-a', found], { detached: true, stdio: 'ignore' })
      : spawn(found, [], { detached: true, stdio: 'ignore' });
  child.unref();

  if (!ctx.flags.json) ctx.out(`Started ${found}`);
  else ctx.out(JSON.stringify({ started: found }, null, 2));
  return EXIT.ok;
}
