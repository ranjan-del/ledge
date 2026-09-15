# Getting started

Status: phase 0. The CLI and the plugin sections describe what ships today. The desktop app
section describes phase 1, which is in progress and not yet released.

## 1. Install the CLI

You need Node 22.6 or newer. Node runs the TypeScript source directly, so there is no build.

```bash
git clone https://github.com/ranjan-del/ledge.git
cd ledge
npm install
npm install -g ./packages/cli
ledge init
```

`ledge init` creates `~/.ledge/`, a default `config.json` and a sample task. Set `LEDGE_HOME` to
put the store somewhere else. Running `ledge init` again is safe: it reports `created: false` and
changes nothing.

If you prefer not to install globally, every command works as
`npx --prefix ./packages/cli ledge <command>` or as `node packages/cli/bin/ledge.ts <command>`
from the repository root.

## 2. Install the Claude Code plugin

Inside Claude Code:

```
/plugin marketplace add ranjan-del/ledge
/plugin install ledge
```

The plugin requires `ledge` on PATH. If it is missing, the SessionStart hook prints a one line
hint and Claude Code carries on as normal. Uninstall notes are in
[../plugin/README.md](../plugin/README.md).

## 3. Create your first task

Open Claude Code in any repository and type:

```
/ledge start "Add a release watch banner"
```

Claude runs `ledge add` with the current folder as the repo, then writes the Requirement section
from the conversation so far and an initial checklist. From then on:

| You type | Claude does |
|---|---|
| `/ledge` | Runs `ledge` and shows Current, Backlog and Pending |
| `/ledge todo "item"` | Appends an unchecked item to the current task |
| `/ledge park "reason"` | Refreshes the checklist from what was and was not finished, then runs `ledge park` |
| `/ledge done` | Ticks completed items, adds a final note listing anything not pushed or deployed, then runs `ledge done` |

Claude also ticks checklist items as it finishes steps during normal work; the command text asks
it to, and the PreCompact hook reinforces it. When a session ends, the Stop hook links the
session id to the task, so the next time you open Claude Code in that folder the SessionStart hook
briefs it with the title, requirement and unchecked items.

## 4. Look at the desk from the terminal

```bash
ledge                 # Current, Backlog and Pending as aligned text
ledge --json          # the same as JSON
ledge scan            # run the git scan once, print Pending as JSON
ledge current --repo "$PWD" --context    # what the SessionStart hook injects
```

## Command reference

| Command | Effect | Exit codes |
|---|---|---|
| `ledge` | Print Current, Backlog and Pending | 0 |
| `ledge add "title" [--repo path] [--backlog]` | Create a task file, status current unless `--backlog` | 0, 1 |
| `ledge start <id>` | Set status current, order 1, shift others down | 0, 2 |
| `ledge park <id> "reason"` | Set status backlog, record the reason | 0, 1, 2 |
| `ledge done <id>` | Set status done, move the file to `archive/` | 0, 2 |
| `ledge current [--repo path] [--json\|--context]` | Print the current task whose repo matches the folder; `--context` prints the hook block, max 40 lines | 0, 2 |
| `ledge link <id> <sessionId>` | Append a session id if absent | 0, 2 |
| `ledge todo <id> "text"` | Append an unchecked checklist item | 0, 1, 2 |
| `ledge tick <id> <n>` / `ledge untick <id> <n>` | Check or uncheck item `n`, 1-based | 0, 1, 2 |
| `ledge open <id>` | Print the task file path | 0, 2 |
| `ledge scan` | Run the git scan once, print Pending as JSON | 0 |
| `ledge init` | Create the store, a default config and a sample task | 0 |

`--json` on any listing command prints JSON instead of text. Exit codes: 0 ok, 1 usage error,
2 not found, 3 parse error (the CLI prints the file path and the line).

Repo matching: a task matches a folder when the folder equals the task's `repo` or sits inside
it. The deepest match wins.

## 5. The desktop app (phase 1, in progress)

Not yet released. When it is, the install path will be:

1. Download the release for your OS from GitHub Releases and open it.
2. Run `ledge init` once (the app offers to do this on first launch).
3. Install the plugin as in step 2 above.
4. Open Claude Code in any repo and type `/ledge start "first task"`.

To build from source you need Rust via [rustup](https://rustup.rs) and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. On Debian
or Ubuntu that is:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

Then:

```bash
npm install
npm run desktop:dev       # run against your real ~/.ledge
npm run desktop:build     # installer for this platform
```

## Where to go next

- [task-file-format.md](task-file-format.md) if you want to edit tasks by hand or script them.
- [configuration.md](configuration.md) for scan roots, terminal and UI settings.
- [architecture.md](architecture.md) for how the pieces fit.
