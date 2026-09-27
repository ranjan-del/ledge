/**
 * Synthetic stdout lines in the exact shapes Claude Code 2.1.283 prints with
 * `-p --input-format stream-json --output-format stream-json --verbose
 * --include-partial-messages --permission-prompt-tool stdio`. The shapes (field names and
 * nesting) were copied from a live probe; the ids, text and numbers are made up.
 */
import type { HistoryFs } from '../src/lib/assistant/history.ts';

/** An in-memory file system for chat history, recording each write, rename and remove. */
export function memoryFs() {
  const files = new Map<string, string>();
  const ops: string[] = [];
  const fs: HistoryFs = {
    async readText(p) {
      const t = files.get(p);
      if (t === undefined) throw new Error(`ENOENT ${p}`);
      return t;
    },
    async writeText(p, t) {
      ops.push(`write ${p}`);
      files.set(p, t);
    },
    async rename(a, b) {
      ops.push(`rename ${a} ${b}`);
      const t = files.get(a);
      if (t === undefined) throw new Error('ENOENT');
      files.set(b, t);
      files.delete(a);
    },
    async remove(p) {
      ops.push(`remove ${p}`);
      files.delete(p);
    },
    async list(dir) {
      return [...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1));
    },
    async ensureDir() {},
  };
  return { fs, files, ops };
}

export const SESSION = '11111111-2222-4333-8444-555555555555';

const j = (o: unknown) => JSON.stringify(o);

export const fx = {
  hookStarted: j({
    type: 'system',
    subtype: 'hook_started',
    hook_id: 'h1',
    hook_name: 'SessionStart:startup',
    hook_event: 'SessionStart',
    uuid: 'u0',
    session_id: SESSION,
  }),
  initializeResponse: (requestId: string) =>
    j({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { commands: [], agents: [], output_style: 'default', models: [], account: {} },
      },
    }),
  init: (model = 'claude-sonnet-5', session = SESSION) =>
    j({
      type: 'system',
      subtype: 'init',
      cwd: '/home/t/.ledge',
      session_id: session,
      tools: ['Bash', 'Read'],
      model,
      permissionMode: 'default',
    }),
  status: j({ type: 'system', subtype: 'status', status: 'requesting', session_id: SESSION, uuid: 'u1' }),
  messageStart: (model = 'claude-sonnet-5') =>
    j({
      type: 'stream_event',
      event: { type: 'message_start', message: { model, id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
      session_id: SESSION,
      parent_tool_use_id: null,
      uuid: 'u2',
    }),
  thinkingDelta: j({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    session_id: SESSION,
    parent_tool_use_id: null,
    uuid: 'u3',
  }),
  textDelta: (text: string) =>
    j({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
      session_id: SESSION,
      parent_tool_use_id: null,
      uuid: 'u4',
    }),
  subagentTextDelta: j({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'inner' } },
    session_id: SESSION,
    parent_tool_use_id: 'toolu_parent',
    uuid: 'u5',
  }),
  toolUse: (id: string, name: string, input: Record<string, unknown>) =>
    j({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-5',
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id, name, input, caller: { type: 'direct' } }],
      },
      parent_tool_use_id: null,
      session_id: SESSION,
      uuid: 'u6',
    }),
  canUseTool: (requestId: string, toolUseId: string, name: string, input: Record<string, unknown>) =>
    j({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: name,
        display_name: name,
        input,
        description: 'Synthetic description',
        permission_suggestions: [],
        tool_use_id: toolUseId,
      },
    }),
  toolResult: (id: string, isError = false) =>
    j({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok', is_error: isError }] },
      parent_tool_use_id: null,
      session_id: SESSION,
      uuid: 'u7',
    }),
  toolDenied: (id: string) =>
    j({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'Cancelled', is_error: true, tool_use_id: id }] },
      parent_tool_use_id: null,
      session_id: SESSION,
      uuid: 'u8',
      tool_use_result: 'Error: Cancelled',
      tool_result_meta: [{ id, non_execution_kind: 'permission-rule' }],
    }),
  setModelEcho: j({
    type: 'user',
    message: { role: 'user', content: '<local-command-stdout>Set model to `haiku`</local-command-stdout>' },
    session_id: SESSION,
    parent_tool_use_id: null,
    uuid: 'u9',
    isReplay: true,
  }),
  controlOk: (requestId: string, response?: Record<string, unknown>) =>
    j({ type: 'control_response', response: { subtype: 'success', request_id: requestId, ...(response ? { response } : {}) } }),
  controlErr: (requestId: string, error: string) =>
    j({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } }),
  hookCallback: (requestId: string) =>
    j({ type: 'control_request', request_id: requestId, request: { subtype: 'hook_callback', callback_id: 'c1' } }),
  cancel: (requestId: string) => j({ type: 'control_cancel_request', request_id: requestId }),
  rateLimit: j({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, uuid: 'u10', session_id: SESSION }),
  result: (text: string, session = SESSION) =>
    j({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      result: text,
      stop_reason: 'end_turn',
      session_id: session,
      terminal_reason: 'completed',
    }),
  resultInterrupted: j({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    session_id: SESSION,
    terminal_reason: 'aborted_streaming',
    errors: ['synthetic'],
  }),
  resultError: (text: string) =>
    j({ type: 'result', subtype: 'success', is_error: true, result: text, session_id: SESSION, terminal_reason: 'completed' }),
};
