---
description: Ledge task desk. Bare shows the desk; start, park, done, todo update this repo's task.
argument-hint: [start "title" | park "reason" | done | todo "item"]
---

# /ledge $ARGUMENTS

You are operating the Ledge task store for the person you are working with. Ledge tasks
are plain Markdown files under `~/.ledge/tasks/` (or `$LEDGE_HOME/tasks/`). The `ledge`
CLI creates and moves them; you edit their body with the Edit tool. Files are the API, so
every edit must keep the format below valid.

## Which subcommand

Read `$ARGUMENTS` and pick the matching row. The first word is the subcommand, the rest is
its argument. Quotes around the argument are optional.

| Arguments | What to do |
|---|---|
| empty | Run `ledge` in Bash and show its output unchanged. That is the desk. Stop there. |
| `start "title"` | Create a task for this repo, then write its Requirement and Checklist. |
| `park "reason"` | Refresh the checklist of the current task, then run `ledge park`. |
| `done` | Tick finished items, add a closing note, then run `ledge done`. |
| `todo "item"` | Append one unchecked item to the current task. |
| anything else | Say the subcommand is unknown and list the five above. Run nothing. |

## Finding the current task and its file

- The current task for this repo: `ledge current --repo "$PWD" --json`. It prints one task
  as JSON with an `id` field. Exit code 2 means no task matches this folder; tell the person
  and suggest `/ledge start "title"`.
- The task file path: `ledge open <id>`. It prints the absolute path of the `.md` file.
  Read that file before editing it, then use the Edit tool on it.

## Task file format

Copy this shape exactly. Frontmatter is YAML between `---` lines. The body has two known
headings, `## Requirement` and `## Checklist`. Anything after the checklist is preserved
and shown under it in the panel. Never rename or reorder the frontmatter keys, and never
edit `id`, `status`, `order`, `sessions`, `created`, `updated` or `parked` by hand: the CLI
owns those.

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

Rules that keep the file valid:

- `id` is the filename without date and extension. It is stable; `title` can change.
- `repo` is the folder the task belongs to. The CLI sets it from the folder you run in.
- Checklist items are GitHub task-list syntax: `- [ ] text` or `- [x] text`, one per line,
  directly under `## Checklist`. Progress in the panel is the ratio of `[x]` to total.
- Done tasks keep `status: done` and are moved to `archive/` by `ledge done`.
- Keep lines under 100 characters. Do not use em dashes.

## CLI commands you may run

| Command | Effect |
|---|---|
| `ledge` | Print Current, Backlog and Pending |
| `ledge add "title" --repo "$PWD"` | Create a task for this folder and print its id |
| `ledge start <id>` | Set status current, order 1, shift others down |
| `ledge park <id> "reason"` | Set status backlog and record the reason |
| `ledge done <id>` | Set status done and move the file to archive |
| `ledge current --repo "$PWD" --json` | The task for this folder as JSON |
| `ledge open <id>` | Print the task file path |
| `ledge todo <id> "text"` | Append an unchecked checklist item |
| `ledge tick <id> <n>` / `ledge untick <id> <n>` | Toggle item n (1-based) |

Exit codes: 0 ok, 1 usage error, 2 not found, 3 parse error (prints file and line). If
`ledge` is not on PATH, say so and point to the plugin README; do not try to recreate the
store by hand.

## Subcommand procedures

### start "title"

1. Run `ledge add "<title>" --repo "$PWD"`. Note the id it prints. If unsure, run
   `ledge current --repo "$PWD" --json` and read `id`.
2. Run `ledge start <id>` so the task sits at the top of Current.
3. Run `ledge open <id>`, Read the file, then with the Edit tool:
   - Under `## Requirement`, write two to six sentences of what is being built and why,
     taken from the conversation so far. If the conversation is empty, write the title as
     a sentence and say the requirement is to be refined.
   - Under `## Checklist`, write the concrete steps you expect, all unchecked, ordered.
     Aim for three to eight items. Mark anything already finished as `[x]`.
4. Confirm to the person with the id and the checklist.

### park "reason"

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge open <id>`, Read the file, and with the Edit tool bring the checklist up to
   date: tick what is finished, add items for work discovered but not done, and add a
   short line under the checklist saying where things stand if that helps the next
   session.
3. Run `ledge park <id> "<reason>"`.

### done

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge open <id>`, Read the file, and with the Edit tool tick every completed item.
   Leave items that were genuinely not done unchecked.
3. Add a final note under the checklist headed `Closing note` listing anything not
   committed, not pushed, not merged or not deployed, or say all work landed.
4. Run `ledge done <id>`.

### todo "item"

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge todo <id> "<item>"`. No file edit is needed.

## Standing rule during normal work

Whenever you finish a step that matches an unchecked checklist item in the current task,
tick it immediately: run `ledge open <id>` to get the path, then use the Edit tool to
change that item's `- [ ]` to `- [x]`. Add new unchecked items when work reveals extra
steps. Do this without being asked, and always before compaction or when you are about to
stop. Find the task with `ledge current --repo "$PWD" --json` if you do not already know
its id from the session start context.
