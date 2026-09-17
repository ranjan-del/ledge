/**
 * Reading and writing of task files (YAML frontmatter plus a Markdown body). No Node imports:
 * the home folder used to expand `~` and the base folder a relative `repo` resolves against are
 * passed in, so the CLI and the desktop WebView share this code. @ledge/core's Node entry fills
 * both in from the operating system (see ./task-file-node.ts).
 */
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { isIsoDay } from './planning.ts';
import { collapseTilde, expandTilde, resolvePath } from './tilde.ts';
import { TaskParseError } from './types.ts';
import type { ChecklistItem, NoteEntry, Task, TaskStatus } from './types.ts';

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

/**
 * Words people and assistants actually write in `status:`, mapped to the three values that
 * exist. The keys are already normalised: lower case, surrounding quotes gone, and every run of
 * spaces, hyphens or underscores collapsed to one space, so `In-Progress`, `in_progress` and
 * `"in progress"` all arrive here as `in progress`.
 *
 * This table exists because of what a rejection costs. A task whose status cannot be read
 * disappears from every view, and the person is left with a parse banner instead of the work
 * they did. Where the intent is unambiguous, honouring it and writing the canonical value back
 * on the next save is kinder than being right.
 *
 * The table is deliberately short. Words that name a state Ledge does not have (`review`,
 * `ready`, `todo`, `next`, `on hold`) or that could mean either of two lists (`cancelled`,
 * `abandoned`, `archived`, `pending`, `open`) are not here and still raise, because guessing
 * silently is worse than an error a person can see and fix.
 */
const STATUS_ALIASES: Record<string, TaskStatus> = {
  'in progress': 'current',
  inprogress: 'current',
  active: 'current',
  doing: 'current',
  started: 'current',
  wip: 'current',
  parked: 'backlog',
  waiting: 'backlog',
  blocked: 'backlog',
  later: 'backlog',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  closed: 'done',
};
const KNOWN_KEYS = new Set([
  'id',
  'title',
  'status',
  'order',
  'repo',
  'planned',
  'sessions',
  'created',
  'updated',
  'parked',
]);
const REQUIREMENT_HEADING = '## Requirement';
const PLAN_HEADING = '## Plan';
const CHECKLIST_HEADING = '## Checklist';
const REFERENCES_HEADING = '## References';
const NOTES_HEADING = '## Notes';
const CHECKLIST_ITEM = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
const PLAN_ITEM = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/;
/** An indented line that starts no new item, so it is the wrapped tail of the item above. */
const CONTINUATION = /^\s+\S/;
const NOTE_HEADING = /^###\s+(.+)$/;
const SECTION_HEADING = /^##\s+(.+)$/;
/**
 * The opening or closing line of a fenced code block: up to three spaces of indent, then three
 * or more backticks or tildes, then whatever follows. The capture groups are the run of fence
 * characters and the rest of the line, which is the info string on an opening fence and must be
 * empty on a closing one.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Reads a `status` value written by a person, an assistant or another tool and returns the
 * canonical `current`, `backlog` or `done`, or undefined when the value names nothing Ledge
 * knows. Surrounding whitespace and quotes are dropped, case is ignored, and spaces, hyphens and
 * underscores are treated alike, so `"In-Progress"` is the same as `in progress`.
 *
 * It is exported because the alias table is a contract of its own: the CLI, the plugin text and
 * the desktop app all need to be able to say what will be accepted, and a table nobody can read
 * is a table nobody can trust. What it refuses is listed on STATUS_ALIASES above.
 */
export function normalizeStatus(value: unknown): TaskStatus | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const cleaned = String(value)
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  if ((STATUSES as readonly string[]).includes(cleaned)) return cleaned as TaskStatus;
  return STATUS_ALIASES[cleaned];
}

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
  plan: string[];
  checklist: ChecklistItem[];
  references: string;
  notes: NoteEntry[];
  extra: string;
}

/** One `## ` section of the body: its heading line verbatim, and the lines under it. */
interface Section {
  /** The heading line exactly as written, or '' for the text before the first heading. */
  raw: string;
  /** The trimmed heading text, or '' for the preamble. */
  heading: string;
  lines: string[];
}

/** A fenced code block that is currently open: which character opened it, and how many of it. */
interface Fence {
  /** The fence character, a backtick or a tilde. */
  char: string;
  /** How many of it opened the fence. A closing fence needs at least as many. */
  length: number;
}

/**
 * Reads a line as the opening of a fenced code block, or returns undefined. CommonMark's rules,
 * the parts that matter here: up to three spaces of indent, three or more backticks or tildes,
 * then an optional info string such as `ts` or `md`. A backtick fence may not carry a backtick
 * in its info string, since that is what tells a fence from an inline code span; a tilde fence
 * may carry anything, backticks included.
 */
function opensFence(line: string): Fence | undefined {
  const m = FENCE.exec(line);
  if (!m) return undefined;
  const marker = m[1]!;
  if (marker.startsWith('`') && m[2]!.includes('`')) return undefined;
  return { char: marker[0]!, length: marker.length };
}

/**
 * True when `line` closes `fence`: the same fence character, at least as many of it as opened
 * the block, and nothing after it but whitespace. A fence opened with four backticks is closed
 * by four or more and not by three, which is how a fence that contains a fence is written.
 */
function closesFence(line: string, fence: Fence): boolean {
  const m = FENCE.exec(line);
  if (!m) return false;
  const marker = m[1]!;
  return marker[0] === fence.char && marker.length >= fence.length && m[2]!.trim() === '';
}

/**
 * Marks every line a fenced code block covers, its opening and closing delimiters included, so
 * that one pass is the single authority on where a fence is for both the splitter and the
 * References encoding below.
 *
 * A delimiter that never finds its closer is NOT a fence. CommonMark says an unterminated fence
 * runs to the end of the document, and honouring that here would let one stray ``` in a paste
 * swallow every section under it: the `## Notes` the serializer itself wrote would become part
 * of the paste and the notes would be gone. A task file is a structured document first, so a
 * fence has to be closed to count, and an opener with no closer is read as the text it is.
 */
function fencedLines(lines: string[]): boolean[] {
  const fenced: boolean[] = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const open = opensFence(lines[i]!);
    if (open === undefined) {
      i++;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closesFence(lines[j]!, open)) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      i++;
      continue;
    }
    for (let k = i; k <= close; k++) fenced[k] = true;
    i = close + 1;
  }
  return fenced;
}

/**
 * Cuts the body into `## ` sections in file order. Splitting first, then interpreting, is what
 * makes section order in the file irrelevant: the parser can accept Requirement, Plan, Checklist,
 * References and Notes in any arrangement and the serializer still writes them in the fixed
 * order.
 *
 * WHAT IT REFUSES TO TREAT AS A BOUNDARY. A line inside a fenced code block, however exactly it
 * looks like a heading. `## Plan` written inside a ``` or ~~~ block is content of that block and
 * nothing else, and the same goes for a fence opened with four or more characters, which only a
 * run of at least that many closes. This used to be a real loss rather than a nicety: a paste
 * carrying a fenced `## Plan` was read back as the task's OWN plan and everything after it
 * moved with it, silently rewriting a file nobody had edited.
 *
 * It equally refuses to let an unterminated fence run past the section it sits in: see
 * fencedLines above for why a fence has to be closed before it counts as one.
 *
 * The frontmatter delimiter cannot collide with any of this. A hyphen is not a fence character,
 * and the frontmatter has already been cut at its closing `---` before these lines are seen, so
 * a `---` inside a fenced block in the body is only ever content.
 */
function splitSections(lines: string[]): Section[] {
  const fenced = fencedLines(lines);
  const sections: Section[] = [{ raw: '', heading: '', lines: [] }];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!fenced[i] && SECTION_HEADING.test(trimmed)) {
      sections.push({ raw: line, heading: trimmed, lines: [] });
    } else {
      sections[sections.length - 1]!.lines.push(line);
    }
  });
  return sections;
}

/**
 * Drops blank lines from both ends of a block. Unlike a plain `trim` it never touches the inside
 * of a line, so the leading spaces of an indented first line survive. That matters for
 * `## References`, which holds pasted material: a stack trace begins with its indentation, and
 * eating it would be the parser editing what it was handed.
 */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end);
}

/**
 * A line of `## References` carrying an optional run of backslashes before a `## ` heading, and
 * the same before a fence delimiter. These two families are the only things in a free-form
 * section that the reader of the file can act on, so they are the only things written with an
 * escape. The already-escaped forms are in the family on purpose: a line somebody really pasted
 * as `\## Plan` gains a backslash of its own, which is what keeps the encoding reversible
 * instead of eating theirs.
 */
const ESCAPABLE_HEADING = /^(\s*)(\\*##\s+\S.*)$/;
const ESCAPABLE_FENCE = /^( {0,3})(\\*(?:`{3,}|~{3,}).*)$/;
const ESCAPED_HEADING = /^(\s*)\\(\\*##\s+\S.*)$/;
const ESCAPED_FENCE = /^( {0,3})\\(\\*(?:`{3,}|~{3,}).*)$/;

/**
 * Writes a References body so that the file gives it back unchanged, and nothing else in the
 * file is disturbed by it. Two kinds of line are escaped with a leading backslash, and only when
 * they sit outside a closed fence, so a real code block in a paste is left exactly as it is:
 *
 * - a `## ` heading, at any indentation, which the splitter would otherwise read as the end of
 *   the section. This is the one that bit: a pasted `## Plan` ended References there and the
 *   rest of the paste turned up in `extra`, with nobody told.
 * - a fence delimiter with no closer inside the body, which would otherwise reach out of the
 *   section and pair with a delimiter in a later one, swallowing the headings in between.
 *
 * A backslash before a hash is Markdown's own escape and renders as the literal text, so the
 * file still reads as what was pasted. It touches only the lines that need it, and unlike
 * quoting the whole block it takes nothing away from a paste that is already quoted.
 */
function encodeReferences(lines: string[]): string[] {
  const fenced = fencedLines(lines);
  return lines.map((line, i) => {
    if (fenced[i]) return line;
    const heading = ESCAPABLE_HEADING.exec(line);
    if (heading) return `${heading[1]}\\${heading[2]}`;
    const fence = ESCAPABLE_FENCE.exec(line);
    if (fence) return `${fence[1]}\\${fence[2]}`;
    return line;
  });
}

/**
 * Takes one backslash off the lines encodeReferences put one on, so the value a caller sees is
 * byte for byte what it passed in. It is an exact inverse: escaping never turns a line into a
 * fence delimiter or stops one from being part of a closed fence, so the fences of the encoded
 * block and of the original are the same fences, and both passes make the same decision on the
 * same line.
 */
function decodeReferences(lines: string[]): string[] {
  const fenced = fencedLines(lines);
  return lines.map((line, i) => {
    if (fenced[i]) return line;
    const heading = ESCAPED_HEADING.exec(line);
    if (heading) return `${heading[1]}${heading[2]}`;
    const fence = ESCAPED_FENCE.exec(line);
    if (fence) return `${fence[1]}${fence[2]}`;
    return line;
  });
}

/**
 * Steps in a `## Plan` section, in file order, blank lines ignored. A bulleted list is read as
 * well as a numbered one and is renumbered on save: the contract asks for an ordered list, and
 * being strict on input would quietly move a hand-written plan into `extra`. A task-list item
 * is not a plan step, so `- [ ] x` is left for the checklist rules to deal with.
 */
function parsePlan(lines: string[]): string[] {
  const steps: string[] = [];
  for (const line of lines) {
    if (CHECKLIST_ITEM.test(line)) continue;
    const m = PLAN_ITEM.exec(line);
    if (m && m[1]!.trim() !== '') {
      steps.push(m[1]!.trim());
      continue;
    }
    // An indented line that is not a new item belongs to the step above it. Without this a
    // step wrapped across two lines loses its second line for good on the next save, which is
    // silent data loss in a file people hand-edit.
    if (steps.length > 0 && CONTINUATION.test(line)) {
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${line.trim()}`;
    }
  }
  return steps;
}

/**
 * Dated `### YYYY-MM-DD` subsections of a `## Notes` section. Lines before the first dated
 * subheading are handed back separately so the caller can keep them verbatim, and a `### ` line
 * that is not a date stays inside the body of the note it sits in, because a note is free prose.
 */
function parseNotes(lines: string[]): { notes: NoteEntry[]; before: string[] } {
  const notes: NoteEntry[] = [];
  const before: string[] = [];
  let current: { date: string; body: string[] } | undefined;
  for (const line of lines) {
    const m = NOTE_HEADING.exec(line.trim());
    const date = m?.[1]?.trim();
    if (date !== undefined && isIsoDay(date)) {
      if (current) notes.push({ date: current.date, body: current.body.join('\n').trim() });
      current = { date, body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      before.push(line);
    }
  }
  if (current) notes.push({ date: current.date, body: current.body.join('\n').trim() });
  return { notes, before };
}

/**
 * Reads the body sections into their fields. A known heading counts only on its first
 * appearance, and a `## Plan` with no ordered list or a `## Notes` with no dated subsection is
 * treated as unknown content and preserved verbatim in `extra`, so a v1 file that happens to use
 * either heading for free prose round trips untouched instead of losing text. `## References`
 * has no shape to fail, being free-form Markdown, so it is taken exactly as it stands, with
 * only the escapes the serializer added taken back off.
 */
function parseBody(lines: string[]): Body {
  let requirement = '';
  let plan: string[] = [];
  let checklist: ChecklistItem[] = [];
  let references = '';
  let notes: NoteEntry[] = [];
  const extra: string[] = [];
  const seen = new Set<string>();

  for (const section of splitSections(lines)) {
    const known = !seen.has(section.heading);
    if (known && section.heading === REQUIREMENT_HEADING) {
      requirement = section.lines.join('\n').trim();
      seen.add(section.heading);
      continue;
    }
    if (known && section.heading === PLAN_HEADING) {
      const steps = parsePlan(section.lines);
      if (steps.length > 0) {
        plan = steps;
        seen.add(section.heading);
        continue;
      }
    }
    if (known && section.heading === REFERENCES_HEADING) {
      // Verbatim, deliberately. References is raw material somebody pasted in, so the only
      // editing done to it is dropping the blank lines that the heading and the next section
      // put around it, and taking off the escapes the serializer put on. Nothing in it is
      // interpreted, counted or reformatted.
      references = decodeReferences(trimBlankEdges(section.lines)).join('\n');
      seen.add(section.heading);
      continue;
    }
    if (known && section.heading === CHECKLIST_HEADING) {
      const items: ChecklistItem[] = [];
      for (const line of section.lines) {
        const m = CHECKLIST_ITEM.exec(line);
        if (m) {
          items.push({ text: m[2]!.trim(), done: m[1]!.toLowerCase() === 'x' });
        } else if (items.length > 0 && CONTINUATION.test(line)) {
          // A wrapped item continues the one above it rather than becoming stray text. Before
          // this the second line was cut loose into `extra` and reappeared below the list.
          const last = items[items.length - 1]!;
          items[items.length - 1] = { ...last, text: `${last.text} ${line.trim()}` };
        } else if (line.trim() !== '') {
          extra.push(line);
        }
      }
      checklist = items;
      seen.add(section.heading);
      continue;
    }
    if (known && section.heading === NOTES_HEADING) {
      const parsed = parseNotes(section.lines);
      if (parsed.notes.length > 0) {
        notes = parsed.notes;
        extra.push(...parsed.before);
        seen.add(section.heading);
        continue;
      }
    }
    if (section.raw !== '') extra.push(section.raw);
    extra.push(...section.lines);
  }
  return { requirement, plan, checklist, references, notes, extra: extra.join('\n').trim() };
}

/**
 * Parses one task file (YAML frontmatter plus Markdown body) into a Task. Validates the fields
 * Ledge depends on, expands `~` in `repo`, keeps unknown frontmatter keys in `meta`, and splits
 * the body into requirement, plan, checklist, references, notes and extra text, in any order
 * they appear.
 * Throws TaskParseError with the file path and line so callers can report exactly where a
 * hand-edited file went wrong. A `planned` value that is not a real `YYYY-MM-DD` day is dropped
 * rather than thrown, because one mistyped date must never make a task unreadable. `paths` says
 * where a `~` and a relative repo path are anchored; with the default empty paths the repo string
 * is kept exactly as the file spells it.
 */
export function parseTask(markdown: string, file: string = '', paths: TaskPaths = {}): Task {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const { data, bodyStart } = splitFrontmatter(lines, file);

  const id = requireString(data, 'id', file);
  const title = requireString(data, 'title', file);
  const statusRaw = requireString(data, 'status', file);
  const status = normalizeStatus(statusRaw);
  if (status === undefined) {
    throw new TaskParseError(
      `Frontmatter key "status" must be one of ${STATUSES.join(', ')}, got "${statusRaw}". ` +
        `Known aliases: ${Object.keys(STATUS_ALIASES).join(', ')}`,
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
  const plannedRaw = optionalString(data, 'planned');
  const planned = isIsoDay(plannedRaw) ? plannedRaw : undefined;

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
    plan: body.plan,
    checklist: body.checklist,
    references: body.references,
    notes: body.notes,
    extra: body.extra,
    file,
  };
  if (repo !== undefined) task.repo = repo;
  if (parked !== undefined) task.parked = parked;
  if (planned !== undefined) task.planned = planned;
  if (Object.keys(meta).length > 0) task.meta = meta;
  return task;
}

/**
 * Serializes a Task back to the file format, the exact inverse of parseTask. Known frontmatter
 * keys come first in the documented order, then any `meta` keys in their original order; `repo`
 * is written with `~` for paths under the home folder. Body sections are written in the fixed
 * order Requirement, Plan, Checklist, References, Notes, then anything else, whatever order they
 * had in the file they came from, so every task file on disk converges on one shape. References
 * sits after the checklist because it is input to the work rather than a record of it, and
 * before Notes because Notes stays last and is what the next session reads first. Requirement
 * and Checklist are always emitted so Claude Code always has a place to write; Plan, References
 * and Notes appear only when they hold something. References is written so that reading the
 * file gives back exactly what was handed over: the two kinds of line that the reader would
 * otherwise act on are escaped with a backslash, and nothing else is touched. See
 * encodeReferences for which lines those are and why a free-form section has to carry that
 * guarantee itself. Output ends with a single newline. `paths.home` is the folder the `~` stands
 * for; without it an absolute repo path is written as it is.
 */
export function serializeTask(task: Task, paths: TaskPaths = {}): string {
  const front: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    order: task.order,
  };
  if (task.repo !== undefined) front.repo = collapseTilde(task.repo, paths.home ?? '');
  if (task.planned !== undefined) front.planned = task.planned;
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
  const plan = task.plan.map((step) => step.trim()).filter((step) => step !== '');
  if (plan.length > 0) {
    parts.push(PLAN_HEADING, '');
    plan.forEach((step, i) => parts.push(`${i + 1}. ${step}`));
    parts.push('');
  }
  parts.push(CHECKLIST_HEADING, '');
  for (const item of task.checklist) {
    parts.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (task.checklist.length > 0) parts.push('');
  const references = encodeReferences(trimBlankEdges((task.references ?? '').split('\n')));
  if (references.length > 0) parts.push(REFERENCES_HEADING, '', ...references, '');
  const notes = task.notes.filter((note) => note.body.trim() !== '');
  if (notes.length > 0) {
    parts.push(NOTES_HEADING, '');
    for (const note of notes) {
      parts.push(`### ${note.date}`, ...note.body.trim().split('\n'), '');
    }
  }
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
