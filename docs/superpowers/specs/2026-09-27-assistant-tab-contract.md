# Assistant tab contract

Status: agreed 2026-09-27. Builds on the [AI assistant contract](2026-09-27-ai-assistant-contract.md)
and the [weekly to-do contract](2026-09-27-weekly-todo-contract.md). Two streams build against it in
parallel, both inside `apps/desktop`:

- **E (engine)** owns `apps/desktop/src/lib/assistant/**`, `apps/desktop/src-tauri/**` and the
  engine tests.
- **U (UI)** owns `apps/desktop/src/components/**` (new and existing), styles, `lib/store.svelte.ts`
  wiring and the UI tests. U codes against the `AssistantEngine` interface below with a fake, and
  must not edit `lib/assistant/**` beyond `lib/assistant/types.ts`, which U may create first if E
  has not, containing exactly the types below.

## What the person asked for

A Jarvis-style assistant in the first tab. It answers simple questions as fast as a chatbot ("what
is an LLM"), answers work questions from Ledge's records ("what is pending", "how far is unLab"),
and does things: create a task, add a to-do, park something, clear data, grant someone access to a
repo or a Firebase project, summarise. It is a real agent with no artificial tool restriction, but
risky actions wait for an Approve or Cancel.

## Decisions (made by the person)

| Topic | Decision |
|---|---|
| Tabs | `Assistant`, `Tasks`, `Memory`. Now merges into Assistant. Sessions moves into Memory |
| Permissions | Full agent. Answers and Ledge edits run at once. Deletes, permission or access grants, pushes, merges, deploys, and messages or email sent to other people show an approval card first |
| Speed | One warm Claude Code process, so no per-question start-up. Per-turn model routing: Haiku for quick general questions, Sonnet for work questions and actions, Opus for large analysis or planning |
| History | Kept in `~/.ledge/chats/`, with a New chat button. The assistant remembers the conversation |

## Layout (stream U)

- **Tabs**: `Assistant | Tasks | Memory`. The tab count badges stay where they make sense.
- **Assistant, idle** (no messages in the current chat): a greeting line, then the input (a
  multi-line field, Enter sends, Shift+Enter adds a new line). Under it, 2 or 3 recent tasks as
  compact cards (the ones worked on most recently by activity), then today's to-dos (the Today
  block, moved here from Now), then the one-line Pending hint Now had. A row of 3 or 4 suggestion
  chips, e.g. "What is pending?", "Plan my day", "Summarise this week".
- **Assistant, chatting**: the cards animate away (respect reduced motion), the conversation
  fills the tab, and the input docks at the bottom. A small header row has the chat title, New
  chat, and History (the list of saved chats, searchable, open or delete).
- **Messages**: user bubbles right, assistant text left and rendered as light Markdown (paragraphs,
  lists, code, bold, links). Under an assistant message, a quiet line shows the model used
  (`Haiku`, `Sonnet`, `Opus`) and a collapsible "Did 3 things" list of tool calls (name plus a
  one-line summary, e.g. `ledge week add "Call vendor" --day thu`).
- **Streaming**: the first token appears as soon as it arrives. A Stop button replaces Send while
  a turn runs.
- **Approval card**: inline in the conversation, with what it wants to run (command or tool plus
  input, pretty printed), why it counts as risky, and `Approve` / `Cancel`. Approve can include
  "Always allow this for this chat".
- **Errors**: Claude Code missing, signed out, or crashed each get a plain message and a Retry.
- **Model override**: a small picker by the input: `Auto` (default), `Haiku`, `Sonnet`, `Opus`.
- **Memory tab**: a sub-switch `Notes | Sessions`, reusing the segmented ViewSwitch. Sessions is the
  existing Sessions tab content, moved as is. The choice is remembered per viewer.
- **To-do calendar**: a calendar icon button in the week header opens a small month grid popover.
  It has previous and next month, today marked, days that have to-do items marked with a dot, and
  weeks shaded when they have items. Clicking any day shows that day's week and scrolls to and
  briefly highlights that day. The existing previous, next and This week controls stay.

## Engine (stream E)

### Interface (`lib/assistant/types.ts`)

```ts
type ModelChoice = 'auto' | 'haiku' | 'sonnet' | 'opus';
type ResolvedModel = 'haiku' | 'sonnet' | 'opus';

interface ToolActivity { id: string; name: string; summary: string; status: 'running' | 'done' | 'error' | 'denied' }
interface ApprovalRequest {
  id: string; tool: string; input: unknown;
  summary: string;            // one line: what it will do
  reason: string;             // why it needs approval
}
interface ChatMessage {
  id: string; role: 'user' | 'assistant';
  text: string;               // for assistant, the full text so far
  model?: ResolvedModel;
  tools: ToolActivity[];
  approvals: (ApprovalRequest & { decision?: 'approved' | 'denied' })[];
  at: string;                 // ISO
  error?: string;
}
interface Chat { id: string; title: string; created: string; updated: string; messages: ChatMessage[] }

type EngineStatus = 'starting' | 'ready' | 'busy' | 'unavailable';
type EngineEvent =
  | { type: 'status'; status: EngineStatus; detail?: string }
  | { type: 'message'; chatId: string; message: ChatMessage }   // any change to a message; UI replaces by id
  | { type: 'approval'; chatId: string; messageId: string; request: ApprovalRequest }
  | { type: 'chats'; chats: Pick<Chat, 'id' | 'title' | 'updated'>[] };

interface AssistantEngine {
  status(): EngineStatus;
  subscribe(fn: (e: EngineEvent) => void): () => void;
  send(chatId: string | undefined, text: string, model?: ModelChoice): Promise<string>; // returns chatId
  stop(chatId: string): void;
  decide(approvalId: string, decision: 'approved' | 'denied', always?: boolean): void;
  newChat(): string;
  listChats(): Promise<Pick<Chat, 'id' | 'title' | 'updated'>[]>;
  loadChat(id: string): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  warm(): void;               // called when the panel opens; start the process if not running
}
```

`lib/assistant/fake.ts` (owned by E, but U may create a minimal one for its tests under
`test/`) provides a scripted engine for tests.

### Warm session

- Run one long-lived `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages` child through the shell plugin (spawn plus stdin write), in `~/.ledge`
  or `$HOME`, with `LEDGE_CAPTURE=1` so Ledge's own hooks stay silent, and the PATH fix from
  Ask Ledge. Check the installed CLI (`claude --help`, and the Agent SDK control protocol) for the
  permission prompt mechanism: prefer `--permission-prompt-tool stdio` with `can_use_tool` control
  requests answered over stdin, and `set_model` control requests for routing. If a mechanism is
  missing in the installed version, pick the closest that works and say so in the report.
- Start it on `warm()`, restart it on crash with backoff, and shut it down when the app quits. One
  process serves the current chat. Switching chats restarts it with `--resume <claude session id>`
  stored in the chat file, or replays a compact transcript when there is none.
- The system prompt (append) carries: who the person is (read `~/.claude/identity.md` if present,
  otherwise nothing), today's date, and the Ledge context built by the existing Ask Ledge context
  builder (tasks, insights, recent sessions, git state, this week's to-dos), refreshed at the start
  of each turn as a short user-side preamble rather than restarting the process. It also carries
  the rules: answer general questions directly and briefly; use `ledge` for any change to tasks,
  to-dos, notes or backlog; say what you did in one line afterwards.
- The person's normal Claude Code settings, MCP servers and CLAUDE.md load as usual (no
  `--setting-sources ''`), so the assistant has the same tools as their terminal sessions.

### Routing (`lib/assistant/router.ts`, pure, tested)

`route(text, history): ResolvedModel`, a local heuristic with no model call:

- **haiku**: a short general-knowledge or chit-chat question that names nothing on the desk (no
  task title, repository, branch, person, or work verb such as add, create, park, grant, deploy,
  fix).
- **opus**: asks to analyse, plan, design, review, compare, or audit, or is long (more than 400
  characters).
- **sonnet**: everything else, including every action and every question about the desk.

An explicit `ModelChoice` other than `auto` wins. Switch with the control protocol when available,
otherwise keep the warm process on Sonnet and run the Haiku questions through a second warm
process.

### Approvals (`lib/assistant/policy.ts`, pure, tested)

`classify(tool, input): { risky: boolean; reason?: string }`.

- **Never risky**: reads (Read, Grep, Glob, WebSearch, WebFetch), `ledge` commands except
  `ledge delete` and anything that removes files under `~/.ledge`, and read-only shell commands.
- **Risky**: `rm`, `ledge delete`, `git push`, `git reset --hard`, merges, `gh`/`bb` writes
  (`pr-create`, `pr-merge`, `repo-create`, permission endpoints), `firebase deploy` and any
  `firebase` or `gcloud` IAM or permission change, `gcloud ... add-iam-policy-binding`, `slack`
  post, dm, upload, `gws gmail +send`, calendar event creation, and anything writing outside
  `~/.ledge` and the scratch folder that is not an obvious edit the person asked for. When unsure,
  risky.
- "Always allow this for this chat" remembers the exact tool and command prefix for that chat
  only.

### History

`~/.ledge/chats/<id>.json` holds one Chat plus the Claude session id. Writes are atomic, as for the
other sidecars. The title comes from the first user message (at most 50 chars), and is later
replaced by a Haiku-written title once the first answer lands. The list is newest first.

## Tests

- **E**: router cases, policy cases, the stream-json parser against recorded fixture lines
  (synthetic), the approval round trip with a fake child process, history round trip.
- **U**: the tab switch, Assistant idle to chatting to idle, docking input, approval card
  decisions, model picker, Memory sub-switch, calendar picker (month navigation, dots, click to
  week).
