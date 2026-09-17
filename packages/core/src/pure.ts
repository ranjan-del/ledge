/**
 * Browser-safe surface of @ledge/core, published as `@ledge/core/pure`. Every module reachable
 * from here is free of `node:` imports and of `process`, so a bundler can pull this into a
 * WebView without shims. The difference from the main entry is only where the environment comes
 * from: here the home folder, the base folder and the platform are arguments, while
 * `@ledge/core` fills the same arguments in from Node.
 *
 * Activity follows the same split: `rankByActivity`, `activeTask` and the constants behind them
 * are pure and exported here, while gathering the signals they rank needs a filesystem and so
 * lives in `@ledge/core` alone. A WebView caller gathers its own signals, shaped as
 * TaskActivity, and ranks them with these functions.
 *
 * The inference layer follows the same split: the Provider contract, the prompt builders and
 * the observed-facts view are pure and exported here, while the one provider that runs a
 * program is exported from `@ledge/core` alone.
 */
export type { TaskStatus, ChecklistItem, NoteEntry, Task, Config, RepoStatus } from './types.ts';
export type { SessionRef, MemoryEntry, NextAction, SurfaceCounts } from './types.ts';
export { TaskParseError } from './types.ts';
export type { TaskPaths } from './task-file.ts';
export { formatIso, parseTask, serializeTask, slugify, taskFileName } from './task-file.ts';
export { parsePorcelainV2, isPending } from './porcelain.ts';
export { buildResumePrompt } from './prompt.ts';
export type { AskResult, Provider, AskContext } from './ai.ts';
export type { Observed, ObservedTask, ObservedRepo } from './ai.ts';
export {
  DEFAULT_NOTES_PER_TASK,
  buildAskPrompt,
  buildHandoffPrompt,
  buildStandupPrompt,
  observedFacts,
  renderAskContext,
  sanitizeForNote,
} from './ai.ts';
export { defaultConfig } from './defaults.ts';
export { isoDay, isIsoDay, shiftDay, plannedFor, appendNote, setPlan } from './planning.ts';
export { expandTilde, collapseTilde } from './tilde.ts';
export type { GitSnapshot, Snapshot, WorkEvidence } from './evidence.ts';
export { evidenceOfWork, snapshotOfTask } from './evidence.ts';
export {
  sessionsFor,
  memoryFor,
  searchMemory,
  nextActionFor,
  surfaceCounts,
} from './surfaces.ts';
export type { ActivitySignal, TaskActivity, ActivityRank } from './activity.ts';
export {
  ACTIVE_WINDOW_MS,
  ACTIVITY_HALF_LIFE_MS,
  ACTIVITY_HORIZON_MS,
  SIGNAL_WEIGHT,
  activeTask,
  claudeProjectDirName,
  explainActivity,
  formatAge,
  rankByActivity,
  rankWithEvidence,
} from './activity.ts';
