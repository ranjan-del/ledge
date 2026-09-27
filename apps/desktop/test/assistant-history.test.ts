import { describe, expect, it } from 'vitest';
import {
  ChatHistory,
  cleanTitle,
  newChatId,
  parseChatFile,
  serializeChatFile,
  titleFrom,
  type HistoryFs,
} from '../src/lib/assistant/history.ts';
import type { Chat } from '../src/lib/assistant/types.ts';
import { memoryFs } from './assistant-fixtures.ts';

const chat = (id: string, updated: string, title = 'T'): Chat => ({
  id,
  title,
  created: '2026-09-27T10:00:00.000Z',
  updated,
  messages: [
    { id: 'm1', role: 'user', text: 'hello', tools: [], approvals: [], at: '2026-09-27T10:00:00.000Z' },
    {
      id: 'm2',
      role: 'assistant',
      text: 'Hi.',
      model: 'haiku',
      tools: [{ id: 't1', name: 'Bash', summary: 'ledge week', status: 'done' }],
      approvals: [{ id: 'a1', tool: 'Bash', input: { command: 'git push' }, summary: 'git push', reason: 'Pushes', decision: 'denied' }],
      at: '2026-09-27T10:00:01.000Z',
    },
  ],
});

describe('titles', () => {
  it('takes the first line of the first message, at most 50 chars, cut at a word', () => {
    expect(titleFrom('  what is   pending\nmore')).toBe('what is pending');
    const long = titleFrom('please plan the next phase of the visit tracker and review the architecture carefully');
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith('…')).toBe(true);
    expect(long).toBe('please plan the next phase of the visit tracker…');
    expect(titleFrom('   ')).toBe('New chat');
  });

  it('tidies a model-written title', () => {
    expect(cleanTitle('"Vendor call on Thursday."\n')).toBe('Vendor call on Thursday');
    expect(cleanTitle('Plan \u2014 next phase')).toBe('Plan , next phase');
    expect(cleanTitle('   ')).toBeUndefined();
  });

  it('makes sortable ids that are safe file names', () => {
    const id = newChatId(new Date('2026-09-27T10:11:12.345Z'));
    expect(id).toMatch(/^20260927T101112Z-[a-z0-9]{6}$/);
  });
});

describe('chat files', () => {
  it('round trips a chat and its session id', () => {
    const rec = { chat: chat('c1', '2026-09-27T10:00:01.000Z'), sessionId: 'sess-1' };
    expect(parseChatFile(serializeChatFile(rec))).toEqual(rec);
    expect(parseChatFile(serializeChatFile({ chat: rec.chat }))).toEqual({ chat: rec.chat });
  });

  it('refuses what is not a chat file, and mends missing fields', () => {
    expect(parseChatFile('nope')).toBeUndefined();
    expect(parseChatFile('{"version":1}')).toBeUndefined();
    const mended = parseChatFile(JSON.stringify({ version: 1, chat: { id: 'x', messages: [{ role: 'user', text: 'a' }] } }));
    expect(mended?.chat.title).toBe('New chat');
    expect(mended?.chat.messages[0]).toMatchObject({ role: 'user', text: 'a', tools: [], approvals: [] });
  });
});

describe('ChatHistory', () => {
  it('writes atomically through a .tmp file and a rename', async () => {
    const { fs, files, ops } = memoryFs();
    const h = new ChatHistory('/h/.ledge/chats', fs);
    await h.save({ chat: chat('c1', '2026-09-27T10:00:01.000Z') });
    expect(ops[0]).toMatch(/^write \/h\/\.ledge\/chats\/c1\.json\.\d+-1\.tmp$/);
    expect(ops[1]).toMatch(/^rename \/h\/\.ledge\/chats\/c1\.json\.\d+-1\.tmp \/h\/\.ledge\/chats\/c1\.json$/);
    expect([...files.keys()]).toEqual(['/h/.ledge/chats/c1.json']);
  });

  it('lists newest first, skipping tmp files and junk, and loads and deletes', async () => {
    const { fs, files } = memoryFs();
    const h = new ChatHistory('/h/.ledge/chats', fs);
    await h.save({ chat: chat('old', '2026-09-20T10:00:00.000Z', 'Old') });
    await h.save({ chat: chat('new', '2026-09-27T10:00:00.000Z', 'New') });
    await h.save({ chat: chat('mid', '2026-09-24T10:00:00.000Z', 'Mid'), sessionId: 's-mid' });
    files.set('/h/.ledge/chats/new.json.1-1.tmp', 'partial');
    files.set('/h/.ledge/chats/junk.json', 'not json');
    expect(await h.list()).toEqual([
      { id: 'new', title: 'New', updated: '2026-09-27T10:00:00.000Z' },
      { id: 'mid', title: 'Mid', updated: '2026-09-24T10:00:00.000Z' },
      { id: 'old', title: 'Old', updated: '2026-09-20T10:00:00.000Z' },
    ]);
    expect((await h.load('mid'))?.sessionId).toBe('s-mid');
    expect(await h.load('missing')).toBeUndefined();
    expect(await h.load('../etc/passwd')).toBeUndefined();
    await h.remove('mid');
    expect((await h.list()).map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('keeps one chat’s writes in order, so the newest always lands last', async () => {
    const { fs, files } = memoryFs();
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    let first = true;
    const slowFs: HistoryFs = {
      ...fs,
      async writeText(p, t) {
        if (first) {
          first = false;
          await slow;
        }
        return fs.writeText(p, t);
      },
    };
    const h = new ChatHistory('/d', slowFs);
    const a = h.save({ chat: chat('c', '1', 'first') });
    const b = h.save({ chat: chat('c', '2', 'second') });
    release();
    await Promise.all([a, b]);
    expect(parseChatFile(files.get('/d/c.json')!)?.chat.title).toBe('second');
  });

  it('cleans up the tmp file when the rename is refused', async () => {
    const { fs, files } = memoryFs();
    const h = new ChatHistory('/d', { ...fs, rename: async () => Promise.reject(new Error('denied')) });
    await expect(h.save({ chat: chat('c', '1') })).rejects.toThrow('denied');
    expect([...files.keys()]).toEqual([]);
  });
});
