# Weekly to-do contract

Status: agreed 2026-09-27. Builds on the [AI assistant contract](2026-09-27-ai-assistant-contract.md).
Stream **A** owns core, CLI, plugin and docs; stream **B** owns `apps/desktop`.

## Goal

A personal list of things to do this week, so the person remembers what the week holds. It is
separate from task checklists: an item is a reminder, not a step of a task, though it may point at
one.

## Decisions (made by the person)

| Topic | Decision |
|---|---|
| Placement | A sub-tab inside Tasks: a switch reading `Tasks` and `To-do`. The top bar keeps its four tabs |
| Shape | Grouped by day, Monday to Sunday, plus an `Anytime this week` bucket. Today is highlighted |
| New week | Unfinished items stay in their own week. Each week starts empty; past and future weeks can be browsed |
| Links | An item may link to a task (click opens it). Ask Ledge and Claude sessions add and tick items through `ledge week`. Today's items appear at the top of the Now tab |

## File

One Markdown file per ISO week: `$LEDGE_HOME/weeks/<YYYY>-W<ww>.md`, e.g. `2026-W39.md`. Weeks start
on Monday (ISO 8601). A missing file is an empty week. The folder is created on first write, and
writes are atomic (`<file>.<pid>.tmp`, then rename).

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

Rules:

- Sections are `## Anytime` and `## <Ddd> <YYYY-MM-DD>` for days inside that week. They are written in
  this order: Anytime first, then days in calendar order. Days with no items are not written.
- An item is a GitHub task list line. A trailing ` {task: <task-id>}` links it to a task and is not
  part of the text.
- Anything the parser does not understand (other headings, prose, a day outside the week) is kept
  verbatim and written after the known sections, as task files do. Unknown frontmatter keys are kept.
- Parse, then serialize, gives the same bytes back for a file Ledge wrote.

## Core API (pure, exported from `@ledge/core/pure`)

```ts
interface WeekItem { text: string; done: boolean; taskId?: string }
interface WeekFile {
  week: string;                       // '2026-W39'
  anytime: WeekItem[];
  days: Record<string, WeekItem[]>;   // key 'YYYY-MM-DD', only days inside the week
  updated?: string;
  extra: string;                      // preserved text
  meta?: Record<string, unknown>;
}
isoWeekOf(day: string): string              // '2026-09-27' -> '2026-W39'
weekDays(week: string): string[]            // the 7 days, Monday first
shiftWeek(week: string, n: number): string  // previous / next week
parseWeek(text: string, week: string): WeekFile
serializeWeek(w: WeekFile): string
itemsFor(w: WeekFile, day: string): WeekItem[]   // that day's items (not Anytime)
```

Node (`@ledge/core`): `WeekStore` with `get(week)`, `put(file)`, `path(week)`, bound to `ledgeHome()`.

## CLI (stream A)

`<day>` accepts `YYYY-MM-DD`, `today`, `tomorrow`, `mon` to `sun` (in the target week), or `anytime`.
The week defaults to the current one; `--week 2026-W40` or `--next` overrides it.

| Command | Does |
|---|---|
| `ledge week [--week W] [--json]` | Prints the week grouped by day, with each item's 1-based number |
| `ledge week add "<text>" [--day <day>] [--task <id>]` | Adds an item; default day is `anytime` |
| `ledge week tick <n>` / `untick <n>` / `rm <n>` | By the number `ledge week` printed |
| `ledge week move <n> --day <day>` | Moves an item to another day in the same week |

Numbering is stable for a given file: Anytime first, then days in order, items in file order.
Output is plain text; `--json` prints the WeekFile plus a `numbered` array.

## Where else it shows (stream A)

- `ledge today` and `ledge current --context` include today's unticked week items (at most 5 lines).
- The SessionStart standing rules gain one line: when the person asks to remember something for the
  week, use `ledge week add`.
- The capture engine does **not** add week items on its own. Week items are added only when someone
  explicitly asks.

## Desktop (stream B)

- Tasks tab: a segmented switch `Tasks | To-do` at the top, remembered per viewer.
- To-do view: a week header (`Week 39, 21 to 27 Sep`) with previous, next and `This week`. Then
  `Anytime this week` and the seven days, Monday first. Today is highlighted, and past days in the
  current week are muted. A day with no items shows a quiet add row, not a big empty block.
- Add in one interaction: type and press Enter. The day defaults to the section you are in. An
  optional task picker links the item.
- Each item: tick, edit the text in place, move to another day (menu), link or unlink a task,
  delete. A linked item shows the task name as a chip that opens the task.
- The view reads and watches `~/.ledge/weeks/` like `tasks/` and writes through core `serializeWeek`.
- Now tab: a `Today` block at the top with today's unticked items (tickable), plus a line
  `N more this week` that opens the To-do view.
- Ask Ledge: the context includes this week's items, and the rules tell it to use `ledge week` for
  "remind me this week / add to my week" requests.
- Until stream A lands, stream B uses a local shim `apps/desktop/src/lib/week.ts` with exactly the
  pure API above, headed `TEMPORARY: replace with @ledge/core/pure exports at merge`.
