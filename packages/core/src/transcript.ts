/**
 * Reading a Claude Code session transcript, pure half. Claude Code appends one JSON object per
 * line to `~/.claude/projects/<folder>/<session id>.jsonl`, and this file turns that text into a
 * digest: the person's prompts, the assistant's replies, the commands it ran, the files it
 * edited and the state of its own todo list, each tagged with the line it came from. Reading the
 * file is the caller's business, so this runs anywhere, and the capture feeds it a string.
 *
 * What is kept and what is not. A transcript is mostly machinery: thinking blocks, tool results
 * with whole files in them, hook attachments, snapshots, cost records. None of that says what
 * the session was for, and all of it is expensive to send to a model, so it is dropped. What is
 * left is what a person reading over the shoulder would have followed: what was asked, what was
 * said back, what was run and what was changed. Subagent traffic (`isSidechain`) is dropped too,
 * because the parent session's own reply already reports what a subagent found.
 *
 * The format is not a published contract, so every accessor here is defensive. A line that is
 * not JSON, an entry of a type this file has never seen, a tool call with an input it does not
 * expect: each is skipped, never thrown on. A digest of a transcript this file half understands
 * is still better than no capture at all.
 */

/** One thing that happened in the session, in the words the digest will show it. */
export interface DigestEntry {
  /** 1-based line of the transcript the entry came from. */
  line: number;
  /** ISO timestamp of that line, when it had one. */
  at?: string;
  /**
   * `prompt` is the person, `reply` is the assistant's text, `bash` a command it ran, `edit` a
   * file it changed, `todo` a change to its own todo list, `summary` the text Claude Code wrote
   * when it compacted the conversation.
   */
  kind: 'prompt' | 'reply' | 'bash' | 'edit' | 'todo' | 'summary';
  text: string;
}

/** One item of the session's own todo list (TodoWrite, or TaskCreate and TaskUpdate). */
export interface SessionTodo {
  text: string;
  done: boolean;
}

/** Everything the capture needs from a transcript, and nothing else. */
export interface TranscriptDigest {
  /** Non-blank lines in the transcript, which is what the debounce counts. */
  lineCount: number;
  /** Earliest timestamp seen, ISO. */
  started?: string;
  /** Newest timestamp seen, ISO. */
  lastActivity?: string;
  entries: DigestEntry[];
  /** Files edited, as the tool calls spelled the path, in the order first edited. */
  filesChanged: string[];
  /** The session's own todo list in its latest state. */
  todos: SessionTodo[];
  /** Every Bash command the assistant ran, in order, untruncated. */
  commands: string[];
}

/** Tool calls whose input names a file they changed, and the input key holding the path. */
const EDIT_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** Per entry caps, in characters. A long paste is one prompt, not the whole budget. */
const CAP = { prompt: 1500, reply: 800, bash: 240, summary: 2000 } as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Takes what Claude Code wraps around a prompt back off: system reminders and hook output are
 * dropped with their contents, a slash command keeps its name and arguments, and any other tag
 * is unwrapped. What is left is what the person typed, or nothing.
 */
function cleanPrompt(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-(?:stdout|stderr|caveat)>[\s\S]*?<\/local-command-(?:stdout|stderr|caveat)>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<\/?[a-z][a-z0-9-]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function earlier(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

function later(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Parses the text of a transcript into a digest. Never throws: a line that cannot be read is
 * counted and skipped, so the line numbers keep matching the file.
 */
export function parseTranscript(text: string): TranscriptDigest {
  const digest: TranscriptDigest = {
    lineCount: 0,
    entries: [],
    filesChanged: [],
    todos: [],
    commands: [],
  };
  const files = new Set<string>();
  /** TaskCreate ids, once the tool result has said which id a subject got. */
  const taskIds = new Map<string, SessionTodo>();
  const lines = text.split('\n');

  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    digest.lineCount++;
    const line = index + 1;
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(entry)) return;
    const at = typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp))
      ? entry.timestamp
      : undefined;
    if (at !== undefined) {
      digest.started = earlier(digest.started, at);
      digest.lastActivity = later(digest.lastActivity, at);
    }
    if (entry.isSidechain === true) return;
    const push = (kind: DigestEntry['kind'], body: string): void => {
      const item: DigestEntry = { line, kind, text: body };
      if (at !== undefined) item.at = at;
      digest.entries.push(item);
    };
    const message = isObject(entry.message) ? entry.message : undefined;

    if (entry.type === 'user' && message) {
      const result = entry.toolUseResult;
      if (isObject(result) && isObject(result.task)) {
        const id = result.task.id;
        const subject = result.task.subject;
        if (typeof id === 'string' && typeof subject === 'string') {
          const mapped = new Set(taskIds.values());
          const todo = digest.todos.find((t) => t.text === subject.trim() && !mapped.has(t));
          if (todo && !taskIds.has(id)) taskIds.set(id, todo);
        }
      }
      if (entry.isMeta === true) return;
      const content = message.content;
      if (entry.isCompactSummary === true) {
        const body = typeof content === 'string' ? content : '';
        if (body.trim() !== '') push('summary', clip(body, CAP.summary));
        return;
      }
      const texts: string[] = [];
      if (typeof content === 'string') texts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (isObject(block) && block.type === 'text' && typeof block.text === 'string') {
            texts.push(block.text);
          }
        }
      }
      const prompt = cleanPrompt(texts.join('\n'));
      if (prompt !== '') push('prompt', clip(prompt, CAP.prompt));
      return;
    }

    if (entry.type === 'assistant' && message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isObject(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          push('reply', clip(block.text, CAP.reply));
          continue;
        }
        if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const input = isObject(block.input) ? block.input : {};
        const pathKey = EDIT_TOOLS[block.name];
        if (pathKey !== undefined) {
          const path = input[pathKey];
          if (typeof path === 'string' && path.trim() !== '') {
            if (!files.has(path)) {
              files.add(path);
              digest.filesChanged.push(path);
            }
            push('edit', `${block.name} ${path}`);
          }
          continue;
        }
        if (block.name === 'Bash' && typeof input.command === 'string') {
          digest.commands.push(input.command);
          push('bash', clip(input.command.replace(/\s*\n\s*/g, ' ; '), CAP.bash));
          continue;
        }
        if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
          digest.todos = input.todos
            .filter(isObject)
            .filter((t) => typeof t.content === 'string' && t.content.trim() !== '')
            .map((t) => ({ text: (t.content as string).trim(), done: t.status === 'completed' }));
          const done = digest.todos.filter((t) => t.done).length;
          push('todo', `todo list now ${done} done of ${digest.todos.length}`);
          continue;
        }
        if (block.name === 'TaskCreate' && typeof input.subject === 'string') {
          const todo = { text: input.subject.trim(), done: false };
          if (todo.text !== '') {
            digest.todos.push(todo);
            push('todo', `todo added: ${clip(todo.text, 160)}`);
          }
          continue;
        }
        if (block.name === 'TaskUpdate' && typeof input.taskId === 'string') {
          const todo = taskIds.get(input.taskId);
          if (!todo) continue;
          if (input.status === 'completed') {
            todo.done = true;
            push('todo', `todo done: ${clip(todo.text, 160)}`);
          } else if (input.status === 'deleted') {
            digest.todos = digest.todos.filter((t) => t !== todo);
          } else if (typeof input.status === 'string') {
            todo.done = false;
          }
        }
      }
    }
  });
  return digest;
}

/** Options for renderDigest. */
export interface RenderDigestOptions {
  /**
   * Line count at the previous capture. Entries after it are the new material and are kept
   * first when the budget runs out; the rendering marks where they begin.
   */
  sinceLine?: number;
  /** Character budget for the rendering. Defaults to 48000, roughly 12k tokens. */
  maxChars?: number;
}

/** The default digest budget: about twelve thousand tokens at four characters a token. */
export const DIGEST_MAX_CHARS = 48_000;

function label(entry: DigestEntry): string {
  const time = entry.at ? entry.at.slice(11, 16) : '';
  const where = time === '' ? `L${entry.line}` : `L${entry.line} ${time}`;
  switch (entry.kind) {
    case 'prompt':
      return `[${where}] PERSON: ${entry.text}`;
    case 'reply':
      return `[${where}] CLAUDE: ${entry.text}`;
    case 'bash':
      return `[${where}] RAN: ${entry.text}`;
    case 'edit':
      return `[${where}] EDITED: ${entry.text}`;
    case 'todo':
      return `[${where}] TODO: ${entry.text}`;
    case 'summary':
      return `[${where}] EARLIER CONVERSATION, AS COMPACTED: ${entry.text}`;
  }
}

/**
 * Renders a digest as the text a capture prompt carries, inside a budget. Entries are chosen
 * newest first, new material before old, and then printed in transcript order, so the model
 * reads the session the way it happened but a long session loses its oldest chatter, not the
 * part that has not been captured yet. The session's todo list, when it has one, comes last in
 * its latest state, since that is the assistant's own account of what is done.
 */
export function renderDigest(digest: TranscriptDigest, options: RenderDigestOptions = {}): string {
  const budget = options.maxChars ?? DIGEST_MAX_CHARS;
  const since = options.sinceLine ?? 0;
  const todoLines = digest.todos.map((t) => `- [${t.done ? 'x' : ' '}] ${clip(t.text, 200)}`);
  let used = todoLines.reduce((n, l) => n + l.length + 1, 0);
  const fresh = digest.entries.filter((e) => e.line > since);
  const old = digest.entries.filter((e) => e.line <= since);
  const chosen = new Set<DigestEntry>();
  for (const group of [fresh, old]) {
    for (let i = group.length - 1; i >= 0; i--) {
      const cost = label(group[i]!).length + 1;
      if (used + cost > budget) break;
      used += cost;
      chosen.add(group[i]!);
    }
  }
  const left = digest.entries.length - chosen.size;
  const out: string[] = [];
  if (left > 0) out.push(`(${left} older entries left out to fit the budget)`);
  let marked = since === 0;
  for (const entry of digest.entries) {
    if (!chosen.has(entry)) continue;
    if (!marked && entry.line > since) {
      out.push('--- NEW SINCE THE LAST CAPTURE ---');
      marked = true;
    }
    out.push(label(entry));
  }
  if (!marked) out.push('--- NEW SINCE THE LAST CAPTURE --- (nothing)');
  if (todoLines.length > 0) out.push('', "THE SESSION'S OWN TODO LIST, LATEST STATE:", ...todoLines);
  return out.join('\n');
}
