/**
 * The Assistant tab's state, over whichever AssistantEngine it is given: the chat on screen,
 * its messages as the engine last reported them, the saved chats, the engine's status and the
 * model the person picked. The component draws this and calls its methods; nothing here draws.
 *
 * The engine reports every change to a message as a whole new copy of it, so a message event
 * replaces the message with the same id or appends it, and that is the whole of streaming.
 * Events for another chat are ignored: only one chat is on screen.
 */
import type {
  AssistantEngine,
  Chat,
  ChatMessage,
  EngineEvent,
  EngineStatus,
  ModelChoice,
} from './assistant/types.ts';

export type ChatSummary = Pick<Chat, 'id' | 'title' | 'updated'>;

/** What the error banner says, by what went wrong. */
export interface StatusProblem {
  title: string;
  detail: string;
}

/** Turns the engine's status detail into a heading a person can act on. */
export function problemFor(status: EngineStatus, detail: string): StatusProblem | undefined {
  if (status !== 'unavailable') return undefined;
  const d = detail.trim();
  if (/not installed|not on the path|not found/i.test(d)) {
    return { title: 'Claude Code is not installed', detail: d || 'Install Claude Code and sign in, then retry.' };
  }
  if (/not signed in|log ?in|sign in/i.test(d)) {
    return { title: 'Claude Code is signed out', detail: d || 'Run claude once in a terminal to sign in, then retry.' };
  }
  return { title: 'Claude Code stopped', detail: d || 'The assistant process ended. Retry to start it again.' };
}

/** Saved chats whose title has every word of the query, newest first as given. */
export function filterChats(chats: ChatSummary[], query: string): ChatSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return chats;
  return chats.filter((c) => words.every((w) => c.title.toLowerCase().includes(w)));
}

export class AssistantChat {
  /** The chat on screen. Undefined until the first send, or after New chat. */
  chatId = $state<string | undefined>(undefined);
  title = $state('New chat');
  messages = $state<ChatMessage[]>([]);
  status = $state<EngineStatus>('ready');
  detail = $state('');
  chats = $state<ChatSummary[]>([]);
  model = $state<ModelChoice>('auto');
  /** A send is on its way and the engine has not said busy yet. */
  sending = $state(false);
  /** Why the last send was refused, shown under the input. */
  sendError = $state('');
  /** Approvals answered here whose answer the engine has not echoed yet. */
  answered = $state<Record<string, 'approved' | 'denied'>>({});

  private readonly engine: AssistantEngine;
  private unsubscribe?: () => void;

  constructor(engine: AssistantEngine) {
    this.engine = engine;
    this.status = engine.status();
  }

  /** True while a turn in this chat is running, which is when Stop replaces Send. */
  get running(): boolean {
    if (this.sending) return true;
    if (this.status !== 'busy') return false;
    return this.messages.length > 0;
  }

  /** The tab has messages, so it shows the conversation rather than the idle desk. */
  get chatting(): boolean {
    return this.messages.length > 0;
  }

  /** Starts listening. Returns the way to stop, for an effect's teardown. */
  attach(): () => void {
    this.unsubscribe?.();
    this.unsubscribe = this.engine.subscribe((e) => this.onEvent(e));
    this.status = this.engine.status();
    return () => this.detach();
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Starts the engine's process if it is not running. Also what Retry does. */
  warm(): void {
    this.engine.warm();
    this.status = this.engine.status();
  }

  async send(text: string): Promise<boolean> {
    const words = text.trim();
    if (words === '' || this.running) return false;
    this.sendError = '';
    this.sending = true;
    try {
      if (!this.chatId) this.chatId = this.engine.newChat();
      const id = await this.engine.send(this.chatId, words, this.model);
      this.chatId = id;
      return true;
    } catch (e) {
      this.sendError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.sending = false;
    }
  }

  /** Sends the question that led to a failed answer again. */
  async retry(messageId: string): Promise<void> {
    const at = this.messages.findIndex((m) => m.id === messageId);
    const question = [...this.messages.slice(0, at)].reverse().find((m) => m.role === 'user');
    if (!question) return;
    if (this.status === 'unavailable') this.warm();
    await this.send(question.text);
  }

  stop(): void {
    if (this.chatId) this.engine.stop(this.chatId);
  }

  decide(approvalId: string, decision: 'approved' | 'denied', always = false): void {
    this.answered = { ...this.answered, [approvalId]: decision };
    this.engine.decide(approvalId, decision, always);
  }

  /** Back to the idle desk, on a fresh chat. */
  newChat(): void {
    if (this.running) this.stop();
    this.chatId = this.engine.newChat();
    this.title = 'New chat';
    this.messages = [];
    this.answered = {};
    this.sendError = '';
  }

  async refreshChats(): Promise<void> {
    try {
      this.chats = await this.engine.listChats();
    } catch {
      /* The list stays as it was. */
    }
  }

  async open(id: string): Promise<void> {
    if (id === this.chatId) return;
    const chat = await this.engine.loadChat(id);
    if (!chat) return;
    if (this.running) this.stop();
    this.chatId = chat.id;
    this.title = chat.title;
    this.messages = chat.messages;
    this.answered = {};
    this.sendError = '';
  }

  async remove(id: string): Promise<void> {
    await this.engine.deleteChat(id);
    this.chats = this.chats.filter((c) => c.id !== id);
    if (id === this.chatId) {
      this.chatId = undefined;
      this.title = 'New chat';
      this.messages = [];
      this.answered = {};
    }
  }

  private onEvent(e: EngineEvent): void {
    if (e.type === 'status') {
      this.status = e.status;
      this.detail = e.detail ?? '';
      return;
    }
    if (e.type === 'chats') {
      this.chats = e.chats;
      const mine = e.chats.find((c) => c.id === this.chatId);
      if (mine) this.title = mine.title;
      return;
    }
    if (e.chatId !== this.chatId) return;
    if (e.type === 'message') {
      const i = this.messages.findIndex((m) => m.id === e.message.id);
      if (i === -1) this.messages = [...this.messages, e.message];
      else this.messages = this.messages.map((m, j) => (j === i ? e.message : m));
      if (this.title === 'New chat' && e.message.role === 'user') {
        const first = this.messages.find((m) => m.role === 'user');
        if (first) this.title = first.text.length > 50 ? `${first.text.slice(0, 49).trimEnd()}…` : first.text;
      }
      return;
    }
    /* An approval: its message event carries it too, so the card is drawn from the message.
       This only makes sure a request the message has not caught up with is shown. */
    const i = this.messages.findIndex((m) => m.id === e.messageId);
    if (i === -1) return;
    const m = this.messages[i]!;
    if (m.approvals.some((a) => a.id === e.request.id)) return;
    const next = { ...m, approvals: [...m.approvals, { ...e.request }] };
    this.messages = this.messages.map((x, j) => (j === i ? next : x));
  }
}
