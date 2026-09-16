/**
 * Browser-safe surface of @ledge/core, published as `@ledge/core/pure`. Every module reachable
 * from here is free of `node:` imports and of `process`, so a bundler can pull this into a
 * WebView without shims. The difference from the main entry is only where the environment comes
 * from: here the home folder, the base folder and the platform are arguments, while
 * `@ledge/core` fills the same arguments in from Node.
 */
export type { TaskStatus, ChecklistItem, NoteEntry, Task, Config, RepoStatus } from './types.ts';
export type { SessionRef, MemoryEntry, NextAction, SurfaceCounts } from './types.ts';
export { TaskParseError } from './types.ts';
export type { TaskPaths } from './task-file.ts';
export { parseTask, serializeTask, slugify, taskFileName } from './task-file.ts';
export { parsePorcelainV2, isPending } from './porcelain.ts';
export { buildResumePrompt } from './prompt.ts';
export { defaultConfig } from './defaults.ts';
export { isoDay, isIsoDay, shiftDay, plannedFor, appendNote, setPlan } from './planning.ts';
export { expandTilde, collapseTilde } from './tilde.ts';
export {
  sessionsFor,
  memoryFor,
  searchMemory,
  nextActionFor,
  surfaceCounts,
} from './surfaces.ts';
