<h1 align="center">Ledge</h1>

<p align="center">
  <b>A local first work assistant for people who use Claude Code.</b><br/>
  Your current tasks, your backlog and your unpushed work, kept in plain Markdown files that
  Claude Code edits for you. Nothing is hosted. Nothing leaves the machine.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/ranjan-del/ledge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ranjan-del/ledge/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-orange">
</p>

> **Status: pre-alpha.** What exists today is the `ledge` command line tool, the shared core
> library and the Claude Code plugin. Together they give you a task store in `~/.ledge`, a
> `/ledge` slash command and hooks that brief Claude at session start and link every session to
> the task it worked on. Each task can also carry a plan, a planned day and dated notes, so a
> session starts with the reasoning from the last one and `ledge today` can answer what is on.
> The desktop app (the floating button and side panel) is phase 1 and is in progress, not yet
> released. Nothing in this README claims a feature that is not marked as shipped in
> [ROADMAP.md](ROADMAP.md). Documentation lives in [docs/](docs/README.md).

---

## Table of contents

1. [What it is](#what-it-is)
2. [How it works](#how-it-works)
3. [The task file](#the-task-file)
4. [Technology stack](#technology-stack)
5. [Installation](#installation)
6. [Configuration](#configuration)
7. [Repository layout](#repository-layout)
8. [What works today](#what-works-today)
9. [Limitations](#limitations)
10. [Roadmap](#roadmap)
11. [Contributing](#contributing)
12. [License](#license)

---

## What it is

Ledge is an open source, local first work assistant for people who use Claude Code. When complete
it is a floating button at the edge of the screen. Clicking it opens a side panel with three tabs:

| Tab | What it shows | Who writes it |
|---|---|---|
| Current | The tasks you are working on now, in order, with progress | You, through Claude Code |
| Backlog | Tasks you parked, with the reason | You, through Claude Code |
| Pending | Repositories with dirty files or unpushed commits | Nobody. It is computed from git |

Tasks are plain Markdown files in a folder. Claude Code reads and edits those files through a
small plugin, and the panel re-renders whenever a file changes. Current is the home view: it
answers what is on for today, then what you are working on, then what needs attention.

Goals, taken from the [design spec](docs/superpowers/specs/2026-09-14-ledge-design.md):

- Anyone can clone the repo, install the app and the plugin, and use it in under ten minutes, on
  macOS, Windows and Linux.
- Claude Code keeps the task list current with no extra effort from the person: starting, parking
  and finishing a task are one slash command each, and every session is linked to the task it
  worked on.
- The Pending tab is never typed by anyone. It is computed from git.
- Zero token cost for everything except the few hundred tokens a session start hook injects and
  the slash commands the person chooses to run.

## How it works

### Files are the store

Everything lives under `~/.ledge/` (override with `LEDGE_HOME`):

```
~/.ledge/
  config.json
  tasks/
    2026-09-14-release-watch-banner.md
    2026-09-14-optimistic-crud.md
  archive/            # done tasks are moved here by `ledge done`
```

Each task is one Markdown file with YAML frontmatter and four known headings: `## Requirement`,
`## Plan`, `## Checklist` and `## Notes`. Only the first is usually filled in on day one; the
other three are optional. There is no database, no server and no daemon. Any editor, any script
and Claude Code can change the files, and the files are the API. Full format in
[docs/task-file-format.md](docs/task-file-format.md).

### The CLI is the one thing everyone calls

`ledge` is a small Node script. It prints the desk, creates and moves tasks, links sessions and
runs the git scan. It exists so the store works before the app exists, and so the plugin hooks
have one thing to call. Command reference in [docs/getting-started.md](docs/getting-started.md).

### The plugin keeps Claude Code in the loop

The plugin adds one slash command, `/ledge`, with subcommands `start`, `park`, `done`, `todo`,
`plan`, `note` and `when`, and three hooks:

| Hook | What it does | Token cost |
|---|---|---|
| SessionStart | Runs `ledge current --repo "$PWD" --context`. If a task matches the folder, prints its title, planned day, requirement, plan, unchecked items and latest note as context. Otherwise prints one line telling you how to create one | About 200 |
| Stop | Reads the session id from the hook payload and runs `ledge link` so the task remembers the session. Silent | 0 |
| PreCompact | Reminds Claude to tick the checklist and append a note before context is compacted, because the note is the part that survives it | Tiny |

Hooks are shell, exit quickly and never fail the session: any error exits 0 with no output. If
`ledge` is not on PATH the SessionStart hook prints one hint and stops.

The command file also carries standing rules, so Claude does four things without being asked: it
ticks the checklist as steps finish, writes a plan before its first file edit, appends a note the
moment it makes a decision or hits a dead end, and appends a closing note before compaction and at
the end of a session. Notes are for reasoning and dead ends, not a restatement of the checklist.

### What Ledge reads, and what it deliberately does not

| Ledge reads | Ledge does not read |
|---|---|
| Task files under `~/.ledge/tasks` and `~/.ledge/archive` (archive only for a count) | Your Claude Code conversation transcripts |
| `~/.ledge/config.json` | The claude-mem database or any other memory plugin's store ([ADR 0003](docs/adr/0003-no-claude-mem-read.md)) |
| `git status --porcelain=v2 --branch` output for repositories under your configured roots | Anything under `~/.claude` |
| The `cwd` and `session_id` fields of the hook payload | Anything over the network |

The session link is an id and nothing more. Resuming a session later is Claude Code's job, through
`claude --resume <id>`.

### The desktop app watches the folder

Once phase 1 ships, the app watches `~/.ledge/tasks` and `~/.ledge/config.json` through the Tauri
`fs` plugin's watcher, debounced, and the UI re-parses only the changed file. Parsing
is TypeScript in `@ledge/core`, so the same code runs in the CLI and the app. The app imports it
as `@ledge/core/pure`, an entry point with no Node modules in it, so one parser serves both
without the app needing a shim or a second implementation that could disagree about a file.

### Pending is a git scan

On launch, every `scan.intervalMinutes`, and on Refresh, Ledge walks each configured root to
`maxDepth` looking for `.git` and runs one command per repository:

```
git -C <repo> status --porcelain=v2 --branch
```

That single command gives the branch name, upstream, ahead and behind counts and the dirty file
list. A repository is Pending when it has dirty files, unpushed commits, or a non-main branch
ahead of main. Repositories untouched for `scan.staleDays` (by `.git/index` mtime) are skipped
unless a task references them. Results are cached in `~/.ledge/.scan-cache.json` so the panel is
populated instantly on the next launch. `ledge scan` runs the same scan once and prints JSON.

## The task file

```markdown
---
id: release-watch-banner
title: Release watch banner for stale tabs
status: current            # current | backlog | done
order: 1                   # position within its status list, 1 is top
repo: ~/code/thinktac-india-production/apps/admin-web   # optional
planned: 2026-09-18        # optional, the day you intend to work on this
sessions:                  # Claude Code session ids, newest last
  - b13e8b5e
  - 071729a1
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-16T09:12:00+05:30
parked: Waiting for design approval    # optional, only when status is backlog
---

## Requirement

Users keep old code in open tabs after a deploy and lazy routes fail.
Write version.json at build, poll it and on window focus, show a banner,
reload only when idle, catch chunk-load errors as a safety net.

## Plan

1. Write version.json at build time
2. Poll it on an interval and on window focus
3. Show the banner, reload only when idle

## Checklist

- [x] Investigated caching setup and why open tabs break
- [x] Design agreed: version.json polling, banner, idle reload
- [ ] Build step that writes version.json
- [ ] ReleaseWatchService with polling and focus listener
- [ ] Banner component in the shell

## Notes

### 2026-09-15
Decided to poll a version file rather than use a service worker, because the app already
fetches a static config file the same way. Chunk load errors are the safety net.
```

`id` is the filename without date and extension and is stable; the title can change. Progress is
the ratio of `[x]` to total checklist items.

`planned`, `## Plan` and `## Notes` are optional, and a file written without them stays valid.
The plan is the intent, written before work starts. The checklist is the tracking. The notes are
the session memory: one `### YYYY-MM-DD` subsection per day carrying the decisions and dead ends
that a ticked box cannot explain. Sections are always written in the order Requirement, Plan,
Checklist, Notes, then anything Ledge does not recognise, which it preserves rather than drops.

## Technology stack

Every choice was made against three criteria: low RAM, low battery use and simplicity.

| Layer | Choice | Why |
|---|---|---|
| Core and CLI runtime | Node 22+ with native TypeScript | Node strips types and runs `.ts` files directly, so there is no build step, no bundler and nothing to install beyond Node |
| Frontmatter | `yaml` | The only runtime dependency in the core library; a small, well tested parser is simpler than writing one |
| Desktop shell | Tauri 2 | Uses the operating system's own webview instead of bundling a browser, so the app is a few megabytes and idles in a fraction of the memory an Electron app needs |
| UI | Svelte 5 | Compiles components to small, direct DOM updates with no virtual DOM and no framework runtime loop, so a hidden panel costs nothing |
| UI build | Vite | Fast development server and production build for the Svelte UI, and the default Tauri 2 pairing |
| UI tests | Vitest | Runs component tests against fixture task files using the same Vite configuration, so there is one toolchain, not two |
| Window effects | `window-vibrancy` | Asks the OS compositor for native materials (macOS Sidebar, Windows Mica or Acrylic) instead of blurring in CSS, so the GPU work is done once by the system |
| File watching | Tauri `fs` plugin with its `watch` feature | Subscribes to OS file events instead of polling, so the app sleeps until a task file actually changes, and it is one dependency rather than a second watcher of its own |
| macOS window level | `objc2` bindings to AppKit | There is no Tauri API for a status-level window that joins every Space, and that is what keeps the floating button on screen when another application is activated |
| CI and releases | GitHub Actions | Tests on Node 22 and 24, type checks the Rust shell on three operating systems, and builds installers on a tag, with no servers to run |

## Installation

### CLI (phase 0, works today)

From a clone:

```bash
git clone https://github.com/ranjan-del/ledge.git
cd ledge
npm install
npm install -g ./packages/cli     # puts `ledge` on your PATH
ledge init                        # creates ~/.ledge, a default config.json and a sample task
ledge                             # prints Current, Backlog and Pending
```

Or without installing globally:

```bash
npx --prefix ./packages/cli ledge init
```

Requires Node 22.6 or newer. The CLI has no dependency other than `yaml`.

### Claude Code plugin (phase 0, works today)

Inside Claude Code:

```
/plugin marketplace add ranjan-del/ledge
/plugin install ledge
```

The plugin requires the `ledge` CLI on PATH. Then open Claude Code in any repository and type
`/ledge start "your first task"`. Details, hook behaviour and uninstall notes are in
[plugin/README.md](plugin/README.md).

### Desktop app (phase 1, in progress, not yet released)

Phase 1 is the current phase, and the window behaviour it is settling is listed in
[ROADMAP.md](ROADMAP.md): the floating button has to stay on screen when you switch
applications, on every Space and alongside a full screen application, and the panel is 60 percent
of the screen height rather than all of it. None of it is released yet.

When the first release is published, download the installer for your operating system from
[GitHub Releases](https://github.com/ranjan-del/ledge/releases) and open it. The app offers to run
`ledge init` on first launch.

To build from source you need Rust via [rustup](https://rustup.rs) and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform:

```bash
npm install
npm run desktop:build
```

## Configuration

`~/.ledge/config.json` is created by `ledge init`. Missing keys are merged with defaults and the
file is not rewritten unless you change a setting in the UI.

```json
{
  "roots": ["~/code"],
  "scan": {
    "intervalMinutes": 5,
    "maxDepth": 4,
    "ignore": ["node_modules", ".git", "dist", "target"],
    "staleDays": 30
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

`roots` are the folders the git scanner walks. `terminal` is the program the app opens for "Open
in Claude" and "Resume in Claude" (phase 2). Every key is explained in
[docs/configuration.md](docs/configuration.md).

## Repository layout

```
ledge/
  package.json                 npm workspaces: packages/*, apps/*
  tsconfig.base.json           shared TypeScript options
  packages/core/               @ledge/core   shared logic, zero runtime deps except `yaml`
  packages/cli/                @ledge/cli    the `ledge` binary, depends on @ledge/core
  apps/desktop/                Tauri 2 + Svelte 5 app, depends on @ledge/core
  plugin/                      Claude Code plugin (no build)
  .claude-plugin/marketplace.json   so `/plugin marketplace add ranjan-del/ledge` works
  docs/                        getting-started, task-file-format, architecture, configuration,
                               manual-qa, adr/, superpowers/ (specs and plans)
  .github/                     CI, release, templates
  README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ROADMAP, CHANGELOG, NOTICE
```

`packages/core`, `packages/cli` and `plugin` are phase 0 and have no Rust dependency.
`apps/desktop` is phase 1.

## What works today

Phase 0 is complete, and the planning and session memory additions are on `main`:

- `@ledge/core`: task file parse and serialize with a round trip guarantee, two entry points so
  the same parser runs on Node and in a WebView, config loading with default merging, the
  `TaskStore` (init, list, add, start, park, done, link, todo, tick, reorder, setPlanned, addNote,
  setPlan), the planning helpers (`isoDay`, `isIsoDay`, `shiftDay`, `plannedFor`, `appendNote`,
  `setPlan`), repo matching where the deepest match wins, a `git status --porcelain=v2` parser, the
  repository scanner and the resume prompt builder.
- `ledge` CLI: every command in the table below, plain text output aligned with spaces, `--json`
  on listing and mutating commands, exit codes 0 ok, 1 usage error, 2 not found, 3 parse error.
- Claude Code plugin: the `/ledge` command with `start`, `park`, `done`, `todo`, `plan`, `note`
  and `when`, its standing rules for plans and notes, and the SessionStart, Stop and PreCompact
  hooks.
- Tests: Node's built in runner for core and CLI, a shell test that feeds recorded hook payloads to
  each script.

| Command | Effect |
|---|---|
| `ledge` | Print Current, Backlog and Pending to the terminal |
| `ledge add "title" [--repo path] [--backlog]` | Create a task file |
| `ledge start <id>` | Set status current, order 1, shift others down |
| `ledge park <id> "reason"` | Set status backlog, record reason |
| `ledge done <id>` | Set status done, move the file to archive |
| `ledge delete <id> --yes` | Destroy a task and its file. The only command that loses data |
| `ledge current [--repo path] [--json\|--context]` | Print the task whose repo matches |
| `ledge link <id> <sessionId>` | Append a session id |
| `ledge todo <id> "text"` | Append an unchecked checklist item |
| `ledge tick <id> <n>`, `ledge untick <id> <n>` | Check or uncheck item n (1-based) |
| `ledge plan <id> "step" "step" ...` | Replace the ordered plan steps |
| `ledge note <id> "text"` | Append text to today's notes |
| `ledge when <id> <YYYY-MM-DD\|today\|tomorrow\|none>` | Set or clear the planned day |
| `ledge today` | Tasks planned for today, overdue ones, then the remaining current tasks |
| `ledge sessions [--json]` | Every session id the plugin has linked, newest first |
| `ledge memory [query] [--json]` | Dated notes across every task, filtered by every term given |
| `ledge open <id>` | Print the task file path |
| `ledge scan` | Run the git scan once and print Pending as JSON |
| `ledge app` | Start the desktop panel, detached |
| `ledge init` | Create `~/.ledge`, a default `config.json` and a sample task |
| `ledge help [command]` | Print the help screen, or the usage of one command |

`ledge current --context` prints what the SessionStart hook injects: the title, the planned day,
the requirement, the plan, the unchecked items and the latest note, capped at 40 lines. When it
does not fit, the note is shortened from its oldest line first and dropped before anything else.

## Limitations

Pre-alpha. The desktop app does not exist yet as a release; today Ledge is a CLI and a plugin.

Behaviour at the edges, as designed:

- A malformed task file never crashes anything. The panel shows the row with a warning badge and
  the parse error; the CLI prints the file path and the line.
- If `ledge` is missing from PATH, the hooks print one hint and exit 0. Claude Code carries on.
- If git is not installed, or a repository has no commits, the scan skips it and logs once.
- If launching the terminal fails, the panel shows the exact command to copy and run.
- Missing config keys are filled with defaults in memory; the file is not rewritten unless you
  change a setting in the UI.

Deliberately out of scope for v1:

- No database, no MCP server, no background daemon.
- No team features, no sync, no sign in.
- No Jira, Bitbucket, GitHub PR or calendar integration in the core. These become optional
  connectors later, configured as shell commands.
- No control of a Claude session that is already running. Ledge starts new sessions or resumes
  one by id.
- First release supports `Terminal.app` on macOS, `wt` on Windows and `x-terminal-emulator` on
  Linux. Other terminals are added as people ask.

## Roadmap

See [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md).

| Phase | Deliverable | You will see |
|---|---|---|
| 0 | `packages/core`, `packages/cli`, `plugin`, tests, docs | `/ledge` works in any repo; sessions link to tasks; `ledge` prints the desk |
| 1 | `apps/desktop` on macOS: button, panel, three tabs, detail, file watch, git scan | The button on your desktop, live against your real task files |
| 2 | Open and Resume in Claude, Windows and Linux builds, release workflow | One click from a backlog row to a briefed Claude session; installers for all three OSes |
| 3 | Optional connectors: PR status and calendar via user configured commands | Pending shows "in review" and an agenda strip, only for people who configure them |

Later: an SDK package, an MCP server as an optional alternative to file editing, optional
connectors for PR status and calendar, team features.

## Contributing

Fork, branch, open a pull request. `main` only changes through reviewed pull requests with green
CI. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the flow, the ground rules (files are the API, no
feature claimed before it ships, hooks never fail a session) and the development setup. Security
issues go through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

In plain words: use it, change it, ship it, commercially or not, as long as the copyright and
license notice travel with it. There is no contributor license agreement; by opening a pull
request you agree that your contribution is licensed under the same MIT terms.
