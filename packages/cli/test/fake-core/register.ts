// Swap mechanism for @ledge/core during tests.
//
// The CLI imports '@ledge/core' by bare specifier. While the real package is still being
// written, or when LEDGE_FAKE_CORE=1 is set, this file installs a synchronous module resolve
// hook (node:module registerHooks) that short-circuits '@ledge/core' to ./index.ts, the
// in-memory fake. When the real package resolves to a file that exists on disk, nothing is
// registered and the CLI runs against the real core. Tests must call useFakeCore() before
// dynamically importing anything from src/, because static imports are resolved before any
// test code runs.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const FAKE_URL = new URL('./index.ts', import.meta.url).href;

export type CoreKind = 'real' | 'fake';

let registered: CoreKind | undefined;

function realCoreAvailable(): boolean {
  try {
    const url = import.meta.resolve('@ledge/core');
    return url.startsWith('file:') && existsSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/**
 * Decides which @ledge/core the process will use and installs the resolve hook when the fake
 * is needed. Returns 'real' when the workspace package resolves to an existing file and the
 * LEDGE_FAKE_CORE override is not set, otherwise 'fake'. Idempotent: calling it twice does not
 * register the hook twice.
 */
export function useFakeCore(): CoreKind {
  if (registered) return registered;
  const forceFake = process.env.LEDGE_FAKE_CORE === '1';
  if (!forceFake && realCoreAvailable()) {
    registered = 'real';
    return registered;
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@ledge/core') {
        return { url: FAKE_URL, format: 'module-typescript', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  registered = 'fake';
  return registered;
}
