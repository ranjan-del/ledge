# Task file format

Status: Contract 1, extended by the
[v2 contract](superpowers/specs/2026-09-15-v2-contract.md) on 2026-09-15 with `planned`,
`## Plan` and `## Notes`. All three are optional. A change here changes `@ledge/core`, the
`/ledge` command text and this document in the same pull request.

A task is one Markdown file under `$LEDGE_HOME/tasks/`, or `$LEDGE_HOME/archive/` once it is
done. YAML frontmatter, then a Markdown body with four known headings. Anything else in the body
is preserved verbatim and written after the known sections.

## Example

This file uses every key and every section, in the order Ledge writes them. Nothing here is
required except `id`, `title`, `status` and `order`. The `# ...` comments are there to explain the
keys; Ledge reads them but does not write them back.

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

### 2026-09-16
The build writes version.json but Vite copies it before the hash is known, so the value was
always stale. Moved the write into a closeBundle hook. Not committed yet.
```

## Filename

`YYYY-MM-DD-<id>.md`, where the date is the date part of `created`. Example:
`2026-09-14-release-watch-banner.md`. The date keeps the folder sorted chronologically in any
file browser; the id keeps the name readable.

## Frontmatter keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | The filename without date and extension. Stable for the life of the task. Made from the title with `slugify` on creation, suffixed `-2`, `-3` if that id is taken |
| `title` | string | yes | Human title. Can change at any time |
| `status` | `current`, `backlog` or `done` | yes | Which list the task is in. Any other value is a parse error |
| `order` | number | yes | Position within its status list, 1 is top. A value that is not a finite number is a parse error |
| `repo` | path | no | The folder the task belongs to. The plugin sets it from the folder the Claude session runs in. Stored with `~` for the home folder, expanded to an absolute path on load and re-tilded on save |
| `planned` | `YYYY-MM-DD` | no | The calendar day you intend to work on this. No time, no zone. A value that is not a real calendar day is dropped, not an error |
| `sessions` | list of strings | no, defaults to `[]` | Claude Code session ids, newest last. `ledge link` appends one if it is absent. A value that is not a list is a parse error |
| `created` | ISO 8601 with offset | no, defaults to now | Set once on creation, e.g. `2026-09-14T21:04:00+05:30` |
| `updated` | ISO 8601 with offset | no, defaults to `created` | Bumped on every save |
| `parked` | string | no | The reason given to `ledge park`. Only meaningful when `status` is `backlog` |

Unknown frontmatter keys are kept. They are read into `Task.meta` in their original order and
written back after the known keys, so you or another tool can add a key of your own and a round
trip through Ledge does not drop it.

### The `planned` rule in full

`planned` is validated with `isIsoDay`, which requires the exact shape `YYYY-MM-DD` and a day
that exists. `2026-13-01`, `2026-02-31` and `next tuesday` all fail. A failing value is dropped
from the parsed task and is gone the next time the file is written. One mistyped date must never
make a task unreadable, so this is the one field that degrades instead of raising.

Going the other way, `TaskStore.setPlanned` and `ledge when` reject a bad day loudly with a
`RangeError`, so a typo fails on the way in rather than being silently discarded on the way out.

## Body sections

| Heading | Content | In `Task` |
|---|---|---|
| `## Requirement` | Free Markdown: what has to be true when this is finished | `requirement`, trimmed |
| `## Plan` | An ordered list of steps, the intent, written before work starts | `plan`, a list of strings |
| `## Checklist` | GitHub task list items, `- [ ]` and `- [x]`, the tracking | `checklist`, a list of `{ text, done }` |
| `## Notes` | `### YYYY-MM-DD` subsections of free prose, the session memory | `notes`, a list of `{ date, body }` |
| Any other heading or text | Preserved verbatim | `extra`, trimmed |

Progress shown in the panel and the CLI is the ratio of `[x]` to total checklist items. The plan
is not counted.

### Plan and Checklist are different lists

The plan is the intent: three to six steps in the order you mean to take them, written before the
first edit. The checklist is the tracking: it gets ticked as work lands and grows as work reveals
more steps. Neither replaces the other, and `ledge plan` replaces the plan wholesale because a
plan that has changed is a new plan.

Plan items may be written `1.`, `1)`, `-` or `*`. They are always written back as `1.`, `2.`,
`3.` in file order. A task-list line inside `## Plan` is not a plan step.

### Notes are the session memory

Each note is one calendar day, newest last, and carries the reasoning the checklist cannot: the
decision and what it rules out, the dead end and why it failed, the surprise that changed the
plan. `ledge note` appends to today's subsection and creates it when it is missing. Earlier days
are never reordered and never rewritten.

A `### ` line inside a note that is not a date stays part of that day's prose, because a note is
free Markdown.

## Write order

Serializing a task always produces the same shape, whatever order the file it came from used:

1. `---`, then the frontmatter keys in the table order above, then any unknown keys, then `---`
2. `## Requirement`, always, even when empty
3. `## Plan`, only when there is at least one step
4. `## Checklist`, always, even when empty
5. `## Notes`, only when at least one note has a body
6. `extra`, verbatim, last

A file whose sections are in a different order still parses, and is rewritten in this order the
next time it is saved. That is why every task file on disk converges on one shape and diffs stay
small.

## Round trip guarantee

`parseTask` and `serializeTask` are inverses:

- Parsing a file Ledge wrote and serializing it again yields the same bytes.
- Serializing twice yields the same text, so there is no drift from repeated saves.
- A file written before `planned`, `## Plan` and `## Notes` existed still parses. It gets
  `planned: undefined`, `plan: []` and `notes: []`, and round trips unchanged.
- Content Ledge does not understand, including unknown frontmatter keys and unknown body
  sections, survives the trip.

One thing does not survive: YAML comments in the frontmatter. They parse fine but are not written
back, so the `# ...` notes in the example above disappear the first time Ledge saves that file.
Comments in the Markdown body are ordinary text and are kept.

## What is preserved rather than parsed

Ledge would rather keep text it cannot interpret than lose it. Three cases:

| In the file | What happens |
|---|---|
| `## Plan` with no list items, only prose | Not a plan. The whole section, heading included, is kept verbatim in `extra` |
| `## Notes` with no `### YYYY-MM-DD` subsection | Not notes. The whole section, heading included, is kept verbatim in `extra` |
| A repeated `## Requirement`, `## Plan`, `## Checklist` or `## Notes` | The first one Ledge can read counts. Any other copy is kept verbatim in `extra` |

Lines before the first dated subsection of a real `## Notes` section, and non task-list lines
inside a `## Checklist`, are also moved to `extra` rather than dropped. Because `extra` is
written last, preserved text moves below the known sections when the file is next saved. It
keeps its own characters exactly.

## Rules

- `id` is the filename without date and extension. It is stable; the title can change.
- A task may have no `repo`.
- Done tasks keep `status: done` and move to `archive/` so the tasks folder stays small. The
  panel does not read `archive/` except for a count.
- Files are the API. Any editor, any script, the CLI, the desktop app and Claude Code can change
  them.
- Prefer `ledge plan`, `ledge note` and `ledge when` over hand-editing those three, so the file
  keeps the write order above.

## Parse errors

A malformed file raises `TaskParseError` with the file path and, where known, the 1-based line.
The CLI prints both and exits 3. The panel shows the row with a warning badge and the message,
and never crashes.

| Cause | Example |
|---|---|
| No frontmatter block, or it is not closed | The file does not start with `---` |
| Frontmatter that is not valid YAML | A tab in the indentation, an unclosed quote |
| Frontmatter that is not a mapping | A YAML list at the top level |
| A missing or blank `id` or `title` | `title:` with nothing after it |
| A `status` outside the three values | `status: paused` |
| An `order` that is not a finite number | `order: soon` |
| A `sessions` value that is not a list | `sessions: b13e8b5e` |

A bad `planned` value is not in this list. It is dropped, and the rest of the file is read.

## Repo matching

A task matches a folder when the folder equals the task's `repo` or sits inside it. When several
tasks match, the deepest `repo` wins. Only tasks with `status: current` are considered by
`ledge current` and the SessionStart hook, so a parked task never hijacks a session.

## Planned days across tasks

`plannedFor(tasks, day)` splits a list of tasks into two:

| List | Contents |
|---|---|
| `today` | Tasks whose `planned` equals `day` |
| `overdue` | Tasks whose `planned` is before `day` and whose `status` is not `done` |

Tasks with no `planned` day appear in neither. Input order is kept, so a list already sorted by
`order` stays sorted. This is what `ledge today` and the panel's home view are built on.
