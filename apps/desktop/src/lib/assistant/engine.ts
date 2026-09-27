/**
 * The assistant engine: one warm Claude Code process, spoken to over the Agent SDK's stdio
 * protocol (./protocol.ts), serving the current chat.
 *
 * - `warm()` starts the process; a crash restarts it with backoff; `dispose()` ends it.
 * - Each turn picks a model (./router.ts) and switches with a `set_model` control request, then
 *   writes the person's words behind a fresh Ledge context preamble (./prompt.ts).
 * - Every tool call the person's settings do not already allow arrives as `can_use_tool`. Safe
 *   ones (./policy.ts) are allowed at once; risky ones become an `approval` event and wait for
 *   `decide()`. "Always" remembers the tool and command prefix for that chat only.
 * - `stop()` sends `interrupt`. Switching chats restarts the process with `--resume` and the
 *   chat's Claude Code session id, or replays a compact transcript when there is none.
 * - Chats are saved through ./history.ts. The title starts as the first message and is replaced
 *   by a short model-written one (`generate_session_title`) after the first answer.
 */
import { failureText } from '../ask.ts';
import { ChatHistory, cleanTitle, newChatId, titleFrom, type ChatRecord, type ChatSummary } from './history.ts';
import { approvalKey, classify } from './policy.ts';
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
  type WireEvent,
} from './protocol.ts';
import { dateLine, replayTranscript, systemPrompt, toolSummary, turnText } from './prompt.ts';
import { resolveModel } from './router.ts';
import type { AgentProcess, AgentRunner } from './runner.ts';
import type {
  ApprovalRequest,
  AssistantEngine,
  Chat,
  ChatMessage,
  EngineEvent,
  EngineStatus,
  ModelChoice,
  ResolvedModel,
} from './types.ts';

/** Waits before each restart after a crash. Past the last, the engine gives up. */
export const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
/** How long an interrupt may take before the process is killed instead. */
export const STOP_GRACE_MS = 5000;
/** How long a title request may take before it is given up. */
export const TITLE_TIMEOUT_MS = 20000;

export interface EngineOptions {
  runner: AgentRunner;
  history: ChatHistory;
  /** The Ledge context block, built fresh at the start of each turn. */
  context?: () => string | Promise<string>;
  /** Names on the desk, for routing (task titles, repositories). */
  deskTerms?: () => readonly string[];
  /** The person's home folder, for the approval policy and summaries. */
  home?: () => string | undefined;
  now?: () => Date;
  /** Ask a model for a short title after the first answer. On by default. */
  modelTitles?: boolean;
  backoffMs?: readonly number[];
  stopGraceMs?: number;
  titleTimeoutMs?: number;
}

interface Proc {
  handle?: AgentProcess;
  started: Promise<AgentProcess | undefined>;
  writes: Promise<unknown>;
  buffer: LineBuffer;
  stderr: string;
  /** The chat this process holds. Undefined for a fresh process no chat has used yet. */
  chatId?: string;
  resumed?: string;
  sessionId?: string;
  model: ResolvedModel;
  initId: string;
  ready: boolean;
  gotInit: boolean;
  /** A transcript still to be sent in front of the next user message. */
  replay?: string;
  killed: boolean;
  closed: boolean;
}

interface Turn {
  chatId: string;
  message: ChatMessage;
  userText: string;
  model: ResolvedModel;
  needBreak: boolean;
  stopping: boolean;
  retried: boolean;
  stopTimer?: ReturnType<typeof setTimeout>;
}

interface PendingApproval {
  chatId: string;
  messageId: string;
  requestId: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  key: string;
  proc: Proc;
}

const copy = (m: ChatMessage): ChatMessage => ({
  ...m,
  tools: m.tools.map((t) => ({ ...t })),
  approvals: m.approvals.map((a) => ({ ...a })),
});

export class ClaudeAssistantEngine implements AssistantEngine {
  private readonly opts: EngineOptions;
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly records = new Map<string, ChatRecord>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly always = new Map<string, Set<string>>();
  private readonly controlWaiters = new Map<string, (ev: Extract<WireEvent, { kind: 'control_response' }>) => void>();
  private readonly titled = new Set<string>();
  private proc?: Proc;
  private turn?: Turn;
  private current?: string;
  private state: EngineStatus = 'ready';
  private detail?: string;
  private wanted = false;
  private attempts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private disposed = false;

  constructor(options: EngineOptions) {
    this.opts = options;
  }

  /* ---------------------------------------------------------------- interface */

  status(): EngineStatus {
    return this.state;
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  warm(): void {
    if (this.disposed) return;
    this.wanted = true;
    this.attempts = 0;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    if (this.proc && !this.proc.closed) return;
    const record = this.current ? this.records.get(this.current) : undefined;
    this.spawn(record, 'sonnet');
  }

  newChat(): string {
    const id = newChatId(this.now());
    const at = this.now().toISOString();
    this.records.set(id, { chat: { id, title: 'New chat', created: at, updated: at, messages: [] } });
    this.current = id;
    // A process holding another chat's session is no use to a new chat: start a clean one now,
    // so the first question does not wait for it.
    if (this.wanted && !this.turn && this.proc && this.proc.chatId !== undefined) {
      this.kill(this.proc);
      this.spawn(undefined, 'sonnet');
    }
    return id;
  }

  async send(chatId: string | undefined, text: string, model: ModelChoice = 'auto'): Promise<string> {
    if (this.disposed) throw new Error('The assistant has shut down.');
    const words = text.trim();
    if (words === '') throw new Error('Nothing to send.');
    if (this.turn) throw new Error('The assistant is still answering. Stop it first.');

    const record = await this.recordFor(chatId);
    const chat = record.chat;
    this.current = chat.id;
    const resolved = resolveModel(model, words, chat.messages, { deskTerms: this.opts.deskTerms?.() });
    const at = this.now().toISOString();
    const first = chat.messages.length === 0;
    const user: ChatMessage = { id: this.id('m'), role: 'user', text: words, tools: [], approvals: [], at };
    const answer: ChatMessage = {
      id: this.id('m'),
      role: 'assistant',
      text: '',
      model: resolved,
      tools: [],
      approvals: [],
      at,
    };
    const earlier = chat.messages.slice();
    chat.messages.push(user, answer);
    if (first) chat.title = titleFrom(words);
    chat.updated = at;
    this.turn = { chatId: chat.id, message: answer, userText: words, model: resolved, needBreak: false, stopping: false, retried: false };
    this.emit({ type: 'message', chatId: chat.id, message: copy(user) });
    this.emit({ type: 'message', chatId: chat.id, message: copy(answer) });
    this.setStatus('busy');
    void this.save(record, true);

    const proc = this.procFor(record, resolved, earlier);
    await this.dispatch(proc, this.turn);
    return chat.id;
  }

  stop(chatId: string): void {
    const turn = this.turn;
    if (!turn || turn.chatId !== chatId || turn.stopping) return;
    turn.stopping = true;
    const proc = this.proc;
    for (const [id, p] of this.approvals) {
      if (p.chatId === chatId) this.answerApproval(id, p, 'denied', 'Stopped by the person.');
    }
    if (!proc || proc.closed) {
      this.finishTurn({ stopped: true });
      return;
    }
    this.write(proc, interruptRequest(this.id('interrupt')));
    turn.stopTimer = setTimeout(() => {
      if (this.turn !== turn) return;
      // The interrupt went unanswered: end the process, which also ends the turn.
      this.finishTurn({ stopped: true });
      this.kill(proc);
      if (this.wanted) this.spawn(this.records.get(chatId), turn.model);
    }, this.opts.stopGraceMs ?? STOP_GRACE_MS);
  }

  decide(approvalId: string, decision: 'approved' | 'denied', always = false): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) return;
    if (decision === 'approved' && always) {
      const set = this.always.get(pending.chatId) ?? new Set<string>();
      set.add(pending.key);
      this.always.set(pending.chatId, set);
    }
    this.answerApproval(approvalId, pending, decision, 'The person cancelled this action. Do not try another way to do it.');
  }

  async listChats(): Promise<ChatSummary[]> {
    return this.opts.history.list();
  }

  async loadChat(id: string): Promise<Chat | undefined> {
    const record = this.records.get(id) ?? (await this.opts.history.load(id));
    if (!record) return undefined;
    this.records.set(id, record);
    this.current = id;
    // Opening another chat moves the warm process over to it, unless a turn is running.
    const proc = this.proc;
    if (this.wanted && !this.turn && proc && !proc.closed && !this.fits(proc, record)) {
      this.kill(proc);
      this.spawn(record, proc.model);
    }
    return structuredCopy(record.chat);
  }

  async deleteChat(id: string): Promise<void> {
    if (this.turn?.chatId === id) {
      this.stop(id);
      this.finishTurn({ stopped: true, save: false });
    }
    this.records.delete(id);
    this.always.delete(id);
    if (this.current === id) this.current = undefined;
    if (this.proc && this.proc.chatId === id) {
      this.kill(this.proc);
      if (this.wanted) this.spawn(undefined, 'sonnet');
    }
    await this.opts.history.remove(id);
    await this.emitChats();
  }

  /** Ends the process and all timers, for app quit and tests. */
  dispose(): void {
    this.disposed = true;
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.turn?.stopTimer) clearTimeout(this.turn.stopTimer);
    if (this.proc) this.kill(this.proc);
  }

  /* ---------------------------------------------------------------- process */

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  private async recordFor(chatId: string | undefined): Promise<ChatRecord> {
    if (chatId) {
      const known = this.records.get(chatId) ?? (await this.opts.history.load(chatId));
      if (known) {
        this.records.set(chatId, known);
        return known;
      }
    }
    const id = chatId ?? newChatId(this.now());
    const at = this.now().toISOString();
    const record: ChatRecord = { chat: { id, title: 'New chat', created: at, updated: at, messages: [] } };
    this.records.set(id, record);
    return record;
  }

  /** True when this process can serve this chat without a restart. */
  private fits(proc: Proc, record: ChatRecord): boolean {
    if (proc.chatId !== undefined) return proc.chatId === record.chat.id;
    // A fresh process has no session yet, so it suits a chat that has none to resume.
    return !record.sessionId;
  }

  /** The live process for this chat, starting or switching one when needed. */
  private procFor(record: ChatRecord, model: ResolvedModel, earlier: ChatMessage[]): Proc {
    let proc = this.proc;
    if (proc && !proc.closed && this.fits(proc, record)) {
      if (proc.chatId === undefined) {
        proc.chatId = record.chat.id;
        if (earlier.length > 0) proc.replay = replayTranscript(earlier);
      }
      return proc;
    }
    if (proc) this.kill(proc);
    proc = this.spawn(record, model, earlier);
    return proc;
  }

  private spawn(record: ChatRecord | undefined, model: ResolvedModel, earlier?: ChatMessage[]): Proc {
    const resume = record?.sessionId;
    const messages = earlier ?? record?.chat.messages ?? [];
    const proc: Proc = {
      started: Promise.resolve(undefined),
      writes: Promise.resolve(),
      buffer: new LineBuffer(),
      stderr: '',
      chatId: record?.chat.id,
      resumed: resume,
      model,
      initId: this.id('init'),
      ready: false,
      gotInit: false,
      replay: !resume && messages.length > 0 ? replayTranscript(messages) : undefined,
      killed: false,
      closed: false,
    };
    this.proc = proc;
    if (!this.turn) this.setStatus('starting');
    proc.started = this.opts
      .runner(
        { model, systemPrompt: systemPrompt(dateLine(this.now())), resume },
        {
          stdout: (chunk) => this.onStdout(proc, chunk),
          stderr: (chunk) => {
            proc.stderr = `${proc.stderr}${chunk}`.slice(-4000);
          },
          close: (code, detail) => this.onClose(proc, code, detail),
        },
      )
      .then(
        (handle) => {
          proc.handle = handle;
          if (proc.killed) void handle.kill().catch(() => {});
          return handle;
        },
        (e: unknown) => {
          this.onClose(proc, null, e instanceof Error ? e.message : String(e));
          return undefined;
        },
      );
    this.write(proc, initializeRequest(proc.initId));
    return proc;
  }

  private write(proc: Proc, line: string): Promise<void> {
    const next = proc.writes.then(async () => {
      const handle = await proc.started;
      if (!handle || proc.closed || proc.killed) return;
      await handle.write(line);
    });
    proc.writes = next.catch(() => {});
    return next.catch(() => {});
  }

  private kill(proc: Proc): void {
    if (proc.killed) return;
    proc.killed = true;
    for (const [id, p] of this.approvals) if (p.proc === proc) this.approvals.delete(id);
    if (this.proc === proc) this.proc = undefined;
    void proc.started.then((h) => h?.kill()).catch(() => {});
  }

  private async dispatch(proc: Proc, turn: Turn): Promise<void> {
    if (proc.model !== turn.model) {
      const requestId = this.id('model');
      const previous = proc.model;
      proc.model = turn.model;
      this.controlWaiters.set(requestId, (ev) => {
        if (ev.ok) return;
        // The installed Claude Code refused the switch: say which model really answered.
        proc.model = previous;
        if (this.turn === turn) {
          turn.message.model = previous;
          this.emitMessage(turn);
        }
      });
      void this.write(proc, setModelRequest(requestId, turn.model));
    }
    let context: string | undefined;
    try {
      context = await this.opts.context?.();
    } catch {
      context = undefined;
    }
    const replay = proc.replay;
    proc.replay = undefined;
    await this.write(proc, userMessage(turnText(turn.userText, { now: this.now(), context, replay })));
  }

  private onStdout(proc: Proc, chunk: string): void {
    if (proc !== this.proc || proc.killed) return;
    for (const line of proc.buffer.push(chunk)) {
      for (const ev of parseLine(line)) this.onEvent(proc, ev);
    }
  }

  private onEvent(proc: Proc, ev: WireEvent): void {
    const turn = this.turn;
    switch (ev.kind) {
      case 'init': {
        proc.gotInit = true;
        proc.sessionId = ev.sessionId;
        const record = proc.chatId ? this.records.get(proc.chatId) : undefined;
        if (record && record.sessionId !== ev.sessionId) {
          record.sessionId = ev.sessionId;
          void this.save(record, false);
        }
        return;
      }
      case 'control_response': {
        if (ev.requestId === proc.initId) {
          proc.ready = true;
          this.attempts = 0;
          if (!this.turn) this.setStatus('ready');
          return;
        }
        const waiter = this.controlWaiters.get(ev.requestId);
        if (waiter) {
          this.controlWaiters.delete(ev.requestId);
          waiter(ev);
        }
        return;
      }
      case 'control_request':
        void this.write(proc, controlError(ev.requestId, `Ledge does not handle ${ev.subtype || 'this request'}.`));
        return;
      case 'control_cancel': {
        const pending = this.approvals.get(ev.requestId);
        if (pending) {
          this.approvals.delete(ev.requestId);
          this.markApproval(pending, 'denied');
        }
        return;
      }
      case 'permission':
        this.onPermission(proc, ev);
        return;
      default:
        break;
    }
    if (!turn) return;
    const msg = turn.message;
    switch (ev.kind) {
      case 'message_start':
        if (msg.text !== '') turn.needBreak = true;
        return;
      case 'text':
        if (turn.needBreak && !msg.text.endsWith('\n\n')) msg.text += msg.text.endsWith('\n') ? '\n' : '\n\n';
        turn.needBreak = false;
        msg.text += ev.delta;
        this.emitMessage(turn);
        return;
      case 'tool_use':
        if (!msg.tools.some((t) => t.id === ev.id)) {
          msg.tools.push({ id: ev.id, name: ev.name, summary: toolSummary(ev.name, ev.input, this.opts.home?.()), status: 'running' });
          this.emitMessage(turn);
        }
        return;
      case 'tool_result': {
        const tool = msg.tools.find((t) => t.id === ev.id);
        if (tool) {
          tool.status = tool.status === 'denied' || ev.denied ? 'denied' : ev.isError ? 'error' : 'done';
          this.emitMessage(turn);
        }
        return;
      }
      case 'result':
        if (ev.sessionId && proc.chatId) {
          const record = this.records.get(proc.chatId);
          if (record && !record.sessionId) record.sessionId = ev.sessionId;
        }
        if (turn.stopping || ev.interrupted) this.finishTurn({ stopped: true });
        else if (ev.isError) this.finishTurn({ error: ev.text.trim() || 'Claude Code could not finish this answer.' });
        else this.finishTurn({ text: ev.text });
        return;
      default:
        return;
    }
  }

  private onPermission(proc: Proc, ev: Extract<WireEvent, { kind: 'permission' }>): void {
    const turn = this.turn;
    if (!turn || turn.stopping) {
      void this.write(proc, denyTool(ev.requestId, 'Nothing is running in Ledge right now.', ev.toolUseId));
      return;
    }
    const verdict = classify(ev.tool, ev.input, { home: this.opts.home?.() });
    const key = approvalKey(ev.tool, ev.input);
    if (!verdict.risky || this.always.get(turn.chatId)?.has(key)) {
      void this.write(proc, allowTool(ev.requestId, ev.input, ev.toolUseId));
      return;
    }
    const request: ApprovalRequest = {
      id: ev.requestId,
      tool: ev.tool,
      input: ev.input,
      summary: toolSummary(ev.tool, ev.input, this.opts.home?.()),
      reason: verdict.reason ?? 'Needs your approval.',
    };
    this.approvals.set(ev.requestId, {
      chatId: turn.chatId,
      messageId: turn.message.id,
      requestId: ev.requestId,
      toolUseId: ev.toolUseId,
      input: ev.input,
      key,
      proc,
    });
    turn.message.approvals.push({ ...request });
    this.emit({ type: 'approval', chatId: turn.chatId, messageId: turn.message.id, request: { ...request } });
    this.emitMessage(turn);
    const record = this.records.get(turn.chatId);
    if (record) void this.save(record, false);
  }

  private answerApproval(id: string, p: PendingApproval, decision: 'approved' | 'denied', denyMessage: string): void {
    this.approvals.delete(id);
    if (!p.proc.closed && !p.proc.killed) {
      void this.write(
        p.proc,
        decision === 'approved' ? allowTool(p.requestId, p.input, p.toolUseId) : denyTool(p.requestId, denyMessage, p.toolUseId),
      );
    }
    this.markApproval(p, decision);
  }

  private markApproval(p: PendingApproval, decision: 'approved' | 'denied'): void {
    const record = this.records.get(p.chatId);
    const msg = record?.chat.messages.find((m) => m.id === p.messageId);
    if (!record || !msg) return;
    const approval = msg.approvals.find((a) => a.id === p.requestId);
    if (approval) approval.decision = decision;
    if (decision === 'denied' && p.toolUseId) {
      const tool = msg.tools.find((t) => t.id === p.toolUseId);
      if (tool) tool.status = 'denied';
    }
    this.emit({ type: 'message', chatId: p.chatId, message: copy(msg) });
    void this.save(record, false);
  }

  private finishTurn(end: { text?: string; error?: string; stopped?: boolean; save?: boolean }): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    const msg = turn.message;
    if (end.text && msg.text.trim() === '') msg.text = end.text;
    if (end.error) msg.error = end.error;
    for (const t of msg.tools) if (t.status === 'running') t.status = end.error || end.stopped ? 'error' : 'done';
    for (const [id, p] of this.approvals) {
      if (p.messageId === msg.id) {
        this.approvals.delete(id);
        const a = msg.approvals.find((x) => x.id === id);
        if (a && !a.decision) a.decision = 'denied';
      }
    }
    this.emitMessage(turn);
    const record = this.records.get(turn.chatId);
    if (record) {
      record.chat.updated = this.now().toISOString();
      if (end.save !== false) void this.save(record, true);
      if (!end.error && !end.stopped) this.maybeTitle(record);
    }
    const proc = this.proc;
    if (this.state === 'busy') this.setStatus(proc && !proc.closed ? (proc.ready ? 'ready' : 'starting') : 'ready');
  }

  private onClose(proc: Proc, code: number | null, detail?: string): void {
    if (proc.closed) return;
    proc.closed = true;
    for (const [id, p] of this.approvals) if (p.proc === proc) this.approvals.delete(id);
    const current = this.proc === proc;
    if (current) this.proc = undefined;
    if (proc.killed || !current || this.disposed) return;

    const stderr = `${proc.stderr}${detail ? `\n${detail}` : ''}`;
    const why = failureText(code, stderr);
    const turn = this.turn;

    // A saved session that no longer exists: start clean and replay the chat instead.
    if (turn && proc.resumed && !proc.gotInit && !turn.retried) {
      turn.retried = true;
      const record = this.records.get(turn.chatId);
      if (record) {
        record.sessionId = undefined;
        const earlier = record.chat.messages.slice(0, -2);
        const next = this.spawn(record, turn.model, earlier);
        void this.dispatch(next, turn);
        return;
      }
    }

    if (turn) {
      if (turn.stopping) this.finishTurn({ stopped: true });
      else this.finishTurn({ error: why });
    }
    const fatal = code === 127 || /not signed in/.test(why);
    if (fatal) {
      this.setStatus('unavailable', why);
      return;
    }
    const backoff = this.opts.backoffMs ?? RESTART_BACKOFF_MS;
    if (!this.wanted) {
      this.setStatus('ready');
      return;
    }
    if (this.attempts >= backoff.length) {
      this.setStatus('unavailable', why);
      return;
    }
    const wait = backoff[this.attempts]!;
    this.attempts += 1;
    this.setStatus('starting', why);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.disposed || this.proc) return;
      const record = this.current ? this.records.get(this.current) : undefined;
      this.spawn(record, 'sonnet');
    }, wait);
  }

  /* ---------------------------------------------------------------- titles */

  private maybeTitle(record: ChatRecord): void {
    const chat = record.chat;
    if (this.opts.modelTitles === false || this.titled.has(chat.id)) return;
    if (chat.messages.length !== 2) return;
    const [question, answer] = chat.messages;
    if (!question || !answer || answer.text.trim() === '') return;
    const proc = this.proc;
    if (!proc || proc.closed || proc.killed) return;
    this.titled.add(chat.id);
    const requestId = this.id('title');
    const fallback = chat.title;
    const timer = setTimeout(() => this.controlWaiters.delete(requestId), this.opts.titleTimeoutMs ?? TITLE_TIMEOUT_MS);
    this.controlWaiters.set(requestId, (ev) => {
      clearTimeout(timer);
      const raw = ev.ok && typeof ev.response?.title === 'string' ? ev.response.title : '';
      const title = cleanTitle(raw);
      if (!title || chat.title !== fallback || !this.records.has(chat.id)) return;
      chat.title = title;
      void this.save(record, true);
    });
    const description = `A chat in a personal task assistant. First message: ${question.text.slice(0, 300)}\nAnswer: ${answer.text.slice(0, 300)}`;
    void this.write(proc, titleRequest(requestId, description));
  }

  /* ---------------------------------------------------------------- events */

  private async save(record: ChatRecord, announce: boolean): Promise<void> {
    if (!this.records.has(record.chat.id)) return;
    try {
      await this.opts.history.save(record);
      if (announce) await this.emitChats();
    } catch {
      /* A refused write keeps the chat in memory; the next save tries again. */
    }
  }

  private async emitChats(): Promise<void> {
    try {
      this.emit({ type: 'chats', chats: await this.opts.history.list() });
    } catch {
      /* Listing is best effort. */
    }
  }

  private emitMessage(turn: Turn): void {
    this.emit({ type: 'message', chatId: turn.chatId, message: copy(turn.message) });
  }

  private setStatus(status: EngineStatus, detail?: string): void {
    if (this.state === status && this.detail === detail) return;
    this.state = status;
    this.detail = detail;
    this.emit({ type: 'status', status, ...(detail ? { detail } : {}) });
  }

  private emit(e: EngineEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch {
        /* One listener's bug must not stop the others. */
      }
    }
  }
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
