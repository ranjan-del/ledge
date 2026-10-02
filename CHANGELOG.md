# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

Release plan (see [ROADMAP.md](ROADMAP.md) for the work inside each phase):

| Version | Phase | Contents |
|---|---|---|
| v0.1.0 | 0 | `@ledge/core`, the `ledge` CLI, the Claude Code plugin, tests, docs |
| v0.2.0 | 1 | Desktop app on macOS, background capture, weekly to-do, the Assistant tab |
| v0.3.0 | 2 | Open and Resume in Claude, Windows and Linux builds, installers on GitHub Releases |
| v0.4.0 | 3 | Optional PR status and calendar connectors |

## [Unreleased]

### Added

- Flagship documentation standard: a "Project documentation" table in the README covering README, Architecture, Design decisions, Benchmarks, Failure cases, Evaluation, Trade-offs, Deployment, Cost and Future work, with stub documents for the sections not yet written
- Week items can carry a description: indented `  > ` lines under the item in the week file,
  read before the wrapped-line rule so they never join the title. `@ledge/core` adds
  `moveWeekItem`, `setWeekItemDescription` and `moveWeekItemToWeek`, and `WeekStore.moveItem`
  writes both weeks of a move between weeks.
- `ledge week describe <n> "text"` (`""` clears), `ledge week add --desc "text"`,
  `ledge week move <n> <to>` to reorder, and `ledge week move <n> --next` or `--prev` to move an
  item to another week. `--prev` also picks last week wherever `--next` picks next week.
  `ledge week` prints a description under its item and `--json` carries `description`.

## [0.2.0] - 2026-09-27

### Added

- The Assistant tab, from the assistant tab contract. The panel's tabs are now Assistant, Tasks
  and Memory. Assistant is a chat with one warm Claude Code process behind it, so a question does
  not wait for a start-up. Each turn is routed to Haiku, Sonnet or Opus by a local heuristic, or
  by the model picker. It is a full agent: reads and Ledge edits run at once, and deletes, access
  grants, pushes, deploys and messages to other people wait on an inline Approve or Cancel card.
  Chats are kept in `~/.ledge/chats/` with New chat and a searchable History. While idle it shows
  the recent tasks, today's to-dos and the Pending line that used to be on Now.
- Memory has a Notes and Sessions switch; the Sessions tab moved there unchanged.
- The To-do week header has a calendar: a month grid with a dot on days that have items. Clicking
  a day shows its week and highlights that day.
- `ledge summarise` prints progress on stderr, one line per task and per batch, and finishes a
  long task in one run. `--quiet` turns the progress off.

- A weekly to-do list, from the weekly to-do contract. One Markdown file per ISO week in
  `$LEDGE_HOME/weeks/<YYYY>-W<ww>.md`, items under `## Anytime` or a `## <Ddd> <YYYY-MM-DD>`
  day, each optionally linked to a task with a trailing `{task: <id>}`. Format in
  [docs/week-file-format.md](docs/week-file-format.md). `@ledge/core/pure` adds `isoWeekOf`,
  `weekDays`, `shiftWeek`, `isIsoWeek`, `parseWeek`, `serializeWeek`, `itemsFor` and
  `numberWeek`; `@ledge/core` adds `WeekStore`. A file Ledge wrote round trips byte for byte.
- `ledge week`, with `add "text" [--day d] [--task id]`, `tick`, `untick`, `rm` and
  `move <n> --day d` by the number it prints, and `--week W` or `--next` for another week.
  `ledge today` and `ledge current --context` show today's unticked items, at most five lines.
- Plugin: one standing rule line and a `/ledge week` subcommand, both saying to add week items
  only when the person asks. The capture never adds them.
- Background capture, from the AI assistant contract (v3). `ledge capture` reads a Claude Code
  session transcript, asks Haiku which task the work was for, and keeps that task current through
  `TaskStore`: the plan when it changed, checklist items added and ticked by word match, a short
  note, and the session link. When no task fits it creates one marked `origin: auto`. It is
  debounced (fewer than 40 new lines and under 10 minutes is a skip), writes nothing when the
  model cannot answer or answers with the wrong shape, serialises captures of one session with a
  lock, and logs one line per run to `capture.log`.
- Two sidecar folders beside the task files, so the Markdown format does not change:
  `sessions/<id>.json` holds a SessionRecord per session (start, last activity, end, AI title
  and summary, files changed, commits from `git log`, todos ticked and added) and
  `insights/<task>.json` holds AI titles and summaries for notes and plan steps, keyed by
  `contentKey`. Writes are atomic; unreadable files are treated as absent.
- `@ledge/core/pure`: `contentKey`, `noteKey`, the `SessionRecord` and `TaskInsights` types,
  `parseSessionRecord`, `parseInsights`, `isSessionRunning`, `sessionDurationMs`, the transcript
  digest (`parseTranscript`, `renderDigest`), the capture rules (`captureDue`,
  `buildCapturePrompt`, `parseCaptureResult`, `matchItem`), `buildBrief` and the summarise
  helpers. `@ledge/core` adds `SessionStore`, `InsightStore`, `runCapture` and `trackSession`.
- `ledge track`, which the hooks use to write a session record skeleton and to mark it ended;
  `ledge brief <id>`, the briefing a new session on a task starts from, at most 40 lines; and
  `ledge summarise [<id>] [--all]`, which backfills titles and summaries for notes and plan
  steps that have none, one Haiku call per task, without touching the task file.
- `claudeCodeProvider({ model })` passes `--model`, and a provider may name its `model`.
- Plugin: the SessionStart block ends with a short set of standing rules (plan, tick, note, and
  give a new goal its own task), SessionStart writes the session record, Stop starts a capture
  detached, PreCompact starts a final capture, and a new SessionEnd hook marks the session ended
  and starts a final capture. Every hook exits at once when `LEDGE_CAPTURE=1` is set, which the
  capture sets for the model call it makes.

- Four surfaces in the desktop panel, replacing the three tabs: Now answers what I am doing,
  Sessions where I am working, Tasks what I need to accomplish, Memory what I need to remember.
  Pending did not go away; it became part of what Now and Tasks show.
- `@ledge/core`: `sessionsFor`, `memoryFor`, `searchMemory`, `nextActionFor` and `surfaceCounts`,
  with the `SessionRef`, `MemoryEntry`, `NextAction` and `SurfaceCounts` types, exported from both
  entry points. Sessions are derived from the ids the plugin links and deliberately claim no more
  than the files record: there is no start time and no liveness, because nothing measures either.
- `ledge sessions` and `ledge memory [query]`, both with `--json`. Memory search requires every
  whitespace-separated term to match in the body or the task title, case-insensitively, with no
  ranking and no fuzzy matching.
- `ledge delete <id> --yes`, the only command that loses data. It refuses without the flag, and
  when it refuses it names the file it would destroy and points at `done` as the alternative.
- `ledge app`, which starts the desktop panel detached, for anyone who turned launch at login off.
- Launch at login, on by default on a fresh install and switchable afterwards. The decision is
  recorded in the store rather than reapplied every launch, so turning it off sticks.
- A task card names the project and keeps its detail collapsed. Expanding shows where the task
  stands, then the planned steps, then what is done.
- A next action line per task, taken from the first unticked checklist item or the first plan step,
  labelled with which of the two it came from so an observation is never mistaken for a guess.

### Changed

- `ledge sessions --json` prints SessionRecords from `sessions/` instead of the SessionRef list.
  The text form lists recorded sessions with their title, state and duration first, then the
  session ids that tasks carry without a record. It also takes `--task <id>`.
- The `/ledge` standing rules tick with `ledge tick` rather than an edit of the file, and tell
  the session to give a new goal its own task.

- The floating button sits in the top right corner rather than centred on the right edge.
- The panel takes the full work area height once there is something to show, and stays short while
  the store is empty. The width does not change.

### Fixed

- CI failed on Linux and Windows since 17 Sep because the lockfile held only the darwin rolldown
  and esbuild bindings. It is regenerated with every platform.
- The panel could not read or write `~/.ledge/.news.json`; a dotfile needs its own scope entry.

- The button needed two clicks. macOS spends the first click on an inactive application's window
  activating it, and Ledge is deliberately an accessory application, so every click was being
  eaten. Both windows now accept that first click.
- The button vanished for a second or two whenever the panel opened. Showing the panel activates
  the application, activating orders the button out, and nothing put it back until the keeper's
  next tick. It is now restored in the same breath as the panel is shown.
- The released application took a Dock icon and a slot in the application switcher. Setting the
  accessory policy at startup is too late in a bundle, because the launch has already placed the
  icon; `LSUIElement` in the bundle's property list settles it before the process starts.
- A plan step or checklist item written across two lines lost everything after the first line.
  The plan continuation was dropped outright, so saving destroyed it; the checklist continuation
  was stranded below the list. Both were silent.
- The git scan found nothing. A wildcard in a permission scope never matches a path component
  beginning with a dot, so the store's own cache file and every `.git` folder fell outside the
  allowed paths. Each dot path is now named outright.
- The file watcher was never enabled in the build, and failures rendered as `undefined` because
  the platform plugins reject with a string rather than an error.


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
