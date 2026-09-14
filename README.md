# Ledge

A floating button for your desktop that shows what you are working on with
Claude Code: current tasks, backlog, and work that is done but not yet pushed.

Local first. Tasks are Markdown files in `~/.ledge/tasks`. Claude Code edits them
through a small plugin. The panel re-renders when a file changes. Nothing is
hosted and nothing leaves your machine.

Status: design stage. See `docs/superpowers/specs/2026-09-14-ledge-design.md`.

## Planned install

1. Download the release for your OS from GitHub Releases, or build from source
   with `npm install && npm run tauri build`.
2. Run `ledge init` once.
3. In Claude Code: `/plugin marketplace add ranjan-del/ledge` then `/plugin install ledge`.
4. Open Claude Code in any repo and type `/ledge start "your first task"`.

## Layout

- `cli/` the `ledge` command
- `plugin/` the Claude Code plugin: `/ledge` command and hooks
- `app/` the Tauri 2 desktop app
- `docs/` specs and manual QA notes

MIT licensed.
