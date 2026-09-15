# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

Release plan (see [ROADMAP.md](ROADMAP.md) for the work inside each phase):

| Version | Phase | Contents |
|---|---|---|
| v0.1.0 | 0 | `@ledge/core`, the `ledge` CLI, the Claude Code plugin, tests, docs |
| v0.2.0 | 1 | Desktop app on macOS: button, panel, three tabs, detail, file watch, git scan |
| v0.3.0 | 2 | Open and Resume in Claude, Windows and Linux builds, installers on GitHub Releases |
| v0.4.0 | 3 | Optional PR status and calendar connectors |

## [Unreleased]

### Added

- Task file: three optional additions, from the v2 contract. A `planned` frontmatter key holding
  a calendar day as `YYYY-MM-DD`, a `## Plan` section holding an ordered list of steps, and a
  `## Notes` section holding dated `### YYYY-MM-DD` subsections that carry the reasoning from one
  work session to the next. A file written without any of them stays valid and round trips
  unchanged.
- `@ledge/core`: the `NoteEntry` type, `Task.planned`, `Task.plan` and `Task.notes`, and the
  planning helpers `isoDay`, `isIsoDay`, `shiftDay`, `plannedFor`, `appendNote` and `setPlan`.
  All six are pure, return a new task and are exported from both core entry points.
- `TaskStore`: `setPlanned(id, day | undefined)`, `addNote(id, text, day?)` and
  `setPlan(id, steps)`. Each is a read, a pure transform and a save. `setPlanned` throws
  `RangeError` for a day that is not `YYYY-MM-DD`.
- `ledge` CLI: four commands. `ledge plan <id> "step" ...` replaces the ordered plan,
  `ledge note <id> "text"` appends to today's notes, `ledge when <id> <day>` sets or clears the
  planned day and accepts `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday` and `none`, and
  `ledge today` prints the tasks planned for today, the overdue ones, then the remaining current
  tasks.
- Claude Code plugin: `/ledge` gains `plan`, `note` and `when`, plus standing rules that make the
  assistant write a plan before editing code, append a note when a decision or a dead end
  happens, and append a closing note before compaction and at the end of a session.
- Monorepo with npm workspaces: `packages/core` (`@ledge/core`), `packages/cli` (`@ledge/cli`,
  the `ledge` binary), `apps/desktop` (Tauri 2 and Svelte 5), `plugin/` (Claude Code plugin) and a
  root `.claude-plugin/marketplace.json`. Node 22.6 or newer with native TypeScript, no build
  step for core and cli.
- Design spec at `docs/superpowers/specs/2026-09-14-ledge-design.md` and the phase 0
  implementation plan at `docs/superpowers/plans/2026-09-15-phase-0-plan.md`.
- Documentation: `docs/README.md`, getting started, architecture, task file format,
  configuration, manual QA checklist, and ADRs 0001 to 0003.
- Repository governance: CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY,
  ROADMAP, NOTICE, CODEOWNERS, issue and PR templates, Dependabot.
- CI: `npm test` and `npm run typecheck` on Node 22 and 24; advisory `cargo check` of the Tauri
  shell on Ubuntu, macOS and Windows. Release workflow with `tauri-action` on `v*` tags.

### Changed

- Serialization writes body sections in one fixed order: Requirement, Plan, Checklist, Notes,
  then anything Ledge does not recognise. A file whose sections are in another order still
  parses and is rewritten in this order when it is next saved.
- `ledge current --context`, the block the SessionStart hook injects, now also carries the plan,
  the planned day and the latest note. It is still capped at 40 lines: when it does not fit, the
  note is shortened from its oldest line first and dropped before the requirement or the
  unchecked items.
- The PreCompact hook now names the task and asks for both a checklist update and a closing note,
  since the note is the part of the record that survives compaction.
- Unknown frontmatter keys are kept in `Task.meta` and written back after the known keys, rather
  than being a parse error. `docs/task-file-format.md` had documented the old behaviour.
- Documentation: `docs/task-file-format.md` rewritten as the complete reference for the format,
  `docs/getting-started.md` gains a walkthrough for planning a day, `docs/architecture.md` gains
  the new exports, the `TaskStore` additions and an explanation of the two core entry points.

### Fixed

- A malformed `planned` value is dropped on parse instead of raising, so one mistyped date cannot
  make a task unreadable. A `## Notes` section with no dated subsection, and a `## Plan` section
  with no list items, are preserved verbatim rather than being read as empty.

### Notes

- Phase 0 is complete. Phase 1, the desktop app on macOS, is the current phase; the window and
  interface work listed in ROADMAP.md is in progress and nothing is released yet.
- MIT licensed from the first commit.
