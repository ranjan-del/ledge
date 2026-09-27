import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAssistantEngine, type EngineOptions } from '../src/lib/assistant/engine.ts';
import { ChatHistory, parseChatFile } from '../src/lib/assistant/history.ts';
import type { AgentHandlers, AgentLaunch, AgentRunner } from '../src/lib/assistant/runner.ts';
import type { EngineEvent } from '../src/lib/assistant/types.ts';
import { SESSION, fx, memoryFs } from './assistant-fixtures.ts';

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

interface FakeChild {
  launch: AgentLaunch;
  handlers: AgentHandlers;
  written: Record<string, any>[];
  killed: boolean;
  out(...lines: string[]): void;
  close(code: number | null): void;
}

function fakeRunner() {
  const children: FakeChild[] = [];
  const runner: AgentRunner = async (launch, handlers) => {
    const child: FakeChild = {
      launch,
      handlers,
      written: [],
      killed: false,
      out: (...lines) => lines.forEach((l) => handlers.stdout(l)),
      close: (code) => handlers.close(code),
    };
    children.push(child);
    return {
      write: async (data) => {
        for (const l of data.split('\n').filter((x) => x.trim() !== '')) child.written.push(JSON.parse(l));
      },
      kill: async () => {
        child.killed = true;
      },
    };
  };
  return { runner, children };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function setup(extra: Partial<EngineOptions> = {}) {
  const { runner, children } = fakeRunner();
  const mem = memoryFs();
  const history = new ChatHistory('/h/.ledge/chats', mem.fs);
  const events: EngineEvent[] = [];
  const engine = new ClaudeAssistantEngine({
    runner,
    history,
    context: () => 'CONTEXT BLOCK',
    home: () => '/h',
    now: () => new Date('2026-09-27T10:00:00.000Z'),
    backoffMs: [10, 20],
    stopGraceMs: 50,
    ...extra,
  });
  engine.subscribe((e) => events.push(e));
  const child = (i = children.length - 1) => children[i]!;
  const lastMessage = () => [...events].reverse().find((e) => e.type === 'message') as Extract<EngineEvent, { type: 'message' }>;
  const ready = async (i?: number) => {
    await flush();
    const c = child(i);
    const init = c.written.find((w) => w.request?.subtype === 'initialize');
    c.out(fx.initializeResponse(init!.request_id));
    await flush();
  };
  return { engine, events, children, child, lastMessage, ready, mem, history };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('warm session', () => {
  it('starts one process on warm, sends initialize, and turns ready when answered', async () => {
    const t = setup();
    expect(t.engine.status()).toBe('ready');
    t.engine.warm();
    expect(t.engine.status()).toBe('starting');
    await t.ready();
    expect(t.children).toHaveLength(1);
    expect(t.child().launch.model).toBe('sonnet');
    expect(t.child().launch.resume).toBeUndefined();
    expect(t.child().launch.systemPrompt).toMatch(/ledge week add/);
    expect(t.child().launch.systemPrompt).not.toMatch(/—/);
    expect(t.engine.status()).toBe('ready');
    t.engine.warm();
    expect(t.children).toHaveLength(1);
    t.engine.dispose();
  });

  it('streams an answer, routes the model with set_model, and saves the chat', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const chatId = await t.engine.send(undefined, 'what is an llm');
    expect(t.engine.status()).toBe('busy');
    const w = t.child().written;
    const setModel = w.find((x) => x.request?.subtype === 'set_model');
    expect(setModel?.request.model).toBe('haiku');
    const user = w.find((x) => x.type === 'user');
    const text: string = user!.message.content[0].text;
    expect(text).toContain('<ledge-context');
    expect(text).toContain('CONTEXT BLOCK');
    expect(text.trim().endsWith('what is an llm')).toBe(true);
    expect(w.indexOf(setModel!)).toBeLessThan(w.indexOf(user!));

    t.child().out(fx.controlOk(setModel!.request_id), fx.init('claude-haiku-4-5'), fx.messageStart(), fx.textDelta('A large '));
    await flush();
    expect(t.lastMessage().message).toMatchObject({ role: 'assistant', text: 'A large ', model: 'haiku' });
    t.child().out(fx.textDelta('language model.'), fx.result('A large language model.'));
    await flush();
    expect(t.lastMessage().message.text).toBe('A large language model.');
    expect(t.engine.status()).toBe('ready');

    const saved = parseChatFile(t.mem.files.get(`/h/.ledge/chats/${chatId}.json`)!);
    expect(saved?.sessionId).toBe(SESSION);
    expect(saved?.chat.title).toBe('what is an llm');
    expect(saved?.chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(t.events.some((e) => e.type === 'chats' && e.chats[0]?.id === chatId)).toBe(true);
    t.engine.dispose();
  });

  it('does not send set_model when the model is already right, and honours an explicit choice', async () => {
    const t = setup({ modelTitles: false });
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'add call vendor to thursday');
    expect(t.child().written.some((x) => x.request?.subtype === 'set_model')).toBe(false);
    t.child().out(fx.result('Added.'));
    await flush();
    await t.engine.send(id, 'what is an llm', 'opus');
    const models = t.child().written.filter((x) => x.request?.subtype === 'set_model').map((x) => x.request.model);
    expect(models).toEqual(['opus']);
    t.engine.dispose();
  });

  it('lists tool calls with one-line summaries and their outcome', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    await t.engine.send(undefined, 'add call vendor to thursday');
    t.child().out(
      fx.messageStart(),
      fx.toolUse('t1', 'Bash', { command: 'ledge week add "Call vendor" --day thu' }),
      fx.canUseTool('r1', 't1', 'Bash', { command: 'ledge week add "Call vendor" --day thu' }),
    );
    await flush();
    // Safe: allowed at once, with no approval card.
    const allow = t.child().written.find((x) => x.type === 'control_response' && x.response.request_id === 'r1');
    expect(allow?.response.response.behavior).toBe('allow');
    expect(t.events.some((e) => e.type === 'approval')).toBe(false);
    t.child().out(fx.toolResult('t1'), fx.messageStart(), fx.textDelta('Added Call vendor to Thursday.'), fx.result('x'));
    await flush();
    const msg = t.lastMessage().message;
    expect(msg.tools).toEqual([{ id: 't1', name: 'Bash', summary: 'ledge week add "Call vendor" --day thu', status: 'done' }]);
    expect(msg.text).toBe('Added Call vendor to Thursday.');
    t.engine.dispose();
  });

  it('separates two assistant messages in one turn with a blank line', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    await t.engine.send(undefined, 'what is pending');
    t.child().out(fx.messageStart(), fx.textDelta('Checking.'), fx.messageStart(), fx.textDelta('Two things.'), fx.result('Two things.'));
    await flush();
    expect(t.lastMessage().message.text).toBe('Checking.\n\nTwo things.');
    t.engine.dispose();
  });
});

describe('approvals', () => {
  it('holds a risky tool for an approval, then allows it on Approve', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const chatId = await t.engine.send(undefined, 'push the branch');
    t.child().out(fx.toolUse('t1', 'Bash', { command: 'git push origin main' }), fx.canUseTool('r1', 't1', 'Bash', { command: 'git push origin main' }));
    await flush();
    const approval = t.events.find((e) => e.type === 'approval') as Extract<EngineEvent, { type: 'approval' }>;
    expect(approval.chatId).toBe(chatId);
    expect(approval.request).toMatchObject({ id: 'r1', tool: 'Bash', summary: 'git push origin main' });
    expect(approval.request.reason).toMatch(/Pushes/);
    expect(t.child().written.some((x) => x.type === 'control_response')).toBe(false);
    expect(t.lastMessage().message.approvals).toHaveLength(1);

    t.engine.decide('r1', 'approved');
    await flush();
    const answer = t.child().written.find((x) => x.type === 'control_response');
    expect(answer?.response).toMatchObject({ request_id: 'r1', response: { behavior: 'allow', toolUseID: 't1' } });
    expect(t.lastMessage().message.approvals[0]?.decision).toBe('approved');
    t.engine.dispose();
  });

  it('denies on Cancel and marks the tool denied', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    await t.engine.send(undefined, 'delete the old task');
    t.child().out(fx.toolUse('t1', 'Bash', { command: 'ledge delete old' }), fx.canUseTool('r1', 't1', 'Bash', { command: 'ledge delete old' }));
    await flush();
    t.engine.decide('r1', 'denied');
    await flush();
    const answer = t.child().written.find((x) => x.type === 'control_response');
    expect(answer?.response.response.behavior).toBe('deny');
    expect(answer?.response.response.message).toMatch(/cancelled/);
    t.child().out(fx.toolDenied('t1'), fx.result('Not deleted.'));
    await flush();
    const msg = t.lastMessage().message;
    expect(msg.tools[0]?.status).toBe('denied');
    expect(msg.approvals[0]?.decision).toBe('denied');
    t.engine.decide('r1', 'approved');
    t.engine.dispose();
  });

  it('remembers Always for the same command prefix in that chat only', async () => {
    const t = setup({ modelTitles: false });
    t.engine.warm();
    await t.ready();
    const a = await t.engine.send(undefined, 'push it');
    t.child().out(fx.canUseTool('r1', 't1', 'Bash', { command: 'git push origin main' }));
    await flush();
    t.engine.decide('r1', 'approved', true);
    t.child().out(fx.canUseTool('r2', 't2', 'Bash', { command: 'git push origin other' }));
    await flush();
    expect(t.events.filter((e) => e.type === 'approval')).toHaveLength(1);
    const r2 = t.child().written.find((x) => x.response?.request_id === 'r2');
    expect(r2?.response.response.behavior).toBe('allow');
    t.child().out(fx.canUseTool('r3', 't3', 'Bash', { command: 'git reset --hard' }));
    await flush();
    expect(t.events.filter((e) => e.type === 'approval')).toHaveLength(2);
    t.engine.decide('r3', 'denied');
    t.child().out(fx.result('ok'));
    await flush();

    // Another chat asks again.
    t.engine.newChat();
    await t.ready();
    const b = await t.engine.send(undefined, 'push it too');
    expect(b).not.toBe(a);
    t.child().out(fx.canUseTool('r4', 't4', 'Bash', { command: 'git push origin main' }));
    await flush();
    expect(t.events.filter((e) => e.type === 'approval')).toHaveLength(3);
    t.engine.dispose();
  });

  it('answers control requests it does not handle with an error, and drops cancelled prompts', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    await t.engine.send(undefined, 'push');
    t.child().out(fx.hookCallback('h1'), fx.canUseTool('r1', 't1', 'Bash', { command: 'git push' }));
    await flush();
    expect(t.child().written.find((x) => x.response?.request_id === 'h1')?.response.subtype).toBe('error');
    t.child().out(fx.cancel('r1'));
    await flush();
    expect(t.lastMessage().message.approvals[0]?.decision).toBe('denied');
    t.engine.dispose();
  });
});

describe('stop, crash and restart', () => {
  it('sends interrupt on stop, denies what waits, and ends the turn without an error', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'count to 200');
    t.child().out(fx.textDelta('1 2 3'), fx.canUseTool('r1', 't1', 'Bash', { command: 'rm -rf x' }));
    await flush();
    t.engine.stop(id);
    await flush();
    const w = t.child().written;
    expect(w.some((x) => x.request?.subtype === 'interrupt')).toBe(true);
    expect(w.find((x) => x.response?.request_id === 'r1')?.response.response.behavior).toBe('deny');
    t.child().out(fx.resultInterrupted);
    await flush();
    expect(t.engine.status()).toBe('ready');
    expect(t.lastMessage().message.error).toBeUndefined();
    expect(t.lastMessage().message.text).toBe('1 2 3');
    t.engine.dispose();
  });

  it('kills and restarts when an interrupt goes unanswered', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'count');
    t.engine.stop(id);
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(t.children[0]!.killed).toBe(true);
    expect(t.children).toHaveLength(2);
    expect(t.engine.status()).not.toBe('busy');
    t.engine.dispose();
  });

  it('shows a crash on the running answer and restarts with backoff, resuming the chat', async () => {
    const t = setup({ modelTitles: false });
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'what is pending');
    t.child().out(fx.init(), fx.textDelta('Partly'));
    await flush();
    t.child().handlers.stderr('Segmentation fault\n');
    t.child().close(139);
    await flush();
    expect(t.lastMessage().message.error).toMatch(/Segmentation fault/);
    expect(t.engine.status()).toBe('starting');
    await new Promise((r) => setTimeout(r, 30));
    await flush();
    expect(t.children).toHaveLength(2);
    expect(t.child().launch.resume).toBe(SESSION);
    await t.ready();
    expect(t.engine.status()).toBe('ready');
    // The chat still works on the restarted process.
    await t.engine.send(id, 'and now?');
    expect(t.child().written.some((x) => x.type === 'user')).toBe(true);
    t.engine.dispose();
  });

  it('gives up after the last backoff and says why', async () => {
    const t = setup();
    t.engine.warm();
    await flush();
    t.child().close(1);
    await new Promise((r) => setTimeout(r, 15));
    await flush();
    t.child().close(1);
    await new Promise((r) => setTimeout(r, 30));
    await flush();
    t.child().close(1);
    await flush();
    expect(t.children).toHaveLength(3);
    expect(t.engine.status()).toBe('unavailable');
    t.engine.warm();
    expect(t.children).toHaveLength(4);
    t.engine.dispose();
  });

  it('is unavailable at once when Claude Code is missing or signed out', async () => {
    const t = setup();
    t.engine.warm();
    await flush();
    t.child().close(127);
    await flush();
    expect(t.engine.status()).toBe('unavailable');
    const status = [...t.events].reverse().find((e) => e.type === 'status') as Extract<EngineEvent, { type: 'status' }>;
    expect(status.detail).toMatch(/not installed/);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.children).toHaveLength(1);

    const s = setup();
    s.engine.warm();
    await flush();
    s.child().handlers.stderr('Not logged in. Please run /login\n');
    s.child().close(1);
    await flush();
    expect(s.engine.status()).toBe('unavailable');
    t.engine.dispose();
    s.engine.dispose();
  });
});

describe('chats', () => {
  it('switches the process to a saved chat with --resume, and replays one with no session', async () => {
    const t = setup({ modelTitles: false });
    await t.history.save({
      chat: {
        id: 'old',
        title: 'Old',
        created: '2026-09-20T10:00:00.000Z',
        updated: '2026-09-20T10:00:00.000Z',
        messages: [
          { id: 'a', role: 'user', text: 'what is pending', tools: [], approvals: [], at: '' },
          { id: 'b', role: 'assistant', text: 'Two things.', model: 'sonnet', tools: [], approvals: [], at: '' },
        ],
      },
      sessionId: SESSION,
    });
    await t.history.save({
      chat: {
        id: 'nosession',
        title: 'No session',
        created: '2026-09-21T10:00:00.000Z',
        updated: '2026-09-21T10:00:00.000Z',
        messages: [{ id: 'c', role: 'user', text: 'remember the vendor', tools: [], approvals: [], at: '' }],
      },
    });
    t.engine.warm();
    await t.ready();
    const chat = await t.engine.loadChat('old');
    expect(chat?.messages).toHaveLength(2);
    expect(t.children[0]!.killed).toBe(true);
    expect(t.child().launch.resume).toBe(SESSION);
    await t.ready();
    await t.engine.send('old', 'and the first one?');
    const text: string = t.child().written.find((x) => x.type === 'user')!.message.content[0].text;
    expect(text).not.toContain('<earlier-conversation');

    t.child().out(fx.result('ok'));
    await flush();
    await t.engine.loadChat('nosession');
    expect(t.child().launch.resume).toBeUndefined();
    await t.ready();
    await t.engine.send('nosession', 'what did I ask?');
    const replayed: string = t.child().written.find((x) => x.type === 'user')!.message.content[0].text;
    expect(replayed).toContain('<earlier-conversation');
    expect(replayed).toContain('Person: remember the vendor');
    t.engine.dispose();
  });

  it('falls back to a replay when the saved session cannot be resumed', async () => {
    const t = setup({ modelTitles: false });
    await t.history.save({
      chat: {
        id: 'gone',
        title: 'Gone',
        created: '',
        updated: '',
        messages: [
          { id: 'a', role: 'user', text: 'hello there', tools: [], approvals: [], at: '' },
          { id: 'b', role: 'assistant', text: 'Hi.', tools: [], approvals: [], at: '' },
        ],
      },
      sessionId: '99999999-2222-4333-8444-555555555555',
    });
    await t.engine.send('gone', 'still there?');
    await flush();
    expect(t.child().launch.resume).toBe('99999999-2222-4333-8444-555555555555');
    t.child().handlers.stderr('No conversation found with session ID\n');
    t.child().close(1);
    await flush();
    expect(t.children).toHaveLength(2);
    expect(t.child().launch.resume).toBeUndefined();
    const text: string = t.child().written.find((x) => x.type === 'user')!.message.content[0].text;
    expect(text).toContain('Person: hello there');
    expect(text.trim().endsWith('still there?')).toBe(true);
    t.child().out(fx.init('claude-sonnet-5', '77777777-2222-4333-8444-555555555555'), fx.result('Yes.'));
    await flush();
    expect(parseChatFile(t.mem.files.get('/h/.ledge/chats/gone.json')!)?.sessionId).toBe('77777777-2222-4333-8444-555555555555');
    t.engine.dispose();
  });

  it('asks for a short model title after the first answer, and tolerates a failure', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'please remind me to call the vendor on thursday about the invoice');
    t.child().out(fx.result('Added to Thursday.'));
    await flush();
    const req = t.child().written.find((x) => x.request?.subtype === 'generate_session_title');
    expect(req?.request.description).toContain('call the vendor');
    t.child().out(fx.controlOk(req!.request_id, { title: '"Vendor call reminder."' }));
    await flush();
    expect((await t.engine.listChats())[0]).toMatchObject({ id, title: 'Vendor call reminder' });

    // A new chat gets its own process, since the first one holds the first chat's session.
    const id2 = await t.engine.send(undefined, 'what is an llm');
    expect(t.children).toHaveLength(2);
    t.child().out(fx.result('A model.'));
    await flush();
    const req2 = t.child().written.find((x) => x.request?.subtype === 'generate_session_title');
    t.child().out(fx.controlErr(req2!.request_id, 'no'));
    await flush();
    expect((await t.engine.loadChat(id2))?.title).toBe('what is an llm');
    t.engine.dispose();
  });

  it('deletes a chat and its file, and lists newest first', async () => {
    const t = setup({ modelTitles: false });
    t.engine.warm();
    await t.ready();
    const a = await t.engine.send(undefined, 'first chat');
    t.child().out(fx.result('ok'));
    await flush();
    t.engine.newChat();
    await t.ready();
    const b = await t.engine.send(undefined, 'second chat');
    t.child().out(fx.result('ok'));
    await flush();
    expect((await t.engine.listChats()).map((c) => c.id)).toContain(a);
    await t.engine.deleteChat(b);
    expect((await t.engine.listChats()).map((c) => c.id)).toEqual([a]);
    expect(await t.engine.loadChat(b)).toBeUndefined();
    t.engine.dispose();
  });

  it('refuses a second send while a turn runs', async () => {
    const t = setup();
    t.engine.warm();
    await t.ready();
    const id = await t.engine.send(undefined, 'one');
    await expect(t.engine.send(id, 'two')).rejects.toThrow(/still answering/);
    t.engine.dispose();
  });
});
