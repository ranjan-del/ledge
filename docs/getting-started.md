# Getting started

Status: the CLI and plugin sections describe what is on `main`, including the planning and
session memory commands added by the
[v2 contract](superpowers/specs/2026-09-15-v2-contract.md). The desktop app section describes
phase 1, which is in progress and not yet released.

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
put the store somewhere else. Running `ledge init` again is safe: it prints
`Ledge store already exists at <path>` and changes nothing.

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

Claude runs `ledge add` with the current folder as the repo, writes the Requirement section from
the conversation so far and an initial checklist, then writes the plan before it edits any code.
From then on:

| You type | Claude does |
|---|---|
| `/ledge` | Runs `ledge` and shows Current, Backlog and Pending |
| `/ledge todo "item"` | Appends an unchecked item to the current task |
| `/ledge plan` | Writes or rewrites the ordered plan for the current task |
| `/ledge note "text"` | Appends the text to today's notes on the current task |
| `/ledge when <day>` | Sets the planned day: `YYYY-MM-DD`, `today`, `tomorrow`, or `none` to clear |
| `/ledge park "reason"` | Refreshes the checklist, writes a note, then runs `ledge park` |
| `/ledge done` | Ticks completed items, writes a closing note, then runs `ledge done` |

Four of those Claude does on its own, because the command file makes them standing rules:

- Tick checklist items as steps finish, and add items when work reveals more.
- Write a plan before the first file edit of a session, if the task has none.
- Append a note the moment a decision is made or something turns out to be a dead end.
- Append a closing note before compaction and at the end of a session: what was done, what is
  left, what the next session needs to know.

When a session ends, the Stop hook links the session id to the task. The next time you open Claude
Code in that folder, the SessionStart hook briefs it with the title, the planned day, the
requirement, the plan, the unchecked items and the latest note.

## 4. Plan a day

The four planning commands are `plan`, `note`, `when` and `today`. Below is one session with all
four, as a transcript. The output is real, from a scratch store created with
`export LEDGE_HOME=$(mktemp -d)/ledge`, which is why the file paths are temporary ones. Run these
in order and you get the same thing with your own dates.

Add a task for the repository you are in, and give it a checklist:

```console
$ ledge add "Release watch banner" --repo .
Added current task release-watch-banner
  /var/folders/y1/2vmrczhd1ln9b2t1gcqxvqbm0000gp/T/tmp.CJrGlL2uGr/ledge/tasks/2026-09-15-release-watch-banner.md

$ ledge todo release-watch-banner "Build step that writes version.json"
Added item 1 to release-watch-banner: Build step that writes version.json

$ ledge todo release-watch-banner "Banner component in the shell"
Added item 2 to release-watch-banner: Banner component in the shell
```

Now the steps you expect to take. `ledge plan` replaces the whole plan, so pass every step you
want to keep, not only the new ones:

```console
$ ledge plan release-watch-banner \
    "Write version.json at build time" \
    "Poll it on an interval and on window focus" \
    "Show the banner, reload only when idle"
Plan for release-watch-banner:
  1. Write version.json at build time
  2. Poll it on an interval and on window focus
  3. Show the banner, reload only when idle
```

Say when you mean to do it. `today`, `tomorrow`, `yesterday`, a `YYYY-MM-DD` date and `none` are
all accepted:

```console
$ ledge when release-watch-banner today
Planned release-watch-banner for 2026-09-15
```

Two more tasks, so the day has something in it. One was meant for last Friday and never happened,
one has no planned day at all:

```console
$ ledge add "Optimistic CRUD for the admin list" --repo .
Added current task optimistic-crud-for-the-admin-list
  /var/folders/y1/2vmrczhd1ln9b2t1gcqxvqbm0000gp/T/tmp.CJrGlL2uGr/ledge/tasks/2026-09-15-optimistic-crud-for-the-admin-list.md

$ ledge when optimistic-crud-for-the-admin-list 2026-09-11
Planned optimistic-crud-for-the-admin-list for 2026-09-11

$ ledge add "Audit the porcelain parser"
Added current task audit-the-porcelain-parser
  /var/folders/y1/2vmrczhd1ln9b2t1gcqxvqbm0000gp/T/tmp.CJrGlL2uGr/ledge/tasks/2026-09-15-audit-the-porcelain-parser.md
```

Then ask what is on. `ledge today` prints three sections: the tasks planned for today, the ones
planned earlier that are not done yet, and the current tasks that were not already listed above.
No task appears twice, which is why Current here holds only the third one:

```console
$ ledge today
Today 2026-09-15
  release-watch-banner  Release watch banner  ~/AI/ledge  0/2

Overdue
  overdue since 2026-09-11  optimistic-crud-for-the-admin-list  Optimistic CRUD for the admin list  ~/AI/ledge

Current
  3  audit-the-porcelain-parser  Audit the porcelain parser
```

While you work, record the reasoning. A note goes under today's date, and a second note on the
same day is appended to it rather than replacing it:

```console
$ ledge note release-watch-banner "Polling a version file beats a service worker here: the app already fetches a static config the same way, so there is nothing new to cache-bust."
Added a note to release-watch-banner under 2026-09-15
```

All of it comes back at the start of the next session. This is the same block the SessionStart
hook injects, capped at 40 lines:

```console
$ ledge current --repo . --context
Ledge task: Release watch banner (id: release-watch-banner)
Planned: 2026-09-15 (today)

Requirement:
(none recorded yet)

Plan:
1. Write version.json at build time
2. Poll it on an interval and on window focus
3. Show the banner, reload only when idle

Still to do:
- [ ] Build step that writes version.json
- [ ] Banner component in the shell

Notes (2026-09-15):
Polling a version file beats a service worker here: the app already fetches a static config the same way, so there is nothing new to cache-bust.

Task file: /var/folders/y1/2vmrczhd1ln9b2t1gcqxvqbm0000gp/T/tmp.CJrGlL2uGr/ledge/tasks/2026-09-15-release-watch-banner.md
Tick items, append notes and keep the plan current in that file as you work.
```

The requirement is empty here only because nothing wrote one; `/ledge start` fills it in from the
conversation. Note that the plan and the checklist are not the same list. The plan is what you
meant to do, written before you start. The checklist is what is done and what is left. The notes
are why. Format details are in [task-file-format.md](task-file-format.md).

## 5. Look at the desk from the terminal

```bash
ledge                 # Current, Backlog and Pending as aligned text
ledge --json          # the same as JSON
ledge today           # planned for today, overdue, then current
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
| `ledge current [--repo path] [--json\|--context]` | Print the current task whose repo matches the folder; `--context` prints the hook block, max 40 lines | 0, 1, 2 |
| `ledge link <id> <sessionId>` | Append a session id if absent | 0, 1, 2 |
| `ledge todo <id> "text"` | Append an unchecked checklist item | 0, 1, 2 |
| `ledge tick <id> <n>` / `ledge untick <id> <n>` | Check or uncheck item `n`, 1-based | 0, 1, 2 |
| `ledge plan <id> "step" "step" ...` | Replace the ordered plan steps. At least one step is required | 0, 1, 2 |
| `ledge note <id> "text"` | Append the text to today's `### YYYY-MM-DD` notes subsection | 0, 1, 2 |
| `ledge when <id> <day>` | Set or clear the planned day. `<day>` is `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, or `none` (`clear` also works) | 0, 1, 2 |
| `ledge today` | Tasks planned for today, overdue ones, then the remaining current tasks | 0 |
| `ledge open <id>` | Print the task file path | 0, 1, 2 |
| `ledge scan` | Run the git scan once, print Pending as JSON | 0 |
| `ledge init` | Create the store, a default config and a sample task | 0 |
| `ledge help [command]` | Print the help screen, or the usage of one command | 0 |

`--json` prints JSON instead of text on both listing and mutating commands; on a mutating command
it prints the saved task. `--json` and `--context` cannot be combined. Exit codes: 0 ok, 1 usage
error, 2 not found, 3 parse error (the CLI prints the file path and the line). Every command
except `init` and `help` also exits 2 when there is no store yet, with a hint to run `ledge init`.

Repo matching: a task matches a folder when the folder equals the task's `repo` or sits inside
it. The deepest match wins.

## 6. The desktop app (phase 1, in progress)

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
