/**
 * The wire between Ledge and one long-lived Claude Code process: newline-delimited JSON both
 * ways, as the Claude Agent SDK speaks it. Claude Code runs as
 *
 *   claude -p --input-format stream-json --output-format stream-json --verbose
 *          --include-partial-messages --permission-prompt-tool stdio
 *
 * and then reads user messages and control messages from stdin, and prints stream events,
 * whole messages, results and control messages on stdout. Everything here is pure: a parser
 * for one stdout line and builders for the lines Ledge writes.
 *
 * Verified live against Claude Code 2.1.283 (see the engine report): several user messages on
 * one process, `can_use_tool` requests answered over stdin, `set_model` between turns,
 * `interrupt` mid turn, `generate_session_title`, and `--resume <id>` keeping the session id.
 */

/* ------------------------------------------------------------------ what comes out */

export type WireEvent =
  /** `system/init`, printed at the start of every turn with the session id and model. */
  | { kind: 'init'; sessionId: string; model?: string }
  /** A new assistant API message began streaming. */
  | { kind: 'message_start'; model?: string }
  | { kind: 'text'; delta: string }
  /** A tool call the main agent made (subagent calls are left out). */
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** The result of a tool call. `denied` when a permission answer refused it. */
  | { kind: 'tool_result'; id: string; isError: boolean; denied: boolean }
  /** The turn finished. `interrupted` when an interrupt ended it. */
  | { kind: 'result'; text: string; isError: boolean; interrupted: boolean; sessionId?: string }
  /** Claude Code asks whether a tool may run. Answer with `allowTool` or `denyTool`. */
  | {
      kind: 'permission';
      requestId: string;
      tool: string;
      input: Record<string, unknown>;
      toolUseId?: string;
      description?: string;
      agentId?: string;
    }
  /** Any other control request from Claude Code. Answer with `controlError` so it never waits. */
  | { kind: 'control_request'; requestId: string; subtype: string }
  /** Claude Code withdrew a control request it sent (for example a permission prompt). */
  | { kind: 'control_cancel'; requestId: string }
  /** The answer to a control request Ledge sent. */
  | {
      kind: 'control_response';
      requestId: string;
      ok: boolean;
      response?: Record<string, unknown>;
      error?: string;
    };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Reads one stdout line into the events the engine acts on. A line that is not JSON, or a
 * kind of message the engine has no use for (hooks, rate limits, thinking), is no event. The
 * stream carries far more than the engine needs and its extra fields change between versions,
 * so only the fields named here are relied on.
 */
export function parseLine(line: string): WireEvent[] {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed[0] !== '{') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObject(raw)) return [];
  switch (raw.type) {
    case 'system': {
      if (raw.subtype !== 'init') return [];
      const sessionId = str(raw.session_id);
      return sessionId ? [{ kind: 'init', sessionId, model: str(raw.model) }] : [];
    }
    case 'stream_event': {
      // Subagent streams carry a parent tool use id; only the main agent's words are shown.
      if (raw.parent_tool_use_id != null || !isObject(raw.event)) return [];
      const ev = raw.event;
      if (ev.type === 'message_start') {
        const model = isObject(ev.message) ? str(ev.message.model) : undefined;
        return [{ kind: 'message_start', model }];
      }
      if (ev.type === 'content_block_delta' && isObject(ev.delta) && ev.delta.type === 'text_delta') {
        const text = str(ev.delta.text);
        return text ? [{ kind: 'text', delta: text }] : [];
      }
      return [];
    }
    case 'assistant': {
      if (raw.parent_tool_use_id != null) return [];
      if (!isObject(raw.message) || !Array.isArray(raw.message.content)) return [];
      const out: WireEvent[] = [];
      for (const block of raw.message.content) {
        if (!isObject(block) || block.type !== 'tool_use') continue;
        const id = str(block.id);
        const name = str(block.name);
        if (!id || !name) continue;
        out.push({ kind: 'tool_use', id, name, input: isObject(block.input) ? block.input : {} });
      }
      return out;
    }
    case 'user': {
      if (raw.parent_tool_use_id != null) return [];
      if (!isObject(raw.message) || !Array.isArray(raw.message.content)) return [];
      const deniedIds = new Set<string>();
      if (Array.isArray(raw.tool_result_meta)) {
        for (const m of raw.tool_result_meta) {
          if (isObject(m) && typeof m.id === 'string' && m.non_execution_kind === 'permission-rule') {
            deniedIds.add(m.id);
          }
        }
      }
      const out: WireEvent[] = [];
      for (const block of raw.message.content) {
        if (!isObject(block) || block.type !== 'tool_result') continue;
        const id = str(block.tool_use_id);
        if (!id) continue;
        out.push({ kind: 'tool_result', id, isError: block.is_error === true, denied: deniedIds.has(id) });
      }
      return out;
    }
    case 'result': {
      const interrupted =
        raw.terminal_reason === 'aborted_streaming' ||
        raw.terminal_reason === 'aborted' ||
        raw.subtype === 'error_during_execution';
      return [
        {
          kind: 'result',
          text: str(raw.result) ?? '',
          isError: raw.is_error === true || raw.subtype !== 'success',
          interrupted,
          sessionId: str(raw.session_id),
        },
      ];
    }
    case 'control_request': {
      const requestId = str(raw.request_id);
      if (!requestId || !isObject(raw.request)) return [];
      const req = raw.request;
      const subtype = str(req.subtype) ?? '';
      if (subtype === 'can_use_tool') {
        return [
          {
            kind: 'permission',
            requestId,
            tool: str(req.tool_name) ?? 'unknown',
            input: isObject(req.input) ? req.input : {},
            toolUseId: str(req.tool_use_id),
            description: str(req.description),
            agentId: str(req.agent_id),
          },
        ];
      }
      return [{ kind: 'control_request', requestId, subtype }];
    }
    case 'control_cancel_request': {
      const requestId = str(raw.request_id);
      return requestId ? [{ kind: 'control_cancel', requestId }] : [];
    }
    case 'control_response': {
      if (!isObject(raw.response)) return [];
      const r = raw.response;
      const requestId = str(r.request_id);
      if (!requestId) return [];
      if (r.subtype === 'success') {
        return [
          { kind: 'control_response', requestId, ok: true, response: isObject(r.response) ? r.response : undefined },
        ];
      }
      return [{ kind: 'control_response', requestId, ok: false, error: str(r.error) ?? 'error' }];
    }
    default:
      return [];
  }
}

/**
 * Collects stdout chunks into whole lines. The shell plugin usually hands over one line per
 * event without its newline, but a chunk may also hold several lines or part of one; both are
 * handled by treating a chunk with no trailing newline as ending a line only when it parses.
 */
export class LineBuffer {
  private pending = '';

  /** Feeds one chunk and returns the complete lines it finished. */
  push(chunk: string): string[] {
    this.pending += chunk;
    const lines: string[] = [];
    let at = this.pending.indexOf('\n');
    while (at !== -1) {
      lines.push(this.pending.slice(0, at));
      this.pending = this.pending.slice(at + 1);
      at = this.pending.indexOf('\n');
    }
    if (this.pending !== '' && isWholeJson(this.pending)) {
      lines.push(this.pending);
      this.pending = '';
    }
    return lines.filter((l) => l.trim() !== '');
  }
}

function isWholeJson(s: string): boolean {
  const t = s.trim();
  if (t === '' || t[0] !== '{' || t[t.length - 1] !== '}') return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ what goes in */

const lineOf = (o: unknown): string => `${JSON.stringify(o)}\n`;

/** One user turn. */
export function userMessage(text: string): string {
  return lineOf({
    type: 'user',
    session_id: '',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  });
}

/** A control request from Ledge. `request` holds the subtype and its fields. */
export function controlRequest(requestId: string, request: Record<string, unknown> & { subtype: string }): string {
  return lineOf({ type: 'control_request', request_id: requestId, request });
}

/** The handshake the SDK sends first. Its answer lists commands, models and the account. */
export function initializeRequest(requestId: string): string {
  return controlRequest(requestId, { subtype: 'initialize' });
}

/** Switches the model for the next turns. Takes an alias such as `haiku` or `opus`. */
export function setModelRequest(requestId: string, model: string): string {
  return controlRequest(requestId, { subtype: 'set_model', model });
}

/** Ends the running turn. The turn then finishes with an `error_during_execution` result. */
export function interruptRequest(requestId: string): string {
  return controlRequest(requestId, { subtype: 'interrupt' });
}

/** Asks Claude Code for a short title for the session (a small model writes it). */
export function titleRequest(requestId: string, description: string): string {
  return controlRequest(requestId, { subtype: 'generate_session_title', description, persist: false });
}

function controlSuccess(requestId: string, response: Record<string, unknown>): string {
  return lineOf({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
}

/** Lets a tool run, with its input unchanged. */
export function allowTool(requestId: string, input: Record<string, unknown>, toolUseId?: string): string {
  return controlSuccess(requestId, {
    behavior: 'allow',
    updatedInput: input,
    ...(toolUseId ? { toolUseID: toolUseId } : {}),
  });
}

/** Refuses a tool. The model sees `message` as the tool's error and carries on. */
export function denyTool(requestId: string, message: string, toolUseId?: string, interrupt = false): string {
  return controlSuccess(requestId, {
    behavior: 'deny',
    message,
    ...(interrupt ? { interrupt: true } : {}),
    ...(toolUseId ? { toolUseID: toolUseId } : {}),
  });
}

/** Answers a control request Ledge does not handle, so Claude Code does not wait on it. */
export function controlError(requestId: string, error: string): string {
  return lineOf({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } });
}
