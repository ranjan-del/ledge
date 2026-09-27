# Architecture

Status: the core, CLI and plugin sections describe what is on `main`, including the planning and
session memory additions of the
[v2 contract](superpowers/specs/2026-09-15-v2-contract.md). The capture, sidecar and briefing
parts of the [AI assistant contract (v3)](superpowers/specs/2026-09-27-ai-assistant-contract.md)
are on the `feat/ai-capture` branch and described below under "The capture". The desktop app
sections describe phase 1 and 2; phase 1 is in progress and no release exists yet.

## One idea

A folder of Markdown files is the whole system state. Three things touch it:

```
                  edits files                          watches files
  Claude Code  ------------->   ~/.ledge/tasks/*.md   <-------------  Desktop app (phase 1)
  (plugin)     <-------------                         ------------->
                  reads context                        writes order,
                  via `ledge`                          ticks, park, done

                                        ^
                                        | reads and writes
                                        |
                                 `ledge` CLI  --->  git status --porcelain=v2 --branch  (Pending)
```

No process owns the files. Nothing has to be running for them to be correct. Any editor, any
script and Claude Code can change them, and the files are the API.

## Packages

| Package | Role | Runtime dependencies |
|---|---|---|
| `packages/core` (`@ledge/core`) | Task file parse and serialize, config, `TaskStore`, planning helpers, repo matching, porcelain v2 parser, repository scanner, resume prompt | `yaml` only |
| `packages/cli` (`@ledge/cli`) | The `ledge` binary. Thin argument parsing over `TaskStore`; plain text or JSON output | `@ledge/core` |
| `plugin/` | Claude Code plugin: `/ledge` command file, `hooks.json`, four POSIX sh scripts | The `ledge` CLI on PATH |
| `apps/desktop` | Tauri 2 shell in Rust, Svelte 5 UI in TypeScript. Imports `@ledge/core/pure` for all parsing | Tauri plugins `fs` (with `watch`), `shell`, `os`; crates `window-vibrancy`, and `objc2` for AppKit on macOS |

Dependency direction is strict: the CLI and the app depend on core; core depends on nothing but
`yaml`; the plugin depends on the CLI binary and never imports code. Cross package imports are
`@ledge/core` only, never a deep path.

Core and CLI are TypeScript run directly by Node 22 with type stripping. There is no build step,
which is why `erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces.

## Two entry points, one parser

This is the least obvious thing in the codebase, so it comes before the API list.

`@ledge/core` has two entry points, declared in `packages/core/package.json`:

| Specifier | File | Imports `node:` modules | Used by |
|---|---|---|---|
| `@ledge/core` | `src/index.ts` | yes | The CLI, and anything else on Node |
| `@ledge/core/pure` | `src/pure.ts` | no | The desktop WebView bundle |

They export the same names with the same parameters. The only difference is where the
environment comes from. In the pure entry the home folder, the base folder a relative `repo`
resolves against, and the platform name are arguments. In the Node entry the same arguments are
optional and default to what `node:os` and `process` report.

```
parseTask(markdown, file, { home, base })        src/task-file.ts        pure, no node:
  \-- parseTask(markdown, file, paths?)          src/task-file-node.ts   fills home from homedir(),
                                                                         base from process.cwd()
```

Three pairs of modules are split this way: `task-file.ts` with `task-file-node.ts`, `defaults.ts`
and `tilde.ts` with `config.ts`, and `porcelain.ts` with `git.ts`. The pure half holds the logic,
the Node half holds the operating system.

The point of the split is that the desktop app runs in a WebView with no Node and no shims, yet
must parse a task file exactly as the CLI does. If it had its own parser the two could disagree
about a file, and the file is the source of truth for both. So the app imports
`@ledge/core/pure`, passes the home folder it got from the Tauri OS plugin, and runs the same
functions. `TaskStore`, the config reader and writer, the repository walker and the file watcher
stay outside the pure entry, because those genuinely need a filesystem.

## Core public API

The full signatures are Contract 2 in the
[phase 0 plan](superpowers/plans/2026-09-15-phase-0-plan.md), extended by section 3 of the
[v2 contract](superpowers/specs/2026-09-15-v2-contract.md). In outline:

| Group | Functions | In `pure` |
|---|---|---|
| Home and config | `ledgeHome()`, `defaultConfig()`, `loadConfig()`, `saveConfig()` | `defaultConfig()` only |
| Paths | `expandTilde()`, `collapseTilde()` | yes |
| Task files | `parseTask()`, `serializeTask()`, `slugify()`, `taskFileName()`, `TaskParseError` | yes |
| Planning | `isoDay()`, `isIsoDay()`, `shiftDay()`, `plannedFor()`, `appendNote()`, `setPlan()` | yes |
| Store | `TaskStore`, listed below | no |
| Matching | `matchRepo(tasks, cwd)` returns the deepest repo match | no |
| Git | `parsePorcelainV2()`, `findRepos()`, `scanRepos()`, `isPending()` | parser and `isPending()` only |
| Claude | `buildResumePrompt(task)` returns title, requirement and unchecked items | yes |
| Sidecars (v3) | `contentKey`, `noteKey`, `parseSessionRecord`, `parseInsights`, `isSessionRunning`, `sessionDurationMs`, `emptyInsights`; `SessionStore`, `InsightStore` | all but the two stores |
| Capture (v3) | `parseTranscript`, `renderDigest`, `captureDue`, `buildCapturePrompt`, `parseCaptureResult`, `matchItem`; `runCapture`, `trackSession`, `mergeInsights` | all but the last three |
| Briefing and backfill (v3) | `buildBrief`, `missingInsights`, `buildSummarisePrompt`, `parseSummariseResult` | yes |
| Types | `Task`, `TaskStatus`, `ChecklistItem`, `NoteEntry`, `Config`, `RepoStatus`, `TaskPaths`, `SessionRecord`, `TaskInsights` | yes |

### The planning helpers

Added by the v2 contract. All six are pure, return a new `Task` and never mutate their argument,
which is what lets both the store and the WebView call them.

| Function | Behaviour |
|---|---|
| `isoDay(date?)` | Formats a date as `YYYY-MM-DD` in local time. Local, not UTC, because "today" means the day the person is living in |
| `isIsoDay(value)` | True for the exact shape `YYYY-MM-DD` naming a day that exists, so `2026-02-31` is rejected |
| `shiftDay(day, n)` | Adds `n` days to a calendar day. Month and year ends are the platform's problem, not a guess |
| `plannedFor(tasks, day)` | Splits tasks into `{ today, overdue }`. Overdue means planned earlier and not done. Input order is kept |
| `appendNote(task, text, day?)` | Appends to that day's note subsection, creating it when absent. Blank text is a no-op |
| `setPlan(task, steps)` | Replaces the plan, trimming steps and dropping blank ones |

### `TaskStore`

`TaskStore` is file backed over `<home>/tasks` and `<home>/archive`. Every method reads the files
fresh and writes through immediately. There is no cache and no daemon, because an editor, a
script, Claude Code and the app may all change a file between two calls.

| Group | Methods |
|---|---|
| Lifecycle | `init`, `list`, `archived`, `get`, `add`, `save` |
| Status | `start`, `park`, `done`, `reorder` |
| Checklist | `addTodo`, `setTodo` |
| Planning, new in v2 | `setPlanned(id, day \| undefined)`, `addNote(id, text, day?)`, `setPlan(id, steps)` |
| Sessions and matching | `link`, `currentFor` |

Each of the three new methods is a read, a pure transform from the planning helpers above, and a
save. `setPlanned` is the exception that validates: it throws `RangeError` for a day that is not
`YYYY-MM-DD`, rather than dropping it the way the parser does, so a typo on the way in fails
loudly.

`parseTask` and `serializeTask` round trip: parsing a serialized task and serializing again yields
the same text. `loadConfig` deep merges defaults and never writes. `TaskStore` bumps `updated` on
every save and never writes outside its `home`.

## Data flow: the CLI and the plugin

### Session start

```
Claude Code starts in ~/code/foo
  \-- SessionStart hook: session-start.sh
       |-- ledge track --session <id> --cwd ~/code/foo --transcript <path>
       |    \-- writes sessions/<id>.json if absent: started, repo, transcriptPath
       \-- ledge current --repo ~/code/foo --context
            |-- TaskStore.currentFor(cwd): deepest repo match among status: current
            |-- match: print title, planned day, requirement, plan, unchecked items and the
            |          latest note (max 40 lines)                                ~200 tokens
            \-- no match: print "No Ledge task for this repo. Use /ledge start to create one."
```

After the context block, or the no-task line, the hook prints the standing rules: nine lines
asking the session to keep its task current with `ledge plan`, `ledge tick`, `ledge todo` and
`ledge note`, and to give a new goal its own task with `ledge add` then `ledge start`. It prints
them only when `ledge` answered, so a broken store still produces no output at all.

The context block is assembled by `renderContext` in `packages/cli/src/format.ts` and capped at
40 lines. When it does not fit, the note is shortened from its oldest line first, and dropped
entirely if that is still not enough. The requirement and the unchecked items are what the
assistant cannot work without; a note is the one part of the record it can go and read in the
file. The note shown is today's entry, or the newest entry when nothing was written today.

### During the session

```
/ledge start "title"   ->  ledge add "title" --repo $PWD, ledge start <id>, then Claude edits
                          the new file: ## Requirement and an initial ## Checklist, then
                          ledge plan <id> "step" ... before it touches any code
step finishes          ->  Claude edits the checklist, ticks the item
/ledge todo "item"     ->  ledge todo <id> "item"
/ledge plan            ->  ledge plan <id> "step" "step" ...   (replaces the plan)
/ledge note "text"     ->  ledge note <id> "text"              (appends to today's notes)
/ledge when <day>      ->  ledge when <id> <day>               (sets or clears planned)
decision or dead end   ->  ledge note <id> "..." at the moment it happens
PreCompact hook        ->  "Before compaction, update the Ledge task (<id>): tick finished
                          checklist items ... then run ledge note <id> ... Do both now; after
                          compaction the reasoning is gone."
/ledge park "reason"   ->  Claude refreshes the checklist, writes a note, then ledge park
/ledge done            ->  Claude ticks completed items, writes a closing note, then ledge done
```

The plan, the notes and the closing note are standing rules in `plugin/commands/ledge.md`, not
things the person has to ask for. The division of labour is the point: the checklist records what
is done, the plan records what was intended, and the notes record why. Only the notes survive a
compaction with their reasoning intact, which is why the PreCompact hook asks for one by name.

### Session end

```
Stop hook: stop.sh                      (after every assistant turn)
  \-- reads session_id, transcript_path and cwd from the payload on stdin
       |-- ledge link <id> <session_id>    (silent, exit 0 whatever happens)
       |-- ledge settle --repo <cwd>       (promotes a launched backlog task on evidence)
       \-- ( LEDGE_CAPTURE=1 nohup ledge capture --session ... --transcript ... --cwd ... & )
PreCompact hook: pre-compact.sh
  \-- the same detached launch with --final, then the one line reminder
SessionEnd hook: session-end.sh
  |-- ledge track --session <id> --ended   (synchronous, so the record stops showing as running)
  \-- the same detached launch with --final
```

Hooks are POSIX sh with 5 second timeouts. They always exit 0 and print nothing on error, so a
Ledge bug can never fail a Claude Code session. Only SessionStart may print a hint, and only when
`ledge` is missing from PATH. The capture is launched from a subshell with every stream
redirected, so the hook returns in well under a second and the capture is not its child. Every
hook exits at once when `LEDGE_CAPTURE=1` is set, which the capture sets for the `claude -p` it
starts, so a capture can never trigger another one.

## The capture

Added by the [AI assistant contract (v3)](superpowers/specs/2026-09-27-ai-assistant-contract.md).
The standing rules ask a session to keep its task current as it works; the capture reads the
transcript afterwards and fills in what the session did not write down. Pure rules live in
`capture.ts`, `transcript.ts`, `brief.ts` and `summarise.ts`; `capture-node.ts` and
`sidecars-node.ts` read and write.

```
ledge capture --session <id> --transcript <path> --cwd <dir> [--final] [--force]
  |-- lock sessions/<id>.lock            (a second capture of the same session waits, then skips)
  |-- parseTranscript(jsonl)             prompts, replies, Bash commands, Edit/Write/NotebookEdit
  |                                      paths, TodoWrite and TaskCreate/TaskUpdate state;
  |                                      thinking, tool results and subagent traffic are dropped
  |-- captureDue(record, lines, now)     skip under 40 new lines and under 10 minutes; --final
  |                                      skips the debounce, never a read with no new line
  |-- candidates                         non-done tasks whose repo holds cwd, plus the linked one
  |-- ask Haiku (claude -p --model haiku --setting-sources '')   one JSON object
  |-- parseCaptureResult                 wrong types or an unknown taskId: refuse, write nothing
  |-- TaskStore                          add (meta origin: auto) | setPlan if changed | addTodo |
  |                                      setTodo by word match | addNote | link
  |-- sessions/<id>.json                 title, summary, files, commits (git log), ticks, lines
  |-- insights/<task>.json               headline, phase, today's note title keyed by contentKey
  \-- capture.log                        one line: captured | skipped | failed, and why
```

The digest is capped at about 12k tokens (48,000 characters). Entries are chosen newest first,
material since the last capture before older material, and then printed in transcript order with
a marker where the new material begins, so a note is written only about what is new while the
session title can describe the whole session.

Three guarantees, each covered by a test. Nothing is written when the model is unavailable, fails,
or answers with something that does not check out, so the next capture tries again from the same
place. An `ended` mark written by SessionEnd while the model was thinking is kept, because the
capture re-reads the record before it writes. And the model can only attribute a session to a
task it was shown: a taskId outside the candidates refuses the whole answer.

### The sidecars

`sessions/<id>.json` and `insights/<task-id>.json` hold what is the model's view rather than the
person's record, so the task file format does not change. Both are written to a temporary file and
renamed, and a reader treats a missing or unparseable file as absent. An insight is keyed by
`contentKey`, FNV-1a 32 bit over the UTF-8 bytes of the text with whitespace collapsed, so an
entry written for a note that has since been edited stops matching and is simply not shown.
`isSessionRunning` is derived, never stored: not ended, and active within `ACTIVE_WINDOW_MS`.
`sessionDurationMs` runs from `started` to `lastActivity`, not to `ended`.

### Briefing and backfill

`ledge brief <id>` prints `buildBrief`: title, headline, phase, requirement, open items, the last
session's title and summary and the last note's title and summary, capped at 40 lines, with the
requirement giving way before the open items. The panel passes it as the prompt of a new session.

`ledge summarise [<id>] [--all]` finds the notes and plan steps with no current insight, asks
Haiku once per task for a title and summary each, and writes only the insights file. A task with
nothing missing costs no model call.

## What Ledge reads and does not read

| Reads | Does not read |
|---|---|
| `~/.ledge/tasks/*.md` and `~/.ledge/config.json` | Any transcript other than the one a hook named for its own session |
| `~/.ledge/archive/` for a count only | The claude-mem database or any other memory plugin's store ([ADR 0003](adr/0003-no-claude-mem-read.md)) |
| `~/.ledge/sessions/` and `~/.ledge/insights/` | Claude Code settings, memory or other files under `~/.claude` |
| `git -C <repo> status --porcelain=v2 --branch` for repositories under `roots` | Anything over the network, apart from the model call `claude -p` makes |
| `.git/index` mtime to decide whether a repository is stale | Any other field of the hook payload |
| `cwd`, `session_id` and `transcript_path` from the hook payload | |
| The session's own transcript, at the path the hook payload gives, during `ledge capture` | |
| `git log` between a session's start and last activity, for its commits | |
| Modification times under `~/.claude/projects` for `ledge active` | |

## The git scan

```
for each root in config.roots
  walk to config.scan.maxDepth, skipping config.scan.ignore, collecting folders that contain .git
for each repo
  skip if .git/index is older than config.scan.staleDays and no task references the repo
  run git -C <repo> status --porcelain=v2 --branch          (concurrency limit 4)
  parse: branch, upstream, ahead, behind, dirty files with XY codes
isPending(repo) = dirty files, or ahead > 0, or no upstream on a branch that is not main
```

Git not installed, or a repository with no commits, is skipped and logged once. The CLI runs the
scan on `ledge scan` and when printing the desk. The app runs it on launch, every
`scan.intervalMinutes` and on Refresh, and caches results in `~/.ledge/.scan-cache.json` so the
panel is populated instantly on next launch.

## The desktop app (phase 1 in progress, phase 2 designed)

Two windows, declared in `tauri.conf.json`:

- `button`: 48x48, transparent, no decorations, always on top, skips the taskbar, not resizable.
  Renders a 44 px circle with the Current count. Drag, release, snap to the nearest edge, save
  `ui.edge` and `ui.y`. Left click toggles the panel; right click opens Refresh git, Open tasks
  folder, Settings, Quit.
- `panel`: 380 px wide, transparent, no decorations, hidden at start. Docked to the same edge,
  vertically centred on the button, closes on focus loss unless pinned. macOS Sidebar vibrancy;
  Windows Mica with Acrylic fallback; Linux translucent tint.

Two window decisions come from section 6 of the v2 contract and are implemented in
`apps/desktop/src-tauri/src/lib.rs`:

| Decision | How |
|---|---|
| The button stays on screen whatever is in front | Activation policy `Accessory`, and both windows get `NSStatusWindowLevel`, the collection behaviours `CanJoinAllSpaces`, `Stationary` and `FullScreenAuxiliary`, and `hidesOnDeactivate` off |
| The panel is 60 percent of the work area, not all of it | `panel_height` takes 60 percent of the work area height and clamps it between 420 and 900 physical pixels |

`alwaysOnTop` in `tauri.conf.json` is not enough for the first one. It reaches only the floating
window level, and a floating window belonging to an inactive application is still ordered under
the windows of the application that was just activated, which is why the button went behind
Finder, behind the application switcher and behind anything full screen. The AppKit settings above
are the fix, and `ignoresMouseEvents` is set to false explicitly so that raising the level does
not cost the button the click that opens the panel. Failure is logged and swallowed: a button at
the wrong level is worth having, a dead app is not. The second decision is a plain clamp, because
full height read as an application window rather than as a panel.

Rust does only what the webview cannot: windows, window level and collection behaviour, vibrancy,
`toggle_panel`, `snap_button`, `open_terminal` and `log_message`. Everything else is TypeScript.
File IO and file watching go through the Tauri fs plugin, git through the shell plugin, and every
parse goes through `@ledge/core/pure`, so the CLI and the app cannot disagree about a file.

Low resource rules: no animation loops while the panel is hidden, a five minute scan interval by
default, 150 ms watch debounce, four concurrent git processes at most, stale repositories skipped.

### Open in Claude and Resume in Claude (phase 2)

1. Resolve the task's repo. If none, use the home folder.
2. Build the command: `claude --resume <lastSession>` if a session exists and the person chose
   Resume; otherwise `claude "<prompt>"` where the prompt comes from `buildResumePrompt`.
3. Launch the configured terminal with that command in that folder: AppleScript `do script` for
   Terminal.app, `wt -d <dir> cmd /k ...` on Windows, `x-terminal-emulator -e ...` on Linux with a
   fallback list.
4. The SessionStart hook takes it from there.

If the launch fails the panel shows the exact command to copy and run.

## Error handling

| Situation | Behaviour |
|---|---|
| Malformed task file | Panel shows the row with a warning badge and the parse error, never crashes. CLI prints the file path and the line, exit 3 |
| `ledge` missing on PATH | Hooks print one hint (SessionStart only) and exit 0 |
| Git not installed, or a repo with no commits | Scan skips it and logs once |
| Terminal launch fails | Panel shows the exact command to copy and run |
| Config missing keys | Defaults merged in memory; the file is not rewritten unless a setting changes in the UI |

## Decisions

- [ADR 0001: plain files, not a database](adr/0001-plain-files-not-a-database.md)
- [ADR 0002: Tauri over Electron](adr/0002-tauri-over-electron.md)
- [ADR 0003: Ledge does not read claude-mem](adr/0003-no-claude-mem-read.md)
