# AI assistant contract (v3)

Status: agreed 2026-09-27. Extends the [v2 contract](2026-09-15-v2-contract.md). Two work streams
build against this file in parallel: **A** (core, CLI, plugin) and **B** (desktop app). A change to
a shape below is a change to this file first.

## Goal

Ledge stops being a viewer of files that only change when the person types `/ledge`. It watches
the person's Claude Code sessions and keeps each task current by itself: which task a session
was for (or a new task when none fits), the phases, the todo list, and a short titled note of
what happened. The panel reads like an assistant, not a dump of prose, and can answer questions
and edit tasks.

## Decisions (made by the person, not open)

| Topic | Decision |
|---|---|
| Capture | Both: a background summariser reads the transcript, and every session gets standing rules to keep its task current live |
| No matching task | Auto-create it, marked `origin: auto`, so the panel can flag it for rename, merge or delete |
| Models | Haiku (`claude-haiku-4-5-20251001`, alias `haiku`) for capture and summaries; Sonnet (`sonnet`) for the Ask Ledge chat |
| Old notes and plan | Add a title and summary next to them; the original text is never rewritten |
| Ask Ledge | Answers questions and edits tasks (add, park, done, plan, todo, tick, note, when). No code, no git, no shell beyond `ledge` |
| Session card | AI title and summary, start time, duration, running or not, files changed, commits, todos ticked in that session |

## Rule zero: task files keep their format

The task file format in [task-file-format.md](../../task-file-format.md) does not change. AI output
that is not plan, checklist or a note lives in sidecar JSON files, so the Markdown stays readable
and round trips byte for byte. The only new frontmatter key is `origin: auto`, carried by the
existing unknown key preservation (`Task.meta`).

## Files

```
~/.ledge/
  sessions/<session-id>.json    one SessionRecord per Claude Code session (new)
  insights/<task-id>.json       TaskInsights, AI titles and summaries for one task (new)
  capture.log                   one line per capture run, for debugging (new)
```

Both folders are created on first write. Every write is atomic (write `<file>.tmp`, rename).
A reader that finds a missing or unparseable file treats it as absent and never crashes.

### SessionRecord (`sessions/<id>.json`)

```ts
interface SessionRecord {
  version: 1;
  id: string;                 // Claude Code session id
  taskId?: string;            // task it was attributed to, absent until the first capture
  repo?: string;              // absolute cwd of the session
  transcriptPath?: string;    // from the hook payload
  started: string;            // ISO 8601 with offset, first transcript entry (or hook time)
  lastActivity: string;       // ISO, newest transcript entry seen
  ended?: string;             // ISO, set by SessionEnd; absent while it may still be running
  // Running is derived, never stored: !ended && now - lastActivity < 15 min (ACTIVE_WINDOW_MS).
  title?: string;             // AI, at most 60 chars, imperative or noun phrase, no trailing period
  summary?: string;           // AI, at most 2 sentences, plain words, no file dumps
  filesChanged: string[];     // repo-relative paths edited by Edit/Write/NotebookEdit tool calls
  commits: { sha: string; subject: string }[];  // from `git log` between started and lastActivity
  todosTicked: string[];      // checklist item texts ticked during this session
  todosAdded: string[];       // checklist item texts added during this session
  autoCreatedTask?: boolean;  // true when capture created the task for this session
  capturedAt?: string;        // ISO of the last successful capture
  capturedLines?: number;     // transcript line count at the last capture, for debounce
  model?: string;             // model that wrote title and summary
}
```

### TaskInsights (`insights/<task-id>.json`)

```ts
interface TaskInsights {
  version: 1;
  taskId: string;
  headline?: string;          // one line: where the task stands right now
  phase?: string;             // name of the plan step currently in progress
  notes: Record<string, { title: string; summary: string }>;  // key = contentKey(note.date + '\n' + note.body)
  plan: Record<string, { title: string; detail?: string }>;   // key = contentKey(step text)
  updatedAt: string;
  model?: string;
}
```

`contentKey(text)` is exported from `@ledge/core/pure`: FNV-1a 32 bit over the text with
whitespace collapsed and trimmed, as 8 lowercase hex characters. It must be pure (no `node:`),
since the desktop computes the same key to look up an entry. An entry whose key no longer matches
is stale and simply not shown; the UI then falls back.

**UI fallback when there is no insight:** note title = first sentence, cut at 60 chars with an
ellipsis; plan title = the text up to the first `:` or ` (` or 60 chars. Summary = the next one to
two sentences. The full original is always one click away.

## Core API (stream A owns, stream B consumes)

From `@ledge/core/pure` (no platform modules):

- `contentKey(text): string`
- types `SessionRecord`, `TaskInsights`
- `parseSessionRecord(json: string): SessionRecord | undefined`, `parseInsights(json: string): TaskInsights | undefined`
- `isSessionRunning(rec, now: Date): boolean`
- `sessionDurationMs(rec): number`

From `@ledge/core` (Node): `SessionStore` and `InsightStore` with `get`, `list`, `put`, bound to
`ledgeHome()`.

Notes from stream A on readings the text above left open, none of which changes a shape:
`sessionDurationMs` is `lastActivity - started`, never `ended - started`, so a terminal left open
overnight is not a night of work. `SessionStore.list(taskId?)` sorts newest `lastActivity` first.
Temporary files are `<file>.<pid>.tmp`, so two writers cannot share one. `ledge sessions` text
output lists recorded sessions and then linked ids with no record; only `--json` is records only.
A `--final` capture still skips when the transcript has no new line since the last capture.

## CLI (stream A)

| Command | Does |
|---|---|
| `ledge capture --session <id> --transcript <path> --cwd <dir> [--final] [--force]` | Reads the transcript, asks Haiku, updates the task and writes both sidecars. Debounced unless `--final` or `--force`: skips when fewer than 40 new transcript lines and less than 10 minutes since `capturedAt` |
| `ledge summarise [<task-id>] [--all]` | Backfills `TaskInsights` for notes and plan steps that have no current entry |
| `ledge sessions [--task <id>] --json` | Prints SessionRecords, newest first |
| `ledge brief <task-id>` | Prints the resume briefing (see below) |
| `ledge track --session <id> [--transcript <path>] [--cwd <dir>] [--ended]` | Added by stream A for the hooks: writes the SessionRecord skeleton if absent, fills `repo` and `transcriptPath`, and with `--ended` sets `ended`. Without `--ended` it clears `ended`, because a session that fires SessionStart again has been resumed |

### What capture does

1. Parse the transcript JSONL incrementally: user prompts, assistant text, tool calls (Edit/Write
   file paths, Bash commands, TodoWrite/TaskCreate/TaskUpdate items). Build a compact digest,
   capped at roughly 12k tokens, newest material preferred.
2. Candidate tasks: every non-done task whose `repo` matches the cwd, plus the task the session is
   already linked to. Send titles, requirement first lines, plan and checklist.
3. Ask Haiku for one JSON object:
   `{ taskId | null, newTask?: { title, requirement }, plan?: string[], checklistAdd: string[], checklistTick: string[], note?: { title, summary, body }, session: { title, summary }, headline, phase }`.
   The prompt says: attribute to an existing task when the work is the same goal; create a new one
   only for a clearly different goal; keep plan steps short (at most 90 chars, detail goes in the
   note); never invent work not in the digest.
4. Apply through `TaskStore` (never string edits): create the task with `origin: auto` when
   needed, `setPlan` only when the plan actually changed, add and tick checklist items by fuzzy
   text match, append the note body with `addNote`, link the session.
5. Write the SessionRecord (files, commits from git, ticks) and merge TaskInsights (the new note's
   title and summary keyed by its content key, headline, phase).
6. Append one line to `capture.log`. Any failure is logged and exits 0 from the hook's point of
   view. Nothing is written when the model call fails.

A capture never runs inside a capture: `claudeCodeProvider` already runs with
`--setting-sources ''`, and the hooks also exit early when `LEDGE_CAPTURE=1` is set.

## Plugin (stream A)

- **SessionStart**: as today, plus a short standing rules block (at most 12 lines): keep the Ledge
  task current as you work; when you make or change a plan, run `ledge plan`; when a todo is done,
  `ledge tick`; for a decision or dead end, `ledge note`; if the work is a new goal, `ledge add`
  then `ledge start`. Also writes the SessionRecord skeleton (`started`, `repo`, `transcriptPath`).
- **Stop**: link as today, then start `ledge capture` detached (`nohup … &`) so the hook returns in
  well under a second. The debounce keeps this cheap.
- **PreCompact** and **SessionEnd** (new): start `ledge capture --final` detached. SessionEnd also
  sets `ended`.

## Desktop (stream B)

- Reads `sessions/` and `insights/` with the fs plugin, watches both like `tasks/`.
- **Notes and plan**: each item shows its title (bold, one line) and summary (muted, two lines);
  a disclosure shows the original text. `origin: auto` tasks carry an "auto" chip with Rename,
  Merge into…, Delete.
- **Sessions tab**: card = title (or "Untitled session" plus the task), summary, relative start
  time, duration, a live dot when running, chips for files, commits and todos ticked. The UUID
  moves into a copy button in the expanded card. Replace the footnote that says sessions carry no
  start time.
- **Ask Ledge**: a chat surface (tab or `⌘K` mode). Each question runs
  `claude -p --model sonnet --setting-sources '' --allowedTools "Bash(ledge:*)"` through the shell
  plugin, with a context block built from `buildContext`: tasks, insights, recent SessionRecords,
  git state. The answer streams in. Edits happen only through `ledge` commands the model runs, and
  the panel re-renders from the file watch. Show which commands ran under the answer.
- **Resume in Claude**: `claude --resume <id>` stays for a recent session. Open in Claude (and
  resume of a session older than 12 hours) passes `ledge brief <task-id>` output as the prompt:
  title, requirement, current phase, open todos, last session summary, last note summary. Capped at
  40 lines.

## Tests

Stream A: node tests for `contentKey` stability, record parse and serialize, the transcript
digest (fixture JSONL under `packages/core/test/fixtures/`), debounce, capture with a fake provider
(attribute, auto-create, no-op on provider failure), hook shell tests for the detached launch and
the `LEDGE_CAPTURE` guard. Stream B: vitest component tests for the note and plan items with and
without insights, the session card, and the Ask Ledge surface with a stubbed runner.
