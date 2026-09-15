# Roadmap

Ledge is built in four phases. This file is the human readable summary and is updated when a
phase closes. The design is in the
[design spec](docs/superpowers/specs/2026-09-14-ledge-design.md).

| Phase | Deliverable | You will see |
|---|---|---|
| 0 | `packages/core`, `packages/cli`, `plugin`, tests, docs | `/ledge` works in any repo; sessions link to tasks; `ledge` prints the desk |
| 1 | `apps/desktop` on macOS: button, panel, three tabs, detail, file watch, git scan | The button on your desktop, live against your real task files |
| 2 | Open and Resume in Claude, Windows and Linux builds, release workflow | One click from a backlog row to a briefed Claude session; installers for all three OSes |
| 3 | Optional connectors: PR status and calendar via user configured commands | Pending shows "in review" and an agenda strip, only for people who configure them |

Legend: `[x]` merged to main, `[~]` in progress, `[ ]` not started.

## Phase 0: core, CLI, plugin

- [~] `@ledge/core`: task parse and serialize round trip, config with default merging, `TaskStore`,
  repo matching, porcelain v2 parser, repository scanner, resume prompt builder
- [~] `ledge` CLI: `init add start park done current link todo tick untick open scan`, `--json`,
  `--context`, exit codes 0 1 2 3
- [~] Claude Code plugin: `/ledge` with `start park done todo`, SessionStart, Stop and PreCompact
  hooks, marketplace manifest so `/plugin marketplace add ranjan-del/ledge` works
- [~] Tests: Node test runner for core and CLI, shell test for hooks with recorded payloads
- [~] Docs and community files: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ROADMAP,
  CHANGELOG, NOTICE, `docs/`, ADRs, CI, release workflow, issue and PR templates

## Phase 1: desktop app on macOS

- [ ] Button window: frameless, transparent, always on top, skips the taskbar and dock, 44 px
  circle with a Current count badge, drag and snap to the nearest edge, position saved in
  `config.json` under `ui`
- [ ] Panel window: frameless, 380 px wide, docked to the same edge, slides in and out, closes on
  focus loss unless pinned
- [ ] macOS vibrancy: `NSVisualEffectView` material `sidebar`, 14 px radius
- [ ] Current, Backlog and Pending tabs; drag to reorder writes `order` back to the files
- [ ] Task detail with checklist toggles that write to the file, Park and Mark done
- [ ] File watching with `notify`, 150 ms debounce, re-parse only the changed file
- [ ] Git scan on launch, on interval and on Refresh, cached in `~/.ledge/.scan-cache.json`
- [ ] Malformed task files shown with a warning badge and the parse error, never a crash
- [ ] Vitest component tests for the three tabs and task detail against fixture files
- [ ] Manual QA checklist per OS in [docs/manual-qa.md](docs/manual-qa.md)

## Phase 2: Open in Claude, Windows and Linux, releases

- [ ] Open in Claude and Resume in Claude: `claude --resume <lastSession>` or
  `claude "<prompt>"` in the configured terminal in the task folder
- [ ] Terminals: `Terminal.app` on macOS, `wt` on Windows, `x-terminal-emulator` on Linux; the
  panel shows the exact command to copy if the launch fails
- [ ] Windows 11 Mica, Windows 10 Acrylic, 8 px radius; Linux translucent tint, KWin blur hint
- [ ] `.dmg`, `.msi`, `.AppImage` and `.deb` built by `tauri-action` on a `v*` tag and attached to
  a GitHub Release

## Phase 3: optional connectors

- [ ] PR status through a user configured shell command, shown as "in review" on Pending rows
- [ ] Calendar agenda strip through a user configured shell command
- [ ] Both off unless configured; the core stays free of Jira, Bitbucket, GitHub and calendar
  code

## Later

- An SDK package so other tools can read and write task files through the same code as the CLI
  and the app.
- An MCP server as an optional alternative to file editing for people who prefer it. The files
  stay the source of truth.
- More optional connectors for PR status and calendar sources.
- Team features. Nothing here is planned before the single person experience is complete.
- More terminals, added as people ask.
