/**
 * The assistant engine's interface, shared with the UI. It is fixed by the assistant tab
 * contract (docs/superpowers/specs/2026-09-27-assistant-tab-contract.md) and must stay exactly
 * as written there, because the UI stream codes against it in parallel.
 */

export type ModelChoice = 'auto' | 'haiku' | 'sonnet' | 'opus';
export type ResolvedModel = 'haiku' | 'sonnet' | 'opus';

export interface ToolActivity {
  id: string;
  name: string;
  summary: string;
  status: 'running' | 'done' | 'error' | 'denied';
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: unknown;
  summary: string; // one line: what it will do
  reason: string; // why it needs approval
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string; // for assistant, the full text so far
  model?: ResolvedModel;
  tools: ToolActivity[];
  approvals: (ApprovalRequest & { decision?: 'approved' | 'denied' })[];
  at: string; // ISO
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: ChatMessage[];
}

export type EngineStatus = 'starting' | 'ready' | 'busy' | 'unavailable';

export type EngineEvent =
  | { type: 'status'; status: EngineStatus; detail?: string }
  | { type: 'message'; chatId: string; message: ChatMessage } // any change to a message; UI replaces by id
  | { type: 'approval'; chatId: string; messageId: string; request: ApprovalRequest }
  | { type: 'chats'; chats: Pick<Chat, 'id' | 'title' | 'updated'>[] };

export interface AssistantEngine {
  status(): EngineStatus;
  subscribe(fn: (e: EngineEvent) => void): () => void;
  send(chatId: string | undefined, text: string, model?: ModelChoice): Promise<string>; // returns chatId
  stop(chatId: string): void;
  decide(approvalId: string, decision: 'approved' | 'denied', always?: boolean): void;
  newChat(): string;
  listChats(): Promise<Pick<Chat, 'id' | 'title' | 'updated'>[]>;
  loadChat(id: string): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  warm(): void; // called when the panel opens; start the process if not running
}
