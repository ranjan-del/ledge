# Ledge plugin for Claude Code

The plugin is the bridge between Claude Code and your Ledge task files. It adds one slash
command, `/ledge`, and four hooks that brief each session, link it to the task it worked
on, remind Claude to update the checklist and append a closing note before compaction, and
start `ledge capture` in the background after each turn, before compaction and at session end.
The capture sends a digest of that session's transcript to Haiku through `claude -p`, the same
Claude Code you are already signed in to; nothing else leaves your machine.

## Requirements

- Claude Code with plugin support.
- The `ledge` CLI on your PATH. Install it from this repo with
  `npm install -g @ledge/cli` (or `npm install -g` from `packages/cli`), then run
  `ledge init` once. The hooks call `ledge`; if it is missing, the SessionStart hook prints
  one hint line and everything else stays silent.
- A POSIX `sh` with `awk`, `sed` and `tr`. That is every macOS and Linux box, and Git Bash
  or WSL on Windows.

## Install

In Claude Code:

```text
/plugin marketplace add ranjan-del/ledge
/plugin install ledge@ledge
```

The first command registers this repository as a marketplace named `ledge` (from the root
`.claude-plugin/marketplace.json`). The second installs the plugin it lists at `./plugin`.
Run `/reload-plugins` if the install summary asks for it.

To try a local checkout without installing:

```sh
claude --plugin-dir ./plugin
```

## The `/ledge` command

Plugin commands are namespaced, so the full name is `/ledge:ledge`. Subcommands are read
from the arguments:

- `/ledge`: runs `ledge` and shows the desk.
- `/ledge start "title"`: creates the task for the current repo, then writes the Requirement
  from the conversation so far and an initial checklist with the Edit tool.
- `/ledge park "reason"`: refreshes the checklist from what was and was not finished, then
  runs `ledge park`.
- `/ledge done`: ticks completed items, appends a closing note listing anything not pushed
  or deployed, then runs `ledge done`.
- `/ledge todo "item"`: appends an unchecked item to the current task.
- `/ledge plan`: writes or rewrites the ordered plan, the steps intended before work starts.
- `/ledge note "text"`: appends text to today's `### YYYY-MM-DD` subsection under `## Notes`.
- `/ledge when <day>`: sets the planned day from `YYYY-MM-DD`, `today`, `tomorrow`, or
  `none` to clear it.

The command file also tells Claude the exact task file format, including the `planned`
frontmatter key, the `## Plan` ordered list and the dated `## Notes` subsections. Its
standing rules ask Claude, without being asked each time, to tick checklist items as steps
finish, to write a plan before editing code when the task has none, to append a note the
moment a decision is made or something surprising is found, and to append a closing note
covering what was done, what is left and what the next session needs to know, both before
compaction and at the end of a session.

## Hooks

All four hooks are POSIX `sh` scripts in `hooks/`, wired in `hooks/hooks.json` with a
5 second timeout each. They read the JSON payload Claude Code writes to stdin and use only
the `cwd`, `session_id` and `transcript_path` fields, extracted with `awk`, so there is no
`jq` dependency. Every script exits 0 in every case, so a hook can never fail or block a
session. Every script also exits at once when `LEDGE_CAPTURE=1` is set: the capture sets it
for the `claude -p` it runs, so a capture never starts another capture.

The capture is launched as `( LEDGE_CAPTURE=1 nohup ledge capture ... >/dev/null 2>&1 & )`:
detached, with every stream redirected, so the hook returns in well under a second. Its own
debounce (fewer than 40 new transcript lines and under 10 minutes since the last capture is a
skip) keeps most turns free. What it did is in `~/.ledge/capture.log`.

- SessionStart, `session-start.sh`: runs `ledge current --repo "<cwd>" --context`. If a task
  matches, its title, planned day, requirement, plan, unchecked items and latest note are
  injected as context. Otherwise it prints `No Ledge task for this repo. Use /ledge start to
  create one.` Either way a standing rules block of nine lines follows. It also runs
  `ledge track` to write the session record skeleton. If `ledge` is not on PATH it prints one
  hint line instead.
- Stop, `stop.sh`: resolves the task for `cwd` with `ledge current --json`, then runs
  `ledge link <id> <session_id>` so the session is recorded on the task, then `ledge settle`,
  then starts `ledge capture` detached when the payload names a transcript. Prints nothing
  unless settle promoted a task.
- SessionEnd, `session-end.sh`: runs `ledge track --ended` so the session stops showing as
  running, then starts `ledge capture --final` detached. Prints nothing.
- PreCompact, `pre-compact.sh`: if a task matches `cwd`, prints one line asking Claude to
  tick that task's checklist and to run `ledge note <id> "..."` with what was done, what is
  left and what the next session needs, before the reasoning is compacted away. Prints
  nothing otherwise. It also starts `ledge capture --final` detached, task or not.

Errors from `ledge` (parse errors, unexpected exit codes) produce no output at all.

## Token cost

- SessionStart context block, once per session start, resume, clear or compact: about 250
  tokens, capped at 40 lines by the CLI. When the block would overflow, the CLI drops the
  oldest note lines first and never the requirement or the unchecked items.
- SessionStart hint line, only when no task matches or `ledge` is missing: under 30 tokens.
- Standing rules, with every SessionStart block: about 150 tokens.
- Stop hook, every time Claude stops: 0 tokens in the session, it prints nothing. The capture
  it starts costs one Haiku call when it is not debounced.
- PreCompact reminder, only when compaction happens and a task matches: about 60 tokens.
- `/ledge` command body, only when you invoke `/ledge`: about 2,600 tokens.

Nothing else is injected. The capture reads only the transcript of the session whose hook
started it, and no memory plugin's store.

## Test

```sh
sh plugin/test/hooks.test.sh
```

The test puts a fake `ledge` on PATH that records its arguments and prints canned output,
feeds the payloads in `test/fixtures/` to each hook script, and checks stdout and exit
codes. It also checks that `commands/ledge.md` still documents the subcommands, the file
format and the standing rules. It needs no real store and writes only to a temporary
directory.

## Uninstall

```text
/plugin uninstall ledge@ledge
/plugin marketplace remove ledge
```

Your task files in `~/.ledge/` are untouched. To disable without removing, use
`/plugin disable ledge@ledge`.
