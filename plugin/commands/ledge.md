---
description: Ledge task desk. Bare shows the desk; the subcommands update this repo's task.
argument-hint: [start "t" | park "why" | done | todo "i" | plan | note "text" | when <day>]
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
| `start "title"` | Create a task for this repo, then write Requirement, Plan and Checklist. |
| `park "reason"` | Refresh the checklist of the current task, then run `ledge park`. |
| `done` | Tick finished items, add a closing note, then run `ledge done`. |
| `todo "item"` | Append one unchecked item to the current task. |
| `plan` | Write or rewrite the ordered plan for the current task. |
| `note "text"` | Append `text` to today's notes on the current task. |
| `when <day>` | Set the planned day: `YYYY-MM-DD`, `today`, `tomorrow`, or `none` to clear. |
| anything else | Say the subcommand is unknown and list the eight above. Run nothing. |

## Finding the current task and its file

- The current task for this repo: `ledge current --repo "$PWD" --json`. It prints one task
  as JSON with an `id` field. Exit code 2 means no task matches this folder; tell the person
  and suggest `/ledge start "title"`.
- The task file path: `ledge open <id>`. It prints the absolute path of the `.md` file.
  Read that file before editing it, then use the Edit tool on it.

## Task file format

Copy this shape exactly. Frontmatter is YAML between `---` lines. The body has four known
headings, `## Requirement`, `## Plan`, `## Checklist` and `## Notes`, written in that
order. Anything else in the body is preserved and shown under them in the panel. Never
rename or reorder the frontmatter keys, and never edit `id`, `status`, `order`, `planned`,
`sessions`, `created`, `updated` or `parked` by hand: the CLI owns those.

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
planned: 2026-09-18        # optional, the day you intend to work on this, no time
created: 2026-09-14T21:04:00+05:30
updated: 2026-09-14T23:04:00+05:30
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

Rules that keep the file valid:

- `id` is the filename without date and extension. It is stable; `title` can change.
- `repo` is the folder the task belongs to. The CLI sets it from the folder you run in.
- Checklist items are GitHub task-list syntax: `- [ ] text` or `- [x] text`, one per line,
  directly under `## Checklist`. Progress in the panel is the ratio of `[x]` to total.
- Done tasks keep `status: done` and are moved to `archive/` by `ledge done`.
- `## Plan` is an ordered list, `1.` per line. It is the intent, written before work
  starts. The checklist is the tracking. They are not the same list and neither replaces
  the other.
- `## Notes` holds `### YYYY-MM-DD` subsections, newest last, one per day, free prose.
  Append to today's subsection; never rewrite an earlier day.
- Prefer `ledge plan`, `ledge note` and `ledge when` over editing those sections by hand.
  They keep the file valid and put the sections in the right order.
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
| `ledge plan <id> "step" "step" ...` | Replace the ordered plan steps |
| `ledge note <id> "text"` | Append text to today's notes |
| `ledge when <id> <YYYY-MM-DD\|today\|tomorrow\|none>` | Set or clear the planned day |
| `ledge today` | Tasks planned for today, overdue ones, then current tasks |

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
4. Run `ledge plan <id> "step" "step" ...` with the three to six steps you intend to take,
   in order. Write the plan before you edit any code.
5. Confirm to the person with the id, the plan and the checklist.

### park "reason"

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge open <id>`, Read the file, and with the Edit tool bring the checklist up to
   date: tick what is finished, add items for work discovered but not done, and add a
   short line under the checklist saying where things stand if that helps the next
   session.
3. Run `ledge note <id> "<text>"` with what was done, what is left, and why the task is
   being parked. That note is what the next session reads.
4. Run `ledge park <id> "<reason>"`.

### done

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge open <id>`, Read the file, and with the Edit tool tick every completed item.
   Leave items that were genuinely not done unchecked.
3. Run `ledge note <id> "<text>"` with a closing note: what landed, and anything not
   committed, not pushed, not merged or not deployed. If everything landed, say so.
4. Run `ledge done <id>`.

### todo "item"

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge todo <id> "<item>"`. No file edit is needed.

### plan

1. Resolve the id with `ledge current --repo "$PWD" --json`. Read its `plan` field.
2. Decide the ordered steps: three to six, each one a thing you will actually do, in the
   order you will do them. Do not restate the checklist and do not write a step per file.
3. Run `ledge plan <id> "step one" "step two" ...`. This replaces any previous plan, so
   pass every step you want to keep, not only the new ones.
4. Show the person the numbered plan you wrote.

### note "text"

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge note <id> "<text>"`. It appends to today's `### YYYY-MM-DD` subsection and
   creates that subsection when it is missing. Never edit the Notes section by hand.
3. Write the reasoning, not the status: the decision and what it rules out, the dead end
   and why it failed, the surprise and what it means. One short paragraph.

### when <day>

1. Resolve the id with `ledge current --repo "$PWD" --json`.
2. Run `ledge when <id> <day>` where `<day>` is `YYYY-MM-DD`, `today`, `tomorrow`, or
   `none` to clear it. Anything else is rejected; do not guess a date from prose without
   saying which date you used.

## Standing rules during normal work

Do all of the following without being asked. Each one is a rule, not a suggestion.

**Tick the checklist as you go.** Whenever you finish a step that matches an unchecked
item in the current task, tick it immediately: run `ledge open <id>` to get the path, then
use the Edit tool to change that item's `- [ ]` to `- [x]`. Add new unchecked items when
work reveals extra steps. Find the task with `ledge current --repo "$PWD" --json` if you
do not already know its id from the session start context.

**Write a plan before you edit code.** Before your first file edit in a session, check
the current task's `plan` field. If it is empty, decide the ordered steps and run
`ledge plan <id> "step" "step" ...` first. Do not start editing and plan afterwards. If a
plan exists and turns out to be wrong, say so, run `ledge plan` again with the corrected
steps, and then carry on.

**Append a note when you decide something or something surprises you.** Run
`ledge note <id> "<text>"` at the moment it happens, not at the end. Write a note when:

- you choose one approach over another, including the option you rejected and why;
- something does not work and you abandon it, so the next session does not retry it;
- you find out something about the codebase that was not obvious and changed your plan;
- a requirement turns out to be different from what the task file says.

Do not write a note that restates the checklist, repeats the plan, or says work is
progressing. If a note would only say what a ticked box already says, do not write it.

**Append a closing note before compaction and at the end of a session.** When you are
asked to compact, when the PreCompact hook fires, and when you are about to stop working,
run `ledge note <id> "<text>"` covering three things in this order:

1. what was done in this session;
2. what is left, and where it was left;
3. what the next session needs to know: the decisions that hold, the traps, the commands
   to run, anything uncommitted or undeployed.

Tick the checklist first, then write that note. Do this even when the session felt short,
and even when nothing landed: "tried X, it fails because Y, not committed" is exactly the
note the next session needs.

**Read the notes at the start.** The session start context carries the latest note. Read
it before you plan anything, and if it disagrees with the checklist, trust the note and
say so.
