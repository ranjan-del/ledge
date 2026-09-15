# Roadmap

Ledge is built in four phases. This file is the human readable summary and is updated when a
phase closes. The design is in the
[design spec](docs/superpowers/specs/2026-09-14-ledge-design.md), extended by the
[v2 contract](docs/superpowers/specs/2026-09-15-v2-contract.md) for planning, session memory and
the panel.

**Where things stand: phase 0 is complete. Phase 1 is the current phase.**

| Phase | Deliverable | You will see |
|---|---|---|
| 0 | `packages/core`, `packages/cli`, `plugin`, tests, docs | `/ledge` works in any repo; sessions link to tasks; `ledge` prints the desk |
| 1 | `apps/desktop` on macOS: button, panel, three tabs, detail, file watch, git scan | The button on your desktop, live against your real task files |
| 2 | Open and Resume in Claude, Windows and Linux builds, release workflow | One click from a backlog row to a briefed Claude session; installers for all three OSes |
| 3 | Optional connectors: PR status and calendar via user configured commands | Pending shows "in review" and an agenda strip, only for people who configure them |

Legend: `[x]` written and tested, `[~]` in progress, `[ ]` not started. Nothing is released yet;
the first tag is v0.1.0, and [CHANGELOG.md](CHANGELOG.md) tracks what it will contain.

## Phase 0: core, CLI, plugin

Complete.

- [x] `@ledge/core`: task parse and serialize round trip, config with default merging, `TaskStore`,
  repo matching, porcelain v2 parser, repository scanner, resume prompt builder
- [x] Two core entry points: `@ledge/core` bound to Node, `@ledge/core/pure` free of platform
  modules so the desktop bundle runs the same parser
- [x] `ledge` CLI: `init add start park done current link todo tick untick open scan help`,
  `--json`, `--context`, exit codes 0 1 2 3
- [x] Claude Code plugin: `/ledge` with `start park done todo`, SessionStart, Stop and PreCompact
  hooks, marketplace manifest so `/plugin marketplace add ranjan-del/ledge` works
- [x] Tests: Node test runner for core and CLI, shell test for hooks with recorded payloads
- [x] Docs and community files: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ROADMAP,
  CHANGELOG, NOTICE, `docs/`, ADRs, CI, release workflow, issue and PR templates

### Planning and session memory (v2 contract, on top of phase 0)

Each item below is covered by tests in `packages/core/test` and `packages/cli/test`.

- [x] Task file gains optional `planned`, `## Plan` and `## Notes`; a file written without them
  stays valid and round trips unchanged; body sections are written in one fixed order
- [x] Planning helpers in both core entries: `isoDay`, `isIsoDay`, `shiftDay`, `plannedFor`,
  `appendNote`, `setPlan`; `TaskStore.setPlanned`, `addNote` and `setPlan`
- [x] `ledge plan`, `ledge note`, `ledge when` and `ledge today`; `ledge current --context` now
  carries the plan, the planned day and the latest note, still capped at 40 lines
- [x] `/ledge` gains `plan`, `note` and `when`, and standing rules: plan before editing code, note
  a decision or dead end when it happens, closing note before compaction and at session end

## Phase 1: desktop app on macOS

In progress. This is the current phase.

### Window behaviour, from section 6 of the v2 contract

- [~] The floating button stays on screen when another application is activated, when switching
  with the application switcher, on every Space, and alongside a full screen application. An
  always-on-top flag alone is not enough: it reaches only the floating window level, which an
  inactive application loses to whichever application was just activated
- [~] The panel is 60 percent of the work area height, with a floor of 420 px and a ceiling of
  900 px, vertically centred on the button. Full height read as an application window rather than
  a panel
- [~] Width stays 380 px, and the panel still hides on focus loss unless pinned

### Interface

- [~] Button window: frameless, transparent, always on top, skips the taskbar and dock, 44 px
  circle with a Current count badge, drag and snap to the nearest edge, position saved in
  `config.json` under `ui`
- [~] Home view: what is on for today including overdue tasks, then current tasks in priority
  order with progress and git state, then one line pointing at Pending when repositories have
  uncommitted or unpushed work
- [~] Add a task from the home view in one interaction, title only, everything else optional
- [~] Plan, planned day and notes shown in task detail
- [~] macOS vibrancy: `NSVisualEffectView` material `sidebar`, 14 px radius
- [~] Current, Backlog and Pending tabs
- [ ] Drag to reorder, writing `order` back to the files
- [~] Task detail with checklist toggles that write to the file, Park and Mark done
- [~] File watching, debounced, re-parsing only the changed file. Done through the Tauri fs
  plugin's `watch` feature rather than the `notify` crate directly, so the Rust shell keeps one
  dependency fewer than the design spec assumed
- [~] Git scan on launch, on interval and on Refresh, cached in `~/.ledge/.scan-cache.json`
- [~] Malformed task files shown with the file, the line and the parse error, never a crash
- [~] Vitest component tests for the three tabs, the home view and task detail against fixture
  files
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
