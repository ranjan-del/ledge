/**
 * Saved chats: `~/.ledge/chats/<id>.json`, one Chat plus the Claude Code session id that
 * continues it. Writes are atomic as for the other sidecars (`<file>.<time>-<n>.tmp`, then a
 * rename over the real name), and one chat's writes run one after another so a slow write can
 * never land after a newer one. The file system is handed in, so tests run on a map.
 */
import type { Chat, ChatMessage } from './types.ts';

export const CHAT_FILE_VERSION = 1;
/** The longest title taken from the first message. */
export const TITLE_MAX = 50;

export interface ChatFile {
  version: number;
  /** The Claude Code session that holds this conversation, for `--resume`. */
  sessionId?: string;
  chat: Chat;
}

export interface ChatRecord {
  chat: Chat;
  sessionId?: string;
}

export type ChatSummary = Pick<Chat, 'id' | 'title' | 'updated'>;

/** The few file operations history needs. The real ones come from ../io.ts. */
export interface HistoryFs {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names directly inside a folder; empty when it cannot be read. */
  list(dir: string): Promise<string[]>;
  ensureDir(dir: string): Promise<void>;
}

/** A title from the first user message: its first line, spaces closed up, at most 50 chars. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.replace(/\s+/g, ' ').trim();
  if (line === '') return 'New chat';
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX - 1);
  const atSpace = cut.lastIndexOf(' ');
  return `${(atSpace > TITLE_MAX / 2 ? cut.slice(0, atSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** A title a model wrote, tidied: one line, no quotes or trailing full stop, at most 50 chars. */
export function cleanTitle(text: string): string | undefined {
  const t = text
    .trim()
    .split('\n')[0]!
    .replace(/^["'“”‘’`*#\s]+|["'“”‘’`*\s]+$/g, '')
    .replace(/[\u2014\u2013]/g, ',')
    .replace(/\.$/, '')
    .trim();
  if (t === '') return undefined;
  return t.length <= TITLE_MAX ? t : titleFrom(t);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads a chat file, or undefined when it is not one. Messages missing a field are mended. */
export function parseChatFile(text: string): ChatRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(raw) || !isObject(raw.chat)) return undefined;
  const c = raw.chat;
  if (typeof c.id !== 'string' || c.id === '') return undefined;
  const messages: ChatMessage[] = Array.isArray(c.messages)
    ? c.messages.filter(isObject).map((m) => ({
        id: typeof m.id === 'string' ? m.id : '',
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: typeof m.text === 'string' ? m.text : '',
        ...(m.model === 'haiku' || m.model === 'sonnet' || m.model === 'opus' ? { model: m.model } : {}),
        tools: Array.isArray(m.tools) ? (m.tools as ChatMessage['tools']) : [],
        approvals: Array.isArray(m.approvals) ? (m.approvals as ChatMessage['approvals']) : [],
        at: typeof m.at === 'string' ? m.at : '',
        ...(typeof m.error === 'string' ? { error: m.error } : {}),
      }))
    : [];
  const created = typeof c.created === 'string' ? c.created : '';
  return {
    chat: {
      id: c.id,
      title: typeof c.title === 'string' && c.title !== '' ? c.title : 'New chat',
      created,
      updated: typeof c.updated === 'string' ? c.updated : created,
      messages,
    },
    ...(typeof raw.sessionId === 'string' && raw.sessionId !== '' ? { sessionId: raw.sessionId } : {}),
  };
}

export function serializeChatFile(record: ChatRecord): string {
  const file: ChatFile = {
    version: CHAT_FILE_VERSION,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    chat: record.chat,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A chat id: sortable by time, then random, safe as a file name. */
export function newChatId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${stamp}-${rand}`;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ChatHistory {
  private tmpCount = 0;
  private queues = new Map<string, Promise<unknown>>();

  private readonly dir: string;
  private readonly fs: HistoryFs;

  constructor(dir: string, fs: HistoryFs) {
    this.dir = dir;
    this.fs = fs;
  }

  pathFor(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Not a chat id: ${id}`);
    return `${this.dir.replace(/\/+$/, '')}/${id}.json`;
  }

  /** Saves a chat atomically, after any earlier save of the same chat. */
  save(record: ChatRecord): Promise<void> {
    const id = record.chat.id;
    const text = serializeChatFile(record);
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.write(id, text));
    this.queues.set(id, next);
    void next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }).catch(() => {});
    return next;
  }

  private async write(id: string, text: string): Promise<void> {
    await this.fs.ensureDir(this.dir);
    const file = this.pathFor(id);
    this.tmpCount += 1;
    const tmp = `${file}.${Date.now()}-${this.tmpCount}.tmp`;
    await this.fs.writeText(tmp, text);
    try {
      await this.fs.rename(tmp, file);
    } catch (e) {
      await this.fs.remove(tmp).catch(() => {});
      throw e;
    }
  }

  async load(id: string): Promise<ChatRecord | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    await (this.queues.get(id) ?? Promise.resolve()).catch(() => {});
    try {
      return parseChatFile(await this.fs.readText(this.pathFor(id)));
    } catch {
      return undefined;
    }
  }

  /** Every saved chat, newest first. Files that are not chats are skipped. */
  async list(): Promise<ChatSummary[]> {
    await Promise.all([...this.queues.values()].map((q) => q.catch(() => {})));
    const names = (await this.fs.list(this.dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    const out: ChatSummary[] = [];
    for (const name of names) {
      try {
        const rec = parseChatFile(await this.fs.readText(`${this.dir.replace(/\/+$/, '')}/${name}`));
        if (rec) out.push({ id: rec.chat.id, title: rec.chat.title, updated: rec.chat.updated });
      } catch {
        /* An unreadable file is not a chat. */
      }
    }
    return out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? 1 : -1));
  }

  async remove(id: string): Promise<void> {
    await (this.queues.get(id) ?? Promise.resolve()).catch(() => {});
    try {
      await this.fs.remove(this.pathFor(id));
    } catch {
      /* Already gone. */
    }
  }
}
