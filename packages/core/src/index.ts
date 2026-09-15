/**
 * Public surface of @ledge/core (plan Contract 2). The CLI imports only from here; keeping one
 * barrel means the contract is visible in a single file and internal module boundaries can move
 * without touching consumers.
 *
 * Everything `@ledge/core/pure` exports is exported here too, under the same names and with the
 * same parameters. The only difference is that the environment arguments (home folder, base
 * folder, platform) are optional here and default to what Node reports, which is why the
 * desktop app, which has no Node, imports the pure entry instead.
 */
export type { TaskStatus, ChecklistItem, Task, Config, RepoStatus } from './types.ts';
export { TaskParseError } from './types.ts';
export {
  ledgeHome,
  defaultConfig,
  loadConfig,
  saveConfig,
  expandTilde,
  collapseTilde,
} from './config.ts';
export type { TaskPaths } from './task-file.ts';
export { parseTask, serializeTask } from './task-file-node.ts';
export { slugify, taskFileName } from './task-file.ts';
export { TaskStore, matchRepo } from './store.ts';
export { parsePorcelainV2, findRepos, scanRepos, isPending } from './git.ts';
export { buildResumePrompt } from './prompt.ts';
