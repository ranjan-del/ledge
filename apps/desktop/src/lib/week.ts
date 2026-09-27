/**
 * TEMPORARY: replace with @ledge/core/pure exports at merge.
 *
 * The weekly to-do file, exactly the pure API the weekly to-do contract gives core
 * (docs/superpowers/specs/2026-09-27-weekly-todo-contract.md). Stream A is building the real
 * one in core at the same time; until it lands the panel reads and writes week files through
 * this copy. Every other desktop module imports these names from here and nowhere else, so the
 * merge is one import line per file: `./week.ts` becomes `@ledge/core/pure`, and this file goes.
 *
 * The format, in short: one Markdown file per ISO week, a small frontmatter (`week`, `updated`,
 * and any other keys kept as they were), then `## Anytime` and `## <Ddd> <YYYY-MM-DD>` sections
 * holding GitHub task list lines. A trailing ` {task: <id>}` links an item to a task. Whatever
 * the parser does not understand is kept verbatim and written after the known sections. For a
 * file Ledge wrote, parse then serialize gives the same bytes back.
 */

export interface WeekItem {
  text: string;
  done: boolean;
  taskId?: string;
}

export interface WeekFile {
  /** '2026-W39' */
  week: string;
  anytime: WeekItem[];
  /** Key 'YYYY-MM-DD', only days inside the week. */
  days: Record<string, WeekItem[]>;
  updated?: string;
  /** Text the parser did not understand, kept verbatim. */
  extra: string;
  /** Unknown frontmatter keys, kept as they were written. */
  meta?: Record<string, unknown>;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ITEM_RE = /^- \[( |x|X)\] (.*)$/;
const LINK_RE = /^(.*?)\s+\{task:\s*([^\s}]+)\s*\}$/;

const pad = (n: number) => String(n).padStart(2, '0');

function utcDay(day: string): Date {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`Not a day: ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dayOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The ISO 8601 week a calendar day falls in: '2026-09-27' gives '2026-W39'. */
export function isoWeekOf(day: string): string {
  const d = utcDay(day);
  const weekday = (d.getUTCDay() + 6) % 7; // Monday 0
  /* The Thursday of this week decides the year the week belongs to. */
  const thursday = new Date(d.getTime() + (3 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

function mondayOf(week: string): Date {
  const m = WEEK_RE.exec(week);
  if (!m) throw new Error(`Not an ISO week: ${week}`);
  const year = Number(m[1]);
  const n = Number(m[2]);
  /* January 4th is always in week 1. */
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(monday1 + (n - 1) * 7 * 86_400_000);
}

/** The seven days of a week, Monday first. */
export function weekDays(week: string): string[] {
  const monday = mondayOf(week).getTime();
  return Array.from({ length: 7 }, (_, i) => dayOf(new Date(monday + i * 86_400_000)));
}

/** The week `n` weeks after this one; negative goes back. */
export function shiftWeek(week: string, n: number): string {
  const monday = mondayOf(week).getTime();
  return isoWeekOf(dayOf(new Date(monday + n * 7 * 86_400_000)));
}

function parseItem(line: string): WeekItem | undefined {
  const m = ITEM_RE.exec(line);
  if (!m) return undefined;
  const done = m[1] !== ' ';
  const body = m[2]!.trim();
  const link = LINK_RE.exec(body);
  if (link) return { text: link[1]!.trim(), done, taskId: link[2]! };
  return { text: body, done };
}

function itemLine(item: WeekItem): string {
  const link = item.taskId ? ` {task: ${item.taskId}}` : '';
  return `- [${item.done ? 'x' : ' '}] ${item.text}${link}`;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end);
}

/**
 * Reads a week file. It never throws: a missing frontmatter, a heading it does not know, a day
 * outside the week and prose between items are all kept in `extra` rather than refused, which
 * is what lets a person write in the file by hand without Ledge ever losing what they wrote.
 */
export function parseWeek(text: string, week: string): WeekFile {
  const out: WeekFile = { week, anytime: [], days: {}, extra: '' };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let at = 0;

  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (close !== -1) {
      const meta: Record<string, unknown> = {};
      let lastKey: string | undefined;
      for (const line of lines.slice(1, close)) {
        const m = /^([A-Za-z0-9_-]+):(?: (.*))?$/.exec(line);
        if (m) {
          const key = m[1]!;
          const value = m[2] ?? '';
          lastKey = key;
          if (key === 'week') continue;
          if (key === 'updated') out.updated = value.trim();
          else meta[key] = value;
        } else if (lastKey !== undefined && lastKey !== 'week' && lastKey !== 'updated') {
          /* A continuation of the previous key (a YAML list or block), kept as written. */
          meta[lastKey] = `${String(meta[lastKey] ?? '')}\n${line}`;
        }
      }
      if (Object.keys(meta).length > 0) out.meta = meta;
      at = close + 1;
    }
  }

  const inWeek = new Set(weekDays(week));
  const extra: string[] = [];
  /* The list items go to, or null while inside something the parser does not know. */
  let current: WeekItem[] | null = null;
  for (const line of lines.slice(at)) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      const title = heading[1]!;
      const day = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2})$/.exec(title);
      if (title === 'Anytime') {
        current = out.anytime;
        continue;
      }
      if (day && inWeek.has(day[2]!)) {
        current = out.days[day[2]!] ??= [];
        continue;
      }
      current = null;
      extra.push(line);
      continue;
    }
    if (current) {
      if (line.trim() === '') continue;
      const item = parseItem(line);
      if (item) {
        current.push(item);
        continue;
      }
      /* Prose inside a known section: from here on the text is kept as it stands. */
      current = null;
    }
    extra.push(line);
  }
  out.extra = trimBlankEdges(extra).join('\n');

  /* Calendar order, whatever order the file had them in. */
  const days: Record<string, WeekItem[]> = {};
  for (const day of weekDays(week)) if (out.days[day]) days[day] = out.days[day]!;
  out.days = days;
  return out;
}

/** Writes a week file: Anytime first, then days in calendar order, empty sections left out. */
export function serializeWeek(w: WeekFile): string {
  const lines = ['---', `week: ${w.week}`];
  if (w.updated) lines.push(`updated: ${w.updated}`);
  for (const [key, value] of Object.entries(w.meta ?? {})) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    lines.push(text === '' ? `${key}:` : text.startsWith('\n') ? `${key}:${text}` : `${key}: ${text}`);
  }
  lines.push('---');

  const section = (heading: string, items: WeekItem[]) => {
    if (items.length === 0) return;
    lines.push('', heading, '', ...items.map(itemLine));
  };
  section('## Anytime', w.anytime);
  weekDays(w.week).forEach((day, i) => section(`## ${DAY_NAMES[i]} ${day}`, w.days[day] ?? []));
  if (w.extra.trim() !== '') lines.push('', w.extra);
  return `${lines.join('\n')}\n`;
}

/** That day's items, not counting Anytime. */
export function itemsFor(w: WeekFile, day: string): WeekItem[] {
  return w.days[day] ?? [];
}
