/**
 * Public surface of @ledge/core (plan Contract 2). The CLI imports only from here; keeping one
 * barrel means the contract is visible in a single file and internal module boundaries can move
 * without touching consumers.
 *
 * Everything `@ledge/core/pure` exports is exported here too, under the same names and with the
 * same parameters. The only difference is that the environment arguments (home folder, base
 * folder, platform) are optional here and default to what Node reports, which is why the
 * desktop app, which has no Node, imports the pure entry instead.
 *
 * The activity layer splits the same way: the ranking is pure and lives in both entries, while
 * `collectActivity`, which reads the session transcript folder and the repositories, is here
 * only, because a WebView cannot stat a file.
 *
 * The one asymmetry is the inference layer. The provider contract and the prompt builders are
 * pure and live in both entries; `claudeCodeProvider`, which starts a child process, is here
 * only, because a WebView has nothing to start.
 */
export type { TaskStatus, ChecklistItem, NoteEntry, Task, Config, RepoStatus } from './types.ts';
export type { SessionRef, MemoryEntry, NextAction, SurfaceCounts } from './types.ts';
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
export { formatIso, slugify, taskFileName } from './task-file.ts';
export { TaskStore, matchRepo } from './store.ts';
export { parsePorcelainV2, findRepos, scanRepos, isPending } from './git.ts';
export { isoDay, isIsoDay, shiftDay, plannedFor, appendNote, setPlan } from './planning.ts';
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
export { claudeCodeProvider } from './ai-node.ts';
export type { ClaudeCodeOptions } from './ai-node.ts';
export type { GitSnapshot, Snapshot, WorkEvidence } from './evidence.ts';
export { evidenceOfWork, snapshotOfTask } from './evidence.ts';
export { gitSnapshot, takeSnapshot } from './evidence-node.ts';
export type { IntentRecord, IntentOptions } from './intent.ts';
export {
  INTENT_TTL_MS,
  clearIntent,
  intentFor,
  readIntents,
  recordIntent,
  updateIntent,
} from './intent.ts';
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
export type { ActivityOptions } from './activity-node.ts';
export { collectActivity } from './activity-node.ts';
