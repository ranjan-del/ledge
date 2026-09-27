/**
 * A very small Markdown reader for the assistant's answers. It knows paragraphs, bullet and
 * numbered lists, fenced code, headings (drawn as a bold line), inline code, bold, italics and
 * links, and nothing else. It returns a tree rather than HTML, so the component draws every
 * piece as text: nothing the model writes can ever become markup, whatever it contains.
 *
 * Links are kept only for http, https and mailto. Anything else (javascript:, file:, a relative
 * path) stays as the words it was written as.
 *
 * It is forgiving on purpose, because it is fed a stream: half a code fence is a code block that
 * has not closed yet, and a `**` with no partner is two asterisks.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'p'; inlines: Inline[] }
  | { type: 'heading'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; lang: string; text: string };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** True for a link target the panel may open: web and mail only. */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(h) ? h : undefined;
}

/** Reads a whole answer into blocks. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ type: 'p', inlines: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((i) => parseInline(i)),
      });
    }
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', inlines: parseInline(heading[1]!.replace(/\s*#+\s*$/, '')) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      }
      list.items.push(bullet ? bullet[1]! : numbered![2]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      /* An indented line under a list item carries on that item. */
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Reads one run of text into inline pieces. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const pushText = (s: string) => {
    buf += s;
  };
  const flush = () => {
    if (buf !== '') out.push({ type: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#+\-.!~]/.test(text[i + 1]!)) {
      pushText(text[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const mark = ch + ch;
      const end = text.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || (ch === '_' && (i === 0 || /\W/.test(text[i - 1]!)))) {
      const end = text.indexOf(ch, i + 1);
      const inner = end > i + 1 ? text.slice(i + 1, end) : '';
      const closesWord = ch === '*' || end + 1 >= text.length || /\W/.test(text[end + 1]!);
      if (inner !== '' && !/^\s|\s$/.test(inner) && closesWord) {
        flush();
        out.push({ type: 'em', children: parseInline(inner) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = text.indexOf('](', i + 1);
      const end = close > i ? text.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const href = safeHref(text.slice(close + 2, end));
        const label = text.slice(i + 1, close);
        flush();
        if (href) out.push({ type: 'link', href, children: parseInline(label) });
        else out.push(...parseInline(label));
        i = end + 1;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(text.slice(i, i + 8)) && (i === 0 || /[\s(]/.test(text[i - 1]!))) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/i.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ type: 'link', href: m[0], children: [{ type: 'text', text: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    pushText(ch);
    i += 1;
  }
  flush();
  return out;
}
