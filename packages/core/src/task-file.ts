/**
 * Reading and writing of task files (YAML frontmatter plus a Markdown body). No Node imports:
 * the home folder used to expand `~` and the base folder a relative `repo` resolves against are
 * passed in, so the CLI and the desktop WebView share this code. @ledge/core's Node entry fills
 * both in from the operating system (see ./task-file-node.ts).
 */
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { collapseTilde, expandTilde, resolvePath } from './tilde.ts';
import { TaskParseError } from './types.ts';
import type { ChecklistItem, Task, TaskStatus } from './types.ts';

/**
 * Where a task file's `repo` path is anchored. `home` expands and collapses a leading `~`, and
 * `base` is what a relative repo path resolves against. Both default to empty, which means
 * "unknown": the path is then kept exactly as the file spells it.
 */
export interface TaskPaths {
  home?: string;
  base?: string;
}

const STATUSES: readonly TaskStatus[] = ['current', 'backlog', 'done'];
const KNOWN_KEYS = new Set([
  'id',
  'title',
  'status',
  'order',
  'repo',
  'sessions',
  'created',
  'updated',
  'parked',
]);
const REQUIREMENT_HEADING = '## Requirement';
const CHECKLIST_HEADING = '## Checklist';
const CHECKLIST_ITEM = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a Date as ISO 8601 in local time with a numeric offset and second precision, e.g.
 * `2026-09-14T21:04:00+05:30`. Task files use this shape (spec section 2) because it stays
 * readable in an editor and sorts lexically within one time zone.
 */
export function formatIso(date: Date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

interface Frontmatter {
  data: Record<string, unknown>;
  /** Index of the first body line, 0-based within the file. */
  bodyStart: number;
}

function splitFrontmatter(lines: string[], file: string): Frontmatter {
  if (lines[0]?.trim() !== '---') {
    throw new TaskParseError('Task file must start with a --- frontmatter block', file, 1);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new TaskParseError('Frontmatter is not closed with ---', file, 1);
  const yamlText = lines.slice(1, end).join('\n');
  let data: unknown;
  try {
    data = yamlText.trim() === '' ? {} : parseYaml(yamlText);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const line = (err.linePos?.[0]?.line ?? 1) + 1;
      throw new TaskParseError(`Invalid YAML frontmatter: ${err.message.trim()}`, file, line);
    }
    throw new TaskParseError(`Invalid YAML frontmatter: ${String(err)}`, file, 2);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TaskParseError('Frontmatter must be a YAML mapping', file, 2);
  }
  return { data: data as Record<string, unknown>, bodyStart: end + 1 };
}

function requireString(data: Record<string, unknown>, key: string, file: string): string {
  const v = data[key];
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number') return String(v);
  throw new TaskParseError(`Frontmatter key "${key}" is required and must be text`, file, 2);
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

interface Body {
  requirement: string;
  checklist: ChecklistItem[];
  extra: string;
}

function parseBody(lines: string[]): Body {
  type State = 'preamble' | 'requirement' | 'checklist' | 'extra';
  let state: State = 'preamble';
  const requirement: string[] = [];
  const checklist: ChecklistItem[] = [];
  const extra: string[] = [];
  let sawRequirement = false;
  let sawChecklist = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawRequirement && trimmed === REQUIREMENT_HEADING) {
      state = 'requirement';
      sawRequirement = true;
      continue;
    }
    if (!sawChecklist && trimmed === CHECKLIST_HEADING) {
      state = 'checklist';
      sawChecklist = true;
      continue;
    }
    switch (state) {
      case 'requirement':
        if (trimmed.startsWith('## ')) {
          state = 'extra';
          extra.push(line);
        } else {
          requirement.push(line);
        }
        break;
      case 'checklist': {
        const m = CHECKLIST_ITEM.exec(line);
        if (m) {
          checklist.push({ text: m[2]!.trim(), done: m[1]!.toLowerCase() === 'x' });
        } else if (trimmed === '') {
          // Blank lines inside the checklist are layout, not content.
        } else {
          state = 'extra';
          extra.push(line);
        }
        break;
      }
      default:
        extra.push(line);
    }
  }
  return {
    requirement: requirement.join('\n').trim(),
    checklist,
    extra: extra.join('\n').trim(),
  };
}

/**
 * Parses one task file (YAML frontmatter plus Markdown body) into a Task. Validates the fields
 * Ledge depends on, expands `~` in `repo`, keeps unknown frontmatter keys in `meta`, and splits
 * the body into requirement, checklist and extra text. Throws TaskParseError with the file path
 * and line so callers can report exactly where a hand-edited file went wrong. `paths` says where
 * a `~` and a relative repo path are anchored; with the default empty paths the repo string is
 * kept exactly as the file spells it.
 */
export function parseTask(markdown: string, file: string = '', paths: TaskPaths = {}): Task {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const { data, bodyStart } = splitFrontmatter(lines, file);

  const id = requireString(data, 'id', file);
  const title = requireString(data, 'title', file);
  const status = requireString(data, 'status', file) as TaskStatus;
  if (!STATUSES.includes(status)) {
    throw new TaskParseError(
      `Frontmatter key "status" must be one of ${STATUSES.join(', ')}, got "${status}"`,
      file,
      2,
    );
  }
  const orderRaw = data.order;
  const order = typeof orderRaw === 'number' ? orderRaw : Number(orderRaw);
  if (!Number.isFinite(order)) {
    throw new TaskParseError('Frontmatter key "order" must be a number', file, 2);
  }

  const sessionsRaw = data.sessions;
  let sessions: string[] = [];
  if (Array.isArray(sessionsRaw)) sessions = sessionsRaw.map((s) => String(s));
  else if (sessionsRaw !== undefined && sessionsRaw !== null) {
    throw new TaskParseError('Frontmatter key "sessions" must be a list', file, 2);
  }

  const created = optionalString(data, 'created') ?? formatIso();
  const updated = optionalString(data, 'updated') ?? created;
  const repoRaw = optionalString(data, 'repo');
  const repo =
    repoRaw === undefined
      ? undefined
      : resolvePath(expandTilde(repoRaw, paths.home ?? ''), paths.base ?? '');
  const parked = optionalString(data, 'parked');

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) meta[key] = value;
  }

  const body = parseBody(lines.slice(bodyStart));
  const task: Task = {
    id,
    title,
    status,
    order,
    sessions,
    created,
    updated,
    requirement: body.requirement,
    checklist: body.checklist,
    extra: body.extra,
    file,
  };
  if (repo !== undefined) task.repo = repo;
  if (parked !== undefined) task.parked = parked;
  if (Object.keys(meta).length > 0) task.meta = meta;
  return task;
}

/**
 * Serializes a Task back to the file format, the exact inverse of parseTask. Known frontmatter
 * keys come first in the documented order, then any `meta` keys in their original order; `repo`
 * is written with `~` for paths under the home folder. Both headings are always emitted so
 * Claude Code always has a place to write. Output ends with a single newline. `paths.home` is
 * the folder the `~` stands for; without it an absolute repo path is written as it is.
 */
export function serializeTask(task: Task, paths: TaskPaths = {}): string {
  const front: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    order: task.order,
  };
  if (task.repo !== undefined) front.repo = collapseTilde(task.repo, paths.home ?? '');
  front.sessions = task.sessions.map((s) => String(s));
  front.created = task.created;
  front.updated = task.updated;
  if (task.parked !== undefined) front.parked = task.parked;
  for (const [key, value] of Object.entries(task.meta ?? {})) {
    if (!KNOWN_KEYS.has(key)) front[key] = value;
  }
  const yamlText = stringifyYaml(front, { lineWidth: 0, indentSeq: true }).trimEnd();

  const parts: string[] = ['---', yamlText, '---', '', REQUIREMENT_HEADING, ''];
  if (task.requirement.trim() !== '') parts.push(task.requirement.trim(), '');
  parts.push(CHECKLIST_HEADING, '');
  for (const item of task.checklist) {
    parts.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (task.checklist.length > 0) parts.push('');
  if (task.extra.trim() !== '') parts.push(task.extra.trim(), '');
  return parts.join('\n').replace(/\n+$/, '\n');
}

/**
 * Turns a title into a stable, filename-safe id: lower-case ASCII letters and digits joined by
 * single hyphens, diacritics stripped, at most 60 characters, never empty. The id is the
 * identity of a task for its whole life, so it must be safe on every filesystem and in URLs.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'task' : slug;
}

/**
 * Builds the file name for a task: `YYYY-MM-DD-<id>.md` where the date is taken from `created`.
 * Putting the date first keeps the tasks folder sorted chronologically in any file browser
 * while the id part keeps the name meaningful.
 */
export function taskFileName(task: Pick<Task, 'id' | 'created'>): string {
  return `${task.created.slice(0, 10)}-${task.id}.md`;
}
