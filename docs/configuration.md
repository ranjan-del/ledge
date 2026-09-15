# Configuration

Status: Contract 2 `Config` of phase 0. Fixed. The `terminal` and `ui` keys are read by the
desktop app (phase 1 and 2) and are inert for the CLI today.

## Where

`$LEDGE_HOME/config.json`, default `~/.ledge/config.json`. Created by `ledge init`. Missing keys
are deep merged with defaults in memory and the file is not rewritten unless you change a setting
in the UI. Every test sets `LEDGE_HOME` to a temporary directory; Ledge never writes outside it.

## Default file

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

## Keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `roots` | list of paths | `["~/code"]` | Folders the git scanner walks to find repositories. `~` is expanded |
| `scan.intervalMinutes` | number | `5` | How often the desktop app re-runs the git scan. The CLI runs it on demand |
| `scan.maxDepth` | number | `4` | How many folder levels below each root to look for `.git` |
| `scan.ignore` | list of names | `["node_modules", ".git", "dist", "target"]` | Folder names never entered while walking |
| `scan.staleDays` | number | `30` | Repositories whose `.git/index` is older than this are skipped unless a task references them |
| `terminal` | string | `"Terminal.app"` | Program used for Open in Claude and Resume in Claude (phase 2). See the table below |
| `claude.command` | string | `"claude"` | The Claude Code executable |
| `claude.resumeFlag` | string | `"--resume"` | Flag placed before a session id when resuming |
| `ui.edge` | `left` or `right` | `"right"` | Screen edge the button and panel dock to. Written by the app when you drag the button |
| `ui.theme` | `system`, `light` or `dark` | `"system"` | Colour scheme. `system` follows the OS |
| `ui.y` | number | unset | Vertical position of the button, saved by the app after a drag |

## Terminals

| OS | Values | Shipped in first release |
|---|---|---|
| macOS | `Terminal.app`, `iTerm2`, `Ghostty`, `code` | `Terminal.app` |
| Windows | `wt`, `powershell` | `wt` |
| Linux | `x-terminal-emulator`, `gnome-terminal`, `konsole`, `kitty`, `alacritty` | `x-terminal-emulator` |

The rest are added as people ask. If a launch fails, the panel shows the exact command so you
can copy and run it yourself.

## Environment

| Variable | Effect |
|---|---|
| `LEDGE_HOME` | Location of the store. Default `~/.ledge` |

There are no other environment variables and no secrets. Ledge makes no network calls.

## Other files under `LEDGE_HOME`

| Path | Written by | Purpose |
|---|---|---|
| `tasks/*.md` | CLI, plugin (through Claude's edits), app | Live tasks. Format in [task-file-format.md](task-file-format.md) |
| `archive/*.md` | `ledge done` | Finished tasks. Read only for a count |
| `.scan-cache.json` | Desktop app | Last git scan result so the panel is populated instantly on launch |
