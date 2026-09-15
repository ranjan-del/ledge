# Task file format

Status: Contract 1 of phase 0. Fixed. A change here changes `@ledge/core`, the `/ledge` command
text and this document in the same pull request.

A task is one Markdown file under `~/.ledge/tasks/` (or `~/.ledge/archive/` once done). YAML
frontmatter, then a body with two known headings. Anything else in the body is preserved and shown
under the checklist.

## Example

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

## Filename

`YYYY-MM-DD-<id>.md`, where the date is the date part of `created`. Example:
`2026-09-14-release-watch-banner.md`.

## Frontmatter keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | The filename without date and extension. Stable for the life of the task. Made from the title with `slugify` on creation |
| `title` | string | yes | Human title. Can change at any time |
| `status` | `current`, `backlog` or `done` | yes | Which list the task is in |
| `order` | integer | yes | Position within its status list, 1 is top. `ledge start` sets 1 and shifts the rest down |
| `repo` | path | no | The folder the task belongs to. The plugin sets it from the folder the Claude session runs in. Stored with `~` for the home directory; expanded to an absolute path on load and re-tilded on save |
| `sessions` | list of strings | yes, may be empty | Claude Code session ids, newest last. `ledge link` appends if absent |
| `created` | ISO 8601 with offset | yes | Set once on creation |
| `updated` | ISO 8601 with offset | yes | Bumped on every save |
| `parked` | string | no | The reason given to `ledge park`. Only meaningful when `status` is `backlog` |

Unknown frontmatter keys are a parse error, so typos are caught rather than silently kept.

## Body

| Heading | Content | In `Task` |
|---|---|---|
| `## Requirement` | Free Markdown describing what and why | `requirement`, trimmed |
| `## Checklist` | GitHub task list items, `- [ ]` and `- [x]` | `checklist`, a list of `{ text, done }` |
| Anything after the checklist | Preserved verbatim | `extra`, trimmed |

Progress shown in the panel and the CLI is the ratio of `[x]` to total items.

## Rules

- `id` is the filename without date and extension. It is stable; the title can change.
- A task may have no `repo`.
- Done tasks keep `status: done` and move to `archive/` so the tasks folder stays small. The
  panel does not read `archive/` except for a count.
- `parseTask(serializeTask(task))` yields the same task, and serializing again yields the same
  text. Files written by Ledge are therefore diff friendly.
- Files are the API. Any editor, any script and Claude Code can change them.

## Parse errors

A malformed file raises `TaskParseError` with the file path and, where known, the line. The CLI
prints both and exits 3. The panel shows the row with a warning badge and the message, and never
crashes. Common causes: a missing required key, a `status` outside the three values, a
non-integer `order`, frontmatter that is not valid YAML, or a checklist line that is not
`- [ ]` or `- [x]`.

## Repo matching

A task matches a folder when the folder equals the task's `repo` or sits inside it. When several
tasks match, the deepest `repo` wins. Only tasks with `status: current` are considered by
`ledge current` and the SessionStart hook.
