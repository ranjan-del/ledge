/**
 * Shared types for @ledge/core. Everything here is a plain data shape so the same code runs in
 * the CLI (Node) and in the desktop app (browser bundle). No runtime values live in this file
 * except TaskParseError, which must be a real class so callers can `instanceof` it.
 */

export type TaskStatus = 'current' | 'backlog' | 'done';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

/**
 * One dated entry under `## Notes`. Notes are the session memory: the reasoning, the decisions
 * and the dead ends that the checklist cannot carry. Newest last, one entry per calendar day.
 */
export interface NoteEntry {
  /** Calendar day, `YYYY-MM-DD`, taken from the `### ` subheading. */
  date: string;
  /** Markdown body of that day's note, trimmed. */
  body: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  order: number;
  /** Absolute path. `~` is expanded on load and re-tilded on save. */
  repo?: string;
  /** Claude Code session ids, newest last. */
  sessions: string[];
  /** ISO 8601 with offset, e.g. 2026-09-14T21:04:00+05:30. */
  created: string;
  updated: string;
  /** Reason the task was parked. Only meaningful when status is backlog. */
  parked?: string;
  /**
   * Calendar day the person intends to work on this, `YYYY-MM-DD`, no time and no zone. Absent
   * when nothing is planned; a malformed value in the file is dropped rather than thrown.
   */
  planned?: string;
  /** Markdown under `## Requirement`, trimmed. */
  requirement: string;
  /** Ordered steps under `## Plan`, the intent. Empty when the section is absent. */
  plan: string[];
  checklist: ChecklistItem[];
  /** Dated entries under `## Notes`, newest last. Empty when the section is absent. */
  notes: NoteEntry[];
  /** Anything after the known sections, trimmed and preserved verbatim. */
  extra: string;
  /** Absolute path of the .md file, '' when unsaved. */
  file: string;
  /**
   * Frontmatter keys Ledge does not know about, in their original order. Kept so that a person
   * or another tool can add their own keys and a round trip through Ledge does not drop them.
   * Undefined when the file had no unknown keys.
   */
  meta?: Record<string, unknown>;
}

export interface Config {
  roots: string[];
  scan: { intervalMinutes: number; maxDepth: number; ignore: string[]; staleDays: number };
  terminal: string;
  claude: { command: string; resumeFlag: string };
  ui: { edge: 'left' | 'right'; theme: 'system' | 'light' | 'dark'; y?: number };
}

export interface RepoStatus {
  /** Absolute path. */
  repo: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Porcelain v2 XY code per changed path; untracked files carry `??`. */
  dirty: { path: string; code: string }[];
  /** ISO timestamp taken from the .git/index mtime. */
  lastActivity: string;
}

/**
 * Error thrown when a task file cannot be parsed. Carries the file path and, when known, the
 * 1-based line number so the CLI can print "file:line" and the panel can show a warning badge
 * instead of crashing.
 */
export class TaskParseError extends Error {
  file: string;
  line?: number;

  constructor(message: string, file: string, line?: number) {
    super(message);
    this.name = 'TaskParseError';
    this.file = file;
    this.line = line;
  }
}
