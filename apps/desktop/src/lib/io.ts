/**
 * Thin typed wrappers over the Tauri fs and shell plugins. Everything the store touches on
 * disk or in a subprocess goes through here so tests can mock two modules and nothing else.
 */
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  rename,
  stat,
  watch,
  writeTextFile,
  type WatchEvent,
} from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';

export interface DirEntryLite {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** Reads a UTF-8 text file at an absolute path. */
export function readText(path: string): Promise<string> {
  return readTextFile(path);
}

/** Writes a UTF-8 text file at an absolute path, replacing any existing content. */
export function writeText(path: string, contents: string): Promise<void> {
  return writeTextFile(path, contents);
}

/** Lists a directory's immediate children. Returns an empty list when unreadable. */
export async function listDir(path: string): Promise<DirEntryLite[]> {
  try {
    const entries = await readDir(path);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory, isFile: e.isFile }));
  } catch {
    return [];
  }
}

/** True when the path exists. Errors (for example, a forbidden scope) count as absent. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/** Creates a directory and any missing parents. Silently succeeds if it already exists. */
export async function ensureDir(path: string): Promise<void> {
  if (!(await pathExists(path))) await mkdir(path, { recursive: true });
}

/** Moves a file within the store (used when a task is marked done). */
export function moveFile(from: string, to: string): Promise<void> {
  return rename(from, to);
}

/** Modification time of a path as ISO, or undefined when unavailable. */
export async function mtimeIso(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    return info.mtime ? new Date(info.mtime).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

export type ChangeHandler = (paths: string[]) => void;

/**
 * Watches the given paths with the plugin's own debounce and forwards changed paths.
 * The plugin's `watch` is debounced natively; the store adds its own 150 ms coalescing so
 * bursts from editors that write temp files and rename still parse each file once.
 */
export async function watchPaths(
  paths: string[],
  onChange: ChangeHandler,
  delayMs: number,
): Promise<() => void> {
  const unwatch = await watch(
    paths,
    (event: WatchEvent) => {
      if (event.paths.length > 0) onChange(event.paths);
    },
    { delayMs, recursive: false },
  );
  return unwatch;
}

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `git -C <repo> status --porcelain=v2 --branch`. The argument shape must match the
 * `git` entry in `src-tauri/capabilities/default.json` exactly or the shell plugin refuses.
 */
export async function gitStatus(repo: string): Promise<GitResult> {
  const out = await Command.create('git', [
    '-C',
    repo,
    'status',
    '--porcelain=v2',
    '--branch',
  ]).execute();
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}

/**
 * Runs one of the allow-listed terminal launchers by capability name with the given args.
 * Resolves when the launcher process exits (terminal apps detach immediately).
 */
export async function runAllowed(name: string, args: string[]): Promise<GitResult> {
  const out = await Command.create(name, args).execute();
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}
