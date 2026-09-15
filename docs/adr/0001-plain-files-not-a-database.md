# ADR 0001: Plain Markdown files, not a database

Date: 2026-09-14
Status: accepted

## Context

Ledge needs a place to keep tasks that three very different parties will read and write: a person
with a text editor, Claude Code through its Edit tool, and a desktop app that must re-render the
moment something changes. The design goals require zero token cost for everything except a small
session start hook, no hosting, nothing leaving the machine, and an install that takes under ten
minutes on three operating systems.

## Options considered

### SQLite database

- For: queries, transactions, one file.
- Against: Claude Code cannot edit it with the tools it already has; every reader needs a driver;
  a person cannot open it and fix a typo; it adds a native dependency to the CLI.

### A local server or daemon with an API

- For: a central place for validation and events.
- Against: something has to be running for the files to be correct; a crash or an upgrade takes
  the whole desk with it; more RAM and battery at idle; more to install.

### MCP server

- For: structured tool calls from Claude.
- Against: requires the server to run, costs tokens per call for the tool definitions, and still
  needs a store underneath.

### A folder of Markdown files with YAML frontmatter

- For: Claude Code edits them with the Edit tool it already uses; any editor works; `git` and
  `diff` work; the OS gives file change events for free; nothing has to be running.
- Against: no transactions; concurrent writes must be small and rare; parsing must be strict so a
  typo is caught rather than silently kept.

## Decision

Tasks are plain Markdown files with YAML frontmatter under `~/.ledge/tasks`, one file per task,
moved to `~/.ledge/archive` when done. Configuration is one `config.json`. There is no database,
no server and no daemon. The files are the API.

To make this safe:

- One shared parser in `@ledge/core` is the only code that reads or writes a task file, used by
  both the CLI and the app, so they cannot disagree about a file.
- `parseTask` and `serializeTask` round trip exactly, so Ledge's own writes are diff friendly and
  never reorder or reformat what a person wrote.
- Unknown frontmatter keys and invalid values are parse errors. The CLI prints the file and line;
  the app shows the row with a warning badge. Nothing ever crashes on a bad file.
- The Pending tab is never stored. It is recomputed from git, so there is no second source of
  truth to drift.

## Consequences

- Claude Code needs no new tool to keep the desk current. The `/ledge` command text tells it the
  exact format and it uses the Edit tool.
- The desktop app can be closed, crashed or not yet written and the task list is still correct.
- Anyone can script Ledge with `cat`, `sed` and `git`.
- Later features that want structured access (an SDK package, an optional MCP server) must be
  built on top of the files, not beside them. This is recorded in the roadmap's Later section.
