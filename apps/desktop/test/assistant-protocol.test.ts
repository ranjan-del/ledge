import { describe, expect, it } from 'vitest';
import {
  LineBuffer,
  allowTool,
  controlError,
  denyTool,
  initializeRequest,
  interruptRequest,
  parseLine,
  setModelRequest,
  titleRequest,
  userMessage,
} from '../src/lib/assistant/protocol.ts';
import { SESSION, fx } from './assistant-fixtures.ts';

const parsed = (line: string) => JSON.parse(line) as Record<string, any>;

describe('parseLine', () => {
  it('reads init, message starts and text deltas', () => {
    expect(parseLine(fx.init('claude-haiku-4-5'))).toEqual([
      { kind: 'init', sessionId: SESSION, model: 'claude-haiku-4-5' },
    ]);
    expect(parseLine(fx.messageStart('claude-opus-5'))).toEqual([{ kind: 'message_start', model: 'claude-opus-5' }]);
    expect(parseLine(fx.textDelta('Hello'))).toEqual([{ kind: 'text', delta: 'Hello' }]);
  });

  it('reads tool calls and their results, and tells a permission denial apart', () => {
    expect(parseLine(fx.toolUse('t1', 'Bash', { command: 'ledge week --json' }))).toEqual([
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ledge week --json' } },
    ]);
    expect(parseLine(fx.toolResult('t1'))).toEqual([{ kind: 'tool_result', id: 't1', isError: false, denied: false }]);
    expect(parseLine(fx.toolResult('t1', true))).toEqual([{ kind: 'tool_result', id: 't1', isError: true, denied: false }]);
    expect(parseLine(fx.toolDenied('t2'))).toEqual([{ kind: 'tool_result', id: 't2', isError: true, denied: true }]);
  });

  it('reads can_use_tool as a permission request', () => {
    expect(parseLine(fx.canUseTool('r1', 't1', 'Bash', { command: 'git push' }))).toEqual([
      {
        kind: 'permission',
        requestId: 'r1',
        tool: 'Bash',
        input: { command: 'git push' },
        toolUseId: 't1',
        description: 'Synthetic description',
        agentId: undefined,
      },
    ]);
  });

  it('reads other control requests, cancels and responses', () => {
    expect(parseLine(fx.hookCallback('r9'))).toEqual([{ kind: 'control_request', requestId: 'r9', subtype: 'hook_callback' }]);
    expect(parseLine(fx.cancel('r1'))).toEqual([{ kind: 'control_cancel', requestId: 'r1' }]);
    expect(parseLine(fx.controlOk('m1'))).toEqual([{ kind: 'control_response', requestId: 'm1', ok: true, response: undefined }]);
    expect(parseLine(fx.controlOk('t1', { title: 'A title' }))).toEqual([
      { kind: 'control_response', requestId: 't1', ok: true, response: { title: 'A title' } },
    ]);
    expect(parseLine(fx.controlErr('m2', 'nope'))).toEqual([
      { kind: 'control_response', requestId: 'm2', ok: false, error: 'nope' },
    ]);
  });

  it('reads results, including an interrupted one and an error', () => {
    expect(parseLine(fx.result('Done.'))).toEqual([
      { kind: 'result', text: 'Done.', isError: false, interrupted: false, sessionId: SESSION },
    ]);
    expect(parseLine(fx.resultInterrupted)).toEqual([
      { kind: 'result', text: '', isError: true, interrupted: true, sessionId: SESSION },
    ]);
    expect(parseLine(fx.resultError('Not logged in'))[0]).toMatchObject({ isError: true, interrupted: false });
  });

  it('ignores hooks, status, thinking, rate limits, echoes, subagent streams and junk', () => {
    for (const l of [
      fx.hookStarted,
      fx.status,
      fx.thinkingDelta,
      fx.rateLimit,
      fx.setModelEcho,
      fx.subagentTextDelta,
      'not json',
      '',
      '[1,2]',
      '{"type":',
    ]) {
      expect(parseLine(l)).toEqual([]);
    }
  });
});

describe('LineBuffer', () => {
  it('splits chunks holding several lines, and joins a line split over chunks', () => {
    const b = new LineBuffer();
    const a = fx.textDelta('a');
    const c = fx.result('x');
    expect(b.push(`${a}\n${c.slice(0, 10)}`)).toEqual([a]);
    expect(b.push(c.slice(10))).toEqual([c]);
  });

  it('takes a whole line handed over without its newline, as the shell plugin does', () => {
    const b = new LineBuffer();
    expect(b.push(fx.status)).toEqual([fx.status]);
    expect(b.push('')).toEqual([]);
  });
});

describe('builders', () => {
  it('writes a user message in the SDK shape, one line', () => {
    const l = userMessage('hi');
    expect(l.endsWith('\n')).toBe(true);
    expect(l.trim().includes('\n')).toBe(false);
    expect(parsed(l)).toEqual({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      parent_tool_use_id: null,
    });
    expect(userMessage('a\nb').trim().includes('\n')).toBe(false);
  });

  it('writes control requests', () => {
    expect(parsed(initializeRequest('i1'))).toEqual({ type: 'control_request', request_id: 'i1', request: { subtype: 'initialize' } });
    expect(parsed(setModelRequest('m1', 'haiku')).request).toEqual({ subtype: 'set_model', model: 'haiku' });
    expect(parsed(interruptRequest('x1')).request).toEqual({ subtype: 'interrupt' });
    expect(parsed(titleRequest('t1', 'about')).request).toEqual({
      subtype: 'generate_session_title',
      description: 'about',
      persist: false,
    });
  });

  it('answers permission requests', () => {
    expect(parsed(allowTool('r1', { command: 'ls' }, 't1'))).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' }, toolUseID: 't1' },
      },
    });
    expect(parsed(denyTool('r2', 'No', 't2')).response.response).toEqual({
      behavior: 'deny',
      message: 'No',
      toolUseID: 't2',
    });
    expect(parsed(denyTool('r3', 'Stop', undefined, true)).response.response).toEqual({
      behavior: 'deny',
      message: 'Stop',
      interrupt: true,
    });
    expect(parsed(controlError('r4', 'unsupported')).response).toEqual({
      subtype: 'error',
      request_id: 'r4',
      error: 'unsupported',
    });
  });
});
