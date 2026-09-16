# Teaching Claude Code to keep Ledge current

Two ways to do this. The plugin already carries the rules, so most people need only the
first. The memory block is for making it unmissable, or for a machine where the plugin is
not installed.

## 1. Install the plugin, which is the whole answer

```
/plugin marketplace add ranjan-del/ledge
/plugin install ledge@ledge
```

From then on every session in a repository with a Ledge task starts with that task's
requirement, plan, planned day, open checklist items and latest note already in context, and
the assistant is under standing instructions to keep the file current as it works.

## 2. The memory block

Paste this into `~/.claude/CLAUDE.md` to apply it to every project, or into a single repo's
`CLAUDE.md` to apply it there. It repeats the plugin's rules as project memory, which is read
earlier and carries more weight than a command file.

```markdown
## Ledge: keep my work log current

My tasks live as Markdown files in `~/.ledge/tasks`, one file per task, and the `ledge`
command reads and writes them. Treat that store as the record of what I am doing. Keep it
true without being asked.

**At the start of work.** Run `ledge current --repo "$PWD" --context`. If it names a task,
that is what we are working on; read its notes before its checklist, because the notes say
why the checklist looks the way it does. If it names nothing and we are about to do real
work, create the task first: `ledge add "<title>" --repo "$PWD"`, then write its Requirement
section and a first checklist into the file.

**Before editing any code.** If the task has no `## Plan`, write one:
`ledge plan <id> "step" "step" "step"`. Ordered, three to six steps, each one a thing that
can be finished. The plan is the intent; the checklist is the tracking.

**While working.** Tick items the moment they are genuinely done, with
`ledge tick <id> <n>`, and add items as new work appears, with `ledge todo <id> "text"`.
Do not batch this up for the end of the session.

**When something is decided or goes wrong.** Append a note: `ledge note <id> "text"`.
Notes are for reasoning, decisions and dead ends: why we chose this approach, what we tried
that failed, what surprised us, what changed about the requirement. Notes are not a second
copy of the checklist, and a note that only says what was done is wasted.

**Before the context is compacted, and at the end of every session.** Append a closing note
covering three things: what got done, what is left, and what the next session needs to know
to pick this up cold. This note is the handover. Write it as if the reader has no memory of
today, because they do not.

**When a task is finished.** `ledge done <id>`. First tick anything still open that is
actually done, and append a final note saying what shipped and what did not, including
anything not yet pushed, merged or deployed.

**When I say I am moving to something else.** `ledge park <id> "reason"`, after refreshing
the checklist so it reflects where we actually stopped.

**Planning a day.** `ledge when <id> today` or a date, and `ledge today` to see what is on.

Never invent progress. A checklist item is ticked only when the thing is true, and if you are
unsure whether it is true, leave it open and say so in a note.
```

## 3. The one-off prompt

If you want to bring the store up to date in a session where none of the above was in place,
paste this:

```
Read `ledge current --repo "$PWD" --context`, then look at what we actually did in this
session and bring the task file in line with reality: tick what is genuinely finished, add
checklist items for work that appeared, write the plan if it is missing, and append a note
covering what was decided, what is left, and what the next session needs to know cold. If
there is no task for this repository, create one first and write its requirement from what
you can see in the code and in our conversation. Do not mark anything done that you have not
verified.
```
