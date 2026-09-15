import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TaskStore } from '@ledge/core';
import type { Task } from '@ledge/core';
import { NotFoundError } from './context.ts';

/**
 * Opens the task store at LEDGE_HOME and fails with a friendly hint when `ledge init` has not
 * been run yet. Every command except `init` goes through here so the message is consistent.
 */
export function openStore(): TaskStore {
  const store = new TaskStore();
  if (!existsSync(join(store.home, 'tasks'))) {
    throw new NotFoundError(`No Ledge store at ${store.home}. Run "ledge init" first.`);
  }
  return store;
}

/**
 * Fetches a task by id and converts the store's "missing task" error into a NotFoundError so
 * the exit code is 2 rather than a generic failure. Parse errors pass through untouched.
 */
export function requireTask(store: TaskStore, id: string): Task {
  try {
    return store.get(id);
  } catch (error) {
    if (error instanceof Error && error.name === 'TaskParseError') throw error;
    throw new NotFoundError(`Task not found: ${id}`);
  }
}

/**
 * Resolves a user-supplied repo path against the working directory. Core re-tildes absolute
 * paths on save, so the CLI always hands it an absolute path.
 */
export function resolveRepo(repo: string, cwd: string): string {
  return resolve(cwd, repo);
}
