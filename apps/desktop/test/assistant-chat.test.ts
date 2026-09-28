import { describe, expect, it, vi } from 'vitest';
import { AssistantChat, filterChats, problemFor } from '../src/lib/assistant-chat.svelte.ts';
import { FakeAssistantEngine } from '../src/lib/assistant/fake.ts';
import { recentByActivity } from '../src/lib/derive.ts';
import { taskA, taskB, taskC } from './fixtures.ts';

async function settle(chat: AssistantChat) {
  await vi.waitFor(() => expect(chat.running).toBe(false));
}

describe('AssistantChat', () => {
  it('streams an answer into the chat by replacing each message by id', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    expect(chat.chatting).toBe(false);
    await chat.send('what is an LLM');
    await settle(chat);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages[1]?.text).toContain('You asked: what is an LLM.');
    expect(chat.messages[1]?.model).toBe('opus');
    expect(chat.chatting).toBe(true);
    expect(chat.title).toBe('what is an LLM');
  });

  it('sends the model the person picked', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    chat.model = 'opus';
    await chat.send('hi');
    expect(engine.sent[0]?.model).toBe('opus');
  });

  it('ignores events for a chat that is not on screen', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    const other = engine.newChat();
    await engine.send(other, 'elsewhere');
    expect(chat.messages).toEqual([]);
  });

  it('holds an approval until it is decided, and passes always along', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    await chat.send('delete the example task');
    await vi.waitFor(() => expect(chat.messages[1]?.approvals).toHaveLength(1));
    const id = chat.messages[1]!.approvals[0]!.id;
    expect(chat.running).toBe(true);
    chat.decide(id, 'approved', true);
    expect(chat.answered[id]).toBe('approved');
    await settle(chat);
    expect(engine.decisions).toEqual([{ id, decision: 'approved', always: true }]);
    expect(chat.messages[1]?.approvals[0]?.decision).toBe('approved');
    expect(chat.messages[1]?.text).toContain('Done, deleted it.');
  });

  it('stops the running turn', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    await chat.send('please push it');
    await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    chat.stop();
    await settle(chat);
    expect(engine.pendingApprovals()).toEqual([]);
  });

  it('opens, lists and deletes saved chats, and goes back to idle for New chat', async () => {
    const engine = new FakeAssistantEngine();
    const chat = new AssistantChat(engine);
    chat.attach();
    await chat.send('first question');
    await settle(chat);
    const first = chat.chatId!;
    chat.newChat();
    expect(chat.chatting).toBe(false);
    await chat.send('second question');
    await settle(chat);
    await chat.refreshChats();
    expect(chat.chats.map((c) => c.title).sort()).toEqual(['first question', 'second question']);
    await chat.open(first);
    expect(chat.messages[0]?.text).toBe('first question');
    await chat.remove(first);
    expect(chat.messages).toEqual([]);
    expect(chat.chats.map((c) => c.title)).toEqual(['second question']);
  });

  it('retries a failed answer by asking its question again', async () => {
    let fail = true;
    const engine = new FakeAssistantEngine({
      script: () => (fail ? [{ error: 'Claude Code stopped without an answer.' }] : [{ text: 'Fine now.' }]),
    });
    const chat = new AssistantChat(engine);
    chat.attach();
    await chat.send('hello there');
    await settle(chat);
    expect(chat.messages[1]?.error).toMatch(/stopped/);
    fail = false;
    await chat.retry(chat.messages[1]!.id);
    await settle(chat);
    expect(engine.sent.map((s) => s.text)).toEqual(['hello there', 'hello there']);
    expect(chat.messages.at(-1)?.text).toBe('Fine now.');
  });

  it('follows the engine status, detail included, and retries by warming', () => {
    const engine = new FakeAssistantEngine({ warmStatus: 'unavailable', warmDetail: 'Claude Code is not signed in.' });
    const chat = new AssistantChat(engine);
    chat.attach();
    chat.warm();
    expect(chat.status).toBe('unavailable');
    expect(chat.detail).toBe('Claude Code is not signed in.');
    chat.warm();
    expect(engine.warmed).toBe(2);
  });
});

describe('problemFor', () => {
  it('names each way Claude Code can be missing, and says nothing when it is fine', () => {
    expect(problemFor('ready', '')).toBeUndefined();
    expect(problemFor('unavailable', 'Claude Code is not installed, or not on the PATH')?.title).toBe(
      'Claude Code is not installed',
    );
    expect(problemFor('unavailable', 'Claude Code is not signed in. Run claude once')?.title).toBe(
      'Claude Code is signed out',
    );
    expect(problemFor('unavailable', 'Claude Code stopped without an answer: boom')?.title).toBe('Claude Code stopped');
  });
});

describe('filterChats', () => {
  it('keeps the chats whose title has every word', () => {
    const chats = [
      { id: 'a', title: 'Plan my day', updated: '' },
      { id: 'b', title: 'What is pending', updated: '' },
    ];
    expect(filterChats(chats, 'PLAN day').map((c) => c.id)).toEqual(['a']);
    expect(filterChats(chats, '  ')).toHaveLength(2);
  });
});

describe('recentByActivity', () => {
  it('orders by the newer of the file and its sessions, leaves done out, and caps the list', () => {
    const a = { ...taskA(), updated: '2026-09-15T08:00:00+05:30' };
    const b = { ...taskB(), updated: '2026-09-15T09:00:00+05:30' };
    const c = { ...taskC(), updated: '2026-09-15T07:00:00+05:30' };
    const done = { ...taskA(), id: 'gone', file: 'gone.md', status: 'done' as const, updated: '2026-09-15T11:00:00+05:30' };
    const records = [{ taskId: c.id, lastActivity: '2026-09-15T10:00:00+05:30' }];
    const recent = recentByActivity([a, b, c, done], records, 2);
    expect(recent.map((r) => r.task.id)).toEqual([c.id, b.id]);
    expect(Date.parse(recent[0]!.at)).toBe(Date.parse('2026-09-15T10:00:00+05:30'));
  });
});
