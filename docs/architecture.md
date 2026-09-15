# Architecture

Status: the core, CLI and plugin sections describe phase 0. The desktop app sections describe
phase 1 and 2 as designed; the app is in progress and not yet released.

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
| `packages/core` (`@ledge/core`) | Task file parse and serialize, config, `TaskStore`, repo matching, porcelain v2 parser, repository scanner, resume prompt | `yaml` only |
| `packages/cli` (`@ledge/cli`) | The `ledge` binary. Thin argument parsing over `TaskStore`; plain text or JSON output | `@ledge/core` |
| `plugin/` | Claude Code plugin: `/ledge` command file, `hooks.json`, three POSIX sh scripts | The `ledge` CLI on PATH |
| `apps/desktop` | Tauri 2 shell in Rust, Svelte 5 UI in TypeScript. Imports `@ledge/core` for all parsing | Tauri plugins `fs`, `shell`, `os`; crates `window-vibrancy`, `notify` |

Dependency direction is strict: the CLI and the app depend on core; core depends on nothing but
`yaml`; the plugin depends on the CLI binary and never imports code. Cross package imports are
`@ledge/core` only, never a deep path.

Core and CLI are TypeScript run directly by Node 22 with type stripping. There is no build step,
which is why `erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces.

## Core public API

The full signatures are Contract 2 in the
[phase 0 plan](superpowers/plans/2026-09-15-phase-0-plan.md). In outline:

| Group | Functions |
|---|---|
| Home and config | `ledgeHome()`, `defaultConfig()`, `loadConfig()`, `saveConfig()` |
| Task files | `parseTask()`, `serializeTask()`, `slugify()`, `taskFileName()`, `TaskParseError` |
| Store | `TaskStore` with `init list archived get add start park done link addTodo setTodo reorder currentFor save` |
| Matching | `matchRepo(tasks, cwd)` returns the deepest repo match |
| Git | `parsePorcelainV2()`, `findRepos()`, `scanRepos()`, `isPending()` |
| Claude | `buildResumePrompt(task)` returns title, requirement and unchecked items |

`parseTask` and `serializeTask` round trip: parsing a serialized task and serializing again yields
the same text. `loadConfig` deep merges defaults and never writes. `TaskStore` bumps `updated` on
every save and never writes outside its `home`.

## Data flow, phase 0

### Session start

```
Claude Code starts in ~/code/foo
  \-- SessionStart hook: session-start.sh
       \-- ledge current --repo ~/code/foo --context
            |-- TaskStore.currentFor(cwd): deepest repo match among status: current
            |-- match: print title, requirement, unchecked items (max 40 lines)   ~200 tokens
            \-- no match: print "No Ledge task for this repo. Use /ledge start to create one."
```

### During the session

```
/ledge start "title"   ->  ledge add "title" --repo $PWD, then Claude edits the new file:
                          writes ## Requirement from the conversation, an initial ## Checklist
step finishes          ->  Claude edits the checklist, ticks the item
/ledge todo "item"     ->  ledge todo <id> "item"
PreCompact hook        ->  "Before compaction, update the Ledge checklist for the current task."
/ledge park "reason"   ->  Claude refreshes the checklist, then ledge park <id> "reason"
/ledge done            ->  Claude ticks completed items, adds a final note, then ledge done <id>
```

### Session end

```
Stop hook: stop.sh
  \-- reads session_id and cwd from the payload on stdin
       \-- ledge link <id> <session_id>    (silent, exit 0 whatever happens)
```

Hooks are POSIX sh with 5 second timeouts. They always exit 0 and print nothing on error, so a
Ledge bug can never fail a Claude Code session. Only SessionStart may print a hint, and only when
`ledge` is missing from PATH.

## What Ledge reads and does not read

| Reads | Does not read |
|---|---|
| `~/.ledge/tasks/*.md` and `~/.ledge/config.json` | Claude Code conversation transcripts |
| `~/.ledge/archive/` for a count only | The claude-mem database or any other memory plugin's store ([ADR 0003](adr/0003-no-claude-mem-read.md)) |
| `git -C <repo> status --porcelain=v2 --branch` for repositories under `roots` | Anything under `~/.claude` |
| `.git/index` mtime to decide whether a repository is stale | Anything over the network |
| `cwd` and `session_id` from the hook payload | Any other field of the hook payload |

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

## The desktop app (phase 1 and 2, design)

Two windows, declared in `tauri.conf.json`:

- `button`: 48x48, transparent, no decorations, always on top, skips the taskbar, not resizable.
  Renders a 44 px circle with the Current count. Drag, release, snap to the nearest edge, save
  `ui.edge` and `ui.y`. Left click toggles the panel; right click opens Refresh git, Open tasks
  folder, Settings, Quit.
- `panel`: 380x720, transparent, no decorations, hidden at start. Docked to the same edge, slides
  in and out, closes on focus loss unless pinned. macOS Sidebar vibrancy; Windows Mica with
  Acrylic fallback; Linux translucent tint.

Rust does only what the webview cannot: windows, vibrancy, `toggle_panel`, `snap_button`,
`open_terminal`, and file watching with `notify` at 150 ms debounce. Everything else is
TypeScript. File IO goes through the Tauri fs plugin, git through the shell plugin, and every
parse goes through `@ledge/core`, so the CLI and the app cannot disagree about a file.

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
