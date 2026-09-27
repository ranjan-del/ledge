/**
 * A scripted AssistantEngine for UI tests and for working on the tab without Claude Code. It
 * keeps chats in memory, streams text a few words at a time, reports tool calls, and raises an
 * approval that waits for `decide()`, all on the same events the real engine sends.
 */
import { newChatId, titleFrom, type ChatSummary } from './history.ts';
import { resolveModel } from './router.ts';
import type {
  ApprovalRequest,
  AssistantEngine,
  Chat,
  ChatMessage,
  EngineEvent,
  EngineStatus,
  ModelChoice,
  ResolvedModel,
  ToolActivity,
} from './types.ts';

export type FakeStep =
  | { text: string }
  | { tool: { name: string; summary: string; status?: ToolActivity['status'] } }
  /** Waits for `decide()`. The steps in `approved` or `denied` then run. */
  | {
      approval: Omit<ApprovalRequest, 'id'>;
      approved?: FakeStep[];
      denied?: FakeStep[];
    }
  | { error: string };

export interface FakeOptions {
  /** Pause between steps and text chunks, in ms. 0 runs on microtasks only. */
  delayMs?: number;
  /** What to do for a message. The default answers, and asks approval for risky-sounding words. */
  script?: (text: string, model: ResolvedModel) => FakeStep[];
  /** Status after `warm()`. Use 'unavailable' to show the error state. */
  warmStatus?: EngineStatus;
  warmDetail?: string;
}

/** The default script: an echo, with a tool and an approval for words that sound risky. */
export function defaultScript(text: string): FakeStep[] {
  if (/\b(delete|remove|push|deploy|grant|send)\b/i.test(text)) {
    return [
      { text: 'Let me check first.' },
      { tool: { name: 'Bash', summary: 'ledge list --json' } },
      {
        approval: {
          tool: 'Bash',
          input: { command: 'ledge delete example-task' },
          summary: 'ledge delete example-task',
          reason: 'Deletes a task for good.',
        },
        approved: [{ tool: { name: 'Bash', summary: 'ledge delete example-task' } }, { text: 'Done, deleted it.' }],
        denied: [{ text: 'Okay, I left it alone.' }],
      },
    ];
  }
  if (/\b(add|todo|to-do|remind)\b/i.test(text)) {
    return [{ tool: { name: 'Bash', summary: 'ledge week add "Example" --day thu' } }, { text: 'Added it to Thursday.' }];
  }
  return [{ text: `You asked: ${text.trim()}. This is the scripted assistant.` }];
}

export class FakeAssistantEngine implements AssistantEngine {
  readonly chats = new Map<string, Chat>();
  readonly sent: { chatId: string; text: string; model: ResolvedModel }[] = [];
  readonly decisions: { id: string; decision: 'approved' | 'denied'; always: boolean }[] = [];
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private readonly waiting = new Map<string, (d: 'approved' | 'denied') => void>();
  private readonly opts: FakeOptions;
  private state: EngineStatus = 'ready';
  private running?: { chatId: string; stopped: boolean };
  private seq = 0;
  warmed = 0;

  constructor(options: FakeOptions = {}) {
    this.opts = options;
  }

  status(): EngineStatus {
    return this.state;
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Sets the status from a test, e.g. to show the Claude Code missing message. */
  setStatus(status: EngineStatus, detail?: string): void {
    this.state = status;
    this.emit({ type: 'status', status, ...(detail ? { detail } : {}) });
  }

  warm(): void {
    this.warmed += 1;
    this.setStatus(this.opts.warmStatus ?? 'ready', this.opts.warmDetail);
  }

  newChat(): string {
    const id = `${newChatId()}-${++this.seq}`;
    const at = new Date().toISOString();
    this.chats.set(id, { id, title: 'New chat', created: at, updated: at, messages: [] });
    return id;
  }

  async send(chatId: string | undefined, text: string, model: ModelChoice = 'auto'): Promise<string> {
    if (this.running) throw new Error('The assistant is still answering. Stop it first.');
    let chat = chatId ? this.chats.get(chatId) : undefined;
    if (!chat) {
      const id = chatId ?? this.newChat();
      chat = this.chats.get(id) ?? { id, title: 'New chat', created: new Date().toISOString(), updated: '', messages: [] };
      this.chats.set(id, chat);
    }
    const resolved = resolveModel(model, text, chat.messages);
    const at = new Date().toISOString();
    if (chat.messages.length === 0) chat.title = titleFrom(text);
    const user: ChatMessage = { id: this.nextId('m'), role: 'user', text: text.trim(), tools: [], approvals: [], at };
    const answer: ChatMessage = { id: this.nextId('m'), role: 'assistant', text: '', model: resolved, tools: [], approvals: [], at };
    chat.messages.push(user, answer);
    chat.updated = at;
    this.sent.push({ chatId: chat.id, text, model: resolved });
    this.emitMessage(chat.id, user);
    this.emitMessage(chat.id, answer);
    this.emitChats();
    this.setStatus('busy');
    const run = { chatId: chat.id, stopped: false };
    this.running = run;
    const script = (this.opts.script ?? defaultScript)(text, resolved);
    void this.play(chat, answer, script, run).finally(() => {
      if (this.running === run) this.running = undefined;
      this.setStatus('ready');
    });
    return chat.id;
  }

  stop(chatId: string): void {
    if (this.running?.chatId !== chatId) return;
    this.running.stopped = true;
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      resolve('denied');
    }
  }

  decide(approvalId: string, decision: 'approved' | 'denied', always = false): void {
    const resolve = this.waiting.get(approvalId);
    if (!resolve) return;
    this.decisions.push({ id: approvalId, decision, always });
    this.waiting.delete(approvalId);
    resolve(decision);
  }

  /** Approval ids waiting for a decision. */
  pendingApprovals(): string[] {
    return [...this.waiting.keys()];
  }

  async listChats(): Promise<ChatSummary[]> {
    return [...this.chats.values()]
      .filter((c) => c.messages.length > 0)
      .map((c) => ({ id: c.id, title: c.title, updated: c.updated }))
      .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  }

  async loadChat(id: string): Promise<Chat | undefined> {
    const c = this.chats.get(id);
    return c ? (JSON.parse(JSON.stringify(c)) as Chat) : undefined;
  }

  async deleteChat(id: string): Promise<void> {
    this.stop(id);
    this.chats.delete(id);
    this.emitChats();
  }

  private async play(chat: Chat, msg: ChatMessage, steps: FakeStep[], run: { stopped: boolean }): Promise<void> {
    for (const step of steps) {
      if (run.stopped) return;
      await this.pause();
      if ('text' in step) {
        const chunks = step.text.match(/\S+\s*/g) ?? [step.text];
        if (msg.text !== '' && !msg.text.endsWith('\n')) msg.text += '\n\n';
        for (const chunk of chunks) {
          if (run.stopped) return;
          msg.text += chunk;
          this.emitMessage(chat.id, msg);
          await this.pause();
        }
      } else if ('tool' in step) {
        const tool: ToolActivity = { id: this.nextId('tool'), name: step.tool.name, summary: step.tool.summary, status: 'running' };
        msg.tools.push(tool);
        this.emitMessage(chat.id, msg);
        await this.pause();
        tool.status = step.tool.status ?? 'done';
        this.emitMessage(chat.id, msg);
      } else if ('approval' in step) {
        const request: ApprovalRequest = { id: this.nextId('approval'), ...step.approval };
        const entry: ChatMessage['approvals'][number] = { ...request };
        msg.approvals.push(entry);
        const decided = new Promise<'approved' | 'denied'>((resolve) => this.waiting.set(request.id, resolve));
        this.emit({ type: 'approval', chatId: chat.id, messageId: msg.id, request: { ...request } });
        this.emitMessage(chat.id, msg);
        const decision = await decided;
        entry.decision = decision;
        this.emitMessage(chat.id, msg);
        if (run.stopped) return;
        await this.play(chat, msg, (decision === 'approved' ? step.approved : step.denied) ?? [], run);
      } else {
        msg.error = step.error;
        this.emitMessage(chat.id, msg);
        return;
      }
    }
  }

  private pause(): Promise<void> {
    const ms = this.opts.delayMs ?? 0;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private emitMessage(chatId: string, m: ChatMessage): void {
    this.emit({
      type: 'message',
      chatId,
      message: { ...m, tools: m.tools.map((t) => ({ ...t })), approvals: m.approvals.map((a) => ({ ...a })) },
    });
  }

  private emitChats(): void {
    void this.listChats().then((chats) => this.emit({ type: 'chats', chats }));
  }

  private emit(e: EngineEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}
