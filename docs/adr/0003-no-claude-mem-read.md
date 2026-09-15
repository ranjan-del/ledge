# ADR 0003: Ledge does not read claude-mem or any Claude Code memory store

Date: 2026-09-15
Status: accepted

## Context

Many people who use Claude Code also run a memory plugin such as claude-mem, which records
observations about each session in its own database and injects them at session start. Ledge also
wants to know what happened in a session, so a natural question is whether Ledge should read that
database (or Claude Code's own transcripts under `~/.claude`) to fill in the Requirement and
Checklist automatically, or to show a richer session history in the panel.

## Options considered

### Read the claude-mem database

- For: a free narrative of what happened in each session.
- Against: couples Ledge to another project's schema and location, which can change without
  notice; only works for people who run that plugin; the data is that plugin's, not the person's
  task list; reading it costs nothing in tokens but summarising it into a task would.

### Read Claude Code transcripts under `~/.claude`

- For: works for everyone.
- Against: large, private, unstructured; turning them into checklist items needs a model call and
  therefore tokens; a bug there could expose conversation content in a task file that the
  SessionStart hook then re-injects.

### Read nothing outside `~/.ledge` and the hook payload

- For: zero coupling, zero tokens, nothing private ever copied; the task file stays the single
  source of truth that the person and Claude wrote on purpose.
- Against: the panel knows only what Claude was asked to write into the file, plus the session
  ids.

## Decision

Ledge reads exactly three things: the files under `LEDGE_HOME`, the output of
`git -C <repo> status --porcelain=v2 --branch` for repositories under the configured roots, and the
`cwd` and `session_id` fields of the Claude Code hook payload. It does not read the claude-mem
database, any other memory plugin's store, Claude Code transcripts, or anything else under
`~/.claude`. It makes no network calls.

The link between a task and a session is the session id and nothing more. Claude keeps the task
file current by editing it during the session, because the `/ledge` command text asks it to and
the PreCompact hook reminds it. Resuming a session later is Claude Code's job through
`claude --resume <id>`; if the person also runs a memory plugin, that plugin injects its own
context in that session, independently of Ledge.

## Consequences

- Ledge works identically whether or not a memory plugin is installed, and cannot be broken by a
  change in one.
- The token cost stays at the roughly 200 tokens the SessionStart hook injects. Nothing in Ledge
  ever calls a model.
- Nothing private is copied out of a conversation by Ledge. What ends up in a task file is what
  Claude was explicitly asked to write there, and the person can read and edit it.
- The quality of the Requirement and Checklist depends on the `/ledge` command text and on Claude
  following it. Improving that text is the lever, not reading more data.
- If a future feature wants richer session history, it must be an optional connector configured
  by the person, in the same shape as the phase 3 PR status and calendar connectors, and this ADR
  must be superseded by a new one.
