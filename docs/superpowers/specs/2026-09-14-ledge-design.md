# Ledge design spec

Date: 2026-09-14
Status: approved direction, awaiting spec review
Author: Ranjan G, with Claude Code

## 1. What Ledge is

Ledge is an open source, local-first work assistant for people who use Claude Code.
It is a floating button at the edge of the screen. Clicking it opens a side panel
with three tabs: Current, Backlog and Pending. Tasks are plain Markdown files in a
folder. Claude Code reads and edits those files through a small plugin, and the
panel re-renders whenever a file changes. Nothing is hosted. Nothing leaves the
machine.

### Goals

- Anyone can clone the repo, install the app and the Claude Code plugin, and use
  it in under ten minutes, on macOS, Windows and Linux.
- Claude Code keeps the task list current with no extra effort from the person:
  starting, parking and finishing a task are one slash command each, and every
  session is linked to the task it worked on.
- The Pending tab is never typed by anyone. It is computed from git.
- Zero token cost for everything except the few hundred tokens a session start
  hook injects and the slash commands the person chooses to run.

### Non-goals for v1

- No database, no MCP server, no background daemon.
- No team features, no sync, no sign-in.
- No Jira, Bitbucket, GitHub PR or calendar integration in the core. These become
  optional connectors later, configured as shell commands.
- No control of a Claude session that is already running. Ledge starts new
  sessions or resumes one by id.

## 2. The store: a folder of Markdown files

Default location `~/.ledge/`. Overridable with `LEDGE_HOME`.

```
~/.ledge/
  config.json
  tasks/
    2026-09-14-release-watch-banner.md
    2026-09-14-optimistic-crud.md
  archive/            # done tasks are moved here by `ledge done`
```

### Task file format

Frontmatter is YAML. Body is Markdown with two known headings. Anything else in
the body is preserved and shown under the checklist.

```markdown
---
id: release-watch-banner
title: Release watch banner for stale tabs
status: current            # current | backlog | done
order: 1                   # position within its status list, 1 is top
repo: ~/code/thinktac-india-production/apps/admin-web   # optional
sessions:                  # Claude Code session ids, newest last
  - b13e8b5e
  - 071729a1
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-14T23:04:00+05:30
parked: Waiting for design approval    # optional, only when status is backlog
---

## Requirement

Users keep old code in open tabs after a deploy and lazy routes fail.
Write version.json at build, poll it and on window focus, show a banner,
reload only when idle, catch chunk-load errors as a safety net.

## Checklist

- [x] Investigated caching setup and why open tabs break
- [x] Design agreed: version.json polling, banner, idle reload
- [ ] Build step that writes version.json
- [ ] ReleaseWatchService with polling and focus listener
- [ ] Banner component in the shell
```

Rules:

- `id` is the filename without date and extension. It is stable; title can change.
- `repo` is the folder the task belongs to. The plugin sets it from the folder the
  Claude session runs in. A task may have no repo.
- Checklist items are GitHub task-list syntax. Progress shown in the panel is the
  ratio of `[x]` to total.
- Done tasks keep `status: done` and move to `archive/` so the tasks folder stays
  small. The panel does not read `archive/` except for a count.
- Files are the API. Any editor, any script, and Claude Code can change them.

### config.json

```json
{
  "roots": ["~/code"],
  "scan": {
    "intervalMinutes": 5,
    "maxDepth": 4,
    "ignore": ["node_modules", ".git", "dist", "target"]
  },
  "terminal": "Terminal.app",
  "claude": {
    "command": "claude",
    "resumeFlag": "--resume"
  },
  "ui": {
    "edge": "right",
    "theme": "system"
  }
}
```

- `roots` are folders the git scanner walks to find repositories.
- `terminal` on macOS is one of `Terminal.app`, `iTerm2`, `Ghostty`, `code`.
  On Windows `wt` or `powershell`. On Linux `x-terminal-emulator`, `gnome-terminal`,
  `konsole`, `kitty`, `alacritty`. First release ships Terminal.app, `wt` and
  `x-terminal-emulator` working, the rest are added as people ask.

## 3. Repository layout

One public GitHub repository, MIT licensed.

```
ledge/
  README.md
  LICENSE
  docs/superpowers/specs/          # this spec and later ones
  cli/                             # `ledge` command, TypeScript on Node, no deps beyond yaml
  plugin/                          # Claude Code plugin
    .claude-plugin/plugin.json
    commands/ledge.md              # /ledge with subcommands
    hooks/hooks.json
    hooks/session-start.sh
    hooks/stop.sh
  app/                             # Tauri 2 + Svelte 5 desktop app
    src/                           # Svelte UI
    src-tauri/                     # Rust shell: windows, effects, fs watch, git, open terminal
  .github/workflows/release.yml    # builds mac, win, linux artifacts on tag
```

`cli/` and `plugin/` are phase 0 and have no Rust dependency. `app/` is phase 1.

## 4. The CLI: `ledge`

A small Node script, installed with `npm install -g` from the repo or run as
`npx`. It exists so the store works before the app exists, and so the plugin
hooks have one thing to call.

| Command | Effect |
|---|---|
| `ledge` | Print Current, Backlog and Pending to the terminal |
| `ledge add "title" [--repo path] [--backlog]` | Create a task file |
| `ledge start <id>` | Set status current, order 1, shift others down |
| `ledge park <id> "reason"` | Set status backlog, record reason |
| `ledge done <id>` | Set status done, move the file to archive |
| `ledge current [--repo path]` | Print the task whose repo matches, as JSON or Markdown |
| `ledge link <id> <sessionId>` | Append a session id |
| `ledge scan` | Run the git scan once and print Pending as JSON |
| `ledge init` | Create `~/.ledge`, a default `config.json` and a sample task |

Repo matching: a task matches a folder when the folder equals the task repo or
sits inside it. The deepest match wins.

## 5. The Claude Code plugin

Installed with `/plugin marketplace add ranjan-del/ledge` then `/plugin install ledge`.
Requires the `ledge` CLI on PATH; the plugin's install notes say so and the hooks
print a one-line hint if it is missing.

### Slash command: `/ledge`

One command file with subcommands, so it stays a single entry in the menu.

| Invocation | What Claude does |
|---|---|
| `/ledge` | Runs `ledge` and shows the desk |
| `/ledge start "title"` | Creates the task for the current repo, then writes the Requirement section from the conversation so far and an initial checklist, using the Edit tool on the new file |
| `/ledge park "reason"` | Refreshes the checklist for the current task from what was and was not finished, then runs `ledge park` |
| `/ledge done` | Ticks completed items, adds a final note listing anything not pushed or deployed, then runs `ledge done` |
| `/ledge todo "item"` | Appends an unchecked item to the current task |

The command text tells Claude the file format precisely, so edits stay valid.
Claude edits the checklist during normal work whenever it finishes a step; the
command file asks it to, and PreCompact reinforces it.

### Hooks

| Hook | Script | Behaviour | Token cost |
|---|---|---|---|
| SessionStart | `session-start.sh` | Runs `ledge current --repo "$PWD"`. If a task matches, prints title, requirement and unchecked items as context. Else prints one line: "No Ledge task for this repo. Use /ledge start to create one." | About 200 |
| Stop | `stop.sh` | Reads the session id from the hook payload, runs `ledge link <id> <session>` for the matching task. Silent. | 0 |
| PreCompact | `pre-compact.sh` | Prints: "Before compaction, update the Ledge checklist for the current task." | Tiny |

Hooks are shell, exit quickly, and never fail the session: any error exits 0
with no output.

## 6. The desktop app

Tauri 2 shell, Svelte 5 UI, TypeScript. Two windows.

### Button window

- Frameless, transparent, always on top, skips the taskbar and dock, no focus steal.
- 44 px circle with a count badge showing the number of Current tasks.
- Draggable; on release it snaps to the nearest screen edge and saves position in
  `config.json` under `ui`.
- Left click toggles the panel. Right click opens a small menu: Refresh git,
  Open tasks folder, Settings, Quit.
- On Linux without a compositor the circle renders opaque.

### Panel window

- Frameless, 380 px wide, full working-area height minus margins, docked to the
  same edge as the button, slides in and out.
- macOS: `NSVisualEffectView` vibrancy, material `sidebar`, 14 px radius.
- Windows 11: Mica; Windows 10: Acrylic; 8 px radius.
- Linux: translucent tint over the app background. KDE users get blur through the
  KWin blur hint. No blur on GNOME.
- Follows system light or dark, overridable in settings.
- Closes when it loses focus, unless pinned from the header.

### Tabs

| Tab | Source | Rows |
|---|---|---|
| Current | task files with `status: current`, sorted by `order` | title, repo short name, branch and ahead count, progress bar, last session time. Drag to reorder writes `order` back to the files |
| Backlog | `status: backlog`, sorted by `updated` desc | title, repo, parked reason. Buttons: Start, Open in Claude |
| Pending | git scan results | one row per repo with dirty files, unpushed commits, or a non-main branch ahead of main. If a task references the repo the row shows its title |

### Task detail

Opens inside the panel with a back link. Shows title, repo, branch state,
Requirement, Done items, Pending items, session count and last session time.
Checklist toggles write to the file. Buttons: Park, Mark done, Resume in Claude,
Open folder.

### File watching

The Rust side watches `~/.ledge/tasks` and `~/.ledge/config.json` with the
`notify` crate, debounced at 150 ms, and emits an event; the UI re-parses only
the changed file. Parsing is done in TypeScript with a small frontmatter parser
so the same code runs in the CLI and the app.

### Git scan

Runs on launch, every `scan.intervalMinutes`, and on the Refresh action. For
each root, walk to `maxDepth` looking for `.git`. For each repo run:

```
git -C <repo> status --porcelain=v2 --branch
```

That single command gives branch name, upstream, ahead and behind counts and the
dirty file list. Repos untouched for 30 days (by `.git/index` mtime) are skipped
unless a task references them. Results are held in memory and written to
`~/.ledge/.scan-cache.json` so the panel is populated instantly on next launch.

### Open in Claude and Resume in Claude

- Resolve the task repo. If none, use the home folder.
- Build the command: `claude --resume <lastSession>` if a session exists and the
  person chose Resume; otherwise `claude "<prompt>"` where the prompt is the
  title, the Requirement and the unchecked items.
- Launch the configured terminal with that command in that folder. On macOS
  Terminal.app this is an AppleScript `do script`; on Windows `wt -d <dir> cmd /k ...`;
  on Linux `x-terminal-emulator -e ...` with a fallback list.
- The SessionStart hook takes it from there.

## 7. Cross-platform builds and install

- `.github/workflows/release.yml` uses `tauri-apps/tauri-action` on a tag push
  to build `.dmg`, `.msi` and `.AppImage` plus `.deb`, and attaches them to a
  GitHub Release.
- README install path for a person who does not build from source:
  1. Download the release for their OS and open it.
  2. Run `ledge init` once (the app offers to do this on first launch).
  3. In Claude Code: `/plugin marketplace add ranjan-del/ledge`, `/plugin install ledge`.
  4. Open Claude Code in any repo and type `/ledge start "first task"`.
- Build from source: `git clone`, `npm install`, `npm run tauri build`. Requires
  Rust via rustup and the platform's Tauri prerequisites, linked from the README.

## 8. Error handling

- Malformed task file: the panel shows the row with a warning badge and the parse
  error, and never crashes. The CLI prints the file path and the line.
- `ledge` missing on PATH: hooks print one hint and exit 0.
- Git not installed or a repo with no commits: the scan skips it and logs once.
- Terminal launch fails: the panel shows the exact command to copy and run.
- Config missing keys: defaults are merged in; the file is not rewritten unless
  the person changes a setting in the UI.

## 9. Testing

- `cli/` and the shared parser: unit tests with Node's built-in test runner
  covering parse, serialize round trip, repo matching, order shifting, and the
  porcelain v2 parser against recorded fixtures.
- `plugin/`: a shell test that feeds recorded hook payloads to each script and
  asserts output and exit code.
- `app/`: component tests for the three tabs and task detail with fixture files;
  a manual checklist per OS for window effects, drag and snap, and terminal
  launch, kept in `docs/manual-qa.md`.

## 10. Phases

| Phase | Deliverable | You will see |
|---|---|---|
| 0 | `cli/`, `plugin/`, shared parser, tests, README | `/ledge` works in any repo; sessions link to tasks; `ledge` prints the desk |
| 1 | `app/` on macOS: button, panel, three tabs, detail, file watch, git scan | The button on your desktop, live against your real task files |
| 2 | Open and Resume in Claude, Windows and Linux builds, release workflow | One click from a backlog row to a briefed Claude session; installers for all three OSes |
| 3 | Optional connectors: PR status and calendar via user-configured commands | Pending shows "in review" and an agenda strip, only for people who configure them |

## 11. Decisions taken

| Decision | Choice |
|---|---|
| Source of truth | Markdown files in `~/.ledge`, no database, no server |
| Desktop shell | Tauri 2 with Svelte 5 |
| First terminal | Terminal.app on macOS |
| Repo home | GitHub, personal account, MIT |
| Name | Ledge, used for the CLI, the plugin and the slash command |
