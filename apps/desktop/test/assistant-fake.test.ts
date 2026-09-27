import { describe, expect, it } from 'vitest';
import { FakeAssistantEngine } from '../src/lib/assistant/fake.ts';
import type { EngineEvent } from '../src/lib/assistant/types.ts';

const settle = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

function watch(engine: FakeAssistantEngine) {
  const events: EngineEvent[] = [];
  engine.subscribe((e) => events.push(e));
  const last = () => [...events].reverse().find((e) => e.type === 'message') as Extract<EngineEvent, { type: 'message' }>;
  return { events, last };
}

describe('FakeAssistantEngine', () => {
  it('streams a scripted answer and goes busy then ready', async () => {
    const engine = new FakeAssistantEngine();
    const { events, last } = watch(engine);
    engine.warm();
    const id = await engine.send(undefined, 'what is an llm');
    expect(engine.status()).toBe('busy');
    await settle();
    expect(last().message).toMatchObject({ role: 'assistant', model: 'haiku' });
    expect(last().message.text).toContain('You asked: what is an llm.');
    expect(engine.status()).toBe('ready');
    expect(events.filter((e) => e.type === 'message').length).toBeGreaterThan(3);
    expect((await engine.listChats())[0]).toMatchObject({ id, title: 'what is an llm' });
  });

  it('reports a tool call', async () => {
    const engine = new FakeAssistantEngine();
    const { last } = watch(engine);
    await engine.send(undefined, 'add call vendor to thursday');
    await settle();
    expect(last().message.tools).toEqual([
      expect.objectContaining({ name: 'Bash', summary: 'ledge week add "Example" --day thu', status: 'done' }),
    ]);
  });

  it('raises an approval and follows the decision', async () => {
    const engine = new FakeAssistantEngine();
    const { events, last } = watch(engine);
    await engine.send(undefined, 'delete the old task');
    await settle();
    const approval = events.find((e) => e.type === 'approval') as Extract<EngineEvent, { type: 'approval' }>;
    expect(approval.request.reason).toMatch(/Deletes/);
    expect(engine.status()).toBe('busy');
    engine.decide(approval.request.id, 'approved', true);
    await settle();
    expect(engine.decisions).toEqual([{ id: approval.request.id, decision: 'approved', always: true }]);
    expect(last().message.approvals[0]?.decision).toBe('approved');
    expect(last().message.text).toContain('Done, deleted it.');
    expect(engine.status()).toBe('ready');
  });

  it('stops, denying what waits, and deletes chats', async () => {
    const engine = new FakeAssistantEngine();
    const { last } = watch(engine);
    const id = await engine.send(undefined, 'push it');
    await settle();
    expect(engine.pendingApprovals()).toHaveLength(1);
    engine.stop(id);
    await settle();
    expect(last().message.approvals[0]?.decision).toBe('denied');
    expect(engine.status()).toBe('ready');
    await engine.deleteChat(id);
    expect(await engine.loadChat(id)).toBeUndefined();
  });

  it('runs a custom script, including an error, and can show unavailable', async () => {
    const engine = new FakeAssistantEngine({ script: () => [{ text: 'Hi' }, { error: 'Claude Code crashed.' }], warmStatus: 'unavailable', warmDetail: 'missing' });
    const { events, last } = watch(engine);
    engine.warm();
    expect(engine.status()).toBe('unavailable');
    expect(events[0]).toEqual({ type: 'status', status: 'unavailable', detail: 'missing' });
    const id = engine.newChat();
    expect(await engine.send(id, 'x', 'opus')).toBe(id);
    await settle();
    expect(last().message).toMatchObject({ text: 'Hi', error: 'Claude Code crashed.', model: 'opus' });
  });
});
