/**
 * Config loading and saving, plus the Node-bound wrappers over the pure helpers in ./tilde.ts
 * and ./defaults.ts. Every function here keeps the signature it always had: the environment
 * arguments are optional and default to what this machine reports.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig as defaultConfigFor } from './defaults.ts';
import { collapseTilde as collapseTildeIn, expandTilde as expandTildeIn } from './tilde.ts';
import type { Config } from './types.ts';

/**
 * Returns the Ledge home folder: `$LEDGE_HOME` when set, otherwise `~/.ledge`. Every read and
 * write in core goes through this so tests can point the whole library at a temp folder and
 * never touch the real store.
 */
export function ledgeHome(): string {
  const env = process.env.LEDGE_HOME;
  if (env && env.trim() !== '') return expandTilde(env);
  return join(homedir(), '.ledge');
}

/**
 * Expands a leading `~` or `~/` to a home folder, this machine's by default. Task files and
 * config store paths with a tilde so the same file reads naturally anywhere; code always works
 * with absolute paths, so expansion happens once at load time.
 */
export function expandTilde(p: string, home: string = homedir()): string {
  return expandTildeIn(p, home);
}

/**
 * Inverse of expandTilde: turns an absolute path inside the home folder back into the `~/...`
 * form used inside files. Paths outside the home folder are returned unchanged.
 */
export function collapseTilde(p: string, home: string = homedir()): string {
  return collapseTildeIn(p, home);
}

/**
 * Builds a fresh default Config for a platform, this machine's by default. Called for every
 * load so callers can mutate the result freely, and so `loadConfig` can deep-merge a partial
 * file over a complete baseline (spec section 8: missing keys get defaults without rewriting
 * the file).
 */
export function defaultConfig(platformName: string = platform()): Config {
  return defaultConfigFor(platformName);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) {
    return (over === undefined ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out as T;
}

/**
 * Reads `<home>/config.json`, deep-merging it over `defaultConfig()`. A missing file yields the
 * defaults; the file is never created or rewritten here, so a person who has not customised
 * anything keeps an untouched store. Invalid JSON throws an Error naming the file.
 */
export function loadConfig(home: string = ledgeHome()): Config {
  const file = join(home, 'config.json');
  const defaults = defaultConfig();
  if (!existsSync(file)) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${file}: ${reason}`);
  }
  if (!isPlainObject(parsed)) throw new Error(`Expected an object in ${file}`);
  return deepMerge(defaults, parsed);
}

/**
 * Writes the full Config to `<home>/config.json` as two-space indented JSON with a trailing
 * newline, creating the folder when needed. Used by `ledge init` and by the app when a person
 * changes a setting, which are the only two moments the file is allowed to change.
 */
export function saveConfig(config: Config, home: string = ledgeHome()): void {
  const dir = resolve(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}
