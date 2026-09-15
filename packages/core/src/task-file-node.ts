/**
 * The Node layer over ./task-file.ts: the same two functions with the operating system filled
 * in. Callers who say nothing get `~` expanded against the current user's home folder and a
 * relative `repo` resolved against the working directory, exactly as @ledge/core always has.
 */
import { homedir } from 'node:os';
import { parseTask as parseTaskPure, serializeTask as serializeTaskPure } from './task-file.ts';
import type { TaskPaths } from './task-file.ts';
import type { Task } from './types.ts';

function nodePaths(paths: TaskPaths): TaskPaths {
  return { home: paths.home ?? homedir(), base: paths.base ?? process.cwd() };
}

/**
 * Parses one task file into a Task, anchoring its `repo` path to this machine. See parseTask in
 * ./task-file.ts for the parsing rules; the only difference is that `paths.home` defaults to the
 * current user's home folder and `paths.base` to the working directory.
 */
export function parseTask(markdown: string, file: string = '', paths: TaskPaths = {}): Task {
  return parseTaskPure(markdown, file, nodePaths(paths));
}

/**
 * Serializes a Task back to the file format, writing `repo` with a `~` for paths under this
 * machine's home folder. See serializeTask in ./task-file.ts; the only difference is the default
 * for `paths.home`.
 */
export function serializeTask(task: Task, paths: TaskPaths = {}): string {
  return serializeTaskPure(task, nodePaths(paths));
}
