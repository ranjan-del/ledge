# Week file format

Status: the [weekly to-do contract](superpowers/specs/2026-09-27-weekly-todo-contract.md),
2026-09-27. The core, CLI and plugin parts are built; the desktop To-do view is stream B of the
same contract. A change here changes `@ledge/core` (`week.ts`), the `/ledge` command text and
this document in the same pull request.

A week file is the person's list of things to do in one ISO week, so they remember what the week
holds. It is separate from task checklists: an item is a reminder, not a step of a task, though it
may point at one.

## Where it lives

One Markdown file per ISO week: `$LEDGE_HOME/weeks/<YYYY>-W<ww>.md`, e.g.
`~/.ledge/weeks/2026-W39.md`. Weeks start on Monday (ISO 8601). A missing file is an empty week,
not an error. The `weeks/` folder is created on the first write, and every write goes to
`<file>.<pid>.tmp` first and is then renamed over the file, so a watcher sees the old list or the
new one and never half of each.

Each week starts empty. Unfinished items stay in their own week; nothing is carried forward.

## Example

This is exactly what Ledge writes.

```markdown
---
week: 2026-W39
updated: 2026-09-27T12:40:00+05:30
---

## Anytime

- [ ] Renew the domain

## Mon 2026-09-21

- [x] Call the vendor about invoices
- [ ] Review Teacher Corner PR {task: teacher-corner-web-consolidation}

## Thu 2026-09-24

- [ ] Sprint demo prep
```

## Frontmatter keys

| Key | Type | Meaning |
|---|---|---|
| `week` | `YYYY-Www` | The ISO week. Written by Ledge; on read the file name decides the week, not this key |
| `updated` | ISO 8601 with offset | Stamped by `WeekStore.put` on every write |

Unknown keys are kept in `WeekFile.meta` in their original order and written back after the two
known ones. As with task files, YAML comments are not written back.

## Body sections

| Heading | Content |
|---|---|
| `## Anytime` | Items for the week with no particular day |
| `## <Ddd> <YYYY-MM-DD>` | Items for one day inside the week, e.g. `## Mon 2026-09-21` |
| Any other heading or text | Kept verbatim in `extra` and written after the known sections |

An item is a GitHub task list line, `- [ ] text` or `- [x] text`. A trailing ` {task: <task-id>}`
links it to a task and is not part of the text. A wrapped, indented line continues the item above
it.

Ledge writes Anytime first, then the days in calendar order, and leaves out a day with no items.

## Reading rules

The parser never throws on content. A reminder list that cannot be read is worse than one with a
few lines moved to the end.

| In the file | What happens |
|---|---|
| A day heading whose date is inside the week | Known. The date decides the day; a wrong day name such as `## Tue 2026-09-21` is written back as `Mon` |
| A day heading whose date is outside the week | Kept verbatim in `extra`, items and all |
| The same section twice | The items are merged in file order |
| `## anytime` or any other spelling | Not a known heading, kept in `extra` |
| Prose under a known heading | Moved to `extra`, with its own paragraph breaks |
| A heading inside a fenced code block | Content of the block, never a section |
| Frontmatter that is not valid YAML or not a mapping | Read as body text and kept in `extra` |
| No frontmatter at all | Read as an empty header; the body is parsed as usual |

## Round trip guarantee

- Parsing a file Ledge wrote and serializing it again gives the same bytes.
- Serializing a parsed file twice gives the same text.
- Unknown frontmatter keys and unknown body text survive the trip. Preserved text moves below
  the known sections, keeping its own characters.

One thing to know: text that itself ends in `{task: something}` is read as a link the next time
the file is parsed.

## Numbering

`ledge week` prints each item with a 1-based number: Anytime first, then Monday to Sunday, items
in file order. The numbers are stable for a given file, and `ledge week tick`, `untick`, `rm` and
`move` take them. `numberWeek` in core gives the same numbers to any other reader.

## ISO weeks

The week of a day is the week that holds its Thursday, so the ends of a year can belong to the
week of the neighbouring year:

| Day | Week |
|---|---|
| 2026-09-27 (a Sunday) | 2026-W39, Monday 2026-09-21 |
| 2026-12-31 | 2026-W53 |
| 2027-01-01 | 2026-W53 |
| 2021-01-03 | 2020-W53 |
| 2024-12-30 | 2025-W01 |

A year has 53 weeks when its 28 December falls in week 53; `2020-W53` and `2026-W53` exist,
`2025-W53` does not.

## Core API

Pure, exported from `@ledge/core/pure` and `@ledge/core`:

| Function | Does |
|---|---|
| `isoWeekOf(day)` | `2026-09-27` gives `2026-W39` |
| `weekDays(week)` | The seven days, Monday first |
| `shiftWeek(week, n)` | The week `n` weeks later, or earlier for a negative `n` |
| `isIsoWeek(value)` | True for a real `YYYY-Www` week |
| `parseWeek(text, week)` | Text to `WeekFile` |
| `serializeWeek(w)` | `WeekFile` to text |
| `itemsFor(w, day)` | That day's items, not Anytime |
| `numberWeek(w)` | Every item with its number, its slot and its index in that slot |
| `emptyWeek(week)`, `weekdayName(day)` | An empty week; `Mon` to `Sun` for a day |

`WeekFile.days` holds only days that have items, so ask `itemsFor` rather than indexing it.

Node only, from `@ledge/core`: `WeekStore`, with `get(week)`, `put(file)` and `path(week)`, bound
to `ledgeHome()` unless given a home.

## Who writes it

The person, through `ledge week`, the desktop To-do view or an editor, and a Claude session only
when the person asks it to. The capture engine never adds week items on its own.
